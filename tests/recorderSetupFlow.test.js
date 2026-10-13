/**
 * End-to-end (jsdom) check of preparing a game in advance: a game saved on
 * "Next: Pick squad" must survive leaving the recorder before it is started,
 * keep its date and squad selection, and reopen on the squad screen.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PLAYERS = ['Ola', 'Kari', 'Jonas', 'Emil', 'Sara', 'Nora', 'Liam'];

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const $ = (sel) => document.querySelector(sel);
const storedDrafts = () => JSON.parse(localStorage.getItem('rec:drafts:t1') || '[]');
const squadTiles = () => Array.from(document.querySelectorAll('#recSquadList .rec-squad-tile'));
const tileFor = (name) => squadTiles().find((t) => t.textContent.includes(name));

function stubFetch() {
  const players = {};
  PLAYERS.forEach((n, i) => { players[n] = { number: i + 4, active: true }; });
  const json = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
  global.fetch = jest.fn((url, opts = {}) => {
    const method = opts.method || 'GET';
    if (url === '/api/auth/check') {
      return json({ authenticated: true, email: 'coach@example.com', teams: [{ id: 't1', name: 'Kjelsas' }] });
    }
    if (url === '/api/teams/t1/data') return json({ players, games: [], leagues: ['U15'], finishedLeagues: [] });
    if (url === '/api/teams/t1/drafts' && method === 'GET') return json({ drafts: [] });
    if (/\/api\/teams\/t1\/drafts\//.test(url)) {
      if (method === 'PUT') return json({ draft: JSON.parse(opts.body) });
      if (method === 'DELETE') return json({ success: true });
    }
    return json({}, 404);
  });
}

async function bootRecorder() {
  const html = fs.readFileSync(path.join(ROOT, 'recorder.html'), 'utf8');
  document.body.innerHTML = html.match(/<body[^>]*>([\s\S]*)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, '');
  window.recorderAggregator = require('../recorder-aggregator');
  window.recorderClock = require('../recorder-clock');
  window.recorderStore = require('../recorder-store').createStore(window.localStorage);
  window.recorderSync = require('../recorder-sync');
  window.confirm = () => true;
  window.scrollTo = () => {};
  // eslint-disable-next-line no-eval
  (0, eval)(fs.readFileSync(path.join(ROOT, 'recorder.js'), 'utf8'));
  document.dispatchEvent(new Event('DOMContentLoaded'));
  await tick(20);
}

async function prepareGame() {
  $('#recTeamList .rec-tile').click();
  await tick(20);
  $('#recDate').value = '2026-11-01';
  $('#recOpponent').value = 'Fyllingen';
  $('#recToSquad').click();
  await tick();
}

// Booted once: the recorder is a page-level singleton (listeners, timers), so
// each test instead returns Home, lets pending saves settle, and clears storage.
async function resetToHome() {
  for (let i = 0; i < 5 && !$('#screen-home').classList.contains('active'); i++) {
    $('#recBackBtn').click();
    await tick(20);
  }
  await tick(800);
  localStorage.clear();
}

describe('recorder: preparing a game in advance', () => {
  beforeAll(async () => {
    localStorage.clear();
    stubFetch();
    await bootRecorder();
  });
  beforeEach(resetToHome);

  test('a prepared game is saved, survives leaving, and reopens on the squad screen', async () => {
    await prepareGame();
    expect(storedDrafts()).toHaveLength(1);
    expect(storedDrafts()[0].status).toBe('setup');

    // Ola starter (two taps), Kari on the bench (one tap); autosave is debounced.
    tileFor('Ola').click();
    tileFor('Ola').click();
    tileFor('Kari').click();

    // Leave immediately: Back to the form (details kept), Back again to Home.
    $('#recBackBtn').click();
    expect($('#screen-setup').classList.contains('active')).toBe(true);
    expect($('#recOpponent').value).toBe('Fyllingen');
    $('#recBackBtn').click();
    await tick(20);

    const [draft] = storedDrafts();
    expect(draft.meta.date).toBe('2026-11-01');
    expect(draft.events).toEqual([]);
    const byName = Object.fromEntries(draft.roster.map((r) => [r.name, r]));
    expect(byName.Ola).toMatchObject({ included: true, starter: true });
    expect(byName.Kari).toMatchObject({ included: true, starter: false });

    const listText = $('#recDraftList').textContent;
    expect(listText).toContain('Not started');
    expect(listText).toContain('2 in squad');
    expect(listText).toContain('Set up');

    // Reopen: lands on the squad screen with the selection restored.
    $('#recDraftList .rec-tile-draft').click();
    await tick(20);
    expect($('#screen-squad').classList.contains('active')).toBe(true);
    expect(tileFor('Ola').classList.contains('starter')).toBe(true);
    expect(tileFor('Kari').classList.contains('in')).toBe(true);

    // Complete the starting five and start: same draft becomes the live game.
    ['Kari', 'Jonas', 'Emil', 'Sara'].forEach((n) => {
      if (!tileFor(n).classList.contains('in')) tileFor(n).click();
      tileFor(n).click();
    });
    $('#recStartGame').click();
    await tick();
    expect($('#screen-live').classList.contains('active')).toBe(true);
    const drafts = storedDrafts();
    expect(drafts).toHaveLength(1);
    expect(drafts[0].id).toBe(draft.id);
    expect(drafts[0].status).toBe('in_progress');
    expect(drafts[0].roster.map((r) => r.name).sort()).toEqual(['Emil', 'Jonas', 'Kari', 'Ola', 'Sara']);
  });

  test('editing details from the form keeps the same prepared game', async () => {
    await prepareGame();
    const id = storedDrafts()[0].id;
    $('#recBackBtn').click();
    $('#recOpponent').value = 'Ready';
    $('#recToSquad').click();
    await tick();
    const drafts = storedDrafts();
    expect(drafts).toHaveLength(1);
    expect(drafts[0].id).toBe(id);
    expect(drafts[0].meta.opponent).toBe('Ready');
  });

  test('discarding a prepared game from the squad screen removes it and goes Home', async () => {
    await prepareGame();
    tileFor('Ola').click(); // pending autosave must not resurrect the draft
    $('#recMenuBtn').click();
    const discard = Array.from(document.querySelectorAll('#recSheet button'))
      .find((b) => b.textContent === 'Discard this recording');
    expect(discard).toBeTruthy();
    discard.click();
    await tick(800);
    expect(storedDrafts()).toHaveLength(0);
    expect($('#screen-home').classList.contains('active')).toBe(true);
  });
});
