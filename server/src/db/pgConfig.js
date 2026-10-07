// node-postgres pool settings shared by the server and the scripts (migrate, make-admin).
// Reads process.env directly so scripts can use it without the full env validation.
//
//   DATABASE_URL  e.g. Supabase Session pooler: postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
//   DB_SSL        auto (default) | off | require | verify
//                 auto    = off for local hosts (localhost, docker), require for everything else
//                 require = encrypted, certificate not verified (works with Supabase/Neon out of the box)
//                 verify  = encrypted + verified against DB_SSL_CA (PEM text; Supabase: Database settings -> SSL certificate)
//   DB_POOL_MAX   max connections per process (default 5: Supabase free tier has a small connection budget)

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'db', 'host.docker.internal']);

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

export function pgPoolConfig({ max } = {}) {
  const raw = process.env.DATABASE_URL ?? '';
  const mode = (process.env.DB_SSL || 'auto').toLowerCase();
  const sslMode = mode === 'auto' ? (LOCAL_HOSTS.has(hostOf(raw)) ? 'off' : 'require') : mode;

  // node-postgres lets ?sslmode= in the URL override the ssl option below (and treats "require" as full
  // verification, which fails on Supabase's pooler). DB_SSL decides instead, so strip it from the URL.
  const connectionString = raw.replace(/([?&])(sslmode|sslrootcert|sslcert|sslkey)=[^&]*/g, '$1').replace(/[?&]+$/, '').replace(/\?&+/, '?');

  let ssl = false;
  if (sslMode === 'require') ssl = { rejectUnauthorized: false };
  else if (sslMode === 'verify') ssl = { rejectUnauthorized: true, ca: process.env.DB_SSL_CA?.replace(/\\n/g, '\n') };
  else if (sslMode !== 'off') throw new Error(`DB_SSL must be auto, off, require or verify (got "${mode}")`);

  return {
    connectionString,
    ssl,
    max: max ?? (Number(process.env.DB_POOL_MAX) || 5),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
  };
}
