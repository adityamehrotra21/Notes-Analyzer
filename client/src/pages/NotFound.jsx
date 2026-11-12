import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';

export default function NotFound() {
  useDocumentTitle('Page not found');
  return (
    <div className="py-16 text-center">
      <p className="text-5xl font-semibold tracking-tight text-zinc-500" aria-hidden>404</p>
      <h1 className="mt-2 font-medium">Page not found</h1>
      <p className="text-muted mt-1 text-sm">The link may be broken, or the item was deleted.</p>
      <Link to="/dashboard" className="btn-primary mt-6">Go to documents</Link>
    </div>
  );
}
