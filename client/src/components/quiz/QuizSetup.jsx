import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ClipboardCheck, History, Play } from 'lucide-react';
import { generationApi } from '../../api/generation.js';
import { getErrorMessage } from '../../api/client.js';
import SegmentedControl from '../SegmentedControl.jsx';
import Spinner from '../Spinner.jsx';

const DIFFICULTIES = [
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
];
const COUNTS = [5, 10, 12]; // server max is 12 so answers fit the output cap

export default function QuizSetup({ documentIds }) {
  const navigate = useNavigate();
  const [difficulty, setDifficulty] = useState('medium');
  const [count, setCount] = useState(10);
  const [topic, setTopic] = useState('');
  const [fresh, setFresh] = useState(false);
  const [busy, setBusy] = useState(false);

  const start = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await generationApi.generateQuiz({ documentIds, difficulty, count, topic: topic.trim() || undefined, fresh });
      navigate(`/quiz/${r.quiz.id}`, { state: { quiz: r.quiz, cached: r.cached } });
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not create the quiz'));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={start} className="card mx-auto max-w-xl space-y-6 p-6 sm:p-8">
      <div className="flex items-start gap-3">
        <ClipboardCheck className="mt-0.5 h-6 w-6 shrink-0 text-indigo-600 dark:text-indigo-400" aria-hidden />
        <div>
          <h2 className="font-semibold">Multiple-choice quiz</h2>
          <p className="text-muted mt-0.5 text-sm">Questions come only from the selected notes. You get the answers and explanations when you submit.</p>
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <span className="label">Difficulty</span>
          <SegmentedControl label="Difficulty" options={DIFFICULTIES} value={difficulty} onChange={setDifficulty} />
        </div>
        <div>
          <span className="label">Questions</span>
          <SegmentedControl label="Number of questions" options={COUNTS.map((c) => ({ value: c, label: String(c) }))} value={count} onChange={setCount} />
        </div>
      </div>
      <label className="block">
        <span className="label">Topic <span className="text-muted font-normal">(optional)</span></span>
        <input className="input" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Leave empty to cover all the material" maxLength={200} />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={fresh} onChange={(e) => setFresh(e.target.checked)} />
        Always generate new questions
        <span className="text-muted text-xs">(otherwise a saved quiz with the same settings is reused)</span>
      </label>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to="/history" className="btn-ghost -ml-2 px-2">
          <History className="h-4 w-4" aria-hidden /> Quiz history
        </Link>
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? <Spinner className="h-4 w-4 text-white" label={undefined} /> : <Play className="h-4 w-4" aria-hidden />}
          {busy ? 'Creating quiz…' : 'Start quiz'}
        </button>
      </div>
    </form>
  );
}
