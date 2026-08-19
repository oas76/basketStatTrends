const os = require('os');
const path = require('path');
const fs = require('fs');

// Isolate the user store in a temp file BEFORE requiring the module.
const TMP_FILE = path.join(os.tmpdir(), `basketstat-members-test-${process.pid}.json`);
process.env.USERS_STORE_FILE = TMP_FILE;
process.env.USERS_SECRET = 'test-members-secret';

const userStore = require('../lib/userStore');

afterAll(() => {
  try { fs.unlinkSync(TMP_FILE); } catch { /* ignore */ }
});

describe('userStore team memberships', () => {
  const TEAM_A = 'team-a';
  const TEAM_B = 'team-b';
  let admin;
  let member;

  test('new users start with no memberships', async () => {
    admin = await userStore.createUser({ email: 'admin@club.no', role: 'admin', passwordHash: 'h' });
    member = await userStore.createUser({ email: 'member@club.no', role: 'user', passwordHash: 'h' });
    expect(await userStore.getMemberships(admin.id)).toEqual([]);
    expect(await userStore.getMemberships(member.id)).toEqual([]);
  });

  test('setMembership adds and updates a per-team role', async () => {
    await userStore.setMembership(member.id, TEAM_A, 'member');
    await userStore.setMembership(member.id, TEAM_B, 'admin');
    let m = await userStore.getMemberships(member.id);
    expect(m).toEqual([
      { teamId: TEAM_A, role: 'member' },
      { teamId: TEAM_B, role: 'admin' }
    ]);

    // Updating an existing membership does not duplicate it.
    await userStore.setMembership(member.id, TEAM_A, 'admin');
    m = await userStore.getMemberships(member.id);
    expect(m).toHaveLength(2);
    expect(m.find(x => x.teamId === TEAM_A).role).toBe('admin');
  });

  test('invalid team roles fall back to member', async () => {
    await userStore.setMembership(admin.id, TEAM_A, 'superuser');
    const m = await userStore.getMemberships(admin.id);
    expect(m.find(x => x.teamId === TEAM_A).role).toBe('member');
  });

  test('listByTeam returns members annotated with team role, no password hash', async () => {
    const membersOfA = await userStore.listByTeam(TEAM_A);
    const emails = membersOfA.map(u => u.email).sort();
    expect(emails).toEqual(['admin@club.no', 'member@club.no']);
    membersOfA.forEach(u => {
      expect(u.passwordHash).toBeUndefined();
      expect(['admin', 'member']).toContain(u.teamRole);
    });
  });

  test('countTeamRole counts active admins for a team', async () => {
    // member is TEAM_A admin, admin is TEAM_A member -> exactly 1 admin.
    expect(await userStore.countTeamRole(TEAM_A, 'admin')).toBe(1);
    expect(await userStore.countTeamRole(TEAM_A, 'member')).toBe(1);
  });

  test('removeMembership removes only the given team', async () => {
    expect(await userStore.removeMembership(member.id, TEAM_A)).toBe(true);
    const m = await userStore.getMemberships(member.id);
    expect(m).toEqual([{ teamId: TEAM_B, role: 'admin' }]);
  });

  test('removeTeamFromAll strips a team from every user', async () => {
    // admin currently has TEAM_A (member); member currently has TEAM_B (admin).
    await userStore.setMembership(admin.id, TEAM_B, 'member');
    const changed = await userStore.removeTeamFromAll(TEAM_B);
    expect(changed).toBe(2);
    // TEAM_A membership on admin is untouched; only TEAM_B is stripped.
    expect(await userStore.getMemberships(admin.id)).toEqual([{ teamId: TEAM_A, role: 'member' }]);
    expect(await userStore.getMemberships(member.id)).toEqual([]);
  });

  test('toPublic exposes memberships but never the password hash', async () => {
    const [pub] = await userStore.listByTeam(TEAM_A); // TEAM_A now only has admin? none actually
    // TEAM_A memberships: admin was set to 'member' earlier, member removed.
    // admin still has TEAM_A membership (from invalid-role test) -> role member.
    expect(pub).toBeTruthy();
    expect(pub.passwordHash).toBeUndefined();
    expect(Array.isArray(pub.teams)).toBe(true);
  });
});
