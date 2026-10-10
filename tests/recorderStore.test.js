const { createStore } = require('../recorder-store');

// Minimal in-memory Storage mock (matches the subset the store uses).
function mockStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    _dump: () => Object.fromEntries(map)
  };
}

describe('recorder-store', () => {
  let store;
  beforeEach(() => { store = createStore(mockStorage()); });

  test('auth round-trips and keeps only id/name/role for teams', () => {
    store.setAuth({ email: 'a@b.no', name: 'A', teams: [{ id: 't1', name: 'T1', role: 'admin', extra: 'x' }] });
    const auth = store.getAuth();
    expect(auth.email).toBe('a@b.no');
    expect(auth.teams).toEqual([{ id: 't1', name: 'T1', role: 'admin' }]);
  });

  test('team data stores roster + competitions and drops games', () => {
    store.setTeamData('t1', { players: { Ann: { active: true } }, leagues: ['L1'], finishedLeagues: [], games: [{ a: 1 }] });
    const d = store.getTeamData('t1');
    expect(d.players).toEqual({ Ann: { active: true } });
    expect(d.leagues).toEqual(['L1']);
    expect(d.games).toBeUndefined();
  });

  test('putDraft marks dirty and stamps timestamps', () => {
    const d = store.putDraft('t1', { id: 'd1', events: [] });
    expect(d._dirty).toBe(true);
    expect(d._deleted).toBe(false);
    expect(d.createdAt).toBeTruthy();
    expect(d.updatedAt).toBeTruthy();
    expect(store.unsyncedCount('t1')).toBe(1);
  });

  test('putDraft upserts by id (no duplicates)', () => {
    store.putDraft('t1', { id: 'd1', events: [1] });
    store.putDraft('t1', { id: 'd1', events: [1, 2] });
    const all = store.listDrafts('t1');
    expect(all.length).toBe(1);
    expect(all[0].events).toEqual([1, 2]);
  });

  test('markSynced clears dirty and refreshes clean baseline', () => {
    store.putDraft('t1', { id: 'd1', events: [] });
    store.markSynced('t1', 'd1', { updatedAt: '2026-01-01T00:00:00.000Z' });
    const d = store.getDraft('t1', 'd1');
    expect(d._dirty).toBe(false);
    expect(d._syncedAt).toBeTruthy();
    expect(d.updatedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(store.unsyncedCount('t1')).toBe(0);
  });

  test('tombstone then markSynced removes the draft entirely', () => {
    store.putClean('t1', { id: 'd1', events: [] });
    store.tombstone('t1', 'd1');
    expect(store.unsyncedCount('t1')).toBe(1);
    expect(store.getDraft('t1', 'd1')._deleted).toBe(true);
    store.markSynced('t1', 'd1');
    expect(store.getDraft('t1', 'd1')).toBeNull();
    expect(store.listDrafts('t1').length).toBe(0);
  });

  test('activeDrafts hides tombstones and sorts newest first', () => {
    store.putClean('t1', { id: 'old', updatedAt: '2026-01-01T00:00:00.000Z' });
    store.putClean('t1', { id: 'new', updatedAt: '2026-02-01T00:00:00.000Z' });
    store.putClean('t1', { id: 'gone' });
    store.tombstone('t1', 'gone');
    const active = store.activeDrafts('t1');
    expect(active.map((d) => d.id)).toEqual(['new', 'old']);
  });

  test('removeDraft deletes a local-only draft', () => {
    store.putDraft('t1', { id: 'd1' });
    store.removeDraft('t1', 'd1');
    expect(store.getDraft('t1', 'd1')).toBeNull();
  });

  test('degrades to no-ops without a storage handle', () => {
    const none = createStore(null);
    expect(none._canStore).toBe(false);
    expect(none.getAuth()).toBeNull();
    expect(none.putDraft('t1', { id: 'd1' })).toEqual(expect.objectContaining({ id: 'd1' }));
    expect(none.listDrafts('t1')).toEqual([]);
  });
});
