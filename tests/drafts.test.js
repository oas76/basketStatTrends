const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Isolate the store in a temp directory BEFORE requiring the module.
const TMP_DIR = path.join(os.tmpdir(), `basketstat-drafts-test-${process.pid}`);
process.env.TEAMS_STORE_DIR = TMP_DIR;
process.env.USERS_SECRET = 'test-drafts-secret';

const teamStore = require('../lib/teamStore');

afterAll(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('teamStore drafts', () => {
  let team;
  let secretDraftId;

  test('starts with no drafts', async () => {
    team = await teamStore.createTeam({ name: 'Recorder Test' });
    expect(await teamStore.getDrafts(team.id)).toEqual([]);
  });

  test('creates a draft with server-managed fields', async () => {
    const saved = await teamStore.saveDraft(team.id, {
      status: 'in_progress',
      meta: { opponent: 'Rivals', league: 'U16' },
      roster: [{ name: 'A', number: 4, starter: true }],
      events: []
    }, { createdBy: 'user-1' });

    expect(saved.id).toBeTruthy();
    expect(saved.teamId).toBe(team.id);
    expect(saved.createdBy).toBe('user-1');
    expect(saved.createdAt).toBeTruthy();
    expect(saved.updatedAt).toBeTruthy();

    const drafts = await teamStore.getDrafts(team.id);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].meta.opponent).toBe('Rivals');
  });

  test('upserts by id and preserves createdAt while bumping updatedAt', async () => {
    const [existing] = await teamStore.getDrafts(team.id);
    const before = existing.updatedAt;
    await new Promise((r) => setTimeout(r, 5));

    const updated = await teamStore.saveDraft(team.id, {
      id: existing.id,
      status: 'completed',
      meta: existing.meta,
      roster: existing.roster,
      events: [{ id: 'e1', seq: 1, type: '2pt_made', player: 'A' }]
    });

    expect(updated.id).toBe(existing.id);
    expect(updated.status).toBe('completed');
    expect(updated.createdAt).toBe(existing.createdAt);
    expect(updated.updatedAt).not.toBe(before);
    expect(await teamStore.getDrafts(team.id)).toHaveLength(1);
  });

  test('gets a single draft by id', async () => {
    const [d] = await teamStore.getDrafts(team.id);
    const one = await teamStore.getDraft(team.id, d.id);
    expect(one.id).toBe(d.id);
    expect(await teamStore.getDraft(team.id, 'nope')).toBeNull();
  });

  test('deletes a draft', async () => {
    const [d] = await teamStore.getDrafts(team.id);
    expect(await teamStore.deleteDraft(team.id, d.id)).toBe(true);
    expect(await teamStore.deleteDraft(team.id, d.id)).toBe(false);
    expect(await teamStore.getDrafts(team.id)).toEqual([]);
  });

  test('drafts persist encrypted at rest (per-draft document)', async () => {
    const saved = await teamStore.saveDraft(team.id, { meta: { opponent: 'SecretOpp' }, events: [] });
    secretDraftId = saved.id;
    const raw = fs.readFileSync(path.join(TMP_DIR, 'teams', team.id, 'drafts', `${saved.id}.json`), 'utf8');
    expect(raw).not.toContain('SecretOpp');
    const env = JSON.parse(raw);
    expect(env.alg).toBe('aes-256-gcm');
  });

  test('deleting a team removes its per-draft documents and index', async () => {
    await teamStore.deleteTeam(team.id);
    expect(await teamStore.getDrafts(team.id)).toEqual([]);
    expect(fs.existsSync(path.join(TMP_DIR, 'teams', team.id, 'drafts', `${secretDraftId}.json`))).toBe(false);
    expect(fs.existsSync(path.join(TMP_DIR, 'teams', team.id, 'drafts', 'index.json'))).toBe(false);
  });

  test('migrates a legacy single-array drafts document to per-draft docs', async () => {
    const t = await teamStore.createTeam({ name: 'Legacy Team' });
    // Write a legacy drafts.json array directly (pre per-draft layout), encrypted
    // with the same key derivation the store uses (sha256 of USERS_SECRET).
    const key = crypto.createHash('sha256').update(process.env.USERS_SECRET).digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const legacy = [{ id: 'L1', teamId: t.id, meta: { opponent: 'OldFoe' }, events: [], updatedAt: '2020-01-01T00:00:00.000Z' }];
    const enc = Buffer.concat([cipher.update(JSON.stringify(legacy), 'utf8'), cipher.final()]);
    const envelope = JSON.stringify({
      v: 1, alg: 'aes-256-gcm', iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'), data: enc.toString('base64')
    });
    const legacyPath = path.join(TMP_DIR, 'teams', `${t.id}.drafts.json`);
    fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
    fs.writeFileSync(legacyPath, envelope, 'utf8');

    // First access migrates: legacy array fanned out into per-draft docs + index.
    const drafts = await teamStore.getDrafts(t.id);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].id).toBe('L1');
    expect(drafts[0].meta.opponent).toBe('OldFoe');
    expect(fs.existsSync(path.join(TMP_DIR, 'teams', t.id, 'drafts', 'L1.json'))).toBe(true);
    expect(fs.existsSync(path.join(TMP_DIR, 'teams', t.id, 'drafts', 'index.json'))).toBe(true);
    expect(fs.existsSync(legacyPath)).toBe(false);
  });
});
