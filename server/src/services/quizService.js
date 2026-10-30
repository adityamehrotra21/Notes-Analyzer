// Multiple-choice quizzes: generate (cached per settings), fetch without answers, grade attempts.
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { documents, quizAttempts, quizDocument, quizQuestions, quizzes } from '../db/schema.js';
import { AppError } from '../utils/AppError.js';
import { countTokens } from '../utils/tokens.js';
import { QUIZ_SYSTEM_PROMPT, buildQuizMessage } from '../../prompts/quiz.js';
import { quizOutputSchema } from '../schemas/generation.js';
import { requireReadyDocuments } from './documentAccess.js';
import { cacheKey, normalizeTopic, selectSources } from './generationContext.js';
import { generateJSON } from './llmService.js';
import logger from '../utils/logger.js';
import auditService from './auditService.js';

const log = logger.child({ module: 'quiz' });

const inflight = new Map();

/** Fisher-Yates shuffle of options, remapping correctIndex (LLMs favour putting the answer first). */
function shuffleOptions(q) {
  const order = [0, 1, 2, 3];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return { ...q, options: order.map((i) => q.options[i]), correctIndex: order.indexOf(q.correctIndex) };
}

async function createQuiz({ userId, docs, topic, difficulty, count, key }) {
  const sources = await selectSources({
    userId,
    docs,
    topic,
    reservedTokens: countTokens(QUIZ_SYSTEM_PROMPT) + 400,
    jitter: true, // a new quiz with the same settings should see different material
  });
  const out = await generateJSON({
    step: 'quiz',
    name: 'quiz',
    schema: quizOutputSchema,
    system: QUIZ_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildQuizMessage({ count, difficulty, topic, sources }) }],
    label: `quiz ${difficulty} x${count}`,
  });
  const verified = out.questions.filter((q) => q.verified);
  if (verified.length < out.questions.length) {
    log.info('dropped quiz questions that failed the self-check', { dropped: out.questions.length - verified.length, kept: verified.length });
  }
  if (verified.length < Math.min(3, count)) {
    throw new AppError(422, "Couldn't generate enough well-grounded questions from these notes. Try a broader topic.");
  }

  const byTag = new Map(sources.map((s) => [s.tag, s]));
  const seen = new Set();
  const questions = [];
  for (const q of verified) {
    const norm = q.question.trim().toLowerCase();
    if (seen.has(norm)) continue;
    seen.add(norm);
    questions.push(shuffleOptions({ ...q, src: byTag.get(q.sourceTag.trim().replace(/^\[|\]$/g, '')) }));
    if (questions.length === count) break;
  }

  return db.transaction(async (tx) => {
    const [quiz] = await tx.insert(quizzes).values({ userId, difficulty, topic: topic ?? null, cacheKey: key }).returning({ id: quizzes.id });
    await tx.insert(quizDocument).values(docs.map((d) => ({ quizId: quiz.id, documentId: d.id })));
    await tx.insert(quizQuestions).values(
      questions.map((q, i) => ({
        quizId: quiz.id,
        position: i,
        question: q.question.trim(),
        options: q.options.map((o) => o.trim()),
        correctIndex: q.correctIndex,
        explanation: q.explanation.trim(),
        sourcePage: q.src?.page ?? null,
        sourceDocumentId: q.src?.documentId ?? null,
        difficulty: q.difficulty,
      })),
    );
    await auditService.record({
      action: 'create',
      entity: 'quiz',
      entityId: quiz.id,
      userId,
      after: { difficulty, topic: topic ?? null, questions: questions.length, documentIds: docs.map((d) => d.id) },
      tx,
    });
    return quiz.id;
  });
}

async function loadQuiz(userId, quizId) {
  const [quiz] = await db
    .select({ id: quizzes.id, difficulty: quizzes.difficulty, topic: quizzes.topic, createdAt: quizzes.createdAt })
    .from(quizzes)
    .where(and(eq(quizzes.id, quizId), eq(quizzes.userId, userId)));
  if (!quiz) throw AppError.notFound('Quiz not found');
  const [docs, questions] = await Promise.all([
    db
      .select({ id: documents.id, filename: documents.filename })
      .from(quizDocument)
      .innerJoin(documents, eq(documents.id, quizDocument.documentId))
      .where(eq(quizDocument.quizId, quizId)),
    db
      .select({
        id: quizQuestions.id,
        position: quizQuestions.position,
        question: quizQuestions.question,
        options: quizQuestions.options,
        correctIndex: quizQuestions.correctIndex,
        explanation: quizQuestions.explanation,
        sourcePage: quizQuestions.sourcePage,
        sourceDocumentId: quizQuestions.sourceDocumentId,
        sourceFilename: documents.filename,
        difficulty: quizQuestions.difficulty,
      })
      .from(quizQuestions)
      .leftJoin(documents, eq(documents.id, quizQuestions.sourceDocumentId))
      .where(eq(quizQuestions.quizId, quizId))
      .orderBy(asc(quizQuestions.position)),
  ]);
  return { ...quiz, documents: docs, questions };
}

/** Public view: no correct answers or explanations until submitted. */
const withoutAnswers = (quiz) => ({
  ...quiz,
  questions: quiz.questions.map(({ id, position, question, options }) => ({ id, position, question, options })),
});

export async function generateQuiz({ userId, documentIds, topic, difficulty, count, fresh }) {
  const docs = await requireReadyDocuments(userId, documentIds);
  const key = cacheKey({ docs: docs.map((d) => d.id).sort(), difficulty, count, topic: normalizeTopic(topic) });

  if (!fresh) {
    const [cached] = await db
      .select({ id: quizzes.id })
      .from(quizzes)
      .where(and(eq(quizzes.userId, userId), eq(quizzes.cacheKey, key)))
      .orderBy(desc(quizzes.createdAt))
      .limit(1);
    if (cached) {
      log.info('quiz served from cache', { quizId: cached.id });
      return { quiz: withoutAnswers(await loadQuiz(userId, cached.id)), cached: true };
    }
  }

  const flightKey = `${userId}:${key}`;
  if (!inflight.has(flightKey)) {
    inflight.set(flightKey, createQuiz({ userId, docs, topic, difficulty, count, key }).finally(() => inflight.delete(flightKey)));
  }
  const id = await inflight.get(flightKey);
  log.info('quiz generated', { quizId: id, difficulty, count, topic: topic ?? null });
  return { quiz: withoutAnswers(await loadQuiz(userId, id)), cached: false };
}

export async function getQuiz({ userId, quizId }) {
  return withoutAnswers(await loadQuiz(userId, quizId));
}

function grade(quiz, answers) {
  const results = quiz.questions.map((q, i) => {
    const selectedIndex = answers[i] ?? null;
    return {
      id: q.id,
      position: q.position,
      question: q.question,
      options: q.options,
      selectedIndex,
      correctIndex: q.correctIndex,
      correct: selectedIndex === q.correctIndex,
      explanation: q.explanation,
      sourcePage: q.sourcePage,
      sourceDocumentId: q.sourceDocumentId,
      sourceFilename: q.sourceFilename,
      difficulty: q.difficulty,
    };
  });
  return { results, score: results.filter((r) => r.correct).length, total: results.length };
}

export async function submitQuiz({ userId, quizId, answers }) {
  const quiz = await loadQuiz(userId, quizId);
  if (answers.length !== quiz.questions.length) {
    throw AppError.badRequest(`Expected ${quiz.questions.length} answers (use null for unanswered), got ${answers.length}`);
  }
  const { results, score, total } = grade(quiz, answers);
  const [attempt] = await db
    .insert(quizAttempts)
    .values({ quizId, userId, answers, score, total })
    .returning({ id: quizAttempts.id, createdAt: quizAttempts.createdAt });
  await auditService.record({ action: 'create', entity: 'quiz_attempt', entityId: attempt.id, userId, after: { quizId, score, total } });
  log.info('quiz submitted', { quizId, attemptId: attempt.id, score, total });
  return { attempt: { id: attempt.id, quizId, score, total, createdAt: attempt.createdAt, results }, quiz: withoutAnswers(quiz) };
}

export async function getAttempt({ userId, attemptId }) {
  const [attempt] = await db
    .select()
    .from(quizAttempts)
    .where(and(eq(quizAttempts.id, attemptId), eq(quizAttempts.userId, userId)));
  if (!attempt) throw AppError.notFound('Attempt not found');
  const quiz = await loadQuiz(userId, attempt.quizId);
  const { results } = grade(quiz, attempt.answers);
  return {
    attempt: { id: attempt.id, quizId: attempt.quizId, score: attempt.score, total: attempt.total, createdAt: attempt.createdAt, results },
    quiz: withoutAnswers(quiz),
  };
}

export async function getHistory({ userId, limit = 100 }) {
  const attempts = await db
    .select({
      id: quizAttempts.id,
      quizId: quizAttempts.quizId,
      score: quizAttempts.score,
      total: quizAttempts.total,
      createdAt: quizAttempts.createdAt,
      difficulty: quizzes.difficulty,
      topic: quizzes.topic,
    })
    .from(quizAttempts)
    .innerJoin(quizzes, eq(quizzes.id, quizAttempts.quizId))
    .where(eq(quizAttempts.userId, userId))
    .orderBy(desc(quizAttempts.createdAt))
    .limit(limit);

  const quizIds = [...new Set(attempts.map((a) => a.quizId))];
  const docRows = quizIds.length
    ? await db
        .select({ quizId: quizDocument.quizId, id: documents.id, filename: documents.filename })
        .from(quizDocument)
        .innerJoin(documents, eq(documents.id, quizDocument.documentId))
        .where(inArray(quizDocument.quizId, quizIds))
    : [];
  const docsByQuiz = new Map();
  for (const r of docRows) {
    if (!docsByQuiz.has(r.quizId)) docsByQuiz.set(r.quizId, []);
    docsByQuiz.get(r.quizId).push({ id: r.id, filename: r.filename });
  }

  const [stats] = await db
    .select({
      attempts: sql`count(*)::int`,
      avgPercent: sql`coalesce(round(avg(${quizAttempts.score} * 100.0 / nullif(${quizAttempts.total}, 0))), 0)::int`,
    })
    .from(quizAttempts)
    .where(eq(quizAttempts.userId, userId));

  return { attempts: attempts.map((a) => ({ ...a, documents: docsByQuiz.get(a.quizId) ?? [] })), stats };
}
