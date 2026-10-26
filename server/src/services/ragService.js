// Retrieval-augmented answers: retrieve -> fit sources + history into the token budget -> generate.
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { countTokens, fitBudget, truncateToTokens } from '../utils/tokens.js';
import { inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { documents as documentsTable } from '../db/schema.js';
import { CHAT_SYSTEM_PROMPT, buildChatUserMessage, buildDocumentWideMessage } from '../../prompts/chat.js';
import { embedQuery } from './embeddingService.js';
import { getDocumentChunks, searchChunks } from './vectorStore.js';
import { classifyIntent } from './intentService.js';
import { sampleEvenly } from './generationContext.js';
import { streamText, OUTPUT_CAPS } from './llmService.js';
import logger from '../utils/logger.js';

const log = logger.child({ module: 'rag' });

export const DEFAULT_TOP_K = env.CHAT_TOP_K;
const MAX_HISTORY_TOKENS = 1500; // and at most CHAT_HISTORY_TURNS exchanges
const MAX_SOURCE_TOKENS = 1200; // per source, guards against unusually large chunks

export async function retrieve({ userId, query, documentIds, k = DEFAULT_TOP_K }) {
  const t0 = Date.now();
  const embedding = await embedQuery(query);
  const tEmbed = Date.now() - t0;
  const results = await searchChunks({ userId, embedding, documentIds, k });
  log.info('retrieval', {
    k,
    results: results.length,
    topScore: results[0] ? Math.round(results[0].score * 1000) / 1000 : null,
    documents: documentIds?.length ?? 'all',
    embedMs: tEmbed,
    durationMs: Date.now() - t0,
  });
  return results;
}

export const formatPages = (s) => (s.pageEnd && s.pageEnd !== s.page ? `pp. ${s.page}–${s.pageEnd}` : `p. ${s.page}`);

/**
 * Follow-ups like "why?" retrieve poorly on their own, so include the previous user question.
 * (Cheaper than an extra LLM call to rewrite the query, which matters on the free tier.)
 */
function retrievalQuery(question, history) {
  const prevUser = [...history].reverse().find((m) => m.role === 'user');
  return prevUser && question.length < 200 ? `${prevUser.content.slice(0, 500)}\n${question}` : question;
}

/**
 * Fit system + sources + history + question into the model's context window (with safety margin).
 * mode 'retrieval' (default): top-k chunks within CHAT_CONTEXT_TOKENS.
 * mode 'document': whole-document sources within CHAT_FULLDOC_TOKENS (+ optional overview).
 */
export function buildChatPrompt({ question, chunks, history, mode = 'retrieval', overview = null }) {
  const documentMode = mode !== 'retrieval';
  const sourceCap = documentMode ? env.CHAT_FULLDOC_TOKENS : env.CHAT_CONTEXT_TOKENS;
  const build = (sources) => (documentMode ? buildDocumentWideMessage({ question, sources, overview }) : buildChatUserMessage({ question, sources }));
  const budget = Math.min(
    fitBudget(env.LLM_MAX_CONTEXT_TOKENS) - OUTPUT_CAPS[documentMode ? 'chatLong' : 'chat'],
    sourceCap + countTokens(CHAT_SYSTEM_PROMPT) + MAX_HISTORY_TOKENS + 400 + countTokens(overview ?? ''),
  );
  let remaining = budget - countTokens(CHAT_SYSTEM_PROMPT) - countTokens(build([])) - 50;
  if (remaining <= 0) throw new AppError(500, 'LLM_MAX_CONTEXT_TOKENS is too small for the prompt. Increase it or lower LLM_MAX_OUTPUT_TOKENS.');

  // Sources first (in rank order): they matter more than old conversation. Capped at CHAT_CONTEXT_TOKENS.
  const sources = [];
  let sourceBudget = Math.min(remaining, sourceCap);
  for (const c of chunks) {
    const text = truncateToTokens(c.text, MAX_SOURCE_TOKENS);
    const cost = countTokens(text) + 20;
    if (cost > sourceBudget) break;
    sourceBudget -= cost;
    remaining -= cost;
    sources.push({ ...c, tag: `S${sources.length + 1}`, pages: formatPages(c), text });
  }

  // Then as much recent history as fits.
  let historyBudget = Math.min(remaining, MAX_HISTORY_TOKENS);
  const kept = [];
  for (const m of history.slice(-env.CHAT_HISTORY_TURNS * 2).reverse()) {
    const cost = countTokens(m.content) + 4;
    if (cost > historyBudget) break;
    historyBudget -= cost;
    kept.unshift(m);
  }
  // Providers expect the conversation to start with a user turn.
  while (kept[0]?.role === 'assistant') kept.shift();

  const messages = [...kept, { role: 'user', content: build(sources) }];
  return { system: CHAT_SYSTEM_PROMPT, messages, sources };
}

/** Sources the answer actually cites, in order of first citation. */
export function extractCitations(answer, sources) {
  const byTag = new Map(sources.map((s) => [s.tag, s]));
  const seen = new Set();
  const out = [];
  for (const [, n] of answer.matchAll(/\[S(\d+)\]/g)) {
    const s = byTag.get(`S${n}`);
    if (!s || seen.has(s.tag)) continue;
    seen.add(s.tag);
    out.push(publicSource(s));
  }
  return out;
}

export const publicSource = (s) => ({
  tag: s.tag,
  documentId: s.documentId,
  filename: s.filename,
  page: s.page,
  pageEnd: s.pageEnd,
  score: Number.isFinite(s.score) ? Math.round(s.score * 1000) / 1000 : null, // null = whole-document mode (no ranking)
  snippet: s.text.replace(/\s+/g, ' ').slice(0, 280),
});

/**
 * Sources for a whole-document request.
 *  - fits in CHAT_FULLDOC_TOKENS -> every chunk, in reading order ('full')
 *  - larger -> saved detailed summary as an overview + top-k for the question + an even sample ('overview' / 'sampled')
 */
async function documentWideSources({ userId, question, history, docs }) {
  const names = new Map(docs.map((d) => [d.id, d.filename]));
  const documentIds = docs.map((d) => d.id);
  const all = (await getDocumentChunks({ userId, documentIds })).map((c) => ({ ...c, filename: names.get(c.documentId) }));
  const total = all.reduce((n, c) => n + c.tokenCount, 0);
  if (total <= env.CHAT_FULLDOC_TOKENS) return { mode: 'full', chunks: all, overview: null, totalTokens: total };

  const saved = await db
    .select({ filename: documentsTable.filename, summary: documentsTable.summaryDetailed })
    .from(documentsTable)
    .where(inArray(documentsTable.id, documentIds));
  const overviewText = saved.filter((d) => d.summary).map((d) => `### ${d.filename}\n${d.summary}`).join('\n\n');
  const overview = overviewText ? truncateToTokens(overviewText, 6000) : null;
  const top = await retrieve({ userId, query: retrievalQuery(question, history), documentIds });
  const topIds = new Set(top.map((c) => c.id));
  const rest = sampleEvenly(all.filter((c) => !topIds.has(c.id)), env.CHAT_FULLDOC_TOKENS - countTokens(overview ?? '') - top.reduce((n, c) => n + countTokens(c.text), 0), false);
  const order = new Map(documentIds.map((id, i) => [id, i]));
  const chunks = [...top, ...rest].sort((a, b) => order.get(a.documentId) - order.get(b.documentId) || a.chunkIndex - b.chunkIndex);
  return { mode: overview ? 'overview' : 'sampled', chunks, overview, totalTokens: total };
}

/**
 * Start a streamed RAG answer. Throws (before any output) on retrieval/LLM start errors.
 * docs: [{ id, filename }] the (ready) documents in scope.
 * @returns {{ sources, meta, events: AsyncIterable }} events: { type: 'text', text } | { type: 'finish', finishReason }
 */
export async function startChatAnswer({ userId, question, documentIds, docs, history = [], signal }) {
  const { intent, method } = await classifyIntent({ question, history });
  let chunks;
  let mode = 'retrieval';
  let overview = null;
  if (intent === 'document' && docs?.length) {
    const wide = await documentWideSources({ userId, question, history, docs });
    ({ chunks, mode, overview } = wide);
    log.info('document-wide chat', { mode, chunks: chunks.length, documentTokens: wide.totalTokens, overview: Boolean(overview) });
  } else {
    chunks = await retrieve({ userId, query: retrievalQuery(question, history), documentIds });
  }
  const { system, messages, sources } = buildChatPrompt({ question, chunks, history, mode, overview });
  const meta = { intent, intentMethod: method, mode, sources: sources.length };

  // No matching passages is not a dead end for a doubt: the tutor still explains (labelled as beyond the notes).
  const step = mode === 'retrieval' ? 'chat' : 'chatLong';
  const events = await streamText({ step, system, messages, signal, label: mode === 'retrieval' ? 'chat answer' : `chat answer (document-wide, ${mode})` });
  return { sources, meta, events };
}
