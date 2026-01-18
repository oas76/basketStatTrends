const playerSelect = document.getElementById("playerSelect");
const statSelect = document.getElementById("statSelect");
const windowSizeSelect = document.getElementById("windowSize");
const scorecardGrid = document.getElementById("scorecardGrid");
const chart = document.getElementById("chart");
const insightText = document.getElementById("insightText");
const gameTable = document.getElementById("gameTable");
const statHeader = document.getElementById("statHeader");

const formatDate = (value) => new Date(value).toLocaleDateString();

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
 * For made-attempted, returns the "made" value
 */
const getNumericStat = (value) => {
  if (value === null || value === undefined) return 0;
  if (typeof value === "object" && "made" in value) {
    return value.made;
  }
  return Number(value) || 0;
};

const buildData = () => {
  const { games } = window.basketStatData.loadData();
  return games
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
const HIDDEN_STATS = ['min', '+/-'];

// Stat display order
const STAT_ORDER = ['pts', 'fg', 'fg%', '3pt', '3pt%', 'ft', 'ft%', 'oreb', 'dreb', 'asst', 'stl', 'blk', 'to', 'foul', 'a/to'];

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
 */
const calculateWindowedStats = (records, stat, windowSize) => {
  // Filter to records with valid stat values
  const validRecords = records.filter(r => hasValidStatValue(r.stats[stat]));
  const values = validRecords.map(r => getNumericStat(r.stats[stat]));
  
  if (values.length === 0) {
    return null;
  }
  
  // Current window (last N games)
  const currentWindow = values.slice(-windowSize);
  // Previous window (N games before current window)
  const prevWindow = values.slice(-windowSize * 2, -windowSize);
  
  if (currentWindow.length === 0) {
    return null;
  }
  
  // Calculate current window stats
  const currentAvg = currentWindow.reduce((a, b) => a + b, 0) / currentWindow.length;
  const sortedCurrent = [...currentWindow].sort((a, b) => a - b);
  const currentMedian = sortedCurrent.length % 2 === 0
    ? (sortedCurrent[sortedCurrent.length / 2 - 1] + sortedCurrent[sortedCurrent.length / 2]) / 2
    : sortedCurrent[Math.floor(sortedCurrent.length / 2)];
  const currentMax = Math.max(...currentWindow);
  const currentMin = Math.min(...currentWindow);
  
  // Calculate previous window stats (if available)
  let prevAvg = null;
  let prevMedian = null;
  let prevMax = null;
  let prevMin = null;
  
  if (prevWindow.length >= 3) {
    prevAvg = prevWindow.reduce((a, b) => a + b, 0) / prevWindow.length;
    const sortedPrev = [...prevWindow].sort((a, b) => a - b);
    prevMedian = sortedPrev.length % 2 === 0
      ? (sortedPrev[sortedPrev.length / 2 - 1] + sortedPrev[sortedPrev.length / 2]) / 2
      : sortedPrev[Math.floor(sortedPrev.length / 2)];
    prevMax = Math.max(...prevWindow);
    prevMin = Math.min(...prevWindow);
  }
  
  // Calculate trends
  const avgTrend = prevAvg !== null ? currentAvg - prevAvg : 0;
  const medianTrend = prevMedian !== null ? currentMedian - prevMedian : 0;
  const varianceTrend = prevMax !== null && prevMin !== null 
    ? ((currentMax - currentMin) - (prevMax - prevMin)) 
    : 0;
  
  return {
    gamesInWindow: currentWindow.length,
    totalGames: values.length,
    average: currentAvg,
    avgTrend,
    median: currentMedian,
    medianTrend,
    max: currentMax,
    min: currentMin,
    varianceTrend,
    hasPrevWindow: prevWindow.length >= 3
  };
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
 * Render the player scorecard
 */
const renderScorecard = (records, player, windowSize) => {
  const playerRecords = records.filter(r => r.player === player);
  const stats = getAvailableStats(playerRecords);
  const selectedStat = statSelect.value || stats[0] || 'pts';
  
  if (playerRecords.length === 0) {
    scorecardGrid.innerHTML = '<div class="no-data-message">No games recorded for this player</div>';
    return;
  }
  
  scorecardGrid.innerHTML = stats.map(stat => {
    const ws = calculateWindowedStats(playerRecords, stat, windowSize);
    
    if (!ws) {
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
    
    const perfLevel = window.referenceStats?.getPerformanceLevel(stat, ws.average) || 'average';
    const avgTrend = getTrendIndicator(ws.avgTrend);
    const medianTrend = getTrendIndicator(ws.medianTrend);
    const varianceTrend = getTrendIndicator(ws.varianceTrend, 1);
    
    // For inverted stats (TO, foul), flip the trend colors
    const refStat = window.referenceStats?.getStatReference(stat);
    const isInverted = refStat?.invertedScale;
    const avgTrendClass = isInverted ? (avgTrend.class === 'up' ? 'down' : avgTrend.class === 'down' ? 'up' : 'neutral') : avgTrend.class;
    const medTrendClass = isInverted ? (medianTrend.class === 'up' ? 'down' : medianTrend.class === 'down' ? 'up' : 'neutral') : medianTrend.class;
    
    return `
      <div class="stat-scorecard ${stat === selectedStat ? 'active' : ''}" data-stat="${stat}">
        <div class="stat-scorecard-header">
          <span class="stat-scorecard-name">${stat}</span>
          <span class="stat-scorecard-avg perf-${perfLevel}">
            ${ws.average.toFixed(1)}
            ${ws.hasPrevWindow ? `<span class="stat-scorecard-trend ${avgTrendClass}">${avgTrend.icon}</span>` : ''}
          </span>
        </div>
        <div class="stat-scorecard-details">
          <div class="stat-detail">
            <span class="stat-detail-label">Median</span>
            <span class="stat-detail-value">
              ${ws.median.toFixed(1)}
              ${ws.hasPrevWindow ? `<span class="stat-detail-trend ${medTrendClass}">${medianTrend.icon}</span>` : ''}
            </span>
          </div>
          <div class="stat-detail">
            <span class="stat-detail-label">Range</span>
            <span class="stat-detail-value">
              <span class="variance-range">
                <span class="low">${ws.min}</span> – <span class="high">${ws.max}</span>
              </span>
              ${ws.hasPrevWindow ? `<span class="stat-detail-trend ${varianceTrend.class}">${varianceTrend.icon}</span>` : ''}
            </span>
          </div>
        </div>
        <div style="font-size: 9px; color: var(--text-muted); margin-top: 6px;">
          ${ws.gamesInWindow} of ${ws.totalGames} games
        </div>
      </div>
    `;
  }).join('');
  
  // Add click handlers
  scorecardGrid.querySelectorAll('.stat-scorecard').forEach(card => {
    card.addEventListener('click', () => {
      const stat = card.dataset.stat;
      statSelect.value = stat;
      scorecardGrid.querySelectorAll('.stat-scorecard').forEach(c => c.classList.remove('active'));
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
 * Check if a stat value is meaningful (not null, not empty, has actual data)
 * For made-attempted stats, requires at least 1 attempt
 * For percentages, requires a non-null value
 */
const hasValidStatValue = (statValue) => {
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
  const validRecords = records.filter(record => hasValidStatValue(record.stats[stat]));
  
  if (validRecords.length === 0) {
    chart.innerHTML = "<p>No data for this stat</p>";
    return;
  }

  const values = validRecords.map((record) => getNumericStat(record.stats[stat]));
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

const renderInsight = (records, stat) => {
  if (records.length < 2) {
    insightText.textContent = "Need at least 2 games for trend analysis";
    return;
  }

  const windowSize = parseInt(windowSizeSelect?.value || '5', 10);
  const values = records.map((record) => getNumericStat(record.stats[stat]));
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  
  // Use window size for recent games
  const recent = values.slice(-windowSize);
  const recentAverage = recent.reduce((sum, value) => sum + value, 0) / recent.length;
  const trend = recentAverage - average;
  
  // Get reference stats for context
  const refStat = window.referenceStats?.getStatReference(stat);
  
  let refContext = '';
  if (refStat) {
    const diff = recentAverage - refStat.p50;
    const percentAbove = ((recentAverage / refStat.p50 - 1) * 100).toFixed(0);
    if (diff > 0) {
      refContext = ` Compared to U14-U16 benchmarks: ${Math.abs(percentAbove)}% above median.`;
    } else if (diff < 0) {
      refContext = ` Compared to U14-U16 benchmarks: ${Math.abs(percentAbove)}% below median.`;
    } else {
      refContext = ` Right at the U14-U16 median benchmark.`;
    }
  }

  if (trend > 0.5) {
    insightText.textContent = `↑ Trending up: Last ${recent.length} games averaging +${trend.toFixed(1)} ${stat} above season average (${average.toFixed(1)}).${refContext}`;
  } else if (trend < -0.5) {
    insightText.textContent = `↓ Trending down: Last ${recent.length} games ${stat} is ${Math.abs(trend).toFixed(1)} below season average (${average.toFixed(1)}).${refContext}`;
  } else {
    insightText.textContent = `→ Consistent: Last ${recent.length} games ${stat} matches season average of ${average.toFixed(1)}.${refContext}`;
  }
};

const updateChartAndTable = () => {
  const data = buildData();
  if (data.length === 0) return;
  
  const player = playerSelect.value;
  const stat = statSelect.value;
  const records = updateGameTable(data, player, stat);
  renderChart(records, stat);
  renderInsight(records, stat);
};

const updateView = () => {
  const data = buildData();
  if (data.length === 0) {
    return;
  }

  const player = playerSelect.value;
  const windowSize = parseInt(windowSizeSelect?.value || '5', 10);
  
  // Render scorecard for player
  renderScorecard(data, player, windowSize);
  
  // Update chart and table with selected stat
  updateChartAndTable();
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
  
  const data = buildData();
  if (data.length === 0) {
    playerSelect.innerHTML = "<option>—</option>";
    if (scorecardGrid) scorecardGrid.innerHTML = '<div class="no-data-message">No game data yet. Upload CSVs from the Admin page.</div>';
    chart.innerHTML = "<p>No game data yet</p>";
    insightText.textContent = "Upload game CSVs to see performance analysis";
    if (gameTable) gameTable.innerHTML = "";
    return;
  }

  // Store current selections to preserve them if possible
  const currentPlayer = playerSelect.value;
  const currentStat = statSelect.value;

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

init();
