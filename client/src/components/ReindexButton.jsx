import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { RefreshCcw } from 'lucide-react';
import { documentsApi } from '../api/documents.js';
import { getErrorMessage } from '../api/client.js';
import Spinner from './Spinner.jsx';

/** Re-chunk + re-embed a document from its stored PDF, after confirming what will change. */
export default function ReindexButton({ doc, onDone }) {
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  // Set true on (re)mount too: StrictMode mounts, unmounts and remounts in dev.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  if (!doc.hasFile) {
    return (
      <span className="text-muted text-xs" title="Files uploaded before re-indexing existed weren't stored. Upload the same PDF again once.">
        Re-upload this PDF once to enable re-indexing
      </span>
    );
  }

  const run = async () => {
    setBusy(true);
    try {
      const { estimate: e } = await documentsApi.reindexEstimate(doc.id);
      const ok = window.confirm(
        `Re-index "${e.filename}"?\n\n` +
          `${e.pageCount} pages → ${e.newChunks} chunks (currently ${e.currentChunks}).\n\n` +
          'This will replace the current index. Saved notes, questions and quizzes are kept, and the current index stays in use until the new one is ready. Continue?',
      );
      if (!ok) return;
      await documentsApi.reindex(doc.id);
      toast('Re-indexing…', { id: `reindex-${doc.id}` });
      // Poll until the job finishes.
      for (;;) {
        await new Promise((r) => setTimeout(r, 1500));
        if (!alive.current) return;
        const d = await documentsApi.get(doc.id);
        if (d.status !== 'processing') {
          if (d.error) toast.error(d.error, { id: `reindex-${doc.id}` });
          else toast.success(`Re-indexed: ${d.chunkCount} chunks`, { id: `reindex-${doc.id}` });
          onDone?.(d);
          return;
        }
      }
    } catch (err) {
      toast.error(getErrorMessage(err, 'Re-index failed'));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  return (
    <button className="btn-secondary px-3 py-1.5" onClick={run} disabled={busy} title="Re-chunk and re-embed this document">
      {busy ? <Spinner className="h-4 w-4" /> : <RefreshCcw className="h-4 w-4" aria-hidden />}
      {busy ? 'Re-indexing…' : 'Re-index'}
    </button>
  );
}
