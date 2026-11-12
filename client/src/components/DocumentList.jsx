import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Trash2 } from 'lucide-react';
import StatusBadge from './StatusBadge.jsx';
import Spinner from './Spinner.jsx';

const fmtDate = (d) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

function DeleteButton({ onConfirm }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  if (busy) return <Spinner className="h-4 w-4" label={undefined} />;
  if (confirming) {
    return (
      <span className="flex items-center gap-1">
        <button
          className="btn px-2 py-1 text-xs text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/60"
          onClick={async () => {
            setBusy(true);
            await onConfirm();
            setBusy(false);
            setConfirming(false);
          }}
        >
          Delete
        </button>
        <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setConfirming(false)}>
          Cancel
        </button>
      </span>
    );
  }
  return (
    <button className="btn-ghost p-1.5" onClick={() => setConfirming(true)} aria-label="Delete document" title="Delete">
      <Trash2 className="h-4 w-4" aria-hidden />
    </button>
  );
}

export default function DocumentList({ documents, selected, onToggle, onToggleAll, onDelete }) {
  const ready = documents.filter((d) => d.status === 'ready');
  const allSelected = ready.length > 0 && ready.every((d) => selected.has(d.id));

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-3 border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
        <input
          type="checkbox"
          className="h-4 w-4 accent-indigo-600"
          checked={allSelected}
          disabled={!ready.length}
          onChange={() => onToggleAll(allSelected ? [] : ready.map((d) => d.id))}
          aria-label="Select all ready documents"
        />
        <span className="text-muted text-xs font-medium tracking-wide uppercase">
          {documents.length} document{documents.length === 1 ? '' : 's'}
        </span>
      </div>
      <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {documents.map((d) => {
          const selectable = d.status === 'ready';
          return (
            <li key={d.id} className="flex items-center gap-3 px-4 py-3">
              <input
                type="checkbox"
                className="h-4 w-4 shrink-0 accent-indigo-600"
                checked={selected.has(d.id)}
                disabled={!selectable}
                onChange={() => onToggle(d.id)}
                aria-label={`Select ${d.filename}`}
              />
              <FileText className="text-muted hidden h-5 w-5 shrink-0 sm:block" aria-hidden />
              <div className="min-w-0 flex-1">
                {selectable ? (
                  <Link to={`/study?docs=${d.id}`} className="block truncate text-sm font-medium hover:text-indigo-600 dark:hover:text-indigo-400" title={d.filename}>
                    {d.filename}
                  </Link>
                ) : (
                  <p className="truncate text-sm font-medium" title={d.filename}>{d.filename}</p>
                )}
                <p className="text-muted mt-0.5 truncate text-xs">
                  {d.status === 'failed' && d.error ? (
                    <span className="text-red-700 dark:text-red-300">{d.error}</span>
                  ) : (
                    <>
                      {fmtDate(d.createdAt)}
                      {d.pageCount ? ` · ${d.pageCount} page${d.pageCount === 1 ? '' : 's'}` : ''}
                    </>
                  )}
                </p>
              </div>
              <StatusBadge status={d.status} progress={d.progress} error={d.error} />
              <DeleteButton onConfirm={() => onDelete(d)} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
