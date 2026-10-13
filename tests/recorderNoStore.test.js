/**
 * If recorder-store.js / recorder-sync.js fail to load (as when they were
 * missing from the Vercel bundle), the home list must still show the server's
 * unfinished games, and starting a game must still save it.
 */
const { tick, stubFetch, bootRecorder } = require('./helpers/recorderHarness');

const $ = (sel) => document.querySelector(sel);
const draftPuts = (fetchMock) => fetchMock.mock.calls
  .filter(([url, opts]) => /\/drafts\//.test(url) && opts && opts.method === 'PUT')
  .map(([, opts]) => JSON.parse(opts.body));

describe('recorder without the offline store', () => {
  let fetchMock;
  beforeAll(async () => {
    localStorage.clear();
    fetchMock = stubFetch({
      serverDrafts: [
        { id: 'live1', status: 'in_progress', events: [{ id: 'e1', type: '2pt_made' }], roster: [], meta: { opponent: 'Fyllingen', league: 'U15', date: '2026-10-12' } },
        { id: 'done1', status: 'completed', events: [], roster: [], meta: { opponent: 'Asker', league: 'U15', date: '2026-10-01' } }
      ]
    });
    await bootRecorder({ withStore: false });
    await tick(20);
  });

  test('lists unfinished server drafts on the home screen', () => {
    const list = $('#recDraftList').textContent;
    expect(list).toContain('Fyllingen');
    expect(list).toContain('1 events');
    expect(list).not.toContain('Asker');
    expect(list).not.toContain('No in-progress recordings');
  });

  test('starting a game saves it to the server before any event', async () => {
    $('#recTeamList .rec-tile').click();
    await tick(20);
    $('#recOpponent').value = 'Ready';
    $('#recToSquad').click();
    await tick();
    const tiles = Array.from(document.querySelectorAll('#recSquadList .rec-squad-tile')).slice(0, 5);
    tiles.forEach((t) => t.click());
    Array.from(document.querySelectorAll('#recSquadList .rec-squad-tile')).slice(0, 5).forEach((t) => t.click());
    $('#recStartGame').click();
    await tick(20);
    expect($('#screen-live').classList.contains('active')).toBe(true);
    const started = draftPuts(fetchMock).filter((d) => d.meta && d.meta.opponent === 'Ready' && d.status === 'in_progress');
    expect(started.length).toBeGreaterThan(0);
    expect(started[started.length - 1].events).toEqual([]);
  });
});
