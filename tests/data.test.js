/**
 * @jest-environment jsdom
 */

const STORAGE_KEY = 'basketstat-data';

function loadDataModule() {
  // Reset window.basketStatData before each load
  delete window.basketStatData;
  // data.js attaches to window.basketStatData on execution
  require('../data.js');
  return window.basketStatData;
}

let api;

beforeEach(() => {
  localStorage.clear();
  jest.resetModules();
  api = loadDataModule();
});

// ---------------------------------------------------------------------------
// generateGameId
// ---------------------------------------------------------------------------
describe('generateGameId', () => {
  test('returns a string starting with "g_"', () => {
    const id = api.generateGameId();
    expect(typeof id).toBe('string');
    expect(id).toMatch(/^g_\d+_[a-z0-9]+$/);
  });

  test('produces unique IDs on successive calls', () => {
    const ids = new Set(Array.from({ length: 50 }, () => api.generateGameId()));
    expect(ids.size).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// loadData – ID repair
// ---------------------------------------------------------------------------
describe('loadData – game ID repair', () => {
  test('assigns string IDs to games with undefined id', () => {
    const raw = {
      players: {},
      games: [
        { date: '2025-01-01', opponent: 'Team A', performances: {} },
        { date: '2025-01-02', opponent: 'Team B', performances: {} },
      ],
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));

    const data = api.loadData();
    data.games.forEach((g) => {
      expect(typeof g.id).toBe('string');
      expect(g.id.length).toBeGreaterThan(0);
    });
    expect(data.games[0].id).not.toBe(data.games[1].id);
  });

  test('assigns string IDs to games with numeric id', () => {
    const raw = {
      players: {},
      games: [{ id: 42, date: '2025-03-01', opponent: 'X', performances: {} }],
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));

    const data = api.loadData();
    expect(typeof data.games[0].id).toBe('string');
    expect(data.games[0].id).not.toBe('42');
  });

  test('assigns string IDs to games with null id', () => {
    const raw = {
      players: {},
      games: [{ id: null, date: '2025-03-01', opponent: 'Y', performances: {} }],
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));

    const data = api.loadData();
    expect(typeof data.games[0].id).toBe('string');
    expect(data.games[0].id.length).toBeGreaterThan(0);
  });

  test('persists repaired IDs to localStorage', () => {
    const raw = {
      players: {},
      games: [{ date: '2025-03-01', opponent: 'Z', performances: {} }],
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));

    const first = api.loadData();
    const repairedId = first.games[0].id;

    // Second load should return the same repaired ID (not generate a new one)
    const second = api.loadData();
    expect(second.games[0].id).toBe(repairedId);
  });

  test('does not modify games that already have valid string IDs', () => {
    const raw = {
      players: {},
      games: [{ id: 'g_existing_abc', date: '2025-03-01', opponent: 'OK', performances: {} }],
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));

    const data = api.loadData();
    expect(data.games[0].id).toBe('g_existing_abc');
  });

  test('returns empty structure for empty localStorage', () => {
    const data = api.loadData();
    expect(data).toEqual({ players: {}, games: [] });
  });
});

// ---------------------------------------------------------------------------
// deleteGame – ID type coercion
// ---------------------------------------------------------------------------
describe('deleteGame', () => {
  function seedGames(games) {
    const raw = { players: {}, games };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
    // Reload so ID repair runs
    jest.resetModules();
    api = loadDataModule();
    return api.loadData();
  }

  test('deletes a game by its string ID', () => {
    const data = seedGames([
      { id: 'g_1', date: '2025-01-01', opponent: 'A', performances: {} },
      { id: 'g_2', date: '2025-01-02', opponent: 'B', performances: {} },
    ]);

    api.deleteGame('g_1');
    const after = api.loadData();
    expect(after.games).toHaveLength(1);
    expect(after.games[0].id).toBe('g_2');
  });

  test('deletes a game that originally had a numeric ID (repaired on load)', () => {
    // loadData repairs numeric IDs to strings, so the game is findable
    // by the repaired ID — this mimics the real flow where renderGames
    // reads the repaired ID into the onclick attribute.
    const raw = {
      players: {},
      games: [{ id: 99, date: '2025-01-01', opponent: 'Num', performances: {} }],
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));

    const data = api.loadData();
    const repairedId = data.games[0].id;
    expect(typeof repairedId).toBe('string');
    expect(repairedId).not.toBe('99');

    api.deleteGame(repairedId);
    const after = api.loadData();
    expect(after.games).toHaveLength(0);
  });

  test('no-op when gameId does not match any game', () => {
    seedGames([
      { id: 'g_1', date: '2025-01-01', opponent: 'A', performances: {} },
    ]);

    api.deleteGame('nonexistent');
    const after = api.loadData();
    expect(after.games).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// updateGame – ID type coercion
// ---------------------------------------------------------------------------
describe('updateGame', () => {
  function seedGame(game) {
    const raw = { players: {}, games: [game] };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
    jest.resetModules();
    api = loadDataModule();
  }

  test('updates a game found by string ID', () => {
    seedGame({ id: 'g_1', date: '2025-01-01', opponent: 'Old', homeAway: 'home', performances: {} });

    const updated = api.updateGame('g_1', { opponent: 'New' });
    expect(updated.opponent).toBe('New');

    const after = api.loadData();
    expect(after.games[0].opponent).toBe('New');
  });

  test('updates a game that originally had a numeric ID (repaired on load)', () => {
    const raw = {
      players: {},
      games: [{ id: 7, date: '2025-01-01', opponent: 'NumOld', homeAway: 'home', performances: {} }],
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));

    const data = api.loadData();
    const repairedId = data.games[0].id;
    expect(typeof repairedId).toBe('string');

    const updated = api.updateGame(repairedId, { opponent: 'NumNew' });
    expect(updated.opponent).toBe('NumNew');
  });

  test('throws when gameId is not found', () => {
    seedGame({ id: 'g_1', date: '2025-01-01', opponent: 'X', performances: {} });
    expect(() => api.updateGame('missing', { opponent: 'Y' })).toThrow('Game not found');
  });
});

// ---------------------------------------------------------------------------
// updatePlayerStats – ID type coercion
// ---------------------------------------------------------------------------
describe('updatePlayerStats', () => {
  test('finds game that originally had a numeric ID (repaired on load)', () => {
    const raw = {
      players: {},
      games: [{ id: 55, date: '2025-01-01', opponent: 'T', performances: { Alice: { pts: 10 } } }],
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));

    const data = api.loadData();
    const repairedId = data.games[0].id;
    expect(typeof repairedId).toBe('string');

    const game = api.updatePlayerStats(repairedId, 'Alice', { pts: 20 });
    expect(game.performances.Alice.pts).toBe(20);
  });

  test('throws when game not found', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ players: {}, games: [] }));
    expect(() => api.updatePlayerStats('ghost', 'Alice', {})).toThrow('Game not found');
  });
});

// ---------------------------------------------------------------------------
// addGame – always generates string IDs
// ---------------------------------------------------------------------------
describe('addGame', () => {
  test('new game receives a string ID starting with g_', () => {
    const game = api.addGame({
      date: '2025-06-01',
      opponent: 'Rival',
      league: 'League A',
      homeAway: 'away',
      performances: {},
      playersFound: {},
    });

    expect(typeof game.id).toBe('string');
    expect(game.id).toMatch(/^g_/);
  });
});

// ---------------------------------------------------------------------------
// cleanupData – does not break ID integrity
// ---------------------------------------------------------------------------
describe('cleanupData', () => {
  test('games retain valid IDs after cleanup', () => {
    const raw = {
      players: { Alice: { number: 5, active: true } },
      games: [{ id: 'g_1', date: '2025-01-01', opponent: 'C', performances: { Alice: { pts: 5 } } }],
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
    jest.resetModules();
    api = loadDataModule();

    api.cleanupData();
    const data = api.loadData();
    expect(typeof data.games[0].id).toBe('string');
    expect(data.games[0].id).toBe('g_1');
  });
});

// ---------------------------------------------------------------------------
// detectDelimiter
// ---------------------------------------------------------------------------
describe('detectDelimiter', () => {
  test('detects comma delimiter', () => {
    expect(api.detectDelimiter('player,fg,3pt,pts')).toBe(',');
  });

  test('detects semicolon delimiter', () => {
    expect(api.detectDelimiter('player;fg;3pt;pts')).toBe(';');
  });

  test('detects tab delimiter', () => {
    expect(api.detectDelimiter('player\tfg\t3pt\tpts')).toBe('\t');
  });

  test('picks semicolon when it produces more columns than comma', () => {
    expect(api.detectDelimiter('player; fg; fg%;3pt;3pt%; ft; ft%; pts')).toBe(';');
  });

  test('defaults to comma for single-column input', () => {
    expect(api.detectDelimiter('player')).toBe(',');
  });
});

// ---------------------------------------------------------------------------
// parseCsv – delimiter support
// ---------------------------------------------------------------------------
describe('parseCsv – semicolon-delimited files', () => {
  function makeFile(content) {
    return { text: () => Promise.resolve(content) };
  }

  test('parses semicolon-delimited CSV', async () => {
    const csv = 'player;pts;reb\n#5 Alice;20;8\n#10 Bob;15;5';
    const result = await api.parseCsv(makeFile(csv));

    expect(result.statHeaders).toEqual(['pts', 'reb']);
    expect(result.performances.Alice.pts).toBe(20);
    expect(result.performances.Bob.reb).toBe(5);
  });

  test('parses comma-delimited CSV', async () => {
    const csv = 'player,pts,reb\n#5 Alice,20,8';
    const result = await api.parseCsv(makeFile(csv));

    expect(result.statHeaders).toEqual(['pts', 'reb']);
    expect(result.performances.Alice.pts).toBe(20);
  });

  test('throws for CSV without player column', async () => {
    const csv = 'name;pts;reb\n#5 Alice;20;8';
    await expect(api.parseCsv(makeFile(csv))).rejects.toThrow("'player' column");
  });
});
