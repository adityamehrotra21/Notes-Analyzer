import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { validate } from '../middleware/validate.js';
import { auditQuerySchema, logsQuerySchema, streamQuerySchema } from '../schemas/admin.js';
import { budgetStatus, listAudit, listLogs, streamLogs, usage } from '../controllers/adminController.js';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireAdmin);
adminRouter.get('/logs', validate({ query: logsQuerySchema }), listLogs);
adminRouter.get('/logs/stream', validate({ query: streamQuerySchema }), streamLogs);
adminRouter.get('/audit', validate({ query: auditQuerySchema }), listAudit);
adminRouter.get('/usage', usage);

export const budgetRouter = Router();
budgetRouter.get('/status', requireAuth, budgetStatus);
