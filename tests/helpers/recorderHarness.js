/**
 * Boots the real recorder (recorder.html body + recorder.js) in jsdom with the
 * network stubbed. The recorder is a page-level singleton, so boot it once per
 * test file.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const PLAYERS = ['Ola', 'Kari', 'Jonas', 'Emil', 'Sara', 'Nora', 'Liam'];

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/** serverDrafts: what GET /api/teams/t1/drafts returns. */
function stubFetch({ serverDrafts = [] } = {}) {
  const players = {};
  PLAYERS.forEach((n, i) => { players[n] = { number: i + 4, active: true }; });
  const json = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
  global.fetch = jest.fn((url, opts = {}) => {
    const method = opts.method || 'GET';
    if (url === '/api/auth/check') {
      return json({ authenticated: true, email: 'coach@example.com', teams: [{ id: 't1', name: 'Kjelsas' }] });
    }
    if (url === '/api/teams/t1/data') return json({ players, games: [], leagues: ['U15'], finishedLeagues: [] });
    if (url === '/api/teams/t1/drafts' && method === 'GET') return json({ drafts: serverDrafts });
    if (/\/api\/teams\/t1\/drafts\//.test(url)) {
      if (method === 'PUT') return json({ draft: JSON.parse(opts.body) });
      if (method === 'DELETE') return json({ success: true });
    }
    return json({}, 404);
  });
  return global.fetch;
}

/** withStore: false simulates recorder-store.js / recorder-sync.js failing to load. */
async function bootRecorder({ withStore = true } = {}) {
  const html = fs.readFileSync(path.join(ROOT, 'recorder.html'), 'utf8');
  document.body.innerHTML = html.match(/<body[^>]*>([\s\S]*)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, '');
  window.recorderAggregator = require('../../recorder-aggregator');
  window.recorderClock = require('../../recorder-clock');
  if (withStore) {
    window.recorderStore = require('../../recorder-store').createStore(window.localStorage);
    window.recorderSync = require('../../recorder-sync');
  } else {
    delete window.recorderStore;
    delete window.recorderSync;
  }
  window.confirm = () => true;
  window.scrollTo = () => {};
  // eslint-disable-next-line no-eval
  (0, eval)(fs.readFileSync(path.join(ROOT, 'recorder.js'), 'utf8'));
  document.dispatchEvent(new Event('DOMContentLoaded'));
  await tick(20);
}

module.exports = { PLAYERS, tick, stubFetch, bootRecorder };
