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
const gameStatsEdit = document.getElementById("gameStatsEdit");
const gameStatsActions = document.getElementById("gameStatsActions");
const boxScorePrintSheet = document.getElementById("boxScorePrintSheet");

// Pure box-score event helpers (increments + percentage recompute).
const BE = window.boxscoreEdit;

// The game currently shown in the box score modal (so Export knows what to print).
let currentGame = null;

// ---------- edit-mode state ----------
// Edits are modelled as an immutable base snapshot + an ordered list of ops, so
// Undo is a pop and there are no reverse-increment bugs. computeWorking() folds
// the ops back over the snapshot and re-derives percentages + computed stats.
let editing = false;
let editBase = null;        // deep clone of game.performances on enter
let pendingOps = [];        // [{name, type}] or [{addPlayer:true, name, number}]
let selectedPlayer = null;

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

// Can the current user edit stats? Mirrors the server rule for
// PUT /api/teams/:id/data (platform admin OR team admin).
function canEditActiveTeam() {
  const bt = window.BasketTeams || {};
  if (bt.role === "admin") return true; // platform admin
  const active = (bt.list || []).find((t) => t.id === bt.activeId);
  const roles = active ? (active.roles || (active.role ? [active.role] : [])) : [];
  return roles.includes("admin");
}

// Performances to render: live working copy while editing, else the saved game.
function currentPerformances() {
  return editing ? computeWorking() : (currentGame && currentGame.performances) || {};
}

// Render the box score head + body from the current performances. In edit mode
// rows are selectable and the active player is highlighted.
function renderBoxScore() {
  const perf = currentPerformances();

  const allStats = new Set();
  Object.values(perf).forEach((stats) => {
    Object.keys(stats || {}).forEach((key) => allStats.add(key));
  });
  const statKeys = Array.from(allStats);

  gameStatsHead.innerHTML = `
    <tr>
      <th>Player</th>
      ${statKeys.map((key) => `<th data-stat-tooltip="${escapeHtml(key)}">${escapeHtml(key)}</th>`).join("")}
    </tr>
  `;

  const players = Object.entries(perf).sort(([, a], [, b]) => {
    const pa = Number(a && (a.pts != null ? a.pts : a.points)) || 0;
    const pb = Number(b && (b.pts != null ? b.pts : b.points)) || 0;
    return pb - pa;
  });

  gameStatsBody.innerHTML = players.length
    ? players
        .map(([name, stats]) => {
          const sel = editing && name === selectedPlayer ? " selected" : "";
          const cls = editing ? ` class="bs-row bs-selectable${sel}"` : "";
          const attr = editing ? ` data-player="${escapeHtml(name)}"` : "";
          return `
          <tr${cls}${attr}>
            <td><strong>${escapeHtml(name)}</strong></td>
            ${statKeys.map((key) => `<td>${formatStatValue(stats ? stats[key] : null, key)}</td>`).join("")}
          </tr>
        `;
        })
        .join("")
    : `<tr><td colspan="${statKeys.length + 1}" class="empty-state">No player stats recorded for this game.</td></tr>`;
}

function openGameStats(game) {
  currentGame = game;
  editing = false;
  pendingOps = [];
  selectedPlayer = null;
  const locationLabel = game.homeAway === "home" ? "vs" : "@";
  gameStatsTitle.textContent = `${formatDate(game.date)} ${locationLabel} ${game.opponent || ""}`.trim();

  renderBoxScore();
  setEditChrome(false);
  if (gameStatsEdit) gameStatsEdit.hidden = !canEditActiveTeam();
  gameStatsModal.classList.add("active");
}

function closeGameStats() {
  if (editing && pendingOps.length &&
      !confirm("Discard unsaved stat edits?")) return;
  editing = false;
  pendingOps = [];
  selectedPlayer = null;
  setEditChrome(false);
  gameStatsModal.classList.remove("active");
}

// ---------- after-the-fact stat editing ----------

// Fold the pending ops over the base snapshot, then re-derive percentages and
// the computed metrics (reb, a/to, atk, def, shoot) for every line.
function computeWorking() {
  const base = JSON.parse(JSON.stringify(editBase || {}));
  pendingOps.forEach((op) => {
    if (op.addPlayer) {
      if (!base[op.name]) base[op.name] = BE.emptyLine();
    } else {
      base[op.name] = BE.applyEvent(base[op.name] || BE.emptyLine(), op.type);
    }
  });
  Object.keys(base).forEach((name) => {
    BE.recomputePercentages(base[name]);
    base[name] = window.basketStatData.addComputedStats(base[name]);
  });
  return base;
}

// Build the edit panel (quick-add actions + add-player sub-form) and the edit
// action buttons once; they live inside the modal and toggle with edit mode.
let editUIBuilt = false;
let boxEditPanel, boxEditHint, boxAddPlayerForm;
let editActionBtns = [];
function ensureEditUI() {
  if (editUIBuilt) return;
  editUIBuilt = true;

  const modalBody = gameStatsModal.querySelector(".modal-body");

  // --- quick-add panel ---
  boxEditPanel = document.createElement("div");
  boxEditPanel.className = "box-edit-panel";
  boxEditPanel.hidden = true;

  boxEditHint = document.createElement("div");
  boxEditHint.className = "box-edit-hint";
  boxEditPanel.appendChild(boxEditHint);

  const makeGroup = (label, group) => {
    const wrap = document.createElement("div");
    wrap.className = "box-edit-group";
    const lbl = document.createElement("div");
    lbl.className = "box-edit-group-label";
    lbl.textContent = label;
    wrap.appendChild(lbl);
    const row = document.createElement("div");
    row.className = "box-edit-actions";
    BE.ACTIONS.filter((a) => a.group === group).forEach((a) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "box-edit-btn" +
        (a.made === true ? " made" : a.made === false ? " miss" : "");
      btn.textContent = a.label;
      btn.dataset.action = a.type;
      btn.disabled = true;
      btn.addEventListener("click", () => applyQuickAdd(a.type));
      editActionBtns.push(btn);
      row.appendChild(btn);
    });
    wrap.appendChild(row);
    return wrap;
  };

  boxEditPanel.appendChild(makeGroup("Shooting", "shooting"));
  boxEditPanel.appendChild(makeGroup("Other", "other"));

  // --- add-player sub-form ---
  boxAddPlayerForm = document.createElement("div");
  boxAddPlayerForm.className = "box-add-player";
  boxAddPlayerForm.hidden = true;
  boxAddPlayerForm.innerHTML = `
    <div class="box-edit-group-label">Add a player to this box score</div>
    <div class="box-add-player-row">
      <select class="box-add-select" id="boxAddSelect"></select>
      <input type="text" class="box-add-name" id="boxAddName" placeholder="or type a new name" />
      <input type="number" class="box-add-number" id="boxAddNumber" placeholder="#" min="0" />
      <button type="button" class="btn-small" id="boxAddConfirm">Add</button>
      <button type="button" class="btn-small secondary" id="boxAddCancel">Cancel</button>
    </div>
  `;
  boxEditPanel.appendChild(boxAddPlayerForm);

  modalBody.appendChild(boxEditPanel);

  boxAddPlayerForm.querySelector("#boxAddConfirm").addEventListener("click", confirmAddPlayer);
  boxAddPlayerForm.querySelector("#boxAddCancel").addEventListener("click", () => { boxAddPlayerForm.hidden = true; });

  // --- edit action buttons (added to the modal action row, hidden by default) ---
  const mkBtn = (id, label, cls) => {
    const b = document.createElement("button");
    b.type = "button";
    b.id = id;
    b.className = cls;
    b.textContent = label;
    b.hidden = true;
    gameStatsActions.appendChild(b);
    return b;
  };
  editAddPlayerBtn = mkBtn("boxEditAddPlayer", "Add player", "secondary");
  editUndoBtn = mkBtn("boxEditUndo", "Undo", "secondary");
  editCancelBtn = mkBtn("boxEditCancel", "Cancel", "secondary");
  editSaveBtn = mkBtn("boxEditSave", "Save", "primary");

  editAddPlayerBtn.addEventListener("click", openAddPlayer);
  editUndoBtn.addEventListener("click", undoLastOp);
  editCancelBtn.addEventListener("click", () => { editing = false; pendingOps = []; selectedPlayer = null; renderBoxScore(); setEditChrome(false); });
  editSaveBtn.addEventListener("click", saveEdits);
}

let editAddPlayerBtn, editUndoBtn, editCancelBtn, editSaveBtn;

// Toggle the modal between view and edit chrome (buttons + panel visibility).
function setEditChrome(on) {
  ensureEditUI();
  [gameStatsEdit, gameStatsCloseBtn, gameStatsExport].forEach((b) => { if (b) b.hidden = on; });
  [editAddPlayerBtn, editUndoBtn, editCancelBtn, editSaveBtn].forEach((b) => { if (b) b.hidden = !on; });
  if (gameStatsEdit && !on) gameStatsEdit.hidden = !canEditActiveTeam();
  boxEditPanel.hidden = !on;
  if (!on && boxAddPlayerForm) boxAddPlayerForm.hidden = true;
  if (on) updateEditPanel();
}

function enterEditMode() {
  if (!currentGame) return;
  editing = true;
  editBase = JSON.parse(JSON.stringify(currentGame.performances || {}));
  pendingOps = [];
  selectedPlayer = null;
  renderBoxScore();
  setEditChrome(true);
}

// Enable/disable the quick-add buttons and show which player is targeted.
function updateEditPanel() {
  const has = !!selectedPlayer;
  editActionBtns.forEach((b) => { b.disabled = !has; });
  boxEditHint.textContent = has
    ? `Adding events to: ${selectedPlayer}`
    : "Select a player row, then tap an event to add it.";
  if (editUndoBtn) editUndoBtn.disabled = pendingOps.length === 0;
}

function selectPlayer(name) {
  selectedPlayer = name;
  renderBoxScore();
  updateEditPanel();
}

function applyQuickAdd(type) {
  if (!selectedPlayer) return;
  pendingOps.push({ name: selectedPlayer, type });
  renderBoxScore();
  updateEditPanel();
}

function undoLastOp() {
  if (!pendingOps.length) return;
  const removed = pendingOps.pop();
  // If we undid the add of a player who has no remaining ops, drop the selection.
  if (removed.addPlayer && !pendingOps.some((o) => o.name === removed.name)) {
    if (selectedPlayer === removed.name) selectedPlayer = null;
  }
  renderBoxScore();
  updateEditPanel();
}

function openAddPlayer() {
  const data = window.basketStatData.loadData();
  const roster = Object.keys(data.players || {});
  const inGame = new Set(Object.keys(currentPerformances()));
  const eligible = roster.filter((n) => !inGame.has(n)).sort((a, b) => a.localeCompare(b));
  const sel = boxAddPlayerForm.querySelector("#boxAddSelect");
  sel.innerHTML =
    '<option value="">— roster player —</option>' +
    eligible.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("");
  boxAddPlayerForm.querySelector("#boxAddName").value = "";
  boxAddPlayerForm.querySelector("#boxAddNumber").value = "";
  boxAddPlayerForm.hidden = false;
}

function confirmAddPlayer() {
  const sel = boxAddPlayerForm.querySelector("#boxAddSelect");
  const nameInput = boxAddPlayerForm.querySelector("#boxAddName");
  const numInput = boxAddPlayerForm.querySelector("#boxAddNumber");
  const name = (nameInput.value.trim() || sel.value || "").trim();
  if (!name) { nameInput.focus(); return; }
  if (currentPerformances()[name]) { // already present
    selectPlayer(name);
    boxAddPlayerForm.hidden = true;
    return;
  }
  const number = numInput.value === "" ? null : Number(numInput.value);
  pendingOps.push({ addPlayer: true, name, number });
  boxAddPlayerForm.hidden = true;
  selectPlayer(name);
}

async function saveEdits() {
  const working = computeWorking();
  const data = window.basketStatData.loadData();
  const g = data.games.find((x) => String(x.id) === String(currentGame.id));
  if (!g) { alert("Game not found; cannot save."); return; }
  g.performances = working;
  // Register any newly added players in the roster registry.
  pendingOps.filter((o) => o.addPlayer).forEach(({ name, number }) => {
    if (!data.players[name]) {
      data.players[name] = { number: (number === 0 || number) ? number : null, active: true };
    }
  });

  editSaveBtn.disabled = true;
  let ok = false;
  try { ok = await window.basketStatData.saveData(data, { immediate: true }); }
  catch (e) { ok = false; }
  editSaveBtn.disabled = false;

  if (!ok) {
    boxEditHint.textContent = "Save failed — only team admins can edit stats. Your changes are kept here; try again.";
    return;
  }
  // Success: refresh the list (team PTS changed) and re-open in view mode.
  editing = false;
  pendingOps = [];
  selectedPlayer = null;
  renderGames();
  openGameStats(g);
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
if (gameStatsEdit) {
  gameStatsEdit.addEventListener("click", enterEditMode);
}
// Row selection while editing: click a player row to target quick-add events.
gameStatsBody.addEventListener("click", (e) => {
  if (!editing) return;
  const row = e.target.closest("tr[data-player]");
  if (!row) return;
  selectPlayer(row.dataset.player);
});
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
