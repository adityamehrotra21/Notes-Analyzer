import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { AppError } from '../utils/AppError.js';
import logger from '../utils/logger.js';

const log = logger.child({ module: 'auth' });

/** Use after requireAuth. Reads the role from the database (not the token) so demotion is immediate. */
export async function requireAdmin(req, res, next) {
  const [user] = await db.select({ role: users.role }).from(users).where(eq(users.id, req.user.id));
  if (user?.role !== 'admin') {
    log.warn('admin route refused', { path: req.originalUrl.split('?')[0] });
    return next(AppError.forbidden('Admins only'));
  }
  req.user.role = 'admin';
  next();
}
