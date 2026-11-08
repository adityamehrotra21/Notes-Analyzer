import { useEffect } from 'react';

/** Sets the tab title ("Quiz history · NotesAnalyser"); screen readers announce it on navigation. */
export function useDocumentTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} · NotesAnalyser` : 'NotesAnalyser';
  }, [title]);
}
