import axios from 'axios';

// "/api" (same origin: Vite dev proxy or the Vercel rewrite), or the full API URL when calling it directly.
export const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');

// Access token lives in memory only (never localStorage). The httpOnly refresh cookie renews it:
// on page load and whenever a request comes back 401.
let accessToken = null;
export const setAccessToken = (token) => {
  accessToken = token;
};

let refreshing = null;
/**
 * Exchange the refresh cookie for a new access token. Single-flight: concurrent callers share one request.
 * Resolves { token, user }, or null when signed out. Rejects only on network errors.
 */
export function refreshSession() {
  refreshing ??= fetch(`${API_BASE}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-Requested-With': 'NotesAnalyser' },
  })
    .then(async (res) => {
      if (!res.ok) {
        accessToken = null;
        return null;
      }
      const data = await res.json();
      accessToken = data.token;
      return data;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export const api = axios.create({ baseURL: API_BASE, withCredentials: true });

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

// Endpoints where a 401 means "wrong credentials", not "session expired".
const PUBLIC_AUTH = /^\/auth\/(login|register|refresh|forgot-password|reset-password)/;

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const { config, response } = err;
    if (response?.status === 401 && config && !PUBLIC_AUTH.test(config.url ?? '')) {
      if (!config._retried) {
        config._retried = true;
        const data = await refreshSession().catch(() => undefined);
        if (data) return api(config); // retried with the new token
        if (data === undefined) return Promise.reject(err); // network error: don't sign out
      }
      window.dispatchEvent(new Event('auth:logout'));
    }
    if (response?.status === 402) window.dispatchEvent(new Event('budget:refresh')); // budget cap hit
    return Promise.reject(err);
  },
);

/** fetch() with the access token, cookies, and one silent refresh + retry on 401 (for streams and downloads). */
export async function authFetch(path, init = {}) {
  const go = () =>
    fetch(API_BASE + path, {
      ...init,
      credentials: 'include',
      headers: { ...init.headers, ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
    });
  let res = await go();
  if (res.status === 401) {
    const data = await refreshSession().catch(() => undefined);
    if (data) res = await go();
    if (res.status === 401 && data !== undefined) window.dispatchEvent(new Event('auth:logout'));
  }
  return res;
}

export function getErrorMessage(err, fallback = 'Something went wrong') {
  if (!err?.response) return err?.message === 'Network Error' ? 'Cannot reach the server' : err?.message || fallback;
  const { message, details } = err.response.data?.error ?? {};
  if (details?.length) return details.map((d) => d.message).join('. ');
  return message || fallback;
}
