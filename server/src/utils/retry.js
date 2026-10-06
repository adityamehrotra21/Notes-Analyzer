// Exponential backoff with jitter for transient provider errors (429, 5xx, network).
import logger from './logger.js';

const log = logger.child({ module: 'retry' });

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const RETRYABLE_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT']);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function errorStatus(err) {
  return err?.status ?? err?.response?.status ?? err?.cause?.status;
}

/** A daily quota (RPD) won't recover within our retry window, so don't wait on it. */
export function isDailyQuotaError(err) {
  return errorStatus(err) === 429 && /per\s?day|PerDay|daily/i.test(err?.message ?? '');
}

/** OpenAI "insufficient_quota": the account is out of credit. Retrying only wastes time. */
export function isOutOfCreditError(err) {
  return err?.code === 'insufficient_quota' || err?.error?.code === 'insufficient_quota' || /insufficient_quota|exceeded your current quota/i.test(err?.message ?? '');
}

export function isRetryable(err) {
  if (isDailyQuotaError(err) || isOutOfCreditError(err)) return false;
  const status = errorStatus(err);
  if (status) return RETRYABLE_STATUS.has(status);
  const code = err?.code ?? err?.cause?.code;
  return RETRYABLE_CODES.has(code) || err?.message === 'fetch failed';
}

// Gemini puts a hint like "retryDelay":"37s" in 429 error bodies; OpenAI-compatible APIs send Retry-After.
function retryHintMs(err) {
  const m = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(err?.message ?? '');
  if (m) return Math.ceil(parseFloat(m[1]) * 1000);
  const h = err?.headers?.['retry-after'] ?? err?.headers?.get?.('retry-after');
  return h && !Number.isNaN(Number(h)) ? Number(h) * 1000 : 0;
}

export async function withRetry(fn, { retries = 5, baseMs = 2000, maxMs = 60_000, label = 'request' } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= retries || !isRetryable(err)) throw err;
      const backoff = Math.min(maxMs, baseMs * 2 ** attempt);
      const delay = Math.round(Math.min(maxMs, Math.max(retryHintMs(err), backoff)) * (0.8 + Math.random() * 0.4));
      log.warn(`${label} failed, retrying`, { reason: errorStatus(err) ?? err.code ?? err.message, attempt: attempt + 1, of: retries, delayMs: delay });
      await sleep(delay);
    }
  }
}
