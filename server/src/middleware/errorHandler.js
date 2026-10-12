import jwt from 'jsonwebtoken';
import multer from 'multer';
import { MAX_FILE_MB, MAX_FILES } from './upload.js';
import { ZodError } from 'zod';
import { AppError } from '../utils/AppError.js';
import { env } from '../config/env.js';
import logger from '../utils/logger.js';

const log = logger.child({ module: 'error' });

export function notFound(req, res, next) {
  next(AppError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

// Drizzle wraps driver errors in DrizzleQueryError; the pg error (with .code) is on .cause.
const pgCode = (err) => err?.cause?.code ?? err?.code;

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  let status = 500;
  let message = 'Internal server error';
  let details;
  let code;

  if (err instanceof AppError) {
    ({ status, message, details } = err);
  } else if (err instanceof ZodError) {
    status = 400;
    message = 'Validation failed';
    details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  } else if (err instanceof multer.MulterError) {
    status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    message =
      err.code === 'LIMIT_FILE_SIZE'
        ? `Each PDF must be ${MAX_FILE_MB} MB or smaller`
        : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE'
          ? `Upload up to ${MAX_FILES} PDFs at a time using the "files" field`
          : err.message;
  } else if (pgCode(err) === '23505') {
    status = 409;
    message = 'That record already exists';
  } else if (pgCode(err) === '22P02') {
    status = 400;
    message = 'Invalid identifier';
  } else if (pgCode(err) === '23503') {
    status = 400;
    message = 'Referenced record does not exist';
  } else if (err instanceof jwt.TokenExpiredError) {
    status = 401;
    message = 'Access token expired';
    code = 'TOKEN_EXPIRED'; // the client refreshes silently and retries
  } else if (err instanceof jwt.JsonWebTokenError) {
    status = 401;
    message = 'Invalid token';
  } else if (err?.type === 'entity.parse.failed') {
    status = 400;
    message = 'Malformed JSON body';
  } else if (err?.type === 'entity.too.large') {
    status = 413;
    message = 'Request body too large';
  }

  if (status === 499) return res.end(); // client cancelled
  if (status >= 500) log.error(`unhandled error: ${err?.message ?? err}`, { err, path: req.originalUrl.split('?')[0] });
  else if (status === 402) log.warn('request refused: budget', { path: req.originalUrl.split('?')[0] });

  const body = { error: { message } };
  if (details) body.error.details = details;
  if (code) body.error.code = code;
  if (status >= 500 && env.NODE_ENV === 'development') body.error.stack = err?.stack;
  res.status(status).json(body);
}
