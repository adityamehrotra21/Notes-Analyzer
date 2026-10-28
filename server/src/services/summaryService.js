// Summaries and study notes, cached per mode on the document. See prompts/summarize.js for the flow:
//   text (whole doc, or map-reduce notes for very large docs) -> outline (nano, cached) -> notes for the mode
//   -> coverage check against the outline (code) -> fill missing topics (one extra call) -> cache + coverage.
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { documents } from '../db/schema.js';
import { env } from '../config/env.js';
import { costUsd, priceFor } from '../config/pricing.js';
import { AppError } from '../utils/AppError.js';
import { countTokens, fitBudget } from '../utils/tokens.js';
import {
  SUMMARY_SYSTEM_PROMPT,
  buildCollapseMessage,
  buildMapMessage,
  buildMissingSectionsMessage,
  buildReduceMessage,
} from '../../prompts/summarize.js';
import { getDocumentChunks } from './vectorStore.js';
import { generateText, modelInfo, OUTPUT_CAPS } from './llmService.js';
import { getOutline } from './outlineService.js';
import { checkCoverage, insertSections } from './coverage.js';
import logger from '../utils/logger.js';
import auditService from './auditService.js';

const log = logger.child({ module: 'summary' });

// The Bullets mode was removed (Nov 2026); documents.summary_bullet is kept but no longer used.
export const SUMMARY_MODES = ['brief', 'detailed', 'exam'];
const COLUMN = { brief: 'summaryBrief', detailed: 'summaryDetailed', exam: 'summaryExam' };
// Detailed Notes gets the notes cap (12k); Brief / Exam Revision the summary cap (4k).
const STEP = { brief: 'summaryReduce', exam: 'summaryReduce', detailed: 'notes' };
// Modes that follow the outline and get the coverage check + gap filling.
const OUTLINED = new Set(['detailed', 'exam']);
const MAX_COLLAPSE_ROUNDS = 4;
const FILL_CONTEXT_TOKENS = 12_000;

// Same document + mode requested twice at once -> one generation.
const inflight = new Map();

/** Tokens of source text that fit in one call, after prompt, output and the safety margin. */
function contextFits() {
  const fits = fitBudget(env.LLM_MAX_CONTEXT_TOKENS) - OUTPUT_CAPS.notes - countTokens(SUMMARY_SYSTEM_PROMPT) - 1500;
  if (fits < 2000) throw new AppError(500, 'LLM_MAX_CONTEXT_TOKENS is too small to summarise. Increase it or lower the output caps.');
  return fits;
}
/** Documents up to this size go to OPENAI_CHAT_MODEL in ONE call (no map-reduce). */
const singleCallBudget = () => Math.min(env.SUMMARY_SINGLE_CALL_TOKENS, contextFits());
/** Group size for the map step of larger documents. */
const groupBudget = () => Math.min(env.SUMMARY_GROUP_TOKENS, contextFits());

/** Drop the overlap a chunk shares with the end of the previous one. */
function trimOverlap(prev, next) {
  const probe = next.slice(0, 60);
  if (probe.length < 20) return next;
  const idx = prev.lastIndexOf(probe, prev.length - 1);
  if (idx < 0 || idx < prev.length - 3000) return next;
  const tail = prev.slice(idx);
  return next.startsWith(tail) ? next.slice(tail.length).trimStart() : next;
}

/** Reading-order units with page markers and overlap removed. */
function toUnits(chunks) {
  const units = [];
  let prevText = '';
  for (const c of chunks) {
    const text = trimOverlap(prevText, c.text);
    prevText = c.text;
    if (!text.trim()) continue;
    const pages = c.pageEnd && c.pageEnd !== c.page ? `pp. ${c.page}–${c.pageEnd}` : `p. ${c.page}`;
    const body = `[${pages}]\n${text}`;
    units.push({ text: body, tokens: countTokens(body), page: c.page, pageEnd: c.pageEnd ?? c.page });
  }
  return units;
}

function groupUnits(units, budget) {
  const groups = [];
  let cur = [];
  let tokens = 0;
  for (const u of units) {
    if (cur.length && tokens + u.tokens > budget) {
      groups.push(cur);
      cur = [];
      tokens = 0;
    }
    cur.push(u);
    tokens += u.tokens;
  }
  if (cur.length) groups.push(cur);
  return groups.map((g) => g.map((u) => u.text).join('\n\n'));
}

/**
 * steps: summaryMap | summaryReduce | notes | notesFill.
 * Empty/incomplete output is recovered (or turned into a friendly error) inside llmService; long notes
 * that get cut off are continued up to 2 times and stitched.
 */
async function generate(content, label, { step, tier = 'main', cacheKey }) {
  const { text, continuations } = await generateText({
    step,
    tier,
    system: SUMMARY_SYSTEM_PROMPT,
    messages: [{ role: 'user', content }],
    label,
    cacheKey,
    continueOnLength: step === 'summaryMap' ? 0 : 2,
  });
  if (continuations) log.info(`${label}: stitched ${continuations} continuation(s)`, { step, chars: text.length });
  return text.trim();
}

/**
 * The text everything is written from: the document itself when it fits in one call,
 * otherwise map-step notes (computed once and cached in documents.summary_notes).
 * Always returns the page-tagged units too (used to pick excerpts for missing topics).
 */
async function sourceForReduce(doc, userId, { refresh }) {
  const chunks = await getDocumentChunks({ userId, documentIds: [doc.id] });
  if (!chunks.length) throw AppError.badRequest(`${doc.filename} has no text to summarise`);
  const units = toUnits(chunks);
  const total = units.reduce((n, u) => n + u.tokens, 0);
  if (total <= singleCallBudget()) {
    log.info('summary: single call (whole document fits)', { documentId: doc.id, tokens: total, limit: singleCallBudget() });
    return { text: units.map((u) => u.text).join('\n\n'), isNotes: false, calls: 0, units, total };
  }
  const budget = groupBudget();
  log.info('summary: map-reduce (document larger than the single-call limit)', { documentId: doc.id, tokens: total, limit: singleCallBudget(), groupTokens: budget });
  if (doc.summaryNotes && !refresh) return { text: doc.summaryNotes, isNotes: true, calls: 0, units, total };

  const groups = groupUnits(units, budget);
  let calls = 0;
  let notes = [];
  for (const [i, text] of groups.entries()) {
    notes.push(
      await generate(buildMapMessage({ filename: doc.filename, text, part: `part ${i + 1} of ${groups.length}` }), `summary map ${i + 1}/${groups.length}`, {
        step: 'summaryMap',
        tier: 'cheap',
        cacheKey: 'na-summary-map',
      }),
    );
    calls++;
  }
  let joined = notes.join('\n\n');
  for (let round = 0; countTokens(joined) > budget; round++) {
    if (round >= MAX_COLLAPSE_ROUNDS) throw new AppError(422, `${doc.filename} is too long to summarise with the current token limits`);
    const noteGroups = groupUnits(notes.map((n) => ({ text: n, tokens: countTokens(n) })), budget);
    notes = [];
    for (const g of noteGroups) {
      notes.push(await generate(buildCollapseMessage({ filename: doc.filename, notes: g }), 'summary collapse', { step: 'summaryReduce', tier: 'cheap', cacheKey: 'na-summary-collapse' }));
      calls++;
    }
    joined = notes.join('\n\n');
  }
  await db.update(documents).set({ summaryNotes: joined }).where(eq(documents.id, doc.id));
  return { text: joined, isNotes: true, calls, units, total };
}

/** Units on the pages of the given topics (falls back to all text), within FILL_CONTEXT_TOKENS. */
function excerptFor(units, topics) {
  const inRange = (u) => topics.some((t) => u.pageEnd >= t.startPage && u.page <= t.endPage);
  const picked = units.filter(inRange);
  const out = [];
  let used = 0;
  for (const u of picked.length ? picked : units) {
    if (used + u.tokens > FILL_CONTEXT_TOKENS) break;
    out.push(u.text);
    used += u.tokens;
  }
  return out.join('\n\n');
}

async function computeSummary(doc, userId, mode, { refresh }) {
  const t0 = Date.now();
  const source = await sourceForReduce(doc, userId, { refresh });
  let calls = source.calls;
  const outline = OUTLINED.has(mode) ? await getOutline(doc, source, { refresh: refresh && mode === 'detailed' }) : null;
  if (outline && !doc.outline) calls++;

  let summary = await generate(buildReduceMessage({ filename: doc.filename, mode, ...source, outline }), `summary ${mode}`, {
    step: STEP[mode],
    tier: 'main',
    cacheKey: `na-summary-${doc.id}`, // same document -> same prefix across modes and the outline call
  });
  calls++;

  let coverage = null;
  if (outline) {
    const first = checkCoverage(outline, summary, mode);
    let filled = [];
    if (first.missing.length) {
      const topics = outline.topics.filter((t) => first.missing.includes(t.title));
      log.info('coverage gap: generating missing sections only', { documentId: doc.id, mode, missing: first.missing });
      const extra = await generate(
        buildMissingSectionsMessage({ filename: doc.filename, mode, topics, text: excerptFor(source.units, topics), outline }),
        `summary ${mode} (missing topics)`,
        { step: 'notesFill', tier: 'main', cacheKey: `na-summary-fill-${doc.id}` },
      );
      calls++;
      summary = insertSections(summary, extra);
      const after = checkCoverage(outline, summary, mode);
      filled = first.missing.filter((t) => !after.missing.includes(t));
      coverage = { ...after, filled };
    } else {
      coverage = { ...first, filled };
    }
    log.info('coverage', { documentId: doc.id, mode, covered: coverage.covered, total: coverage.total, missing: coverage.missing, filled });
  }

  const allCoverage = { ...(doc.summaryCoverage ?? {}), ...(coverage ? { [mode]: { ...coverage, checkedAt: new Date().toISOString() } } : {}) };
  await db.update(documents).set({ [COLUMN[mode]]: summary, summaryCoverage: allCoverage }).where(eq(documents.id, doc.id));
  await auditService.record({
    action: 'update',
    entity: 'document',
    entityId: doc.id,
    before: { [COLUMN[mode]]: doc[COLUMN[mode]] ? `[${doc[COLUMN[mode]].length} chars]` : null },
    after: { [COLUMN[mode]]: `[generated, ${summary.length} chars]`, ...(coverage ? { coverage: `${coverage.covered}/${coverage.total}` } : {}) },
  });
  log.info('summary generated', { documentId: doc.id, mode, llmCalls: calls, usedNotes: source.isNotes, durationMs: Date.now() - t0 });
  return { summary, coverage };
}

async function loadDoc(userId, documentId) {
  const [doc] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.userId, userId)));
  if (!doc) throw AppError.notFound('Document not found');
  if (doc.status !== 'ready') throw AppError.badRequest(`${doc.filename} is not ready yet`);
  return doc;
}

/** Cached summary of one ready document in the given mode, generating it if needed. */
export async function summarizeDocument({ userId, documentId, mode, refresh = false }) {
  const doc = await loadDoc(userId, documentId);
  const base = { documentId: doc.id, filename: doc.filename, mode };
  if (!refresh && doc[COLUMN[mode]]) {
    return { ...base, summary: doc[COLUMN[mode]], coverage: doc.summaryCoverage?.[mode] ?? null, cached: true };
  }
  const key = `${doc.id}:${mode}`;
  if (!inflight.has(key)) {
    inflight.set(key, computeSummary(doc, userId, mode, { refresh }).finally(() => inflight.delete(key)));
  }
  const { summary, coverage } = await inflight.get(key);
  return { ...base, summary, coverage, cached: false };
}

/**
 * Cost estimate for generating (or regenerating) one mode, from the pricing table. No LLM calls.
 * typical = ~60% of the output caps and no gap fill; worst = full caps + gap fill + the rescue retry.
 */
export async function estimateSummary({ userId, documentId, mode, refresh = false }) {
  const doc = await loadDoc(userId, documentId);
  const chunks = await getDocumentChunks({ userId, documentIds: [doc.id] });
  const units = toUnits(chunks);
  const total = units.reduce((n, u) => n + u.tokens, 0);
  const single = total <= singleCallBudget();
  const main = modelInfo('main');
  const cheap = modelInfo('cheap');
  const mock = main.provider === 'mock';
  const price = (m) => (mock ? { input: 0, cachedInput: 0, output: 0 } : (priceFor(m) ?? { input: 0, cachedInput: 0, output: 0 }));
  const c = (m, i, o) => costUsd(price(m), { inputTokens: i, outputTokens: o });

  const system = countTokens(SUMMARY_SYSTEM_PROMPT);
  const mapCalls = single || (doc.summaryNotes && !refresh) ? 0 : Math.ceil(total / groupBudget());
  const reduceInput = (single ? total : Math.min(total, mapCalls * OUTPUT_CAPS.summaryMap || countTokens(doc.summaryNotes ?? ''))) + system + 900;
  const needsOutline = OUTLINED.has(mode) && !(doc.outline?.topics?.length && !(refresh && mode === 'detailed'));
  const cap = OUTPUT_CAPS[STEP[mode]];
  const lines = [];
  if (mapCalls) lines.push({ step: `map ×${mapCalls}`, model: cheap.model, worst: mapCalls * c(cheap.model, groupBudget() + system, OUTPUT_CAPS.summaryMap), typical: mapCalls * c(cheap.model, groupBudget() + system, 300) });
  if (needsOutline) lines.push({ step: 'outline', model: cheap.model, worst: c(cheap.model, reduceInput, OUTPUT_CAPS.outline), typical: c(cheap.model, reduceInput, 500) });
  lines.push({ step: `notes (${mode})`, model: main.model, worst: 2 * c(main.model, reduceInput, cap), typical: c(main.model, reduceInput, Math.round(cap * 0.6)) });
  if (OUTLINED.has(mode)) lines.push({ step: 'missing topics (only if needed)', model: main.model, worst: c(main.model, Math.min(total, FILL_CONTEXT_TOKENS) + 600, OUTPUT_CAPS.notesFill), typical: 0 });
  const r = (n) => Math.round(n * 1e6) / 1e6;
  const estimate = {
    documentId: doc.id,
    mode,
    documentTokens: total,
    singleCall: single,
    outlineCached: OUTLINED.has(mode) && !needsOutline,
    lines: lines.map((l) => ({ ...l, worst: r(l.worst), typical: r(l.typical) })),
    typicalUsd: r(lines.reduce((n, l) => n + l.typical, 0)),
    worstUsd: r(lines.reduce((n, l) => n + l.worst, 0)),
    mock,
  };
  log.info('summary estimate', { documentId: doc.id, mode, typicalUsd: estimate.typicalUsd, worstUsd: estimate.worstUsd, documentTokens: total });
  return estimate;
}

