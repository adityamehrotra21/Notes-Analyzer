// Batched, paced, retried, budgeted embeddings. Provider is chosen by EMBED_PROVIDER.
import { env } from '../config/env.js';
import { RateQueue } from '../utils/rateQueue.js';
import { withRetry } from '../utils/retry.js';
import { countTokens } from '../utils/tokens.js';
import logger from '../utils/logger.js';
import budgetService from './budgetService.js';
import { toAppError } from './llmService.js';
import { geminiEmbeddings } from './providers/gemini.js';
import { hashEmbeddings } from './providers/hashEmbeddings.js';
import { openaiEmbeddings } from './providers/openaiEmbeddings.js';

const log = logger.child({ module: 'embedding' });
const providers = { openai: openaiEmbeddings, gemini: geminiEmbeddings, hash: hashEmbeddings };
const provider = () => providers[env.EMBED_PROVIDER];

// One queue for every embedding call in the process, so concurrent uploads can't burst the API.
const queue = new RateQueue({ name: 'embed', concurrency: 1, rpm: env.EMBED_RPM, tpm: env.EMBED_TPM });

function normalize(v) {
  if (v.length !== env.EMBED_DIMENSIONS) {
    throw new Error(`Embedding has ${v.length} dimensions but EMBED_DIMENSIONS=${env.EMBED_DIMENSIONS}`);
  }
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}

async function embedBatch(texts, taskType, { tokens, priority = false } = {}) {
  const p = provider();
  if (p.local) return (await p.embed(texts, { taskType })).vectors.map(normalize);

  const model = p.model();
  const reservation = p.priced ? budgetService.reserve({ model, inputTokens: tokens, maxOutputTokens: 0, feature: 'embedding' }) : null;
  const t0 = Date.now();
  let res;
  try {
    res = await withRetry(() => queue.add(() => p.embed(texts, { taskType }), { weight: tokens, priority }), {
      label: `embed ${texts.length} text(s)`,
    });
  } catch (err) {
    budgetService.release(reservation);
    throw toAppError(err);
  }
  const usage = res.usage ?? { inputTokens: tokens, cachedTokens: 0, outputTokens: 0 };
  const cost = reservation ? await budgetService.settle(reservation, usage, { estimated: !res.usage }) : null;
  log.debug('embedding call', {
    model,
    texts: texts.length,
    inputTokens: usage.inputTokens,
    costUsd: cost === null ? undefined : Math.round(cost * 1e8) / 1e8,
    durationMs: Date.now() - t0,
  });
  return res.vectors.map(normalize);
}

/** Split texts into batches bounded by the provider's limits, EMBED_BATCH_SIZE and the TPM budget. */
function makeBatches(texts) {
  const p = provider();
  const maxItems = Math.min(env.EMBED_BATCH_SIZE, p.maxBatch ?? env.EMBED_BATCH_SIZE);
  const maxTokens = Math.min(Math.floor(env.EMBED_TPM * 0.9), p.maxBatchTokens ?? Infinity);
  const batches = [];
  let cur = { texts: [], tokens: 0 };
  for (const text of texts) {
    const t = countTokens(text);
    if (cur.texts.length && (cur.texts.length >= maxItems || cur.tokens + t > maxTokens)) {
      batches.push(cur);
      cur = { texts: [], tokens: 0 };
    }
    cur.texts.push(text);
    cur.tokens += t;
  }
  if (cur.texts.length) batches.push(cur);
  return batches;
}

/** Embed document chunks. onProgress(done, total) is called after each batch. */
export async function embedDocuments(texts, { onProgress } = {}) {
  const out = [];
  for (const batch of makeBatches(texts)) {
    out.push(...(await embedBatch(batch.texts, 'RETRIEVAL_DOCUMENT', { tokens: batch.tokens })));
    onProgress?.(out.length, texts.length);
  }
  return out;
}

/** Embed a user query. Jumps ahead of background ingestion in the queue. */
export async function embedQuery(text) {
  const [v] = await embedBatch([text], 'RETRIEVAL_QUERY', { tokens: countTokens(text), priority: true });
  return v;
}

export const embeddingQueueStats = () => ({ pending: queue.pending, running: queue.running });
