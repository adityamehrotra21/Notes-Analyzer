// Topic outline of a document (gpt-5-nano, strict JSON), cached on documents.outline.
// Every notes mode uses it as the list of sections to write, and the coverage check verifies against it.
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/index.js';
import { documents } from '../db/schema.js';
import { SUMMARY_SYSTEM_PROMPT, buildOutlineMessage } from '../../prompts/summarize.js';
import { generateJSON } from './llmService.js';
import logger from '../utils/logger.js';

const log = logger.child({ module: 'outline' });

export const outlineSchema = z.object({
  documentType: z.enum(['programming', 'general']),
  topics: z
    .array(
      z.object({
        title: z.string().min(2).max(90),
        startPage: z.int().min(1),
        endPage: z.int().min(1),
        subtopics: z.array(z.string().min(1).max(120)).max(5),
      }),
    )
    .min(1)
    .max(40),
});

/** Clean up model output: real page numbers, no duplicate titles. */
function normalize(outline, pageCount) {
  const seen = new Set();
  const max = pageCount || Infinity;
  const topics = [];
  for (const t of outline.topics) {
    const key = t.title.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const start = Math.min(Math.max(1, t.startPage), max);
    const end = Math.min(Math.max(start, t.endPage), max);
    topics.push({ title: t.title.trim(), startPage: start, endPage: end, subtopics: t.subtopics.map((s) => s.trim()).filter(Boolean) });
  }
  return { documentType: outline.documentType, topics };
}

/**
 * @param doc documents row
 * @param source { text, isNotes } the same text the notes are written from
 */
export async function getOutline(doc, source, { refresh = false } = {}) {
  if (doc.outline?.topics?.length && !refresh) return doc.outline;
  const t0 = Date.now();
  const raw = await generateJSON({
    step: 'outline',
    tier: 'cheap',
    name: 'outline',
    schema: outlineSchema,
    system: SUMMARY_SYSTEM_PROMPT, // same system prompt + document prefix as the notes call: cacheable
    messages: [{ role: 'user', content: buildOutlineMessage({ filename: doc.filename, ...source }) }],
    label: 'notes outline',
    cacheKey: `na-summary-${doc.id}`,
  });
  const outline = normalize(raw, doc.pageCount);
  await db.update(documents).set({ outline }).where(eq(documents.id, doc.id));
  doc.outline = outline;
  log.info('outline extracted', { documentId: doc.id, topics: outline.topics.length, documentType: outline.documentType, durationMs: Date.now() - t0 });
  return outline;
}
