const STORAGE_KEY = "basketstat-data";

/**
 * Data Structure:
 * {
 *   players: { [name]: { number, active } },
 *   games: [{ id, date, opponent, league, homeAway, performances: { [playerName]: stats } }]
 * }
 */

const loadData = () => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return { players: {}, games: [] };
  }
  try {
    const data = JSON.parse(raw);
    // Migration: convert old format to new format
    if (data.games && data.games.length > 0 && data.games[0].entries) {
      return migrateOldFormat(data);
    }
    return { players: data.players || {}, games: data.games || [] };
  } catch (error) {
    console.warn("Failed to parse stored data", error);
    return { players: {}, games: [] };
  }
};

/**
 * Migrate from old format (entries array) to new format (performances object)
 */
const migrateOldFormat = (oldData) => {
  const players = {};
  const games = oldData.games.map((game, index) => {
    const performances = {};
    game.entries.forEach((entry) => {
      const name = entry.name || entry.player;
      performances[name] = entry.stats;
      // Extract player number if available from old data
      if (!players[name]) {
        players[name] = { number: null, active: true };
      }
    });
    return {
      id: game.id || `g_${Date.now()}_${index}`,
      date: game.date,
      opponent: game.opponent,
      league: game.league || "",
      homeAway: game.homeAway || "home",
      performances,
    };
  });
  return { players, games };
};

const saveData = (data) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
};

/**
 * Generate a unique game ID
 */
const generateGameId = () => `g_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

/**
 * Clean a CSV cell value by removing surrounding quotes and trimming whitespace
 */
const cleanCsvValue = (value) => {
  let cleaned = value.trim();
  cleaned = cleaned.replace(/^"(.*)"$/, '$1');
  cleaned = cleaned.replace(/^'(.*)'$/, '$1');
  return cleaned.trim();
};

/**
 * Extract player name and number from "#XX Name" format
 * e.g., "#22 Christoffer" -> { name: "Christoffer", number: 22 }
 */
const extractPlayerInfo = (playerString) => {
  const trimmed = cleanCsvValue(playerString);
  const match = trimmed.match(/^#(\d+)\s+(.+)$/);
  if (match) {
    return { number: parseInt(match[1], 10), name: match[2].trim() };
  }
  return { number: null, name: trimmed };
};

/**
 * Parse a stat value that may be in various formats
 */
const parseStatValue = (value) => {
  const trimmed = cleanCsvValue(value);
  
  if (trimmed === "-" || trimmed === "") {
    return null;
  }
  
  if (/^\d+-\d+$/.test(trimmed)) {
    const [made, attempted] = trimmed.split("-").map(Number);
    return { made, attempted };
  }
  
  if (trimmed.endsWith("%")) {
    const numValue = parseInt(trimmed.replace("%", ""), 10);
    return Number.isNaN(numValue) ? null : numValue;
  }
  
  const numValue = Number(trimmed);
  return Number.isNaN(numValue) ? trimmed : numValue;
};

/**
 * Parse CSV file and return game data
 */
const parseCsv = async (file) => {
  const text = await file.text();
  const [headerLine, ...rows] = text.trim().split(/\r?\n/);
  const headers = headerLine.split(",").map(cleanCsvValue);
  
  console.log("CSV Headers (cleaned):", headers);
  
  const playerIndex = headers.findIndex((header) => header.toLowerCase() === "player");

  if (playerIndex === -1) {
    throw new Error(`CSV must include a 'player' column. Found: ${headers.join(", ")}`);
  }

  const statHeaders = headers.filter((_, index) => index !== playerIndex);
  const playersFound = {};
  const performances = {};

  rows
    .map((row) => row.split(",").map(cleanCsvValue))
    .filter((row) => row.length === headers.length)
    .filter((columns) => columns[playerIndex].startsWith("#"))
    .forEach((columns) => {
      const { name, number } = extractPlayerInfo(columns[playerIndex]);
      
      // Store player info
      playersFound[name] = { number, active: true };
      
      // Build stats object
      const stats = {};
      statHeaders.forEach((header) => {
        const value = columns[headers.indexOf(header)];
        stats[header] = parseStatValue(value);
      });
      
      performances[name] = stats;
    });

  return { statHeaders, performances, playersFound };
};

/**
 * Add a new game to the data store
 */
const addGame = (gameData) => {
  const data = loadData();
  
  // Update player registry
  Object.entries(gameData.playersFound || {}).forEach(([name, info]) => {
    if (!data.players[name]) {
      data.players[name] = info;
    } else if (info.number) {
      // Update number if we have a new one
      data.players[name].number = info.number;
    }
  });
  
  // Add game
  const game = {
    id: generateGameId(),
    date: gameData.date,
    opponent: gameData.opponent,
    league: gameData.league,
    homeAway: gameData.homeAway,
    performances: gameData.performances,
  };
  
  data.games.push(game);
  data.games.sort((a, b) => new Date(a.date) - new Date(b.date));
  
  saveData(data);
  return game;
};

/**
 * Update an existing game
 */
const updateGame = (gameId, updates) => {
  const data = loadData();
  const gameIndex = data.games.findIndex((g) => g.id === gameId);
  
  if (gameIndex === -1) {
    throw new Error("Game not found");
  }
  
  data.games[gameIndex] = { ...data.games[gameIndex], ...updates };
  data.games.sort((a, b) => new Date(a.date) - new Date(b.date));
  
  saveData(data);
  return data.games[gameIndex];
};

/**
 * Delete a game
 */
const deleteGame = (gameId) => {
  const data = loadData();
  data.games = data.games.filter((g) => g.id !== gameId);
  saveData(data);
};

/**
 * Update a player's stats for a specific game
 */
const updatePlayerStats = (gameId, playerName, stats) => {
  const data = loadData();
  const game = data.games.find((g) => g.id === gameId);
  
  if (!game) {
    throw new Error("Game not found");
  }
  
  game.performances[playerName] = stats;
  saveData(data);
  return game;
};

/**
 * Update player registry info
 */
const updatePlayer = (playerName, updates) => {
  const data = loadData();
  if (!data.players[playerName]) {
    data.players[playerName] = { number: null, active: true };
  }
  data.players[playerName] = { ...data.players[playerName], ...updates };
  saveData(data);
};

/**
 * Get all unique stat keys across all games
 */
const getAllStatKeys = () => {
  const data = loadData();
  const keys = new Set();
  data.games.forEach((game) => {
    Object.values(game.performances).forEach((stats) => {
      Object.keys(stats).forEach((key) => keys.add(key));
    });
  });
  return Array.from(keys);
};

const unique = (values) => Array.from(new Set(values));

// Export API
window.basketStatData = {
  loadData,
  saveData,
  parseCsv,
  addGame,
  updateGame,
  deleteGame,
  updatePlayerStats,
  updatePlayer,
  getAllStatKeys,
  unique,
  generateGameId,
};
