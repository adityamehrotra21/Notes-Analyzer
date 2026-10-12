// Gives every request an id (X-Request-Id), runs the rest of the pipeline inside a request context
// (so every log line and usage row carries requestId/userId), and logs method/path/status/duration.
import { randomUUID } from 'node:crypto';
import { runWithContext } from '../utils/requestContext.js';
import logger from '../utils/logger.js';

const log = logger.child({ module: 'http' });
const QUIET = new Set(['/api/health']); // logged at debug only

export function requestLogger(req, res, next) {
  const requestId = randomUUID();
  const start = process.hrtime.bigint();
  req.id = requestId;
  res.setHeader('X-Request-Id', requestId);

  runWithContext({ requestId, userId: null }, () => {
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      const status = res.statusCode;
      const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : QUIET.has(req.path) ? 'debug' : 'info';
      log[level](`${req.method} ${req.originalUrl.split('?')[0]} ${status}`, {
        method: req.method,
        path: req.originalUrl.split('?')[0],
        status,
        bytes: Number(res.getHeader('content-length')) || undefined,
        durationMs,
      });
    });
    next();
  });
}
