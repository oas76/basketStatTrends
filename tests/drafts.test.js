const os = require('os');
const path = require('path');
const fs = require('fs');

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

  test('drafts persist encrypted at rest', async () => {
    await teamStore.saveDraft(team.id, { meta: { opponent: 'SecretOpp' }, events: [] });
    const raw = fs.readFileSync(path.join(TMP_DIR, 'teams', `${team.id}.drafts.json`), 'utf8');
    expect(raw).not.toContain('SecretOpp');
    const env = JSON.parse(raw);
    expect(env.alg).toBe('aes-256-gcm');
  });

  test('deleting a team removes its drafts document', async () => {
    await teamStore.deleteTeam(team.id);
    expect(await teamStore.getDrafts(team.id)).toEqual([]);
    expect(fs.existsSync(path.join(TMP_DIR, 'teams', `${team.id}.drafts.json`))).toBe(false);
  });
});
