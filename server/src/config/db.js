import { and, eq, sql } from 'drizzle-orm';
import { db, pool } from '../db/index.js';
import { documents, EMBED_DIMENSIONS } from '../db/schema.js';
import { env } from './env.js';
import logger from '../utils/logger.js';

const log = logger.child({ module: 'db' });

export async function connectDB() {
  const { rows } = await pool.query('select current_database() as db, version() as version');
  log.info('Postgres connected', { database: rows[0].db, version: rows[0].version.split(' ').slice(0, 2).join(' ') });
  await assertSchema();
}

// Fail fast when migrations are missing or the vector size doesn't match EMBED_DIMENSIONS.
async function assertSchema() {
  const { rows } = await pool.query(
    `select a.atttypmod as dims
       from pg_attribute a
      where a.attrelid = to_regclass('public.chunks') and a.attname = 'embedding'`,
  );
  if (!rows.length) throw new Error('Database is not migrated. Run `npm run db:migrate`.');
  const dims = rows[0].dims;
  if (dims !== env.EMBED_DIMENSIONS || dims !== EMBED_DIMENSIONS) {
    throw new Error(
      `chunks.embedding is vector(${dims}) but EMBED_DIMENSIONS=${env.EMBED_DIMENSIONS}. ` +
        'Regenerate and run migrations (npm run db:generate && npm run db:migrate), or fix EMBED_DIMENSIONS.',
    );
  }
}

// Ingestion runs in-process, so anything still "processing" at boot was interrupted.
export async function failInterruptedDocuments() {
  // An interrupted re-index still has its previous chunks: put it back to ready instead of failing it.
  const restored = await db
    .update(documents)
    .set({ status: 'ready', error: 'Re-index was interrupted by a server restart; the previous index is kept.' })
    .where(and(eq(documents.status, 'processing'), sql`exists (select 1 from chunks c where c.document_id = ${documents.id})`))
    .returning({ id: documents.id });
  if (restored.length) log.warn('restored interrupted re-index jobs to ready', { count: restored.length });
  const failed = await db
    .update(documents)
    .set({ status: 'failed', error: 'Processing was interrupted by a server restart. Please re-upload.' })
    .where(eq(documents.status, 'processing'))
    .returning({ id: documents.id });
  if (failed.length) log.warn('marked interrupted documents as failed', { count: failed.length, documentIds: failed.map((d) => d.id) });
}

export async function pingDB() {
  await db.execute(sql`select 1`);
}

export async function disconnectDB() {
  await pool.end();
}
