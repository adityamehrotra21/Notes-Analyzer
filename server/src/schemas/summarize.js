import { z } from 'zod';

export const summarizeSchema = z.object({
  documentIds: z.array(z.uuid('Invalid document id')).min(1, 'Select at least one document').max(10, 'Summarise at most 10 documents at once'),
  mode: z.enum(['brief', 'detailed', 'exam']).default('detailed'),
  refresh: z.boolean().default(false),
});

export const summarizeEstimateSchema = z.object({
  documentId: z.uuid('Invalid document id'),
  mode: z.enum(['brief', 'detailed', 'exam']).default('detailed'),
  refresh: z.stringbool().default(false),
});
