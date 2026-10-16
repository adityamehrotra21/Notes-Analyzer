// Change (audit) log singleton. Call record() from services wherever data changes:
//
//   auditService.record({ action: 'update', entity: 'document', entityId, before: { status }, after: { status } });
//
// `changes` stores only the fields that differ. Sensitive or bulky fields (password hashes,
// embeddings, file contents, chunk text) are never stored. requestId/userId come from the request
// context unless given. Failures are logged, never thrown (unless running inside a transaction).
import { db } from '../db/index.js';
import { auditLogs } from '../db/schema.js';
import { getContext } from '../utils/requestContext.js';
import logger from '../utils/logger.js';

const log = logger.child({ module: 'audit' });
const FORBIDDEN = /^(password|passwordHash|password_hash|embedding|buffer|content|fileContent|text|chunks?)$/i;
const MAX_VALUE_CHARS = 500;

function clean(obj) {
  if (!obj) return {};
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (FORBIDDEN.test(k) || v === undefined) continue;
    out[k] = typeof v === 'string' && v.length > MAX_VALUE_CHARS ? `[${v.length} chars]` : v instanceof Date ? v.toISOString() : v;
  }
  return out;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** { before, after } restricted to changed keys. */
export function diff(action, before, after) {
  const b = clean(before);
  const a = clean(after);
  if (action === 'create') return { before: null, after: a };
  if (action === 'delete') return { before: b, after: null };
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => !same(b[k], a[k]));
  if (!keys.length) return null;
  return {
    before: Object.fromEntries(keys.map((k) => [k, b[k] ?? null])),
    after: Object.fromEntries(keys.map((k) => [k, a[k] ?? null])),
  };
}

class AuditService {
  static #instance;

  static getInstance() {
    AuditService.#instance ??= new AuditService();
    return AuditService.#instance;
  }

  constructor() {
    if (AuditService.#instance) throw new Error('AuditService is a singleton: use AuditService.getInstance()');
  }

  /**
   * @param {{ action: 'create'|'update'|'delete', entity: string, entityId?: string, before?: object, after?: object, userId?: string, tx?: object }} entry
   */
  async record({ action, entity, entityId, before, after, userId, tx }) {
    const changes = diff(action, before, after);
    if (!changes) return; // update with nothing changed
    const ctx = getContext();
    const row = {
      userId: userId ?? ctx.userId ?? null,
      action,
      entity,
      entityId: entityId ? String(entityId) : null,
      changes,
      requestId: ctx.requestId ?? null,
    };
    try {
      await (tx ?? db).insert(auditLogs).values(row);
      log.debug(`${action} ${entity}`, { entityId: row.entityId });
    } catch (err) {
      if (tx) throw err; // let the surrounding transaction fail with it
      log.error('audit write failed', { err, action, entity, entityId: row.entityId });
    }
  }
}

const auditService = AuditService.getInstance();
export { AuditService };
export default auditService;
