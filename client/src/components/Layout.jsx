import { Suspense, useEffect, useRef } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { BookOpenText, History, LogOut, ScrollText, UserCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';
import PageFallback from './PageFallback.jsx';
import BudgetBanner from './BudgetBanner.jsx';

// The logo also links to the dashboard, so the text link is hidden on narrow screens.
const navClass = ({ isActive }) =>
  `hidden rounded-md px-3 py-1.5 sm:inline-flex text-sm font-medium ${
    isActive
      ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
      : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
  }`;

// History stays visible on mobile (as an icon); the logo already covers Dashboard.
const historyClass = ({ isActive }) =>
  `inline-flex items-center rounded-md px-2 py-1.5 text-sm font-medium sm:px-3 ${
    isActive
      ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
      : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
  }`;

export default function Layout() {
  const { user, signOut } = useAuth();
  const { pathname } = useLocation();
  const mainRef = useRef(null);
  const first = useRef(true);

  // Move focus to the new page on navigation so keyboard/screen-reader users start at the content.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    mainRef.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="min-h-screen">
      <a
        href="#main"
        className="sr-only z-50 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-zinc-50/80 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link to="/dashboard" className="flex items-center gap-2 font-semibold tracking-tight">
            <BookOpenText className="h-5 w-5 text-indigo-600 dark:text-indigo-400" aria-hidden />
            <span>NotesAnalyser</span>
          </Link>
          <nav aria-label="Main" className="flex items-center gap-1 sm:gap-2">
            <NavLink to="/dashboard" className={navClass}>Dashboard</NavLink>
            <NavLink to="/history" className={historyClass} title="Quiz history" aria-label="Quiz history">
              <History className="h-4 w-4 sm:hidden" aria-hidden />
              <span className="hidden sm:inline">History</span>
            </NavLink>
            {user?.role === 'admin' && (
              <NavLink to="/admin/logs" className={historyClass} title="Logs (admin)" aria-label="Logs">
                <ScrollText className="h-4 w-4 sm:hidden" aria-hidden />
                <span className="hidden sm:inline">Logs</span>
              </NavLink>
            )}
            <ThemeToggle />
            <NavLink to="/account" className={historyClass} title="Account settings" aria-label="Account settings">
              <UserCircle className="h-4 w-4 md:hidden" aria-hidden />
              <span className="hidden max-w-40 truncate md:inline">{user?.name}</span>
            </NavLink>
            <button onClick={signOut} className="btn-ghost px-2" title="Log out" aria-label="Log out">
              <LogOut className="h-4 w-4" aria-hidden />
            </button>
          </nav>
        </div>
        <BudgetBanner />
      </header>
      <main id="main" ref={mainRef} tabIndex={-1} className="mx-auto max-w-5xl px-4 py-8 outline-none sm:px-6 sm:py-12">
        <ErrorBoundary key={pathname}>
          <Suspense fallback={<PageFallback />}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </main>
    </div>
  );
}
