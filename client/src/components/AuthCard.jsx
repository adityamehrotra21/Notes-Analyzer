import { BookOpenText } from 'lucide-react';
import ThemeToggle from './ThemeToggle.jsx';

export default function AuthCard({ title, subtitle, children, footer }) {
  return (
    <div className="relative grid min-h-screen place-items-center px-4 py-12">
      <header className="absolute top-4 right-4">
        <ThemeToggle />
      </header>
      <main className="w-full max-w-sm">
        <div className="mb-8 flex items-center justify-center gap-2 text-lg font-semibold tracking-tight">
          <BookOpenText className="h-6 w-6 text-indigo-600 dark:text-indigo-400" aria-hidden /> NotesAnalyser
        </div>
        <div className="card p-6 sm:p-8">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="text-muted mt-1 text-sm">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
        {footer && <p className="text-muted mt-6 text-center text-sm">{footer}</p>}
      </main>
    </div>
  );
}
