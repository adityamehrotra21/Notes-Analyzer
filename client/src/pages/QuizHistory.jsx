import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ChevronRight, ClipboardCheck } from 'lucide-react';
import { generationApi } from '../api/generation.js';
import { getErrorMessage } from '../api/client.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import Skeleton from '../components/Skeleton.jsx';

const fmt = (d) => new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function ScoreBadge({ score, total }) {
  const pct = total ? Math.round((score / total) * 100) : 0;
  const cls =
    pct >= 80
      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
      : pct >= 50
        ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300'
        : 'bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300';
  return (
    <span className={`inline-flex min-w-16 justify-center rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums ${cls}`}>
      {score}/{total} · {pct}%
    </span>
  );
}

export default function QuizHistory() {
  const [data, setData] = useState(null);
  useDocumentTitle('Quiz history');

  useEffect(() => {
    generationApi
      .history()
      .then(setData)
      .catch((err) => {
        toast.error(getErrorMessage(err, 'Could not load history'));
        setData({ attempts: [], stats: { attempts: 0, avgPercent: 0 } });
      });
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Quiz history</h1>
        {data?.stats?.attempts > 0 && (
          <p className="text-muted mt-1 text-sm">
            {data.stats.attempts} attempt{data.stats.attempts === 1 ? '' : 's'} · average {data.stats.avgPercent}%
          </p>
        )}
      </div>

      {!data ? (
        <div className="card divide-y divide-zinc-200 dark:divide-zinc-800">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-4">
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-1/3" />
                <Skeleton className="h-3 w-1/4" />
              </div>
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
          ))}
        </div>
      ) : data.attempts.length ? (
        <ul className="card divide-y divide-zinc-200 overflow-hidden dark:divide-zinc-800">
          {data.attempts.map((a) => (
            <li key={a.id}>
              <Link to={`/quiz/${a.quizId}/results/${a.id}`} className="flex items-center gap-4 px-4 py-3.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{a.documents.map((d) => d.filename).join(', ') || 'Deleted documents'}</p>
                  <p className="text-muted mt-0.5 truncate text-xs">
                    <span className="capitalize">{a.difficulty}</span>
                    {a.topic ? ` · ${a.topic}` : ''} · {fmt(a.createdAt)}
                  </p>
                </div>
                <ScoreBadge score={a.score} total={a.total} />
                <ChevronRight className="text-muted h-4 w-4 shrink-0" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="card px-6 py-12 text-center">
          <ClipboardCheck className="text-muted mx-auto h-8 w-8" aria-hidden />
          <p className="mt-3 text-sm font-medium">No quiz attempts yet</p>
          <p className="text-muted mt-1 text-xs">Open a document and start a quiz from the Quiz tab.</p>
          <Link to="/dashboard" className="btn-secondary mt-4">Go to documents</Link>
        </div>
      )}
    </div>
  );
}
