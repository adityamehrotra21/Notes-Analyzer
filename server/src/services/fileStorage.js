// Stores uploaded files on disk so documents can be re-indexed (re-chunked + re-embedded) later.
// Layout: STORAGE_DIR/pdfs/<userId>/<documentId>.pdf   (STORAGE_DIR is git-ignored)
// Every format uses this path (the extension is historical); the type is detected from the bytes.
// Pages read by the vision model (images, diagram pages) are kept in <documentId>.vision.json, so
// re-indexing never pays twice. (<documentId>.txt is the older single-image format.)
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { env } from '../config/env.js';
import logger from '../utils/logger.js';

const log = logger.child({ module: 'storage' });
const UUID = /^[0-9a-f-]{36}$/i;

function pathFor(userId, documentId) {
  // Ids come from the database, but never let anything else reach the filesystem path.
  if (!UUID.test(userId) || !UUID.test(documentId)) throw new Error('invalid id for storage path');
  return path.join(env.STORAGE_DIR, 'pdfs', userId, `${documentId}.pdf`);
}

export async function savePdf(userId, documentId, buffer) {
  const file = pathFor(userId, documentId);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, buffer);
  log.info('stored PDF', { documentId, bytes: buffer.length });
}

export const hasPdf = (userId, documentId) => existsSync(pathFor(userId, documentId));

export const readPdf = (userId, documentId) => readFile(pathFor(userId, documentId));

export async function pdfSize(userId, documentId) {
  try {
    return (await stat(pathFor(userId, documentId))).size;
  } catch {
    return null;
  }
}

const textPathFor = (userId, documentId) => pathFor(userId, documentId).replace(/\.pdf$/, '.txt');
const visionPathFor = (userId, documentId) => pathFor(userId, documentId).replace(/\.pdf$/, '.vision.json');

async function readOptional(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/** @param pages {Record<number, string>} page -> text from the vision model */
export async function saveVisionPages(userId, documentId, pages) {
  await writeFile(visionPathFor(userId, documentId), JSON.stringify(pages), 'utf8');
}

/** @returns {Promise<Record<number, string>>} pages already read by the vision model ({} if none) */
export async function readVisionPages(userId, documentId) {
  const json = await readOptional(visionPathFor(userId, documentId));
  if (json) return JSON.parse(json);
  const legacy = await readOptional(textPathFor(userId, documentId));
  return legacy ? { 1: legacy } : {};
}

/** Removes exactly one stored file and its transcription (never a directory). Missing files are fine. */
export async function deletePdf(userId, documentId) {
  await unlink(textPathFor(userId, documentId)).catch(() => {});
  await unlink(visionPathFor(userId, documentId)).catch(() => {});
  try {
    await unlink(pathFor(userId, documentId));
    log.info('deleted stored PDF', { documentId });
  } catch (err) {
    if (err.code !== 'ENOENT') log.error('could not delete stored PDF', { err, documentId });
  }
}
