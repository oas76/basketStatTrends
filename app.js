const playerSelect = document.getElementById("playerSelect");
const statSelect = document.getElementById("statSelect");
const dataPointSelect = document.getElementById("dataPointSelect");
const highlightValue = document.getElementById("highlightValue");
const highlightMeta = document.getElementById("highlightMeta");
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

const updateSelectors = (records) => {
  const players = window.basketStatData.unique(records.map((record) => record.player));
  playerSelect.innerHTML = players
    .map((player) => `<option value="${player}">${player}</option>`)
    .join("");

  const stats = window.basketStatData.unique(
    records.flatMap((record) => Object.keys(record.stats))
  );
  statSelect.innerHTML = stats
    .map((stat) => `<option value="${stat}">${stat}</option>`)
    .join("");
};

const updateDataPoints = (records, player, stat) => {
  const filtered = records.filter((record) => record.player === player);
  dataPointSelect.innerHTML = filtered
    .map((record, index) => {
      const locationLabel = record.homeAway === "home" ? "vs" : "@";
      return `<option value="${index}">${formatDate(record.date)} ${locationLabel} ${record.opponent}</option>`;
    })
    .join("");

  statHeader.textContent = stat;
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

  return filtered;
};

/**
 * Get color based on performance relative to average
 * Returns color from orange (bad) -> yellow (below avg) -> neutral -> green (good)
 */
const getPerformanceColor = (value, average, max) => {
  if (average === 0) return 'var(--text-muted)';
  
  const ratio = value / average;
  
  if (ratio >= 1.3) return '#22c55e';      // Green - excellent (30%+ above avg)
  if (ratio >= 1.1) return '#84cc16';      // Light green - good (10-30% above)
  if (ratio >= 0.9) return '#eab308';      // Yellow - average (within 10%)
  if (ratio >= 0.7) return '#f97316';      // Orange - below average (10-30% below)
  return '#ef4444';                         // Red - poor (30%+ below)
};

const renderChart = (records, stat) => {
  if (records.length === 0) {
    chart.innerHTML = "<p>No data</p>";
    return;
  }

  const values = records.map((record) => getNumericStat(record.stats[stat]));
  const average = values.reduce((sum, v) => sum + v, 0) / values.length;
  const max = Math.max(...values, 1);
  const min = Math.min(...values);
  
  // Chart dimensions
  const padding = { top: 15, right: 10, bottom: 25, left: 10 };
  const width = 100;
  const height = 100;
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  
  // Calculate points
  const pointsData = values.map((value, index) => {
    const x = padding.left + (index / Math.max(values.length - 1, 1)) * chartWidth;
    const y = padding.top + (1 - value / max) * chartHeight;
    const color = getPerformanceColor(value, average, max);
    return { x, y, value, color, record: records[index] };
  });
  
  // Average line Y position
  const avgY = padding.top + (1 - average / max) * chartHeight;
  
  // Line path
  const linePoints = pointsData.map(p => `${p.x},${p.y}`).join(" ");
  
  // Create gradient for the line based on performance
  const gradientStops = pointsData.map((p, i) => {
    const percent = (i / Math.max(pointsData.length - 1, 1)) * 100;
    return `<stop offset="${percent}%" stop-color="${p.color}" />`;
  }).join("");
  
  // Interactive dots with hover areas
  const dots = pointsData.map((p, i) => {
    const record = p.record;
    const locationLabel = record.homeAway === "home" ? "vs" : "@";
    const dateStr = formatDate(record.date);
    return `
      <g class="chart-point" data-index="${i}">
        <circle cx="${p.x}" cy="${p.y}" r="6" fill="transparent" class="hover-area" />
        <circle cx="${p.x}" cy="${p.y}" r="4" fill="${p.color}" class="point-outer" />
        <circle cx="${p.x}" cy="${p.y}" r="2.5" fill="var(--bg)" class="point-inner" />
      </g>
    `;
  }).join("");
  
  // X-axis labels (first, middle, last dates)
  const xLabels = [];
  if (records.length > 0) {
    xLabels.push({ x: pointsData[0].x, label: formatDate(records[0].date).split('/').slice(0,2).join('/') });
    if (records.length > 2) {
      const midIdx = Math.floor(records.length / 2);
      xLabels.push({ x: pointsData[midIdx].x, label: formatDate(records[midIdx].date).split('/').slice(0,2).join('/') });
    }
    if (records.length > 1) {
      const lastIdx = records.length - 1;
      xLabels.push({ x: pointsData[lastIdx].x, label: formatDate(records[lastIdx].date).split('/').slice(0,2).join('/') });
    }
  }
  
  const xAxisLabels = xLabels.map(l => 
    `<text x="${l.x}" y="${height - 3}" text-anchor="middle" class="axis-label">${l.label}</text>`
  ).join("");

  chart.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" class="performance-chart">
      <defs>
        <linearGradient id="lineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          ${gradientStops}
        </linearGradient>
      </defs>
      
      <!-- Grid lines -->
      <line x1="${padding.left}" y1="${avgY}" x2="${width - padding.right}" y2="${avgY}" 
            stroke="var(--text-muted)" stroke-width="0.5" stroke-dasharray="2,2" opacity="0.5" />
      
      <!-- Average label -->
      <text x="${width - padding.right + 1}" y="${avgY + 1}" class="avg-label">avg</text>
      
      <!-- Data line -->
      <polyline points="${linePoints}" fill="none" stroke="url(#lineGradient)" stroke-width="2" 
                stroke-linecap="round" stroke-linejoin="round" />
      
      <!-- Data points -->
      ${dots}
      
      <!-- X-axis labels -->
      ${xAxisLabels}
    </svg>
    
    <!-- Tooltip -->
    <div class="chart-tooltip" id="chartTooltip"></div>
    
    <!-- Legend -->
    <div class="chart-legend">
      <div class="legend-item"><span class="legend-dot" style="background: #22c55e;"></span>Excellent</div>
      <div class="legend-item"><span class="legend-dot" style="background: #84cc16;"></span>Good</div>
      <div class="legend-item"><span class="legend-dot" style="background: #eab308;"></span>Average</div>
      <div class="legend-item"><span class="legend-dot" style="background: #f97316;"></span>Below</div>
      <div class="legend-item"><span class="legend-dot" style="background: #ef4444;"></span>Poor</div>
      <div class="legend-item legend-avg"><span class="legend-line"></span>Avg: ${average.toFixed(1)}</div>
    </div>
  `;
  
  // Add tooltip interactivity
  setupChartTooltips(records, stat, pointsData);
};

const setupChartTooltips = (records, stat, pointsData) => {
  const tooltip = document.getElementById('chartTooltip');
  const chartEl = document.getElementById('chart');
  
  chartEl.querySelectorAll('.chart-point').forEach((point, index) => {
    const data = pointsData[index];
    const record = records[index];
    
    point.addEventListener('mouseenter', (e) => {
      const locationLabel = record.homeAway === "home" ? "vs" : "@";
      tooltip.innerHTML = `
        <div class="tooltip-date">${formatDate(record.date)}</div>
        <div class="tooltip-opponent">${locationLabel} ${record.opponent}</div>
        <div class="tooltip-value" style="color: ${data.color}">${formatStatValue(record.stats[stat])}</div>
      `;
      tooltip.classList.add('visible');
      
      // Position tooltip
      const rect = chartEl.getBoundingClientRect();
      const pointRect = point.getBoundingClientRect();
      tooltip.style.left = `${pointRect.left - rect.left + pointRect.width / 2}px`;
      tooltip.style.top = `${pointRect.top - rect.top - 10}px`;
    });
    
    point.addEventListener('mouseleave', () => {
      tooltip.classList.remove('visible');
    });
    
    point.addEventListener('click', () => {
      dataPointSelect.selectedIndex = index;
      updateHighlight(records, stat, index);
    });
  });
};

const renderInsight = (records, stat) => {
  if (records.length < 2) {
    insightText.textContent = "Need at least 2 games for trend analysis";
    return;
  }

  const values = records.map((record) => getNumericStat(record.stats[stat]));
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const recent = values.slice(-3);
  const recentAverage =
    recent.reduce((sum, value) => sum + value, 0) / recent.length;
  const trend = recentAverage - average;

  if (trend > 0.5) {
    insightText.textContent = `↑ Trending up: Last ${recent.length} games averaging +${trend.toFixed(1)} ${stat} above season average (${average.toFixed(1)})`;
  } else if (trend < -0.5) {
    insightText.textContent = `↓ Trending down: Recent ${stat} is ${Math.abs(trend).toFixed(1)} below season average (${average.toFixed(1)})`;
  } else {
    insightText.textContent = `→ Consistent: Recent ${stat} matches season average of ${average.toFixed(1)}`;
  }
};

const updateHighlight = (records, stat, index) => {
  const record = records[index];
  if (!record) {
    highlightValue.textContent = "—";
    highlightMeta.textContent = "Choose a datapoint to highlight.";
    return;
  }

  highlightValue.textContent = formatStatValue(record.stats[stat]);
  const locationLabel = record.homeAway === "home" ? "vs" : "@";
  highlightMeta.textContent = `${formatDate(record.date)} ${locationLabel} ${record.opponent}`;
};

const updateView = () => {
  const data = buildData();
  if (data.length === 0) {
    return;
  }

  const player = playerSelect.value;
  const stat = statSelect.value;
  const records = updateDataPoints(data, player, stat);
  renderChart(records, stat);
  renderInsight(records, stat);
  updateHighlight(records, stat, dataPointSelect.selectedIndex || 0);
};

const init = () => {
  const data = buildData();
  if (data.length === 0) {
    playerSelect.innerHTML = "<option>—</option>";
    statSelect.innerHTML = "<option>—</option>";
    dataPointSelect.innerHTML = "<option>—</option>";
    chart.innerHTML = "<p>No game data yet</p>";
    insightText.textContent = "Upload game CSVs to see performance analysis";
    gameTable.innerHTML = "";
    highlightValue.textContent = "—";
    highlightMeta.textContent = "Upload data to begin";
    return;
  }

  // Store current selections to preserve them if possible
  const currentPlayer = playerSelect.value;
  const currentStat = statSelect.value;

  updateSelectors(data);

  // Restore selections if they still exist
  if (currentPlayer && [...playerSelect.options].some(opt => opt.value === currentPlayer)) {
    playerSelect.value = currentPlayer;
  }
  if (currentStat && [...statSelect.options].some(opt => opt.value === currentStat)) {
    statSelect.value = currentStat;
  }

  updateView();
};

playerSelect.addEventListener("change", updateView);
statSelect.addEventListener("change", updateView);

dataPointSelect.addEventListener("change", () => {
  const data = buildData();
  const records = updateDataPoints(data, playerSelect.value, statSelect.value);
  updateHighlight(records, statSelect.value, dataPointSelect.selectedIndex);
});

init();
