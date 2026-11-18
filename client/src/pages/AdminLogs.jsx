import { Link, useSearchParams } from 'react-router-dom';
import { Gauge, History, ScrollText, ShieldAlert } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import Tabs, { TAB_PANEL_ID, tabId } from '../components/Tabs.jsx';
import LiveLogs from '../components/admin/LiveLogs.jsx';
import ChangeLog from '../components/admin/ChangeLog.jsx';
import UsageBudget from '../components/admin/UsageBudget.jsx';

const TABS = [
  { id: 'live', label: 'Live Logs', Icon: ScrollText },
  { id: 'changes', label: 'Change Log', Icon: History },
  { id: 'usage', label: 'Usage & Budget', Icon: Gauge },
];

export default function AdminLogs() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'live';
  useDocumentTitle(`Logs · ${TABS.find((t) => t.id === tab).label}`);

  if (user?.role !== 'admin') {
    return (
      <div className="card mx-auto max-w-md px-6 py-12 text-center">
        <ShieldAlert className="text-muted mx-auto h-8 w-8" aria-hidden />
        <h1 className="mt-3 font-semibold">Admins only</h1>
        <p className="text-muted mt-1 text-sm">
          Ask an admin to run <code>npm run make-admin -- your@email</code>.
        </p>
        <Link to="/dashboard" className="btn-secondary mt-5">Back to documents</Link>
      </div>
    );
  }

  const setTab = (id) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        next.set('tab', id);
        return next;
      },
      { replace: true },
    );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Logs</h1>
        <p className="text-muted mt-1 text-sm">Live application logs, the change history, and AI spend against the budget.</p>
      </div>
      <Tabs tabs={TABS} active={tab} onChange={setTab} label="Log views" />
      <div role="tabpanel" id={TAB_PANEL_ID} aria-labelledby={tabId(tab)}>
        {tab === 'live' && <LiveLogs />}
        {tab === 'changes' && <ChangeLog />}
        {tab === 'usage' && <UsageBudget />}
      </div>
    </div>
  );
}
