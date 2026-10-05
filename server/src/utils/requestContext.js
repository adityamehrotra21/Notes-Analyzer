// Per-request context (requestId, userId) available anywhere in the call stack, including work that
// continues after the response (background ingestion), without passing it through every function.
import { AsyncLocalStorage } from 'node:async_hooks';

const als = new AsyncLocalStorage();

/** Run fn with a fresh context. */
export const runWithContext = (ctx, fn) => als.run({ ...ctx }, fn);

/** Current context ({} outside a request, e.g. startup jobs and CLI scripts). */
export const getContext = () => als.getStore() ?? {};

/** Called by auth middleware once the user is known. */
export function setContextUserId(userId) {
  const store = als.getStore();
  if (store) store.userId = userId;
}

/** Bind fn to the current context so it keeps it when run later (queues, timers). */
export const bindContext = (fn) => AsyncLocalStorage.bind(fn);
