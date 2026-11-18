import { Fragment, useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { adminApi } from '../../api/admin.js';
import { getErrorMessage } from '../../api/client.js';
import Skeleton from '../Skeleton.jsx';
import { ACTION_STYLES, badge, fmtDateTime, short } from './format.js';

const show = (v) => (v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

function Diff({ changes }) {
  const before = changes?.before ?? {};
  const after = changes?.after ?? {};
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  if (!keys.length) return <p className="text-muted text-xs">No field changes recorded.</p>;
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-muted text-left">
          <th className="py-1 pr-3 font-medium">Field</th>
          <th className="py-1 pr-3 font-medium">Before</th>
          <th className="py-1 font-medium">After</th>
        </tr>
      </thead>
      <tbody className="font-mono">
        {keys.map((k) => (
          <tr key={k} className="border-t border-zinc-200 align-top dark:border-zinc-800">
            <td className="py-1.5 pr-3 font-sans font-medium">{k}</td>
            <td className="py-1.5 pr-3 break-all text-red-700 dark:text-red-300">{changes?.before ? show(before[k]) : '—'}</td>
            <td className="py-1.5 break-all text-emerald-700 dark:text-emerald-300">{changes?.after ? show(after[k]) : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function ChangeLog() {
  const [filters, setFilters] = useState({ entity: '', action: '' });
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null);

  const load = useCallback(
    async (p = 1) => {
      try {
        const r = await adminApi.audit({ ...filters, page: p, pageSize: 50 });
        setData(r);
        setPage(p);
      } catch (err) {
        toast.error(getErrorMessage(err, 'Could not load the change log'));
      }
    },
    [filters],
  );

  useEffect(() => {
    load(1);
  }, [load]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select className="input w-44 py-1.5" value={filters.entity} onChange={(e) => setFilters((f) => ({ ...f, entity: e.target.value }))} aria-label="Entity">
          <option value="">All entities</option>
          {(data?.entities ?? []).map((e) => (
            <option key={e} value={e}>{e}</option>
          ))}
        </select>
        <select className="input w-36 py-1.5" value={filters.action} onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))} aria-label="Action">
          <option value="">All actions</option>
          <option value="create">create</option>
          <option value="update">update</option>
          <option value="delete">delete</option>
        </select>
        {data && <span className="text-muted ml-auto text-xs">{data.total.toLocaleString()} changes</span>}
      </div>

      {!data ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-muted border-b border-zinc-200 text-left text-xs dark:border-zinc-800">
                <th className="w-8 px-3 py-2">
                  <span className="sr-only">Expand</span>
                </th>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">User</th>
                <th className="px-3 py-2 font-medium">Action</th>
                <th className="px-3 py-2 font-medium">Entity</th>
                <th className="px-3 py-2 font-medium">Entity id</th>
                <th className="px-3 py-2 font-medium">Request</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((r) => {
                const isOpen = open === r.id;
                return (
                  <Fragment key={r.id}>
                    <tr
                      className="cursor-pointer border-b border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800/70 dark:hover:bg-zinc-800/50"
                      onClick={() => setOpen(isOpen ? null : r.id)}
                    >
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          aria-label={isOpen ? 'Hide changes' : 'Show changes'}
                          className="text-muted"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpen(isOpen ? null : r.id);
                          }}
                        >
                          <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden />
                        </button>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap tabular-nums">{fmtDateTime(r.createdAt)}</td>
                      <td className="max-w-48 truncate px-3 py-2">{r.userEmail ?? (r.userId ? short(r.userId) : <span className="text-muted">system</span>)}</td>
                      <td className="px-3 py-2">
                        <span className={`${badge} ${ACTION_STYLES[r.action]}`}>{r.action}</span>
                      </td>
                      <td className="px-3 py-2">{r.entity}</td>
                      <td className="px-3 py-2 font-mono text-xs">{short(r.entityId)}</td>
                      <td className="text-muted px-3 py-2 font-mono text-xs">{short(r.requestId) || '—'}</td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-zinc-100 bg-zinc-50/60 dark:border-zinc-800/70 dark:bg-zinc-950/40">
                        <td />
                        <td colSpan={6} className="px-3 py-3">
                          <Diff changes={r.changes} />
                          <p className="text-muted mt-2 font-mono text-[0.7rem] break-all">
                            {r.entity} {r.entityId} · request {r.requestId ?? '—'}
                          </p>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {!data.items.length && (
                <tr>
                  <td colSpan={7} className="text-muted px-4 py-10 text-center text-sm">No changes recorded yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {data && pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <button className="btn-secondary px-2 py-1" disabled={page <= 1} onClick={() => load(page - 1)} aria-label="Previous page">
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
          <span className="text-muted tabular-nums">Page {page} of {pages}</span>
          <button className="btn-secondary px-2 py-1" disabled={page >= pages} onClick={() => load(page + 1)} aria-label="Next page">
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
