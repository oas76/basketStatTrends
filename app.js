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

const buildData = () => {
  const { games } = window.basketStatData.loadData();
  return games
    .flatMap((game) =>
      game.entries.map((entry) => ({
        date: game.date,
        opponent: game.opponent,
        player: entry.player,
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
    .map(
      (record, index) =>
        `<option value="${index}">${formatDate(record.date)} vs ${record.opponent}</option>`
    )
    .join("");

  statHeader.textContent = stat;
  gameTable.innerHTML = filtered
    .map(
      (record) => `
        <tr>
          <td>${formatDate(record.date)}</td>
          <td>${record.opponent}</td>
          <td>${record.stats[stat] ?? "—"}</td>
        </tr>
      `
    )
    .join("");

  return filtered;
};

const renderChart = (records, stat) => {
  if (records.length === 0) {
    chart.innerHTML = "<p>No data yet.</p>";
    return;
  }

  const values = records.map((record) => Number(record.stats[stat]) || 0);
  const max = Math.max(...values, 1);
  const points = values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * 100;
      const y = 100 - (value / max) * 100;
      return `${x},${y}`;
    })
    .join(" ");

  chart.innerHTML = `
    <svg viewBox="0 0 100 100" preserveAspectRatio="none">
      <polyline points="${points}" fill="none" stroke="var(--accent)" stroke-width="2" />
    </svg>
  `;
};

const renderInsight = (records, stat) => {
  if (records.length < 2) {
    insightText.textContent = "Add at least two games for trend insights.";
    return;
  }

  const values = records.map((record) => Number(record.stats[stat]) || 0);
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const recent = values.slice(-3);
  const recentAverage =
    recent.reduce((sum, value) => sum + value, 0) / recent.length;
  const trend = recentAverage - average;

  if (trend > 0.5) {
    insightText.textContent = `The last ${recent.length} games are trending above the season average by ${trend.toFixed(
      1
    )} ${stat}. Keep leaning into what's working.`;
  } else if (trend < -0.5) {
    insightText.textContent = `Recent production is ${Math.abs(trend).toFixed(
      1
    )} ${stat} below the season average. Consider a reset focus for this player.`;
  } else {
    insightText.textContent = `Consistency alert: recent ${stat} output mirrors the season average.`;
  }
};

const updateHighlight = (records, stat, index) => {
  const record = records[index];
  if (!record) {
    highlightValue.textContent = "—";
    highlightMeta.textContent = "Choose a datapoint to highlight.";
    return;
  }

  highlightValue.textContent = record.stats[stat] ?? "—";
  highlightMeta.textContent = `${formatDate(record.date)} vs ${record.opponent}`;
};

const refresh = () => {
  const data = buildData();
  if (data.length === 0) {
    playerSelect.innerHTML = "<option>No data</option>";
    statSelect.innerHTML = "<option>No data</option>";
    dataPointSelect.innerHTML = "<option>No data</option>";
    chart.innerHTML = "<p>No data yet. Upload CSVs from the Admin page.</p>";
    insightText.textContent = "Upload data to see automatic observations.";
    gameTable.innerHTML = "";
    highlightValue.textContent = "—";
    highlightMeta.textContent = "Upload a CSV to begin.";
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
