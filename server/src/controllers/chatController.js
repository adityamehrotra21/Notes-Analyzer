import { openSSE } from '../utils/sse.js';
import { toAppError } from '../services/llmService.js';
import { requireReadyDocuments } from '../services/documentAccess.js';
import { startChatAnswer, extractCitations, publicSource } from '../services/ragService.js';

/**
 * POST /api/chat
 * - Accept: text/event-stream -> SSE: `sources`, many `token`, then `done` (or `error`)
 * - otherwise                 -> JSON { answer, citations, sources, finishReason }
 */
export async function chat(req, res) {
  const { question, documentIds, history } = req.body;
  const docs = await requireReadyDocuments(req.user.id, documentIds);

  const abort = new AbortController();
  res.on('close', () => !res.writableFinished && abort.abort());

  // Errors up to here (and while opening the LLM stream) become normal JSON errors.
  const { sources, meta, events } = await startChatAnswer({
    userId: req.user.id,
    question,
    documentIds: docs.map((d) => d.id),
    docs,
    history,
    signal: abort.signal,
  });

  const wantsStream = req.accepts(['application/json', 'text/event-stream']) === 'text/event-stream';
  let answer = '';
  let finishReason = 'stop';

  if (!wantsStream) {
    for await (const ev of events) {
      if (ev.type === 'text') answer += ev.text;
      else finishReason = ev.finishReason;
    }
    return res.json({ answer, citations: extractCitations(answer, sources), sources: sources.map(publicSource), finishReason, meta });
  }

  const sse = openSSE(res);
  sse.send('sources', { sources: sources.map(publicSource), meta });
  try {
    for await (const ev of events) {
      if (abort.signal.aborted) break;
      if (ev.type === 'text') {
        answer += ev.text;
        sse.send('token', { text: ev.text });
      } else finishReason = ev.finishReason;
    }
    if (!abort.signal.aborted) {
      if (!answer.trim()) {
        sse.send('error', { message: finishReason === 'safety' ? 'The AI declined to answer this.' : 'The AI returned an empty answer. Try rephrasing.' });
      } else {
        sse.send('done', { answer, citations: extractCitations(answer, sources), finishReason });
      }
    }
  } catch (err) {
    if (!abort.signal.aborted) sse.send('error', { message: toAppError(err).message });
  } finally {
    sse.close();
  }
}
