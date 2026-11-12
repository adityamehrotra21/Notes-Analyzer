import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { documentsApi } from '../api/documents.js';
import { getErrorMessage } from '../api/client.js';

const POLL_MS = 3000;

/** Loads the user's documents and polls while any are still processing. */
export function useDocuments() {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const prev = useRef(new Map());

  const refresh = useCallback(async ({ silent = false } = {}) => {
    try {
      const docs = await documentsApi.list();
      // Toast on processing -> ready/failed transitions.
      for (const d of docs) {
        const before = prev.current.get(d.id);
        if (before === 'processing' && d.status === 'ready') toast.success(`${d.filename} is ready`);
        if (before === 'processing' && d.status === 'failed') toast.error(`${d.filename}: ${d.error ?? 'processing failed'}`);
      }
      prev.current = new Map(docs.map((d) => [d.id, d.status]));
      setDocuments(docs);
    } catch (err) {
      if (!silent) toast.error(getErrorMessage(err, 'Could not load documents'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const anyProcessing = documents.some((d) => d.status === 'processing');
  useEffect(() => {
    if (!anyProcessing) return;
    const t = setInterval(() => document.visibilityState === 'visible' && refresh({ silent: true }), POLL_MS);
    return () => clearInterval(t);
  }, [anyProcessing, refresh]);

  return { documents, setDocuments, loading, refresh };
}
