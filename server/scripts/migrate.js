// Applies the SQL migrations in server/drizzle/ (committed to the repo).
// Only needs DATABASE_URL, so it can run before the rest of .env is filled in.
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { pgPoolConfig } from '../src/db/pgConfig.js';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set (server/.env)');
  process.exit(1);
}

const pool = new pg.Pool(pgPoolConfig({ max: 1 }));
const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

try {
  await migrate(drizzle(pool), { migrationsFolder });
  console.log('Migrations applied');
} catch (err) {
  console.error('Migration failed:', err.cause?.message ?? err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
