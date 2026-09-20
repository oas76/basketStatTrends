// ========================================
// POSTGRES KEY-VALUE STORE (Neon serverless)
// ========================================
// A tiny key/value abstraction backed by a single `kv(key, value)` table on a
// Postgres database (Neon's free tier by default). Values are opaque strings —
// the callers (userStore/teamStore) store AES-256-GCM encrypted envelopes, so
// the database only ever holds ciphertext; the audit log stores plain JSON.
//
// Uses @neondatabase/serverless, whose `neon()` client speaks HTTP (no
// long-lived TCP connections), which is ideal for Vercel serverless functions
// and also works fine locally. The driver is required lazily so environments
// that don't use Postgres don't need the package loaded at runtime.
//
// Env: DATABASE_URL (Postgres connection string, e.g. Neon pooled URL).

let _sql = null;
let _schemaReady = null;

// Accept the common connection-string variable names. The Vercel–Neon
// integration provisions several of these; a manual setup usually sets
// DATABASE_URL. Prefer the pooled URLs for serverless.
const PG_URL_VARS = [
  'DATABASE_URL',
  'POSTGRES_URL',
  'DATABASE_URL_UNPOOLED',
  'POSTGRES_URL_NON_POOLING',
  'POSTGRES_PRISMA_URL'
];

/** Resolve the Postgres connection string from the supported env vars. */
function connectionString() {
  for (const name of PG_URL_VARS) {
    const val = process.env[name];
    if (val && String(val).trim()) return val;
  }
  return null;
}

function getSql() {
  if (_sql) return _sql;
  const url = connectionString();
  if (!url) {
    throw new Error(
      'Postgres is not configured: set DATABASE_URL (or POSTGRES_URL).'
    );
  }
  // Lazy require so non-Postgres deployments/tests don't need the dependency.
  const { neon } = require('@neondatabase/serverless');
  _sql = neon(url);
  return _sql;
}

/** Create the kv table on first use (idempotent, memoized per instance). */
function ensureSchema() {
  if (_schemaReady) return _schemaReady;
  const sql = getSql();
  _schemaReady = sql`
    CREATE TABLE IF NOT EXISTS kv (
      key        text PRIMARY KEY,
      value      text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `.then(() => true).catch((e) => {
    // Reset so a later call can retry after a transient failure.
    _schemaReady = null;
    throw e;
  });
  return _schemaReady;
}

/** Read the raw stored string for a key, or null if absent. */
async function get(key) {
  await ensureSchema();
  const rows = await getSql()`SELECT value FROM kv WHERE key = ${key}`;
  return rows.length ? rows[0].value : null;
}

/** Upsert the raw string for a key. */
async function set(key, value) {
  await ensureSchema();
  await getSql()`
    INSERT INTO kv (key, value)
    VALUES (${key}, ${value})
    ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value, updated_at = now()
  `;
}

/** Delete a key (no-op if absent). */
async function del(key) {
  await ensureSchema();
  await getSql()`DELETE FROM kv WHERE key = ${key}`;
}

/** List all keys with the given prefix. */
async function list(prefix) {
  await ensureSchema();
  const rows = await getSql()`SELECT key FROM kv WHERE key LIKE ${prefix + '%'} ORDER BY key`;
  return rows.map((r) => r.key);
}

function configured() {
  return !!connectionString();
}

module.exports = { get, set, del, list, configured, connectionString, ensureSchema, _getSql: getSql };
