import toast from 'react-hot-toast';
import { AlertTriangle, Check, CheckCircle2, Copy, FileText, RefreshCw, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { summarizeDocument } from '../api/summarize.js';
import { getErrorMessage } from '../api/client.js';
import SegmentedControl from './SegmentedControl.jsx';
import MarkdownView from './Markdown.jsx';
import Skeleton from './Skeleton.jsx';
import Spinner from './Spinner.jsx';
import ExportMenu, { standardItems } from './ExportMenu.jsx';

const MODES = [
  { value: 'brief', label: 'Brief' },
  { value: 'detailed', label: 'Detailed Notes' },
  { value: 'exam', label: 'Exam Revision' },
];


function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn-ghost p-1.5"
      title="Copy"
      aria-label="Copy summary"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error('Could not copy to clipboard');
        }
      }}
    >
      {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
    </button>
  );
}

/** "Coverage: 12/12 topics", with missing / auto-filled topics in the tooltip. */
function CoverageBadge({ coverage }) {
  if (!coverage?.total) return null;
  const full = coverage.covered === coverage.total;
  const Icon = full ? CheckCircle2 : AlertTriangle;
  const cls = full ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-800 dark:text-amber-300';
  const detail = [
    coverage.filled?.length ? `Added by the coverage check: ${coverage.filled.join(', ')}` : '',
    coverage.missing?.length ? `Still missing: ${coverage.missing.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 text-xs font-medium ${cls}`} title={detail || 'Every topic in the outline has its own section'}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      Coverage: {coverage.covered}/{coverage.total} topics
      {coverage.filled?.length ? <span className="text-muted hidden font-normal sm:inline">({coverage.filled.length} auto-filled)</span> : null}
    </span>
  );
}

function SummaryCard({ doc, mode, entry, onGenerate }) {
  const loading = entry?.status === 'loading';

  const regenerate = () => {
    if (window.confirm('This will replace the current version. Continue?')) onGenerate(doc, { refresh: true });
  };

  return (
    <article className="card">
      <header className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
        <FileText className="text-muted h-4 w-4 shrink-0" aria-hidden />
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold" title={doc.filename}>{doc.filename}</h2>
        {entry?.status === 'done' && <CoverageBadge coverage={entry.coverage} />}
        {entry?.status === 'done' && (
          <>
            <ExportMenu compact label="Export notes" items={standardItems({ type: 'notes', documentId: doc.id, options: { mode } })} />
            <CopyButton text={entry.summary} />
            <button className="btn-ghost p-1.5" title="Regenerate" aria-label="Regenerate" onClick={regenerate}>
              <RefreshCw className="h-4 w-4" aria-hidden />
            </button>
          </>
        )}
      </header>
      <div className="px-5 py-5">
        {loading ? (
          <div className="space-y-3" aria-busy="true">
            <Spinner
              className="h-4 w-4"
              label={
                entry.refresh
                  ? 'Regenerating…'
                  : mode === 'detailed' || mode === 'exam'
                    ? 'Writing study notes: outline → notes → coverage check. This can take a minute or two.'
                    : 'Summarising…'
              }
            />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-11/12" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        ) : entry?.status === 'done' ? (
          <MarkdownView className="notes text-sm leading-relaxed">{entry.summary}</MarkdownView>
        ) : entry?.status === 'error' ? (
          <div className="text-sm">
            <p className="text-red-700 dark:text-red-300">{entry.error}</p>
            <button className="btn-secondary mt-3" onClick={() => onGenerate(doc)}>Try again</button>
          </div>
        ) : (
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-muted text-sm">No {MODES.find((m) => m.value === mode).label} yet.</p>
            <button className="btn-primary" onClick={() => onGenerate(doc)}>
              <Sparkles className="h-4 w-4" aria-hidden /> Generate
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

/**
 * Summaries / study notes per document. Cached ones load automatically (no LLM call); new ones are
 * generated only on click.
 * state: { [`${docId}:${mode}`]: { status: 'loading'|'done'|'error', summary?, coverage?, error?, refresh? } }
 */
export default function SummaryPanel({ docs, mode, setMode, state, setState }) {
  const set = (key, value) => setState((s) => ({ ...s, [key]: value }));
  const autoLoaded = useRef(new Set()); // guards against double effects (React StrictMode)

  const generate = async (doc, { refresh = false } = {}) => {
    const key = `${doc.id}:${mode}`;
    set(key, { status: 'loading', refresh });
    try {
      const r = await summarizeDocument({ documentId: doc.id, mode, refresh });
      set(key, { status: 'done', summary: r.summary, coverage: r.coverage });
    } catch (err) {
      const message = getErrorMessage(err, 'Summary failed');
      set(key, { status: 'error', error: message });
      toast.error(`${doc.filename}: ${message}`);
    }
  };

  // Load saved summaries for this mode automatically (no generation needed).
  useEffect(() => {
    for (const doc of docs) {
      const key = `${doc.id}:${mode}`;
      if (doc.summaries?.[mode] && !state[key] && !autoLoaded.current.has(key)) {
        autoLoaded.current.add(key);
        generate(doc);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, docs]);

  const missing = docs.filter((d) => !state[`${d.id}:${mode}`]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl label="Summary style" options={MODES} value={mode} onChange={setMode} />
        {docs.length > 1 && missing.length > 0 && (
          <button className="btn-secondary" onClick={() => missing.forEach((d) => generate(d))}>
            <Sparkles className="h-4 w-4" aria-hidden /> Generate all ({missing.length})
          </button>
        )}
      </div>
      {docs.map((doc) => (
        <SummaryCard key={doc.id} doc={doc} mode={mode} entry={state[`${doc.id}:${mode}`]} onGenerate={generate} />
      ))}
    </div>
  );
}
