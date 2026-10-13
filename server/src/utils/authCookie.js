// The refresh-token cookie: httpOnly (JS can't read it), scoped to /api/auth, SameSite from env.
import { env } from '../config/env.js';

export const REFRESH_COOKIE = 'na_rt';
const PATH = '/api/auth';

function options() {
  const sameSite = env.COOKIE_SAMESITE;
  // Browsers drop SameSite=None cookies that aren't Secure.
  const secure = sameSite === 'none' ? true : (env.COOKIE_SECURE ?? env.NODE_ENV === 'production');
  return { httpOnly: true, secure, sameSite, path: PATH };
}

export function setRefreshCookie(res, token) {
  res.cookie(REFRESH_COOKIE, token, { ...options(), maxAge: env.REFRESH_TOKEN_DAYS * 86_400_000 });
}

export function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE, options());
}

/** Read the cookie without a cookie-parser dependency. */
export function readRefreshCookie(req) {
  const header = req.headers.cookie ?? '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === REFRESH_COOKIE) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}
