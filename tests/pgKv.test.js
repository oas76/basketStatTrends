// Unit tests for the Postgres KV adapter, with @neondatabase/serverless mocked
// by a tiny in-memory SQL interpreter so no real database is required.

process.env.DATABASE_URL = 'postgres://test:test@localhost/test';

const mockStore = new Map();

jest.mock('@neondatabase/serverless', () => ({
  neon: () => (strings, ...values) => {
    const text = strings.join(' ? ').replace(/\s+/g, ' ').trim();
    if (/^CREATE TABLE/i.test(text)) return Promise.resolve([]);
    if (/^INSERT INTO kv/i.test(text)) {
      mockStore.set(values[0], values[1]);
      return Promise.resolve([]);
    }
    if (/^SELECT value FROM kv WHERE key =/i.test(text)) {
      const k = values[0];
      return Promise.resolve(mockStore.has(k) ? [{ value: mockStore.get(k) }] : []);
    }
    if (/^DELETE FROM kv WHERE key =/i.test(text)) {
      mockStore.delete(values[0]);
      return Promise.resolve([]);
    }
    if (/^SELECT key FROM kv WHERE key LIKE/i.test(text)) {
      const like = String(values[0]);
      const prefix = like.endsWith('%') ? like.slice(0, -1) : like;
      return Promise.resolve(
        [...mockStore.keys()].filter((k) => k.startsWith(prefix)).sort().map((key) => ({ key }))
      );
    }
    return Promise.resolve([]);
  }
}));

const pgKv = require('../lib/pgKv');

beforeEach(() => mockStore.clear());

describe('pgKv', () => {
  test('configured reflects DATABASE_URL', () => {
    expect(pgKv.configured()).toBe(true);
  });

  test('set then get round-trips the raw string', async () => {
    await pgKv.set('auth/basketstat-users.json', '{"v":1,"data":"abc"}');
    expect(await pgKv.get('auth/basketstat-users.json')).toBe('{"v":1,"data":"abc"}');
  });

  test('get returns null for a missing key', async () => {
    expect(await pgKv.get('teams/nope/data.json')).toBeNull();
  });

  test('set upserts (overwrites) an existing key', async () => {
    await pgKv.set('k', 'one');
    await pgKv.set('k', 'two');
    expect(await pgKv.get('k')).toBe('two');
  });

  test('del removes a key', async () => {
    await pgKv.set('k', 'v');
    await pgKv.del('k');
    expect(await pgKv.get('k')).toBeNull();
  });

  test('list returns keys matching a prefix', async () => {
    await pgKv.set('teams/a/data.json', '1');
    await pgKv.set('teams/a/drafts.json', '2');
    await pgKv.set('auth/basketstat-users.json', '3');
    expect(await pgKv.list('teams/a/')).toEqual([
      'teams/a/data.json',
      'teams/a/drafts.json'
    ]);
    expect((await pgKv.list('')).length).toBe(3);
  });
});
