import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';
import logger from '../utils/logger.js';
import { pgPoolConfig } from './pgConfig.js';

// SSL + a small pool (DB_POOL_MAX, default 5) — see pgConfig.js.
export const pool = new pg.Pool(pgPoolConfig());
pool.on('error', (err) => logger.child({ module: 'db' }).error('Postgres pool error', { err }));

export const db = drizzle(pool, { schema });
export { schema };
