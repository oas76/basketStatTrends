const playerSelect = document.getElementById("playerSelect");
const statSelect = document.getElementById("statSelect");
const windowSizeSelect = document.getElementById("windowSize");
const scorecardGrid = document.getElementById("scorecardGrid");
const chart = document.getElementById("chart");
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
    const validRecords = records.filter(r => hasValidStatValue(r.stats[stat]));
    if (validRecords.length < 2) return;
    
    const values = validRecords.map(r => getNumericStat(r.stats[stat]));
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

const updateChartAndTable = () => {
  const data = buildData();
  if (data.length === 0) return;
  
  const player = playerSelect.value;
  const stat = statSelect.value;
  const records = updateGameTable(data, player, stat);
  renderChart(records, stat);
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

// ========================================
// MULTI-PROVIDER AI INTEGRATION
// ========================================
// Supports: Groq (recommended), Google Gemini
// Groq free tier: 30 RPM, 14,400 RPD - much more generous than Gemini

const AI_STORAGE_KEY = 'basketstat-ai-key';
const AI_PROVIDER_KEY = 'basketstat-ai-provider';

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

/**
 * Get current provider
 */
const getProvider = () => {
  return sessionStorage.getItem(AI_PROVIDER_KEY) || 'groq';
};

/**
 * Set provider
 */
const setProvider = (provider) => {
  sessionStorage.setItem(AI_PROVIDER_KEY, provider);
};

/**
 * Load API key from session storage
 */
const loadApiKey = () => {
  const provider = getProvider();
  return sessionStorage.getItem(`${AI_STORAGE_KEY}-${provider}`) || '';
};

/**
 * Save API key to session storage
 */
const saveApiKeyToStorage = (key) => {
  const provider = getProvider();
  if (key) {
    sessionStorage.setItem(`${AI_STORAGE_KEY}-${provider}`, key);
  } else {
    sessionStorage.removeItem(`${AI_STORAGE_KEY}-${provider}`);
  }
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
};

/**
 * Build context for AI from player data
 */
const buildAiContext = (playerName, records, windowSize) => {
  const analysis = analyzePlayerPerformance(records, windowSize);
  const stats = getAvailableStats(records);
  
  // Build detailed stats summary
  let statsContext = [];
  stats.forEach(stat => {
    const validRecords = records.filter(r => hasValidStatValue(r.stats[stat]));
    if (validRecords.length < 2) return;
    
    const values = validRecords.map(r => getNumericStat(r.stats[stat]));
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
    pts: getNumericStat(r.stats.pts),
    fg: r.stats.fg ? `${r.stats.fg.made}-${r.stats.fg.attempted}` : '-',
    asst: getNumericStat(r.stats.asst),
    to: getNumericStat(r.stats.to)
  }));

  return {
    player: playerName,
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
  return `You are an experienced youth basketball coach providing analysis for a player. Be encouraging but honest. Focus on actionable advice.

PLAYER: ${context.player}
AGE GROUP: ${context.ageGroup}
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
1. Overall assessment - how is the player performing for their age group?
2. Key strengths to build on and how to leverage them
3. One or two specific areas to focus on improving, with a simple drill or practice tip
4. Motivational closing with realistic short-term goal

Keep the tone positive and age-appropriate. Be specific to the data provided.`;
};

/**
 * Call OpenAI-compatible API (works for OpenAI, Groq, and other compatible providers)
 */
const callOpenAiCompatibleApi = async (prompt, apiKey, config) => {
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
    const errorMsg = error.error?.message || '';
    
    if (response.status === 401) {
      throw new Error(`Invalid API key. Please check your ${config.name} API key.`);
    }
    if (response.status === 429) {
      throw new Error('Rate limit exceeded. Please wait a moment and try again.');
    }
    if (response.status === 402 || errorMsg.includes('billing') || errorMsg.includes('quota')) {
      throw new Error('Billing/quota issue. Check your account balance or try Groq (free tier).');
    }
    throw new Error(errorMsg || `API error: ${response.status}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || 'No response generated';
};

/**
 * Call Gemini API
 */
const callGeminiApi = async (prompt, apiKey, config) => {
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
    const errorMsg = error.error?.message || '';
    
    if (response.status === 400) {
      throw new Error('Invalid API key. Please check your Gemini API key.');
    }
    if (response.status === 404 || errorMsg.includes('not found')) {
      throw new Error('Model not available. Google may have updated their API.');
    }
    if (response.status === 403) {
      throw new Error('Access denied. Your API key may not have access to this model.');
    }
    if (response.status === 429) {
      throw new Error('Rate limit exceeded. Try Groq instead (more generous free tier).');
    }
    throw new Error(errorMsg || `API error: ${response.status}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response generated';
};

/**
 * Call AI API (routes to correct provider based on type)
 */
const callAiApi = async (prompt) => {
  const apiKey = loadApiKey();
  if (!apiKey) {
    throw new Error('No API key configured');
  }

  const providerKey = getProvider();
  const config = AI_PROVIDERS[providerKey];

  // Route based on API type
  if (config.type === 'openai') {
    return callOpenAiCompatibleApi(prompt, apiKey, config);
  } else if (config.type === 'gemini') {
    return callGeminiApi(prompt, apiKey, config);
  } else {
    throw new Error(`Unknown provider type: ${config.type}`);
  }
};

/**
 * Generate AI insight
 */
const generateAiInsight = async () => {
  const playerName = playerSelect.value;
  const windowSize = parseInt(windowSizeSelect?.value || '5', 10);
  const data = buildData();
  const records = data.filter(r => r.player === playerName);
  
  if (records.length < 3) {
    aiInsightText.innerHTML = '<p>Need at least 3 games for AI analysis.</p>';
    aiInsightText.classList.add('visible');
    return;
  }

  // Show loading state
  generateAiBtn.classList.add('loading');
  generateAiBtn.disabled = true;
  aiInsightText.innerHTML = '';
  aiInsightText.classList.remove('visible');

  try {
    const context = buildAiContext(playerName, records, windowSize);
    const prompt = buildGeminiPrompt(context);
    const response = await callAiApi(prompt);
    
    // Format the response
    const formattedResponse = response
      .split('\n\n')
      .filter(p => p.trim())
      .map(p => `<p>${p.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</p>`)
      .join('');
    
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
    generateAiBtn.classList.remove('loading');
    generateAiBtn.disabled = false;
  }
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
    saveApiKeyToStorage(key);
    aiApiKeyInput.value = '';
    aiSettings.style.display = 'none';
    updateAiStatus();
  });
}

if (generateAiBtn) {
  generateAiBtn.addEventListener('click', generateAiInsight);
}

// Load saved API key on page load
if (aiApiKeyInput) {
  const savedKey = loadApiKey();
  if (savedKey) {
    aiApiKeyInput.placeholder = '••••••••••••••••';
  }
  updateAiStatus();
}

// Initialize the app
init();
