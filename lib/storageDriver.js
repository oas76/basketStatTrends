// ========================================
// STORAGE DRIVER SELECTION
// ========================================
// Chooses the persistence backend used by the user store, team store, and audit
// log. Kept dynamic (evaluated per call, not at module load) so tests and
// one-off scripts can set env vars at runtime.
//
// Selection order:
//   1. STORAGE_DRIVER=postgres|blob|file  (explicit override)
//   2. DATABASE_URL present               -> 'postgres' (Neon/Postgres)
//   3. VERCEL=1 and BLOB_READ_WRITE_TOKEN -> 'blob'      (Vercel Blob)
//   4. otherwise                          -> 'file'      (local JSON files)

const pgKv = require('./pgKv');

const VALID = ['postgres', 'blob', 'file'];

function currentDriver() {
  const explicit = String(process.env.STORAGE_DRIVER || '').trim().toLowerCase();
  if (VALID.includes(explicit)) return explicit;
  if (pgKv.configured()) return 'postgres';
  if (process.env.VERCEL === '1' && process.env.BLOB_READ_WRITE_TOKEN) return 'blob';
  return 'file';
}

module.exports = { currentDriver };
