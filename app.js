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
    .flatMap((game) =>
      game.entries.map((entry) => ({
        date: game.date,
        opponent: game.opponent,
        league: game.league,
        homeAway: game.homeAway,
        player: entry.name,
        stats: entry.stats,
      }))
    )
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

const renderChart = (records, stat) => {
  if (records.length === 0) {
    chart.innerHTML = "<p>No data</p>";
    return;
  }

  const values = records.map((record) => getNumericStat(record.stats[stat]));
  const max = Math.max(...values, 1);
  const padding = 8;
  
  const pointsData = values.map((value, index) => {
    const x = padding + (index / Math.max(values.length - 1, 1)) * (100 - padding * 2);
    const y = padding + (1 - value / max) * (100 - padding * 2);
    return { x, y };
  });
  
  const linePoints = pointsData.map(p => `${p.x},${p.y}`).join(" ");
  const dots = pointsData.map(p => 
    `<circle cx="${p.x}" cy="${p.y}" r="2.5" fill="var(--accent)" />`
  ).join("");

  chart.innerHTML = `
    <svg viewBox="0 0 100 100" preserveAspectRatio="none">
      <polyline points="${linePoints}" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      ${dots}
    </svg>
  `;
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

const refresh = () => {
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

  updateSelectors(data);
  const player = playerSelect.value;
  const stat = statSelect.value;
  const records = updateDataPoints(data, player, stat);
  renderChart(records, stat);
  renderInsight(records, stat);
  updateHighlight(records, stat, dataPointSelect.selectedIndex || 0);
};

playerSelect.addEventListener("change", refresh);
statSelect.addEventListener("change", refresh);

dataPointSelect.addEventListener("change", () => {
  const data = buildData();
  const records = updateDataPoints(data, playerSelect.value, statSelect.value);
  updateHighlight(records, statSelect.value, dataPointSelect.selectedIndex);
});

refresh();
