import { useEffect, useId, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { ChevronDown, Download, FileText, Mail } from 'lucide-react';
import { downloadExport, emailExport } from '../api/export.js';
import { getErrorMessage } from '../api/client.js';
import Spinner from './Spinner.jsx';

/**
 * "Export" dropdown. items: [{ label, spec, kind: 'pdf' | 'md' | 'email', hint? }]
 * spec is the POST /api/export body (type, documentId, refId, options).
 */
export default function ExportMenu({ items, label = 'Export', compact = false, align = 'right' }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const run = async (item) => {
    setOpen(false);
    setBusy(true);
    const id = toast.loading(item.kind === 'email' ? 'Preparing the PDF and sending it…' : `Preparing ${item.kind === 'md' ? 'Markdown' : 'PDF'}…`);
    try {
      if (item.kind === 'email') {
        const r = await emailExport(item.spec);
        toast.success(`Sent to ${r.to}`, { id });
      } else {
        const filename = await downloadExport({ ...item.spec, format: item.kind === 'md' ? 'md' : 'pdf' });
        toast.success(`Downloaded ${filename}`, { id });
      }
    } catch (err) {
      toast.error(getErrorMessage(err, err.message || 'Export failed'), { id });
    } finally {
      setBusy(false);
    }
  };

  const Icon = { pdf: Download, md: FileText, email: Mail };
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className={compact ? 'btn-ghost p-1.5' : 'btn-secondary px-3 py-1.5'}
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        title={label}
        aria-label={compact ? label : undefined}
      >
        {busy ? <Spinner className="h-4 w-4" /> : <Download className="h-4 w-4" aria-hidden />}
        {!compact && (
          <>
            {label}
            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
          </>
        )}
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          className={`absolute z-20 mt-1 w-64 overflow-hidden rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 ${align === 'right' ? 'right-0' : 'left-0'}`}
        >
          {items.map((item) => {
            const I = Icon[item.kind] ?? Download;
            return (
              <button
                key={item.label}
                role="menuitem"
                type="button"
                onClick={() => run(item)}
                className="flex w-full items-start gap-2.5 px-3 py-2 text-left text-sm hover:bg-zinc-50 focus:bg-zinc-50 focus:outline-none dark:hover:bg-zinc-800 dark:focus:bg-zinc-800"
              >
                <I className="text-muted mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>
                  <span className="block">{item.label}</span>
                  {item.hint && <span className="text-muted block text-xs">{item.hint}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Standard items: PDF, Markdown, email. */
export const standardItems = (spec, { pdfLabel = 'Download PDF', mdLabel = 'Download Markdown (.md)', emailLabel = 'Email PDF to me' } = {}) => [
  { label: pdfLabel, spec, kind: 'pdf' },
  { label: mdLabel, spec, kind: 'md' },
  { label: emailLabel, spec, kind: 'email' },
];
