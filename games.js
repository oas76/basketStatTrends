// ========================================
// GAMES
// ========================================
// Top-level "Games" tab: lists every game for the active team (newest first)
// and drills into a per-game box score. Read-only view over the shared data
// layer; config.js hydrates the active team before this script renders.

// ---------- DOM ----------
const gamesTableBody = document.getElementById("gamesTableBody");
const gamesCount = document.getElementById("gamesCount");
const gamesLeagueFilter = document.getElementById("gamesLeagueFilter");

const gameStatsModal = document.getElementById("gameStatsModal");
const gameStatsTitle = document.getElementById("gameStatsTitle");
const gameStatsHead = document.getElementById("gameStatsHead");
const gameStatsBody = document.getElementById("gameStatsBody");
const gameStatsClose = document.getElementById("gameStatsClose");
const gameStatsCloseBtn = document.getElementById("gameStatsCloseBtn");
const gameStatsExport = document.getElementById("gameStatsExport");
const boxScorePrintSheet = document.getElementById("boxScorePrintSheet");

// The game currently shown in the box score modal (so Export knows what to print).
let currentGame = null;

// ---------- helpers (mirrors admin.js) ----------
const escapeHtml = (s) =>
  String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));

const formatDate = (dateStr) => {
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? String(dateStr || "—") : d.toLocaleDateString();
};

const formatStatValue = (value, stat) => {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object" && "made" in value && "attempted" in value) {
    return `${value.made}-${value.attempted}`;
  }
  if (stat && String(stat).toLowerCase() === "min" &&
      window.basketStatData && window.basketStatData.formatMinutes) {
    return window.basketStatData.formatMinutes(value);
  }
  return String(value);
};

// Sum a game's team points (points for) from per-player performances. Tries the
// common point keys so it works for both recorder-made and CSV-imported games.
const teamPoints = (game) => {
  const perfs = Object.values(game.performances || {});
  return perfs.reduce((sum, s) => {
    const pts = s && (s.pts != null ? s.pts : s.points);
    const n = Number(pts);
    return sum + (isNaN(n) ? 0 : n);
  }, 0);
};

// ---------- list ----------
function allGames() {
  const data = window.basketStatData.loadData();
  return Array.isArray(data.games) ? data.games : [];
}

function populateLeagueFilter(games) {
  const current = gamesLeagueFilter.value || "all";
  const leagues = Array.from(new Set(games.map((g) => g.league).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b));
  gamesLeagueFilter.innerHTML =
    '<option value="all">All competitions</option>' +
    leagues.map((l) => `<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join("");
  // Preserve the previous selection when still valid.
  gamesLeagueFilter.value = leagues.includes(current) ? current : "all";
}

function renderGames() {
  const games = allGames();
  populateLeagueFilter(games);

  const filter = gamesLeagueFilter.value || "all";
  const visible = games.filter((g) => filter === "all" || g.league === filter);

  if (gamesCount) {
    gamesCount.textContent = visible.length
      ? `· ${visible.length} game${visible.length === 1 ? "" : "s"}`
      : "";
  }

  if (!visible.length) {
    gamesTableBody.innerHTML =
      `<tr><td colspan="7" class="empty-state">${games.length ? "No games in this competition." : "No games yet."}</td></tr>`;
    return;
  }

  // Newest first. Sort a copy so the stored order is never mutated.
  gamesTableBody.innerHTML = [...visible]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .map((game) => {
      const numPlayers = Object.keys(game.performances || {}).length;
      const locationLabel = game.homeAway === "home" ? "H" : "A";
      const safeId = escapeHtml(String(game.id));
      return `
        <tr data-game-id="${safeId}" style="cursor: pointer;" title="View box score">
          <td>${formatDate(game.date)}</td>
          <td><strong>${escapeHtml(game.opponent || "—")}</strong></td>
          <td>${escapeHtml(game.league || "—")}</td>
          <td>${locationLabel}</td>
          <td>${numPlayers}</td>
          <td>${teamPoints(game)}</td>
          <td class="actions" style="text-align: right;">
            <button class="btn-icon" data-action="view" title="View box score">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
          </td>
        </tr>
      `;
    })
    .join("");
}

// ---------- drill-down: per-game box score ----------
function openGameStats(game) {
  currentGame = game;
  const locationLabel = game.homeAway === "home" ? "vs" : "@";
  gameStatsTitle.textContent = `${formatDate(game.date)} ${locationLabel} ${game.opponent || ""}`.trim();

  // Column set = union of stat keys across all players in this game.
  const allStats = new Set();
  Object.values(game.performances || {}).forEach((stats) => {
    Object.keys(stats || {}).forEach((key) => allStats.add(key));
  });
  const statKeys = Array.from(allStats);

  gameStatsHead.innerHTML = `
    <tr>
      <th>Player</th>
      ${statKeys.map((key) => `<th data-stat-tooltip="${escapeHtml(key)}">${escapeHtml(key)}</th>`).join("")}
    </tr>
  `;

  const players = Object.entries(game.performances || {})
    .sort(([, a], [, b]) => {
      const pa = Number(a && (a.pts != null ? a.pts : a.points)) || 0;
      const pb = Number(b && (b.pts != null ? b.pts : b.points)) || 0;
      return pb - pa;
    });

  gameStatsBody.innerHTML = players.length
    ? players
        .map(([name, stats]) => `
          <tr>
            <td><strong>${escapeHtml(name)}</strong></td>
            ${statKeys.map((key) => `<td>${formatStatValue(stats ? stats[key] : null, key)}</td>`).join("")}
          </tr>
        `)
        .join("")
    : `<tr><td colspan="${statKeys.length + 1}" class="empty-state">No player stats recorded for this game.</td></tr>`;

  gameStatsModal.classList.add("active");
}

function closeGameStats() {
  gameStatsModal.classList.remove("active");
}

// ---------- PDF export (print-to-PDF) ----------

// Compute a totals row aligned to statKeys. Sums numeric columns; sums
// made/attempted pairs into a combined "made-attempted"; formats a summed `min`
// column via the shared minutes formatter; leaves non-numeric columns blank.
function buildTotals(statKeys, performances) {
  const rows = Object.values(performances || {});
  return statKeys.map((key) => {
    const isShootingPair = rows.some(
      (s) => s && s[key] && typeof s[key] === "object" && "made" in s[key] && "attempted" in s[key]
    );
    if (isShootingPair) {
      let made = 0, attempted = 0;
      rows.forEach((s) => {
        const v = s ? s[key] : null;
        if (v && typeof v === "object") {
          made += Number(v.made) || 0;
          attempted += Number(v.attempted) || 0;
        }
      });
      return `${made}-${attempted}`;
    }
    // Numeric column: sum only if every present value is numeric.
    const values = rows.map((s) => (s ? s[key] : null)).filter((v) => v !== null && v !== undefined);
    const allNumeric = values.length > 0 && values.every((v) => !isNaN(Number(v)));
    if (!allNumeric) return "";
    const sum = values.reduce((acc, v) => acc + Number(v), 0);
    return formatStatValue(sum, key);
  });
}

// Resolve the active team's display name from the team switcher, stripping the
// trailing " (admin)" suffix. Falls back to a generic label.
function activeTeamName() {
  const sel = document.getElementById("teamSwitcher");
  const txt = sel && sel.selectedOptions && sel.selectedOptions[0]
    ? sel.selectedOptions[0].textContent : "";
  const name = String(txt || "").replace(/\s*\(admin\)\s*$/i, "").trim();
  return name || "Box Score";
}

// Build the hidden print sheet for a game, then invoke the browser's print
// dialog (Save as PDF). Only the sheet is visible while printing (see the
// body.print-boxscore @media print rules in style.css).
function exportBoxScorePdf(game) {
  if (!game) return;

  const locationLabel = game.homeAway === "home" ? "vs" : "@";
  const teamName = activeTeamName();

  // Column set = union of stat keys across all players (same as the modal).
  const allStats = new Set();
  Object.values(game.performances || {}).forEach((stats) => {
    Object.keys(stats || {}).forEach((key) => allStats.add(key));
  });
  const statKeys = Array.from(allStats);

  const players = Object.entries(game.performances || {}).sort(([, a], [, b]) => {
    const pa = Number(a && (a.pts != null ? a.pts : a.points)) || 0;
    const pb = Number(b && (b.pts != null ? b.pts : b.points)) || 0;
    return pb - pa;
  });

  const headCells = statKeys.map((k) => `<th>${escapeHtml(k)}</th>`).join("");
  const bodyRows = players.length
    ? players
        .map(([name, stats]) => `
          <tr>
            <td class="bps-player">${escapeHtml(name)}</td>
            ${statKeys.map((k) => `<td>${formatStatValue(stats ? stats[k] : null, k)}</td>`).join("")}
          </tr>`)
        .join("")
    : `<tr><td colspan="${statKeys.length + 1}" class="bps-empty">No player stats recorded for this game.</td></tr>`;

  const totals = buildTotals(statKeys, game.performances);
  const totalsRow = players.length
    ? `<tr class="bps-totals">
         <td class="bps-player">Totals</td>
         ${totals.map((t) => `<td>${escapeHtml(t)}</td>`).join("")}
       </tr>`
    : "";

  const metaBits = [
    `${locationLabel} ${escapeHtml(game.opponent || "—")}`,
    escapeHtml(game.league || "—"),
    game.homeAway === "home" ? "Home" : "Away",
    `${teamPoints(game)} PTS`
  ];

  boxScorePrintSheet.innerHTML = `
    <div class="bps-header">
      <div class="bps-title">${escapeHtml(teamName)}</div>
      <div class="bps-date">${formatDate(game.date)}</div>
    </div>
    <div class="bps-meta">${metaBits.join(" &middot; ")}</div>
    <table class="bps-table">
      <thead><tr><th class="bps-player">Player</th>${headCells}</tr></thead>
      <tbody>${bodyRows}${totalsRow}</tbody>
    </table>
    <div class="bps-footer">Generated by BasketStat &middot; ${formatDate(new Date().toISOString())}</div>
  `;

  // One-shot cleanup so the app chrome returns after the dialog closes. Use both
  // the afterprint event and a matchMedia fallback for browsers (Safari) that
  // don't always fire afterprint reliably.
  const cleanup = () => {
    document.body.classList.remove("print-boxscore");
    window.removeEventListener("afterprint", cleanup);
    if (mql && mql.removeEventListener) mql.removeEventListener("change", onChange);
  };
  const mql = window.matchMedia ? window.matchMedia("print") : null;
  const onChange = (e) => { if (!e.matches) cleanup(); };
  window.addEventListener("afterprint", cleanup);
  if (mql && mql.addEventListener) mql.addEventListener("change", onChange);

  document.body.classList.add("print-boxscore");
  window.print();
}

// ---------- events ----------
gamesTableBody.addEventListener("click", (e) => {
  const row = e.target.closest("tr[data-game-id]");
  if (!row) return;
  const game = allGames().find((g) => String(g.id) === String(row.dataset.gameId));
  if (game) openGameStats(game);
});

gamesLeagueFilter.addEventListener("change", renderGames);

gameStatsClose.addEventListener("click", closeGameStats);
gameStatsCloseBtn.addEventListener("click", closeGameStats);
if (gameStatsExport) {
  gameStatsExport.addEventListener("click", () => { if (currentGame) exportBoxScorePdf(currentGame); });
}
gameStatsModal.addEventListener("click", (e) => {
  // Click on the backdrop (outside the .modal) closes.
  if (e.target === gameStatsModal) closeGameStats();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && gameStatsModal.classList.contains("active")) closeGameStats();
});

// ---------- boot ----------
// Wait for config.js to hydrate the active team before the first render.
(async () => {
  try {
    if (window.basketStatReady) await window.basketStatReady;
  } catch (e) {
    console.error("Team context failed to load:", e);
  }
  renderGames();
  const overlay = document.getElementById("loadingOverlay");
  if (overlay) overlay.classList.add("hidden");
})();
