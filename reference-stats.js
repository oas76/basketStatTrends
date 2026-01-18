/**
 * Reference Statistics Database for Junior Basketball Players (Ages 14-16)
 * 
 * This file contains benchmark statistics for comparing player performance.
 * Values are based on typical club-level junior basketball (U14-U16).
 * 
 * You can edit these values to match your league's standards.
 * 
 * Structure:
 * - Each stat has percentile thresholds (p25, p50, p75, p90)
 * - p25 = 25th percentile (below average)
 * - p50 = 50th percentile (average/median)
 * - p75 = 75th percentile (above average)
 * - p90 = 90th percentile (excellent)
 * 
 * Color mapping:
 * - Below p25: Red (poor)
 * - p25-p50: Orange (below average)
 * - p50-p75: Yellow (average)
 * - p75-p90: Light green (good)
 * - Above p90: Green (excellent)
 */

const referenceStats = {
  // Meta information
  meta: {
    ageGroup: "U14-U16",
    level: "Club/Regional",
    gameLength: "32 minutes (4x8)",
    lastUpdated: "2026-01-18",
    notes: "Benchmarks for Norwegian junior basketball (1. divisjon junior level)"
  },

  // Per-game statistics benchmarks
  stats: {
    // Points per game
    pts: {
      name: "Points",
      unit: "per game",
      p25: 4,
      p50: 8,
      p75: 14,
      p90: 20,
      description: "Total points scored"
    },

    // Field Goals (made per game)
    fg: {
      name: "Field Goals Made",
      unit: "made per game",
      p25: 1,
      p50: 3,
      p75: 5,
      p90: 8,
      description: "Successful 2-point and 3-point shots",
      isMadeAttempted: true
    },

    // Field Goal Percentage
    "fg%": {
      name: "Field Goal %",
      unit: "percentage",
      p25: 30,
      p50: 38,
      p75: 45,
      p90: 52,
      description: "Shooting accuracy from the field"
    },

    // 3-Point Field Goals (made per game)
    "3pt": {
      name: "3-Point FG Made",
      unit: "made per game",
      p25: 0,
      p50: 1,
      p75: 2,
      p90: 3,
      description: "Successful 3-point shots",
      isMadeAttempted: true
    },

    // 3-Point Percentage
    "3pt%": {
      name: "3-Point %",
      unit: "percentage",
      p25: 20,
      p50: 28,
      p75: 35,
      p90: 42,
      description: "3-point shooting accuracy"
    },

    // Free Throws (made per game)
    ft: {
      name: "Free Throws Made",
      unit: "made per game",
      p25: 0,
      p50: 1,
      p75: 3,
      p90: 5,
      description: "Successful free throws",
      isMadeAttempted: true
    },

    // Free Throw Percentage
    "ft%": {
      name: "Free Throw %",
      unit: "percentage",
      p25: 50,
      p50: 62,
      p75: 72,
      p90: 82,
      description: "Free throw accuracy"
    },

    // Offensive Rebounds
    oreb: {
      name: "Offensive Rebounds",
      unit: "per game",
      p25: 0,
      p50: 1,
      p75: 2,
      p90: 4,
      description: "Rebounds on offensive end"
    },

    // Defensive Rebounds
    dreb: {
      name: "Defensive Rebounds",
      unit: "per game",
      p25: 1,
      p50: 2,
      p75: 4,
      p90: 6,
      description: "Rebounds on defensive end"
    },

    // Total Rebounds (if tracked separately)
    reb: {
      name: "Total Rebounds",
      unit: "per game",
      p25: 2,
      p50: 4,
      p75: 6,
      p90: 9,
      description: "Total rebounds (offensive + defensive)"
    },

    // Assists
    asst: {
      name: "Assists",
      unit: "per game",
      p25: 0,
      p50: 1,
      p75: 3,
      p90: 5,
      description: "Passes leading directly to scores"
    },

    // Steals
    stl: {
      name: "Steals",
      unit: "per game",
      p25: 0,
      p50: 1,
      p75: 2,
      p90: 4,
      description: "Defensive takeaways"
    },

    // Blocks
    blk: {
      name: "Blocks",
      unit: "per game",
      p25: 0,
      p50: 0,
      p75: 1,
      p90: 2,
      description: "Blocked shots"
    },

    // Turnovers (lower is better - inverted scale)
    to: {
      name: "Turnovers",
      unit: "per game",
      p25: 4,  // 25th percentile = high turnovers (bad)
      p50: 3,
      p75: 2,
      p90: 1,  // 90th percentile = low turnovers (good)
      description: "Ball losses",
      invertedScale: true  // Lower is better
    },

    // Personal Fouls (lower is better - inverted scale)
    foul: {
      name: "Personal Fouls",
      unit: "per game",
      p25: 4,
      p50: 3,
      p75: 2,
      p90: 1,
      description: "Personal fouls committed",
      invertedScale: true  // Lower is better
    },

    // Assist to Turnover Ratio (higher is better)
    "a/to": {
      name: "Assist/Turnover",
      unit: "ratio",
      p25: 0.5,
      p50: 1.0,
      p75: 1.5,
      p90: 2.5,
      description: "Assists per turnover (playmaking efficiency)",
      invertedScale: false  // Higher is better
    }
  }
};

/**
 * Get the performance level for a stat value
 * Returns: 'poor', 'below', 'average', 'good', or 'excellent'
 */
const getPerformanceLevel = (statKey, value) => {
  const stat = referenceStats.stats[statKey.toLowerCase()];
  if (!stat) return 'average'; // Unknown stat, default to average
  
  if (value === null || value === undefined) return 'average';
  
  // Handle made-attempted objects (use 'made' value)
  const numValue = typeof value === 'object' && 'made' in value ? value.made : Number(value);
  if (isNaN(numValue)) return 'average';
  
  // For inverted scales (turnovers, fouls), lower is better
  if (stat.invertedScale) {
    if (numValue <= stat.p90) return 'excellent';
    if (numValue <= stat.p75) return 'good';
    if (numValue <= stat.p50) return 'average';
    if (numValue <= stat.p25) return 'below';
    return 'poor';
  }
  
  // Normal scale: higher is better
  if (numValue >= stat.p90) return 'excellent';
  if (numValue >= stat.p75) return 'good';
  if (numValue >= stat.p50) return 'average';
  if (numValue >= stat.p25) return 'below';
  return 'poor';
};

/**
 * Get reference thresholds for a stat
 */
const getStatReference = (statKey) => {
  return referenceStats.stats[statKey.toLowerCase()] || null;
};

/**
 * Get all reference stats
 */
const getAllReferenceStats = () => {
  return referenceStats;
};

/**
 * Update a reference stat (for editing)
 */
const updateReferenceStat = (statKey, updates) => {
  const key = statKey.toLowerCase();
  if (referenceStats.stats[key]) {
    Object.assign(referenceStats.stats[key], updates);
    referenceStats.meta.lastUpdated = new Date().toISOString().split('T')[0];
    return true;
  }
  return false;
};

/**
 * Add a new reference stat
 */
const addReferenceStat = (statKey, statData) => {
  const key = statKey.toLowerCase();
  if (!referenceStats.stats[key]) {
    referenceStats.stats[key] = {
      name: statData.name || statKey,
      unit: statData.unit || "per game",
      p25: statData.p25 || 0,
      p50: statData.p50 || 0,
      p75: statData.p75 || 0,
      p90: statData.p90 || 0,
      description: statData.description || "",
      invertedScale: statData.invertedScale || false
    };
    referenceStats.meta.lastUpdated = new Date().toISOString().split('T')[0];
    return true;
  }
  return false;
};

/**
 * Load saved reference stats from localStorage
 * Merges saved values with defaults (saved values take precedence)
 */
const loadSavedStats = () => {
  try {
    const saved = localStorage.getItem('referenceStats');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.stats) {
        // Merge saved stats into defaults
        for (const [key, savedStat] of Object.entries(parsed.stats)) {
          if (referenceStats.stats[key]) {
            // Update existing stat
            Object.assign(referenceStats.stats[key], savedStat);
          } else {
            // Add new custom stat
            referenceStats.stats[key] = savedStat;
          }
        }
      }
      if (parsed.meta?.lastUpdated) {
        referenceStats.meta.lastUpdated = parsed.meta.lastUpdated;
      }
    }
  } catch (e) {
    console.warn('Failed to load saved reference stats:', e);
  }
};

// Load saved stats on module initialization
loadSavedStats();

// Export for use in other modules
window.referenceStats = {
  getPerformanceLevel,
  getStatReference,
  getAllReferenceStats,
  updateReferenceStat,
  addReferenceStat,
  data: referenceStats
};
