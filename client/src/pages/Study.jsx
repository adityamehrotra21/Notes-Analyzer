import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, BookOpen, ClipboardCheck, FileText, HelpCircle, MessageCircleQuestion } from 'lucide-react';
import { documentsApi } from '../api/documents.js';
import { getErrorMessage } from '../api/client.js';
import { useSessionState } from '../hooks/useSessionState.js';
import Tabs, { TAB_PANEL_ID, tabId } from '../components/Tabs.jsx';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import Skeleton from '../components/Skeleton.jsx';
import ChatPanel from '../components/chat/ChatPanel.jsx';
import SummaryPanel from '../components/SummaryPanel.jsx';
import ReindexButton from '../components/ReindexButton.jsx';
import ExportMenu from '../components/ExportMenu.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import QuestionsPanel from '../components/QuestionsPanel.jsx';
import QuizSetup from '../components/quiz/QuizSetup.jsx';

const TABS = [
  { id: 'summary', label: 'Summary', Icon: BookOpen },
  { id: 'doubts', label: 'Doubts', Icon: MessageCircleQuestion },
  { id: 'questions', label: 'Questions', Icon: HelpCircle },
  { id: 'quiz', label: 'Quiz', Icon: ClipboardCheck },
];

export default function Study() {
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const ids = useMemo(() => [...new Set((params.get('docs') ?? '').split(',').filter(Boolean))].sort(), [params]);
  const rawTab = params.get('tab') === 'chat' ? 'doubts' : params.get('tab'); // old links
  const tab = TABS.some((t) => t.id === rawTab) ? rawTab : 'summary';

  const [docs, setDocs] = useState(null);
  const [error, setError] = useState(null);
  const key = ids.join(',');

  // Doubts live here (not in ChatPanel) so switching tabs keeps the conversation.
  const [messages, setMessages] = useSessionState(`na_chat:${key}`, []);
  const [summaryMode, setSummaryMode] = useState('detailed');
  const [summaries, setSummaries] = useState({});
  const [questionSets, setQuestionSets] = useState({});

  useEffect(() => {
    let cancelled = false;
    setDocs(null);
    setError(null);
    documentsApi
      .list()
      .then((all) => {
        if (cancelled) return;
        const found = all.filter((d) => ids.includes(d.id));
        if (found.length !== ids.length) setError('Some of these documents no longer exist.');
        else if (found.some((d) => d.status !== 'ready')) setError('Some of these documents are not ready yet.');
        setDocs(found);
      })
      .catch((err) => !cancelled && setError(getErrorMessage(err, 'Could not load documents')));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const title = docs ? (docs.length === 1 ? docs[0].filename : `${docs.length} documents`) : null;
  useDocumentTitle(title ? `${TABS.find((t) => t.id === tab).label} · ${title}` : 'Study');

  if (!ids.length) return <Navigate to="/dashboard" replace />;

  const setTab = (id) =>
    setParams((p) => {
      const next = new URLSearchParams(p);
      next.set('tab', id);
      return next;
    }, { replace: true });


  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Link to="/dashboard" className="text-muted inline-flex items-center gap-1 text-sm hover:text-zinc-900 dark:hover:text-zinc-100">
          <ArrowLeft className="h-4 w-4" aria-hidden /> Documents
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          {title ? <h1 className="min-w-0 truncate text-2xl font-semibold tracking-tight">{title}</h1> : <Skeleton className="h-8 w-64" />}
          {docs?.length === 1 && (
            <div className="flex items-center gap-3">
              <span className="text-muted text-xs tabular-nums">
                {docs[0].pageCount} {docs[0].pageCount === 1 ? 'page' : 'pages'}
              </span>
              {/* Re-index is an admin maintenance tool; normal users never see it. */}
              <ExportMenu
                label="Export all"
                items={[
                  { label: 'Study pack (PDF)', hint: 'Notes + Q&A + latest quiz with answer key', spec: { type: 'all', documentId: docs[0].id }, kind: 'pdf' },
                  { label: 'Email study pack to me', spec: { type: 'all', documentId: docs[0].id }, kind: 'email' },
                  { label: 'Study pack (Markdown)', spec: { type: 'all', documentId: docs[0].id }, kind: 'md' },
                ]}
              />
              {isAdmin && <ReindexButton doc={docs[0]} onDone={(d) => setDocs([{ ...docs[0], ...d }])} />}
            </div>
          )}
        </div>
        {docs && docs.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {docs.map((d) => (
              <span key={d.id} className="chip">
                <FileText className="h-3 w-3" aria-hidden /> {d.filename}
              </span>
            ))}
          </div>
        )}
      </div>

      {error ? (
        <div className="card px-6 py-12 text-center">
          <p className="text-sm font-medium">{error}</p>
          <Link to="/dashboard" className="btn-secondary mt-4">Back to documents</Link>
        </div>
      ) : (
        <>
          <Tabs tabs={TABS} active={tab} onChange={setTab} label="Study tools" />
          <div role="tabpanel" id={TAB_PANEL_ID} aria-labelledby={tabId(tab)}>
          {tab === 'doubts' && (docs ? <ChatPanel documentIds={ids} messages={messages} setMessages={setMessages} /> : <Skeleton className="h-96 w-full rounded-xl" />)}
          {tab === 'summary' &&
            (docs ? (
              <SummaryPanel docs={docs} mode={summaryMode} setMode={setSummaryMode} state={summaries} setState={setSummaries} />
            ) : (
              <Skeleton className="h-64 w-full rounded-xl" />
            ))}
          {tab === 'questions' && <QuestionsPanel documentIds={ids} state={questionSets} setState={setQuestionSets} />}
          {tab === 'quiz' && <QuizSetup documentIds={ids} />}
          </div>
        </>
      )}
    </div>
  );
}
