// ========================================
// TEAM STORE (encrypted, Blob/file backed)
// ========================================
// Multi-tenant storage for teams. Each team owns an independent stats document
// ({ players, games }). On Vercel everything lives in Vercel Blob (same
// mechanism as the user store); locally it lives in JSON files under data/.
// Payloads are encrypted at rest with AES-256-GCM so stats and team names are
// not exposed even if a Blob URL leaks (Vercel Blob objects are world-readable
// by URL).
//
// Layout:
//   teams/index.json          -> [{ id, name, slug, createdAt, createdBy }]
//   teams/{teamId}/data.json  -> { players: {}, games: [] }

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const IS_VERCEL = process.env.VERCEL === '1';
const TEAMS_INDEX_BLOB = 'teams/index.json';
const teamDataBlobName = (teamId) => `teams/${teamId}/data.json`;
// Recorder drafts (pending, un-imported games) live alongside the team data but
// in a separate document so they never touch the live { players, games } stats.
const teamDraftsBlobName = (teamId) => `teams/${teamId}/drafts.json`;

// TEAMS_STORE_DIR overrides the local storage directory (used by tests).
const storeDir = process.env.TEAMS_STORE_DIR
  ? path.resolve(process.env.TEAMS_STORE_DIR)
  : path.join(__dirname, '..', 'data');
const indexFilePath = path.join(storeDir, 'teams-index.json');
const teamDataFilePath = (teamId) => path.join(storeDir, 'teams', `${teamId}.json`);
const teamDraftsFilePath = (teamId) => path.join(storeDir, 'teams', `${teamId}.drafts.json`);

const CACHE_TTL_MS = 5000;

// Same key-derivation chain as the user store so both work out of the box.
const ENC_SECRET =
  process.env.USERS_SECRET ||
  process.env.SESSION_SECRET ||
  process.env.APP_PASSWORD ||
  'basketstat-default-secret';
const ENC_KEY = crypto.createHash('sha256').update(ENC_SECRET).digest();

let indexCache = null;
let indexCacheLoadedAt = 0;
let indexWriteQueue = Promise.resolve();

// Vercel Blob functions (loaded dynamically for ES-module compatibility)
let blobPut, blobList, blobDel;

async function loadBlobModule() {
  if (blobPut && blobList) return true;
  try {
    const mod = await import('@vercel/blob');
    blobPut = mod.put;
    blobList = mod.list;
    blobDel = mod.del;
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

function decrypt(envelopeStr, fallback) {
  let parsed;
  try {
    parsed = JSON.parse(envelopeStr);
  } catch {
    return fallback;
  }
  // Robustness: accept already-plain (unencrypted) payloads too.
  if (parsed && parsed.v !== 1) {
    return parsed;
  }
  if (!parsed || !parsed.iv || !parsed.data) return fallback;
  try {
    const iv = Buffer.from(parsed.iv, 'base64');
    const tag = Buffer.from(parsed.tag, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([
      decipher.update(Buffer.from(parsed.data, 'base64')),
      decipher.final()
    ]);
    return JSON.parse(dec.toString('utf8'));
  } catch (e) {
    console.error('Failed to decrypt team store (wrong USERS_SECRET/SESSION_SECRET?):', e.message);
    return fallback;
  }
}

// ---------- Low-level Blob/file I/O ----------

function assertPersistable() {
  if (IS_VERCEL && !process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error(
      'Team store cannot persist: no Vercel Blob store is attached ' +
      '(BLOB_READ_WRITE_TOKEN is missing). Add a Blob store in the Vercel ' +
      'dashboard (Storage → Blob) and redeploy.'
    );
  }
}

async function blobReadJson(blobName, fallback) {
  const ok = await loadBlobModule();
  if (!ok || !blobList) return fallback;
  const prefix = blobName.slice(0, blobName.lastIndexOf('/') + 1);
  const { blobs } = await blobList({ prefix });
  const blob = blobs.find(b => b.pathname === blobName);
  if (!blob) return fallback;
  const res = await fetch(`${blob.url}?ts=${Date.now()}`);
  if (!res.ok) return fallback;
  return decrypt(await res.text(), fallback);
}

async function blobWriteJson(blobName, value) {
  assertPersistable();
  const ok = await loadBlobModule();
  if (!ok || !blobPut) {
    throw new Error('Team store cannot persist: failed to load @vercel/blob.');
  }
  await blobPut(blobName, encrypt(JSON.stringify(value)), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0
  });
}

async function blobDeleteByName(blobName) {
  const ok = await loadBlobModule();
  if (!ok || !blobList || !blobDel) return;
  const prefix = blobName.slice(0, blobName.lastIndexOf('/') + 1);
  const { blobs } = await blobList({ prefix });
  const blob = blobs.find(b => b.pathname === blobName);
  if (blob) await blobDel(blob.url);
}

function fileReadJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return decrypt(fs.readFileSync(filePath, 'utf8'), fallback);
  } catch (e) {
    console.error('Failed to read team store file:', e);
    return fallback;
  }
}

function fileWriteJson(filePath, value) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, encrypt(JSON.stringify(value)), 'utf8');
}

// ---------- Index I/O ----------

async function readIndex() {
  if (IS_VERCEL) {
    try {
      return await blobReadJson(TEAMS_INDEX_BLOB, []);
    } catch (e) {
      console.error('Failed to read team index from Vercel Blob:', e);
      return [];
    }
  }
  const data = fileReadJson(indexFilePath, []);
  return Array.isArray(data) ? data : [];
}

async function writeIndex(teams) {
  if (IS_VERCEL) {
    await blobWriteJson(TEAMS_INDEX_BLOB, teams);
    return;
  }
  fileWriteJson(indexFilePath, teams);
}

async function ensureIndexLoaded(force = false) {
  if (!force && indexCache && Date.now() - indexCacheLoadedAt < CACHE_TTL_MS) {
    return indexCache;
  }
  indexCache = await readIndex();
  indexCacheLoadedAt = Date.now();
  return indexCache;
}

/** Serialize index mutations (read-modify-write) to limit lost updates. */
function mutateIndex(fn) {
  const run = indexWriteQueue.then(async () => {
    const teams = await readIndex();
    const result = await fn(teams);
    await writeIndex(teams);
    indexCache = teams;
    indexCacheLoadedAt = Date.now();
    return result;
  });
  indexWriteQueue = run.catch(() => {});
  return run;
}

// ---------- Per-team data I/O ----------

async function readTeamData(teamId) {
  const fallback = { players: {}, games: [] };
  if (IS_VERCEL) {
    try {
      const data = await blobReadJson(teamDataBlobName(teamId), fallback);
      return normalizeData(data);
    } catch (e) {
      console.error('Failed to read team data from Vercel Blob:', e);
      return fallback;
    }
  }
  return normalizeData(fileReadJson(teamDataFilePath(teamId), fallback));
}

async function writeTeamData(teamId, data) {
  const clean = normalizeData(data);
  if (IS_VERCEL) {
    await blobWriteJson(teamDataBlobName(teamId), clean);
    return clean;
  }
  fileWriteJson(teamDataFilePath(teamId), clean);
  return clean;
}

function normalizeData(data) {
  const out = data && typeof data === 'object' ? data : {};
  const leagues = Array.isArray(out.leagues)
    ? Array.from(new Set(out.leagues.filter(l => typeof l === 'string' && l.trim()).map(l => l.trim())))
    : [];
  return {
    players: out.players && typeof out.players === 'object' ? out.players : {},
    games: Array.isArray(out.games) ? out.games : [],
    leagues
  };
}

// ---------- Per-team drafts I/O ----------
// Drafts are stored as a plain array of draft objects. Writes are serialized per
// process via a promise queue to limit lost updates from bursty autosaves.

let draftsWriteQueue = Promise.resolve();

async function readDrafts(teamId) {
  const fallback = [];
  if (IS_VERCEL) {
    try {
      const data = await blobReadJson(teamDraftsBlobName(teamId), fallback);
      return Array.isArray(data) ? data : fallback;
    } catch (e) {
      console.error('Failed to read team drafts from Vercel Blob:', e);
      return fallback;
    }
  }
  const data = fileReadJson(teamDraftsFilePath(teamId), fallback);
  return Array.isArray(data) ? data : fallback;
}

async function writeDrafts(teamId, drafts) {
  const clean = Array.isArray(drafts) ? drafts : [];
  if (IS_VERCEL) {
    await blobWriteJson(teamDraftsBlobName(teamId), clean);
    return clean;
  }
  fileWriteJson(teamDraftsFilePath(teamId), clean);
  return clean;
}

/** Serialize draft mutations (read-modify-write) to limit lost updates. */
function mutateDrafts(teamId, fn) {
  const run = draftsWriteQueue.then(async () => {
    const drafts = await readDrafts(teamId);
    const result = await fn(drafts);
    await writeDrafts(teamId, result.drafts);
    return result.value;
  });
  draftsWriteQueue = run.catch(() => {});
  return run;
}

// ---------- Helpers ----------

const slugify = (name) =>
  String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'team';

// ---------- Public API ----------

async function listTeams() {
  const teams = await ensureIndexLoaded();
  return teams.map(t => ({ ...t }));
}

async function isEmpty() {
  const teams = await ensureIndexLoaded(true);
  return teams.length === 0;
}

async function getTeam(id) {
  const teams = await ensureIndexLoaded();
  const t = teams.find(x => x.id === id);
  return t ? { ...t } : null;
}

async function createTeam({ name, createdBy = null } = {}) {
  const trimmed = String(name || '').trim();
  if (!trimmed) {
    const err = new Error('Team name is required');
    err.code = 'INVALID_NAME';
    throw err;
  }
  return mutateIndex((teams) => {
    if (teams.some(t => t.name.toLowerCase() === trimmed.toLowerCase())) {
      const err = new Error('A team with that name already exists');
      err.code = 'NAME_EXISTS';
      throw err;
    }
    const team = {
      id: crypto.randomUUID(),
      name: trimmed,
      slug: slugify(trimmed),
      createdAt: new Date().toISOString(),
      createdBy
    };
    teams.push(team);
    return { ...team };
  });
}

async function updateTeam(id, patch = {}) {
  return mutateIndex((teams) => {
    const team = teams.find(t => t.id === id);
    if (!team) return null;
    if (patch.name !== undefined) {
      const trimmed = String(patch.name).trim();
      if (trimmed) {
        team.name = trimmed;
        team.slug = slugify(trimmed);
      }
    }
    return { ...team };
  });
}

async function deleteTeam(id) {
  const removed = await mutateIndex((teams) => {
    const idx = teams.findIndex(t => t.id === id);
    if (idx === -1) return false;
    teams.splice(idx, 1);
    return true;
  });
  if (removed) {
    // Best-effort removal of the team's data + drafts documents.
    try {
      if (IS_VERCEL) {
        await blobDeleteByName(teamDataBlobName(id));
        await blobDeleteByName(teamDraftsBlobName(id));
      } else {
        const p = teamDataFilePath(id);
        if (fs.existsSync(p)) fs.unlinkSync(p);
        const dp = teamDraftsFilePath(id);
        if (fs.existsSync(dp)) fs.unlinkSync(dp);
      }
    } catch (e) {
      console.error('Failed to delete team data for', id, e.message);
    }
  }
  return removed;
}

async function getTeamData(id) {
  return readTeamData(id);
}

async function saveTeamData(id, data) {
  return writeTeamData(id, data);
}

// ---------- Drafts (recorder) public API ----------

/** List all recording drafts for a team (newest first). */
async function getDrafts(teamId) {
  const drafts = await readDrafts(teamId);
  return [...drafts].sort((a, b) =>
    String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''))
  );
}

/** Get a single draft by id (or null). */
async function getDraft(teamId, draftId) {
  const drafts = await readDrafts(teamId);
  return drafts.find(d => String(d.id) === String(draftId)) || null;
}

/**
 * Create or update a draft (upsert by id). Server-managed fields (id, teamId,
 * createdBy, createdAt, updatedAt) are stamped here; the rest comes from the
 * client. Returns the stored draft.
 */
async function saveDraft(teamId, draft, { createdBy = null } = {}) {
  const now = new Date().toISOString();
  return mutateDrafts(teamId, (drafts) => {
    const incoming = draft && typeof draft === 'object' ? draft : {};
    const id = incoming.id ? String(incoming.id) : crypto.randomUUID();
    const idx = drafts.findIndex(d => String(d.id) === id);
    let stored;
    if (idx === -1) {
      stored = {
        ...incoming,
        id,
        teamId,
        createdBy,
        createdAt: now,
        updatedAt: now
      };
      drafts.push(stored);
    } else {
      stored = {
        ...drafts[idx],
        ...incoming,
        id,
        teamId,
        createdBy: drafts[idx].createdBy || createdBy,
        createdAt: drafts[idx].createdAt || now,
        updatedAt: now
      };
      drafts[idx] = stored;
    }
    return { drafts, value: stored };
  });
}

/** Delete a draft by id. Returns true if a draft was removed. */
async function deleteDraft(teamId, draftId) {
  return mutateDrafts(teamId, (drafts) => {
    const before = drafts.length;
    const next = drafts.filter(d => String(d.id) !== String(draftId));
    return { drafts: next, value: next.length !== before };
  });
}

/**
 * Create a "Default" team and import an existing dataset, but only if no teams
 * exist yet. Returns the created team (or null if teams already existed).
 * `importData` is the existing { players, games } document (may be empty).
 */
async function createDefaultIfEmpty({ name = 'Default', createdBy = null, importData = null } = {}) {
  const created = await mutateIndex((teams) => {
    if (teams.length > 0) return null;
    const team = {
      id: crypto.randomUUID(),
      name: String(name).trim() || 'Default',
      slug: slugify(name),
      createdAt: new Date().toISOString(),
      createdBy
    };
    teams.push(team);
    return { ...team };
  });
  if (created && importData) {
    await writeTeamData(created.id, importData);
  }
  return created;
}

/** Describe where/how the store persists (for diagnostics). */
function getStorageInfo() {
  if (IS_VERCEL) {
    return {
      mode: 'vercel-blob',
      configured: !!process.env.BLOB_READ_WRITE_TOKEN,
      indexBlob: TEAMS_INDEX_BLOB
    };
  }
  return { mode: 'local-file', configured: true, dir: storeDir };
}

module.exports = {
  listTeams,
  isEmpty,
  getTeam,
  createTeam,
  updateTeam,
  deleteTeam,
  getTeamData,
  saveTeamData,
  getDrafts,
  getDraft,
  saveDraft,
  deleteDraft,
  createDefaultIfEmpty,
  getStorageInfo,
  // exposed for tests
  _encrypt: encrypt,
  _decrypt: decrypt
};
