import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { llmLimiter } from '../middleware/rateLimit.js';
import { attemptIdParams, questionsRequestSchema, quizGenerateSchema, quizIdParams, quizSubmitSchema } from '../schemas/generation.js';
import { questions, quizGenerate, quizGet, quizSubmit, quizAttempt, quizHistory } from '../controllers/generationController.js';

export const questionsRouter = Router();
questionsRouter.post('/', requireAuth, llmLimiter, validate({ body: questionsRequestSchema }), questions);

export const quizRouter = Router();
quizRouter.use(requireAuth);
quizRouter.post('/generate', llmLimiter, validate({ body: quizGenerateSchema }), quizGenerate);
quizRouter.get('/history', quizHistory); // before /:id
quizRouter.get('/attempts/:attemptId', validate({ params: attemptIdParams }), quizAttempt);
quizRouter.get('/:id', validate({ params: quizIdParams }), quizGet);
quizRouter.post('/:id/submit', validate({ params: quizIdParams, body: quizSubmitSchema }), quizSubmit);
