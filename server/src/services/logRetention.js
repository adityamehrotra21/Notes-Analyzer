// Deletes app_logs older than LOG_RETENTION_DAYS: once at startup, then daily.
import { lt } from 'drizzle-orm';
import { db } from '../db/index.js';
import { appLogs } from '../db/schema.js';
import { env } from '../config/env.js';
import logger from '../utils/logger.js';

const log = logger.child({ module: 'retention' });
const DAY_MS = 24 * 60 * 60 * 1000;

export async function pruneLogs() {
  const cutoff = new Date(Date.now() - env.LOG_RETENTION_DAYS * DAY_MS);
  try {
    const deleted = await db.delete(appLogs).where(lt(appLogs.timestamp, cutoff)).returning({ id: appLogs.id });
    log.info('pruned old logs', { deleted: deleted.length, retentionDays: env.LOG_RETENTION_DAYS });
  } catch (err) {
    log.error('log pruning failed', { err });
  }
}

export function startLogRetention() {
  pruneLogs();
  setInterval(pruneLogs, DAY_MS).unref();
}
