// ========================================
// RECORDER OFFLINE SYNC
// ========================================
// Reconciles locally-stored drafts (recorder-store.js) with the server. Runs
// whenever connectivity is (or becomes) available: it pushes locally-edited
// drafts, applies pending deletes, then pulls the server's drafts to refresh the
// clean baseline for anything the client isn't actively editing.
//
// All I/O is injected so the engine is pure and unit-testable:
//   deps.api(method, url, body) -> Promise resolving to the parsed JSON body
//   deps.store                  -> a recorder-store instance
//
// Conflict policy: last-write-wins at the draft level. A locally dirty draft is
// never clobbered by a pull; its push (PUT upsert by id) wins.
//
// UMD: window.recorderSync in the browser; module.exports for Node/Jest.

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.recorderSync = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const draftsUrl = (teamId) => `/api/teams/${encodeURIComponent(teamId)}/drafts`;
  const draftUrl = (teamId, id) =>
    `/api/teams/${encodeURIComponent(teamId)}/drafts/${encodeURIComponent(id)}`;

  // Local-only bookkeeping fields that must never be sent to the server.
  function clean(draft) {
    const copy = Object.assign({}, draft);
    delete copy._dirty;
    delete copy._deleted;
    delete copy._syncedAt;
    return copy;
  }

  /**
   * Push one team's pending changes, then (optionally) pull to reconcile.
   * Returns { pushed, deleted, pulled, errors }.
   */
  async function syncTeam(teamId, deps) {
    const { api, store } = deps || {};
    const result = { pushed: 0, deleted: 0, pulled: 0, errors: [] };
    if (!api || !store) return result;

    const local = store.listDrafts(teamId);

    // 1) Apply pending deletes (tombstones) first so a delete+recreate can't race.
    for (const d of local.filter((x) => x._deleted && x._dirty)) {
      try {
        await api('DELETE', draftUrl(teamId, d.id));
        store.markSynced(teamId, d.id); // removes the tombstone entry
        result.deleted++;
      } catch (e) {
        // A 404 means the server already lacks it — treat as deleted.
        if (/404|not found/i.test((e && e.message) || '')) { store.markSynced(teamId, d.id); result.deleted++; }
        else result.errors.push({ id: d.id, op: 'delete', message: e && e.message });
      }
    }

    // 2) Push dirty edits (upsert by client id via PUT).
    for (const d of local.filter((x) => x._dirty && !x._deleted)) {
      try {
        const resp = await api('PUT', draftUrl(teamId, d.id), clean(d));
        const server = resp && resp.draft ? resp.draft : null;
        store.markSynced(teamId, d.id, server || {});
        result.pushed++;
      } catch (e) {
        result.errors.push({ id: d.id, op: 'push', message: e && e.message });
      }
    }

    // 3) Pull server drafts to refresh clean baselines. Never overwrite a draft
    //    the client is still editing (dirty), and never resurrect a draft the
    //    client is deleting.
    try {
      const resp = await api('GET', draftsUrl(teamId));
      const serverDrafts = (resp && resp.drafts) || [];
      const dirtyIds = new Set(
        store.listDrafts(teamId).filter((x) => x._dirty).map((x) => x.id)
      );
      for (const sd of serverDrafts) {
        if (dirtyIds.has(sd.id)) continue;
        store.putClean(teamId, sd);
        result.pulled++;
      }
    } catch (e) {
      result.errors.push({ op: 'pull', message: e && e.message });
    }

    return result;
  }

  /** Sync every team in `teams` (array of {id}). Aggregates per-team results. */
  async function syncAll(teams, deps) {
    const out = {};
    for (const t of teams || []) {
      out[t.id] = await syncTeam(t.id, deps);
    }
    return out;
  }

  return { syncTeam, syncAll, _clean: clean };
});
