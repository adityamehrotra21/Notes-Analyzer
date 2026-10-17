// Forgot-password one-time codes. 6 digits, emailed, valid OTP_TTL_MINUTES, at most OTP_MAX_ATTEMPTS
// guesses, single use. Only an HMAC of the code is stored (keyed with JWT_SECRET, bound to the user).
import crypto from 'node:crypto';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { passwordResets } from '../db/schema.js';
import { env } from '../config/env.js';
import logger from '../utils/logger.js';

const log = logger.child({ module: 'otp' });

const hmac = (userId, code) => crypto.createHmac('sha256', env.JWT_SECRET).update(`${userId}:${code}`).digest('hex');

/**
 * Create a new code for the user (invalidating older ones).
 * Returns { code } or { cooldown: seconds } when one was sent too recently.
 */
export async function issueCode({ userId, ip }) {
  const [latest] = await db
    .select({ createdAt: passwordResets.createdAt })
    .from(passwordResets)
    .where(eq(passwordResets.userId, userId))
    .orderBy(desc(passwordResets.createdAt))
    .limit(1);
  const since = latest ? (Date.now() - latest.createdAt.getTime()) / 1000 : Infinity;
  if (since < env.OTP_RESEND_SECONDS) return { cooldown: Math.ceil(env.OTP_RESEND_SECONDS - since) };

  // Only the newest code works.
  await db.update(passwordResets).set({ usedAt: new Date() }).where(and(eq(passwordResets.userId, userId), isNull(passwordResets.usedAt)));
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  await db.insert(passwordResets).values({
    userId,
    codeHash: hmac(userId, code),
    expiresAt: new Date(Date.now() + env.OTP_TTL_MINUTES * 60_000),
    ip: ip ?? null,
  });
  log.info('reset code issued');
  return { code };
}

/**
 * Check a code. On success the code is consumed.
 * Returns { ok: true } | { ok: false, reason: 'invalid' | 'expired' | 'locked', attemptsLeft? }
 */
export async function verifyCode({ userId, code }) {
  const [row] = await db
    .select()
    .from(passwordResets)
    .where(and(eq(passwordResets.userId, userId), isNull(passwordResets.usedAt), gt(passwordResets.expiresAt, new Date())))
    .orderBy(desc(passwordResets.createdAt))
    .limit(1);
  if (!row) return { ok: false, reason: 'expired' };
  if (row.attempts >= env.OTP_MAX_ATTEMPTS) return { ok: false, reason: 'locked' };

  const expected = Buffer.from(row.codeHash);
  const given = Buffer.from(hmac(userId, code));
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
    const [u] = await db
      .update(passwordResets)
      .set({ attempts: row.attempts + 1 })
      .where(eq(passwordResets.id, row.id))
      .returning({ attempts: passwordResets.attempts });
    const attemptsLeft = Math.max(0, env.OTP_MAX_ATTEMPTS - u.attempts);
    log.warn('reset code wrong', { attemptsLeft });
    return { ok: false, reason: attemptsLeft ? 'invalid' : 'locked', attemptsLeft };
  }
  // Consume atomically so the same code can't be used twice in parallel.
  const [used] = await db
    .update(passwordResets)
    .set({ usedAt: new Date() })
    .where(and(eq(passwordResets.id, row.id), isNull(passwordResets.usedAt)))
    .returning({ id: passwordResets.id });
  return used ? { ok: true } : { ok: false, reason: 'expired' };
}
