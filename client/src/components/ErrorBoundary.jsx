import { Component } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

// A failed dynamic import usually means a new deploy replaced the old chunk files.
const isChunkError = (err) => /dynamically imported module|Loading chunk|Importing a module script failed/i.test(err?.message ?? '');

/** Keeps one broken page from blanking the whole app. Reset by changing `key` (e.g. on navigation). */
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('UI error:', error, info?.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const chunk = isChunkError(error);
    return (
      <div role="alert" className="card mx-auto max-w-md px-6 py-10 text-center">
        <AlertTriangle className="mx-auto h-8 w-8 text-amber-600 dark:text-amber-400" aria-hidden />
        <h1 className="mt-3 font-semibold">{chunk ? 'A new version is available' : 'Something went wrong'}</h1>
        <p className="text-muted mt-1 text-sm">
          {chunk ? 'Reload the page to get the latest version.' : 'This page hit an unexpected error. Reloading usually fixes it.'}
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <button className="btn-primary" onClick={() => window.location.reload()}>
            <RefreshCw className="h-4 w-4" aria-hidden /> Reload
          </button>
          <a href="/dashboard" className="btn-secondary">Dashboard</a>
        </div>
      </div>
    );
  }
}
