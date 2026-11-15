import { authFetch } from './client.js';

export function parseFrame(frame) {
  let event = 'message';
  const data = [];
  for (const line of frame.split('\n')) {
    if (!line || line.startsWith(':')) continue; // comment / heartbeat
    const i = line.indexOf(':');
    const field = i < 0 ? line : line.slice(0, i);
    const value = i < 0 ? '' : line.slice(i + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  return data.length ? { event, data: JSON.parse(data.join('\n')) } : null;
}

/**
 * POST /api/chat as Server-Sent Events. EventSource can't POST or send headers, so this reads the
 * fetch body stream directly. Resolves with { answer, citations, finishReason } on `done`.
 */
export async function streamChat(body, { onSources, onToken, signal } = {}) {
  const res = await authFetch('/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    let message;
    try {
      const err = (await res.json()).error;
      message = err?.details?.map((d) => d.message).join('. ') || err?.message;
    } catch {
      /* not JSON */
    }
    throw new Error(message || `Request failed (${res.status})`);
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value.replace(/\r\n/g, '\n');
    let idx;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const frame = parseFrame(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 2);
      if (!frame) continue;
      if (frame.event === 'sources') onSources?.(frame.data.sources);
      else if (frame.event === 'token') onToken?.(frame.data.text);
      else if (frame.event === 'done') return frame.data;
      else if (frame.event === 'error') throw new Error(frame.data.message);
    }
  }
  throw new Error('The connection closed before the answer finished.');
}
