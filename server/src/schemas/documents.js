import { z } from 'zod';

export const documentIdParams = z.object({ id: z.uuid('Invalid document id') });
