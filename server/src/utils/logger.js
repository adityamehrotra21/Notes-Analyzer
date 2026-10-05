// The one logger for the whole server (singleton). Use it everywhere instead of console.*:
//
//   import logger from '../utils/logger.js';
//   const log = logger.child({ module: 'ingestion' });
//   log.info('document ready', { documentId, chunks: 12, durationMs: 840 });
//
// Every entry: timestamp, level, module, message, requestId, userId, meta, durationMs.
// requestId/userId come from the request context automatically.
// Sinks: console (pretty in dev, JSON lines in prod), batched async inserts into app_logs
// (attached at startup), and an in-process live tail for the admin log stream.
// Secrets (API keys, passwords, JWTs, Authorization headers) are redacted before any sink.
import { EventEmitter } from 'node:events';
import { getContext } from './requestContext.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const COLORS = { debug: '\x1b[90m', info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m' };
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';

const FLUSH_MS = 2000;
const FLUSH_SIZE = 50;
const MAX_BUFFER = 5000; // drop oldest beyond this if the DB is unreachable
const TAIL_SIZE = 200; // recent entries replayed to new live-tail subscribers

// ---------------------------------------------------------------- redaction
// Key names whose values are secrets. Deliberately anchored so counters like "inputTokens" or
// "maxOutputTokens" are NOT redacted, while "token", "accessToken", "OPENAI_API_KEY", "passwordHash" are.
const SECRET_KEY =
  /^(?:.*[_-])?(?:pass(?:word)?|passwd|secret|client_?secret|api_?key|apikey|authorization|cookie|set-cookie|credentials?|password_?hash|jwt|(?:access|refresh|id|auth|bearer|session)?_?token)$/i;
const SECRET_PATTERNS = [
  [/\bsk-[A-Za-z0-9_-]{16,}/g, 'sk-[REDACTED]'], // OpenAI-style keys
  [/\bAIza[0-9A-Za-z_-]{20,}/g, 'AIza[REDACTED]'], // Google API keys
  [/\bgsk_[A-Za-z0-9]{20,}/g, 'gsk_[REDACTED]'], // Groq keys
  [/\beyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]{5,}/g, '[REDACTED_JWT]'],
  [/\b(Bearer|Basic)\s+[\w.~+/=[\]-]+/gi, '$1 [REDACTED]'],
  [/([?&](?:key|api_key|token)=)[^&\s]+/gi, '$1[REDACTED]'],
];

function redactString(s) {
  let out = s.length > 4000 ? `${s.slice(0, 4000)}… (${s.length} chars)` : s;
  for (const [re, rep] of SECRET_PATTERNS) out = out.replace(re, rep);
  return out;
}

function serializeError(err) {
  return {
    name: err.name,
    message: redactString(String(err.message ?? '')),
    ...(err.status ? { status: err.status } : {}),
    ...(err.code ? { code: err.code } : {}),
    ...(err.stack ? { stack: redactString(err.stack) } : {}),
    ...(err.cause ? { cause: err.cause instanceof Error ? serializeError(err.cause) : String(err.cause) } : {}),
  };
}

export function redact(value, depth = 0) {
  if (value == null) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value !== 'object') return value;
  if (value instanceof Error) return serializeError(value);
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `[Buffer ${value.length} bytes]`;
  if (depth > 6) return '[Truncated]';
  if (Array.isArray(value)) {
    const items = value.slice(0, 50).map((v) => redact(v, depth + 1));
    return value.length > 50 ? [...items, `… ${value.length - 50} more`] : items;
  }
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEY.test(k) ? '[REDACTED]' : redact(v, depth + 1);
  return out;
}

// ---------------------------------------------------------------- logger
class Logger {
  static #instance;

  #level = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;
  #json = process.env.NODE_ENV === 'production';
  #buffer = [];
  #timer = null;
  #flushing = false;
  #dbWriter = null; // async (entries[]) => void, attached once the DB is up
  #dbDownUntil = 0;
  #tail = [];
  #emitter = new EventEmitter();

  static getInstance() {
    Logger.#instance ??= new Logger();
    return Logger.#instance;
  }

  constructor() {
    if (Logger.#instance) throw new Error('Logger is a singleton: use Logger.getInstance() or the default export');
    this.#emitter.setMaxListeners(100);
  }

  /** Called once env is validated. */
  configure({ level, json } = {}) {
    if (level && LEVELS[level]) this.#level = LEVELS[level];
    if (json !== undefined) this.#json = json;
  }

  /** Start persisting entries to app_logs. writer receives an array of rows. */
  attachDbSink(writer) {
    this.#dbWriter = writer;
  }

  /** Flush pending DB writes (on shutdown). */
  async flush() {
    clearTimeout(this.#timer);
    this.#timer = null;
    while (this.#buffer.length && this.#dbWriter && !this.#flushing) await this.#flushOnce();
  }

  /** Live tail: calls fn(entry) for each new entry. Returns an unsubscribe function. */
  subscribe(fn) {
    this.#emitter.on('entry', fn);
    return () => this.#emitter.off('entry', fn);
  }

  recent() {
    return [...this.#tail];
  }

  child({ module }) {
    const bound = (level) => (message, meta) => this.#log(level, module, message, meta);
    return { debug: bound('debug'), info: bound('info'), warn: bound('warn'), error: bound('error'), child: (o) => this.child(o) };
  }

  debug(message, meta) {
    this.#log('debug', 'app', message, meta);
  }
  info(message, meta) {
    this.#log('info', 'app', message, meta);
  }
  warn(message, meta) {
    this.#log('warn', 'app', message, meta);
  }
  error(message, meta) {
    this.#log('error', 'app', message, meta);
  }

  #log(level, module, message, meta) {
    if (LEVELS[level] < this.#level) return;
    const ctx = getContext();
    let durationMs = null;
    let m = meta;
    if (m instanceof Error) m = { err: m };
    if (m && typeof m === 'object' && 'durationMs' in m) {
      ({ durationMs, ...m } = m);
    }
    const entry = {
      timestamp: new Date(),
      level,
      module: module ?? 'app',
      message: redactString(String(message)),
      requestId: ctx.requestId ?? null,
      userId: ctx.userId ?? null,
      meta: m && Object.keys(m).length ? redact(m) : null,
      durationMs: Number.isFinite(durationMs) ? Math.round(durationMs) : null,
    };
    this.#toConsole(entry);
    this.#tail.push(entry);
    if (this.#tail.length > TAIL_SIZE) this.#tail.shift();
    this.#emitter.emit('entry', entry);
    this.#enqueue(entry);
  }

  #toConsole(e) {
    const stream = e.level === 'error' || e.level === 'warn' ? process.stderr : process.stdout;
    if (this.#json) {
      stream.write(`${JSON.stringify({ ...e, timestamp: e.timestamp.toISOString() })}\n`);
      return;
    }
    const time = e.timestamp.toISOString().slice(11, 23);
    const lvl = `${COLORS[e.level]}${e.level.toUpperCase().padEnd(5)}${RESET}`;
    const dur = e.durationMs !== null ? ` ${DIM}(${e.durationMs}ms)${RESET}` : '';
    const req = e.requestId ? ` ${DIM}req=${e.requestId.slice(0, 8)}${RESET}` : '';
    const { err, ...rest } = e.meta ?? {};
    const metaStr = Object.keys(rest).length ? ` ${DIM}${JSON.stringify(rest)}${RESET}` : '';
    stream.write(`${DIM}${time}${RESET} ${lvl} ${DIM}[${e.module}]${RESET} ${e.message}${metaStr}${dur}${req}\n`);
    if (err?.stack) stream.write(`${DIM}${err.stack}${RESET}\n`);
  }

  #enqueue(entry) {
    if (!this.#dbWriter) return;
    this.#buffer.push(entry);
    if (this.#buffer.length > MAX_BUFFER) this.#buffer.splice(0, this.#buffer.length - MAX_BUFFER);
    if (this.#buffer.length >= FLUSH_SIZE) queueMicrotask(() => this.#flushOnce());
    else this.#timer ??= setTimeout(() => {
      this.#timer = null;
      this.#flushOnce();
    }, FLUSH_MS).unref();
  }

  async #flushOnce() {
    if (this.#flushing || !this.#buffer.length || !this.#dbWriter) return;
    if (Date.now() < this.#dbDownUntil) return; // DB recently failed: console only for now
    this.#flushing = true;
    const batch = this.#buffer.splice(0, FLUSH_SIZE * 4);
    try {
      await this.#dbWriter(batch);
    } catch (err) {
      // Never log through ourselves here (that would recurse into the failing sink).
      this.#dbDownUntil = Date.now() + 30_000;
      process.stderr.write(`[logger] app_logs write failed (${err.message}); console-only for 30s, ${batch.length} entries not persisted\n`);
    } finally {
      this.#flushing = false;
      if (this.#buffer.length) this.#timer ??= setTimeout(() => {
        this.#timer = null;
        this.#flushOnce();
      }, FLUSH_MS).unref();
    }
  }
}

const logger = Logger.getInstance();
export { Logger, LEVELS };
export default logger;
