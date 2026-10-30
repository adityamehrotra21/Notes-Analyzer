// Pick the source text for practice questions and quizzes.
//  - with a topic: the most relevant chunks (vector search)
//  - without one:  chunks sampled evenly across each document so coverage is balanced
import { createHash } from 'node:crypto';
import { env } from '../config/env.js';
import { countTokens, fitBudget, truncateToTokens } from '../utils/tokens.js';
import { getDocumentChunks } from './vectorStore.js';
import { retrieve, formatPages } from './ragService.js';

const TOPIC_TOP_K = 14;
const MAX_SOURCE_TOKENS = 1200;

export const normalizeTopic = (t) => (t ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

export function cacheKey(parts) {
  return createHash('sha1').update(JSON.stringify(parts)).digest('hex');
}

function contextBudget(reservedTokens) {
  return Math.max(1000, Math.min(env.GENERATION_CONTEXT_TOKENS, fitBudget(env.LLM_MAX_CONTEXT_TOKENS) - env.LLM_MAX_OUTPUT_TOKENS - reservedTokens));
}

/**
 * Even sampling: each document gets a share of the budget proportional to its length, and its
 * chunks are taken at evenly spaced positions. `jitter` shifts the positions (used for "more").
 */
export function sampleEvenly(chunks, budget, jitter) {
  const byDoc = new Map();
  for (const c of chunks) {
    if (!byDoc.has(c.documentId)) byDoc.set(c.documentId, []);
    byDoc.get(c.documentId).push(c);
  }
  const total = chunks.reduce((n, c) => n + c.tokenCount, 0) || 1;
  const picked = [];
  for (const list of byDoc.values()) {
    const docTokens = list.reduce((n, c) => n + c.tokenCount, 0);
    const avg = docTokens / list.length;
    const m = Math.max(1, Math.min(list.length, Math.floor((budget * docTokens) / total / avg)));
    const offset = jitter ? Math.random() : 0.5;
    const seen = new Set();
    for (let i = 0; i < m; i++) {
      const idx = Math.min(list.length - 1, Math.floor(((i + offset) * list.length) / m));
      if (seen.has(idx)) continue;
      seen.add(idx);
      picked.push({ ...list[idx], position: i / m });
    }
  }
  // If rounding overshot the budget, drop from the end of every document's spread evenly.
  picked.sort((a, b) => a.position - b.position);
  const kept = [];
  let used = 0;
  for (const c of picked) {
    if (used + c.tokenCount > budget && kept.length) continue;
    kept.push(c);
    used += c.tokenCount;
  }
  return kept;
}

/**
 * @param {{ userId, docs: { id, filename }[], topic?: string, reservedTokens: number, jitter?: boolean }} input
 * @returns {Promise<{ tag, documentId, filename, page, pageEnd, pages, text }[]>}
 */
export async function selectSources({ userId, docs, topic, reservedTokens, jitter = false }) {
  const budget = contextBudget(reservedTokens);
  const names = new Map(docs.map((d) => [d.id, d.filename]));
  const documentIds = docs.map((d) => d.id);

  let chosen;
  if (topic?.trim()) {
    const hits = await retrieve({ userId, query: topic, documentIds, k: TOPIC_TOP_K });
    chosen = [];
    let used = 0;
    for (const h of hits) {
      const t = countTokens(h.text);
      if (used + t > budget && chosen.length) break;
      chosen.push({ ...h, tokenCount: t });
      used += t;
    }
  } else {
    chosen = sampleEvenly(await getDocumentChunks({ userId, documentIds }), budget, jitter);
  }

  // Present in reading order: grouped by document, then by position in the document.
  const order = new Map(documentIds.map((id, i) => [id, i]));
  chosen.sort((a, b) => order.get(a.documentId) - order.get(b.documentId) || a.chunkIndex - b.chunkIndex);
  return chosen.map((c, i) => ({
    tag: `S${i + 1}`,
    documentId: c.documentId,
    filename: names.get(c.documentId) ?? c.filename,
    page: c.page,
    pageEnd: c.pageEnd,
    pages: formatPages(c),
    text: truncateToTokens(c.text, MAX_SOURCE_TOKENS),
  }));
}
