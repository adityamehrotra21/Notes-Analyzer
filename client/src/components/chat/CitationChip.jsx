import { FileText } from 'lucide-react';

export const pagesLabel = (s) => (s.pageEnd && s.pageEnd !== s.page ? `pp. ${s.page}–${s.pageEnd}` : `p. ${s.page}`);

/** Inline marker for [S1] inside an answer. */
export function InlineCitation({ source, tag }) {
  const n = tag.replace(/^S/, '');
  return (
    <span
      className="mx-0.5 inline-flex h-4.5 min-w-4.5 cursor-help items-center justify-center rounded-md bg-indigo-50 px-1 align-[0.1em] text-[0.68rem] font-semibold text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-300"
      title={source ? `${source.filename}, ${pagesLabel(source)}\n\n${source.snippet}` : tag}
    >
      {n}
    </span>
  );
}

/** Citation chip shown under an answer. */
export default function CitationChip({ source }) {
  return (
    <span className="chip max-w-full" title={source.snippet}>
      <span className="font-semibold text-indigo-700 dark:text-indigo-300">{source.tag.replace(/^S/, '')}</span>
      <FileText className="h-3 w-3 shrink-0" aria-hidden />
      <span className="truncate">{source.filename}</span>
      <span className="shrink-0 text-zinc-600 dark:text-zinc-400">· {pagesLabel(source)}</span>
    </span>
  );
}
