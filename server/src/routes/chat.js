import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { llmLimiter } from '../middleware/rateLimit.js';
import { chatSchema } from '../schemas/chat.js';
import { chat } from '../controllers/chatController.js';

const router = Router();
router.post('/', requireAuth, llmLimiter, validate({ body: chatSchema }), chat);
export default router;
