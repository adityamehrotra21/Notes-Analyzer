import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Check, KeyRound, Laptop, LogOut, MonitorSmartphone, Smartphone, X } from 'lucide-react';
import { authApi } from '../api/auth.js';
import { getErrorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import PasswordInput from '../components/PasswordInput.jsx';
import Skeleton from '../components/Skeleton.jsx';
import Spinner from '../components/Spinner.jsx';

/** "Chrome on macOS" from a user-agent string (good enough for a device list). */
function describeDevice(ua = '') {
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /curl|node|axios/i.test(ua) ? 'API client' : 'Browser';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'unknown OS';
  const mobile = /iPhone|Android|Mobile/.test(ua);
  return { label: `${browser} on ${os}`, Icon: mobile ? Smartphone : Laptop };
}

const ago = (d) => {
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 90) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  return new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

const RULES = [
  { test: (p) => p.length >= 8, label: 'At least 8 characters' },
  { test: (p) => /[A-Za-z]/.test(p), label: 'A letter' },
  { test: (p) => /\d/.test(p), label: 'A number' },
];

function ChangePassword() {
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const strong = RULES.every((r) => r.test(form.next));
  const matches = form.next && form.next === form.confirm;

  const submit = async (e) => {
    e.preventDefault();
    if (!strong) return toast.error('The new password does not meet the rules');
    if (!matches) return toast.error("The new passwords don't match");
    setBusy(true);
    try {
      const r = await authApi.changePassword({ currentPassword: form.current, newPassword: form.next });
      toast.success(r.otherSessionsRevoked ? `Password changed. ${r.otherSessionsRevoked} other device(s) were signed out.` : 'Password changed');
      setForm({ current: '', next: '', confirm: '' });
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not change the password'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card p-5 sm:p-6" aria-labelledby="pw-heading">
      <h2 id="pw-heading" className="flex items-center gap-2 font-semibold">
        <KeyRound className="h-4 w-4" aria-hidden /> Change password
      </h2>
      <p className="text-muted mt-1 text-sm">Other devices are signed out when you change it.</p>
      <form onSubmit={submit} className="mt-5 grid max-w-md gap-4">
        <label className="block">
          <span className="label">Current password</span>
          <PasswordInput required autoComplete="current-password" value={form.current} onChange={set('current')} />
        </label>
        <label className="block">
          <span className="label">New password</span>
          <PasswordInput required autoComplete="new-password" value={form.next} onChange={set('next')} aria-describedby="pw-rules" />
          <ul id="pw-rules" className="mt-2 space-y-0.5 text-xs">
            {RULES.map((r) => {
              const ok = r.test(form.next);
              return (
                <li key={r.label} className={`flex items-center gap-1.5 ${ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-muted'}`}>
                  {ok ? <Check className="h-3.5 w-3.5" aria-hidden /> : <X className="h-3.5 w-3.5" aria-hidden />} {r.label}
                </li>
              );
            })}
          </ul>
        </label>
        <label className="block">
          <span className="label">Confirm new password</span>
          <PasswordInput required autoComplete="new-password" value={form.confirm} onChange={set('confirm')} />
          {form.confirm && !matches && <span className="mt-1.5 block text-xs text-amber-800 dark:text-amber-300">Passwords don&apos;t match yet</span>}
        </label>
        <div>
          <button type="submit" className="btn-primary" disabled={busy || !form.current || !strong || !matches}>
            {busy ? <Spinner className="h-4 w-4 text-white" /> : null} Change password
          </button>
        </div>
      </form>
    </section>
  );
}

function Sessions() {
  const { logout } = useAuth();
  const [sessions, setSessions] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(() => {
    authApi
      .sessions()
      .then(setSessions)
      .catch((err) => toast.error(getErrorMessage(err, 'Could not load sessions')));
  }, []);
  useEffect(load, [load]);

  const run = async (key, fn, success) => {
    setBusy(key);
    try {
      await fn();
      if (success) toast.success(success);
      load();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const others = sessions?.filter((s) => !s.current) ?? [];

  return (
    <section className="card p-5 sm:p-6" aria-labelledby="sessions-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="sessions-heading" className="flex items-center gap-2 font-semibold">
            <MonitorSmartphone className="h-4 w-4" aria-hidden /> Active sessions
          </h2>
          <p className="text-muted mt-1 text-sm">Devices where you&apos;re signed in. Sign out any you don&apos;t recognise.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="btn-secondary px-3 py-1.5"
            disabled={!others.length || busy}
            onClick={() => run('others', authApi.revokeOtherSessions, 'Signed out of all other devices')}
          >
            {busy === 'others' ? <Spinner className="h-4 w-4" /> : null} Log out other devices
          </button>
          <button
            className="btn-ghost px-3 py-1.5"
            disabled={busy}
            onClick={async () => {
              if (!window.confirm('Log out of every device, including this one?')) return;
              setBusy('all');
              try {
                await authApi.logoutAll();
              } catch {
                /* even if this fails, sign out locally */
              }
              logout();
              toast.success('Logged out of all devices');
            }}
          >
            <LogOut className="h-4 w-4" aria-hidden /> Log out everywhere
          </button>
        </div>
      </div>

      {!sessions ? (
        <div className="mt-4 space-y-2">
          <Skeleton className="h-12 w-full rounded-lg" />
          <Skeleton className="h-12 w-full rounded-lg" />
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {sessions.map((s) => {
            const { label, Icon } = describeDevice(s.userAgent);
            return (
              <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                <Icon className="text-muted h-5 w-5 shrink-0" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {label}
                    {s.current && <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">This device</span>}
                  </p>
                  <p className="text-muted text-xs">
                    Last active {ago(s.lastSeenAt)} · signed in {new Date(s.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                    {s.ip ? ` · ${s.ip.replace(/^::ffff:/, '')}` : ''}
                  </p>
                </div>
                {!s.current && (
                  <button className="btn-ghost px-2 py-1 text-xs" disabled={busy} onClick={() => run(s.id, () => authApi.revokeSession(s.id), 'Device signed out')}>
                    {busy === s.id ? <Spinner className="h-3.5 w-3.5" /> : 'Log out'}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default function Account() {
  const { user } = useAuth();
  useDocumentTitle('Account');
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
        <p className="text-muted mt-1 text-sm">
          {user?.name} · {user?.email}
        </p>
      </div>
      <ChangePassword />
      <Sessions />
    </div>
  );
}
