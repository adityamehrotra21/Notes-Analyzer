import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext.jsx';
import { getErrorMessage } from '../api/client.js';
import AuthCard from '../components/AuthCard.jsx';
import Spinner from '../components/Spinner.jsx';
import PasswordInput from '../components/PasswordInput.jsx';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: location.state?.email ?? '', password: '' });
  const [submitting, setSubmitting] = useState(false);
  useDocumentTitle('Log in');

  if (user) return <Navigate to="/dashboard" replace />;

  const onSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await login(form);
      navigate(location.state?.from?.pathname ?? '/dashboard', { replace: true });
    } catch (err) {
      toast.error(getErrorMessage(err, 'Login failed'));
    } finally {
      setSubmitting(false);
    }
  };

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <AuthCard
      title="Welcome back"
      subtitle="Log in to analyse your notes"
      footer={<>No account? <Link to="/register" className="link">Create one</Link></>}
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <label className="block">
          <span className="label">Email</span>
          <input type="email" required autoComplete="email" className="input" value={form.email} onChange={set('email')} />
        </label>
        <div>
          <div className="flex items-baseline justify-between">
            <label htmlFor="login-password" className="label">Password</label>
            <Link to="/forgot-password" state={{ email: form.email }} className="link text-xs">
              Forgot password?
            </Link>
          </div>
          <PasswordInput id="login-password" required autoComplete="current-password" value={form.password} onChange={set('password')} />
        </div>
        <button type="submit" className="btn-primary w-full" disabled={submitting}>
          {submitting ? <Spinner className="h-4 w-4 text-white" /> : 'Log in'}
        </button>
      </form>
    </AuthCard>
  );
}
