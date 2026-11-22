import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext.jsx';
import { getErrorMessage } from '../api/client.js';
import AuthCard from '../components/AuthCard.jsx';
import Spinner from '../components/Spinner.jsx';
import PasswordInput from '../components/PasswordInput.jsx';
import EmailInput from '../components/EmailInput.jsx';
import { emailError } from '../utils/email.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';

export default function Register() {
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [submitting, setSubmitting] = useState(false);
  const [attempted, setAttempted] = useState(false);
  useDocumentTitle('Create account');

  if (user) return <Navigate to="/dashboard" replace />;

  const onSubmit = async (e) => {
    e.preventDefault();
    setAttempted(true);
    if (!form.name.trim()) return toast.error('Enter your name');
    if (emailError(form.email, { signup: true })) return;
    if (form.password.length < 8) return toast.error('Password must be at least 8 characters');
    setSubmitting(true);
    try {
      await register(form);
      toast.success('Account created');
      navigate('/dashboard', { replace: true });
    } catch (err) {
      toast.error(getErrorMessage(err, 'Registration failed'));
    } finally {
      setSubmitting(false);
    }
  };

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <AuthCard
      title="Create your account"
      subtitle="Upload notes, chat with them, quiz yourself"
      footer={<>Already have an account? <Link to="/login" className="link">Log in</Link></>}
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <label className="block">
          <span className="label">Name</span>
          <input required autoComplete="name" className="input" value={form.name} onChange={set('name')} />
        </label>
        <EmailInput id="register-email" signup value={form.email} onChange={(email) => setForm((f) => ({ ...f, email }))} showError={attempted} />
        <label className="block">
          <span className="label">Password</span>
          <PasswordInput required minLength={8} autoComplete="new-password" value={form.password} onChange={set('password')} aria-describedby="password-hint" />
          <span id="password-hint" className="text-muted mt-1.5 block text-xs">At least 8 characters</span>
        </label>
        <button type="submit" className="btn-primary w-full" disabled={submitting}>
          {submitting ? <Spinner className="h-4 w-4 text-white" /> : 'Create account'}
        </button>
      </form>
    </AuthCard>
  );
}
