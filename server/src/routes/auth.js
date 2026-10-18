import { Router } from 'express';
import {
  register,
  login,
  me,
  logout,
  logoutAll,
  sessionsList,
  sessionRevoke,
  sessionsRevokeOthers,
  changePassword,
  refresh,
  forgotPassword,
  resetPassword,
} from '../controllers/authController.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { authLimiter, otpEmailLimiter } from '../middleware/rateLimit.js';
import { registerSchema, loginSchema, changePasswordSchema, sessionIdParams, forgotPasswordSchema, resetPasswordSchema } from '../schemas/auth.js';

const router = Router();

router.post('/register', authLimiter, validate({ body: registerSchema }), register);
router.post('/login', authLimiter, validate({ body: loginSchema }), login);
router.post('/refresh', refresh);
router.post('/forgot-password', authLimiter, validate({ body: forgotPasswordSchema }), otpEmailLimiter, forgotPassword);
router.post('/reset-password', authLimiter, validate({ body: resetPasswordSchema }), resetPassword);
router.get('/me', requireAuth, me);
router.post('/logout', requireAuth, logout);
router.post('/logout-all', requireAuth, logoutAll);
router.get('/sessions', requireAuth, sessionsList);
router.post('/sessions/revoke-others', requireAuth, sessionsRevokeOthers);
router.delete('/sessions/:id', requireAuth, validate({ params: sessionIdParams }), sessionRevoke);
router.post('/change-password', requireAuth, authLimiter, validate({ body: changePasswordSchema }), changePassword);

export default router;
