import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { CheckCircle2, History, RotateCcw, XCircle, MinusCircle } from 'lucide-react';
import { generationApi } from '../api/generation.js';
import { getErrorMessage } from '../api/client.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import SourceChip from '../components/SourceChip.jsx';
import Skeleton from '../components/Skeleton.jsx';
import MarkdownView from '../components/Markdown.jsx';
import ExportMenu from '../components/ExportMenu.jsx';

const LETTERS = ['A', 'B', 'C', 'D'];

function scoreTone(pct) {
  if (pct >= 80) return { text: 'Excellent work', cls: 'text-emerald-700 dark:text-emerald-300' };
  if (pct >= 50) return { text: 'Good effort, review the misses below', cls: 'text-indigo-700 dark:text-indigo-300' };
  return { text: 'Keep practising, the explanations below will help', cls: 'text-amber-700 dark:text-amber-300' };
}

function ResultItem({ r, n }) {
  const state = r.selectedIndex === null ? 'skipped' : r.correct ? 'correct' : 'wrong';
  const Icon = state === 'correct' ? CheckCircle2 : state === 'wrong' ? XCircle : MinusCircle;
  const iconCls = state === 'correct' ? 'text-emerald-600 dark:text-emerald-400' : state === 'wrong' ? 'text-red-600 dark:text-red-400' : 'text-zinc-400';
  return (
    <li className="card p-5 sm:p-6">
      <div className="flex gap-3">
        <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${iconCls}`} aria-label={state} />
        <div className="min-w-0 flex-1 space-y-4">
          <p className="text-sm leading-relaxed font-medium">
            <span className="text-muted mr-1 tabular-nums">{n}.</span> <MarkdownView inline>{r.question}</MarkdownView>
          </p>
          <ul className="space-y-2">
            {r.options.map((opt, i) => {
              const isCorrect = i === r.correctIndex;
              const isPicked = i === r.selectedIndex;
              const cls = isCorrect ? 'option-correct' : isPicked ? 'option-wrong' : '';
              return (
                <li key={i} className={`option pointer-events-none flex items-start gap-3 ${cls}`}>
                  <span className="w-4 shrink-0 font-semibold">{LETTERS[i]}</span>
                  <span className="flex-1">
                    <MarkdownView inline>{opt}</MarkdownView>
                  </span>
                  {isCorrect && <span className="shrink-0 text-xs font-medium">Correct answer</span>}
                  {isPicked && !isCorrect && <span className="shrink-0 text-xs font-medium">Your answer</span>}
                </li>
              );
            })}
          </ul>
          {state === 'skipped' && <p className="text-muted text-xs">Not answered</p>}
          <div className="rounded-lg bg-zinc-50 px-4 py-3 text-sm leading-relaxed dark:bg-zinc-950">
            <span className="font-medium">Explanation: </span>
            <MarkdownView inline>{r.explanation}</MarkdownView>
          </div>
          <SourceChip filename={r.sourceFilename} page={r.sourcePage} />
        </div>
      </div>
    </li>
  );
}

export default function QuizResults() {
  const { id, attemptId } = useParams();
  const location = useLocation();
  const [data, setData] = useState(location.state?.attempt?.id === attemptId ? location.state : null);
  const [error, setError] = useState(null);
  useDocumentTitle(data ? `Results ${data.attempt.score}/${data.attempt.total}` : 'Results');

  useEffect(() => {
    if (data) return;
    generationApi.getAttempt(attemptId).then(setData).catch((err) => setError(getErrorMessage(err, 'Could not load results')));
  }, [attemptId, data]);

  if (error) {
    return (
      <div className="card mx-auto max-w-xl px-6 py-12 text-center">
        <p className="text-sm font-medium">{error}</p>
        <Link to="/history" className="btn-secondary mt-4">Quiz history</Link>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Skeleton className="h-36 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  const { attempt, quiz } = data;
  const pct = attempt.total ? Math.round((attempt.score / attempt.total) * 100) : 0;
  const tone = scoreTone(pct);
  const studyLink = `/study?docs=${quiz.documents.map((d) => d.id).join(',')}&tab=quiz`;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <section className="card p-6 text-center sm:p-8">
        <h1 className="text-muted text-sm font-normal">Your score</h1>
        <p className="mt-1 text-5xl font-semibold tracking-tight tabular-nums">
          {attempt.score}
          <span className="text-muted text-3xl"> / {attempt.total}</span>
        </p>
        <div className="progress-track mx-auto mt-4 max-w-xs">
          <div className="progress-bar" style={{ width: `${pct}%` }} />
        </div>
        <p className={`mt-3 text-sm font-medium ${tone.cls}`}>{pct}% · {tone.text}</p>
        <p className="text-muted mt-1 text-xs">
          <span className="capitalize">{quiz.difficulty}</span>
          {quiz.topic ? ` · ${quiz.topic}` : ''} · {quiz.documents.map((d) => d.filename).join(', ') || 'deleted documents'}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link to={`/quiz/${id}`} className="btn-secondary">
            <RotateCcw className="h-4 w-4" aria-hidden /> Retake
          </Link>
          {quiz.documents.length > 0 && <Link to={studyLink} className="btn-primary">New quiz</Link>}
          <Link to="/history" className="btn-ghost">
            <History className="h-4 w-4" aria-hidden /> History
          </Link>
          <ExportMenu
            label="Export"
            items={[
              { label: 'My results (PDF)', hint: 'Your answers, correct answers, score and explanations', spec: { type: 'attempt', refId: attempt.id }, kind: 'pdf' },
              { label: 'Email my results (PDF)', spec: { type: 'attempt', refId: attempt.id }, kind: 'email' },
              { label: 'Questions only (PDF)', hint: 'For practice', spec: { type: 'quiz', refId: id, options: { variant: 'questions' } }, kind: 'pdf' },
              { label: 'With answer key (PDF)', spec: { type: 'quiz', refId: id, options: { variant: 'answers' } }, kind: 'pdf' },
              { label: 'My results (Markdown)', spec: { type: 'attempt', refId: attempt.id }, kind: 'md' },
            ]}
          />
        </div>
      </section>

      <ol className="space-y-3">
        {attempt.results.map((r, i) => (
          <ResultItem key={r.id} r={r} n={i + 1} />
        ))}
      </ol>
    </div>
  );
}
