import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { documents } from '../db/schema.js';
import { AppError } from '../utils/AppError.js';

/**
 * Ensure every id belongs to the user and is ready. With no ids, returns all of the user's ready documents.
 * @returns {Promise<{ id: string, filename: string }[]>}
 */
export async function requireReadyDocuments(userId, documentIds = []) {
  const ids = [...new Set(documentIds)];
  const rows = await db
    .select({ id: documents.id, filename: documents.filename, status: documents.status })
    .from(documents)
    .where(and(eq(documents.userId, userId), ids.length ? inArray(documents.id, ids) : undefined));

  if (ids.length && rows.length !== ids.length) throw AppError.notFound('One or more documents were not found');
  const notReady = rows.filter((d) => d.status !== 'ready');
  if (ids.length && notReady.length) {
    throw AppError.badRequest(`Not ready yet: ${notReady.map((d) => d.filename).join(', ')}`);
  }
  const ready = rows.filter((d) => d.status === 'ready');
  if (!ready.length) throw AppError.badRequest('Upload a document and wait for it to finish processing first');
  return ready;
}
