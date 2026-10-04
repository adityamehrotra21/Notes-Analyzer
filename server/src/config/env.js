import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';
import logger from '../utils/logger.js';

// Load server/.env regardless of the current working directory.
dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });

const optionalInt = (def) => z.coerce.number().int().positive().default(def);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(5001),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
  // Behind a reverse proxy / PaaS (Render, Railway, Nginx...), set to the number of proxy hops (usually 1)
  // so rate limits see the real client IP.
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  // DB_SSL / DB_SSL_CA / DB_POOL_MAX are read in db/pgConfig.js (shared with the scripts).
  DB_SSL: z.enum(['auto', 'off', 'require', 'verify']).default('auto'),
  DB_POOL_MAX: optionalInt(5),
  // Serve client/dist from Express (single-origin local/docker run). Off when the client is on Vercel.
  SERVE_CLIENT: z.stringbool().default(false),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  // Access token (Bearer, kept in memory by the client) — short-lived; the refresh cookie renews it.
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_DAYS: optionalInt(30), // sliding: every refresh extends it
  // Refresh cookie. 'lax' when the client is served from the same site (dev proxy, Vercel rewrite);
  // 'none' only when the browser calls the API on another site directly (then Secure is forced).
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  COOKIE_SECURE: z.stringbool().optional(), // default: true in production or with SameSite=none
  EMBED_DIMENSIONS: optionalInt(1536),
  // Uploaded PDFs are kept here so documents can be re-indexed. Relative paths resolve from server/.
  STORAGE_DIR: z.string().default('storage'),

  // ---- Logging
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  LOG_RETENTION_DAYS: optionalInt(14),

  // ---- Email. EMAIL_PROVIDER: brevo | resend (HTTPS APIs: work on hosts that block SMTP, e.g. Render free)
  //      | smtp (Gmail: SMTP_HOST=smtp.gmail.com, SMTP_PORT=465, SMTP_USER=you@gmail.com, SMTP_PASS=<App Password>)
  //      | console (log instead of sending). Default: smtp if SMTP_HOST is set, else console.
  EMAIL_PROVIDER: z.enum(['brevo', 'resend', 'smtp', 'console']).optional(),
  BREVO_API_KEY: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  SMTP_SECURE: z.stringbool().optional(), // default: true for port 465, STARTTLS otherwise
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().optional(), // "NotesAnalyser <you@yourdomain.com>" — must be a verified sender for brevo/resend
  APP_URL: z.string().optional(), // link used in emails (defaults to CLIENT_ORIGIN)

  // ---- Sessions
  MAX_SESSIONS_PER_USER: optionalInt(5),

  // ---- Forgot password (emailed one-time code)
  OTP_TTL_MINUTES: optionalInt(10),
  OTP_MAX_ATTEMPTS: optionalInt(5),
  OTP_RESEND_SECONDS: optionalInt(60),

  // ---- LLM providers. Swap by env only:
  //   openai  -> OPENAI_API_KEY + OPENAI_CHAT_MODEL (+ OPENAI_CHEAP_MODEL); any OpenAI-compatible API via OPENAI_BASE_URL
  //   gemini  -> GEMINI_API_KEY + GEMINI_CHAT_MODEL
  //   mock    -> offline canned answers for UI testing (spends nothing)
  LLM_PROVIDER: z.enum(['gemini', 'openai', 'mock']).default('openai'),
  // LLM_MOCK=true forces LLM_PROVIDER=mock and EMBED_PROVIDER=hash: test UI flows without spending anything.
  LLM_MOCK: z.stringbool().default(false),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.url().optional(),
  OPENAI_CHAT_MODEL: z.string().optional(), // chat answers, quiz/questions, final summary
  OPENAI_CHEAP_MODEL: z.string().optional(), // summary map step and other bulk/intermediate calls
  OPENAI_EMBED_MODEL: z.string().optional(),
  // Reasoning models bill reasoning tokens as output; keep effort minimal.
  // Reasoning effort for OPENAI_CHAT_MODEL (gpt-5-mini) and OPENAI_CHEAP_MODEL (gpt-5-nano).
  OPENAI_REASONING_EFFORT: z.enum(['none', 'minimal', 'low', 'medium', 'high']).default('low'),
  OPENAI_REASONING_EFFORT_CHEAP: z.enum(['none', 'minimal', 'low', 'medium', 'high']).default('minimal'),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_CHAT_MODEL: z.string().optional(),
  GEMINI_EMBED_MODEL: z.string().optional(),
  // Unset = model default. 0 disables thinking on models that allow it (faster, fewer tokens).
  GEMINI_THINKING_BUDGET: z.coerce.number().int().min(-1).optional(),
  LLM_MAX_CONTEXT_TOKENS: optionalInt(400_000),
  LLM_MAX_OUTPUT_TOKENS: optionalInt(2000), // fallback cap when a call has no feature cap

  // ---- Budget (OpenAI): hard stop before spending more than this, warning at BUDGET_WARN_PCT.
  LLM_BUDGET_USD: z.coerce.number().positive().default(1.2),
  BUDGET_WARN_PCT: z.coerce.number().min(1).max(100).default(75),

  // ---- Output caps per feature (tokens)
  // Reasoning tokens count toward these caps, so they leave room for reasoning + the visible answer.
  MAX_OUTPUT_TOKENS_CHAT: optionalInt(2000),
  MAX_OUTPUT_TOKENS_QUESTIONS: optionalInt(4000),
  MAX_OUTPUT_TOKENS_QUIZ: optionalInt(4000),
  MAX_OUTPUT_TOKENS_SUMMARY_MAP: optionalInt(1500),
  MAX_OUTPUT_TOKENS_SUMMARY_REDUCE: optionalInt(4000), // Brief, Bullets, Exam Revision
  MAX_OUTPUT_TOKENS_CHAT_LONG: optionalInt(2000), // whole-document chat answers
  MAX_OUTPUT_TOKENS_NOTES: optionalInt(12000), // Detailed Notes
  MAX_OUTPUT_TOKENS_NOTES_FILL: optionalInt(4000), // sections for topics the coverage check found missing
  MAX_OUTPUT_TOKENS_OUTLINE: optionalInt(2000), // topic outline extraction (gpt-5-nano)
  MAX_OUTPUT_TOKENS_CLASSIFY: optionalInt(200), // intent fallback classifier (gpt-5-nano)

  // ---- Embeddings. "hash" is an offline lexical embedder for testing (not for real use).
  EMBED_PROVIDER: z.enum(['openai', 'gemini', 'hash']).default('openai'),
  EMBED_BATCH_SIZE: z.coerce.number().int().min(1).max(2048).default(256), // Gemini is capped at 100 internally
  EMBED_RPM: optionalInt(500),
  EMBED_TPM: optionalInt(900_000),

  // ---- Pacing for chat/generation calls
  LLM_RPM: optionalInt(60),
  LLM_TPM: optionalInt(200_000),
  LLM_CONCURRENCY: optionalInt(2),

  // ---- Context sizes (cost control)
  CHAT_TOP_K: optionalInt(5),
  CHAT_HISTORY_TURNS: optionalInt(4), // user+assistant exchanges kept
  CHAT_CONTEXT_TOKENS: optionalInt(6000), // retrieved source text per chat answer
  CHAT_FULLDOC_TOKENS: optionalInt(30000), // document-wide questions: send the whole document if it fits
  SUMMARY_SINGLE_CALL_TOKENS: optionalInt(60000), // documents up to this size are summarised in ONE call
  SUMMARY_GROUP_TOKENS: optionalInt(8000), // document text per map call (only for larger documents)
  GENERATION_CONTEXT_TOKENS: optionalInt(8000), // source text per questions/quiz call
});

// Treat empty values ("KEY=") as unset so defaults apply.
const raw = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ''));
const parsed = schema.safeParse(raw);
if (!parsed.success) {
  const log = logger.child({ module: 'config' });
  log.error('Invalid environment configuration (server/.env)', {
    issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
  });
  process.exit(1);
}

const data = parsed.data;
const serverDir = fileURLToPath(new URL('../../', import.meta.url));
data.STORAGE_DIR = path.resolve(serverDir, data.STORAGE_DIR);
if (data.LLM_MOCK) {
  data.LLM_PROVIDER = 'mock';
  data.EMBED_PROVIDER = 'hash';
}

logger.configure({ level: data.LOG_LEVEL, json: data.NODE_ENV === 'production' });

export const env = Object.freeze(data);
