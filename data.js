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
 * Check if a player has any meaningful stats (not all null/zero)
 * Returns false if player should be excluded from the game
 */
const hasValidStats = (stats) => {
  // Check if player has any actual game stats (pts, fg attempts, rebounds, etc.)
  // This is more reliable than just checking minutes, as some CSVs have min=0 for players who played
  
  let hasMinutes = false;
  let hasPoints = false;
  let hasFgAttempts = false;
  let hasOtherStats = false;
  
  for (const [key, value] of Object.entries(stats)) {
    if (value === null) continue;
    
    const keyLower = key.toLowerCase();
    
    // Check minutes
    if (keyLower === 'min' && value > 0) {
      hasMinutes = true;
    }
    
    // Check points
    if (keyLower === 'pts' && value > 0) {
      hasPoints = true;
    }
    
    // Check field goal attempts (made-attempted format)
    if (keyLower === 'fg' && typeof value === 'object' && 'attempted' in value) {
      if (value.attempted > 0) {
        hasFgAttempts = true;
      }
    }
    
    // Check other counting stats (rebounds, assists, steals, blocks, fouls, turnovers)
    if (['oreb', 'dreb', 'asst', 'stl', 'blk', 'foul', 'to'].includes(keyLower)) {
      if (typeof value === 'number' && value > 0) {
        hasOtherStats = true;
      }
    }
    
    // Check +/- (if non-zero, player was on court)
    if (keyLower === '+/-' && typeof value === 'number' && value !== 0) {
      hasOtherStats = true;
    }
  }
  
  // Player played if they have: minutes > 0, OR points > 0, OR fg attempts > 0, OR other stats
  return hasMinutes || hasPoints || hasFgAttempts || hasOtherStats;
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
      
      // Build stats object
      const stats = {};
      statHeaders.forEach((header) => {
        const value = columns[headers.indexOf(header)];
        stats[header] = parseStatValue(value);
      });
      
      // Only include players with valid stats (played in the game)
      if (hasValidStats(stats)) {
        playersFound[name] = { number, active: true };
        performances[name] = stats;
      }
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
  
  // Add computed stats to each player's performance
  const performancesWithComputed = {};
  Object.entries(gameData.performances || {}).forEach(([name, stats]) => {
    performancesWithComputed[name] = {
      ...stats,
      'a/to': computeAstToRatio(stats),
      'atk': computeAttackEnergy(stats),
      'def': computeDefenceDomination(stats),
      'shoot': computeShootingStar(stats)
    };
  });
  
  // Add game
  const game = {
    id: generateGameId(),
    date: gameData.date,
    opponent: gameData.opponent,
    league: gameData.league,
    homeAway: gameData.homeAway,
    performances: performancesWithComputed,
    csvFile: gameData.csvFile || null, // Reference to source CSV file
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
    Object.values(game.performances || {}).forEach((stats) => {
      Object.keys(stats).forEach((key) => keys.add(key));
    });
  });
  return Array.from(keys);
};

/**
 * Clean up data by removing players with no valid stats from all games
 * Call this to fix existing data that has players who didn't actually play
 */
const cleanupData = () => {
  const data = loadData();
  let removedCount = 0;
  
  data.games.forEach((game) => {
    if (!game.performances) return;
    
    const playersToRemove = [];
    Object.entries(game.performances).forEach(([playerName, stats]) => {
      if (!hasValidStats(stats)) {
        playersToRemove.push(playerName);
      }
    });
    
    playersToRemove.forEach((name) => {
      delete game.performances[name];
      removedCount++;
    });
  });
  
  // Also clean up player registry - remove players who have no games
  const playersWithGames = new Set();
  data.games.forEach((game) => {
    Object.keys(game.performances || {}).forEach((name) => {
      playersWithGames.add(name);
    });
  });
  
  Object.keys(data.players || {}).forEach((name) => {
    if (!playersWithGames.has(name)) {
      delete data.players[name];
    }
  });
  
  saveData(data);
  return removedCount;
};

/**
 * Count games played for each player (only counting games with valid stats)
 */
const getPlayerGameCounts = () => {
  const data = loadData();
  const counts = {};
  
  data.games.forEach((game) => {
    Object.entries(game.performances || {}).forEach(([name, stats]) => {
      if (hasValidStats(stats)) {
        counts[name] = (counts[name] || 0) + 1;
      }
    });
  });
  
  return counts;
};

/**
 * Compute Assist to Turnover Ratio (A/TO)
 * Higher is better - measures playmaking efficiency
 * Formula: assists / turnovers
 * When TO = 0: use assists directly (equivalent to assists per 1 theoretical TO)
 * This keeps values within benchmark scale (p50=1.0, p90=2.5)
 */
const computeAstToRatio = (stats) => {
  const assists = typeof stats.asst === 'number' ? stats.asst : 0;
  const turnovers = typeof stats.to === 'number' ? stats.to : 0;
  
  // No assists and no turnovers = no playmaking activity
  if (assists === 0 && turnovers === 0) {
    return null;
  }
  
  // No turnovers: use assists as the ratio (assists per 1 theoretical TO)
  // This rewards good ball security while keeping values reasonable
  if (turnovers === 0) {
    return Math.round(assists * 100) / 100;
  }
  
  return Math.round((assists / turnovers) * 100) / 100; // Round to 2 decimal places
};

/**
 * Compute Attack Energy (ATK)
 * Higher is better - measures offensive involvement/aggression per minute
 * Formula: (FG Attempts + FT Attempts + Assists + Offensive Rebounds) / Minutes
 * This shows offensive intensity normalized by playing time
 */
const computeAttackEnergy = (stats) => {
  // Get minutes played
  const minutes = typeof stats.min === 'number' ? stats.min : 0;
  if (minutes <= 0) return null; // Need minutes to calculate rate
  
  // Get FG attempts (from made-attempted format)
  let fga = 0;
  if (stats.fg && typeof stats.fg === 'object' && 'attempted' in stats.fg) {
    fga = stats.fg.attempted || 0;
  }
  
  // Get FT attempts (from made-attempted format)
  let fta = 0;
  if (stats.ft && typeof stats.ft === 'object' && 'attempted' in stats.ft) {
    fta = stats.ft.attempted || 0;
  }
  
  // Get assists
  const assists = typeof stats.asst === 'number' ? stats.asst : 0;
  
  // Get offensive rebounds
  const oreb = typeof stats.oreb === 'number' ? stats.oreb : 0;
  
  // If no offensive activity at all, return null
  const rawTotal = fga + fta + assists + oreb;
  if (rawTotal === 0) {
    return null;
  }
  
  // Return per-minute rate, rounded to 2 decimals
  return Math.round((rawTotal / minutes) * 100) / 100;
};

/**
 * Get foul grade multiplier for Defence Domination calculation
 * Rewards optimal foul count (3) and penalizes passive or excessive fouling
 */
const getFoulMultiplier = (fouls) => {
  if (fouls === 3) return 1.25;  // Excellent - optimal aggression bonus
  if (fouls === 2) return 1.0;   // Good - full credit
  if (fouls === 4) return 0.85;  // Average - slight penalty for foul trouble
  return 0.7;                     // Below (0, 1, 5) - penalty for passive or fouling out
};

/**
 * Compute Defence Domination (DEF)
 * Higher is better - measures defensive impact with foul efficiency per minute
 * Formula: ((Blocks + Steals + Defensive Rebounds) * Foul Multiplier) / Minutes
 */
const computeDefenceDomination = (stats) => {
  // Get minutes played
  const minutes = typeof stats.min === 'number' ? stats.min : 0;
  if (minutes <= 0) return null; // Need minutes to calculate rate
  
  const blocks = typeof stats.blk === 'number' ? stats.blk : 0;
  const steals = typeof stats.stl === 'number' ? stats.stl : 0;
  const dreb = typeof stats.dreb === 'number' ? stats.dreb : 0;
  const fouls = typeof stats.foul === 'number' ? stats.foul : 0;
  
  const rawDefence = blocks + steals + dreb;
  
  // If no defensive activity, return null
  if (rawDefence === 0) {
    return null;
  }
  
  const multiplier = getFoulMultiplier(fouls);
  const adjustedDefence = rawDefence * multiplier;
  
  // Return per-minute rate, rounded to 2 decimals
  return Math.round((adjustedDefence / minutes) * 100) / 100;
};

/**
 * Compute Shooting Star (SHOOT)
 * Higher is better - average of FG%, 3PT%, and FT%
 * Measures overall shooting efficiency across all shot types
 */
const computeShootingStar = (stats) => {
  const percentages = [];
  
  // Get FG% (already parsed as number)
  if (typeof stats['fg%'] === 'number' && stats['fg%'] > 0) {
    percentages.push(stats['fg%']);
  }
  
  // Get 3PT% (already parsed as number)
  if (typeof stats['3pt%'] === 'number' && stats['3pt%'] > 0) {
    percentages.push(stats['3pt%']);
  }
  
  // Get FT% (already parsed as number)
  if (typeof stats['ft%'] === 'number' && stats['ft%'] > 0) {
    percentages.push(stats['ft%']);
  }
  
  // Need at least one valid percentage
  if (percentages.length === 0) {
    return null;
  }
  
  // Calculate average of available percentages
  const avg = percentages.reduce((sum, p) => sum + p, 0) / percentages.length;
  return Math.round(avg * 10) / 10; // Round to 1 decimal
};

/**
 * Add computed stats (like A/TO ratio, Attack Energy, Defence Domination, Shooting Star) to a player's stats object
 * Returns a new object with the computed stats added
 */
const addComputedStats = (stats) => {
  return {
    ...stats,
    'a/to': computeAstToRatio(stats),
    'atk': computeAttackEnergy(stats),
    'def': computeDefenceDomination(stats),
    'shoot': computeShootingStar(stats)
  };
};

/**
 * Process all games and add computed stats to each player's performance
 * This updates the stored data with the computed stats
 */
const addComputedStatsToAllGames = () => {
  const data = loadData();
  let updated = false;
  
  data.games.forEach((game) => {
    Object.entries(game.performances || {}).forEach(([name, stats]) => {
      // Compute A/TO ratio
      const atoRatio = computeAstToRatio(stats);
      if (stats['a/to'] !== atoRatio) {
        stats['a/to'] = atoRatio;
        updated = true;
      }
      
      // Compute Attack Energy
      const atkEnergy = computeAttackEnergy(stats);
      if (stats['atk'] !== atkEnergy) {
        stats['atk'] = atkEnergy;
        updated = true;
      }
      
      // Compute Defence Domination
      const defDom = computeDefenceDomination(stats);
      if (stats['def'] !== defDom) {
        stats['def'] = defDom;
        updated = true;
      }
      
      // Compute Shooting Star
      const shootStar = computeShootingStar(stats);
      if (stats['shoot'] !== shootStar) {
        stats['shoot'] = shootStar;
        updated = true;
      }
    });
  });
  
  if (updated) {
    saveData(data);
  }
  
  return updated;
};

const unique = (values) => Array.from(new Set(values));

/**
 * Force recomputation of all computed stats (for debugging/migration)
 */
const forceRecomputeAllStats = () => {
  const data = loadData();
  let count = 0;
  
  data.games.forEach((game) => {
    Object.entries(game.performances || {}).forEach(([name, stats]) => {
      stats['a/to'] = computeAstToRatio(stats);
      stats['atk'] = computeAttackEnergy(stats);
      stats['def'] = computeDefenceDomination(stats);
      stats['shoot'] = computeShootingStar(stats);
      count++;
    });
  });
  
  saveData(data);
  console.log(`✅ Recomputed stats for ${count} player-game records`);
  return count;
};

// Note: Computed stats are now added in app.js after data is fully loaded
// This ensures cloud data is processed correctly

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
  cleanupData,
  getPlayerGameCounts,
  hasValidStats,
  unique,
  generateGameId,
  computeAstToRatio,
  computeAttackEnergy,
  computeDefenceDomination,
  computeShootingStar,
  getFoulMultiplier,
  addComputedStats,
  addComputedStatsToAllGames,
  forceRecomputeAllStats,
};
