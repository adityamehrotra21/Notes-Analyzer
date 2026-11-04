// Grant (or revoke) admin: npm run make-admin -- you@example.com [--revoke]
import { parseArgs } from 'node:util';
import { eq } from 'drizzle-orm';
import { db, pool } from '../src/db/index.js';
import { users } from '../src/db/schema.js';
import auditService from '../src/services/auditService.js';

const { values, positionals } = parseArgs({ allowPositionals: true, options: { revoke: { type: 'boolean', default: false } } });
const email = positionals[0]?.trim().toLowerCase();

try {
  if (!email) throw new Error('Usage: npm run make-admin -- <email> [--revoke]');
  const role = values.revoke ? 'user' : 'admin';
  const [before] = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.email, email));
  if (!before) throw new Error(`No user with email ${email}. Register in the app first.`);
  if (before.role === role) {
    console.log(`${email} is already ${role}.`);
  } else {
    await db.update(users).set({ role }).where(eq(users.id, before.id));
    await auditService.record({ action: 'update', entity: 'user', entityId: before.id, userId: null, before: { role: before.role }, after: { role } });
    console.log(`${email}: ${before.role} -> ${role}. Reload the app to see the change.`);
  }
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
