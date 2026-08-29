const os = require('os');
const path = require('path');
const fs = require('fs');

// Isolate the store in a temp file BEFORE requiring the module.
const TMP_FILE = path.join(os.tmpdir(), `basketstat-recorder-role-test-${process.pid}.json`);
process.env.USERS_STORE_FILE = TMP_FILE;
process.env.USERS_SECRET = 'test-recorder-secret';

const userStore = require('../lib/userStore');

afterAll(() => {
  try { fs.unlinkSync(TMP_FILE); } catch { /* ignore */ }
});

describe('recorder platform role', () => {
  test('createUser accepts the recorder role', async () => {
    const u = await userStore.createUser({ email: 'rec@club.no', role: 'recorder' });
    expect(u.role).toBe('recorder');
  });

  test('createUser rejects an unknown role and defaults to user', async () => {
    const u = await userStore.createUser({ email: 'weird@club.no', role: 'superadmin' });
    expect(u.role).toBe('user');
  });

  test('updateUser can switch a user to and from recorder', async () => {
    const u = await userStore.createUser({ email: 'switch@club.no', role: 'user' });
    let updated = await userStore.updateUser(u.id, { role: 'recorder' });
    expect(updated.role).toBe('recorder');
    updated = await userStore.updateUser(u.id, { role: 'admin' });
    expect(updated.role).toBe('admin');
  });

  test('updateUser ignores an invalid role', async () => {
    const u = await userStore.createUser({ email: 'keep@club.no', role: 'recorder' });
    const updated = await userStore.updateUser(u.id, { role: 'nope' });
    expect(updated.role).toBe('recorder');
  });
});
