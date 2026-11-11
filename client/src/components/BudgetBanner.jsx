import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, OctagonAlert } from 'lucide-react';
import { budgetApi } from '../api/admin.js';

const POLL_MS = 60_000;
const usd = (n) => '$' + n.toFixed(2);

/**
 * App-wide notice about AI generation availability.
 * - Users: shown only when generation is unavailable (budget cap hit); no money is mentioned.
 * - Admins: also warned past the threshold, with amounts (cost is admin-only information).
 */
export default function BudgetBanner() {
  const [s, setS] = useState(null);

  const refresh = useCallback(() => {
    budgetApi
      .status()
      .then(setS)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(() => document.visibilityState === 'visible' && refresh(), POLL_MS);
    window.addEventListener('budget:refresh', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(t);
      window.removeEventListener('budget:refresh', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [refresh]);

  if (!s || s.level === 'ok') return null;
  const exhausted = s.level === 'exhausted';
  const Icon = exhausted ? OctagonAlert : AlertTriangle;

  let message;
  if (!s.admin) {
    message = (
      <>
        <span className="font-semibold">Generation is temporarily unavailable.</span> Saved notes, quizzes and chats still work.
      </>
    );
  } else {
    const amounts = `${usd(s.spentUsd)} of ${usd(s.budgetUsd)} used`;
    message = exhausted ? (
      <>
        <span className="font-semibold">AI budget used up (admin).</span> Generation is paused for everyone ({amounts}). Raise LLM_BUDGET_USD to resume.
      </>
    ) : (
      <>
        <span className="font-semibold">AI budget past {s.warnPct}% (admin).</span> {Math.round(s.pct)}% used ({amounts}).
      </>
    );
  }

  return (
    <div
      role="status"
      className={`border-t text-sm ${
        exhausted
          ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200'
          : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200'
      }`}
    >
      <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-2 sm:px-6">
        <Icon className="h-4 w-4 shrink-0" aria-hidden />
        <p>{message}</p>
      </div>
    </div>
  );
}
