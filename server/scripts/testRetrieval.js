// Verify retrieval against your real data: embeds a query and prints the top-k chunks.
//   node scripts/testRetrieval.js --email you@example.com "what is the calvin cycle?"
//   node scripts/testRetrieval.js --email you@example.com --doc <documentId> --k 3 "your question"
//   node scripts/testRetrieval.js --email you@example.com            (lists your documents)
import { parseArgs } from 'node:util';
import { desc, eq, sql } from 'drizzle-orm';
import { db, pool } from '../src/db/index.js';
import { chunks, documents, users } from '../src/db/schema.js';
import { retrieve } from '../src/services/ragService.js';
import { env } from '../src/config/env.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    email: { type: 'string' },
    doc: { type: 'string', multiple: true },
    k: { type: 'string', default: '6' },
    full: { type: 'boolean', default: false },
  },
});

const fmtPages = (c) => (c.pageEnd && c.pageEnd !== c.page ? `p.${c.page}-${c.pageEnd}` : `p.${c.page}`);

async function main() {
  if (!values.email) throw new Error('Pass --email <your account email>');
  const [user] = await db.select().from(users).where(eq(users.email, values.email.toLowerCase()));
  if (!user) throw new Error(`No user with email ${values.email}`);

  const docs = await db
    .select({
      id: documents.id,
      filename: documents.filename,
      status: documents.status,
      pages: documents.pageCount,
      chunks: sql`(select count(*)::int from "chunks" c where c."document_id" = "documents"."id")`,
      error: documents.error,
    })
    .from(documents)
    .where(eq(documents.userId, user.id))
    .orderBy(desc(documents.createdAt));

  console.log(`User ${user.email} · embed provider: ${env.EMBED_PROVIDER}${env.EMBED_PROVIDER === 'gemini' ? ` (${env.GEMINI_EMBED_MODEL})` : ''}`);
  console.table(docs.map((d) => ({ ...d, error: d.error?.slice(0, 60) ?? '' })));

  const query = positionals.join(' ').trim();
  if (!query) return console.log('Add a question to run retrieval.');

  const t0 = performance.now();
  const results = await retrieve({ userId: user.id, query, documentIds: values.doc, k: Number(values.k) });
  console.log(`\nQuery: "${query}" → ${results.length} result(s) in ${Math.round(performance.now() - t0)}ms\n`);
  results.forEach((r, i) => {
    const text = values.full ? r.text : r.text.replace(/\s+/g, ' ').slice(0, 220) + (r.text.length > 220 ? '…' : '');
    console.log(`#${i + 1}  score ${r.score.toFixed(4)}  ${r.filename}  ${fmtPages(r)}  chunk ${r.chunkIndex}\n    ${text}\n`);
  });
}

main()
  .catch((err) => {
    console.error('Error:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
