const { createStore } = require('../recorder-store');
const sync = require('../recorder-sync');

function mockStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); }
  };
}

// Build a fake api() backed by an in-memory server draft table.
function fakeApi(serverDrafts, opts = {}) {
  const table = new Map(serverDrafts.map((d) => [d.id, d]));
  const calls = [];
  const api = async (method, url, body) => {
    calls.push({ method, url, body });
    const m = url.match(/\/drafts(?:\/([^/]+))?$/);
    const id = m && m[1] ? decodeURIComponent(m[1]) : null;
    if (method === 'GET') return { drafts: Array.from(table.values()) };
    if (method === 'PUT') {
      if (opts.failPushIds && opts.failPushIds.includes(id)) throw new Error('request failed (500)');
      const saved = Object.assign({}, body, { id, updatedAt: '2026-03-01T00:00:00.000Z' });
      table.set(id, saved);
      return { draft: saved };
    }
    if (method === 'DELETE') {
      if (!table.has(id)) throw new Error('not found (404)');
      table.delete(id);
      return { ok: true };
    }
    throw new Error('unexpected');
  };
  return { api, table, calls };
}

describe('recorder-sync', () => {
  let store;
  beforeEach(() => { store = createStore(mockStorage()); });

  test('pushes dirty drafts and clears their dirty flag', async () => {
    store.putDraft('t1', { id: 'd1', events: [1] });
    const { api, table } = fakeApi([]);
    const res = await sync.syncTeam('t1', { api, store });
    expect(res.pushed).toBe(1);
    expect(res.errors).toEqual([]);
    expect(table.get('d1').events).toEqual([1]);
    const local = store.getDraft('t1', 'd1');
    expect(local._dirty).toBe(false);
    expect(local.updatedAt).toBe('2026-03-01T00:00:00.000Z');
  });

  test('strips local-only flags from the pushed body', async () => {
    store.putDraft('t1', { id: 'd1', events: [] });
    const { api, calls } = fakeApi([]);
    await sync.syncTeam('t1', { api, store });
    const put = calls.find((c) => c.method === 'PUT');
    expect(put.body._dirty).toBeUndefined();
    expect(put.body._deleted).toBeUndefined();
    expect(put.body._syncedAt).toBeUndefined();
  });

  test('processes tombstones via DELETE and removes them locally', async () => {
    store.putClean('t1', { id: 'd1' });
    store.tombstone('t1', 'd1');
    const { api, table } = fakeApi([{ id: 'd1' }]);
    const res = await sync.syncTeam('t1', { api, store });
    expect(res.deleted).toBe(1);
    expect(table.has('d1')).toBe(false);
    expect(store.getDraft('t1', 'd1')).toBeNull();
  });

  test('treats a 404 on delete as already-deleted', async () => {
    store.putClean('t1', { id: 'gone' });
    store.tombstone('t1', 'gone');
    const { api } = fakeApi([]); // not on server
    const res = await sync.syncTeam('t1', { api, store });
    expect(res.deleted).toBe(1);
    expect(store.getDraft('t1', 'gone')).toBeNull();
  });

  test('pull refreshes clean baseline but never clobbers dirty local edits', async () => {
    store.putDraft('t1', { id: 'd1', events: ['local'] });
    // Server has a stale version of d1 plus a brand new d2.
    const { api } = fakeApi([
      { id: 'd1', events: ['server-stale'] },
      { id: 'd2', events: ['server-new'] }
    ], { failPushIds: ['d1'] }); // make the push fail so d1 stays dirty
    const res = await sync.syncTeam('t1', { api, store });
    expect(res.errors.some((e) => e.op === 'push')).toBe(true);
    // d1 still dirty + local content preserved (not clobbered by pull)
    const d1 = store.getDraft('t1', 'd1');
    expect(d1._dirty).toBe(true);
    expect(d1.events).toEqual(['local']);
    // d2 pulled in clean
    const d2 = store.getDraft('t1', 'd2');
    expect(d2.events).toEqual(['server-new']);
    expect(d2._dirty).toBe(false);
  });

  test('syncAll iterates all teams', async () => {
    store.putDraft('t1', { id: 'a' });
    store.putDraft('t2', { id: 'b' });
    const { api } = fakeApi([]);
    const out = await sync.syncAll([{ id: 't1' }, { id: 't2' }], { api, store });
    expect(out.t1.pushed).toBe(1);
    expect(out.t2.pushed).toBe(1);
  });

  test('no-op without deps', async () => {
    const res = await sync.syncTeam('t1', {});
    expect(res).toEqual({ pushed: 0, deleted: 0, pulled: 0, errors: [] });
  });
});
