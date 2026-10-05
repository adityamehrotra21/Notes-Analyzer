export class AppError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    if (details !== undefined) this.details = details;
  }

  static badRequest(msg = 'Bad request', details) { return new AppError(400, msg, details); }
  static unauthorized(msg = 'Unauthorized') { return new AppError(401, msg); }
  static forbidden(msg = 'Forbidden') { return new AppError(403, msg); }
  static notFound(msg = 'Not found') { return new AppError(404, msg); }
  static conflict(msg = 'Conflict') { return new AppError(409, msg); }
}

/** The model produced nothing usable (empty, refused, or cut off) even after recovery. Never shows raw details. */
export class GenerationError extends AppError {
  constructor(reason, details) {
    super(502, "Couldn't generate this right now, please try again.");
    this.name = 'GenerationError';
    this.reason = reason; // 'empty' | 'refusal' | 'incomplete' | 'invalid_json'
    if (details !== undefined) this.info = details; // logged, not sent to the client
  }
}
