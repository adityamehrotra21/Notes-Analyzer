import { useState } from 'react';
import toast from 'react-hot-toast';
import { ChevronDown, HelpCircle, Plus, Sparkles } from 'lucide-react';
import { generationApi } from '../api/generation.js';
import { getErrorMessage } from '../api/client.js';
import SegmentedControl from './SegmentedControl.jsx';
import MarkdownView from './Markdown.jsx';
import SourceChip from './SourceChip.jsx';
import Skeleton from './Skeleton.jsx';
import Spinner from './Spinner.jsx';
import ExportMenu from './ExportMenu.jsx';

const TYPES = [
  { value: 'short', label: 'Short' },
  { value: 'long', label: 'Long' },
  { value: 'conceptual', label: 'Conceptual' },
];
// Per-request limits match the server (long answers are capped so they fit the output budget).
const COUNTS = { short: [3, 5, 10, 15], conceptual: [3, 5, 10, 15], long: [3, 5, 6] };

function QuestionCard({ q, n }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="card p-5">
      <div className="flex gap-3">
        <span className="text-muted w-6 shrink-0 pt-0.5 text-sm font-semibold tabular-nums">{n}.</span>
        <div className="min-w-0 flex-1 space-y-3">
          <MarkdownView className="text-sm leading-relaxed font-medium">{q.question}</MarkdownView>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-ghost -ml-2 px-2 py-1 text-xs" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
              {open ? 'Hide answer' : 'Show answer'}
            </button>
            <SourceChip filename={q.filename} page={q.sourcePage} />
          </div>
          {open && (
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950">
              <MarkdownView className="text-sm leading-relaxed">{q.answer}</MarkdownView>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

/** state: { [key]: { status, questions?, error? } } keyed by type+topic (lifted so tab switches keep it). */
export default function QuestionsPanel({ documentIds, state, setState }) {
  const [type, setType] = useState('short');
  const [count, setCount] = useState(5);
  const [topic, setTopic] = useState('');
  const key = `${type}|${topic.trim().toLowerCase()}`;
  const entry = state[key];
  const busy = entry?.status === 'loading';

  const run = async ({ more = false } = {}) => {
    setState((s) => ({ ...s, [key]: { ...s[key], status: 'loading', more } }));
    try {
      const r = await generationApi.questions({ documentIds, type, count, topic: topic.trim() || undefined, more });
      setState((s) => ({ ...s, [key]: { status: 'done', questions: r.questions } }));
      if (more && r.generated === 0) toast('No new questions found. Try a topic or another type.');
      else if (r.cached) toast.success('Loaded saved questions');
    } catch (err) {
      const message = getErrorMessage(err, 'Could not generate questions');
      setState((s) => ({ ...s, [key]: { ...s[key], status: s[key]?.questions ? 'done' : 'error', error: message } }));
      toast.error(message);
    }
  };

  const questions = entry?.questions ?? [];

  return (
    <div className="space-y-5">
      <form
        className="card flex flex-col gap-4 p-4 sm:flex-row sm:flex-wrap sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <div>
          <span className="label">Type</span>
          <SegmentedControl
            label="Question type"
            options={TYPES}
            value={type}
            onChange={(t) => {
              setType(t);
              setCount((c) => Math.min(c, Math.max(...COUNTS[t])));
            }}
          />
        </div>
        <label className="block">
          <span className="label">How many</span>
          <select className="input w-24" value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {COUNTS[type].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="block min-w-0 flex-1">
          <span className="label">Topic <span className="text-muted font-normal">(optional)</span></span>
          <input className="input" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Calvin cycle. Leave empty to cover everything" maxLength={200} />
        </label>
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy && !entry?.more ? <Spinner className="h-4 w-4 text-white" /> : <Sparkles className="h-4 w-4" aria-hidden />} Generate
        </button>
      </form>

      {busy && !questions.length ? (
        <div className="space-y-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card space-y-3 p-5">
              <Skeleton className="h-3.5 w-3/4" />
              <Skeleton className="h-3 w-24" />
            </div>
          ))}
        </div>
      ) : questions.length ? (
        <>
          <ol className="space-y-3">
            {questions.map((q, i) => (
              <QuestionCard key={q.id} q={q} n={i + 1} />
            ))}
          </ol>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-secondary" onClick={() => run({ more: true })} disabled={busy}>
              {busy ? <Spinner className="h-4 w-4" /> : <Plus className="h-4 w-4" aria-hidden />} {count} more questions
            </button>
            <ExportMenu
              align="left"
              label="Export Q&A"
              items={[
                { label: 'PDF with model answers', hint: 'Grouped by topic, with marking points', spec: { type: 'qa', documentIds }, kind: 'pdf' },
                { label: 'PDF, questions only', hint: 'For practice, with space to write', spec: { type: 'qa', documentIds, options: { questionsOnly: true } }, kind: 'pdf' },
                { label: 'Markdown (.md)', spec: { type: 'qa', documentIds }, kind: 'md' },
                { label: 'Email PDF to me', spec: { type: 'qa', documentIds }, kind: 'email' },
              ]}
            />
          </div>
        </>
      ) : entry?.status === 'error' ? (
        <div className="card px-6 py-10 text-center text-sm">
          <p className="text-red-700 dark:text-red-300">{entry.error}</p>
          <button className="btn-secondary mt-4" onClick={() => run()}>Try again</button>
        </div>
      ) : (
        <div className="card px-6 py-12 text-center">
          <HelpCircle className="text-muted mx-auto h-8 w-8" aria-hidden />
          <p className="mt-3 text-sm font-medium">Practice questions with model answers</p>
          <p className="text-muted mx-auto mt-1 max-w-sm text-xs">
            Pick a type and click Generate. Questions are saved, so reopening them won't use AI quota.
          </p>
        </div>
      )}
    </div>
  );
}
