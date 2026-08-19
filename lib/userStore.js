// ========================================
// USER STORE (encrypted, Blob/file backed)
// ========================================
// Persists user accounts + linked OAuth identities. On Vercel the store lives in
// Vercel Blob (same mechanism as the audit log); locally it lives in a JSON file
// under data/. In both cases the payload is encrypted at rest with AES-256-GCM so
// that email addresses and password hashes are never exposed even if the blob URL
// leaks (Vercel Blob objects are world-readable by URL).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const IS_VERCEL = process.env.VERCEL === '1';
const USERS_BLOB_NAME = 'auth/basketstat-users.json';
// USERS_STORE_FILE overrides the local file path (used by tests for isolation).
const usersFilePath = process.env.USERS_STORE_FILE
  ? path.resolve(process.env.USERS_STORE_FILE)
  : path.join(__dirname, '..', 'data', 'users.json');
const CACHE_TTL_MS = 5000;

// Encryption key derived from a server secret. Falls back through the same chain
// as the session secret so the store works out of the box in local/dev.
const ENC_SECRET =
  process.env.USERS_SECRET ||
  process.env.SESSION_SECRET ||
  process.env.APP_PASSWORD ||
  'basketstat-default-secret';
const ENC_KEY = crypto.createHash('sha256').update(ENC_SECRET).digest();

let cache = null;
let cacheLoadedAt = 0;
let writeQueue = Promise.resolve();

// Vercel Blob functions (loaded dynamically for ES-module compatibility)
let blobPut, blobList;

async function loadBlobModule() {
  if (blobPut && blobList) return true;
  try {
    const mod = await import('@vercel/blob');
    blobPut = mod.put;
    blobList = mod.list;
    return true;
  } catch (e) {
    console.error('Failed to load @vercel/blob:', e);
    return false;
  }
}

// ---------- Encryption helpers ----------

function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    v: 1,
    alg: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: enc.toString('base64')
  });
}

function decrypt(envelopeStr) {
  let parsed;
  try {
    parsed = JSON.parse(envelopeStr);
  } catch {
    return [];
  }
  // Backwards/robustness: if it's already a plain array, treat as unencrypted.
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || parsed.v !== 1 || !parsed.iv || !parsed.data) return [];
  try {
    const iv = Buffer.from(parsed.iv, 'base64');
    const tag = Buffer.from(parsed.tag, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([
      decipher.update(Buffer.from(parsed.data, 'base64')),
      decipher.final()
    ]);
    const users = JSON.parse(dec.toString('utf8'));
    return Array.isArray(users) ? users : [];
  } catch (e) {
    console.error('Failed to decrypt user store (wrong USERS_SECRET/SESSION_SECRET?):', e.message);
    return [];
  }
}

// ---------- Storage I/O ----------

async function readFromStorage() {
  if (IS_VERCEL) {
    try {
      const ok = await loadBlobModule();
      if (ok && blobList) {
        const { blobs } = await blobList({ prefix: 'auth/' });
        const blob = blobs.find(b => b.pathname === USERS_BLOB_NAME);
        if (blob) {
          // Cache-bust: blob URLs are CDN-cached; append the uploadedAt token.
          const res = await fetch(`${blob.url}?ts=${Date.now()}`);
          if (res.ok) return decrypt(await res.text());
        }
      }
    } catch (e) {
      console.error('Failed to read user store from Vercel Blob:', e);
    }
    return [];
  }

  if (fs.existsSync(usersFilePath)) {
    try {
      return decrypt(fs.readFileSync(usersFilePath, 'utf8'));
    } catch (e) {
      console.error('Failed to read user store file:', e);
    }
  }
  return [];
}

async function writeToStorage(users) {
  const payload = encrypt(JSON.stringify(users));
  if (IS_VERCEL) {
    const ok = await loadBlobModule();
    if (ok && blobPut) {
      await blobPut(USERS_BLOB_NAME, payload, {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false,
        allowOverwrite: true,
        cacheControlMaxAge: 0
      });
    }
    return;
  }
  const dir = path.dirname(usersFilePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(usersFilePath, payload, 'utf8');
}

// ---------- Cache ----------

async function ensureLoaded(force = false) {
  if (!force && cache && Date.now() - cacheLoadedAt < CACHE_TTL_MS) {
    return cache;
  }
  cache = await readFromStorage();
  cacheLoadedAt = Date.now();
  return cache;
}

/**
 * Serialize mutations. Each mutation reloads the latest state from storage
 * (read-modify-write) to minimize lost updates across serverless instances.
 */
function mutate(fn) {
  const run = writeQueue.then(async () => {
    const users = await readFromStorage();
    const result = await fn(users);
    await writeToStorage(users);
    cache = users;
    cacheLoadedAt = Date.now();
    return result;
  });
  // Keep the queue alive even if a mutation rejects.
  writeQueue = run.catch(() => {});
  return run;
}

// ---------- Helpers ----------

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

/** Strip secret fields before sending a user to the client. */
function toPublic(user) {
  if (!user) return null;
  const { passwordHash, ...rest } = user;
  return {
    ...rest,
    hasPassword: !!passwordHash,
    providers: (user.identities || []).map(i => i.provider)
  };
}

// ---------- Read API ----------

async function listUsers() {
  const users = await ensureLoaded();
  return users.map(toPublic);
}

async function isEmpty() {
  const users = await ensureLoaded(true);
  return users.length === 0;
}

async function findById(id) {
  const users = await ensureLoaded();
  return users.find(u => u.id === id) || null;
}

async function findByEmail(email) {
  const norm = normalizeEmail(email);
  if (!norm) return null;
  const users = await ensureLoaded();
  return users.find(u => u.email === norm) || null;
}

async function findByIdentity(provider, sub) {
  if (!provider || !sub) return null;
  const users = await ensureLoaded();
  return (
    users.find(u => (u.identities || []).some(i => i.provider === provider && i.sub === sub)) ||
    null
  );
}

async function countActiveAdmins() {
  const users = await ensureLoaded();
  return users.filter(u => u.role === 'admin' && u.status === 'active').length;
}

// ---------- Mutations ----------

/**
 * Create a new user. Throws { code: 'EMAIL_EXISTS' } if the email is taken.
 */
async function createUser({ email, name = '', role = 'user', passwordHash = null, mustChange = false }) {
  const norm = normalizeEmail(email);
  if (!norm || !norm.includes('@')) {
    const err = new Error('A valid email is required');
    err.code = 'INVALID_EMAIL';
    throw err;
  }
  if (role !== 'user' && role !== 'admin') role = 'user';

  return mutate((users) => {
    if (users.some(u => u.email === norm)) {
      const err = new Error('Email already exists');
      err.code = 'EMAIL_EXISTS';
      throw err;
    }
    const now = new Date().toISOString();
    const user = {
      id: crypto.randomUUID(),
      email: norm,
      name: String(name || '').trim(),
      role,
      passwordHash,
      mustChange: !!mustChange,
      status: 'active',
      identities: [],
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null
    };
    users.push(user);
    return user;
  });
}

async function updateUser(id, patch = {}) {
  return mutate((users) => {
    const user = users.find(u => u.id === id);
    if (!user) return null;
    if (patch.name !== undefined) user.name = String(patch.name).trim();
    if (patch.role === 'user' || patch.role === 'admin') user.role = patch.role;
    if (patch.status === 'active' || patch.status === 'disabled') user.status = patch.status;
    if (patch.mustChange !== undefined) user.mustChange = !!patch.mustChange;
    user.updatedAt = new Date().toISOString();
    return user;
  });
}

async function setPassword(id, passwordHash, { mustChange = false } = {}) {
  return mutate((users) => {
    const user = users.find(u => u.id === id);
    if (!user) return null;
    user.passwordHash = passwordHash;
    user.mustChange = !!mustChange;
    user.updatedAt = new Date().toISOString();
    return user;
  });
}

async function deleteUser(id) {
  return mutate((users) => {
    const idx = users.findIndex(u => u.id === id);
    if (idx === -1) return false;
    users.splice(idx, 1);
    return true;
  });
}

/**
 * Link an OAuth identity to a user. Throws { code: 'IDENTITY_TAKEN' } if the
 * (provider, sub) pair is already linked to a different account.
 */
async function addIdentity(id, provider, sub) {
  return mutate((users) => {
    const owner = users.find(u =>
      (u.identities || []).some(i => i.provider === provider && i.sub === sub)
    );
    if (owner && owner.id !== id) {
      const err = new Error('Identity already linked to another user');
      err.code = 'IDENTITY_TAKEN';
      throw err;
    }
    const user = users.find(u => u.id === id);
    if (!user) return null;
    if (!user.identities) user.identities = [];
    if (!user.identities.some(i => i.provider === provider && i.sub === sub)) {
      user.identities.push({ provider, sub, linkedAt: new Date().toISOString() });
    }
    user.updatedAt = new Date().toISOString();
    return user;
  });
}

async function removeIdentity(id, provider) {
  return mutate((users) => {
    const user = users.find(u => u.id === id);
    if (!user) return null;
    user.identities = (user.identities || []).filter(i => i.provider !== provider);
    user.updatedAt = new Date().toISOString();
    return user;
  });
}

async function touchLogin(id) {
  return mutate((users) => {
    const user = users.find(u => u.id === id);
    if (!user) return null;
    user.lastLoginAt = new Date().toISOString();
    return user;
  });
}

module.exports = {
  listUsers,
  isEmpty,
  findById,
  findByEmail,
  findByIdentity,
  countActiveAdmins,
  createUser,
  updateUser,
  setPassword,
  deleteUser,
  addIdentity,
  removeIdentity,
  touchLogin,
  toPublic,
  normalizeEmail,
  // exposed for tests
  _encrypt: encrypt,
  _decrypt: decrypt
};
