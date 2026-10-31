import { z } from 'zod';

const documentIds = z.array(z.uuid('Invalid document id')).min(1, 'Select at least one document').max(20, 'Select at most 20 documents');
const topic = z.string().trim().max(200, 'Topic is too long').optional().transform((t) => (t ? t : undefined));

// Max per request, sized so answers fit MAX_OUTPUT_TOKENS_QUESTIONS (1500) / MAX_OUTPUT_TOKENS_QUIZ (2000).
export const MAX_QUESTIONS = { short: 15, conceptual: 15, long: 6 };
export const MAX_QUIZ_QUESTIONS = 12;

export const questionsRequestSchema = z
  .object({
    documentIds,
    topic,
    count: z.int().min(1).max(15).default(5),
    type: z.enum(['short', 'long', 'conceptual']).default('short'),
    more: z.boolean().default(false), // generate additional questions even if enough are cached
  })
  .refine((b) => b.count <= MAX_QUESTIONS[b.type], {
    message: 'Too many questions for this type (max 15 short/conceptual, 6 long per request)',
    path: ['count'],
  });

export const quizGenerateSchema = z.object({
  documentIds,
  topic,
  count: z.int().min(3, 'At least 3 questions').max(MAX_QUIZ_QUESTIONS, `At most ${MAX_QUIZ_QUESTIONS} questions`).default(10),
  difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
  fresh: z.boolean().default(false), // ignore a cached quiz with the same settings
});

export const quizIdParams = z.object({ id: z.uuid('Invalid quiz id') });
export const attemptIdParams = z.object({ attemptId: z.uuid('Invalid attempt id') });

export const quizSubmitSchema = z.object({
  answers: z.array(z.int().min(0).max(3).nullable()).max(50),
});

// ---- LLM output schemas (also sent to the provider as the structured-output schema) ----

// `verified` is the model's self-check that the item is fully supported by the sources;
// items with verified=false are dropped (no extra call).
export const questionsOutputSchema = z.object({
  questions: z
    .array(
      z.object({
        question: z.string().min(5),
        answer: z.string().min(1).describe('Model answer'),
        markingPoints: z.array(z.string().min(1)).min(1).max(6).describe('Points a marker would look for'),
        sourceTag: z.string().describe('Tag of the main supporting source, e.g. S3'),
        verified: z.boolean().describe('true only if the question and answer are fully supported by the sources'),
      }),
    )
    .min(1)
    .max(16),
});

export const quizOutputSchema = z.object({
  questions: z
    .array(
      z
        .object({
          question: z.string().min(5),
          options: z.array(z.string().min(1)).length(4),
          correctIndex: z.int().min(0).max(3),
          difficulty: z.enum(['easy', 'medium', 'hard']),
          explanation: z.string().min(1).describe('Why the answer is correct, citing the page'),
          sourceTag: z.string().describe('Tag of the supporting source, e.g. S2'),
          verified: z.boolean().describe('true only if exactly one option is correct according to the sources'),
        })
        .refine((q) => new Set(q.options.map((o) => o.trim().toLowerCase())).size === 4, {
          message: 'options must be 4 distinct answers',
          path: ['options'],
        }),
    )
    .min(1)
    .max(13),
});
