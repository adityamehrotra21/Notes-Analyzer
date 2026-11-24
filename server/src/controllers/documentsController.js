import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { chunks, documents, users } from '../db/schema.js';
import { AppError } from '../utils/AppError.js';
import { createHash } from 'node:crypto';
import { enqueueIngestion, getProgress, prepareChunks } from '../services/ingestionService.js';
import { deletePdf, hasPdf, readPdf, readVisionPages, savePdf } from '../services/fileStorage.js';
import { detectFormat, isImageFormat } from '../services/documentParser.js';
import { env } from '../config/env.js';
import { costUsd, priceFor } from '../config/pricing.js';
import budgetService from '../services/budgetService.js';
import auditService from '../services/auditService.js';
import logger from '../utils/logger.js';

const log = logger.child({ module: 'documents' });

const fields = {
  id: documents.id,
  filename: documents.filename,
  pageCount: documents.pageCount,
  status: documents.status,
  error: documents.error,
  createdAt: documents.createdAt,
  updatedAt: documents.updatedAt,
  summaryBrief: sql`${documents.summaryBrief} is not null`.mapWith(Boolean),
  summaryDetailed: sql`${documents.summaryDetailed} is not null`.mapWith(Boolean),
  summaryExam: sql`${documents.summaryExam} is not null`.mapWith(Boolean),
  summaryCoverage: documents.summaryCoverage,
  outlineTopics: sql`coalesce(jsonb_array_length(${documents.outline}->'topics'), 0)`.mapWith(Number),
  userId: documents.userId,
  chunkCount: sql`(select count(*)::int from "chunks" c where c."document_id" = "documents"."id")`.as('chunk_count'),
};

const withProgress = ({ summaryBrief, summaryDetailed, summaryExam, summaryCoverage, userId, ...d }) => ({
  ...d,
  hasFile: hasPdf(userId, d.id), // stored PDF available -> can be re-indexed
  summaries: { brief: summaryBrief, detailed: summaryDetailed, exam: summaryExam },
  coverage: summaryCoverage ?? {},
  progress: d.status === 'processing' ? getProgress(d.id) : null,
});

const cleanName = (name) => name.replace(/[\\/]/g, '_').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 255) || 'untitled';

export async function uploadDocuments(req, res) {
  const files = req.files ?? [];
  if (!files.length) throw AppError.badRequest('No files received (use the "files" field)');
  const bad = files.find((f) => !detectFormat(f.buffer, f.originalname));
  if (bad) throw new AppError(415, `${bad.originalname} is damaged or isn't really this file type`);

  const userId = req.user.id;
  const out = [];
  const returning = { id: documents.id, filename: documents.filename, status: documents.status, createdAt: documents.createdAt };
  for (const f of files) {
    const contentHash = createHash('sha256').update(f.buffer).digest('hex');
    const filename = cleanName(f.originalname);
    log.info('upload received', { filename, bytes: f.size, sha256: contentHash.slice(0, 16) });

    // Same file already uploaded by this user? Reuse it: never embed (and pay for) the same PDF twice.
    const [existing] = await db
      .select(returning)
      .from(documents)
      .where(and(eq(documents.userId, userId), eq(documents.contentHash, contentHash)));
    if (existing && existing.status !== 'failed') {
      // Documents uploaded before files were stored can be re-attached, which enables re-indexing.
      const attach = !hasPdf(userId, existing.id);
      if (attach) await savePdf(userId, existing.id, f.buffer);
      log.info('duplicate upload: reusing existing document', { filename, documentId: existing.id, fileAttached: attach });
      out.push({ ...existing, duplicate: true, fileAttached: attach });
      continue;
    }
    if (existing) {
      await db.delete(documents).where(eq(documents.id, existing.id)); // retry of a failed upload
      await deletePdf(userId, existing.id);
    }

    let doc;
    try {
      [doc] = await db.insert(documents).values({ userId, filename, contentHash }).returning(returning);
    } catch (err) {
      if ((err?.cause?.code ?? err?.code) !== '23505') throw err;
      // Same file in this batch or a concurrent request: reuse whichever row won.
      const [winner] = await db.select(returning).from(documents).where(and(eq(documents.userId, userId), eq(documents.contentHash, contentHash)));
      out.push({ ...winner, duplicate: true });
      continue;
    }
    await savePdf(userId, doc.id, f.buffer);
    await auditService.record({ action: 'create', entity: 'document', entityId: doc.id, after: { filename, status: 'processing', sha256: contentHash, bytes: f.size } });
    out.push(doc);
    enqueueIngestion({ documentId: doc.id, userId, buffer: f.buffer, filename });
  }
  res.status(202).json({ documents: out.map((d) => ({ ...d, progress: getProgress(d.id) })) });
}

export async function listDocuments(req, res) {
  const rows = await db.select(fields).from(documents).where(eq(documents.userId, req.user.id)).orderBy(desc(documents.createdAt));
  res.json({ documents: rows.map(withProgress) });
}

export async function getDocument(req, res) {
  const [doc] = await db
    .select(fields)
    .from(documents)
    .where(and(eq(documents.id, req.valid.params.id), eq(documents.userId, req.user.id)));
  if (!doc) throw AppError.notFound('Document not found');
  res.json({ document: withProgress(doc) });
}

export async function deleteDocument(req, res) {
  const [doc] = await db
    .delete(documents) // chunks cascade
    .where(and(eq(documents.id, req.valid.params.id), eq(documents.userId, req.user.id)))
    .returning({ id: documents.id, filename: documents.filename, status: documents.status, pageCount: documents.pageCount });
  if (!doc) throw AppError.notFound('Document not found');
  await deletePdf(req.user.id, doc.id);
  await auditService.record({ action: 'delete', entity: 'document', entityId: doc.id, before: { filename: doc.filename, status: doc.status, pageCount: doc.pageCount } });
  log.info('document deleted', { documentId: doc.id });
  res.status(204).end();
}

// ---------------------------------------------------------------- re-index

async function loadForReindex(userId, documentId) {
  const [doc] = await db.select(fields).from(documents).where(and(eq(documents.id, documentId), eq(documents.userId, userId)));
  if (!doc) throw AppError.notFound('Document not found');
  if (doc.status === 'processing') throw AppError.conflict('This document is already being processed');
  if (!hasPdf(userId, documentId)) {
    throw new AppError(409, 'The original file is not stored for this document. Upload the same file again once to enable re-indexing.');
  }
  return doc;
}

/** Re-chunk locally (no API calls) and price the embeddings at pricing.js rates. */
async function estimateReindex(userId, doc) {
  const buffer = await readPdf(userId, doc.id);
  const isImage = isImageFormat(detectFormat(buffer, doc.filename));
  const visionPages = await readVisionPages(userId, doc.id); // no paid calls here: only what was already read
  // An image with no saved reading can't be chunked without a paid call, so report the current index.
  const { pageCount, pieces, tokens } = isImage && !visionPages[1] ? { pageCount: 1, pieces: { length: doc.chunkCount }, tokens: 0 } : await prepareChunks(buffer, doc.filename, { visionPages });
  const model = env.EMBED_PROVIDER === 'openai' ? env.OPENAI_EMBED_MODEL : env.EMBED_PROVIDER;
  const price = priceFor(model);
  const estimatedUsd = price ? Math.round(costUsd(price, { inputTokens: tokens }) * 1e8) / 1e8 : 0;
  return {
    buffer,
    estimate: {
      documentId: doc.id,
      filename: doc.filename,
      pageCount,
      currentChunks: doc.chunkCount,
      newChunks: pieces.length,
      tokens,
      model,
      estimatedUsd,
      budgetRemainingUsd: budgetService.status().remainingUsd,
    },
  };
}

/** GET /api/documents/:id/reindex/estimate */
export async function reindexEstimate(req, res) {
  const doc = await loadForReindex(req.user.id, req.valid.params.id);
  const { estimate } = await estimateReindex(req.user.id, doc);
  log.info('re-index estimate', estimate);
  res.json({ estimate: await forViewer(req.user.id, estimate) });
}

/** Strip money from responses for non-admins (cost is visible only in admin Usage & Budget). */
async function forViewer(userId, estimate) {
  const [u] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId));
  if (u?.role === 'admin') return estimate;
  const { estimatedUsd, budgetRemainingUsd, model, ...rest } = estimate; // eslint-disable-line no-unused-vars
  return rest;
}

/** POST /api/documents/:id/reindex: re-chunk + re-embed from the stored PDF. Old chunks stay until it succeeds. */
export async function reindexDocument(req, res) {
  const userId = req.user.id;
  const doc = await loadForReindex(userId, req.valid.params.id);
  const { buffer, estimate } = await estimateReindex(userId, doc);
  log.info('re-index starting', { ...estimate }); // cost logged before any API call
  await db.update(documents).set({ status: 'processing', error: null }).where(eq(documents.id, doc.id));
  enqueueIngestion({ documentId: doc.id, userId, buffer, filename: doc.filename, reindex: true, previousChunks: doc.chunkCount });
  res.status(202).json({ estimate: await forViewer(userId, estimate), document: { id: doc.id, status: 'processing', progress: getProgress(doc.id) } });
}
