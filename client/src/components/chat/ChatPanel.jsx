import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { ArrowUp, MessageCircleQuestion, Square, Trash2 } from 'lucide-react';
import { streamChat } from '../../api/chat.js';
import ChatMessage from './ChatMessage.jsx';

const SUGGESTIONS = [
  'Explain the main idea of these notes in simple words',
  'Explain the hardest topic step by step with an example',
  "I'm a beginner. Teach me this from scratch",
];
const HISTORY_TURNS = 12; // messages sent as context, so "I still don't get it" knows what "it" is

const newId = () => (crypto.randomUUID?.() ?? String(Math.random()).slice(2));

export default function ChatPanel({ documentIds, messages, setMessages }) {
  const [input, setInput] = useState('');
  const abortRef = useRef(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const streaming = messages.some((m) => m.status === 'streaming');

  // Stick to the bottom while new tokens arrive.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // A message restored as "streaming" (page reloaded mid-answer) has no live request behind it:
  // mark it stopped so the Stop button and the input don't get stuck.
  useEffect(() => {
    if (!abortRef.current && messages.some((m) => m.status === 'streaming')) {
      setMessages((ms) => ms.map((m) => (m.status === 'streaming' ? { ...m, status: 'stopped' } : m)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stop = () => {
    abortRef.current?.abort();
    // Update the UI immediately (also covers an answer with no live request).
    setMessages((ms) => ms.map((m) => (m.status === 'streaming' ? { ...m, status: 'stopped' } : m)));
  };

  const patch = (id, fn) => setMessages((ms) => ms.map((m) => (m.id === id ? { ...m, ...fn(m) } : m)));

  async function send(text) {
    const question = text.trim();
    if (!question || streaming) return;
    const history = messages
      .filter((m) => m.status === 'done' || m.role === 'user')
      .slice(-HISTORY_TURNS)
      .map(({ role, content }) => ({ role, content }));
    const assistantId = newId();
    setMessages((ms) => [
      ...ms,
      { id: newId(), role: 'user', content: question },
      { id: assistantId, role: 'assistant', content: '', status: 'streaming' },
    ]);
    setInput('');
    if (inputRef.current) inputRef.current.style.height = '';

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await streamChat(
        { question, documentIds, history },
        {
          signal: controller.signal,
          onSources: (sources) => patch(assistantId, () => ({ sources })),
          onToken: (t) => patch(assistantId, (m) => (m.status === 'stopped' ? {} : { content: m.content + t })),
        },
      );
      patch(assistantId, (m) => (m.status === 'stopped' ? {} : { content: result.answer, citations: result.citations, status: 'done' }));
    } catch (err) {
      if (controller.signal.aborted) {
        patch(assistantId, () => ({ status: 'stopped' }));
      } else {
        patch(assistantId, () => ({ status: 'error', error: err.message }));
        toast.error(err.message);
      }
    } finally {
      abortRef.current = null;
      inputRef.current?.focus();
    }
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(input);
    }
  };

  return (
    <div className="card flex h-[calc(100dvh-20rem)] min-h-[24rem] flex-col">
      <div ref={listRef} className="flex-1 space-y-6 overflow-y-auto px-4 py-6 sm:px-6" aria-live="polite">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <MessageCircleQuestion className="text-muted h-8 w-8" aria-hidden />
            <p className="mt-3 text-sm font-medium">Ask any doubt about your notes</p>
            <p className="text-muted mt-1 max-w-md text-xs">
              Answers are based on your notes, with page references. Ask follow-ups any time, like &quot;I still don&apos;t get it&quot;, &quot;explain with an
              example&quot; or &quot;in Hinglish&quot;.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="btn-secondary px-3 py-1.5 text-xs" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => <ChatMessage key={m.id} message={m} />)
        )}
      </div>

      <form
        className="flex items-end gap-2 border-t border-zinc-200 p-3 dark:border-zinc-800"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        {messages.length > 0 && !streaming && (
          <button type="button" className="btn-ghost p-2" onClick={() => setMessages([])} title="Clear doubts" aria-label="Clear doubts">
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        )}
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            // Auto-grow (field-sizing isn't supported everywhere yet); capped by max-h-40.
            e.target.style.height = 'auto';
            e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
          }}
          onKeyDown={onKeyDown}
          placeholder="Ask a doubt…"
          maxLength={2000}
          className="input max-h-40 min-h-10 flex-1 resize-none [field-sizing:content]"
          aria-label="Your doubt"
        />
        {streaming ? (
          <button type="button" className="btn-secondary p-2.5" onClick={stop} title="Stop" aria-label="Stop generating">
            <Square className="h-4 w-4" aria-hidden />
          </button>
        ) : (
          <button type="submit" className="btn-primary p-2.5" disabled={!input.trim()} title="Send" aria-label="Send">
            <ArrowUp className="h-4 w-4" aria-hidden />
          </button>
        )}
      </form>
    </div>
  );
}
