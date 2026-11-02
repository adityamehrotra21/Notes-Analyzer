import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { exportLimiter } from '../middleware/rateLimit.js';
import { exportSchema } from '../schemas/export.js';
import { createExport } from '../controllers/exportController.js';

const router = Router();
router.post('/', requireAuth, exportLimiter, validate({ body: exportSchema }), createExport);
export default router;
