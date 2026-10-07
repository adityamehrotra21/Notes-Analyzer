import { sql } from 'drizzle-orm';
import {
  pgTable, pgEnum, uuid, text, integer, bigint, numeric, timestamp, jsonb, vector, index, uniqueIndex, primaryKey,
} from 'drizzle-orm/pg-core';

// Read directly from process.env (not config/env.js) so drizzle-kit can load this file on its own.
// The vector dimension is baked into the migration SQL when it is generated. If you change
// EMBED_DIMENSIONS, run `npm run db:generate`, then re-ingest your documents.
export const EMBED_DIMENSIONS = Number(process.env.EMBED_DIMENSIONS || 1536);

const id = () => uuid('id').primaryKey().defaultRandom();
const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
};

export const documentStatus = pgEnum('document_status', ['processing', 'ready', 'failed']);
export const quizDifficulty = pgEnum('quiz_difficulty', ['easy', 'medium', 'hard']);
export const questionType = pgEnum('question_type', ['short', 'long', 'conceptual']);
export const userRole = pgEnum('user_role', ['user', 'admin']);
export const logLevel = pgEnum('log_level', ['debug', 'info', 'warn', 'error']);
export const auditAction = pgEnum('audit_action', ['create', 'update', 'delete']);

export const users = pgTable('users', {
  id: id(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: userRole('role').notNull().default('user'),
  ...timestamps,
});

export const documents = pgTable(
  'documents',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    pageCount: integer('page_count'),
    status: documentStatus('status').notNull().default('processing'),
    error: text('error'),
    summaryBrief: text('summary_brief'),
    summaryDetailed: text('summary_detailed'),
    summaryBullet: text('summary_bullet'),
    summaryExam: text('summary_exam'), // "Exam Revision" mode
    // Topic outline extracted once (cheap model) and reused by every notes mode + the coverage check:
    // { documentType, topics: [{ title, startPage, endPage, subtopics[] }] }
    outline: jsonb('outline'),
    // Coverage per mode after the post-generation check: { [mode]: { covered, total, missing[], filled[] } }
    summaryCoverage: jsonb('summary_coverage'),
    // Map-step notes from map-reduce summaries, reused by every mode so the expensive pass runs once.
    summaryNotes: text('summary_notes'),
    // sha256 of the uploaded PDF: the same file uploaded twice by a user is never re-embedded.
    contentHash: text('content_hash'),
    ...timestamps,
  },
  (t) => [
    index('documents_user_id_idx').on(t.userId),
    uniqueIndex('documents_user_hash_idx').on(t.userId, t.contentHash).where(sql`${t.contentHash} is not null`),
  ],
);

export const chunks = pgTable(
  'chunks',
  {
    id: id(),
    documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    chunkIndex: integer('chunk_index').notNull(),
    page: integer('page'), // first page of the chunk's content
    pageEnd: integer('page_end'), // last page (same as page unless the chunk spans a page break)
    text: text('text').notNull(),
    tokenCount: integer('token_count').notNull(),
    embedding: vector('embedding', { dimensions: EMBED_DIMENSIONS }).notNull(),
    ...timestamps,
  },
  (t) => [
    index('chunks_embedding_hnsw_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
    index('chunks_user_document_idx').on(t.userId, t.documentId),
    uniqueIndex('chunks_document_chunk_idx').on(t.documentId, t.chunkIndex),
  ],
);

export const quizzes = pgTable(
  'quizzes',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    difficulty: quizDifficulty('difficulty').notNull(),
    topic: text('topic'),
    // sha1(document set + difficulty + count + topic): reuse a quiz with identical settings.
    cacheKey: text('cache_key'),
    ...timestamps,
  },
  (t) => [index('quizzes_user_id_idx').on(t.userId), index('quizzes_cache_idx').on(t.userId, t.cacheKey)],
);

export const quizQuestions = pgTable(
  'quiz_questions',
  {
    id: id(),
    quizId: uuid('quiz_id').notNull().references(() => quizzes.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    question: text('question').notNull(),
    options: jsonb('options').$type().notNull(), // string[4]
    correctIndex: integer('correct_index').notNull(),
    explanation: text('explanation').notNull(),
    sourcePage: integer('source_page'),
    sourceDocumentId: uuid('source_document_id').references(() => documents.id, { onDelete: 'set null' }),
    difficulty: quizDifficulty('difficulty'),
    ...timestamps,
  },
  (t) => [uniqueIndex('quiz_questions_quiz_position_idx').on(t.quizId, t.position)],
);

export const quizDocument = pgTable(
  'quiz_document',
  {
    quizId: uuid('quiz_id').notNull().references(() => quizzes.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.quizId, t.documentId] }), index('quiz_document_document_idx').on(t.documentId)],
);

export const quizAttempts = pgTable(
  'quiz_attempts',
  {
    id: id(),
    quizId: uuid('quiz_id').notNull().references(() => quizzes.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    answers: jsonb('answers').$type().notNull(), // (number | null)[]
    score: integer('score').notNull(),
    total: integer('total').notNull(),
    ...timestamps,
  },
  (t) => [index('quiz_attempts_user_created_idx').on(t.userId, t.createdAt)],
);

export const generatedQuestions = pgTable(
  'generated_questions',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
    type: questionType('type').notNull(),
    topic: text('topic'), // null = whole-document questions
    question: text('question').notNull(),
    answer: text('answer').notNull(),
    sourcePage: integer('source_page'),
    // sha1(document set + type + topic): one cache bucket per request shape.
    cacheKey: text('cache_key'),
    ...timestamps,
  },
  (t) => [
    index('generated_questions_lookup_idx').on(t.userId, t.documentId, t.type),
    index('generated_questions_cache_idx').on(t.userId, t.cacheKey),
  ],
);


// ---------------------------------------------------------------- observability

/** Application logs written by utils/logger.js (batched). Pruned after LOG_RETENTION_DAYS. */
export const appLogs = pgTable(
  'app_logs',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
    level: logLevel('level').notNull(),
    module: text('module').notNull(),
    message: text('message').notNull(),
    requestId: text('request_id'),
    userId: uuid('user_id'), // no FK: logs outlive users and must never block inserts
    meta: jsonb('meta'),
    durationMs: integer('duration_ms'),
  },
  (t) => [
    index('app_logs_timestamp_idx').on(t.timestamp),
    index('app_logs_level_ts_idx').on(t.level, t.timestamp),
    index('app_logs_module_idx').on(t.module),
    index('app_logs_request_idx').on(t.requestId),
    index('app_logs_user_idx').on(t.userId),
  ],
);

/** Change log: who created/updated/deleted what. `changes` = { before, after } with only changed fields. */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id'), // no FK: keep the trail after a user is deleted
    action: auditAction('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    changes: jsonb('changes'),
    requestId: text('request_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_logs_created_idx').on(t.createdAt),
    index('audit_logs_entity_idx').on(t.entity, t.entityId),
    index('audit_logs_user_idx').on(t.userId),
  ],
);

/** One row per billed LLM/embedding call. The budget guard sums cost_usd. */
export const llmUsage = pgTable(
  'llm_usage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id'),
    requestId: text('request_id'),
    feature: text('feature').notNull(), // summary | chat | questions | quiz | embedding
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    cachedTokens: integer('cached_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costUsd: numeric('cost_usd', { precision: 12, scale: 8, mode: 'number' }).notNull().default(0),
    estimated: integer('estimated').notNull().default(0), // 1 = provider gave no usage (e.g. aborted stream)
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('llm_usage_created_idx').on(t.createdAt), index('llm_usage_feature_idx').on(t.feature)],
);

// ---------------------------------------------------------------- auth sessions

/** One row per login (device/browser). Tokens carry the session id; revoking a row logs that device out. */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    userAgent: text('user_agent'),
    ip: text('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    // Refresh token (httpOnly cookie) — only its SHA-256 is stored. Rotated on every refresh; the
    // previous hash is kept briefly so two tabs refreshing at once don't look like token theft.
    refreshHash: text('refresh_hash'),
    prevRefreshHash: text('prev_refresh_hash'),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
    refreshExpiresAt: timestamp('refresh_expires_at', { withTimezone: true }),
  },
  (t) => [index('sessions_user_idx').on(t.userId, t.revokedAt)],
);

// Forgot-password one-time codes (6 digits, emailed). Only an HMAC of the code is stored.
export const passwordResets = pgTable(
  'password_resets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    usedAt: timestamp('used_at', { withTimezone: true }),
    ip: text('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('password_resets_user_idx').on(t.userId, t.createdAt)],
);
