import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, ArrowRight, Check, RotateCcw } from 'lucide-react';
import { generationApi } from '../api/generation.js';
import { getErrorMessage } from '../api/client.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { useSessionState } from '../hooks/useSessionState.js';
import Skeleton from '../components/Skeleton.jsx';
import Spinner from '../components/Spinner.jsx';
import MarkdownView from '../components/Markdown.jsx';

const LETTERS = ['A', 'B', 'C', 'D'];

export default function QuizPlay() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [quiz, setQuiz] = useState(location.state?.quiz?.id === id ? location.state.quiz : null);
  const [error, setError] = useState(null);
  const [answers, setAnswers] = useSessionState(`na_quiz:${id}`, {});
  const [current, setCurrent] = useSessionState(`na_quiz_pos:${id}`, 0);
  const [submitting, setSubmitting] = useState(false);
  const reused = location.state?.cached;
  useDocumentTitle(quiz ? `Quiz · question ${current + 1} of ${quiz.questions.length}` : 'Quiz');

  useEffect(() => {
    if (quiz) return;
    generationApi.getQuiz(id).then(setQuiz).catch((err) => setError(getErrorMessage(err, 'Could not load the quiz')));
  }, [id, quiz]);

  const total = quiz?.questions.length ?? 0;
  const q = quiz?.questions[current];
  const answered = Object.keys(answers).length;

  const choose = (i) => setAnswers((a) => ({ ...a, [current]: i }));

  // Keyboard: 1-4 / A-D choose, arrows move.
  useEffect(() => {
    const onKey = (e) => {
      if (!q || e.target.closest('input, textarea, select') || e.metaKey || e.ctrlKey) return;
      const k = e.key.toLowerCase();
      const idx = ['1', '2', '3', '4'].indexOf(k) >= 0 ? Number(k) - 1 : ['a', 'b', 'c', 'd'].indexOf(k);
      if (idx >= 0) choose(idx);
      else if (e.key === 'ArrowRight') setCurrent((c) => Math.min(total - 1, c + 1));
      else if (e.key === 'ArrowLeft') setCurrent((c) => Math.max(0, c - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const submit = async () => {
    const missing = total - answered;
    if (missing > 0 && !window.confirm(`${missing} question${missing > 1 ? 's are' : ' is'} unanswered. Submit anyway?`)) return;
    setSubmitting(true);
    try {
      const list = Array.from({ length: total }, (_, i) => answers[i] ?? null);
      const r = await generationApi.submitQuiz(id, list);
      try {
        sessionStorage.removeItem(`na_quiz:${id}`);
        sessionStorage.removeItem(`na_quiz_pos:${id}`);
      } catch {
        /* ignore */
      }
      navigate(`/quiz/${id}/results/${r.attempt.id}`, { state: r, replace: true });
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not submit the quiz'));
      setSubmitting(false);
    }
  };

  if (error) {
    return (
      <div className="card mx-auto max-w-xl px-6 py-12 text-center">
        <p className="text-sm font-medium">{error}</p>
        <Link to="/dashboard" className="btn-secondary mt-4">Back to documents</Link>
      </div>
    );
  }
  if (!quiz) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Skeleton className="h-2 w-full" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  const progress = Math.round((answered / total) * 100);
  const isLast = current === total - 1;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-2">
        <div className="text-muted flex items-center justify-between text-sm">
          <span>
            Question <span className="font-semibold text-zinc-900 tabular-nums dark:text-zinc-100">{current + 1}</span> of {total}
          </span>
          <span>
            <span className="capitalize">{quiz.difficulty}</span>
            {quiz.topic ? ` · ${quiz.topic}` : ''}
          </span>
        </div>
        <div className="progress-track" role="progressbar" aria-label="Answered" aria-valuenow={answered} aria-valuemin={0} aria-valuemax={total}>
          <div className="progress-bar" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {reused && current === 0 && answered === 0 && (
        <p className="text-muted flex items-center gap-1.5 text-xs">
          <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Reusing a saved quiz with these settings. Tick "Always generate new questions" for a fresh one.
        </p>
      )}

      <div className="card p-6 sm:p-8">
        <h1 className="text-lg leading-snug font-semibold">
          <MarkdownView inline>{q.question}</MarkdownView>
        </h1>
        <div role="radiogroup" aria-label="Options" className="mt-6 space-y-2.5">
          {q.options.map((opt, i) => {
            const selected = answers[current] === i;
            return (
              <button
                key={i}
                role="radio"
                aria-checked={selected}
                onClick={() => choose(i)}
                className={`option flex items-start gap-3 ${selected ? 'option-selected' : ''}`}
              >
                <span
                  className={`mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-xs font-semibold ${
                    selected ? 'border-indigo-600 bg-indigo-600 text-white dark:border-indigo-400 dark:bg-indigo-400 dark:text-zinc-950' : 'border-zinc-300 text-zinc-500 dark:border-zinc-600 dark:text-zinc-400'
                  }`}
                >
                  {LETTERS[i]}
                </span>
                <span>
                  <MarkdownView inline>{opt}</MarkdownView>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <button className="btn-secondary" onClick={() => setCurrent((c) => c - 1)} disabled={current === 0}>
          <ArrowLeft className="h-4 w-4" aria-hidden /> Previous
        </button>
        <div className="hidden gap-1 sm:flex" aria-label="Jump to question">
          {quiz.questions.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrent(i)}
              aria-label={`Question ${i + 1}${answers[i] !== undefined ? ', answered' : ''}`}
              className={`h-2.5 w-2.5 rounded-full ${
                i === current ? 'bg-indigo-600 dark:bg-indigo-400' : answers[i] !== undefined ? 'bg-zinc-400 dark:bg-zinc-500' : 'bg-zinc-200 dark:bg-zinc-800'
              }`}
            />
          ))}
        </div>
        {isLast ? (
          <button className="btn-primary" onClick={submit} disabled={submitting}>
            {submitting ? <Spinner className="h-4 w-4 text-white" /> : <Check className="h-4 w-4" aria-hidden />} Submit
          </button>
        ) : (
          <button className="btn-primary" onClick={() => setCurrent((c) => c + 1)}>
            Next <ArrowRight className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>
      <p className="text-muted hidden text-center text-xs sm:block">Tip: press 1–4 to answer, ← → to move.</p>
    </div>
  );
}
