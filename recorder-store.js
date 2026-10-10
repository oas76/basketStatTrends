// ========================================
// RECORDER OFFLINE STORE (localStorage)
// ========================================
// Local-first persistence for the mobile recorder so a match can be started and
// recorded with no network. Everything the recorder needs offline is cached in
// localStorage:
//   rec:auth                 -> { email, teams:[{id,name,role}] } (last /auth/check)
//   rec:teamData:<teamId>    -> { players, leagues, finishedLeagues } (small subset)
//   rec:drafts:<teamId>      -> array of draft objects, each tagged with local
//                               sync flags: _dirty (needs push), _deleted
//                               (tombstone to DELETE), _syncedAt (ISO of last
//                               successful server round-trip).
//
// Drafts are the single source of truth while offline; recorder-sync.js walks
// these entries and reconciles them with the server when online.
//
// UMD: window.recorderStore (a default store over the global localStorage) in
// the browser; module.exports exposes { createStore } for Node/Jest with an
// injectable storage handle.

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    // Browser: expose a ready-to-use store bound to window.localStorage.
    root.recorderStore = api.createStore(
      typeof localStorage !== 'undefined' ? localStorage : null
    );
    root.recorderStore.createStore = api.createStore;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const AUTH_KEY = 'rec:auth';
  const TEAM_DATA_PREFIX = 'rec:teamData:';
  const DRAFTS_PREFIX = 'rec:drafts:';

  const nowISO = () => new Date().toISOString();

  /**
   * Build a store over a Storage-like object (localStorage, or a mock in tests).
   * All methods degrade to no-ops / empty results if no storage is available.
   */
  function createStore(storage) {
    const canStore = !!storage && typeof storage.getItem === 'function';

    function readJSON(key, fallback) {
      if (!canStore) return fallback;
      try {
        const raw = storage.getItem(key);
        if (raw == null) return fallback;
        return JSON.parse(raw);
      } catch (e) {
        return fallback;
      }
    }

    function writeJSON(key, value) {
      if (!canStore) return false;
      try {
        storage.setItem(key, JSON.stringify(value));
        return true;
      } catch (e) {
        // Quota or serialization failure — surface false so callers can warn.
        return false;
      }
    }

    function removeKey(key) {
      if (!canStore) return;
      try { storage.removeItem(key); } catch (e) { /* ignore */ }
    }

    // ---- auth ----
    function getAuth() { return readJSON(AUTH_KEY, null); }
    function setAuth(auth) {
      if (!auth || typeof auth !== 'object') return false;
      return writeJSON(AUTH_KEY, {
        email: auth.email || null,
        name: auth.name || null,
        teams: Array.isArray(auth.teams)
          ? auth.teams.map((t) => ({ id: t.id, name: t.name, role: t.role }))
          : []
      });
    }

    // ---- team data (roster + competitions; games are intentionally dropped) ----
    const teamDataKey = (teamId) => TEAM_DATA_PREFIX + teamId;
    function getTeamData(teamId) { return readJSON(teamDataKey(teamId), null); }
    function setTeamData(teamId, data) {
      const d = data && typeof data === 'object' ? data : {};
      return writeJSON(teamDataKey(teamId), {
        players: d.players || {},
        leagues: Array.isArray(d.leagues) ? d.leagues : [],
        finishedLeagues: Array.isArray(d.finishedLeagues) ? d.finishedLeagues : []
      });
    }

    // ---- drafts ----
    const draftsKey = (teamId) => DRAFTS_PREFIX + teamId;
    function readDrafts(teamId) {
      const arr = readJSON(draftsKey(teamId), []);
      return Array.isArray(arr) ? arr : [];
    }
    function writeDrafts(teamId, arr) { return writeJSON(draftsKey(teamId), arr); }

    /** All stored draft entries for a team, including tombstones (_deleted). */
    function listDrafts(teamId) { return readDrafts(teamId); }

    /** Non-deleted drafts, newest first — what the Home screen should show. */
    function activeDrafts(teamId) {
      return readDrafts(teamId)
        .filter((d) => !d._deleted)
        .sort((a, b) =>
          String(b.updatedAt || b.createdAt || '').localeCompare(
            String(a.updatedAt || a.createdAt || '')
          ));
    }

    function getDraft(teamId, id) {
      return readDrafts(teamId).find((d) => d.id === id) || null;
    }

    function upsert(teamId, draft, mutate) {
      const arr = readDrafts(teamId);
      const idx = arr.findIndex((d) => d.id === draft.id);
      const base = idx >= 0 ? arr[idx] : {};
      const next = mutate(Object.assign({}, base, draft));
      if (idx >= 0) arr[idx] = next; else arr.push(next);
      writeDrafts(teamId, arr);
      return next;
    }

    /** Local edit (start game / autosave): marks the draft dirty for sync. */
    function putDraft(teamId, draft) {
      if (!draft || !draft.id) return null;
      return upsert(teamId, draft, (merged) => {
        merged._dirty = true;
        merged._deleted = false;
        merged.updatedAt = nowISO();
        if (!merged.createdAt) merged.createdAt = merged.updatedAt;
        return merged;
      });
    }

    /** Store a server copy as the clean baseline (no pending push). */
    function putClean(teamId, draft) {
      if (!draft || !draft.id) return null;
      return upsert(teamId, draft, (merged) => {
        merged._dirty = false;
        merged._deleted = false;
        merged._syncedAt = nowISO();
        return merged;
      });
    }

    /**
     * Mark a draft as successfully pushed. If it was a tombstone it is removed
     * entirely; otherwise its clean baseline is refreshed (optionally merging
     * server-authoritative fields like updatedAt).
     */
    function markSynced(teamId, id, serverDraft) {
      const arr = readDrafts(teamId);
      const idx = arr.findIndex((d) => d.id === id);
      if (idx < 0) return;
      if (arr[idx]._deleted) {
        arr.splice(idx, 1);
        writeDrafts(teamId, arr);
        return;
      }
      arr[idx] = Object.assign({}, arr[idx], serverDraft || {}, {
        _dirty: false,
        _deleted: false,
        _syncedAt: nowISO()
      });
      writeDrafts(teamId, arr);
    }

    /** Mark an existing (previously synced) draft for deletion on next sync. */
    function tombstone(teamId, id) {
      const arr = readDrafts(teamId);
      const idx = arr.findIndex((d) => d.id === id);
      if (idx < 0) return;
      arr[idx]._deleted = true;
      arr[idx]._dirty = true;
      writeDrafts(teamId, arr);
    }

    /** Remove a draft entirely (local-only drafts never pushed to the server). */
    function removeDraft(teamId, id) {
      const arr = readDrafts(teamId).filter((d) => d.id !== id);
      writeDrafts(teamId, arr);
    }

    /** Count drafts awaiting push (dirty edits + pending deletes) for a team. */
    function unsyncedCount(teamId) {
      return readDrafts(teamId).filter((d) => d._dirty).length;
    }

    return {
      // auth
      getAuth, setAuth,
      // team data
      getTeamData, setTeamData,
      // drafts
      listDrafts, activeDrafts, getDraft,
      putDraft, putClean, markSynced, tombstone, removeDraft, unsyncedCount,
      // introspection for tests
      _canStore: canStore
    };
  }

  return { createStore };
});
