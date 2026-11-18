export const LEVEL_STYLES = {
  debug: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  info: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300',
  warn: 'bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
  error: 'bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300',
};

export const ACTION_STYLES = {
  create: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
  update: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300',
  delete: 'bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300',
};

export const badge = 'inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[0.7rem] font-semibold uppercase tracking-wide';

export const fmtTime = (t) => {
  const d = new Date(t);
  return `${d.toLocaleTimeString(undefined, { hour12: false })}.${String(d.getMilliseconds()).padStart(3, '0')}`;
};

export const fmtDateTime = (t) =>
  new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

/** $0.0042 for tiny amounts, $1.23 otherwise. */
export const fmtUsd = (n) => {
  const v = Number(n) || 0;
  if (v === 0) return '$0';
  if (v >= 0.1) return `$${v.toFixed(2)}`;
  return v >= 0.001 ? `$${v.toFixed(4)}` : `$${v.toFixed(6)}`;
};

export const fmtInt = (n) => (Number(n) || 0).toLocaleString();
export const short = (id) => (id ? String(id).slice(0, 8) : '');
