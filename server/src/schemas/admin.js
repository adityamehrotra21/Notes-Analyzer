import { z } from 'zod';

const page = z.coerce.number().int().min(1).default(1);
const pageSize = z.coerce.number().int().min(1).max(200).default(50);
const date = z.coerce.date().optional();

export const logsQuerySchema = z.object({
  level: z.enum(['debug', 'info', 'warn', 'error']).optional(), // minimum level
  module: z.string().trim().max(50).optional(),
  requestId: z.string().trim().max(64).optional(),
  userId: z.uuid().optional(),
  from: date,
  to: date,
  q: z.string().trim().max(200).optional(),
  page,
  pageSize,
});

export const auditQuerySchema = z.object({
  entity: z.string().trim().max(50).optional(),
  action: z.enum(['create', 'update', 'delete']).optional(),
  userId: z.uuid().optional(),
  page,
  pageSize,
});

export const streamQuerySchema = z.object({
  level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});
