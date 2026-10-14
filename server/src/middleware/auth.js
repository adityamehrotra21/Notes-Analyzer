import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { z } from 'zod';
import { AppError } from '../utils/AppError.js';
import { setContextUserId } from '../utils/requestContext.js';
import { isSessionActive } from '../services/sessionService.js';
import logger from '../utils/logger.js';

const log = logger.child({ module: 'auth' });

const uuid = z.uuid();

/** Valid JWT + an active session (sid). Revoked sessions ("log out this device / all devices") get 401. */
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return next(AppError.unauthorized('Missing auth token'));
  let payload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET);
  } catch (err) {
    log.warn('auth failed: invalid or expired token', { reason: err.name });
    return next(err); // JWT errors are mapped to 401 by errorHandler
  }
  if (!uuid.safeParse(payload.sub).success || !uuid.safeParse(payload.sid).success) {
    log.warn('auth failed: token without a valid session (issued before sessions existed?)');
    return next(AppError.unauthorized('Your session expired. Please log in again.'));
  }
  if (!(await isSessionActive(payload.sid, payload.sub))) {
    log.warn('auth failed: session revoked or unknown', { sessionId: payload.sid });
    return next(AppError.unauthorized('You were logged out on this device. Please log in again.'));
  }
  req.user = { id: payload.sub, sessionId: payload.sid };
  setContextUserId(payload.sub);
  next();
}

export function signToken(userId, sessionId) {
  return jwt.sign({ sid: sessionId }, env.JWT_SECRET, { subject: String(userId), expiresIn: env.ACCESS_TOKEN_TTL });
}
