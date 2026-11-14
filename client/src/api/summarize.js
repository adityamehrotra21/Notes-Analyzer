import { api } from './client.js';

/** Summarise one document (cached server-side). Returns { documentId, filename, mode, summary, coverage, cached }. */
export const summarizeDocument = ({ documentId, mode, refresh = false }) =>
  api.post('/summarize', { documentIds: [documentId], mode, refresh }).then((r) => r.data.summaries[0]);

