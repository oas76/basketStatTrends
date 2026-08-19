const os = require('os');
const path = require('path');
const fs = require('fs');

// Isolate the store in a temp file BEFORE requiring the module.
const TMP_FILE = path.join(os.tmpdir(), `basketstat-users-test-${process.pid}.json`);
process.env.USERS_STORE_FILE = TMP_FILE;
process.env.USERS_SECRET = 'test-users-secret';

const userStore = require('../lib/userStore');

afterAll(() => {
  try { fs.unlinkSync(TMP_FILE); } catch { /* ignore */ }
});

describe('userStore', () => {
  test('starts empty', async () => {
    expect(await userStore.isEmpty()).toBe(true);
    expect(await userStore.listUsers()).toEqual([]);
  });

  test('creates a user and finds it by email (case-insensitive)', async () => {
    const created = await userStore.createUser({
      email: 'Coach@Club.NO',
      name: 'Coach',
      role: 'admin',
      passwordHash: 'hash1'
    });
    expect(created.id).toBeTruthy();
    expect(created.email).toBe('coach@club.no');
    expect(created.role).toBe('admin');

    const found = await userStore.findByEmail('coach@club.no');
    expect(found.id).toBe(created.id);
  });

  test('rejects duplicate emails', async () => {
    await expect(
      userStore.createUser({ email: 'coach@club.no', passwordHash: 'x' })
    ).rejects.toMatchObject({ code: 'EMAIL_EXISTS' });
  });

  test('listUsers never leaks the password hash', async () => {
    const [publicUser] = await userStore.listUsers();
    expect(publicUser.passwordHash).toBeUndefined();
    expect(publicUser.hasPassword).toBe(true);
    expect(Array.isArray(publicUser.providers)).toBe(true);
  });

  test('links and looks up OAuth identities; blocks reuse across users', async () => {
    const coach = await userStore.findByEmail('coach@club.no');
    await userStore.addIdentity(coach.id, 'google', 'google-sub-123');
    const byIdentity = await userStore.findByIdentity('google', 'google-sub-123');
    expect(byIdentity.id).toBe(coach.id);

    const other = await userStore.createUser({ email: 'assistant@club.no', passwordHash: 'h' });
    await expect(
      userStore.addIdentity(other.id, 'google', 'google-sub-123')
    ).rejects.toMatchObject({ code: 'IDENTITY_TAKEN' });
  });

  test('unlinks an identity', async () => {
    const coach = await userStore.findByEmail('coach@club.no');
    await userStore.removeIdentity(coach.id, 'google');
    expect(await userStore.findByIdentity('google', 'google-sub-123')).toBeNull();
  });

  test('counts active admins and updates roles/status', async () => {
    expect(await userStore.countActiveAdmins()).toBe(1);
    const assistant = await userStore.findByEmail('assistant@club.no');
    await userStore.updateUser(assistant.id, { role: 'admin' });
    expect(await userStore.countActiveAdmins()).toBe(2);
    await userStore.updateUser(assistant.id, { status: 'disabled' });
    expect(await userStore.countActiveAdmins()).toBe(1);
  });

  test('deletes a user', async () => {
    const assistant = await userStore.findByEmail('assistant@club.no');
    expect(await userStore.deleteUser(assistant.id)).toBe(true);
    expect(await userStore.findByEmail('assistant@club.no')).toBeNull();
  });

  test('persists as an encrypted (non-plaintext) file', () => {
    const raw = fs.readFileSync(TMP_FILE, 'utf8');
    expect(raw).not.toContain('coach@club.no');
    const env = JSON.parse(raw);
    expect(env.alg).toBe('aes-256-gcm');
    expect(env.iv).toBeTruthy();
    expect(env.data).toBeTruthy();
  });

  test('encrypt/decrypt round-trips', () => {
    const payload = JSON.stringify([{ id: '1', email: 'x@y.z' }]);
    const enc = userStore._encrypt(payload);
    expect(enc).not.toContain('x@y.z');
    const dec = userStore._decrypt(enc);
    expect(dec).toEqual([{ id: '1', email: 'x@y.z' }]);
  });
});
