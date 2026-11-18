import { lazy, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';
import Dashboard from './pages/Dashboard.jsx';
import NotFound from './pages/NotFound.jsx';

// Heavier pages (Markdown renderer, quiz UI) load on demand to keep the first load small.
const Study = lazy(() => import('./pages/Study.jsx'));
const QuizPlay = lazy(() => import('./pages/QuizPlay.jsx'));
const QuizResults = lazy(() => import('./pages/QuizResults.jsx'));
const QuizHistory = lazy(() => import('./pages/QuizHistory.jsx'));
const AdminLogs = lazy(() => import('./pages/AdminLogs.jsx'));
const Account = lazy(() => import('./pages/Account.jsx'));

function useOfflineNotice() {
  useEffect(() => {
    const offline = () => toast.error("You're offline. Changes and AI features won't work until you reconnect.", { id: 'offline', duration: Infinity });
    const online = () => {
      toast.dismiss('offline');
      toast.success('Back online', { id: 'online' });
    };
    if (!navigator.onLine) offline();
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    return () => {
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
    };
  }, []);
}

export default function App() {
  useOfflineNotice();
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/study" element={<Study />} />
          <Route path="/quiz/:id" element={<QuizPlay />} />
          <Route path="/quiz/:id/results/:attemptId" element={<QuizResults />} />
          <Route path="/history" element={<QuizHistory />} />
          <Route path="/admin/logs" element={<AdminLogs />} />
          <Route path="/account" element={<Account />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
  );
}
