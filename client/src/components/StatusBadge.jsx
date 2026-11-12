import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

const STAGES = { queued: 'Queued', parsing: 'Reading PDF', chunking: 'Splitting', embedding: 'Indexing', saving: 'Saving' };

function progressLabel(progress) {
  if (!progress) return 'Processing';
  const label = STAGES[progress.stage] ?? 'Processing';
  return progress.stage === 'embedding' && progress.total ? `${label} ${Math.min(99, Math.round((progress.done / progress.total) * 100))}%` : label;
}

export default function StatusBadge({ status, progress, error }) {
  const base = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap';
  if (status === 'ready') {
    return (
      <span className={`${base} bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300`}>
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Ready
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className={`${base} bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300`} title={error ?? undefined}>
        <AlertCircle className="h-3.5 w-3.5" aria-hidden /> Failed
      </span>
    );
  }
  return (
    <span className={`${base} bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300`}>
      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> {progressLabel(progress)}
    </span>
  );
}
