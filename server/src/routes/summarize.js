import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { validate } from '../middleware/validate.js';
import { llmLimiter } from '../middleware/rateLimit.js';
import { summarizeEstimateSchema, summarizeSchema } from '../schemas/summarize.js';
import { summarize, summarizeEstimate } from '../controllers/summarizeController.js';

const router = Router();
router.post('/', requireAuth, llmLimiter, validate({ body: summarizeSchema }), summarize);
// Cost estimates are admin-only (users never see money; the budget guard still applies to everyone).
router.get('/estimate', requireAuth, requireAdmin, validate({ query: summarizeEstimateSchema }), summarizeEstimate);
export default router;
