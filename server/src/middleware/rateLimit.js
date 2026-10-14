import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import logger from '../utils/logger.js';

const log = logger.child({ module: 'ratelimit' });

// Log every rate-limit hit, then send the limiter's JSON message.
const limited = (name) => (req, res, next, options) => {
  log.warn('rate limit hit', { limiter: name, path: req.originalUrl.split('?')[0], limit: options.limit });
  res.status(options.statusCode).json(options.message);
};
const common = { standardHeaders: 'draft-8', legacyHeaders: false };

// Brute-force protection for login/register.
export const authLimiter = rateLimit({
  ...common,
  handler: limited('auth'),
  windowMs: 15 * 60 * 1000,
  limit: 30,
  message: { error: { message: 'Too many auth attempts, try again in a few minutes' } },
});

// Reset-code emails per address (on top of authLimiter per IP), so nobody can flood someone's inbox.
export const otpEmailLimiter = rateLimit({
  ...common,
  handler: limited('otp-email'),
  windowMs: 60 * 60 * 1000,
  limit: 5,
  keyGenerator: (req) => `otp:${req.body?.email ?? ipKeyGenerator(req.ip)}`,
  message: { error: { message: 'Too many reset codes requested for this email. Try again in an hour.' } },
});

// Applied to every route that calls the LLM (phase 3+). Keyed per user when authenticated.
export const llmLimiter = rateLimit({
  ...common,
  handler: limited('llm'),
  windowMs: 60 * 1000,
  limit: 20, // the LLM queue paces real API calls; this just stops runaway clients
  keyGenerator: (req, res) => req.user?.id ?? ipKeyGenerator(req.ip),
  message: { error: { message: 'Too many AI requests, slow down a little' } },
});

// Uploads trigger embedding calls; cap them per user.
export const uploadLimiter = rateLimit({
  ...common,
  handler: limited('upload'),
  windowMs: 15 * 60 * 1000,
  limit: 20,
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip),
  message: { error: { message: 'Too many uploads, try again in a few minutes' } },
});

// Exports render PDFs in a headless browser (CPU-heavy) and can send email.
export const exportLimiter = rateLimit({
  ...common,
  handler: limited('export'),
  windowMs: 10 * 60 * 1000,
  limit: 30,
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip),
  message: { error: { message: 'Too many exports, please wait a few minutes' } },
});
