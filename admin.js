// ========================================
// TEAM ADMIN
// ========================================
// Team-scoped administration for the active team: upload games, review pending
// recordings, manage games, players (roster), competitions (leagues), and team
// members. Platform-level admin (users, audit log, storage, teams CRUD) lives on
// platform-admin.html / platform-admin.js.

// DOM Elements
const uploadForm = document.getElementById("uploadForm");
const uploadStatus = document.getElementById("uploadStatus");
const uploadDetails = document.getElementById("uploadDetails");
const gamesTable = document.getElementById("gamesTable");
const playersGrid = document.getElementById("playersGrid");
const gameCount = document.getElementById("gameCount");
const playerCount = document.getElementById("playerCount");
const clearData = document.getElementById("clearData");

// Edit Game Modal
const editGameModal = document.getElementById("editGameModal");
const editGameForm = document.getElementById("editGameForm");
const closeEditGame = document.getElementById("closeEditGame");
const cancelEditGame = document.getElementById("cancelEditGame");

// Stats Modal
const statsModal = document.getElementById("statsModal");
const statsModalTitle = document.getElementById("statsModalTitle");
const statsTableHead = document.getElementById("statsTableHead");
const statsTableBody = document.getElementById("statsTableBody");
const closeStats = document.getElementById("closeStats");
const closeStatsBtn = document.getElementById("closeStatsBtn");

// Format date for display
const formatDate = (dateStr) => new Date(dateStr).toLocaleDateString();

// Format stat value for display
const formatStatValue = (value, stat) => {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object" && "made" in value && "attempted" in value) {
    return `${value.made}-${value.attempted}`;
  }
  if (stat && String(stat).toLowerCase() === 'min' &&
      window.basketStatData && window.basketStatData.formatMinutes) {
    return window.basketStatData.formatMinutes(value);
  }
  return String(value);
};

// Escape untrusted values before inserting into innerHTML (prevents XSS)
const escapeHtml = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

/**
 * Sync the active team's data to the server (per-team Blob). saveData() already
 * schedules a debounced write; this forces it immediately so the admin sees a
 * confirmed save.
 */
/**
 * Reflect the result of an explicit (immediate) team-registry upload in the UI.
 * `ok` is the boolean resolved by the data-layer mutator's immediate save.
 */
function reportTeamSave(ok, message) {
  if (uploadStatus) uploadStatus.textContent = ok ? 'Saved' : 'Save failed';
  if (uploadDetails) {
    uploadDetails.textContent = ok
      ? `${message} — uploaded`
      : `${message} locally, but the upload failed. Check your connection and try again.`;
  }
  if (!ok) console.warn('Team registry upload failed:', message);
}

async function syncToCloudAfterChange() {
  try {
    if (!window.basketStatData.getActiveTeam || !window.basketStatData.getActiveTeam()) {
      console.log('No active team; skipping server sync');
      return;
    }
    const ok = await window.basketStatData.saveToServer();
    if (ok) {
      if (uploadDetails) uploadDetails.textContent += ' (saved)';
    } else {
      console.warn('Team server save failed');
    }
  } catch (error) {
    console.warn('Team server save error:', error);
  }
}

// Render games table
const renderGames = () => {
  const { games } = window.basketStatData.loadData();

  if (gameCount) gameCount.textContent = games.length;

  if (games.length === 0) {
    gamesTable.innerHTML = `
      <tr>
        <td colspan="6" class="empty-state">No games uploaded yet</td>
      </tr>
    `;
    return;
  }

  gamesTable.innerHTML = games
    .map((game) => {
      const playerNames = Object.keys(game.performances || {});
      const numPlayers = playerNames.length;
      const locationLabel = game.homeAway === "home" ? "H" : "A";
      const safeId = game.id.replace(/"/g, '&quot;');

      return `
        <tr data-game-id="${safeId}">
          <td>${formatDate(game.date)}</td>
          <td>${escapeHtml(game.opponent)}</td>
          <td>${escapeHtml(game.league || "—")}</td>
          <td>${locationLabel}</td>
          <td>${numPlayers}</td>
          <td class="actions">
            <button class="btn-icon" data-action="view" title="View Stats">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
            <button class="btn-icon" data-action="edit" title="Edit">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
            </button>
            <button class="btn-icon danger" data-action="delete" title="Delete">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
            </button>
          </td>
        </tr>
      `;
    })
    .join("");
};

// Render players roster grid (registry ∪ game-derived names, with admin controls)
const renderPlayers = () => {
  const { players } = window.basketStatData.loadData();
  const gamesPlayed = window.basketStatData.getPlayerGameCounts();
  const allPlayers = new Set([...Object.keys(players), ...Object.keys(gamesPlayed)]);

  if (playerCount) playerCount.textContent = allPlayers.size;
  if (!playersGrid) return;

  if (allPlayers.size === 0) {
    playersGrid.innerHTML = `<p class="empty-state">No players yet. Add your roster above.</p>`;
    return;
  }

  const sortedPlayers = Array.from(allPlayers).sort((a, b) => {
    const countA = gamesPlayed[a] || 0;
    const countB = gamesPlayed[b] || 0;
    if (countB !== countA) return countB - countA;
    return a.localeCompare(b);
  });

  playersGrid.innerHTML = sortedPlayers
    .map((name) => {
      const count = gamesPlayed[name] || 0;
      const p = players[name];
      const inRegistry = !!p;
      const number = p && (p.number === 0 || p.number) ? p.number : '';
      const active = !p || p.active !== false;
      const numberLabel = number !== '' ? `#${escapeHtml(String(number))} ` : '';
      const statusStyle = active ? '' : 'opacity:0.55;';
      const roleBtns = inRegistry
        ? `<button class="btn-icon" data-paction="edit-number" data-name="${escapeHtml(name)}" title="Edit number">
             <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
           </button>
           <button class="btn-icon" data-paction="${active ? 'deactivate' : 'activate'}" data-name="${escapeHtml(name)}" title="${active ? 'Deactivate' : 'Activate'}">
             ${active
               ? '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.36 6.64A9 9 0 1 1 5.64 6.64"/><line x1="12" x2="12" y1="2" y2="12"/></svg>'
               : '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'}
           </button>`
        : `<button class="btn-icon" data-paction="add-to-roster" data-name="${escapeHtml(name)}" title="Add to roster">
             <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" x2="12" y1="5" y2="19"/><line x1="5" x2="19" y1="12" y2="12"/></svg>
           </button>`;
      return `
        <div class="player-chip" style="${statusStyle}">
          <span class="name">${numberLabel}${escapeHtml(name)}${active ? '' : ' <em style="font-size:11px; color:var(--text-muted);">(inactive)</em>'}</span>
          <span class="games">${count} games</span>
          <span class="actions" style="display:inline-flex; gap:4px; margin-left:auto;">${roleBtns}</span>
        </div>
      `;
    })
    .join("");
};

// Render competitions (leagues) grid: registry ∪ game-derived leagues.
const renderLeagues = () => {
  const leaguesGrid = document.getElementById('leaguesGrid');
  const leagueCount = document.getElementById('leagueCount');
  if (!leaguesGrid) return;

  const registry = (window.basketStatData.getLeagues && window.basketStatData.getLeagues()) || [];
  const finishedList = (window.basketStatData.getFinishedLeagues && window.basketStatData.getFinishedLeagues()) || [];
  const finishedSet = new Set(finishedList.map((l) => String(l).toLowerCase()));
  const { games } = window.basketStatData.loadData();
  const fromGames = new Set(games.map((g) => g.league).filter(Boolean));
  const registrySet = new Set(registry);
  const all = Array.from(new Set([...registry, ...fromGames])).sort((a, b) => a.localeCompare(b));

  if (leagueCount) leagueCount.textContent = all.length;

  if (all.length === 0) {
    leaguesGrid.innerHTML = `<p class="empty-state">No competitions yet. Add one above.</p>`;
    return;
  }

  leaguesGrid.innerHTML = all
    .map((name) => {
      const inRegistry = registrySet.has(name);
      const isFinished = finishedSet.has(String(name).toLowerCase());
      // Finish/reopen only applies to registered competitions.
      const finishBtn = !inRegistry
        ? ''
        : isFinished
          ? `<button class="btn-icon" data-laction="reopen" data-name="${escapeHtml(name)}" title="Reopen for new games">
               <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
             </button>`
          : `<button class="btn-icon" data-laction="finish" data-name="${escapeHtml(name)}" title="Mark finished (hide from new games)">
               <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/></svg>
             </button>`;
      const removeBtn = inRegistry
        ? `<button class="btn-icon danger" data-laction="remove" data-name="${escapeHtml(name)}" title="Remove competition">
             <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
           </button>`
        : `<button class="btn-icon" data-laction="add" data-name="${escapeHtml(name)}" title="Add to registry">
             <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" x2="12" y1="5" y2="19"/><line x1="5" x2="19" y1="12" y2="12"/></svg>
           </button>`;
      const tag = isFinished
        ? ' <em style="font-size:11px; color:var(--text-muted);">(finished)</em>'
        : (inRegistry ? '' : ' <em style="font-size:11px; color:var(--text-muted);">(from games)</em>');
      return `
        <div class="player-chip"${isFinished ? ' style="opacity:0.7;"' : ''}>
          <span class="name">${escapeHtml(name)}${tag}</span>
          <span class="actions" style="display:inline-flex; gap:4px; margin-left:auto;">${finishBtn}${removeBtn}</span>
        </div>
      `;
    })
    .join("");
};

// Event delegation for game action buttons (view/edit/delete)
gamesTable.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;

  const row = btn.closest("tr[data-game-id]");
  if (!row) return;

  const gameId = row.dataset.gameId;
  const action = btn.dataset.action;
  const { games } = window.basketStatData.loadData();
  const game = games.find((g) => String(g.id) === String(gameId));
  if (!game) return;

  if (action === "view") {
    const locationLabel = game.homeAway === "home" ? "vs" : "@";
    statsModalTitle.textContent = `${formatDate(game.date)} ${locationLabel} ${game.opponent}`;

    const allStats = new Set();
    Object.values(game.performances || {}).forEach((stats) => {
      Object.keys(stats).forEach((key) => allStats.add(key));
    });
    const statKeys = Array.from(allStats);

    statsTableHead.innerHTML = `
      <tr>
        <th>Player</th>
        ${statKeys.map((key) => `<th>${escapeHtml(key)}</th>`).join("")}
      </tr>
    `;

    const players = Object.entries(game.performances || {}).sort(([a], [b]) => a.localeCompare(b));
    statsTableBody.innerHTML = players
      .map(([name, stats]) => `
        <tr>
          <td><strong>${escapeHtml(name)}</strong></td>
          ${statKeys.map((key) => `<td>${formatStatValue(stats[key], key)}</td>`).join("")}
        </tr>
      `)
      .join("");

    statsModal.classList.add("active");
  }

  if (action === "edit") {
    document.getElementById("editGameId").value = game.id;
    document.getElementById("editGameDate").value = game.date;
    document.getElementById("editOpponent").value = game.opponent;
    document.getElementById("editLeague").value = game.league || "";
    document.getElementById("editHomeAway").value = game.homeAway || "home";

    editGameModal.classList.add("active");
  }

  if (action === "delete") {
    const locationLabel = game.homeAway === "home" ? "vs" : "@";
    if (confirm(`Delete game: ${formatDate(game.date)} ${locationLabel} ${game.opponent}?`)) {
      window.basketStatData.deleteGame(gameId);
      renderGames();
      renderPlayers();
      renderLeagues();
      uploadStatus.textContent = "Deleted";
      uploadDetails.textContent = `Removed game vs ${game.opponent}`;
      await syncToCloudAfterChange();
    }
  }
});

// Close modals
const closeAllModals = () => {
  editGameModal.classList.remove("active");
  statsModal.classList.remove("active");
};

closeEditGame.addEventListener("click", closeAllModals);
cancelEditGame.addEventListener("click", closeAllModals);
closeStats.addEventListener("click", closeAllModals);
closeStatsBtn.addEventListener("click", closeAllModals);

editGameModal.addEventListener("click", (e) => {
  if (e.target === editGameModal) closeAllModals();
});
statsModal.addEventListener("click", (e) => {
  if (e.target === statsModal) closeAllModals();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeAllModals();
});

// Edit game form submit
editGameForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const gameId = document.getElementById("editGameId").value;
  const updates = {
    date: document.getElementById("editGameDate").value,
    opponent: document.getElementById("editOpponent").value.trim(),
    league: document.getElementById("editLeague").value.trim(),
    homeAway: document.getElementById("editHomeAway").value,
  };

  try {
    window.basketStatData.updateGame(gameId, updates);
    closeAllModals();
    renderGames();
    renderLeagues();
    uploadStatus.textContent = "✓ Updated";
    uploadDetails.textContent = `Game vs ${updates.opponent} updated`;
    await syncToCloudAfterChange();
  } catch (error) {
    uploadStatus.textContent = "✗ Error";
    uploadDetails.textContent = error.message;
  }
});

// Upload form submit
uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const date = document.getElementById("gameDate").value;
  const opponent = document.getElementById("opponent").value.trim();
  const league = document.getElementById("league").value.trim();
  const homeAway = document.getElementById("homeAway").value;
  const file = document.getElementById("csvFile").files[0];

  if (!date || !opponent || !league || !homeAway || !file) {
    uploadStatus.textContent = "Missing";
    uploadDetails.textContent = "Fill in all fields and select a CSV file";
    return;
  }

  try {
    const { performances, playersFound } = await window.basketStatData.parseCsv(file);

    const formData = new FormData();
    formData.append('csvFile', file);
    try {
      const uploadResponse = await fetch('/api/upload-csv', { method: 'POST', body: formData });
      if (uploadResponse.ok) {
        const result = await uploadResponse.json();
        console.log(`CSV saved to: ${result.path}`);
      }
    } catch (saveError) {
      console.warn('Could not save CSV to server (server may not be running):', saveError);
    }

    // Upload is a team-admin surface: it may register new players and the league.
    window.basketStatData.addGame({
      date, opponent, league, homeAway, performances, playersFound,
      csvFile: file.name
    });
    if (league && window.basketStatData.addLeague) window.basketStatData.addLeague(league);

    const playerCountVal = Object.keys(performances).length;
    uploadStatus.textContent = "Done";
    uploadDetails.textContent = `${playerCountVal} players - ${opponent} - ${homeAway === "home" ? "Home" : "Away"}`;
    uploadForm.reset();
    renderGames();
    renderPlayers();
    renderLeagues();
    syncToCloudAfterChange();
  } catch (error) {
    uploadStatus.textContent = "Error";
    uploadDetails.textContent = error.message;
  }
});

// Clear all data
clearData.addEventListener("click", async () => {
  if (confirm("Clear all stored games and player data? This cannot be undone.")) {
    window.basketStatData.saveData({ players: {}, games: [], leagues: [] });
    renderGames();
    renderPlayers();
    renderLeagues();
    uploadStatus.textContent = "Cleared";
    uploadDetails.textContent = "All data has been removed";
    await syncToCloudAfterChange();
  }
});

// ========================================
// PLAYER ROSTER MANAGEMENT
// ========================================

const newPlayerName = document.getElementById('newPlayerName');
const newPlayerNumber = document.getElementById('newPlayerNumber');
const addPlayerBtn = document.getElementById('addPlayerBtn');
const playerError = document.getElementById('playerError');

const showPlayerError = (msg) => {
  if (!playerError) { alert(msg); return; }
  playerError.textContent = msg;
  playerError.style.display = 'block';
};

async function submitAddPlayer() {
  if (playerError) playerError.style.display = 'none';
  const name = (newPlayerName.value || '').trim();
  if (!name) { showPlayerError('Enter a player name.'); newPlayerName.focus(); return; }

  const { players } = window.basketStatData.loadData();
  if (players[name]) { showPlayerError(`${name} is already on the roster.`); return; }

  const rawNum = (newPlayerNumber.value || '').trim();
  const number = rawNum === '' ? null : parseInt(rawNum, 10);
  const ok = await window.basketStatData.addPlayer(name, number);
  newPlayerName.value = '';
  newPlayerNumber.value = '';
  renderPlayers();
  reportTeamSave(ok, `Player ${name} added to roster`);
}

if (addPlayerBtn) addPlayerBtn.addEventListener('click', submitAddPlayer);
if (newPlayerName) newPlayerName.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); submitAddPlayer(); }
});

if (playersGrid) playersGrid.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-paction]');
  if (!btn) return;
  const name = btn.dataset.name;
  const action = btn.dataset.paction;

  let ok = true;
  let msg = '';
  if (action === 'edit-number') {
    const profile = window.basketStatData.getPlayerProfile(name);
    const current = (profile.number === 0 || profile.number) ? String(profile.number) : '';
    const next = prompt(`Jersey number for ${name}:`, current);
    if (next === null) return;
    const trimmed = next.trim();
    const number = trimmed === '' ? null : parseInt(trimmed, 10);
    if (trimmed !== '' && Number.isNaN(number)) { alert('Enter a valid number.'); return; }
    ok = await window.basketStatData.updatePlayer(name, { number });
    msg = `Updated ${name}`;
  } else if (action === 'activate' || action === 'deactivate') {
    ok = await window.basketStatData.setPlayerActive(name, action === 'activate');
    msg = `${name} ${action === 'activate' ? 'activated' : 'deactivated'}`;
  } else if (action === 'add-to-roster') {
    ok = await window.basketStatData.addPlayer(name, null);
    msg = `Player ${name} added to roster`;
  } else {
    return;
  }
  renderPlayers();
  reportTeamSave(ok, msg);
});

// ========================================
// COMPETITION (LEAGUE) MANAGEMENT
// ========================================

const newLeagueName = document.getElementById('newLeagueName');
const addLeagueBtn = document.getElementById('addLeagueBtn');
const leagueError = document.getElementById('leagueError');
const leaguesGrid = document.getElementById('leaguesGrid');

const showLeagueError = (msg) => {
  if (!leagueError) { alert(msg); return; }
  leagueError.textContent = msg;
  leagueError.style.display = 'block';
};

async function submitAddLeague() {
  if (leagueError) leagueError.style.display = 'none';
  const name = (newLeagueName.value || '').trim();
  if (!name) { showLeagueError('Enter a competition name.'); newLeagueName.focus(); return; }
  const existing = (window.basketStatData.getLeagues && window.basketStatData.getLeagues()) || [];
  if (existing.some((l) => l.toLowerCase() === name.toLowerCase())) {
    showLeagueError(`${name} is already registered.`);
    return;
  }
  const ok = await window.basketStatData.addLeague(name);
  newLeagueName.value = '';
  renderLeagues();
  reportTeamSave(ok, `Competition ${name} added`);
}

if (addLeagueBtn) addLeagueBtn.addEventListener('click', submitAddLeague);
if (newLeagueName) newLeagueName.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); submitAddLeague(); }
});

if (leaguesGrid) leaguesGrid.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-laction]');
  if (!btn) return;
  const name = btn.dataset.name;
  const action = btn.dataset.laction;
  let ok = true;
  let msg = '';
  if (action === 'add') {
    ok = await window.basketStatData.addLeague(name);
    msg = `Competition ${name} added`;
  } else if (action === 'remove') {
    if (!confirm(`Remove competition "${name}" from the registry? Games already tagged with it are unaffected.`)) return;
    ok = await window.basketStatData.removeLeague(name);
    msg = `Competition ${name} removed`;
  } else if (action === 'finish') {
    ok = await window.basketStatData.setLeagueFinished(name, true);
    msg = `Competition ${name} marked finished`;
  } else if (action === 'reopen') {
    ok = await window.basketStatData.setLeagueFinished(name, false);
    msg = `Competition ${name} reopened`;
  } else {
    return;
  }
  renderLeagues();
  reportTeamSave(ok, msg);
});

// ========================================
// EXPORT / IMPORT FUNCTIONALITY
// ========================================

const exportDataBtn = document.getElementById("exportData");
const importDataInput = document.getElementById("importData");

if (exportDataBtn) {
  exportDataBtn.addEventListener("click", () => {
    const data = window.basketStatData.loadData();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `basketstat-backup-${new Date().toISOString().split("T")[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    uploadStatus.textContent = "Exported";
    uploadDetails.textContent = "Data backup downloaded";
  });
}

if (importDataInput) {
  importDataInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (!data.players || !data.games || !Array.isArray(data.games)) {
        throw new Error("Invalid data format");
      }

      const existingData = window.basketStatData.loadData();
      const hasExisting = existingData.games.length > 0;

      let action = "replace";
      if (hasExisting) {
        action = confirm(
          `You have ${existingData.games.length} existing games.\n\n` +
          `OK = Replace all data with imported file\n` +
          `Cancel = Merge imported games with existing data`
        ) ? "replace" : "merge";
      }

      if (action === "replace") {
        window.basketStatData.saveData(data);
        uploadStatus.textContent = "Imported";
        uploadDetails.textContent = `${data.games.length} games loaded`;
      } else {
        const existingIds = new Set(existingData.games.map(g => g.id));
        const existingKeys = new Set(existingData.games.map(g => `${g.date}-${g.opponent}`));

        let added = 0;
        data.games.forEach(game => {
          const key = `${game.date}-${game.opponent}`;
          if (!existingIds.has(game.id) && !existingKeys.has(key)) {
            window.basketStatData.addGame(game);
            added++;
          }
        });

        Object.entries(data.players || {}).forEach(([name, info]) => {
          if (!existingData.players[name]) {
            existingData.players[name] = info;
          }
        });
        (data.leagues || []).forEach((l) => {
          if (l && window.basketStatData.addLeague) window.basketStatData.addLeague(l);
        });
        window.basketStatData.saveData(existingData);

        uploadStatus.textContent = "Merged";
        uploadDetails.textContent = `${added} new games added`;
      }

      renderGames();
      renderPlayers();
      renderLeagues();
      await syncToCloudAfterChange();
    } catch (error) {
      uploadStatus.textContent = "Error";
      uploadDetails.textContent = `Import failed: ${error.message}`;
    }

    importDataInput.value = "";
  });
}

// ========================================
// INITIAL RENDER
// ========================================
// Wait until the active team's data is hydrated (config.js) so we render the
// correct team rather than stale/empty cache.
(async () => {
  try {
    if (window.basketStatReady) await window.basketStatReady;
  } catch (e) {
    console.warn('Team bootstrap failed on admin page:', e);
  }

  const removedCount = window.basketStatData.cleanupData();
  if (removedCount > 0) {
    console.log(`Cleaned up ${removedCount} player entries with no valid stats`);
  }

  renderGames();
  renderPlayers();
  renderLeagues();
  loadTeamContext();
})();

// Make rebuild available globally for manual use
window.rebuildData = () => {
  const removed = window.basketStatData.cleanupData();
  renderGames();
  renderPlayers();
  renderLeagues();
  console.log(`Rebuild complete. Removed ${removed} invalid entries.`);
};

// ========================================
// MEMBER MANAGEMENT (active team)
// ========================================
// Teams CRUD lives on the platform page. Here we manage membership of the active
// team only, if the caller is a platform admin or an admin of that team.

const membersCard = document.getElementById('membersCard');
const membersTable = document.getElementById('membersTable');
const membersTeamName = document.getElementById('membersTeamName');
const memberUserSelect = document.getElementById('memberUser');
const addMemberBtn = document.getElementById('addMemberBtn');
const memberError = document.getElementById('memberError');

const TEAM_ROLES = ['admin', 'member', 'recorder'];
const TEAM_ROLE_LABELS = { admin: 'Admin', member: 'Member', recorder: 'Recorder' };

let manageTeamId = null;

// Resolve the active team + whether the caller can manage its members.
async function loadTeamContext() {
  try {
    const res = await fetch('/api/teams');
    if (!res.ok) return;
    const data = await res.json();
    const teams = data.teams || [];
    const isPlatformAdmin = !!data.isPlatformAdmin;

    const activeId = (window.BasketTeams && window.BasketTeams.activeId) || null;
    const active = teams.find(t => t.id === activeId) || teams[0];
    if (active) {
      const roles = active.roles || (active.role ? [active.role] : []);
      if (isPlatformAdmin || roles.includes('admin')) {
        openMembersFor(active.id, active.name);
      }
    }
  } catch (e) {
    console.error('Failed to load team context:', e);
  }
}

function openMembersFor(teamId, teamName) {
  manageTeamId = teamId;
  if (membersCard) membersCard.style.display = '';
  if (membersTeamName) membersTeamName.textContent = teamName || 'team';
  loadAssignableUsers(teamId);
  loadMembers(teamId);
}

async function loadAssignableUsers(teamId) {
  if (!memberUserSelect) return;
  try {
    const res = await fetch(`/api/teams/${teamId}/assignable-users`);
    if (!res.ok) {
      memberUserSelect.innerHTML = '<option value="">(cannot load users)</option>';
      return;
    }
    const data = await res.json();
    const users = data.users || [];
    if (!users.length) {
      memberUserSelect.innerHTML = '<option value="">No users available to add</option>';
      return;
    }
    memberUserSelect.innerHTML = '<option value="">Select a user…</option>' +
      users.map((u) => {
        const label = u.name ? `${u.name} (${u.email})` : u.email;
        return `<option value="${escapeHtml(u.id)}">${escapeHtml(label)}</option>`;
      }).join('');
  } catch (e) {
    memberUserSelect.innerHTML = '<option value="">(cannot load users)</option>';
  }
}

async function loadMembers(teamId) {
  if (!membersTable) return;
  membersTable.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">Loading...</td></tr>';
  try {
    const res = await fetch(`/api/teams/${teamId}/members`);
    if (!res.ok) {
      membersTable.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">Cannot load members</td></tr>';
      return;
    }
    const data = await res.json();
    renderMembers(data.members || []);
  } catch (e) {
    console.error('Failed to load members:', e);
    membersTable.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--negative);">Failed to load members</td></tr>';
  }
}

function renderMembers(members) {
  if (!membersTable) return;
  if (!members.length) {
    membersTable.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">No members yet</td></tr>';
    return;
  }
  membersTable.innerHTML = members.map((m) => {
    const roles = m.teamRoles || (m.teamRole ? [m.teamRole] : []);
    const roleChecks = TEAM_ROLES.map((r) => `
      <label style="display:inline-flex; gap:3px; align-items:center; font-size:12px; margin-right:8px;">
        <input type="checkbox" data-maction="role" data-id="${escapeHtml(m.id)}" data-role="${r}"${roles.includes(r) ? ' checked' : ''} />
        ${TEAM_ROLE_LABELS[r]}
      </label>`).join('');
    return `
    <tr data-id="${escapeHtml(m.id)}">
      <td style="font-size:12px;">${escapeHtml(m.email)}</td>
      <td style="font-size:12px;">${escapeHtml(m.name) || '—'}</td>
      <td>${roleChecks}</td>
      <td><button class="danger-link" data-maction="remove" data-id="${escapeHtml(m.id)}" data-email="${escapeHtml(m.email)}" style="font-size:11px; padding:4px 8px;">Remove</button></td>
    </tr>`;
  }).join('');
}

const showMemberError = (msg) => {
  if (!memberError) { alert(msg); return; }
  memberError.textContent = msg;
  memberError.style.display = 'block';
};

function selectedAddRoles() {
  return Array.from(document.querySelectorAll('.member-add-role'))
    .filter((c) => c.checked)
    .map((c) => c.value);
}

async function submitAddMember() {
  if (memberError) memberError.style.display = 'none';
  if (!manageTeamId) {
    showMemberError('No team selected.');
    return;
  }
  const userId = memberUserSelect ? memberUserSelect.value : '';
  if (!userId) {
    showMemberError('Select a user to add.');
    return;
  }
  const roles = selectedAddRoles();
  if (!roles.length) {
    showMemberError('Select at least one role.');
    return;
  }
  try {
    const res = await fetch(`/api/teams/${manageTeamId}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, roles })
    });
    const data = await res.json();
    if (!res.ok) {
      showMemberError(data.error || 'Failed to add member');
      return;
    }
    await loadMembers(manageTeamId);
    await loadAssignableUsers(manageTeamId);
  } catch (e) {
    showMemberError('Connection error. Please try again.');
  }
}

if (addMemberBtn) addMemberBtn.addEventListener('click', submitAddMember);

// Member row: role checkbox change -> PATCH the full roles[] for that member.
if (membersTable) membersTable.addEventListener('change', async (e) => {
  const cb = e.target.closest('input[data-maction="role"]');
  if (!cb || !manageTeamId) return;
  const id = cb.dataset.id;
  const row = cb.closest('tr[data-id]');
  const roles = Array.from(row.querySelectorAll('input[data-maction="role"]'))
    .filter((c) => c.checked)
    .map((c) => c.dataset.role);
  try {
    const res = await fetch(`/api/teams/${manageTeamId}/members/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roles })
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Failed to update roles'); await loadMembers(manageTeamId); }
  } catch (err) {
    alert('Failed to update roles.');
    await loadMembers(manageTeamId);
  }
});

// Member row: remove
if (membersTable) membersTable.addEventListener('click', async (e) => {
  const trigger = e.target.closest('[data-maction="remove"]');
  if (!trigger || !manageTeamId) return;
  const id = trigger.dataset.id;
  const email = trigger.dataset.email || '';
  if (!confirm(`Remove ${email} from this team?`)) return;
  try {
    const res = await fetch(`/api/teams/${manageTeamId}/members/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) return alert(data.error || 'Failed to remove member');
    await loadMembers(manageTeamId);
    await loadAssignableUsers(manageTeamId);
  } catch (err) {
    alert('Failed to remove member.');
  }
});

// ========================================
// PENDING RECORDINGS (from the mobile recorder)
// ========================================
// Drafts recorded on mobile are shown here for review + import. Importing runs
// the standard addGame() pipeline (applying per-game jersey numbers) and then
// deletes the draft. Nothing enters the stats until an admin imports.

const pendingTable = document.getElementById('pendingTable');
const pendingCount = document.getElementById('pendingCount');
const refreshPending = document.getElementById('refreshPending');
const reviewDraftModal = document.getElementById('reviewDraftModal');
const reviewDraftTitle = document.getElementById('reviewDraftTitle');
const reviewDraftMeta = document.getElementById('reviewDraftMeta');
const reviewDraftHead = document.getElementById('reviewDraftHead');
const reviewDraftBody = document.getElementById('reviewDraftBody');
const importDraftBtn = document.getElementById('importDraftBtn');

let pendingDraftsCache = [];
let reviewingDraftId = null;

/** Build performances for a draft, preferring a live recompute of its events. */
function draftPerformances(draft) {
  if (window.recorderAggregator && Array.isArray(draft.events)) {
    return window.recorderAggregator.eventsToPerformances(draft);
  }
  return (draft.boxScore && draft.boxScore.performances) || {};
}

/** Build the { name: { number, active } } registry map from a draft roster. */
function draftPlayersFound(draft) {
  const out = {};
  (draft.roster || []).forEach((r) => {
    if (!r || !r.name) return;
    out[r.name] = { number: (r.number === 0 || r.number) ? r.number : null, active: true };
  });
  return out;
}

async function loadPendingDrafts() {
  if (!pendingTable) return;
  const teamId = window.basketStatData.getActiveTeam && window.basketStatData.getActiveTeam();
  if (!teamId) {
    pendingTable.innerHTML = '<tr><td colspan="6" style="text-align:center; color: var(--text-muted);">No active team</td></tr>';
    if (pendingCount) pendingCount.textContent = '0';
    return;
  }
  pendingTable.innerHTML = '<tr><td colspan="6" style="text-align:center; color: var(--text-muted);">Loading…</td></tr>';
  try {
    const res = await fetch(`/api/teams/${encodeURIComponent(teamId)}/drafts`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load');
    pendingDraftsCache = data.drafts || [];
    renderPendingDrafts();
  } catch (e) {
    pendingTable.innerHTML = `<tr><td colspan="6" style="text-align:center; color: var(--negative);">${escapeHtml(e.message)}</td></tr>`;
  }
}

function renderPendingDrafts() {
  if (pendingCount) pendingCount.textContent = String(pendingDraftsCache.length);
  if (!pendingDraftsCache.length) {
    pendingTable.innerHTML = '<tr><td colspan="6" style="text-align:center; color: var(--text-muted);">No pending recordings</td></tr>';
    return;
  }
  pendingTable.innerHTML = pendingDraftsCache.map((d) => {
    const m = d.meta || {};
    const status = d.status === 'completed'
      ? '<span style="color: var(--positive); font-size:12px;">● complete</span>'
      : '<span style="color: var(--text-muted); font-size:12px;">○ in progress</span>';
    return `
      <tr data-draft-id="${escapeHtml(d.id)}">
        <td style="font-size:12px;">${escapeHtml(m.date || '')}</td>
        <td style="font-size:12px;">${escapeHtml(m.opponent || '')}</td>
        <td style="font-size:12px;">${escapeHtml(m.league || '')}</td>
        <td style="font-size:12px;">${escapeHtml(m.homeAway || '')}</td>
        <td>${status}</td>
        <td style="white-space:nowrap; display:flex; gap:4px; flex-wrap:wrap;">
          <button class="secondary" data-draft-action="review" data-id="${escapeHtml(d.id)}" style="font-size:11px; padding:4px 8px;">Review</button>
          <button class="secondary" data-draft-action="import" data-id="${escapeHtml(d.id)}" style="font-size:11px; padding:4px 8px;">Import</button>
          <button class="danger-link" data-draft-action="discard" data-id="${escapeHtml(d.id)}" style="font-size:11px; padding:4px 8px;">Discard</button>
        </td>
      </tr>`;
  }).join('');
}

function openReviewDraft(draft) {
  reviewingDraftId = draft.id;
  const m = draft.meta || {};
  reviewDraftTitle.textContent = `Review — ${m.opponent || ''}`;
  reviewDraftMeta.textContent = `${m.date || ''} · ${m.league || ''} · ${m.homeAway === 'away' ? 'Away' : 'Home'} · ${(draft.events || []).length} events`;

  const perf = draftPerformances(draft);
  const cols = ['pts', 'fg', '3pt', 'ft', 'oreb', 'dreb', 'reb', 'asst', 'stl', 'blk', 'to', 'foul', '+/-', 'min'];
  reviewDraftHead.innerHTML = '<tr><th style="text-align:left;">Player</th>' +
    cols.map((c) => `<th>${c.toUpperCase()}</th>`).join('') + '</tr>';

  const numberOf = (name) => {
    const r = (draft.roster || []).find((x) => x.name === name);
    return r && (r.number === 0 || r.number) ? r.number : '';
  };
  const rows = Object.keys(perf)
    .sort((a, b) => (perf[b].pts || 0) - (perf[a].pts || 0))
    .map((name) => {
      const s = perf[name];
      const withReb = Object.assign({ reb: (s.oreb || 0) + (s.dreb || 0) }, s);
      const cells = cols.map((c) => `<td style="text-align:right;">${formatStatValue(withReb[c], c)}</td>`).join('');
      return `<tr><td style="text-align:left;">#${escapeHtml(String(numberOf(name)))} ${escapeHtml(name)}</td>${cells}</tr>`;
    }).join('');
  reviewDraftBody.innerHTML = rows || '<tr><td colspan="15" style="text-align:center; color: var(--text-muted);">No players with stats</td></tr>';

  reviewDraftModal.classList.add('active');
}

function closeReviewDraft() {
  reviewDraftModal.classList.remove('active');
  reviewingDraftId = null;
}

async function importDraft(draftId) {
  const draft = pendingDraftsCache.find((d) => String(d.id) === String(draftId));
  if (!draft) return;
  const teamId = window.basketStatData.getActiveTeam && window.basketStatData.getActiveTeam();
  if (!teamId) { alert('No active team selected.'); return; }

  const performances = draftPerformances(draft);
  if (!Object.keys(performances).length &&
      !confirm('This recording has no players with stats. Import anyway?')) {
    return;
  }
  const m = draft.meta || {};
  try {
    window.basketStatData.addGame({
      date: m.date,
      opponent: m.opponent,
      league: m.league,
      homeAway: m.homeAway || 'home',
      performances,
      playersFound: draftPlayersFound(draft),
      csvFile: null
    });
    // Register the game's competition so it shows in the team's league registry
    // (Competitions list, recorder new-game dropdown) — not just as a game tag.
    // Mirrors the CSV import path. addLeague is a no-op for already-known leagues.
    if (m.league && window.basketStatData.addLeague) {
      await window.basketStatData.addLeague(m.league);
    }
    const ok = await window.basketStatData.saveToServer();
    if (!ok) {
      alert('Game added locally but saving to the server failed. Try again.');
      return;
    }
    await fetch(`/api/teams/${encodeURIComponent(teamId)}/drafts/${encodeURIComponent(draft.id)}`, { method: 'DELETE' });
    closeReviewDraft();
    await loadPendingDrafts();
    renderGames();
    renderPlayers();
    renderLeagues();
    if (uploadStatus) uploadStatus.textContent = 'Imported';
    if (uploadDetails) uploadDetails.textContent = `${Object.keys(performances).length} players · ${m.opponent || ''}`;
  } catch (e) {
    alert('Import failed: ' + e.message);
  }
}

async function discardDraft(draftId) {
  const teamId = window.basketStatData.getActiveTeam && window.basketStatData.getActiveTeam();
  if (!teamId) return;
  if (!confirm('Discard this recording? This cannot be undone.')) return;
  try {
    const res = await fetch(`/api/teams/${encodeURIComponent(teamId)}/drafts/${encodeURIComponent(draftId)}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to delete');
    }
    await loadPendingDrafts();
  } catch (e) {
    alert('Discard failed: ' + e.message);
  }
}

if (pendingTable) {
  pendingTable.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-draft-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    const action = btn.dataset.draftAction;
    if (action === 'review') {
      const draft = pendingDraftsCache.find((d) => String(d.id) === String(id));
      if (draft) openReviewDraft(draft);
    } else if (action === 'import') {
      importDraft(id);
    } else if (action === 'discard') {
      discardDraft(id);
    }
  });
}
if (refreshPending) refreshPending.addEventListener('click', loadPendingDrafts);
if (importDraftBtn) importDraftBtn.addEventListener('click', () => { if (reviewingDraftId) importDraft(reviewingDraftId); });
if (document.getElementById('closeReviewDraft')) document.getElementById('closeReviewDraft').addEventListener('click', closeReviewDraft);
if (document.getElementById('cancelReviewDraft')) document.getElementById('cancelReviewDraft').addEventListener('click', closeReviewDraft);
if (reviewDraftModal) reviewDraftModal.addEventListener('click', (e) => { if (e.target === reviewDraftModal) closeReviewDraft(); });

// Load pending recordings once the active team is hydrated.
(async () => {
  try { if (window.basketStatReady) await window.basketStatReady; } catch (e) { /* ignore */ }
  loadPendingDrafts();
})();
