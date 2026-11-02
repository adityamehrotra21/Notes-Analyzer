import { z } from 'zod';

export const exportSchema = z
  .object({
    type: z.enum(['notes', 'qa', 'quiz', 'attempt', 'all']),
    documentId: z.uuid().optional(),
    documentIds: z.array(z.uuid()).min(1).max(20).optional(),
    refId: z.uuid().optional(), // quiz id or attempt id
    format: z.enum(['pdf', 'md']).default('pdf'),
    email: z.boolean().default(false), // send the PDF to the signed-in user's email instead of downloading
    options: z
      .object({
        mode: z.enum(['brief', 'detailed', 'exam']).optional(),
        variant: z.enum(['questions', 'answers']).optional(),
        questionsOnly: z.boolean().optional(),
      })
      .default({}),
  })
  .refine((b) => (['notes', 'all'].includes(b.type) ? b.documentId : true), { message: 'documentId is required', path: ['documentId'] })
  .refine((b) => (b.type === 'qa' ? b.documentId || b.documentIds : true), { message: 'documentId(s) required', path: ['documentId'] })
  .refine((b) => (['quiz', 'attempt'].includes(b.type) ? b.refId : true), { message: 'refId is required', path: ['refId'] });
