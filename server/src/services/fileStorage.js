// Stores uploaded files on disk so documents can be re-indexed (re-chunked + re-embedded) later.
// Layout: STORAGE_DIR/pdfs/<userId>/<documentId>.pdf   (STORAGE_DIR is git-ignored)
// Every format uses this path (the extension is historical); the type is detected from the bytes.
// Images also keep <documentId>.txt, their paid transcription, so re-indexing never pays twice.
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

export async function saveImageText(userId, documentId, text) {
  await writeFile(textPathFor(userId, documentId), text, 'utf8');
}

export async function readImageText(userId, documentId) {
  try {
    return await readFile(textPathFor(userId, documentId), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/** Removes exactly one stored file and its transcription (never a directory). Missing files are fine. */
export async function deletePdf(userId, documentId) {
  await unlink(textPathFor(userId, documentId)).catch(() => {});
  try {
    await unlink(pathFor(userId, documentId));
    log.info('deleted stored PDF', { documentId });
  } catch (err) {
    if (err.code !== 'ENOENT') log.error('could not delete stored PDF', { err, documentId });
  }
}
