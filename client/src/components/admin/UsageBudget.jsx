import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, CheckCircle2, ExternalLink, OctagonAlert, RefreshCw } from 'lucide-react';
import { adminApi } from '../../api/admin.js';
import { getErrorMessage } from '../../api/client.js';
import Skeleton from '../Skeleton.jsx';
import { fmtDateTime, fmtInt, fmtUsd, short } from './format.js';

const STATUS = {
  ok: { label: 'Within budget', Icon: CheckCircle2, bar: 'bg-indigo-600 dark:bg-indigo-400', text: 'text-emerald-700 dark:text-emerald-300' },
  warn: { label: 'Past warning threshold', Icon: AlertTriangle, bar: 'bg-amber-500 dark:bg-amber-400', text: 'text-amber-800 dark:text-amber-300' },
  exhausted: { label: 'Budget used up', Icon: OctagonAlert, bar: 'bg-red-600 dark:bg-red-400', text: 'text-red-700 dark:text-red-300' },
};

/** Headline budget meter: spend vs cap, with the warning threshold marked. */
function BudgetMeter({ b, mock }) {
  const st = STATUS[b.level];
  const spentPct = Math.min(100, (b.spentUsd / b.budgetUsd) * 100);
  const reservedPct = Math.min(100 - spentPct, (b.reservedUsd / b.budgetUsd) * 100);
  return (
    <section className="card p-5 sm:p-6" aria-labelledby="budget-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="budget-heading" className="text-muted text-sm font-medium">AI spend</h2>
        <span className={`inline-flex items-center gap-1 text-sm font-medium ${st.text}`}>
          <st.Icon className="h-4 w-4" aria-hidden /> {st.label}
        </span>
      </div>
      <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">
        {fmtUsd(b.spentUsd)} <span className="text-muted text-lg font-normal">of {fmtUsd(b.budgetUsd)}</span>
      </p>
      <div
        className="relative mt-4 h-2.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
        role="meter"
        aria-label="Budget used"
        aria-valuemin={0}
        aria-valuemax={b.budgetUsd}
        aria-valuenow={b.spentUsd}
        aria-valuetext={`${b.pct}% used`}
      >
        <div className={`absolute inset-y-0 left-0 rounded-full ${st.bar}`} style={{ width: `${spentPct}%` }} />
        {reservedPct > 0 && <div className="absolute inset-y-0 bg-zinc-400/60 dark:bg-zinc-500/60" style={{ left: `${spentPct}%`, width: `${reservedPct}%` }} />}
        <div className="absolute inset-y-0 w-0.5 bg-zinc-900/60 dark:bg-zinc-100/70" style={{ left: `${b.warnPct}%` }} title={`Warning at ${b.warnPct}%`} />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-muted text-xs">Used</dt>
          <dd className="font-medium tabular-nums">{b.pct}%</dd>
        </div>
        <div>
          <dt className="text-muted text-xs">Remaining</dt>
          <dd className="font-medium tabular-nums">{fmtUsd(b.remainingUsd)}</dd>
        </div>
        <div>
          <dt className="text-muted text-xs">In-flight reservations</dt>
          <dd className="font-medium tabular-nums">{fmtUsd(b.reservedUsd)}</dd>
        </div>
        <div>
          <dt className="text-muted text-xs">Warning at</dt>
          <dd className="font-medium tabular-nums">{b.warnPct}%</dd>
        </div>
      </dl>
      {mock && <p className="text-muted mt-3 text-xs">Mock mode (LLM_MOCK / mock providers): nothing is being spent.</p>}
    </section>
  );
}

/** Table with a thin single-hue share bar per row (magnitude only; the value is always printed). */
function BreakdownTable({ title, rows, keyName, keyLabel }) {
  const total = rows.reduce((n, r) => n + r.costUsd, 0) || 1;
  return (
    <section className="card overflow-x-auto">
      <h3 className="border-b border-zinc-200 px-4 py-2.5 text-sm font-semibold dark:border-zinc-800">{title}</h3>
      <table className="w-full min-w-[520px] text-sm">
        <thead>
          <tr className="text-muted text-left text-xs">
            <th className="px-4 py-2 font-medium">{keyLabel}</th>
            <th className="px-4 py-2 text-right font-medium">Calls</th>
            <th className="px-4 py-2 text-right font-medium">Input (cached)</th>
            <th className="px-4 py-2 text-right font-medium">Output</th>
            <th className="px-4 py-2 text-right font-medium">Cost</th>
            <th className="w-28 px-4 py-2 font-medium">Share</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r[keyName]} className="border-t border-zinc-100 dark:border-zinc-800/70">
              <td className="px-4 py-2 font-medium">{r[keyName]}</td>
              <td className="px-4 py-2 text-right tabular-nums">{fmtInt(r.calls)}</td>
              <td className="px-4 py-2 text-right tabular-nums">
                {fmtInt(r.inputTokens)} <span className="text-muted">({fmtInt(r.cachedTokens)})</span>
              </td>
              <td className="px-4 py-2 text-right tabular-nums">{fmtInt(r.outputTokens)}</td>
              <td className="px-4 py-2 text-right tabular-nums">{fmtUsd(r.costUsd)}</td>
              <td className="px-4 py-2">
                <div className="h-1.5 w-full rounded-full bg-zinc-100 dark:bg-zinc-800" aria-hidden>
                  <div className="h-full rounded-full bg-indigo-600 dark:bg-indigo-400" style={{ width: `${(r.costUsd / total) * 100}%` }} />
                </div>
              </td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={6} className="text-muted px-4 py-6 text-center text-sm">No usage recorded yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

export default function UsageBudget() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await adminApi.usage());
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not load usage'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-56 w-full rounded-xl" />
      </div>
    );
  }

  const { budget, byFeature, byModel, daily, recent, estimates } = data;
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button className="btn-ghost px-2 py-1.5" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden /> Refresh
        </button>
      </div>
      <BudgetMeter b={budget} mock={data.mock} />

      <section className="card overflow-x-auto">
        <h3 className="border-b border-zinc-200 px-4 py-2.5 text-sm font-semibold dark:border-zinc-800">Estimated cost per operation</h3>
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-muted text-left text-xs">
              <th className="px-4 py-2 font-medium">Operation</th>
              <th className="px-4 py-2 text-right font-medium">Typical</th>
              <th className="px-4 py-2 text-right font-medium">Worst case</th>
              <th className="px-4 py-2 text-right font-medium">≈ per budget</th>
            </tr>
          </thead>
          <tbody>
            {estimates.operations.map((o) => (
              <tr key={o.operation} className="border-t border-zinc-100 align-top dark:border-zinc-800/70">
                <td className="px-4 py-2">
                  <p className="font-medium">{o.operation}</p>
                  <p className="text-muted text-xs">{o.assumptions}</p>
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{fmtUsd(o.typicalUsd)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{fmtUsd(o.worstUsd)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{o.perBudget ? fmtInt(o.perBudget) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-muted border-t border-zinc-200 px-4 py-2.5 text-xs dark:border-zinc-800">
          From <code>server/src/config/pricing.js</code>:{' '}
          {Object.entries(estimates.pricing)
            .map(([m, p]) => `${m} $${p.input}/$${p.cachedInput}/$${p.output} per 1M in/cached/out`)
            .join(' · ')}
          .{' '}
          <a className="link inline-flex items-center gap-0.5" href="https://openai.com/api/pricing" target="_blank" rel="noreferrer noopener">
            Verify current prices <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        </p>
      </section>

      <BreakdownTable title="Spend by feature" rows={byFeature} keyName="feature" keyLabel="Feature" />
      <BreakdownTable title="Spend by model" rows={byModel} keyName="model" keyLabel="Model" />

      <section className="card overflow-x-auto">
        <h3 className="border-b border-zinc-200 px-4 py-2.5 text-sm font-semibold dark:border-zinc-800">Daily spend (last 14 days)</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted text-left text-xs">
              <th className="px-4 py-2 font-medium">Day</th>
              <th className="px-4 py-2 text-right font-medium">Calls</th>
              <th className="px-4 py-2 text-right font-medium">Cost</th>
            </tr>
          </thead>
          <tbody>
            {daily.map((d) => (
              <tr key={d.day} className="border-t border-zinc-100 dark:border-zinc-800/70">
                <td className="px-4 py-2 tabular-nums">{d.day}</td>
                <td className="px-4 py-2 text-right tabular-nums">{fmtInt(d.calls)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{fmtUsd(d.costUsd)}</td>
              </tr>
            ))}
            {!daily.length && (
              <tr>
                <td colSpan={3} className="text-muted px-4 py-6 text-center text-sm">No spend in the last 14 days.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="card overflow-x-auto">
        <h3 className="border-b border-zinc-200 px-4 py-2.5 text-sm font-semibold dark:border-zinc-800">Recent calls</h3>
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="text-muted text-left text-xs">
              <th className="px-4 py-2 font-medium">When</th>
              <th className="px-4 py-2 font-medium">Feature</th>
              <th className="px-4 py-2 font-medium">Model</th>
              <th className="px-4 py-2 text-right font-medium">In (cached)</th>
              <th className="px-4 py-2 text-right font-medium">Out</th>
              <th className="px-4 py-2 text-right font-medium">Cost</th>
              <th className="px-4 py-2 font-medium">User</th>
              <th className="px-4 py-2 font-medium">Request</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((r) => (
              <tr key={r.id} className="border-t border-zinc-100 dark:border-zinc-800/70">
                <td className="px-4 py-2 whitespace-nowrap tabular-nums">{fmtDateTime(r.createdAt)}</td>
                <td className="px-4 py-2">{r.feature}</td>
                <td className="px-4 py-2 font-mono text-xs">{r.model}</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {fmtInt(r.inputTokens)} <span className="text-muted">({fmtInt(r.cachedTokens)})</span>
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{fmtInt(r.outputTokens)}</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {fmtUsd(r.costUsd)}
                  {r.estimated ? <span className="text-muted" title="Estimated: the provider returned no usage (e.g. a cancelled stream)"> *</span> : null}
                </td>
                <td className="max-w-40 truncate px-4 py-2">{r.userEmail ?? '—'}</td>
                <td className="text-muted px-4 py-2 font-mono text-xs">{short(r.requestId) || '—'}</td>
              </tr>
            ))}
            {!recent.length && (
              <tr>
                <td colSpan={8} className="text-muted px-4 py-6 text-center text-sm">No calls yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
