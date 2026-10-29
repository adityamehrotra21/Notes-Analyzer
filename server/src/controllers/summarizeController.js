import { estimateSummary, summarizeDocument } from '../services/summaryService.js';

/** POST /api/summarize -> { summaries: [{ documentId, filename, mode, summary, cached }] } */
export async function summarize(req, res) {
  const { documentIds, mode, refresh } = req.body;
  const summaries = [];
  // Sequential on purpose: free-tier RPM is the bottleneck, not latency.
  for (const documentId of [...new Set(documentIds)]) {
    summaries.push(await summarizeDocument({ userId: req.user.id, documentId, mode, refresh }));
  }
  res.json({ summaries });
}

/** GET /api/summarize/estimate?documentId&mode&refresh -> estimated cost (no LLM calls) */
export async function summarizeEstimate(req, res) {
  res.json({ estimate: await estimateSummary({ userId: req.user.id, ...req.valid.query }) });
}
