const playerSelect = document.getElementById("playerSelect");
const statSelect = document.getElementById("statSelect");
const windowSizeSelect = document.getElementById("windowSize");
const leagueFilterSelect = document.getElementById("leagueFilter");
const scorecardGrid = document.getElementById("scorecardGrid");
const trendingIndexValue = document.getElementById("trendingIndexValue");
const trendingIndexDetail = document.getElementById("trendingIndexDetail");
const trendStatIndicator = document.getElementById("trendStatIndicator");
const aggregateStats = document.getElementById("aggregateStats");
const chart = document.getElementById("chart");
const gameTable = document.getElementById("gameTable");
const statHeader = document.getElementById("statHeader");

// Player profile elements
const profileNumber = document.getElementById("profileNumber");
const profilePosition = document.getElementById("profilePosition");
const profileHeight = document.getElementById("profileHeight");
const profileAge = document.getElementById("profileAge");
const profileEditBtn = document.getElementById("profileEditBtn");
const profileModal = document.getElementById("profileModal");
const editHeight = document.getElementById("editHeight");
const editPosition = document.getElementById("editPosition");
const editBirthdate = document.getElementById("editBirthdate");
const saveProfileBtn = document.getElementById("saveProfileBtn");
const cancelProfileBtn = document.getElementById("cancelProfileBtn");

// Aggregate stat elements
const AGGREGATE_STATS = ['atk', 'def', 'shoot'];

const formatDate = (value) => new Date(value).toLocaleDateString();
const formatDateLong = (value) => new Date(value).toLocaleDateString(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric'
});

const escapeHtml = (value = "") => String(value)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

const formatAiText = (value = "") => value
  .split('\n\n')
  .filter(p => p.trim())
  .map(p => `<p>${escapeHtml(p).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>')}</p>`)
  .join('');

const formatHandoutNumber = (value, decimals = 1) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  const numeric = Number(value);
  if (Math.abs(numeric) >= 100 || Number.isInteger(numeric)) {
    return String(Math.round(numeric));
  }
  return numeric.toFixed(decimals);
};

const getStatSuffix = (stat) => ['fg%', '3pt%', 'ft%', 'shoot'].includes((stat || '').toLowerCase()) ? '%' : '';

const HANDOUT_PERIODS = {
  '6m': { months: 6, label: 'Last 6 months' },
  '12m': { months: 12, label: 'Last year' }
};

const HANDOUT_VISUAL_STATS = ['pts', 'reb', 'asst', 'shoot', 'atk', 'def', 'fg%', '3pt%', 'ft%'];

const normalizeHintList = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 4);
};

/**
 * Format a stat value for display
 * Handles: objects { made, attempted }, numbers, null, strings
 */
const formatStatValue = (value) => {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object" && "made" in value && "attempted" in value) {
    return `${value.made}-${value.attempted}`;
  }
  return String(value);
};

/**
 * Get numeric value from a stat for calculations/charting
 * Uses the shared function from data.js
 */
const getNumericStatValue = (value) => {
  if (value === null || value === undefined) return 0;
  if (typeof value === "object" && "made" in value) return value.made;
  return Number(value) || 0;
};

/**
 * Returns the selected league values from the filter.
 * Empty array means "Any" (no filter).
 */
const getSelectedLeagues = () => {
  if (!leagueFilterSelect) return [];
  const selected = Array.from(leagueFilterSelect.selectedOptions).map(o => o.value);
  // If "Any" (empty string) is among selections, treat as no filter
  if (selected.includes('')) return [];
  return selected;
};

/**
 * Populate the league filter with unique leagues from the data.
 * Preserves existing selections where possible.
 */
const populateLeagueFilter = (games) => {
  if (!leagueFilterSelect) return;

  const leagues = [...new Set(
    games.map(g => (g.league || '').trim()).filter(Boolean)
  )].sort();

  // Remember current selection
  const prevSelected = getSelectedLeagues();

  // Rebuild options
  leagueFilterSelect.innerHTML = '<option value="">Any</option>';
  leagues.forEach(league => {
    const opt = document.createElement('option');
    opt.value = league;
    opt.textContent = league;
    if (prevSelected.includes(league)) opt.selected = true;
    leagueFilterSelect.appendChild(opt);
  });

  // Collapse to 1 row when only "Any" exists, otherwise show up to 4 options
  leagueFilterSelect.size = Math.min(leagues.length + 1, 4);

  // If nothing was previously selected, select "Any"
  if (prevSelected.length === 0) {
    leagueFilterSelect.options[0].selected = true;
  }
};

const buildData = () => {
  const { games } = window.basketStatData.loadData();
  const selectedLeagues = getSelectedLeagues();
  const filteredGames = selectedLeagues.length === 0
    ? games
    : games.filter(g => selectedLeagues.includes((g.league || '').trim()));
  return filteredGames
    .flatMap((game) => {
      // Handle both old format (entries array) and new format (performances object)
      if (game.performances) {
        return Object.entries(game.performances).map(([playerName, stats]) => ({
        date: game.date,
        opponent: game.opponent,
          league: game.league,
          homeAway: game.homeAway,
          player: playerName,
          stats: stats,
        }));
      } else if (game.entries) {
        // Legacy format support
        return game.entries.map((entry) => ({
          date: game.date,
          opponent: game.opponent,
          league: game.league,
          homeAway: game.homeAway,
          player: entry.name || entry.player,
        stats: entry.stats,
        }));
      }
      return [];
    })
    .sort((a, b) => new Date(a.date) - new Date(b.date));
};

// Stats to hide from the dashboard
const HIDDEN_STATS = ['+/-'];

// Stat display order (min first as it's contextual, then scoring stats)
const STAT_ORDER = ['min', 'pts', 'fg', 'fg%', '3pt', '3pt%', 'ft', 'ft%', 'oreb', 'dreb', 'asst', 'stl', 'blk', 'to', 'foul', 'a/to'];

const updatePlayerSelector = (records) => {
  const players = window.basketStatData.unique(records.map((record) => record.player));
  playerSelect.innerHTML = players
    .map((player) => `<option value="${player}">${player}</option>`)
    .join("");
};

const getAvailableStats = (records) => {
  return window.basketStatData.unique(
    records.flatMap((record) => Object.keys(record.stats))
  ).filter(stat => !HIDDEN_STATS.includes(stat.toLowerCase()))
   .sort((a, b) => {
     const aIdx = STAT_ORDER.indexOf(a.toLowerCase());
     const bIdx = STAT_ORDER.indexOf(b.toLowerCase());
     if (aIdx === -1 && bIdx === -1) return a.localeCompare(b);
     if (aIdx === -1) return 1;
     if (bIdx === -1) return -1;
     return aIdx - bIdx;
   });
};

/**
 * Calculate windowed statistics for a stat
 * Uses the shared implementation from data.js
 */
const calculateWindowedStats = (records, stat, windowSize) => {
  // Use the shared function - statsNested=true for dashboard format
  return window.basketStatData.calculateWindowedStatsShared(records, stat, windowSize, true);
};

/**
 * Get trend indicator
 */
const getTrendIndicator = (trend, threshold = 0.5) => {
  if (Math.abs(trend) < threshold) {
    return { icon: '→', class: 'neutral', text: 'stable' };
  }
  if (trend > 0) {
    return { icon: '↑', class: 'up', text: `+${trend.toFixed(1)}` };
  }
  return { icon: '↓', class: 'down', text: trend.toFixed(1) };
};

/**
 * Calculate trending index - ratio of improving to declining trends
 * Returns: { index, improving, declining, total }
 */
const calculateTrendingIndex = (records, windowSize) => {
  const stats = getAvailableStats(records);
  let improving = 0;
  let declining = 0;
  let stable = 0;
  
  stats.forEach(stat => {
    const ws = calculateWindowedStats(records, stat, windowSize);
    if (!ws || !ws.hasPrevWindow) return;
    
    const refStat = window.referenceStats?.getStatReference(stat);
    const isInverted = refStat?.invertedScale || false;
    const customScale = refStat?.customScale;
    
    // Determine if this trend is improving or declining
    const trend = ws.avgTrend;
    const threshold = 0.5;
    
    if (Math.abs(trend) < threshold) {
      stable++;
    } else if (customScale === 'fouls') {
      // For fouls, 3 is optimal - moving toward 3 is improving
      const currentAvg = ws.avg;
      const movingToward3 = (currentAvg > 3 && trend < 0) || (currentAvg < 3 && trend > 0);
      const at3 = Math.abs(currentAvg - 3) < 0.5;
      
      if (at3) {
        stable++; // Already at optimal
      } else if (movingToward3) {
        improving++;
      } else {
        declining++;
      }
    } else if (isInverted) {
      // Inverted: lower is better (turnovers)
      if (trend < 0) improving++;
      else declining++;
    } else {
      // Normal: higher is better
      if (trend > 0) improving++;
      else declining++;
    }
  });
  
  const total = improving + declining + stable;
  
  // Calculate index: ratio of improving to declining
  // If no declining, use improving count as index
  // If no improving, return 0
  let index;
  if (declining === 0 && improving === 0) {
    index = 1; // All stable = neutral
  } else if (declining === 0) {
    index = improving + 1; // All improving = good (2, 3, 4, etc.)
  } else if (improving === 0) {
    index = 1 / (declining + 1); // All declining = bad (0.5, 0.33, 0.25, etc.)
  } else {
    index = improving / declining;
  }
  
  return { index, improving, declining, stable, total };
};

/**
 * Render aggregate stats (Attack Energy, Defence Domination, Shooting Star)
 */
const renderAggregateStats = (playerRecords, windowSize, selectedStat) => {
  if (!aggregateStats) return;
  
  AGGREGATE_STATS.forEach(stat => {
    const valueEl = document.getElementById(`${stat}Value`);
    const trendEl = document.getElementById(`${stat}Trend`);
    const cardEl = aggregateStats.querySelector(`[data-stat="${stat}"]`);
    
    if (!valueEl) return;
    
    const ws = calculateWindowedStats(playerRecords, stat, windowSize);
    
    if (!ws || ws.average === null || ws.average === undefined) {
      valueEl.textContent = '—';
      valueEl.className = 'aggregate-value';
      if (trendEl) trendEl.innerHTML = '';
      if (cardEl) cardEl.classList.remove('active');
      return;
    }
    
    // Display value with unit
    const unit = stat === 'shoot' ? '%' : '';
    valueEl.textContent = ws.average.toFixed(1) + unit;
    
    // Get performance level color
    const perfLevel = window.referenceStats?.getPerformanceLevel(stat, ws.average) || 'average';
    valueEl.className = `aggregate-value perf-${perfLevel}`;
    
    // Render trend
    if (trendEl && ws.hasPrevWindow) {
      const trend = ws.avgTrend;
      if (Math.abs(trend) < 0.5) {
        trendEl.innerHTML = `<span class="trend-neutral">→</span>`;
      } else if (trend > 0) {
        trendEl.innerHTML = `<span class="trend-up">↑ +${trend.toFixed(1)}</span>`;
      } else {
        trendEl.innerHTML = `<span class="trend-down">↓ ${trend.toFixed(1)}</span>`;
      }
    } else if (trendEl) {
      trendEl.innerHTML = '';
    }
    
    // Set active state
    if (cardEl) {
      cardEl.classList.toggle('active', stat === selectedStat);
    }
  });
  
  // Add click handlers for aggregate stats
  aggregateStats.querySelectorAll('.aggregate-stat').forEach(card => {
    card.onclick = () => {
      const stat = card.dataset.stat;
      statSelect.value = stat;
      
      // Update active states
      aggregateStats.querySelectorAll('.aggregate-stat').forEach(c => c.classList.remove('active'));
      scorecardGrid.querySelectorAll('.stat-scorecard').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      
      updateChartAndTable();
    };
  });
};

/**
 * Render the player scorecard
 */
const renderScorecard = (records, player, windowSize) => {
  const playerRecords = records.filter(r => r.player === player);
  const stats = getAvailableStats(playerRecords);
  const selectedStat = statSelect.value || stats[0] || 'pts';
  
  if (playerRecords.length === 0) {
    scorecardGrid.innerHTML = '<div class="no-data-message">No games recorded for this player</div>';
    if (trendingIndexValue) {
      trendingIndexValue.textContent = '—';
      trendingIndexValue.className = 'trending-index-value';
    }
    if (trendingIndexDetail) trendingIndexDetail.textContent = '';
    
    // Clear aggregate stats
    AGGREGATE_STATS.forEach(stat => {
      const valueEl = document.getElementById(`${stat}Value`);
      const trendEl = document.getElementById(`${stat}Trend`);
      if (valueEl) {
        valueEl.textContent = '—';
        valueEl.className = 'aggregate-value';
      }
      if (trendEl) trendEl.innerHTML = '';
    });
    return;
  }
  
  // Calculate and render trending index
  const trendIndex = calculateTrendingIndex(playerRecords, windowSize);
  if (trendingIndexValue) {
    trendingIndexValue.textContent = trendIndex.index.toFixed(2);
    // Color based on index value
    if (trendIndex.index > 1.2) {
      trendingIndexValue.className = 'trending-index-value positive';
    } else if (trendIndex.index < 0.8) {
      trendingIndexValue.className = 'trending-index-value negative';
    } else {
      trendingIndexValue.className = 'trending-index-value neutral';
    }
  }
  if (trendingIndexDetail) {
    if (trendIndex.total === 0) {
      trendingIndexDetail.innerHTML = 'Need more games for trend data';
    } else {
      trendingIndexDetail.innerHTML = `
        <span class="up-count">↑ ${trendIndex.improving}</span> improving · 
        <span class="down-count">↓ ${trendIndex.declining}</span> declining · 
        ${trendIndex.stable} stable
      `;
    }
  }
  
  // Render aggregate stats (Attack Energy, Defence Domination, Shooting Star)
  renderAggregateStats(playerRecords, windowSize, selectedStat);
  
  // Filter out aggregate stats from the regular scorecard grid
  const regularStats = stats.filter(s => !AGGREGATE_STATS.includes(s));
  
  scorecardGrid.innerHTML = regularStats.map(stat => {
    const ws = calculateWindowedStats(playerRecords, stat, windowSize);
    
    // For percentage stats, calculate from base stat totals
    const percentageToBase = { 'fg%': 'fg', '3pt%': '3pt', 'ft%': 'ft' };
    const baseStat = percentageToBase[stat.toLowerCase()];
    const isPercentageStat = !!baseStat;
    
    let calculatedPercentage = null;
    let baseStatTotals = null;
    if (isPercentageStat) {
      const baseWs = calculateWindowedStats(playerRecords, baseStat, windowSize);
      if (baseWs?.totals && baseWs.totals.attempted > 0) {
        calculatedPercentage = (baseWs.totals.made / baseWs.totals.attempted) * 100;
        baseStatTotals = baseWs.totals;
      }
    }
    
    // For percentage stats with no attempts, show no data
    if (isPercentageStat && calculatedPercentage === null) {
      return `
        <div class="stat-scorecard ${stat === selectedStat ? 'active' : ''}" data-stat="${stat}">
          <div class="stat-scorecard-header">
            <span class="stat-scorecard-name">${stat}</span>
            <span class="stat-scorecard-avg" style="color: var(--text-muted);">—</span>
          </div>
          <div class="no-data-message" style="padding: 8px 0;">No attempts</div>
        </div>
      `;
    }
    
    if (!ws && !isPercentageStat) {
      return `
        <div class="stat-scorecard ${stat === selectedStat ? 'active' : ''}" data-stat="${stat}">
          <div class="stat-scorecard-header">
            <span class="stat-scorecard-name">${stat}</span>
            <span class="stat-scorecard-avg" style="color: var(--text-muted);">—</span>
          </div>
          <div class="no-data-message" style="padding: 8px 0;">No data</div>
        </div>
      `;
    }
    
    // Use calculated percentage for percentage stats
    const displayAverage = isPercentageStat ? calculatedPercentage : ws.average;
    const perfLevel = window.referenceStats?.getPerformanceLevel(stat, displayAverage) || 'average';
    const avgTrend = ws ? getTrendIndicator(ws.avgTrend) : { icon: '', class: 'neutral' };
    const medianTrend = ws ? getTrendIndicator(ws.medianTrend) : { icon: '', class: 'neutral' };
    const varianceTrend = ws ? getTrendIndicator(ws.varianceTrend, 1) : { icon: '', class: 'neutral' };
    
    // Determine trend color based on stat type
    const refStat = window.referenceStats?.getStatReference(stat);
    const isInverted = refStat?.invertedScale;
    const customScale = refStat?.customScale;
    
    let avgTrendClass, medTrendClass;
    
    if (customScale === 'fouls' && ws) {
      // For fouls, moving toward 3 is good (green), away from 3 is bad (red)
      const currentAvg = ws.avg;
      const movingToward3 = (currentAvg > 3 && ws.avgTrend < 0) || (currentAvg < 3 && ws.avgTrend > 0);
      const at3 = Math.abs(currentAvg - 3) < 0.5;
      
      if (Math.abs(ws.avgTrend) < 0.5) {
        avgTrendClass = 'neutral';
      } else if (at3 || movingToward3) {
        avgTrendClass = 'up'; // Green - good trend
      } else {
        avgTrendClass = 'down'; // Red - bad trend
      }
      
      // Same logic for median
      const movingToward3Med = (ws.median > 3 && ws.medianTrend < 0) || (ws.median < 3 && ws.medianTrend > 0);
      if (Math.abs(ws.medianTrend) < 0.5) {
        medTrendClass = 'neutral';
      } else if (Math.abs(ws.median - 3) < 0.5 || movingToward3Med) {
        medTrendClass = 'up';
      } else {
        medTrendClass = 'down';
      }
    } else if (isInverted) {
      // For inverted stats (TO), lower is better - flip colors
      avgTrendClass = avgTrend.class === 'up' ? 'down' : avgTrend.class === 'down' ? 'up' : 'neutral';
      medTrendClass = medianTrend.class === 'up' ? 'down' : medianTrend.class === 'down' ? 'up' : 'neutral';
    } else {
      // Normal stats - higher is better
      avgTrendClass = avgTrend.class;
      medTrendClass = medianTrend.class;
    }
    
    // For percentage stats, show totals info in details
    if (isPercentageStat && baseStatTotals) {
      return `
        <div class="stat-scorecard ${stat === selectedStat ? 'active' : ''}" data-stat="${stat}">
          <div class="stat-scorecard-header">
            <span class="stat-scorecard-name">${stat}</span>
            <span class="stat-scorecard-avg perf-${perfLevel}">
              ${displayAverage.toFixed(1)}%
            </span>
          </div>
          <div class="stat-scorecard-details">
            <div class="stat-detail">
              <span class="stat-detail-label">Made</span>
              <span class="stat-detail-value">${baseStatTotals.made}</span>
            </div>
            <div class="stat-detail">
              <span class="stat-detail-label">Attempted</span>
              <span class="stat-detail-value">${baseStatTotals.attempted}</span>
            </div>
          </div>
          <div style="font-size: 9px; color: var(--text-muted); margin-top: 6px;">
            ${baseStatTotals.made}-${baseStatTotals.attempted} over window
          </div>
        </div>
      `;
    }
    
    return `
      <div class="stat-scorecard ${stat === selectedStat ? 'active' : ''}" data-stat="${stat}">
        <div class="stat-scorecard-header">
          <span class="stat-scorecard-name">${stat}</span>
          <span class="stat-scorecard-avg perf-${perfLevel}">
            ${displayAverage.toFixed(1)}
            ${ws?.hasPrevWindow ? `<span class="stat-scorecard-trend ${avgTrendClass}">${avgTrend.icon}</span>` : ''}
          </span>
        </div>
        <div class="stat-scorecard-details">
          <div class="stat-detail">
            <span class="stat-detail-label">Median</span>
            <span class="stat-detail-value">
              ${ws?.median?.toFixed(1) || '—'}
              ${ws?.hasPrevWindow ? `<span class="stat-detail-trend ${medTrendClass}">${medianTrend.icon}</span>` : ''}
            </span>
          </div>
          <div class="stat-detail">
            <span class="stat-detail-label">Range</span>
            <span class="stat-detail-value">
              <span class="variance-range">
                <span class="low">${ws?.min ?? '—'}</span> – <span class="high">${ws?.max ?? '—'}</span>
              </span>
              ${ws?.hasPrevWindow ? `<span class="stat-detail-trend ${varianceTrend.class}">${varianceTrend.icon}</span>` : ''}
            </span>
          </div>
        </div>
        <div style="font-size: 9px; color: var(--text-muted); margin-top: 6px;">
          ${ws?.gamesInWindow || 0} of ${ws?.totalGames || 0} games
        </div>
      </div>
    `;
  }).join('');
  
  // Add click handlers
  scorecardGrid.querySelectorAll('.stat-scorecard').forEach(card => {
    card.addEventListener('click', () => {
      const stat = card.dataset.stat;
      statSelect.value = stat;
      
      // Clear all active states
      scorecardGrid.querySelectorAll('.stat-scorecard').forEach(c => c.classList.remove('active'));
      if (aggregateStats) {
        aggregateStats.querySelectorAll('.aggregate-stat').forEach(c => c.classList.remove('active'));
      }
      
      card.classList.add('active');
      updateChartAndTable();
    });
  });
};

const updateGameTable = (records, player, stat) => {
  const filtered = records.filter((record) => record.player === player);
  
  if (statHeader) statHeader.textContent = stat;
  if (gameTable) {
  gameTable.innerHTML = filtered
    .map(
      (record) => `
        <tr>
          <td>${formatDate(record.date)}</td>
          <td>${record.opponent}</td>
            <td>${formatStatValue(record.stats[stat])}</td>
        </tr>
      `
    )
    .join("");
  }

  return filtered;
};

/**
 * Performance color palette based on reference stats
 */
const PERFORMANCE_COLORS = {
  excellent: '#22c55e',  // Green
  good: '#84cc16',       // Light green
  average: '#eab308',    // Yellow
  below: '#f97316',      // Orange
  poor: '#ef4444'        // Red
};

/**
 * Get color based on performance relative to reference benchmarks
 * Uses the reference stats database to determine performance level
 */
const getPerformanceColor = (value, stat) => {
  if (value === null || value === undefined) return 'var(--text-muted)';
  
  // Use reference stats if available
  if (window.referenceStats) {
    const level = window.referenceStats.getPerformanceLevel(stat, value);
    return PERFORMANCE_COLORS[level] || PERFORMANCE_COLORS.average;
  }
  
  // Fallback if reference stats not loaded
  return PERFORMANCE_COLORS.average;
};

/**
 * Check if a stat value is meaningful for display (not null, has actual data)
 * For made-attempted stats, requires at least 1 attempt
 * Uses shared function from data.js when checking for calculations
 */
const hasValidStatForDisplay = (statValue) => {
  if (statValue === null || statValue === undefined) return false;
  
  // For made-attempted objects (fg, 3fg, ft), check if there were any attempts
  if (typeof statValue === 'object' && 'attempted' in statValue) {
    return statValue.attempted > 0;
  }
  
  // For other values, just check it's not null
  return true;
};

const renderChart = (records, stat) => {
  if (records.length === 0) {
    chart.innerHTML = "<p>No data</p>";
    return;
  }

  // Filter records to only include those with valid stat values
  const validRecords = records.filter(record => hasValidStatForDisplay(record.stats[stat]));
  
  if (validRecords.length === 0) {
    chart.innerHTML = "<p>No data for this stat</p>";
    return;
  }

  const values = validRecords.map((record) => getNumericStatValue(record.stats[stat]));
  const average = values.reduce((sum, v) => sum + v, 0) / values.length;
  const max = Math.max(...values, 1);
  
  // Get reference info for this stat
  const refStat = window.referenceStats?.getStatReference(stat);
  
  // Calculate percentage positions for CSS-based layout
  const pointsData = values.map((value, index) => {
    const xPercent = (index / Math.max(values.length - 1, 1)) * 100;
    const yPercent = (1 - value / max) * 100;
    const color = getPerformanceColor(value, stat);
    return { xPercent, yPercent, value, color, record: validRecords[index], originalIndex: records.indexOf(validRecords[index]) };
  });
  
  // Average line Y position as percentage
  const avgYPercent = (1 - average / max) * 100;
  
  // SVG line path (using percentage coordinates 0-100)
  const linePoints = pointsData.map(p => `${p.xPercent},${p.yPercent}`).join(" ");
  
  // Create gradient for the line based on performance
  const gradientStops = pointsData.map((p, i) => {
    const percent = (i / Math.max(pointsData.length - 1, 1)) * 100;
    return `<stop offset="${percent}%" stop-color="${p.color}" />`;
  }).join("");
  
  // HTML-based points (positioned with CSS percentages)
  const htmlPoints = pointsData.map((p, i) => `
    <div class="chart-point" data-index="${i}" style="left: ${p.xPercent}%; top: ${p.yPercent}%;">
      <div class="point-ring" style="border-color: ${p.color}; box-shadow: 0 0 8px ${p.color}40;"></div>
      <div class="point-fill" style="background: ${p.color};"></div>
    </div>
  `).join("");
  
  // X-axis date labels (use validRecords for accurate labels)
  const xLabels = [];
  if (validRecords.length > 0) {
    xLabels.push({ pct: 0, label: formatDate(validRecords[0].date).split('/').slice(0,2).join('/') });
    if (validRecords.length > 4) {
      const q1 = Math.floor(validRecords.length / 4);
      xLabels.push({ pct: 25, label: formatDate(validRecords[q1].date).split('/').slice(0,2).join('/') });
    }
    if (validRecords.length > 2) {
      const midIdx = Math.floor(validRecords.length / 2);
      xLabels.push({ pct: 50, label: formatDate(validRecords[midIdx].date).split('/').slice(0,2).join('/') });
    }
    if (validRecords.length > 4) {
      const q3 = Math.floor(3 * validRecords.length / 4);
      xLabels.push({ pct: 75, label: formatDate(validRecords[q3].date).split('/').slice(0,2).join('/') });
    }
    if (validRecords.length > 1) {
      xLabels.push({ pct: 100, label: formatDate(validRecords[validRecords.length - 1].date).split('/').slice(0,2).join('/') });
    }
  }
  
  const xAxisHtml = xLabels.map(l => 
    `<span class="x-label" style="left: ${l.pct}%">${l.label}</span>`
  ).join("");

  // Build legend with reference thresholds if available
  let legendHtml = `
    <div class="legend-item"><span class="legend-dot" style="background: #22c55e;"></span>Excellent</div>
    <div class="legend-item"><span class="legend-dot" style="background: #84cc16;"></span>Good</div>
    <div class="legend-item"><span class="legend-dot" style="background: #eab308;"></span>Average</div>
    <div class="legend-item"><span class="legend-dot" style="background: #f97316;"></span>Below</div>
    <div class="legend-item"><span class="legend-dot" style="background: #ef4444;"></span>Poor</div>
  `;
  
  // Add reference info if available
  if (refStat) {
    legendHtml += `
      <div class="legend-ref">
        <span class="ref-label">U14-U16 benchmarks:</span>
        <span class="ref-values">p50: ${refStat.p50} | p75: ${refStat.p75} | p90: ${refStat.p90}</span>
      </div>
    `;
  }
  
  // Add note if some games were excluded due to missing data
  const excludedCount = records.length - validRecords.length;
  if (excludedCount > 0) {
    legendHtml += `
      <div class="legend-note">
        Showing ${validRecords.length} of ${records.length} games (${excludedCount} with no data)
      </div>
    `;
  }

  chart.innerHTML = `
    <div class="chart-area">
      <!-- SVG for line only -->
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" class="chart-line-svg">
        <defs>
          <linearGradient id="lineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            ${gradientStops}
          </linearGradient>
        </defs>
        
        <!-- Average line -->
        <line x1="0" y1="${avgYPercent}" x2="100" y2="${avgYPercent}" 
              stroke="var(--text-muted)" stroke-width="1" stroke-dasharray="4,4" opacity="0.4" 
              vector-effect="non-scaling-stroke" />
        
        <!-- Data line -->
        <polyline points="${linePoints}" fill="none" stroke="url(#lineGradient)" stroke-width="2.5" 
                  stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" />
    </svg>
      
      <!-- HTML points layer -->
      <div class="chart-points">
        ${htmlPoints}
      </div>
      
      <!-- Average label -->
      <div class="avg-label" style="top: ${avgYPercent}%">player avg: ${average.toFixed(1)}</div>
    </div>
    
    <!-- X-axis -->
    <div class="x-axis">${xAxisHtml}</div>
    
    <!-- Tooltip -->
    <div class="chart-tooltip" id="chartTooltip"></div>
    
    <!-- Legend -->
    <div class="chart-legend">
      ${legendHtml}
    </div>
  `;
  
  // Add tooltip interactivity (pass allRecords for index mapping)
  setupChartTooltips(records, stat, pointsData);
};

const setupChartTooltips = (allRecords, stat, pointsData) => {
  const tooltip = document.getElementById('chartTooltip');
  const chartEl = document.getElementById('chart');
  const refStat = window.referenceStats?.getStatReference(stat);
  
  chartEl.querySelectorAll('.chart-point').forEach((point, index) => {
    const data = pointsData[index];
    const record = data.record; // Use record from pointsData (which is a validRecord)
    
    point.addEventListener('mouseenter', (e) => {
      const locationLabel = record.homeAway === "home" ? "vs" : "@";
      const perfLevel = window.referenceStats?.getPerformanceLevel(stat, data.value) || 'average';
      const perfLabel = perfLevel.charAt(0).toUpperCase() + perfLevel.slice(1);
      
      let refContext = '';
      if (refStat) {
        refContext = `<div class="tooltip-ref">vs U14-U16 avg: ${refStat.p50}</div>`;
      }
      
      tooltip.innerHTML = `
        <div class="tooltip-date">${formatDate(record.date)}</div>
        <div class="tooltip-opponent">${locationLabel} ${record.opponent}</div>
        <div class="tooltip-value" style="color: ${data.color}">${formatStatValue(record.stats[stat])}</div>
        <div class="tooltip-level" style="color: ${data.color}">${perfLabel}</div>
        ${refContext}
      `;
      tooltip.classList.add('visible');
      
      // Position tooltip above the point
      const chartRect = chartEl.getBoundingClientRect();
      const pointRect = point.getBoundingClientRect();
      const tooltipLeft = pointRect.left - chartRect.left + pointRect.width / 2;
      const tooltipTop = pointRect.top - chartRect.top - 8;
      
      tooltip.style.left = `${tooltipLeft}px`;
      tooltip.style.top = `${tooltipTop}px`;
    });
    
    point.addEventListener('mouseleave', () => {
      tooltip.classList.remove('visible');
    });
    
    point.addEventListener('click', () => {
    });
  });
};

/**
 * Comprehensive Player Analysis Engine
 * Generates detailed insights based on all stats, trends, and benchmarks
 */
const analyzePlayerPerformance = (records, windowSize) => {
  if (records.length < 2) {
    return { summary: "Need at least 2 games for analysis", details: [] };
  }

  const stats = getAvailableStats(records);
  const analysis = {
    strengths: [],
    weaknesses: [],
    improving: [],
    declining: [],
    consistent: [],
    hotStreaks: [],
    coldStreaks: [],
    benchmarkComparisons: []
  };

  // Analyze each stat category
  stats.forEach(stat => {
    const validRecords = records.filter(r => window.basketStatData.hasValidStatValue(r.stats[stat]));
    if (validRecords.length < 2) return;
    
    const values = validRecords.map(r => getNumericStatValue(r.stats[stat]));
    const recentValues = values.slice(-windowSize);
    const previousValues = values.slice(-windowSize * 2, -windowSize);
    
    // Skip if not enough data
    if (recentValues.length === 0) return;
    
    const recentAvg = recentValues.reduce((a, b) => a + b, 0) / recentValues.length;
    const seasonAvg = values.reduce((a, b) => a + b, 0) / values.length;
    const prevAvg = previousValues.length > 0 
      ? previousValues.reduce((a, b) => a + b, 0) / previousValues.length 
      : seasonAvg;
    
    // Get reference data
    const refStat = window.referenceStats?.getStatReference(stat);
    const isInverted = refStat?.invertedScale || false;
    const perfLevel = window.referenceStats?.getPerformanceLevel(stat, recentAvg) || 'average';
    
    // Calculate trend (comparing recent window to previous window)
    const trendValue = recentAvg - prevAvg;
    const trendPercent = prevAvg !== 0 ? ((trendValue / prevAvg) * 100) : 0;
    
    // For inverted stats (TO, fouls), negative trend is good
    const trendDirection = isInverted 
      ? (trendValue < -0.2 ? 'improving' : trendValue > 0.2 ? 'declining' : 'consistent')
      : (trendValue > 0.2 ? 'improving' : trendValue < -0.2 ? 'declining' : 'consistent');
    
    // Identify strengths/weaknesses based on benchmark
    if (perfLevel === 'excellent' || perfLevel === 'good') {
      analysis.strengths.push({
        stat,
        avg: recentAvg,
        level: perfLevel,
        refP50: refStat?.p50,
        refP75: refStat?.p75
      });
    } else if (perfLevel === 'poor' || perfLevel === 'below') {
      analysis.weaknesses.push({
        stat,
        avg: recentAvg,
        level: perfLevel,
        refP50: refStat?.p50,
        refP25: refStat?.p25
      });
    }
    
    // Track trends
    if (trendDirection === 'improving') {
      analysis.improving.push({
        stat,
        change: Math.abs(trendValue).toFixed(1),
        changePercent: Math.abs(trendPercent).toFixed(0),
        from: prevAvg.toFixed(1),
        to: recentAvg.toFixed(1)
      });
    } else if (trendDirection === 'declining') {
      analysis.declining.push({
        stat,
        change: Math.abs(trendValue).toFixed(1),
        changePercent: Math.abs(trendPercent).toFixed(0),
        from: prevAvg.toFixed(1),
        to: recentAvg.toFixed(1)
      });
    }
    
    // Detect hot/cold streaks (last 3 games)
    if (recentValues.length >= 3) {
      const last3 = recentValues.slice(-3);
      const last3Avg = last3.reduce((a, b) => a + b, 0) / 3;
      const last3AllGood = last3.every(v => {
        const level = window.referenceStats?.getPerformanceLevel(stat, v);
        return level === 'excellent' || level === 'good';
      });
      const last3AllPoor = last3.every(v => {
        const level = window.referenceStats?.getPerformanceLevel(stat, v);
        return level === 'poor' || level === 'below';
      });
      
      if (last3AllGood) {
        analysis.hotStreaks.push({ stat, games: 3, avg: last3Avg.toFixed(1) });
      } else if (last3AllPoor) {
        analysis.coldStreaks.push({ stat, games: 3, avg: last3Avg.toFixed(1) });
      }
    }
    
    // Benchmark comparisons
    if (refStat) {
      const vsMedian = ((recentAvg / refStat.p50 - 1) * 100).toFixed(0);
      analysis.benchmarkComparisons.push({
        stat,
        avg: recentAvg.toFixed(1),
        level: perfLevel,
        vsMedian: vsMedian,
        p50: refStat.p50,
        p75: refStat.p75,
        p90: refStat.p90
      });
    }
  });

  return analysis;
};

/**
 * Generate human-readable analysis report
 */
const generateAnalysisReport = (playerName, analysis, windowSize) => {
  const sections = [];
  
  // Overall summary
  let summaryParts = [];
  if (analysis.strengths.length > 0) {
    summaryParts.push(`${analysis.strengths.length} strength${analysis.strengths.length > 1 ? 's' : ''}`);
  }
  if (analysis.weaknesses.length > 0) {
    summaryParts.push(`${analysis.weaknesses.length} area${analysis.weaknesses.length > 1 ? 's' : ''} to develop`);
  }
  if (analysis.improving.length > 0) {
    summaryParts.push(`${analysis.improving.length} improving trend${analysis.improving.length > 1 ? 's' : ''}`);
  }
  
  // Strengths section
  if (analysis.strengths.length > 0) {
    const topStrengths = analysis.strengths.slice(0, 3);
    const strengthText = topStrengths.map(s => {
      const statName = getStatDisplayName(s.stat);
      const levelEmoji = s.level === 'excellent' ? '🌟' : '✓';
      return `${levelEmoji} <strong>${statName}</strong> (${s.avg.toFixed(1)} avg, ${s.level})`;
    }).join(', ');
    sections.push(`<div class="insight-section"><span class="insight-label">💪 Strengths:</span> ${strengthText}</div>`);
  }
  
  // Areas to improve section
  if (analysis.weaknesses.length > 0) {
    const topWeaknesses = analysis.weaknesses.slice(0, 2);
    const weaknessText = topWeaknesses.map(w => {
      const statName = getStatDisplayName(w.stat);
      return `<strong>${statName}</strong> (${w.avg.toFixed(1)} avg, target: ${w.refP50})`;
    }).join(', ');
    sections.push(`<div class="insight-section"><span class="insight-label">📈 Focus areas:</span> ${weaknessText}</div>`);
  }
  
  // Trending section
  if (analysis.improving.length > 0) {
    const topImproving = analysis.improving.slice(0, 2);
    const improvingText = topImproving.map(i => {
      const statName = getStatDisplayName(i.stat);
      return `<strong>${statName}</strong> ↑${i.changePercent}%`;
    }).join(', ');
    sections.push(`<div class="insight-section"><span class="insight-label">📊 Improving:</span> ${improvingText}</div>`);
  }
  
  if (analysis.declining.length > 0) {
    const topDeclining = analysis.declining.slice(0, 2);
    const decliningText = topDeclining.map(d => {
      const statName = getStatDisplayName(d.stat);
      return `<strong>${statName}</strong> ↓${d.changePercent}%`;
    }).join(', ');
    sections.push(`<div class="insight-section"><span class="insight-label">⚠️ Watch:</span> ${decliningText}</div>`);
  }
  
  // Hot/cold streaks
  if (analysis.hotStreaks.length > 0) {
    const streakText = analysis.hotStreaks.map(h => `${getStatDisplayName(h.stat)} 🔥`).join(', ');
    sections.push(`<div class="insight-section"><span class="insight-label">🔥 Hot streak:</span> ${streakText}</div>`);
  }
  
  if (analysis.coldStreaks.length > 0) {
    const streakText = analysis.coldStreaks.map(c => `${getStatDisplayName(c.stat)}`).join(', ');
    sections.push(`<div class="insight-section"><span class="insight-label">❄️ Cold streak:</span> ${streakText}</div>`);
  }
  
  // Generate recommendation
  const recommendation = generateRecommendation(analysis);
  if (recommendation) {
    sections.push(`<div class="insight-section insight-recommendation"><span class="insight-label">💡 Tip:</span> ${recommendation}</div>`);
  }
  
  return sections.length > 0 
    ? sections.join('') 
    : `<div class="insight-section">Consistent performance across categories. Keep up the good work!</div>`;
};

/**
 * Get friendly display name for a stat
 */
const getStatDisplayName = (stat) => {
  const names = {
    'pts': 'Points',
    'fg': 'Field Goals',
    'fg%': 'FG%',
    '3pt': '3-Pointers',
    '3pt%': '3PT%',
    'ft': 'Free Throws',
    'ft%': 'FT%',
    'oreb': 'Off. Rebounds',
    'dreb': 'Def. Rebounds',
    'reb': 'Rebounds',
    'asst': 'Assists',
    'stl': 'Steals',
    'blk': 'Blocks',
    'to': 'Turnovers',
    'foul': 'Fouls',
    'a/to': 'Assist/TO Ratio'
  };
  return names[stat.toLowerCase()] || stat;
};

/**
 * Generate actionable recommendation based on analysis
 */
const generateRecommendation = (analysis) => {
  // Prioritize recommendations
  if (analysis.coldStreaks.some(c => c.stat === 'fg%' || c.stat === '3pt%')) {
    return "Shooting is cold. Focus on high-percentage shots closer to the basket.";
  }
  
  if (analysis.declining.some(d => d.stat === 'to') || analysis.weaknesses.some(w => w.stat === 'to')) {
    return "Work on ball security. Look for safer passing lanes and avoid forcing plays.";
  }
  
  if (analysis.declining.some(d => d.stat === 'a/to')) {
    return "Assist-to-turnover ratio declining. Focus on smart decision-making with the ball.";
  }
  
  if (analysis.weaknesses.some(w => w.stat === 'ft%')) {
    return "Free throw practice can add easy points. Aim for 10+ FTs daily.";
  }
  
  if (analysis.weaknesses.some(w => w.stat === 'dreb')) {
    return "Box out on defensive rebounds. Position yourself between opponent and basket.";
  }
  
  if (analysis.improving.length >= 2 && analysis.declining.length === 0) {
    return "Great progress! Maintain this momentum and keep pushing.";
  }
  
  if (analysis.hotStreaks.length >= 2) {
    return "Playing with confidence! Stay aggressive and trust your game.";
  }
  
  if (analysis.strengths.length > 0 && analysis.weaknesses.length > 0) {
    const strength = analysis.strengths[0];
    return `Build on your ${getStatDisplayName(strength.stat)} strength while developing weaker areas.`;
  }
  
  return null;
};

const POSITION_NAMES = {
  PG: 'Point Guard',
  SG: 'Shooting Guard',
  SF: 'Small Forward',
  PF: 'Power Forward',
  C: 'Center'
};

const setAiHandoutStatus = (message = '', tone = 'neutral') => {
  if (!aiHandoutStatus) return;
  aiHandoutStatus.textContent = message;
  aiHandoutStatus.className = message
    ? `ai-handout-status visible ${tone}`
    : 'ai-handout-status';
};

const clearAiHandout = (message = '') => {
  handoutIsReady = false;
  if (printAiHandoutBtn) {
    printAiHandoutBtn.disabled = true;
  }
  if (aiHandoutOutput) {
    aiHandoutOutput.innerHTML = message
      ? `<div class="ai-handout-placeholder">${escapeHtml(message)}</div>`
      : '';
  }
  if (!message) {
    setAiHandoutStatus('');
  }
};

const getHandoutPeriodData = (records, periodKey) => {
  const period = HANDOUT_PERIODS[periodKey] || HANDOUT_PERIODS['6m'];
  const sortedRecords = [...records].sort((a, b) => new Date(a.date) - new Date(b.date));

  if (sortedRecords.length === 0) {
    return {
      records: [],
      period,
      startDate: null,
      endDate: null,
      dateRangeLabel: 'No games'
    };
  }

  const endDate = new Date(sortedRecords[sortedRecords.length - 1].date);
  const cutoffDate = new Date(endDate);
  cutoffDate.setMonth(cutoffDate.getMonth() - period.months);

  const filteredRecords = sortedRecords.filter(record => new Date(record.date) >= cutoffDate);
  const actualStart = filteredRecords[0] ? new Date(filteredRecords[0].date) : cutoffDate;

  return {
    records: filteredRecords,
    period,
    startDate: actualStart,
    endDate,
    dateRangeLabel: `${formatDateLong(actualStart)} - ${formatDateLong(endDate)}`
  };
};

const getStatTrendValues = (records, stat) => {
  const lowerStat = (stat || '').toLowerCase();
  const percentageBaseStats = { 'fg%': 'fg', '3pt%': '3pt', 'ft%': 'ft' };
  const baseStat = percentageBaseStats[lowerStat];

  if (baseStat) {
    return records
      .map(record => {
        const baseValue = record.stats?.[baseStat];
        if (!baseValue || typeof baseValue !== 'object' || baseValue.attempted <= 0) return null;
        return (baseValue.made / baseValue.attempted) * 100;
      })
      .filter(value => value !== null);
  }

  return records
    .map(record => record.stats?.[stat])
    .filter(value => hasValidStatForDisplay(value))
    .map(value => getNumericStatValue(value));
};

const getStatSummaryForRecords = (records, stat) => {
  const lowerStat = (stat || '').toLowerCase();
  const percentageBaseStats = { 'fg%': 'fg', '3pt%': '3pt', 'ft%': 'ft' };
  const baseStat = percentageBaseStats[lowerStat];

  if (baseStat) {
    const baseWindow = calculateWindowedStats(records, baseStat, 'all');
    if (!baseWindow?.totals || baseWindow.totals.attempted <= 0) return null;
    const average = (baseWindow.totals.made / baseWindow.totals.attempted) * 100;
    return {
      stat,
      average,
      perfLevel: window.referenceStats?.getPerformanceLevel(stat, average) || 'average',
      values: getStatTrendValues(records, stat),
      totals: baseWindow.totals,
      games: baseWindow.gamesInWindow
    };
  }

  const statWindow = calculateWindowedStats(records, stat, 'all');
  if (!statWindow) return null;

  return {
    stat,
    average: statWindow.average,
    perfLevel: window.referenceStats?.getPerformanceLevel(stat, statWindow.average) || 'average',
    values: getStatTrendValues(records, stat),
    totals: statWindow.totals,
    games: statWindow.gamesInWindow
  };
};

const getHandoutComparisonWindowSize = (records) => Math.max(2, Math.min(6, Math.floor(records.length / 2) || 2));

const getHandoutImprovementItems = (analysis) => {
  const items = [];
  const seen = new Set();

  [...analysis.improving]
    .sort((a, b) => Number(b.changePercent) - Number(a.changePercent))
    .forEach(item => {
      if (seen.has(item.stat)) return;
      seen.add(item.stat);
      items.push({
        stat: item.stat,
        title: getStatDisplayName(item.stat),
        value: `${formatHandoutNumber(item.from)}${getStatSuffix(item.stat)} -> ${formatHandoutNumber(item.to)}${getStatSuffix(item.stat)}`,
        badge: `+${item.changePercent}%`,
        note: 'Positive trend in the recent comparison window.',
        tone: 'positive'
      });
    });

  [...analysis.strengths]
    .sort((a, b) => a.avg - b.avg)
    .reverse()
    .forEach(item => {
      if (seen.has(item.stat) || items.length >= 3) return;
      seen.add(item.stat);
      items.push({
        stat: item.stat,
        title: getStatDisplayName(item.stat),
        value: `${formatHandoutNumber(item.avg)}${getStatSuffix(item.stat)}`,
        badge: item.level,
        note: item.refP75 !== undefined
          ? `Already above the strong benchmark of ${formatHandoutNumber(item.refP75)}${getStatSuffix(item.stat)}.`
          : 'Strong current level.',
        tone: 'positive'
      });
    });

  return items.slice(0, 3);
};

const getHandoutFocusItems = (analysis) => {
  const items = [];
  const seen = new Set();

  [...analysis.declining]
    .sort((a, b) => Number(b.changePercent) - Number(a.changePercent))
    .forEach(item => {
      if (seen.has(item.stat)) return;
      seen.add(item.stat);
      items.push({
        stat: item.stat,
        title: getStatDisplayName(item.stat),
        value: `${formatHandoutNumber(item.from)}${getStatSuffix(item.stat)} -> ${formatHandoutNumber(item.to)}${getStatSuffix(item.stat)}`,
        badge: `-${item.changePercent}%`,
        note: 'Needs attention in the recent comparison window.',
        tone: 'focus'
      });
    });

  [...analysis.weaknesses]
    .sort((a, b) => a.avg - b.avg)
    .forEach(item => {
      if (seen.has(item.stat) || items.length >= 3) return;
      seen.add(item.stat);
      items.push({
        stat: item.stat,
        title: getStatDisplayName(item.stat),
        value: `${formatHandoutNumber(item.avg)}${getStatSuffix(item.stat)}`,
        badge: item.level,
        note: item.refP50 !== undefined
          ? `Target the benchmark average of ${formatHandoutNumber(item.refP50)}${getStatSuffix(item.stat)}.`
          : 'Below target level right now.',
        tone: 'focus'
      });
    });

  return items.slice(0, 3);
};

const buildSparklineSvg = (values, stat) => {
  if (!values.length) {
    return '<div class="ai-handout-sparkline-empty">No data</div>';
  }

  const width = 240;
  const height = 72;
  const padding = 8;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = Math.max(max - min, 1);
  const stroke = getPerformanceColor(values[values.length - 1], stat);

  const points = values.map((value, index) => {
    const x = padding + (index / Math.max(values.length - 1, 1)) * (width - padding * 2);
    const y = height - padding - ((value - min) / range) * (height - padding * 2);
    return { x, y, value };
  });

  const polyline = points.map(point => `${point.x},${point.y}`).join(' ');
  const lastPoint = points[points.length - 1];

  return `
    <svg viewBox="0 0 ${width} ${height}" class="ai-handout-sparkline" aria-hidden="true">
      <polyline points="${polyline}" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></polyline>
      <circle cx="${lastPoint.x}" cy="${lastPoint.y}" r="4.5" fill="${stroke}"></circle>
    </svg>
  `;
};

const getHandoutVisualStats = (records) => HANDOUT_VISUAL_STATS
  .map(stat => ({ stat, summary: getStatSummaryForRecords(records, stat) }))
  .filter(item => item.summary && item.summary.values.length > 0)
  .slice(0, 4);

const buildPlayerHandoutContext = (playerName, records, periodKey) => {
  const profile = window.basketStatData.getPlayerProfile(playerName);
  const playerAge = window.basketStatData.calculateAge(profile.birthdate);
  const periodData = getHandoutPeriodData(records, periodKey);
  const filteredRecords = periodData.records;
  const comparisonWindow = getHandoutComparisonWindowSize(filteredRecords);
  const analysis = analyzePlayerPerformance(filteredRecords, comparisonWindow);
  const improvementItems = getHandoutImprovementItems(analysis);
  const focusItems = getHandoutFocusItems(analysis);
  const visualStats = getHandoutVisualStats(filteredRecords);
  const trendIndex = calculateTrendingIndex(filteredRecords, comparisonWindow);
  const pointsSummary = getStatSummaryForRecords(filteredRecords, 'pts');
  const attackSummary = getStatSummaryForRecords(filteredRecords, 'atk');
  const shootingSummary = getStatSummaryForRecords(filteredRecords, 'shoot');

  return {
    playerName,
    profile,
    playerAge,
    periodData,
    filteredRecords,
    comparisonWindow,
    analysis,
    improvementItems,
    focusItems,
    visualStats,
    trendIndex,
    pointsSummary,
    attackSummary,
    shootingSummary
  };
};

const buildPlayerHandoutPrompt = (context) => {
  const { playerName, profile, playerAge, periodData, filteredRecords, improvementItems, focusItems, visualStats, trendIndex } = context;
  const profileSummary = [
    profile.number ? `#${profile.number}` : null,
    playerAge !== null ? `${playerAge} years old` : null,
    profile.height ? `${profile.height}m` : null,
    profile.position ? (POSITION_NAMES[profile.position] || profile.position) : null
  ].filter(Boolean).join(' · ');

  return `You are writing a printable one-page youth basketball handout for a player.
Return valid JSON only. Do not wrap the JSON in markdown fences.

Use this exact schema:
{
  "developmentSummary": "2 short paragraphs max. Mention concrete stats.",
  "coachRemark": "1 short encouraging but honest paragraph to the player.",
  "hintsAndTips": ["short practical tip", "short practical tip", "short practical tip"]
}

Rules:
- Be specific, positive, and honest.
- Do not invent stats or achievements.
- Keep language suitable for a youth player handout.
- The tips should be actionable training advice, not generic motivation.
- hintsAndTips must contain 2 to 4 items.

PLAYER: ${playerName}
PROFILE: ${profileSummary || 'No extra profile info'}
PERIOD: ${periodData.period.label}
DATE RANGE: ${periodData.dateRangeLabel}
GAMES IN PERIOD: ${filteredRecords.length}
TRENDING INDEX: ${trendIndex.index.toFixed(2)}

IMPROVEMENTS:
${improvementItems.length > 0 ? improvementItems.map(item => `- ${item.title}: ${item.value} (${item.badge})`).join('\n') : '- None clearly identified'}

FOCUS AREAS:
${focusItems.length > 0 ? focusItems.map(item => `- ${item.title}: ${item.value} (${item.badge})`).join('\n') : '- No major weak areas, focus on consistency'}

KEY STATS:
${visualStats.length > 0 ? visualStats.map(item => `- ${getStatDisplayName(item.stat)} avg: ${formatHandoutNumber(item.summary.average)}${getStatSuffix(item.stat)}`).join('\n') : '- No key stat visuals available'}`;
};

const parseAiHandoutResponse = (responseText) => {
  const raw = String(responseText || '').trim();
  const withoutFences = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const jsonMatch = withoutFences.match(/\{[\s\S]*\}/);
  const candidate = jsonMatch ? jsonMatch[0] : withoutFences;

  try {
    const parsed = JSON.parse(candidate);
    const hintsAndTips = normalizeHintList(parsed.hintsAndTips);
    return {
      developmentSummary: String(parsed.developmentSummary || '').trim(),
      coachRemark: String(parsed.coachRemark || '').trim(),
      hintsAndTips: hintsAndTips.length > 0 ? hintsAndTips : ['Keep building on the strongest trends shown in the handout.']
    };
  } catch (error) {
    const paragraphs = raw.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    return {
      developmentSummary: paragraphs[0] || raw || 'AI summary unavailable.',
      coachRemark: paragraphs[1] || paragraphs[0] || 'Keep working on the focus areas in this handout.',
      hintsAndTips: normalizeHintList(
        paragraphs.slice(2).flatMap(paragraph => paragraph.split(/\n|•|- /).map(item => item.trim()))
      ).slice(0, 4)
    };
  }
};

const buildHandoutAreaCards = (items, emptyMessage) => {
  if (!items.length) {
    return `<div class="ai-handout-empty">${escapeHtml(emptyMessage)}</div>`;
  }

  return items.map(item => `
    <article class="ai-handout-area-card ${item.tone}">
      <div class="ai-handout-area-header">
        <h4>${escapeHtml(item.title)}</h4>
        <span class="ai-handout-badge ${item.tone}">${escapeHtml(item.badge)}</span>
      </div>
      <div class="ai-handout-area-value">${escapeHtml(item.value)}</div>
      <p>${escapeHtml(item.note)}</p>
    </article>
  `).join('');
};

const buildHandoutVisualCards = (visualStats) => {
  if (!visualStats.length) {
    return `<div class="ai-handout-empty">Not enough stat history in this period to draw visuals.</div>`;
  }

  return visualStats.map(item => `
    <article class="ai-handout-visual-card">
      <div class="ai-handout-visual-header">
        <h4>${escapeHtml(getStatDisplayName(item.stat))}</h4>
        <span class="ai-handout-visual-value perf-${item.summary.perfLevel}">
          ${formatHandoutNumber(item.summary.average)}${getStatSuffix(item.stat)}
        </span>
      </div>
      ${buildSparklineSvg(item.summary.values, item.stat)}
      <div class="ai-handout-visual-footer">${item.summary.values.length} games with data</div>
    </article>
  `).join('');
};

const renderPlayerHandout = (context, aiHandout) => {
  const { playerName, profile, playerAge, periodData, filteredRecords, improvementItems, focusItems, visualStats, trendIndex, pointsSummary, attackSummary, shootingSummary } = context;
  const summaryCards = [
    {
      label: 'Games',
      value: filteredRecords.length,
      detail: periodData.period.label
    },
    {
      label: 'Trending Index',
      value: trendIndex.index.toFixed(2),
      detail: `${trendIndex.improving} up · ${trendIndex.declining} down`
    },
    {
      label: 'Points Avg',
      value: pointsSummary ? `${formatHandoutNumber(pointsSummary.average)}${getStatSuffix('pts')}` : '—',
      detail: 'Period average'
    },
    {
      label: shootingSummary ? 'Shooting Star' : 'Attack Energy',
      value: shootingSummary
        ? `${formatHandoutNumber(shootingSummary.average)}${getStatSuffix('shoot')}`
        : attackSummary
          ? `${formatHandoutNumber(attackSummary.average)}${getStatSuffix('atk')}`
          : '—',
      detail: shootingSummary ? 'Shot quality blend' : 'Offensive involvement'
    }
  ];

  const profileMeta = [
    profile.number ? `#${profile.number}` : null,
    profile.position ? (POSITION_NAMES[profile.position] || profile.position) : null,
    profile.height ? `${profile.height}m` : null,
    playerAge !== null ? `${playerAge} years` : null
  ].filter(Boolean).join(' · ');

  const aiSummaryHtml = aiHandout?.developmentSummary
    ? formatAiText(aiHandout.developmentSummary)
    : '<p>AI summary was not generated for this handout.</p>';
  const coachRemarkHtml = aiHandout?.coachRemark
    ? formatAiText(aiHandout.coachRemark)
    : '<p>No AI remark was generated.</p>';
  const hintsAndTips = normalizeHintList(aiHandout?.hintsAndTips);

  aiHandoutOutput.innerHTML = `
    <section class="player-handout-sheet">
      <header class="player-handout-sheet-header">
        <div>
          <div class="player-handout-eyebrow">AI Player Handout</div>
          <h2>${escapeHtml(playerName)}</h2>
          <p>${escapeHtml(periodData.period.label)} review · ${escapeHtml(periodData.dateRangeLabel)}</p>
        </div>
        <div class="player-handout-meta">${escapeHtml(profileMeta || 'Profile details can be added from the player card.')}</div>
      </header>

      <section class="player-handout-summary-grid">
        ${summaryCards.map(card => `
          <article class="player-handout-summary-card">
            <span class="player-handout-summary-label">${escapeHtml(card.label)}</span>
            <strong class="player-handout-summary-value">${escapeHtml(String(card.value))}</strong>
            <span class="player-handout-summary-detail">${escapeHtml(card.detail)}</span>
          </article>
        `).join('')}
      </section>

      <section class="player-handout-section">
        <div class="player-handout-section-header">
          <h3>AI Development Summary</h3>
          <span>${filteredRecords.length} games in sample</span>
        </div>
        <div class="player-handout-prose">${aiSummaryHtml}</div>
      </section>

      <section class="player-handout-two-column">
        <div class="player-handout-section">
          <div class="player-handout-section-header">
            <h3>Areas of Improvement</h3>
            <span>What is moving in the right direction</span>
          </div>
          <div class="ai-handout-area-grid">
            ${buildHandoutAreaCards(improvementItems, 'No standout improving trends yet in this period.')}
          </div>
        </div>

        <div class="player-handout-section">
          <div class="player-handout-section-header">
            <h3>Focus Next</h3>
            <span>Best targets for the next block</span>
          </div>
          <div class="ai-handout-area-grid">
            ${buildHandoutAreaCards(focusItems, 'Current data is steady. Focus on maintaining consistency.')}
          </div>
        </div>
      </section>

      <section class="player-handout-section">
        <div class="player-handout-section-header">
          <h3>Stat Visuals</h3>
          <span>Recent pattern by category</span>
        </div>
        <div class="ai-handout-visual-grid">
          ${buildHandoutVisualCards(visualStats)}
        </div>
      </section>

      <section class="player-handout-two-column">
        <div class="player-handout-section">
          <div class="player-handout-section-header">
            <h3>Coach's Remark</h3>
            <span>AI generated</span>
          </div>
          <div class="player-handout-note player-handout-prose">
            ${coachRemarkHtml}
          </div>
        </div>

        <div class="player-handout-section">
          <div class="player-handout-section-header">
            <h3>Hints & Tips</h3>
            <span>AI generated</span>
          </div>
          <div class="player-handout-note">
            ${hintsAndTips.length > 0 ? `
              <ul class="player-handout-tips">
                ${hintsAndTips.map(item => `<li>${escapeHtml(item)}</li>`).join('')}
              </ul>
            ` : 'No AI tips were generated.'}
          </div>
        </div>
      </section>
    </section>
  `;

  handoutIsReady = true;
  if (printAiHandoutBtn) {
    printAiHandoutBtn.disabled = false;
  }
};

const updateChartAndTable = () => {
  const data = buildData();
  if (data.length === 0) return;
  
  const player = playerSelect.value;
  const stat = statSelect.value;
  const records = updateGameTable(data, player, stat);
  renderChart(records, stat);
  
  // Update the trend stat indicator
  if (trendStatIndicator) {
    trendStatIndicator.textContent = getStatDisplayName(stat);
  }
};

const updateView = () => {
  const data = buildData();
  if (data.length === 0) {
    clearAiHandout('No player data available for a handout yet.');
    return;
  }

  const player = playerSelect.value;
  const windowSize = parseInt(windowSizeSelect?.value || '5', 10);
  
  // Render player profile card
  renderPlayerProfile(player);
  
  // Render scorecard for player
  renderScorecard(data, player, windowSize);
  
  // Update chart and table with selected stat
  updateChartAndTable();
  clearAiHandout('Generate a fresh handout for the current player and filters.');
};

/**
 * Populate the benchmarks grid with all reference statistics
 */
const populateBenchmarksGrid = () => {
  const grid = document.getElementById('benchmarksGrid');
  if (!grid || !window.referenceStats) return;
  
  const allStats = window.referenceStats.getAllReferenceStats();
  const stats = allStats.stats;
  
  // Define display order for stats
  const statOrder = ['pts', 'fg', 'fg%', '3pt', '3pt%', 'ft', 'ft%', 'oreb', 'dreb', 'asst', 'stl', 'blk', 'to', 'foul'];
  
  // Sort stats: known ones first in order, then any others
  const sortedKeys = Object.keys(stats).sort((a, b) => {
    const aIdx = statOrder.indexOf(a);
    const bIdx = statOrder.indexOf(b);
    if (aIdx === -1 && bIdx === -1) return a.localeCompare(b);
    if (aIdx === -1) return 1;
    if (bIdx === -1) return -1;
    return aIdx - bIdx;
  });
  
  grid.innerHTML = sortedKeys.map(key => {
    const stat = stats[key];
    const isInverted = stat.invertedScale;
    
    return `
      <div class="benchmark-card">
        <div class="stat-name">${stat.name} <small style="font-weight: normal; opacity: 0.6;">(${key})</small></div>
        <div class="thresholds">
          <div class="threshold poor">
            <span class="threshold-label">${isInverted ? '>' : '<'}p25</span>
            <span class="threshold-value">${stat.p25}</span>
          </div>
          <div class="threshold below">
            <span class="threshold-label">p25-50</span>
            <span class="threshold-value">${stat.p50}</span>
          </div>
          <div class="threshold avg">
            <span class="threshold-label">p50-75</span>
            <span class="threshold-value">${stat.p75}</span>
          </div>
          <div class="threshold good">
            <span class="threshold-label">${isInverted ? '<' : '≥'}p90</span>
            <span class="threshold-value">${stat.p90}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
};

const init = () => {
  // Populate benchmarks grid
  populateBenchmarksGrid();
  
  // Ensure computed stats are calculated for all games
  // This runs after data is loaded (including cloud data)
  if (window.basketStatData?.forceRecomputeAllStats) {
    const count = window.basketStatData.forceRecomputeAllStats();
    if (count > 0) {
      console.log(`📊 Computed ${count} player-game stat records`);
    }
  }
  
  const data = buildData();
  if (data.length === 0) {
    playerSelect.innerHTML = "<option>—</option>";
    if (scorecardGrid) scorecardGrid.innerHTML = '<div class="no-data-message">No game data yet. Upload CSVs from the Admin page.</div>';
    chart.innerHTML = "<p>No game data yet</p>";
    if (gameTable) gameTable.innerHTML = "";
    clearAiHandout('No player data available for a handout yet.');
    return;
  }

  // Store current selections to preserve them if possible
  const currentPlayer = playerSelect.value;
  const currentStat = statSelect.value;

  // Populate league filter from the full (unfiltered) game list
  const { games: allGames } = window.basketStatData.loadData();
  populateLeagueFilter(allGames);

  // Update player selector
  updatePlayerSelector(data);

  // Restore player selection if still exists
  if (currentPlayer && [...playerSelect.options].some(opt => opt.value === currentPlayer)) {
    playerSelect.value = currentPlayer;
  }
  
  // Set default stat if none selected
  const stats = getAvailableStats(data);
  if (!currentStat || !stats.includes(currentStat)) {
    statSelect.value = stats[0] || 'pts';
  } else {
    statSelect.value = currentStat;
  }

  updateView();
};

// Event listeners
playerSelect.addEventListener("change", updateView);

if (windowSizeSelect) {
  windowSizeSelect.addEventListener("change", updateView);
}

if (leagueFilterSelect) {
  leagueFilterSelect.addEventListener("change", (e) => {
    // Clicking "Any" clears all specific league selections
    const anyOpt = leagueFilterSelect.options[0];
    if (anyOpt && e.target === leagueFilterSelect) {
      const clickedAny = anyOpt.selected && getSelectedLeagues().length === 0;
      if (clickedAny) {
        // "Any" was just (re)selected — deselect everything else
        Array.from(leagueFilterSelect.options).forEach(o => {
          o.selected = o.value === '';
        });
      } else if (getSelectedLeagues().length > 0) {
        // A specific league was selected — deselect "Any"
        anyOpt.selected = false;
      } else {
        // Nothing selected — fall back to "Any"
        anyOpt.selected = true;
      }
    }
    updateView();
  });
}

// ========================================
// PLAYER PROFILE FUNCTIONALITY
// ========================================

/**
 * Render the player profile card
 */
const renderPlayerProfile = (playerName) => {
  if (!playerName || !profileNumber) return;
  
  const profile = window.basketStatData.getPlayerProfile(playerName);
  
  // Update number
  profileNumber.textContent = profile.number ? `#${profile.number}` : '#—';
  
  // Update position
  if (profilePosition) {
    profilePosition.textContent = profile.position || '—';
  }
  
  // Update height (in meters)
  if (profileHeight) {
    profileHeight.textContent = profile.height ? `${profile.height}m` : '—';
  }
  
  // Update age (calculated from birthdate)
  if (profileAge) {
    const age = window.basketStatData.calculateAge(profile.birthdate);
    profileAge.textContent = age !== null ? `${age}y` : '—';
  }
};

/**
 * Open the profile edit modal
 */
const openProfileModal = () => {
  const playerName = playerSelect.value;
  if (!playerName) return;
  
  const profile = window.basketStatData.getPlayerProfile(playerName);
  
  // Populate form fields
  if (editHeight) editHeight.value = profile.height || '';
  if (editPosition) editPosition.value = profile.position || '';
  if (editBirthdate) editBirthdate.value = profile.birthdate || '';
  
  // Show modal
  if (profileModal) {
    profileModal.style.display = 'flex';
  }
};

/**
 * Close the profile edit modal
 */
const closeProfileModal = () => {
  if (profileModal) {
    profileModal.style.display = 'none';
  }
};

/**
 * Sync data to cloud via server proxy (keeps API key hidden)
 */
const syncToCloud = async () => {
  try {
    // Check if cloud is configured via proxy
    const statusResponse = await fetch('/api/cloud/status');
    const status = await statusResponse.json();
    
    if (!status.configured) {
      console.log("Cloud not configured");
      return false;
    }
    
    const localData = window.basketStatData.loadData();
    
    const response = await fetch('/api/cloud/data', {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(localData)
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      console.warn("Cloud sync failed:", error.message || response.status);
      return false;
    }
    
    console.log("✓ Synced to cloud");
    return true;
  } catch (error) {
    console.warn("Cloud sync error:", error.message);
    return false;
  }
};

/**
 * Save the player profile
 */
const savePlayerProfile = async () => {
  const playerName = playerSelect.value;
  if (!playerName) return;
  
  const updates = {};
  
  // Get height value
  if (editHeight && editHeight.value) {
    const height = parseFloat(editHeight.value);
    if (!isNaN(height) && height >= 1.0 && height <= 2.5) {
      updates.height = Math.round(height * 100) / 100; // Round to 2 decimal places
    }
  } else {
    updates.height = null;
  }
  
  // Get position value
  if (editPosition) {
    updates.position = editPosition.value || null;
  }
  
  // Get birthdate value
  if (editBirthdate) {
    updates.birthdate = editBirthdate.value || null;
  }
  
  // Save to data layer (localStorage)
  window.basketStatData.updatePlayer(playerName, updates);
  
  // Sync to cloud
  await syncToCloud();
  
  // Re-render profile
  renderPlayerProfile(playerName);
  
  // Close modal
  closeProfileModal();
};

// Profile event listeners
if (profileEditBtn) {
  profileEditBtn.addEventListener('click', openProfileModal);
}

if (cancelProfileBtn) {
  cancelProfileBtn.addEventListener('click', closeProfileModal);
}

if (saveProfileBtn) {
  saveProfileBtn.addEventListener('click', savePlayerProfile);
}

// Close modal on backdrop click
if (profileModal) {
  profileModal.addEventListener('click', (e) => {
    if (e.target === profileModal) {
      closeProfileModal();
    }
  });
}

// ========================================
// MULTI-PROVIDER AI INTEGRATION
// ========================================
// Supports: Groq (recommended), Google Gemini
// Groq free tier: 30 RPM, 14,400 RPD - much more generous than Gemini

const AI_STORAGE_KEY = 'basketstat-ai-key';
const AI_PROVIDER_KEY = 'basketstat-ai-provider';
const AI_CACHE_KEY = 'basketstat-ai-cache';
const AI_CACHE_TTL = 30 * 60 * 1000; // 30 minutes cache TTL

// Rate limiting protection
let isGenerating = false;
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 3000; // 3 seconds between requests
let handoutIsReady = false;

/**
 * Simple hash function for cache keys
 */
const hashString = (str) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36);
};

/**
 * Get cached AI response
 */
const getCachedResponse = (cacheKey) => {
  try {
    const cache = JSON.parse(sessionStorage.getItem(AI_CACHE_KEY) || '{}');
    const entry = cache[cacheKey];
    if (entry && Date.now() - entry.timestamp < AI_CACHE_TTL) {
      console.log('[AI] Using cached response');
      return entry.response;
    }
  } catch (e) {
    console.warn('Cache read error:', e);
  }
  return null;
};

/**
 * Save AI response to cache
 */
const setCachedResponse = (cacheKey, response) => {
  try {
    const cache = JSON.parse(sessionStorage.getItem(AI_CACHE_KEY) || '{}');
    // Clean old entries
    const now = Date.now();
    Object.keys(cache).forEach(key => {
      if (now - cache[key].timestamp > AI_CACHE_TTL) {
        delete cache[key];
      }
    });
    cache[cacheKey] = { response, timestamp: now };
    sessionStorage.setItem(AI_CACHE_KEY, JSON.stringify(cache));
  } catch (e) {
    console.warn('Cache write error:', e);
  }
};

/**
 * Sleep utility for retry backoff
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Provider configurations
const AI_PROVIDERS = {
  groq: {
    name: 'Groq',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    model: 'llama-3.3-70b-versatile', // Fast, high quality, free
    helpUrl: 'https://console.groq.com/keys',
    helpText: 'Get free key at console.groq.com',
    type: 'openai' // OpenAI-compatible API format
  },
  openai: {
    name: 'OpenAI',
    url: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini', // Most cost-effective, great quality
    helpUrl: 'https://platform.openai.com/api-keys',
    helpText: 'Get key at platform.openai.com',
    type: 'openai'
  },
  anthropic: {
    name: 'Anthropic',
    url: 'https://api.anthropic.com/v1/messages',
    model: 'claude-sonnet-4-0',
    helpUrl: 'https://console.anthropic.com/settings/keys',
    helpText: 'Get key at console.anthropic.com',
    type: 'anthropic'
  },
  gemini: {
    name: 'Google Gemini',
    url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
    model: 'gemini-2.0-flash',
    helpUrl: 'https://aistudio.google.com/app/apikey',
    helpText: 'Get free key at aistudio.google.com',
    type: 'gemini'
  }
};

// AI DOM elements
const aiSettingsToggle = document.getElementById('aiSettingsToggle');
const aiSettings = document.getElementById('aiSettings');
const aiProviderSelect = document.getElementById('aiProvider');
const aiApiKeyInput = document.getElementById('aiApiKey');
const apiKeyHelp = document.getElementById('apiKeyHelp');
const saveApiKeyBtn = document.getElementById('saveApiKey');
const generateAiBtn = document.getElementById('generateAiInsight');
const aiStatusText = document.getElementById('aiStatusText');
const aiStatus = document.getElementById('aiStatus');
const aiInsightText = document.getElementById('aiInsightText');
const aiHandoutLocked = document.getElementById('aiHandoutLocked');
const aiHandoutControls = document.getElementById('aiHandoutControls');
const aiHandoutPeriod = document.getElementById('aiHandoutPeriod');
const generateAiHandoutBtn = document.getElementById('generateAiHandout');
const printAiHandoutBtn = document.getElementById('printAiHandout');
const aiHandoutStatus = document.getElementById('aiHandoutStatus');
const aiHandoutOutput = document.getElementById('aiHandoutOutput');

/**
 * Get current provider
 */
const getProvider = () => {
  // Check localStorage first (persisted), then sessionStorage
  return localStorage.getItem(AI_PROVIDER_KEY) || sessionStorage.getItem(AI_PROVIDER_KEY) || 'groq';
};

/**
 * Set provider
 */
const setProvider = (provider) => {
  // Always save provider to sessionStorage
  sessionStorage.setItem(AI_PROVIDER_KEY, provider);
  // If "remember" is checked, also save to localStorage
  const rememberCheckbox = document.getElementById('rememberApiKey');
  if (rememberCheckbox?.checked || localStorage.getItem(`${AI_STORAGE_KEY}-remembered`)) {
    localStorage.setItem(AI_PROVIDER_KEY, provider);
  }
};

/**
 * Check if API key is remembered (stored in localStorage)
 */
const isApiKeyRemembered = () => {
  const provider = getProvider();
  return !!localStorage.getItem(`${AI_STORAGE_KEY}-${provider}`);
};

/**
 * Load API key from storage (checks localStorage first, then sessionStorage)
 */
const loadApiKey = () => {
  const provider = getProvider();
  // Check localStorage first (remembered), then sessionStorage (current session)
  return localStorage.getItem(`${AI_STORAGE_KEY}-${provider}`) || 
         sessionStorage.getItem(`${AI_STORAGE_KEY}-${provider}`) || '';
};

/**
 * Save API key to storage
 * @param {string} key - The API key to save
 * @param {boolean} remember - Whether to persist in localStorage
 */
const saveApiKeyToStorage = (key, remember = false) => {
  const provider = getProvider();
  
  if (key) {
    if (remember) {
      // Save to localStorage (persists across sessions)
      localStorage.setItem(`${AI_STORAGE_KEY}-${provider}`, key);
      localStorage.setItem(`${AI_STORAGE_KEY}-remembered`, 'true');
      localStorage.setItem(AI_PROVIDER_KEY, provider);
      // Clear from sessionStorage to avoid duplication
      sessionStorage.removeItem(`${AI_STORAGE_KEY}-${provider}`);
    } else {
      // Save to sessionStorage only (cleared on tab close)
      sessionStorage.setItem(`${AI_STORAGE_KEY}-${provider}`, key);
      // Clear from localStorage if previously remembered
      localStorage.removeItem(`${AI_STORAGE_KEY}-${provider}`);
    }
  } else {
    // Clear from both storages
    sessionStorage.removeItem(`${AI_STORAGE_KEY}-${provider}`);
    localStorage.removeItem(`${AI_STORAGE_KEY}-${provider}`);
  }
};

/**
 * Clear remembered API key from localStorage
 */
const forgetApiKey = () => {
  const provider = getProvider();
  localStorage.removeItem(`${AI_STORAGE_KEY}-${provider}`);
  localStorage.removeItem(`${AI_STORAGE_KEY}-remembered`);
  localStorage.removeItem(AI_PROVIDER_KEY);
};

/**
 * Update provider help text
 */
const updateProviderHelp = () => {
  if (!apiKeyHelp || !aiProviderSelect) return;
  const provider = AI_PROVIDERS[aiProviderSelect.value];
  apiKeyHelp.innerHTML = `Get free key at <a href="${provider.helpUrl}" target="_blank">${provider.helpUrl.replace('https://', '')}</a>`;
};

/**
 * Update AI status UI
 */
const updateAiStatus = () => {
  const hasKey = !!loadApiKey();
  const provider = AI_PROVIDERS[getProvider()];
  
  if (hasKey) {
    aiStatusText.textContent = `✓ ${provider.name} configured`;
    aiStatus.className = 'ai-status connected';
    generateAiBtn.disabled = false;
  } else {
    aiStatusText.textContent = 'Configure API key to enable AI coaching';
    aiStatus.className = 'ai-status';
    generateAiBtn.disabled = true;
  }

  if (generateAiHandoutBtn) {
    generateAiHandoutBtn.disabled = !hasKey;
  }
  if (aiHandoutLocked) {
    aiHandoutLocked.hidden = hasKey;
  }
  if (aiHandoutControls) {
    aiHandoutControls.hidden = !hasKey;
  }
  if (!hasKey) {
    clearAiHandout('Connect an AI provider to unlock the printable player handout.');
  } else if (!handoutIsReady && (!aiHandoutOutput || !aiHandoutOutput.innerHTML.trim())) {
    clearAiHandout('Generate a player handout for the selected player.');
  }
};

/**
 * Build context for AI from player data
 */
const buildAiContext = (playerName, records, windowSize) => {
  const analysis = analyzePlayerPerformance(records, windowSize);
  const stats = getAvailableStats(records);
  
  // Get player profile info
  const profile = window.basketStatData.getPlayerProfile(playerName);
  const playerAge = window.basketStatData.calculateAge(profile.birthdate);
  
  // Build detailed stats summary
  let statsContext = [];
  stats.forEach(stat => {
    const validRecords = records.filter(r => window.basketStatData.hasValidStatValue(r.stats[stat]));
    if (validRecords.length < 2) return;
    
    const values = validRecords.map(r => getNumericStatValue(r.stats[stat]));
    const recentValues = values.slice(-windowSize);
    const avg = recentValues.reduce((a, b) => a + b, 0) / recentValues.length;
    const refStat = window.referenceStats?.getStatReference(stat);
    const perfLevel = window.referenceStats?.getPerformanceLevel(stat, avg) || 'average';
    
    statsContext.push({
      stat: getStatDisplayName(stat),
      key: stat,
      avg: avg.toFixed(1),
      level: perfLevel,
      benchmark: refStat ? { p50: refStat.p50, p75: refStat.p75, p90: refStat.p90 } : null,
      recent: recentValues.slice(-3).map(v => v.toFixed(1)).join(', ')
    });
  });
  
  // Build game history summary
  const recentGames = records.slice(-windowSize).map(r => ({
    date: r.date,
    opponent: r.opponent,
    pts: getNumericStatValue(r.stats.pts),
    fg: r.stats.fg ? `${r.stats.fg.made}-${r.stats.fg.attempted}` : '-',
    asst: getNumericStatValue(r.stats.asst),
    to: getNumericStatValue(r.stats.to)
  }));

  return {
    player: playerName,
    age: playerAge,
    height: profile.height,
    position: profile.position,
    ageGroup: 'U14-U16 (14-16 years old)',
    league: 'Norwegian junior basketball (1. divisjon)',
    windowSize,
    totalGames: records.length,
    stats: statsContext,
    recentGames,
    strengths: analysis.strengths.map(s => ({ stat: getStatDisplayName(s.stat), level: s.level })),
    weaknesses: analysis.weaknesses.map(w => ({ stat: getStatDisplayName(w.stat), level: w.level })),
    improving: analysis.improving.map(i => ({ stat: getStatDisplayName(i.stat), change: `+${i.changePercent}%` })),
    declining: analysis.declining.map(d => ({ stat: getStatDisplayName(d.stat), change: `-${d.changePercent}%` })),
    hotStreaks: analysis.hotStreaks.map(h => getStatDisplayName(h.stat)),
    coldStreaks: analysis.coldStreaks.map(c => getStatDisplayName(c.stat))
  };
};

/**
 * Build the prompt for Gemini
 */
const buildGeminiPrompt = (context) => {
  // Build player profile string
  const profileParts = [];
  if (context.age) profileParts.push(`${context.age} years old`);
  if (context.height) profileParts.push(`${context.height}m tall`);
  if (context.position) {
    const positionNames = { PG: 'Point Guard', SG: 'Shooting Guard', SF: 'Small Forward', PF: 'Power Forward', C: 'Center' };
    profileParts.push(positionNames[context.position] || context.position);
  }
  const profileStr = profileParts.length > 0 ? `PLAYER PROFILE: ${profileParts.join(', ')}\n` : '';

  return `You are an experienced youth basketball coach providing analysis for a player. Be encouraging but honest. Focus on actionable advice.

PLAYER: ${context.player}
${profileStr}AGE GROUP: ${context.ageGroup}
LEAGUE: ${context.league}
ANALYSIS WINDOW: Last ${context.windowSize} games (${context.totalGames} total games played)

CURRENT PERFORMANCE BY CATEGORY:
${context.stats.map(s => `- ${s.stat}: ${s.avg} avg (${s.level} level)${s.benchmark ? ` [Benchmarks: avg=${s.benchmark.p50}, good=${s.benchmark.p75}, excellent=${s.benchmark.p90}]` : ''}`).join('\n')}

STRENGTHS (performing well vs benchmarks): ${context.strengths.length > 0 ? context.strengths.map(s => s.stat).join(', ') : 'None identified'}
AREAS TO DEVELOP: ${context.weaknesses.length > 0 ? context.weaknesses.map(w => w.stat).join(', ') : 'None identified'}
IMPROVING TRENDS: ${context.improving.length > 0 ? context.improving.map(i => `${i.stat} ${i.change}`).join(', ') : 'Stable'}
DECLINING TRENDS: ${context.declining.length > 0 ? context.declining.map(d => `${d.stat} ${d.change}`).join(', ') : 'None'}
HOT STREAKS: ${context.hotStreaks.length > 0 ? context.hotStreaks.join(', ') : 'None'}
COLD STREAKS: ${context.coldStreaks.length > 0 ? context.coldStreaks.join(', ') : 'None'}

RECENT GAME LOG:
${context.recentGames.map(g => `${g.date} vs ${g.opponent}: ${g.pts} pts, ${g.fg} FG, ${g.asst} ast, ${g.to} TO`).join('\n')}

Please provide a brief coaching analysis (3-4 short paragraphs) that includes:
1. Overall assessment - how is the player performing for their age group?${context.position ? ' Consider their position.' : ''}
2. Key strengths to build on and how to leverage them${context.height ? ' (consider their height)' : ''}
3. One or two specific areas to focus on improving, with a simple drill or practice tip
4. Motivational closing with realistic short-term goal

Keep the tone positive and age-appropriate. Be specific to the data provided.`;
};

/**
 * Call OpenAI-compatible API with retry logic
 */
const callOpenAiCompatibleApi = async (prompt, apiKey, config, retryCount = 0) => {
  const MAX_RETRIES = 3;
  const BASE_DELAY = 2000; // 2 seconds
  
  try {
    const response = await fetch(config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: 'You are a helpful youth basketball coach providing analysis and advice for junior players (ages 14-16). Be encouraging, specific, and age-appropriate.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 1024
      })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const errorMsg = error.error?.message || error.message || '';
      
      console.error(`[AI] ${config.name} error:`, response.status, errorMsg);
      
      // Rate limit - retry with exponential backoff
      if (response.status === 429 && retryCount < MAX_RETRIES) {
        const retryAfter = parseInt(response.headers.get('retry-after') || '0') * 1000;
        const delay = Math.max(retryAfter, BASE_DELAY * Math.pow(2, retryCount));
        console.log(`[AI] Rate limited. Retrying in ${delay/1000}s (attempt ${retryCount + 1}/${MAX_RETRIES})`);
        await sleep(delay);
        return callOpenAiCompatibleApi(prompt, apiKey, config, retryCount + 1);
      }
      
      if (response.status === 401) {
        throw new Error(`[${config.name}] Invalid API key. Please check your API key.`);
      }
      if (response.status === 429) {
        throw new Error(`[${config.name}] Rate limit exceeded. Please wait 1-2 minutes or switch to Groq (more generous limits).`);
      }
      if (response.status === 402 || errorMsg.includes('billing') || errorMsg.includes('quota')) {
        throw new Error(`[${config.name}] Billing/quota issue. Check your account balance or try Groq (free tier).`);
      }
      if (errorMsg.toLowerCase().includes('token')) {
        throw new Error(`[${config.name}] Token error: ${errorMsg}`);
      }
      throw new Error(`[${config.name}] ${errorMsg || `API error: ${response.status}`}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || 'No response generated';
  } catch (error) {
    // Network errors - retry
    if (error.name === 'TypeError' && retryCount < MAX_RETRIES) {
      const delay = BASE_DELAY * Math.pow(2, retryCount);
      console.log(`[AI] Network error. Retrying in ${delay/1000}s...`);
      await sleep(delay);
      return callOpenAiCompatibleApi(prompt, apiKey, config, retryCount + 1);
    }
    throw error;
  }
};

/**
 * Call Gemini API with retry logic
 */
const callGeminiApi = async (prompt, apiKey, config, retryCount = 0) => {
  const MAX_RETRIES = 3;
  const BASE_DELAY = 2000;
  
  try {
    const response = await fetch(`${config.url}?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }]
        }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1024,
        }
      })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const errorMsg = error.error?.message || error.message || '';
      
      console.error('[AI] Gemini error:', response.status, errorMsg);
      
      // Rate limit - retry with exponential backoff
      if (response.status === 429 && retryCount < MAX_RETRIES) {
        const delay = BASE_DELAY * Math.pow(2, retryCount);
        console.log(`[AI] Rate limited. Retrying in ${delay/1000}s (attempt ${retryCount + 1}/${MAX_RETRIES})`);
        await sleep(delay);
        return callGeminiApi(prompt, apiKey, config, retryCount + 1);
      }
      
      if (response.status === 400) {
        if (errorMsg.toLowerCase().includes('api key')) {
          throw new Error('[Gemini] Invalid API key. Please check your API key.');
        }
        throw new Error(`[Gemini] Request error: ${errorMsg || 'Bad request'}`);
      }
      if (response.status === 404 || errorMsg.includes('not found')) {
        throw new Error('[Gemini] Model not available. Google may have updated their API.');
      }
      if (response.status === 403) {
        throw new Error('[Gemini] Access denied. Your API key may not have access to this model.');
      }
      if (response.status === 429) {
        throw new Error('[Gemini] Rate limit exceeded. Please wait 1-2 minutes or switch to Groq (more generous limits).');
      }
      if (errorMsg.toLowerCase().includes('token')) {
        throw new Error(`[Gemini] Token error: ${errorMsg}`);
      }
      throw new Error(`[Gemini] ${errorMsg || `API error: ${response.status}`}`);
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response generated';
  } catch (error) {
    // Network errors - retry
    if (error.name === 'TypeError' && retryCount < MAX_RETRIES) {
      const delay = BASE_DELAY * Math.pow(2, retryCount);
      console.log(`[AI] Network error. Retrying in ${delay/1000}s...`);
      await sleep(delay);
      return callGeminiApi(prompt, apiKey, config, retryCount + 1);
    }
    throw error;
  }
};

const callAnthropicApi = async (prompt, apiKey, config, retryCount = 0) => {
  const MAX_RETRIES = 3;
  const BASE_DELAY = 2000;

  try {
    const response = await fetch(config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: 1024,
        temperature: 0.7,
        messages: [
          { role: 'user', content: prompt }
        ]
      })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const errorMsg = error.error?.message || error.message || '';

      console.error('[AI] Anthropic error:', response.status, errorMsg);

      if (response.status === 429 && retryCount < MAX_RETRIES) {
        const retryAfter = parseInt(response.headers.get('retry-after') || '0', 10) * 1000;
        const delay = Math.max(retryAfter, BASE_DELAY * Math.pow(2, retryCount));
        console.log(`[AI] Rate limited. Retrying in ${delay / 1000}s (attempt ${retryCount + 1}/${MAX_RETRIES})`);
        await sleep(delay);
        return callAnthropicApi(prompt, apiKey, config, retryCount + 1);
      }

      if (response.status === 401) {
        throw new Error('[Anthropic] Invalid API key. Please check your API key.');
      }
      if (response.status === 403) {
        throw new Error('[Anthropic] Access denied. Check workspace access and API key permissions.');
      }
      if (response.status === 429) {
        throw new Error('[Anthropic] Rate limit exceeded. Please wait a minute and try again.');
      }
      if (errorMsg.toLowerCase().includes('credit') || errorMsg.toLowerCase().includes('billing')) {
        throw new Error(`[Anthropic] Billing/quota issue. ${errorMsg}`);
      }
      throw new Error(`[Anthropic] ${errorMsg || `API error: ${response.status}`}`);
    }

    const data = await response.json();
    return data.content?.map(part => part.text || '').join('\n').trim() || 'No response generated';
  } catch (error) {
    if (error.name === 'TypeError' && retryCount < MAX_RETRIES) {
      const delay = BASE_DELAY * Math.pow(2, retryCount);
      console.log(`[AI] Network error. Retrying in ${delay / 1000}s...`);
      await sleep(delay);
      return callAnthropicApi(prompt, apiKey, config, retryCount + 1);
    }
    throw error;
  }
};

/**
 * Call AI API (routes to correct provider based on type)
 */
const callAiApi = async (prompt) => {
  const apiKey = loadApiKey();
  const providerKey = getProvider();
  const config = AI_PROVIDERS[providerKey];
  
  if (!apiKey) {
    throw new Error(`[${config.name}] No API key configured. Click the gear icon to add your key.`);
  }
  
  // Basic key validation
  if (apiKey.length < 10) {
    throw new Error(`[${config.name}] Invalid API key format. Please re-enter your API key.`);
  }

  console.log(`[AI] Calling ${config.name} API...`);

  // Route based on API type
  if (config.type === 'openai') {
    return callOpenAiCompatibleApi(prompt, apiKey, config);
  } else if (config.type === 'anthropic') {
    return callAnthropicApi(prompt, apiKey, config);
  } else if (config.type === 'gemini') {
    return callGeminiApi(prompt, apiKey, config);
  } else {
    throw new Error(`Unknown provider type: ${config.type}`);
  }
};

/**
 * Generate AI insight with caching and debouncing
 */
const generateAiInsight = async () => {
  // Debounce: prevent rapid consecutive requests
  if (isGenerating) {
    console.log('[AI] Request already in progress, ignoring');
    return;
  }
  
  const now = Date.now();
  if (now - lastRequestTime < MIN_REQUEST_INTERVAL) {
    const waitTime = Math.ceil((MIN_REQUEST_INTERVAL - (now - lastRequestTime)) / 1000);
    aiInsightText.innerHTML = `<p style="color: var(--text-muted);">Please wait ${waitTime}s before requesting again...</p>`;
    aiInsightText.classList.add('visible');
    return;
  }
  
  const playerName = playerSelect.value;
  const windowSize = parseInt(windowSizeSelect?.value || '5', 10);
  const data = buildData();
  const records = data.filter(r => r.player === playerName);
  
  if (records.length < 3) {
    aiInsightText.innerHTML = '<p>Need at least 3 games for AI analysis.</p>';
    aiInsightText.classList.add('visible');
    return;
  }

  // Generate cache key based on player, window, and data hash
  const provider = getProvider();
  const dataHash = hashString(JSON.stringify(records.slice(-windowSize).map(r => r.stats)));
  const cacheKey = `player_${playerName}_${windowSize}_${provider}_${dataHash}`;
  
  // Check cache first
  const cachedResponse = getCachedResponse(cacheKey);
  if (cachedResponse) {
    const formattedResponse = formatAiText(cachedResponse);
    aiInsightText.innerHTML = `<div class="cache-indicator" style="font-size: 11px; color: var(--text-muted); margin-bottom: 12px;">📋 Cached response (${Math.round(AI_CACHE_TTL/60000)}min)</div>${formattedResponse}`;
    aiInsightText.classList.add('visible');
    return;
  }

  // Show loading state
  isGenerating = true;
  lastRequestTime = now;
  generateAiBtn.classList.add('loading');
  generateAiBtn.disabled = true;
  aiInsightText.innerHTML = '';
  aiInsightText.classList.remove('visible');

  try {
    const context = buildAiContext(playerName, records, windowSize);
    const prompt = buildGeminiPrompt(context);
    const response = await callAiApi(prompt);
    
    // Cache the response
    setCachedResponse(cacheKey, response);
    
    // Format the response
    const formattedResponse = formatAiText(response);
    
    aiInsightText.innerHTML = formattedResponse;
    aiInsightText.classList.add('visible');
  } catch (error) {
    console.error('AI generation error:', error);
    aiInsightText.innerHTML = `<p style="color: var(--negative);">Error: ${error.message}</p>`;
    aiInsightText.classList.add('visible');
    
    if (error.message.includes('API key')) {
      aiStatus.className = 'ai-status error';
      aiStatusText.textContent = '✗ Invalid API key';
    }
  } finally {
    isGenerating = false;
    generateAiBtn.classList.remove('loading');
    generateAiBtn.disabled = false;
  }
};

const generateAiHandout = async () => {
  if (isGenerating) {
    setAiHandoutStatus('Another AI request is already running.', 'neutral');
    return;
  }

  const now = Date.now();
  if (now - lastRequestTime < MIN_REQUEST_INTERVAL) {
    const waitTime = Math.ceil((MIN_REQUEST_INTERVAL - (now - lastRequestTime)) / 1000);
    setAiHandoutStatus(`Please wait ${waitTime}s before requesting again.`, 'neutral');
    return;
  }

  const playerName = playerSelect?.value;
  if (!playerName) {
    setAiHandoutStatus('Select a player first.', 'error');
    return;
  }

  const data = buildData();
  const playerRecords = data.filter(record => record.player === playerName);
  const periodKey = aiHandoutPeriod?.value || '6m';
  const context = buildPlayerHandoutContext(playerName, playerRecords, periodKey);

  if (context.filteredRecords.length < 2) {
    clearAiHandout('Need at least 2 games in the selected period to build a useful handout.');
    setAiHandoutStatus('Not enough games in the selected period.', 'error');
    return;
  }

  const provider = getProvider();
  const dataHash = hashString(JSON.stringify({
    periodKey,
    records: context.filteredRecords.map(record => ({
      date: record.date,
      opponent: record.opponent,
      stats: record.stats
    }))
  }));
  const cacheKey = `handout_${playerName}_${periodKey}_${provider}_${dataHash}`;

  const cachedResponse = getCachedResponse(cacheKey);
  if (cachedResponse) {
    renderPlayerHandout(context, parseAiHandoutResponse(cachedResponse));
    setAiHandoutStatus('Loaded cached handout summary.', 'success');
    return;
  }

  isGenerating = true;
  lastRequestTime = now;
  if (generateAiHandoutBtn) {
    generateAiHandoutBtn.classList.add('loading');
    generateAiHandoutBtn.disabled = true;
  }
  if (printAiHandoutBtn) {
    printAiHandoutBtn.disabled = true;
  }
  setAiHandoutStatus('Generating printable player handout...', 'neutral');

  try {
    const prompt = buildPlayerHandoutPrompt(context);
    const response = await callAiApi(prompt);
    setCachedResponse(cacheKey, response);
    renderPlayerHandout(context, parseAiHandoutResponse(response));
    setAiHandoutStatus('Handout ready to print.', 'success');
  } catch (error) {
    console.error('AI handout generation error:', error);
    clearAiHandout('The handout could not be generated right now.');
    setAiHandoutStatus(error.message, 'error');
  } finally {
    isGenerating = false;
    if (generateAiHandoutBtn) {
      generateAiHandoutBtn.classList.remove('loading');
      generateAiHandoutBtn.disabled = !loadApiKey();
    }
  }
};

const printAiHandout = async () => {
  if (!handoutIsReady || !aiHandoutOutput?.innerHTML.trim()) {
    setAiHandoutStatus('Generate a handout before printing.', 'error');
    return;
  }

  document.body.classList.add('print-player-handout');
  window.print();
};

// AI event listeners
if (aiSettingsToggle) {
  aiSettingsToggle.addEventListener('click', () => {
    aiSettings.style.display = aiSettings.style.display === 'none' ? 'block' : 'none';
  });
}

if (aiProviderSelect) {
  // Set initial provider from storage
  const savedProvider = getProvider();
  aiProviderSelect.value = savedProvider;
  updateProviderHelp();
  
  // Handle provider change
  aiProviderSelect.addEventListener('change', () => {
    setProvider(aiProviderSelect.value);
    updateProviderHelp();
    updateAiStatus();
    // Clear the input since keys are per-provider
    if (aiApiKeyInput) {
      const hasKey = loadApiKey();
      aiApiKeyInput.placeholder = hasKey ? '••••••••••••••••' : 'Enter your API key';
    }
  });
}

if (saveApiKeyBtn) {
  saveApiKeyBtn.addEventListener('click', () => {
    const key = aiApiKeyInput.value.trim();
    const rememberCheckbox = document.getElementById('rememberApiKey');
    const remember = rememberCheckbox?.checked || false;
    
    saveApiKeyToStorage(key, remember);
    aiApiKeyInput.value = '';
    aiSettings.style.display = 'none';
    updateAiStatus();
  });
}

if (generateAiBtn) {
  generateAiBtn.addEventListener('click', generateAiInsight);
}

if (generateAiHandoutBtn) {
  generateAiHandoutBtn.addEventListener('click', generateAiHandout);
}

if (printAiHandoutBtn) {
  printAiHandoutBtn.addEventListener('click', printAiHandout);
}

if (aiHandoutPeriod) {
  aiHandoutPeriod.addEventListener('change', () => {
    clearAiHandout('Time period changed. Generate a fresh handout.');
  });
}

window.addEventListener('afterprint', () => {
  document.body.classList.remove('print-player-handout');
});

// Load saved API key on page load
if (aiApiKeyInput) {
  const savedKey = loadApiKey();
  if (savedKey) {
    aiApiKeyInput.placeholder = '••••••••••••••••';
  }
  
  // Set "remember" checkbox state if key is already in localStorage
  const rememberCheckbox = document.getElementById('rememberApiKey');
  if (rememberCheckbox) {
    rememberCheckbox.checked = isApiKeyRemembered();
  }
  
  updateAiStatus();
}

// ========================================
// AUTO-LOAD FROM CLOUD (if configured)
// ========================================

const autoLoadFromCloud = async () => {
  try {
    // Check cloud configuration via server proxy
    const statusResponse = await fetch('/api/cloud/status');
    const status = await statusResponse.json();
    
    // Check if auto-load is enabled and cloud is configured
    const config = window.CLOUD_CONFIG || {};
    if (!config.autoLoadOnStart || !status.configured) {
      return false;
    }
    
    console.log("Auto-loading data from cloud...");
    
    const response = await fetch('/api/cloud/data', {
      method: "GET"
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      console.warn("Cloud load failed:", error.message || response.status);
      return false;
    }
    
    const result = await response.json();
    const cloudData = result.record;
    
    if (cloudData && cloudData.games && Array.isArray(cloudData.games)) {
      window.basketStatData.saveData(cloudData);
      console.log(`Loaded ${cloudData.games.length} games from cloud`);
      return true;
    }
  } catch (error) {
    console.warn("Cloud auto-load error:", error.message);
  }
  
  return false;
};

// Hide loading overlay
const hideLoading = () => {
  const overlay = document.getElementById('loadingOverlay');
  if (overlay) {
    overlay.classList.add('hidden');
    // Remove from DOM after transition
    setTimeout(() => {
      overlay.style.display = 'none';
    }, 300);
  }
};

// Initialize the app (with optional cloud load)
(async () => {
  // Try to auto-load from cloud first
  const loadedFromCloud = await autoLoadFromCloud();
  
  if (loadedFromCloud) {
    console.log("Data loaded from cloud, initializing...");
  }
  
  // Initialize the app
  init();
  
  // Hide loading overlay after init completes
  hideLoading();
})();
