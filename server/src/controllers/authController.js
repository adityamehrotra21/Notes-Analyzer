import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { signToken } from '../middleware/auth.js';
import { AppError } from '../utils/AppError.js';
import { setContextUserId } from '../utils/requestContext.js';
import auditService from '../services/auditService.js';
import { createSession, listSessions, revokeAllSessions, revokeSession, rotateRefreshToken } from '../services/sessionService.js';
import { issueCode, verifyCode } from '../services/otpService.js';
import { env } from '../config/env.js';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from '../utils/authCookie.js';
import { escapeHtml, layout, mailConfigured, sendMail } from '../services/mailService.js';
import logger from '../utils/logger.js';

const log = logger.child({ module: 'auth' });

/** a***@example.com: enough to correlate failures without storing full addresses in logs. */
const maskEmail = (e) => e.replace(/^(.)[^@]*/, '$1***');

const SALT_ROUNDS = 12;

// Never return password_hash.
const publicUser = { id: users.id, name: users.name, email: users.email, role: users.role, createdAt: users.createdAt };

/** Start a session: refresh token in an httpOnly cookie, short-lived access token in the body. */
async function startSession(req, res, user) {
  const { sessionId, refreshToken } = await createSession({ userId: user.id, userAgent: req.get('user-agent'), ip: req.ip });
  setRefreshCookie(res, refreshToken);
  return { token: signToken(user.id, sessionId), user };
}

export async function register(req, res) {
  const { name, email, password } = req.body;
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const [user] = await db
    .insert(users)
    .values({ name, email, passwordHash })
    .onConflictDoNothing({ target: users.email })
    .returning(publicUser);
  if (!user) {
    log.warn('registration failed: email taken', { email: maskEmail(email) });
    throw AppError.conflict('An account with this email already exists');
  }
  setContextUserId(user.id);
  await auditService.record({ action: 'create', entity: 'user', entityId: user.id, userId: user.id, after: { name: user.name, email: user.email, role: user.role } });
  log.info('user registered', { email: maskEmail(email) });
  res.status(201).json(await startSession(req, res, user));
}

export async function login(req, res) {
  const { email, password } = req.body;
  const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const ok = row && (await bcrypt.compare(password, row.passwordHash));
  if (!ok) {
    log.warn('login failed', { email: maskEmail(email), reason: row ? 'wrong password' : 'no such user' });
    throw AppError.unauthorized('Invalid email or password');
  }
  setContextUserId(row.id);
  log.info('login succeeded', { email: maskEmail(email) });
  const user = { id: row.id, name: row.name, email: row.email, role: row.role, createdAt: row.createdAt };
  res.json(await startSession(req, res, user));
}

/**
 * POST /api/auth/refresh: refresh cookie -> new access token (+ rotated cookie) and the user.
 * Needs the X-Requested-With header: a plain cross-site form/link can't send it (CSRF guard).
 */
export async function refresh(req, res) {
  res.set('Cache-Control', 'no-store');
  if (!req.get('x-requested-with')) throw AppError.badRequest('Missing X-Requested-With header');
  const token = readRefreshCookie(req);
  if (!token) throw AppError.unauthorized('Not signed in');
  const r = await rotateRefreshToken(token);
  if (!r) {
    clearRefreshCookie(res);
    throw AppError.unauthorized('Your session expired. Please log in again.');
  }
  const [user] = await db.select(publicUser).from(users).where(eq(users.id, r.userId)).limit(1);
  if (!user) {
    clearRefreshCookie(res);
    throw AppError.unauthorized('Account no longer exists');
  }
  setContextUserId(user.id);
  if (r.refreshToken) setRefreshCookie(res, r.refreshToken);
  res.json({ token: signToken(user.id, r.sessionId), user });
}

export async function me(req, res) {
  const [user] = await db.select(publicUser).from(users).where(eq(users.id, req.user.id)).limit(1);
  if (!user) throw AppError.unauthorized('Account no longer exists');
  res.json({ user });
}

// ---------------------------------------------------------------- sessions & password

/** POST /api/auth/logout: end this device's session. */
export async function logout(req, res) {
  await revokeSession({ userId: req.user.id, sessionId: req.user.sessionId, reason: 'logout' });
  clearRefreshCookie(res);
  res.status(204).end();
}

/** GET /api/auth/sessions: active sessions, current one flagged. */
export async function sessionsList(req, res) {
  const rows = await listSessions(req.user.id);
  res.json({ sessions: rows.map((s) => ({ ...s, current: s.id === req.user.sessionId })) });
}

/** DELETE /api/auth/sessions/:id: log out one device. */
export async function sessionRevoke(req, res) {
  const ok = await revokeSession({ userId: req.user.id, sessionId: req.valid.params.id, reason: 'revoked from account page' });
  if (!ok) throw AppError.notFound('Session not found');
  res.status(204).end();
}

/** POST /api/auth/sessions/revoke-others: log out every other device. */
export async function sessionsRevokeOthers(req, res) {
  const revoked = await revokeAllSessions({ userId: req.user.id, keepSessionId: req.user.sessionId, reason: 'log out other devices' });
  res.json({ revoked });
}

/** POST /api/auth/logout-all: log out everywhere, including this device. */
export async function logoutAll(req, res) {
  const revoked = await revokeAllSessions({ userId: req.user.id, reason: 'log out everywhere' });
  clearRefreshCookie(res);
  res.json({ revoked });
}

/** POST /api/auth/change-password: requires the current password; signs out every other device. */
export async function changePassword(req, res) {
  const { currentPassword, newPassword } = req.body;
  const [row] = await db.select().from(users).where(eq(users.id, req.user.id)).limit(1);
  if (!row || !(await bcrypt.compare(currentPassword, row.passwordHash))) {
    log.warn('change password failed: wrong current password');
    throw AppError.badRequest('Your current password is incorrect');
  }
  await db.update(users).set({ passwordHash: await bcrypt.hash(newPassword, SALT_ROUNDS) }).where(eq(users.id, row.id));
  const revoked = await revokeAllSessions({ userId: row.id, keepSessionId: req.user.sessionId, reason: 'password changed' });
  await auditService.record({ action: 'update', entity: 'user', entityId: row.id, before: { password: 'changed' }, after: { passwordChangedAt: new Date().toISOString(), otherSessionsRevoked: revoked } });
  log.info('password changed', { otherSessionsRevoked: revoked });
  passwordChangedNotice(row, `${revoked} other device(s) were signed out`);
  res.json({ ok: true, otherSessionsRevoked: revoked });
}

const appUrl = () => (env.APP_URL || env.CLIENT_ORIGIN.split(',')[0]).replace(/\/$/, '');

/** Security notice (never includes the password). Email failure must not undo the change (already logged). */
function passwordChangedNotice(row, what) {
  const reset = `${appUrl()}/forgot-password`;
  sendMail({
    to: row.email,
    subject: 'Your NotesAnalyser password was changed',
    text: `Hi ${row.name},\n\nThe password for your NotesAnalyser account was just changed, and ${what}.\nIf this wasn't you, reset your password immediately: ${reset}`,
    html: layout({
      title: 'Your password was changed',
      bodyHtml: `<p>Hi ${escapeHtml(row.name)},</p><p>The password for your NotesAnalyser account was just changed, and ${escapeHtml(what)}.</p><p>If this wasn't you, <a href="${escapeHtml(reset)}">reset your password</a> immediately.</p>`,
    }),
  }).catch(() => {});
}

// ---------------------------------------------------------------- forgot password (email OTP)

const GENERIC_SENT = 'If an account exists for that email, we sent a 6-digit code to it.';
// Identical for known, unknown and rate-limited emails, so the response never reveals whether an account exists.
const genericReply = () => ({ ok: true, message: GENERIC_SENT, retryAfter: env.OTP_RESEND_SECONDS, expiresInMinutes: env.OTP_TTL_MINUTES });

/** POST /api/auth/forgot-password: always the same answer, so it can't be used to find accounts. */
export async function forgotPassword(req, res) {
  const { email } = req.body;
  if (env.NODE_ENV === 'production' && !mailConfigured()) throw new AppError(503, "Password reset by email isn't available right now.");
  const [row] = await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.email, email)).limit(1);
  if (!row) {
    log.info('reset requested for unknown email', { email: maskEmail(email) });
    return res.json(genericReply());
  }
  setContextUserId(row.id);
  const r = await issueCode({ userId: row.id, ip: req.ip });
  if (r.cooldown) return res.json(genericReply()); // a code was sent moments ago: don't send another
  const minutes = env.OTP_TTL_MINUTES;
  // Not awaited: answering at the same speed for known and unknown emails avoids leaking which exist.
  sendMail({
    to: row.email,
    subject: `${r.code} is your NotesAnalyser reset code`,
    text: `Hi ${row.name},\n\nYour password reset code is ${r.code}. It expires in ${minutes} minutes.\nIf you didn't ask for this, ignore this email. Your password won't change.`,
    html: layout({
      title: 'Reset your password',
      bodyHtml: `<p>Hi ${escapeHtml(row.name)},</p><p>Your password reset code is:</p>
<p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:8px 0 16px;font-family:ui-monospace,Menlo,monospace">${r.code}</p>
<p>It expires in ${minutes} minutes. If you didn't ask for this, ignore this email. Your password won't change.</p>`,
    }),
  }).catch(() => {}); // already logged
  await auditService.record({ action: 'create', entity: 'password_reset', entityId: row.id, userId: row.id, after: { requested: true } });
  res.json(genericReply());
}

/** POST /api/auth/reset-password: code + new password. Signs out every device. */
export async function resetPassword(req, res) {
  const { email, code, newPassword } = req.body;
  const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const fail = (msg) => {
    throw AppError.badRequest(msg);
  };
  if (!row) fail('That code is invalid or has expired. Request a new one.');
  setContextUserId(row.id);
  const v = await verifyCode({ userId: row.id, code });
  if (!v.ok) {
    if (v.reason === 'locked') fail('Too many wrong attempts. Request a new code.');
    if (v.reason === 'invalid') fail(`That code is incorrect. ${v.attemptsLeft} ${v.attemptsLeft === 1 ? 'attempt' : 'attempts'} left.`);
    fail('That code is invalid or has expired. Request a new one.');
  }
  await db.update(users).set({ passwordHash: await bcrypt.hash(newPassword, SALT_ROUNDS) }).where(eq(users.id, row.id));
  const revoked = await revokeAllSessions({ userId: row.id, reason: 'password reset' });
  await auditService.record({ action: 'update', entity: 'user', entityId: row.id, userId: row.id, before: { password: 'reset' }, after: { passwordResetAt: new Date().toISOString(), sessionsRevoked: revoked } });
  log.info('password reset with code', { sessionsRevoked: revoked });
  passwordChangedNotice(row, 'all devices were signed out');
  clearRefreshCookie(res);
  res.json({ ok: true });
}
