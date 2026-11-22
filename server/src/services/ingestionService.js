// Upload -> parse -> clean -> chunk -> embed -> store. Documents are processed one at a time
// through an in-process queue so several uploads never burst the embedding API.
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { chunks as chunksTable, documents } from '../db/schema.js';
import { RateQueue } from '../utils/rateQueue.js';
import { AppError } from '../utils/AppError.js';
import { cleanPages, PdfError } from './pdfService.js';
import { detectFormat, extractDocument, isImageFormat } from './documentParser.js';
import { transcribeImage } from './imageTextService.js';
import { readImageText, saveImageText } from './fileStorage.js';
import { chunkPages } from './chunker.js';
import { embedDocuments } from './embeddingService.js';
import { replaceDocumentChunks } from './vectorStore.js';
import logger from '../utils/logger.js';
import auditService from './auditService.js';

const log = logger.child({ module: 'ingestion' });

const queue = new RateQueue({ name: 'ingestion', concurrency: 1 });

// documentId -> { stage, done?, total? }. In-memory only; lost on restart (docs are then marked failed).
const progress = new Map();
export const getProgress = (documentId) => progress.get(documentId) ?? null;

class IngestionError extends Error {}

function userMessage(err) {
  if (err instanceof IngestionError || err instanceof PdfError) return err.message;
  // embeddingService already maps provider errors (budget cap, bad key, rate limits) to AppErrors.
  if (err instanceof AppError) return err.status >= 500 ? `Processing failed: ${err.message}` : err.message;
  return `Processing failed: ${String(err?.message ?? err).slice(0, 200)}`;
}

/** Parse + clean + chunk a file (CPU only, no API calls). Used by ingestion and the re-index estimate. */
export async function prepareChunks(buffer, filename, { imageText } = {}) {
  const t0 = Date.now();
  const { pageCount, pages: raw } = await extractDocument(buffer, filename, { imageText });
  const { pages, removedLines } = cleanPages(raw);
  if (!pages.some((p) => p.text.length > 20)) {
    throw new IngestionError('No readable text found in this file. Scanned PDFs are not supported: upload the pages as images instead.');
  }
  const pieces = chunkPages(pages);
  const tokens = pieces.reduce((n, c) => n + c.tokenCount, 0);
  return { pageCount, pages, pieces, tokens, removedLines, durationMs: Date.now() - t0 };
}

/**
 * Fire-and-forget: queue a document for ingestion.
 * job: { documentId, userId, buffer, filename, reindex?: boolean, previousChunks?: number }
 */
export function enqueueIngestion(job) {
  progress.set(job.documentId, { stage: 'queued' });
  log.info(job.reindex ? 'document queued for re-index' : 'document queued for ingestion', {
    documentId: job.documentId,
    filename: job.filename,
    bytes: job.buffer.length,
    queued: queue.pending,
  });
  queue.add(() => ingest(job)).catch((err) => log.error('unexpected ingestion error', { err, documentId: job.documentId }));
}

async function ingest({ documentId, userId, buffer, filename, reindex = false, previousChunks = 0 }) {
  const t0 = Date.now();
  const set = (p) => progress.set(documentId, p);
  try {
    // Skip if the document was deleted while waiting in the queue.
    const [doc] = await db.select({ status: documents.status }).from(documents).where(eq(documents.id, documentId));
    if (doc?.status !== 'processing') return log.info('skipped: document no longer processing', { documentId });
    // Never re-embed implicitly: only an explicit re-index replaces existing embeddings.
    if (!reindex) {
      const [{ n }] = await db.select({ n: sql`count(*)::int` }).from(chunksTable).where(eq(chunksTable.documentId, documentId));
      if (n > 0) {
        await db.update(documents).set({ status: 'ready', error: null }).where(eq(documents.id, documentId));
        return log.warn('document already has embeddings; not re-embedding', { documentId, chunks: n });
      }
    }

    set({ stage: 'parsing' });
    const format = detectFormat(buffer, filename);
    let imageText;
    if (isImageFormat(format)) {
      imageText = await readImageText(userId, documentId); // already paid for: never transcribe twice
      if (!imageText) {
        imageText = await transcribeImage(buffer, format);
        await saveImageText(userId, documentId, imageText);
      }
    }
    const { pageCount, pages, pieces, tokens, removedLines, durationMs } = await prepareChunks(buffer, filename, { imageText });
    log.info('parsed file', { documentId, pageCount, pagesWithText: pages.filter((p) => p.text).length, removedHeaderFooterLines: removedLines.length, durationMs });
    set({ stage: 'chunking' });
    log.info('chunked', { documentId, chunks: pieces.length, tokens, avgTokens: Math.round(tokens / (pieces.length || 1)), previousChunks: reindex ? previousChunks : undefined });

    set({ stage: 'embedding', done: 0, total: pieces.length });
    const vectors = await embedDocuments(pieces.map((c) => c.text), {
      onProgress: (done, total) => {
        set({ stage: 'embedding', done, total });
        log.info('embedding progress', { documentId, done, total });
      },
    });

    set({ stage: 'saving' });
    await db.transaction(async (tx) => {
      // Locks the row; a concurrent delete waits, and a deleted doc updates nothing.
      const [updated] = await tx
        .update(documents)
        // A re-index changes page markers, so the cached map-step notes are rebuilt on the next summary.
        .set({ status: 'ready', pageCount, error: null, ...(reindex ? { summaryNotes: null } : {}) })
        .where(and(eq(documents.id, documentId), eq(documents.status, 'processing')))
        .returning({ id: documents.id });
      if (!updated) return;
      await replaceDocumentChunks(tx, { documentId, userId, items: pieces.map((c, i) => ({ ...c, embedding: vectors[i] })) });
      await auditService.record({
        action: 'update',
        entity: 'document',
        entityId: documentId,
        userId,
        before: reindex ? { status: 'ready', chunkCount: previousChunks } : { status: 'processing', pageCount: null },
        after: { status: 'ready', pageCount, chunkCount: pieces.length, ...(reindex ? { reindexed: true } : {}) },
        tx,
      });
    });
    log.info(reindex ? 'document re-indexed' : 'document ready', { documentId, filename, pageCount, chunks: pieces.length, previousChunks: reindex ? previousChunks : undefined, durationMs: Date.now() - t0 });
  } catch (err) {
    const expected = err instanceof IngestionError || err instanceof PdfError || (err instanceof AppError && err.status < 500);
    log[expected ? 'warn' : 'error'](reindex ? 're-index failed; previous index kept' : 'ingestion failed', {
      documentId,
      filename,
      reason: userMessage(err),
      ...(expected ? {} : { err }),
      durationMs: Date.now() - t0,
    });
    // A failed re-index keeps the old chunks (they are only replaced inside the final transaction).
    const update = reindex ? { status: 'ready', error: `Re-index failed (previous index kept): ${userMessage(err)}` } : { status: 'failed', error: userMessage(err) };
    await db
      .update(documents)
      .set(update)
      .where(eq(documents.id, documentId))
      .catch((e) => log.error('could not update document after failure', { err: e, documentId }));
    await auditService.record({ action: 'update', entity: 'document', entityId: documentId, userId, before: { status: 'processing' }, after: update });
  } finally {
    progress.delete(documentId);
  }
}
