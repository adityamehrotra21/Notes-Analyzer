import { api, authFetch } from './client.js';
import { parseFrame } from './chat.js';

const clean = (params) => Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v !== undefined && v !== null));

export const adminApi = {
  logs: (params) => api.get('/admin/logs', { params: clean(params) }).then((r) => r.data),
  audit: (params) => api.get('/admin/audit', { params: clean(params) }).then((r) => r.data),
  usage: () => api.get('/admin/usage').then((r) => r.data),
};

export const budgetApi = {
  status: () => api.get('/budget/status').then((r) => r.data),
};

/** Live log tail over SSE (fetch-based: EventSource can't send the auth header). Resolves when the stream ends. */
export async function streamLogs({ level, onEntry, onReady, signal }) {
  const res = await authFetch(`/admin/logs/stream?level=${encodeURIComponent(level)}`, {
    headers: { Accept: 'text/event-stream' },
    signal,
  });
  if (!res.ok) {
    let message;
    try {
      message = (await res.json()).error?.message;
    } catch {
      /* not JSON */
    }
    throw new Error(message || `Log stream failed (${res.status})`);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value.replace(/\r\n/g, '\n');
    let idx;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const frame = parseFrame(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 2);
      if (frame?.event === 'log') onEntry(frame.data);
      else if (frame?.event === 'ready') onReady?.();
    }
  }
}
