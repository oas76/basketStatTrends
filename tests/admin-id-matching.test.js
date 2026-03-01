/**
 * @jest-environment jsdom
 *
 * Tests for the event-delegation ID-matching logic used in admin.js.
 * The gamesTable click handler reads gameId from tr[data-game-id] and
 * looks up games via  String(g.id) === String(gameId).
 */

// The exact lookup pattern used by admin.js event delegation handler
function findGame(games, gameId) {
  return games.find((g) => String(g.id) === String(gameId));
}

const GAMES = [
  { id: 'g_abc_123', opponent: 'StringID' },
  { id: 42, opponent: 'NumericID' },
  { id: undefined, opponent: 'UndefinedID' },
  { id: null, opponent: 'NullID' },
  { id: '', opponent: 'EmptyStringID' },
  { id: 0, opponent: 'ZeroID' },
];

describe('ID matching: String(g.id) === String(gameId)', () => {
  test('matches a normal string ID', () => {
    const game = findGame(GAMES, 'g_abc_123');
    expect(game).toBeDefined();
    expect(game.opponent).toBe('StringID');
  });

  test('matches a numeric ID when gameId comes from dataset (always a string)', () => {
    const game = findGame(GAMES, '42');
    expect(game).toBeDefined();
    expect(game.opponent).toBe('NumericID');
  });

  test('matches a numeric ID when gameId is also a number', () => {
    const game = findGame(GAMES, 42);
    expect(game).toBeDefined();
    expect(game.opponent).toBe('NumericID');
  });

  test('matches undefined ID via string "undefined"', () => {
    const game = findGame(GAMES, 'undefined');
    expect(game).toBeDefined();
    expect(game.opponent).toBe('UndefinedID');
  });

  test('matches null ID via string "null"', () => {
    const game = findGame(GAMES, 'null');
    expect(game).toBeDefined();
    expect(game.opponent).toBe('NullID');
  });

  test('matches zero ID via string "0"', () => {
    const game = findGame(GAMES, '0');
    expect(game).toBeDefined();
    expect(game.opponent).toBe('ZeroID');
  });

  test('returns undefined for unknown ID', () => {
    expect(findGame(GAMES, 'nonexistent')).toBeUndefined();
  });
});

describe('event delegation: data-game-id from dataset', () => {
  // The browser always returns dataset values as strings.
  // This tests that IDs survive the round-trip through HTML data attributes.
  function simulateDatasetRoundTrip(rawId) {
    const table = document.createElement('table');
    table.innerHTML = `<tbody><tr data-game-id="${String(rawId).replace(/"/g, '&quot;')}"></tr></tbody>`;
    return table.querySelector('tr').dataset.gameId;
  }

  test('string ID survives dataset round-trip', () => {
    expect(simulateDatasetRoundTrip('g_abc_123')).toBe('g_abc_123');
  });

  test('numeric ID becomes string via dataset', () => {
    expect(simulateDatasetRoundTrip(42)).toBe('42');
  });

  test('ID with special chars survives when escaped', () => {
    expect(simulateDatasetRoundTrip('id"with"quotes')).toBe('id"with"quotes');
  });
});

describe('delete flow simulation with event delegation', () => {
  let mockData;
  let errorSpy;

  beforeEach(() => {
    mockData = {
      games: [
        { id: 'g_str', date: '2025-01-01', opponent: 'A', homeAway: 'home' },
        { id: 77, date: '2025-01-02', opponent: 'B', homeAway: 'away' },
      ],
    };
    errorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  function simulateDelete(gameId) {
    const games = mockData.games;
    const game = games.find((g) => String(g.id) === String(gameId));

    if (!game) {
      console.error(`Game not found for id "${gameId}"`);
      return false;
    }
    mockData.games = games.filter((g) => String(g.id) !== String(gameId));
    return true;
  }

  test('deletes game with string ID', () => {
    expect(simulateDelete('g_str')).toBe(true);
    expect(mockData.games).toHaveLength(1);
    expect(mockData.games[0].opponent).toBe('B');
  });

  test('deletes game with numeric ID via string from dataset', () => {
    expect(simulateDelete('77')).toBe(true);
    expect(mockData.games).toHaveLength(1);
    expect(mockData.games[0].opponent).toBe('A');
  });

  test('logs error and returns false for missing ID', () => {
    expect(simulateDelete('ghost')).toBe(false);
    expect(mockData.games).toHaveLength(2);
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe('closest() delegation finds correct elements', () => {
  test('click on SVG inside button finds data-action button', () => {
    document.body.innerHTML = `
      <table><tbody id="t">
        <tr data-game-id="g_1">
          <td class="actions">
            <button class="btn-icon danger" data-action="delete" title="Delete">
              <svg><path id="target" d="M3 6h18"/></svg>
            </button>
          </td>
        </tr>
      </tbody></table>
    `;
    const path = document.getElementById('target');
    const btn = path.closest('[data-action]');
    const row = path.closest('tr[data-game-id]');

    expect(btn).not.toBeNull();
    expect(btn.dataset.action).toBe('delete');
    expect(row).not.toBeNull();
    expect(row.dataset.gameId).toBe('g_1');
  });

  test('click on button itself finds data-action', () => {
    document.body.innerHTML = `
      <table><tbody>
        <tr data-game-id="g_2">
          <td><button data-action="edit" id="btn">Edit</button></td>
        </tr>
      </tbody></table>
    `;
    const btn = document.getElementById('btn');
    expect(btn.closest('[data-action]').dataset.action).toBe('edit');
    expect(btn.closest('tr[data-game-id]').dataset.gameId).toBe('g_2');
  });

  test('click on td (not a button) does not match data-action', () => {
    document.body.innerHTML = `
      <table><tbody>
        <tr data-game-id="g_3">
          <td id="cell">Some text</td>
        </tr>
      </tbody></table>
    `;
    const cell = document.getElementById('cell');
    expect(cell.closest('[data-action]')).toBeNull();
  });
});
