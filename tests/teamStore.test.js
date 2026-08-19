const os = require('os');
const path = require('path');
const fs = require('fs');

// Isolate the store in a temp directory BEFORE requiring the module.
const TMP_DIR = path.join(os.tmpdir(), `basketstat-teams-test-${process.pid}`);
process.env.TEAMS_STORE_DIR = TMP_DIR;
process.env.USERS_SECRET = 'test-teams-secret';

const teamStore = require('../lib/teamStore');

afterAll(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('teamStore', () => {
  let teamA;
  let teamB;

  test('starts empty', async () => {
    expect(await teamStore.isEmpty()).toBe(true);
    expect(await teamStore.listTeams()).toEqual([]);
  });

  test('creates teams with a slug and unique name', async () => {
    teamA = await teamStore.createTeam({ name: 'Kjelsås 2011', createdBy: 'u1' });
    expect(teamA.id).toBeTruthy();
    expect(teamA.name).toBe('Kjelsås 2011');
    expect(teamA.slug).toBe('kjels-s-2011');

    teamB = await teamStore.createTeam({ name: 'Ammerud G16' });
    expect(teamB.id).not.toBe(teamA.id);

    await expect(teamStore.createTeam({ name: 'kjelsås 2011' }))
      .rejects.toMatchObject({ code: 'NAME_EXISTS' });
    await expect(teamStore.createTeam({ name: '   ' }))
      .rejects.toMatchObject({ code: 'INVALID_NAME' });
  });

  test('per-team data is isolated', async () => {
    await teamStore.saveTeamData(teamA.id, {
      players: { Ola: { number: 7 } },
      games: [{ id: 'g1', opponent: 'X' }]
    });
    await teamStore.saveTeamData(teamB.id, {
      players: {},
      games: [{ id: 'g2', opponent: 'Y' }, { id: 'g3', opponent: 'Z' }]
    });

    const a = await teamStore.getTeamData(teamA.id);
    const b = await teamStore.getTeamData(teamB.id);
    expect(a.games).toHaveLength(1);
    expect(a.players.Ola.number).toBe(7);
    expect(b.games).toHaveLength(2);
    expect(b.players).toEqual({});
  });

  test('unknown team returns empty data document', async () => {
    const data = await teamStore.getTeamData('does-not-exist');
    expect(data).toEqual({ players: {}, games: [] });
  });

  test('renames a team', async () => {
    const updated = await teamStore.updateTeam(teamA.id, { name: 'Kjelsås 2011 Elite' });
    expect(updated.name).toBe('Kjelsås 2011 Elite');
    expect(updated.slug).toBe('kjels-s-2011-elite');
  });

  test('deletes a team and its data', async () => {
    expect(await teamStore.deleteTeam(teamB.id)).toBe(true);
    expect(await teamStore.getTeam(teamB.id)).toBeNull();
    // Data document is gone (falls back to empty).
    expect(await teamStore.getTeamData(teamB.id)).toEqual({ players: {}, games: [] });
    const remaining = await teamStore.listTeams();
    expect(remaining.map(t => t.id)).toEqual([teamA.id]);
  });

  test('createDefaultIfEmpty is a no-op when teams exist', async () => {
    const result = await teamStore.createDefaultIfEmpty({ importData: { players: {}, games: [] } });
    expect(result).toBeNull();
  });

  test('persists team data as an encrypted (non-plaintext) file', () => {
    const raw = fs.readFileSync(path.join(TMP_DIR, 'teams', `${teamA.id}.json`), 'utf8');
    expect(raw).not.toContain('Ola');
    const env = JSON.parse(raw);
    expect(env.alg).toBe('aes-256-gcm');
    expect(env.iv).toBeTruthy();
    expect(env.data).toBeTruthy();
  });

  test('encrypt/decrypt round-trips objects', () => {
    const enc = teamStore._encrypt(JSON.stringify({ players: {}, games: [{ id: 'z' }] }));
    expect(enc).not.toContain('games');
    const dec = teamStore._decrypt(enc, null);
    expect(dec).toEqual({ players: {}, games: [{ id: 'z' }] });
  });
});
