import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { FolderOpen, MessageSquareText, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useDocuments } from '../hooks/useDocuments.js';
import { documentsApi } from '../api/documents.js';
import { getErrorMessage } from '../api/client.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import UploadDropzone from '../components/UploadDropzone.jsx';
import DocumentList from '../components/DocumentList.jsx';
import Skeleton from '../components/Skeleton.jsx';

function ListSkeleton() {
  return (
    <div className="card divide-y divide-zinc-200 dark:divide-zinc-800" aria-busy="true" aria-label="Loading documents">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-4">
          <Skeleton className="h-4 w-4" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const { documents, setDocuments, loading, refresh } = useDocuments();
  const [selectedIds, setSelectedIds] = useState(new Set());
  const navigate = useNavigate();
  useDocumentTitle('Documents');

  // Only ready documents can stay selected.
  const selected = useMemo(() => {
    const ready = new Set(documents.filter((d) => d.status === 'ready').map((d) => d.id));
    return new Set([...selectedIds].filter((id) => ready.has(id)));
  }, [documents, selectedIds]);

  const toggle = (id) =>
    setSelectedIds((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const onUploaded = (docs) => {
    setDocuments((cur) => [...docs.filter((d) => !d.duplicate).map((d) => ({ ...d, pageCount: null, chunkCount: 0 })), ...cur]);
    refresh({ silent: true });
  };

  const onDelete = async (doc) => {
    try {
      await documentsApi.remove(doc.id);
      setDocuments((cur) => cur.filter((d) => d.id !== doc.id));
      toast.success(`Deleted ${doc.filename}`);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Delete failed'));
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Hi, {user?.name}</h1>
        <p className="text-muted mt-1 text-sm">Upload your notes to summarise, clear your doubts and quiz yourself on.</p>
      </div>

      <UploadDropzone onUploaded={onUploaded} />

      <section className="space-y-3">
        <div className="flex min-h-9 items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Your documents</h2>
            {selected.size === 0 && documents.some((d) => d.status === 'ready') && (
              <p className="text-muted mt-0.5 text-xs">Click a document to study it, or tick several to study them together.</p>
            )}
          </div>
          {selected.size > 0 && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted hidden sm:inline">{selected.size} selected</span>
              <button className="btn-ghost px-2 py-1" onClick={() => setSelectedIds(new Set())} aria-label="Clear selection" title="Clear selection">
                <X className="h-4 w-4" aria-hidden />
              </button>
              <button className="btn-primary px-3 py-1.5" onClick={() => navigate(`/study?docs=${[...selected].join(',')}`)}>
                <MessageSquareText className="h-4 w-4" aria-hidden /> Study {selected.size}
              </button>
            </div>
          )}
        </div>
        {loading ? (
          <ListSkeleton />
        ) : documents.length ? (
          <DocumentList
            documents={documents}
            selected={selected}
            onToggle={toggle}
            onToggleAll={(ids) => setSelectedIds(new Set(ids))}
            onDelete={onDelete}
          />
        ) : (
          <div className="card px-6 py-12 text-center">
            <FolderOpen className="text-muted mx-auto h-8 w-8" aria-hidden />
            <p className="mt-3 text-sm font-medium">No documents yet</p>
            <p className="text-muted mt-1 text-xs">Upload a file above to get started.</p>
          </div>
        )}
      </section>
    </div>
  );
}
