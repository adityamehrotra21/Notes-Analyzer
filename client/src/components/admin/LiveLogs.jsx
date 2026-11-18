import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { ChevronLeft, ChevronRight, Pause, Play, Search, Trash2 } from 'lucide-react';
import { adminApi, streamLogs } from '../../api/admin.js';
import { getErrorMessage } from '../../api/client.js';
import SegmentedControl from '../SegmentedControl.jsx';
import Spinner from '../Spinner.jsx';
import { LEVEL_STYLES, badge, fmtDateTime, fmtTime, short } from './format.js';

const MAX_LIVE = 500;
const LEVELS = ['debug', 'info', 'warn', 'error'];
const EMPTY_FILTERS = { q: '', module: '', requestId: '', userId: '', from: '', to: '' };

function LogRow({ e, onTrace, withDate }) {
  const [open, setOpen] = useState(false);
  const hasMeta = e.meta && Object.keys(e.meta).length > 0;
  return (
    <li className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/70">
      <div className="flex items-start gap-2 px-3 font-mono text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
        {/* Expand (metadata) and trace (request id) are sibling buttons: no nested interactive elements. */}
        <button
          type="button"
          onClick={() => hasMeta && setOpen((o) => !o)}
          aria-expanded={hasMeta ? open : undefined}
          aria-disabled={!hasMeta || undefined}
          className={`flex min-w-0 flex-1 items-start gap-2 py-1.5 text-left ${hasMeta ? '' : 'cursor-default'}`}
        >
          <span className="text-muted shrink-0 tabular-nums">{withDate ? fmtDateTime(e.timestamp) : fmtTime(e.timestamp)}</span>
          <span className={`${badge} w-12 justify-center ${LEVEL_STYLES[e.level]}`}>{e.level}</span>
          <span className="text-muted w-20 shrink-0 truncate">{e.module}</span>
          <span className="min-w-0 flex-1 break-words">
            {e.message}
            {e.durationMs !== null && e.durationMs !== undefined && <span className="text-muted"> · {e.durationMs}ms</span>}
          </span>
        </button>
        {e.requestId && (
          <button
            type="button"
            title="Show every log line from this request"
            aria-label={`Trace request ${short(e.requestId)}`}
            onClick={() => onTrace(e.requestId)}
            className="shrink-0 py-1.5 text-indigo-700 hover:underline dark:text-indigo-300"
          >
            {short(e.requestId)}
          </button>
        )}
      </div>
      {open && (
        <pre className="mx-3 mb-2 overflow-x-auto rounded-md bg-zinc-50 p-2 text-[0.7rem] leading-relaxed dark:bg-zinc-950">
          {JSON.stringify({ ...e.meta, userId: e.userId ?? undefined, requestId: e.requestId ?? undefined }, null, 2)}
        </pre>
      )}
    </li>
  );
}

export default function LiveLogs() {
  const [mode, setMode] = useState('live');
  const [level, setLevel] = useState('info');
  const [modules, setModules] = useState([]);

  // ---- live
  const [entries, setEntries] = useState([]);
  const [paused, setPaused] = useState(false);
  const [pending, setPending] = useState([]);
  const [connected, setConnected] = useState(false);
  const pausedRef = useRef(false);
  const listRef = useRef(null);
  const stick = useRef(true);

  // ---- search
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [result, setResult] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    adminApi
      .logs({ pageSize: 1 })
      .then((r) => setModules(r.modules))
      .catch(() => {});
  }, []);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  // Live tail with auto-reconnect.
  useEffect(() => {
    if (mode !== 'live') return;
    const controller = new AbortController();
    let retry;
    setEntries([]);
    const connect = () => {
      streamLogs({
        level,
        signal: controller.signal,
        onReady: () => setConnected(true),
        onEntry: (e) => {
          if (pausedRef.current) setPending((p) => [...p, e].slice(-MAX_LIVE));
          else setEntries((list) => [...list, e].slice(-MAX_LIVE));
        },
      })
        .catch((err) => {
          if (controller.signal.aborted) return;
          toast.error(err.message, { id: 'log-stream' });
        })
        .finally(() => {
          setConnected(false);
          if (!controller.signal.aborted) retry = setTimeout(connect, 3000);
        });
    };
    connect();
    return () => {
      controller.abort();
      clearTimeout(retry);
    };
  }, [mode, level]);

  // Auto-scroll unless the user scrolled up.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stick.current && mode === 'live') el.scrollTop = el.scrollHeight;
  }, [entries, mode]);

  const onScroll = () => {
    const el = listRef.current;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  const resume = () => {
    setEntries((list) => [...list, ...pending].slice(-MAX_LIVE));
    setPending([]);
    setPaused(false);
    stick.current = true;
  };

  const search = useCallback(
    async (p = 1, f = filters, liveMatches = []) => {
      setLoading(true);
      try {
        const toIso = (v) => (v ? new Date(v).toISOString() : undefined);
        const r = await adminApi.logs({ ...f, from: toIso(f.from), to: toIso(f.to), level, page: p, pageSize: 100 });
        // Logs reach the database in ~2s batches: include matching live lines not persisted yet.
        const key = (e) => `${new Date(e.timestamp).getTime()}|${e.message}`;
        const persisted = new Set(r.items.map(key));
        const extra = p === 1 ? liveMatches.filter((e) => !persisted.has(key(e))) : [];
        setResult(extra.length ? { ...r, items: [...extra.reverse(), ...r.items], total: r.total + extra.length } : r);
        setPage(p);
      } catch (err) {
        toast.error(getErrorMessage(err, 'Log search failed'));
      } finally {
        setLoading(false);
      }
    },
    [filters, level],
  );

  // Re-run the search when the level changes (switching to Search mode searches explicitly, below).
  useEffect(() => {
    if (mode === 'search') search(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level]);

  const changeMode = (m) => {
    setMode(m);
    if (m === 'search') search(1);
  };

  const trace = (requestId) => {
    const f = { ...EMPTY_FILTERS, requestId };
    setFilters(f);
    setMode('search');
    search(1, f, entries.filter((e) => e.requestId === requestId));
  };

  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const pages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl label="Log view" options={[{ value: 'live', label: 'Live' }, { value: 'search', label: 'Search' }]} value={mode} onChange={changeMode} />
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted">Min level</span>
          <select className="input w-28 py-1.5" value={level} onChange={(e) => setLevel(e.target.value)}>
            {LEVELS.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </label>
        {mode === 'live' && (
          <>
            <span className={`text-xs ${connected ? 'text-emerald-700 dark:text-emerald-300' : 'text-muted'}`} aria-live="polite">
              {connected ? '● Live' : '○ Connecting…'}
            </span>
            <div className="ml-auto flex items-center gap-2">
              {paused ? (
                <button className="btn-primary px-3 py-1.5" onClick={resume}>
                  <Play className="h-4 w-4" aria-hidden /> Resume{pending.length ? ` (${pending.length} new)` : ''}
                </button>
              ) : (
                <button className="btn-secondary px-3 py-1.5" onClick={() => setPaused(true)}>
                  <Pause className="h-4 w-4" aria-hidden /> Pause
                </button>
              )}
              <button className="btn-ghost px-2 py-1.5" onClick={() => setEntries([])} title="Clear view" aria-label="Clear view">
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </>
        )}
      </div>

      {mode === 'search' && (
        <form
          className="card grid gap-3 p-3 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            search(1);
          }}
        >
          <input className="input sm:col-span-2" placeholder="Search message or metadata…" value={filters.q} onChange={set('q')} aria-label="Text search" />
          <select className="input" value={filters.module} onChange={set('module')} aria-label="Module">
            <option value="">All modules</option>
            {modules.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <input className="input font-mono" placeholder="Request id" value={filters.requestId} onChange={set('requestId')} aria-label="Request id" />
          <input className="input font-mono" placeholder="User id" value={filters.userId} onChange={set('userId')} aria-label="User id" />
          <div className="flex gap-2">
            <input type="datetime-local" className="input" value={filters.from} onChange={set('from')} aria-label="From" />
            <input type="datetime-local" className="input" value={filters.to} onChange={set('to')} aria-label="To" />
          </div>
          <div className="flex items-center gap-2 sm:col-span-3">
            <button type="submit" className="btn-primary px-3 py-1.5" disabled={loading}>
              {loading ? <Spinner className="h-4 w-4 text-white" /> : <Search className="h-4 w-4" aria-hidden />} Search
            </button>
            <button
              type="button"
              className="btn-ghost px-3 py-1.5"
              onClick={() => {
                setFilters(EMPTY_FILTERS);
                search(1, EMPTY_FILTERS);
              }}
            >
              Reset
            </button>
            {result && <span className="text-muted ml-auto text-xs">{result.total.toLocaleString()} matching entries</span>}
          </div>
        </form>
      )}

      <div className="card overflow-hidden">
        <ul ref={listRef} onScroll={onScroll} className="max-h-[60vh] min-h-64 overflow-y-auto" aria-label="Log entries" aria-live={mode === 'live' && !paused ? 'off' : undefined}>
          {(mode === 'live' ? entries : (result?.items ?? [])).map((e, i) => (
            <LogRow key={e.id ?? `${e.timestamp}-${i}`} e={e} onTrace={trace} withDate={mode === 'search'} />
          ))}
          {mode === 'live' && !entries.length && <li className="text-muted px-4 py-10 text-center text-sm">Waiting for log entries…</li>}
          {mode === 'search' && result && !result.items.length && <li className="text-muted px-4 py-10 text-center text-sm">No log entries match.</li>}
        </ul>
      </div>

      {mode === 'search' && result && pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <button className="btn-secondary px-2 py-1" disabled={page <= 1 || loading} onClick={() => search(page - 1)} aria-label="Previous page">
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
          <span className="text-muted tabular-nums">Page {page} of {pages}</span>
          <button className="btn-secondary px-2 py-1" disabled={page >= pages || loading} onClick={() => search(page + 1)} aria-label="Next page">
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
      )}
      <p className="text-muted text-xs">Click a row to see its metadata, or a request id to trace every log line from that request.</p>
    </div>
  );
}
