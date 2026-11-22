import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { MailCheck } from 'lucide-react';
import { authApi } from '../api/auth.js';
import { getErrorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import AuthCard from '../components/AuthCard.jsx';
import EmailInput from '../components/EmailInput.jsx';
import { emailError } from '../utils/email.js';
import Spinner from '../components/Spinner.jsx';
import PasswordInput from '../components/PasswordInput.jsx';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';

const strongEnough = (p) => p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);

/** Forgot password: 1) email -> 6-digit code is sent, 2) code + new password. */
export default function ForgotPassword() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [step, setStep] = useState('email');
  const [email, setEmail] = useState(location.state?.email ?? '');
  const [attempted, setAttempted] = useState(false);
  const [form, setForm] = useState({ code: '', password: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0); // seconds until "Resend code" is allowed
  const [ttl, setTtl] = useState(10); // minutes the code stays valid
  useDocumentTitle('Reset password');

  useEffect(() => {
    if (wait <= 0) return undefined;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  if (user) return <Navigate to="/dashboard" replace />;

  const sendCode = async (e) => {
    e?.preventDefault();
    setAttempted(true);
    if (emailError(email)) return;
    setBusy(true);
    try {
      const r = await authApi.forgotPassword(email);
      setWait(r.retryAfter ?? 60);
      setTtl(r.expiresInMinutes ?? 10);
      setStep('code');
      toast.success(r.message, { id: 'otp-sent', duration: 6000 });
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not send the code'));
    } finally {
      setBusy(false);
    }
  };

  const reset = async (e) => {
    e.preventDefault();
    if (!strongEnough(form.password)) return toast.error('Use at least 8 characters with a letter and a number');
    if (form.password !== form.confirm) return toast.error("The passwords don't match");
    setBusy(true);
    try {
      await authApi.resetPassword({ email, code: form.code, newPassword: form.password });
      toast.success('Password reset. Log in with your new password.');
      navigate('/login', { replace: true, state: { email } });
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not reset the password'));
    } finally {
      setBusy(false);
    }
  };

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: k === 'code' ? e.target.value.replace(/\D/g, '').slice(0, 6) : e.target.value }));
  const footer = (
    <>
      Remembered it? <Link to="/login" className="link">Log in</Link>
    </>
  );

  if (step === 'email') {
    return (
      <AuthCard title="Forgot your password?" subtitle="We'll email you a 6-digit code to reset it." footer={footer}>
        <form onSubmit={sendCode} noValidate className="space-y-4">
          <EmailInput id="forgot-email" value={email} onChange={setEmail} showError={attempted} />
          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? <Spinner className="h-4 w-4 text-white" /> : 'Send code'}
          </button>
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Enter the code" subtitle="Then choose a new password." footer={footer}>
      <p className="mb-4 flex items-start gap-2 rounded-lg bg-zinc-50 px-3 py-2 text-xs dark:bg-zinc-800/60">
        <MailCheck className="text-muted mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>
          If <strong className="break-all">{email}</strong> has an account, a code is on its way. It expires in {ttl} minutes.{' '}
          <button type="button" className="link" onClick={() => setStep('email')}>
            Change email
          </button>
        </span>
      </p>
      <form onSubmit={reset} className="space-y-4">
        <label className="block">
          <span className="label">6-digit code</span>
          <input
            required
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            title="The 6-digit code from the email"
            className="input font-mono text-lg tracking-[0.4em]"
            value={form.code}
            onChange={set('code')}
            autoFocus
          />
        </label>
        <label className="block">
          <span className="label">New password</span>
          <PasswordInput required minLength={8} autoComplete="new-password" value={form.password} onChange={set('password')} aria-describedby="new-password-hint" />
          <span id="new-password-hint" className="text-muted mt-1.5 block text-xs">At least 8 characters, with a letter and a number</span>
        </label>
        <label className="block">
          <span className="label">Confirm new password</span>
          <PasswordInput required minLength={8} autoComplete="new-password" value={form.confirm} onChange={set('confirm')} />
        </label>
        <button type="submit" className="btn-primary w-full" disabled={busy || form.code.length !== 6}>
          {busy ? <Spinner className="h-4 w-4 text-white" /> : 'Reset password'}
        </button>
        <button type="button" className="btn-ghost w-full text-sm" onClick={sendCode} disabled={busy || wait > 0}>
          {wait > 0 ? `Resend code in ${wait}s` : 'Resend code'}
        </button>
      </form>
    </AuthCard>
  );
}
