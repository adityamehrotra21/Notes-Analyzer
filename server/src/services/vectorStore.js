// pgvector storage and similarity search for chunks.
import { and, asc, cosineDistance, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { chunks, documents } from '../db/schema.js';

const INSERT_BATCH = 200;

/** Replace all chunks of a document. Call inside the ingestion transaction. */
export async function replaceDocumentChunks(tx, { documentId, userId, items }) {
  await tx.delete(chunks).where(eq(chunks.documentId, documentId));
  for (let i = 0; i < items.length; i += INSERT_BATCH) {
    await tx.insert(chunks).values(
      items.slice(i, i + INSERT_BATCH).map((c) => ({
        documentId,
        userId,
        chunkIndex: c.chunkIndex,
        page: c.page,
        pageEnd: c.pageEnd,
        text: c.text,
        tokenCount: c.tokenCount,
        embedding: c.embedding,
      })),
    );
  }
}

/**
 * Top-k chunks by cosine similarity, restricted to one user (and optionally some documents).
 * @returns {Promise<{ id, documentId, filename, page, pageEnd, chunkIndex, text, score }[]>}
 */
export async function searchChunks({ userId, embedding, documentIds, k = 6 }) {
  const distance = cosineDistance(chunks.embedding, embedding);
  const filter = and(eq(chunks.userId, userId), documentIds?.length ? inArray(chunks.documentId, documentIds) : undefined);

  const rows = await db.transaction(async (tx) => {
    // HNSW filters *after* the index scan; iterative scans (pgvector >= 0.8) keep searching
    // until k rows pass the user/document filter instead of returning fewer results.
    await tx.execute(sql`set local hnsw.iterative_scan = relaxed_order`);
    await tx.execute(sql`set local hnsw.ef_search = 100`);
    return tx
      .select({
        id: chunks.id,
        documentId: chunks.documentId,
        filename: documents.filename,
        page: chunks.page,
        pageEnd: chunks.pageEnd,
        chunkIndex: chunks.chunkIndex,
        text: chunks.text,
        distance,
      })
      .from(chunks)
      .innerJoin(documents, eq(documents.id, chunks.documentId))
      .where(filter)
      .orderBy(distance)
      .limit(k);
  });

  // relaxed_order may return slightly out-of-order rows; re-sort.
  return rows
    .map(({ distance: d, ...r }) => ({ ...r, score: 1 - Number(d) }))
    .sort((a, b) => b.score - a.score);
}

/** All chunks of the given documents in reading order (for map-reduce summaries / sampling). */
export function getDocumentChunks({ userId, documentIds }) {
  return db
    .select({ id: chunks.id, documentId: chunks.documentId, page: chunks.page, pageEnd: chunks.pageEnd, chunkIndex: chunks.chunkIndex, text: chunks.text, tokenCount: chunks.tokenCount })
    .from(chunks)
    .where(and(eq(chunks.userId, userId), inArray(chunks.documentId, documentIds)))
    .orderBy(asc(chunks.documentId), asc(chunks.chunkIndex));
}
