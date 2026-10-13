// Login sessions (one per device/browser). Access tokens carry the session id (sid); every request
// checks the session is still active, so "log out this device / all devices" takes effect immediately.
// Each session also owns one refresh token ("<sessionId>.<secret>", httpOnly cookie). Only its SHA-256
// is stored; it is rotated on every use, and reusing an old one revokes the session (likely theft).
import crypto from 'node:crypto';
import { and, desc, eq, isNull, ne } from 'drizzle-orm';
import { db } from '../db/index.js';
import { sessions } from '../db/schema.js';
import { env } from '../config/env.js';
import logger from '../utils/logger.js';
import auditService from './auditService.js';

const log = logger.child({ module: 'auth' });
const CACHE_MS = 30_000; // how long an "active" answer is trusted without hitting the DB
const TOUCH_MS = 60_000; // last_seen_at is written at most once a minute per session
const cache = new Map(); // sid -> { userId, until }
const REUSE_GRACE_MS = 60_000; // two tabs refreshing at the same moment both present the same token

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const newSecret = () => crypto.randomBytes(32).toString('base64url');
const refreshExpiry = () => new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 86_400_000);
const safeEqual = (a, b) => Boolean(a && b) && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const touched = new Map(); // sid -> last write time

/** New session + its first refresh token. Returns { sessionId, refreshToken }. */
export async function createSession({ userId, userAgent, ip }) {
  const secret = newSecret();
  const [s] = await db
    .insert(sessions)
    .values({ userId, userAgent: userAgent?.slice(0, 400) ?? null, ip: ip ?? null, refreshHash: sha256(secret), refreshExpiresAt: refreshExpiry() })
    .returning({ id: sessions.id });
  // Keep at most MAX_SESSIONS_PER_USER active sessions: revoke the oldest beyond that.
  const active = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .orderBy(desc(sessions.lastSeenAt), desc(sessions.createdAt));
  const extra = active.slice(env.MAX_SESSIONS_PER_USER).map((r) => r.id);
  for (const id of extra) await revokeSession({ userId, sessionId: id, reason: 'session limit' });
  log.info('session created', { sessionId: s.id, revokedOldest: extra.length || undefined });
  return { sessionId: s.id, refreshToken: `${s.id}.${secret}` };
}

/**
 * Exchange a refresh token for a rotated one.
 * Returns { sessionId, userId, refreshToken|null } (refreshToken null = grace reuse: keep the cookie the
 * other tab just received), or null when the token is invalid, expired, revoked or replayed.
 */
export async function rotateRefreshToken(token) {
  const [sessionId, secret] = String(token ?? '').split('.');
  if (!UUID.test(sessionId ?? '') || !secret) return null;
  const [row] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  if (!row || row.revokedAt || !row.refreshHash) return null;
  if (!row.refreshExpiresAt || row.refreshExpiresAt < new Date()) {
    log.info('refresh token expired', { sessionId });
    await revokeSession({ userId: row.userId, sessionId, reason: 'refresh token expired' });
    return null;
  }
  const hash = sha256(secret);
  if (safeEqual(hash, row.prevRefreshHash)) {
    if (row.rotatedAt && Date.now() - row.rotatedAt.getTime() < REUSE_GRACE_MS) return { sessionId, userId: row.userId, refreshToken: null };
    log.warn('refresh token reuse detected: revoking session', { sessionId });
    await revokeSession({ userId: row.userId, sessionId, reason: 'refresh token reused' });
    return null;
  }
  if (!safeEqual(hash, row.refreshHash)) {
    log.warn('refresh failed: unknown token', { sessionId });
    return null;
  }
  const next = newSecret();
  // Compare-and-swap on the current hash so two concurrent rotations can't both win.
  const [updated] = await db
    .update(sessions)
    .set({ refreshHash: sha256(next), prevRefreshHash: hash, rotatedAt: new Date(), refreshExpiresAt: refreshExpiry(), lastSeenAt: new Date() })
    .where(and(eq(sessions.id, sessionId), eq(sessions.refreshHash, hash), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  if (!updated) return { sessionId, userId: row.userId, refreshToken: null }; // lost the race: the other request rotated it
  return { sessionId, userId: row.userId, refreshToken: `${sessionId}.${next}` };
}

/** Session id from a refresh token (no verification) — used to end the session on logout. */
export const sessionIdFromRefreshToken = (token) => {
  const id = String(token ?? '').split('.')[0];
  return UUID.test(id) ? id : null;
};

/** True if the session exists, belongs to the user and is not revoked. Updates last_seen_at (throttled). */
export async function isSessionActive(sessionId, userId) {
  const now = Date.now();
  const hit = cache.get(sessionId);
  let ok = hit && hit.until > now && hit.userId === userId;
  if (!ok) {
    const [row] = await db
      .select({ userId: sessions.userId, revokedAt: sessions.revokedAt })
      .from(sessions)
      .where(eq(sessions.id, sessionId));
    ok = Boolean(row && !row.revokedAt && row.userId === userId);
    if (ok) cache.set(sessionId, { userId, until: now + CACHE_MS });
    else cache.delete(sessionId);
  }
  if (ok && now - (touched.get(sessionId) ?? 0) > TOUCH_MS) {
    touched.set(sessionId, now);
    db.update(sessions)
      .set({ lastSeenAt: new Date() })
      .where(eq(sessions.id, sessionId))
      .catch((err) => log.warn('could not update session last_seen_at', { err }));
  }
  return ok;
}

export function listSessions(userId) {
  return db
    .select({ id: sessions.id, userAgent: sessions.userAgent, ip: sessions.ip, createdAt: sessions.createdAt, lastSeenAt: sessions.lastSeenAt })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .orderBy(desc(sessions.lastSeenAt));
}

export async function revokeSession({ userId, sessionId, reason = 'user' }) {
  const [row] = await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  cache.delete(sessionId);
  if (row) {
    log.info('session revoked', { sessionId, reason });
    await auditService.record({ action: 'update', entity: 'session', entityId: sessionId, userId, before: { active: true }, after: { active: false, reason } });
  }
  return Boolean(row);
}

/** Revoke every active session of the user except `keepSessionId` (pass null to revoke all). */
export async function revokeAllSessions({ userId, keepSessionId = null, reason = 'user' }) {
  const rows = await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), keepSessionId ? ne(sessions.id, keepSessionId) : undefined))
    .returning({ id: sessions.id });
  for (const r of rows) cache.delete(r.id);
  log.info('sessions revoked', { count: rows.length, kept: keepSessionId ? 1 : 0, reason });
  if (rows.length) {
    await auditService.record({ action: 'update', entity: 'session', entityId: keepSessionId ? 'all-other' : 'all', userId, after: { revoked: rows.length, reason } });
  }
  return rows.length;
}

