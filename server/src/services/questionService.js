// Practice questions with model answers, cached per (documents, type, topic) in generated_questions.
import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { generatedQuestions, documents } from '../db/schema.js';
import { countTokens } from '../utils/tokens.js';
import { QUESTIONS_SYSTEM_PROMPT, buildQuestionsMessage } from '../../prompts/questions.js';
import { questionsOutputSchema } from '../schemas/generation.js';
import { requireReadyDocuments } from './documentAccess.js';
import { cacheKey, normalizeTopic, selectSources } from './generationContext.js';
import { generateJSON } from './llmService.js';
import { AppError } from '../utils/AppError.js';
import logger from '../utils/logger.js';
import auditService from './auditService.js';

const log = logger.child({ module: 'questions' });

const AVOID_LIMIT = 40;
const inflight = new Map();

async function listCached(userId, key) {
  return db
    .select({
      id: generatedQuestions.id,
      question: generatedQuestions.question,
      answer: generatedQuestions.answer,
      type: generatedQuestions.type,
      sourcePage: generatedQuestions.sourcePage,
      documentId: generatedQuestions.documentId,
      filename: documents.filename,
      createdAt: generatedQuestions.createdAt,
    })
    .from(generatedQuestions)
    .innerJoin(documents, eq(documents.id, generatedQuestions.documentId))
    .where(and(eq(generatedQuestions.userId, userId), eq(generatedQuestions.cacheKey, key)))
    .orderBy(asc(generatedQuestions.createdAt), asc(generatedQuestions.id));
}

async function generateMore({ userId, docs, topic, type, count, existing, key }) {
  const avoid = existing.slice(-AVOID_LIMIT).map((q) => q.question);
  const reserved = countTokens(QUESTIONS_SYSTEM_PROMPT) + countTokens(avoid.join('\n')) + 400;
  const sources = await selectSources({ userId, docs, topic, reservedTokens: reserved, jitter: existing.length > 0 });

  const out = await generateJSON({
    step: 'questions',
    name: 'questions',
    schema: questionsOutputSchema,
    system: QUESTIONS_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildQuestionsMessage({ count, type, topic, sources, avoid }) }],
    label: `questions ${type} x${count}`,
    cacheKey: `na-questions-${key}`,
  });
  const verified = out.questions.filter((q) => q.verified);
  if (verified.length < out.questions.length) {
    log.info('dropped questions that failed the self-check', { dropped: out.questions.length - verified.length, kept: verified.length });
  }
  if (!verified.length) throw new AppError(422, "Couldn't generate questions grounded in these notes. Try another topic or type.");

  const byTag = new Map(sources.map((s) => [s.tag, s]));
  const seen = new Set(existing.map((q) => q.question.trim().toLowerCase()));
  const rows = [];
  const base = Date.now(); // distinct created_at per row keeps the model's order stable when listing
  for (const q of verified.slice(0, count)) {
    const norm = q.question.trim().toLowerCase();
    if (seen.has(norm)) continue;
    seen.add(norm);
    const src = byTag.get(q.sourceTag.trim().replace(/^\[|\]$/g, ''));
    rows.push({
      userId,
      documentId: src?.documentId ?? docs[0].id,
      type,
      topic: topic ?? null,
      question: q.question.trim(),
      answer: `${q.answer.trim()}\n\n**Marking points**\n${q.markingPoints.map((p) => `- ${p.trim()}`).join('\n')}`,
      sourcePage: src?.page ?? null,
      cacheKey: key,
      createdAt: new Date(base + rows.length),
    });
  }
  if (rows.length) {
    await db.insert(generatedQuestions).values(rows);
    await auditService.record({
      action: 'create',
      entity: 'question_set',
      entityId: key,
      userId,
      after: { type, topic: topic ?? null, added: rows.length, documentIds: docs.map((d) => d.id) },
    });
  }
  log.info('practice questions generated', { type, topic: topic ?? null, requested: count, added: rows.length });
}

/**
 * Returns all cached questions for this request shape, generating new ones when there are fewer
 * than `count` (or `more` is set).
 */
export async function getPracticeQuestions({ userId, documentIds, topic, type, count, more }) {
  const docs = await requireReadyDocuments(userId, documentIds);
  const key = cacheKey({ docs: docs.map((d) => d.id).sort(), type, topic: normalizeTopic(topic) });

  let existing = await listCached(userId, key);
  const needed = more ? count : Math.max(0, count - existing.length);
  let generated = 0;
  if (needed > 0) {
    if (!inflight.has(key)) {
      inflight.set(key, generateMore({ userId, docs, topic, type, count: needed, existing, key }).finally(() => inflight.delete(key)));
    }
    await inflight.get(key);
    const after = await listCached(userId, key);
    generated = after.length - existing.length;
    existing = after;
  }
  return { questions: existing, generated, cached: generated === 0 };
}
