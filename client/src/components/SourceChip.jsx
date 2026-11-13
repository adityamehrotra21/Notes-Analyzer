import { FileText } from 'lucide-react';

/** "notes.pdf · p. 3" chip for a generated question's source. */
export default function SourceChip({ filename, page }) {
  if (!filename && !page) return null;
  return (
    <span className="chip max-w-full">
      <FileText className="h-3 w-3 shrink-0" aria-hidden />
      {filename && <span className="truncate">{filename}</span>}
      {page && <span className="shrink-0 text-zinc-600 dark:text-zinc-400">{filename ? '· ' : ''}p. {page}</span>}
    </span>
  );
}
