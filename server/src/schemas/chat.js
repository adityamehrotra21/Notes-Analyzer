import { z } from 'zod';

export const documentIdsSchema = z.array(z.uuid('Invalid document id')).max(20, 'Select at most 20 documents');

export const chatSchema = z.object({
  question: z.string().trim().min(1, 'Ask a question').max(2000, 'Question is too long (max 2000 characters)'),
  documentIds: documentIdsSchema.default([]), // empty = all of the user's ready documents
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(20_000) }))
    .max(40)
    .default([]),
});
