/**
 * Data Validation Script
 * Reads CSV files from the csv/ folder and reports player game counts
 * Run with: node validate-data.js
 */

const fs = require('fs');
const path = require('path');

const csvDir = path.join(__dirname, 'csv');

// Clean CSV value (remove quotes and trim)
const cleanValue = (val) => {
  let cleaned = val.trim();
  cleaned = cleaned.replace(/^"(.*)"$/, '$1');
  cleaned = cleaned.replace(/^'(.*)'$/, '$1');
  return cleaned.trim();
};

// Extract player name from "#XX Name" format
const extractPlayerName = (playerStr) => {
  const match = playerStr.match(/^#(\d+)\s+(.+)$/);
  return match ? { number: parseInt(match[1]), name: match[2].trim() } : null;
};

// Parse stat value
const parseStatValue = (val) => {
  const trimmed = cleanValue(val);
  if (trimmed === '-' || trimmed === '') return null;
  if (/^\d+-\d+$/.test(trimmed)) {
    const [made, attempted] = trimmed.split('-').map(Number);
    return { made, attempted };
  }
  if (trimmed.endsWith('%')) {
    const num = parseInt(trimmed.replace('%', ''), 10);
    return isNaN(num) ? null : num;
  }
  const num = Number(trimmed);
  return isNaN(num) ? trimmed : num;
};

// Check if player has valid stats (actually played)
const hasValidStats = (stats) => {
  // Check minutes
  const minKey = Object.keys(stats).find(k => k.toLowerCase() === 'min');
  if (minKey) {
    const mins = stats[minKey];
    if (mins === null || mins === 0) return false;
  }
  
  // Check if any non-null, non-zero values
  return Object.values(stats).some(v => {
    if (v === null) return false;
    if (typeof v === 'object' && 'made' in v) {
      return v.made > 0 || v.attempted > 0;
    }
    return v !== 0;
  });
};

// Parse a CSV file
const parseCsvFile = (filePath) => {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.trim().split(/\r?\n/);
  const headers = lines[0].split(',').map(cleanValue);
  
  const playerIndex = headers.findIndex(h => h.toLowerCase() === 'player');
  if (playerIndex === -1) {
    console.error(`  No 'player' column found in ${path.basename(filePath)}`);
    return { players: [], filename: path.basename(filePath) };
  }
  
  const statHeaders = headers.filter((_, i) => i !== playerIndex);
  const players = [];
  
  lines.slice(1).forEach(line => {
    const cols = line.split(',').map(cleanValue);
    if (cols.length !== headers.length) return;
    
    const playerCell = cols[playerIndex];
    if (!playerCell.startsWith('#')) return; // Skip team totals
    
    const playerInfo = extractPlayerName(playerCell);
    if (!playerInfo) return;
    
    const stats = {};
    statHeaders.forEach(header => {
      stats[header] = parseStatValue(cols[headers.indexOf(header)]);
    });
    
    const played = hasValidStats(stats);
    players.push({
      ...playerInfo,
      played,
      stats
    });
  });
  
  return { players, filename: path.basename(filePath) };
};

// Main validation
console.log('\n========================================');
console.log('  BASKETSTAT DATA VALIDATION REPORT');
console.log('========================================\n');

// Read all CSV files
const csvFiles = fs.readdirSync(csvDir).filter(f => f.endsWith('.csv'));

if (csvFiles.length === 0) {
  console.log('No CSV files found in csv/ folder\n');
  process.exit(0);
}

console.log(`Found ${csvFiles.length} CSV file(s):\n`);

const playerGameCounts = {};
const allGames = [];

csvFiles.forEach(file => {
  const filePath = path.join(csvDir, file);
  const { players, filename } = parseCsvFile(filePath);
  
  const playedPlayers = players.filter(p => p.played);
  const notPlayedPlayers = players.filter(p => !p.played);
  
  console.log(`📄 ${filename}`);
  console.log(`   Players who PLAYED: ${playedPlayers.length}`);
  playedPlayers.forEach(p => {
    console.log(`     ✓ #${p.number} ${p.name}`);
    playerGameCounts[p.name] = (playerGameCounts[p.name] || 0) + 1;
  });
  
  if (notPlayedPlayers.length > 0) {
    console.log(`   Players who DID NOT PLAY (excluded): ${notPlayedPlayers.length}`);
    notPlayedPlayers.forEach(p => {
      console.log(`     ✗ #${p.number} ${p.name} (0 min / no stats)`);
    });
  }
  console.log('');
  
  allGames.push({ filename, playedPlayers, notPlayedPlayers });
});

// Summary
console.log('========================================');
console.log('  PLAYER GAME COUNTS SUMMARY');
console.log('========================================\n');

const sortedPlayers = Object.entries(playerGameCounts)
  .sort(([,a], [,b]) => b - a);

sortedPlayers.forEach(([name, count]) => {
  console.log(`  ${name}: ${count} game(s)`);
});

console.log(`\n  Total: ${sortedPlayers.length} unique players`);
console.log(`  Total games: ${csvFiles.length}\n`);
