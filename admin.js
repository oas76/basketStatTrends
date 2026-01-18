// DOM Elements
const uploadForm = document.getElementById("uploadForm");
const uploadStatus = document.getElementById("uploadStatus");
const uploadDetails = document.getElementById("uploadDetails");
const gamesTable = document.getElementById("gamesTable");
const playersTable = document.getElementById("playersTable");
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
const formatStatValue = (value) => {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object" && "made" in value && "attempted" in value) {
    return `${value.made}-${value.attempted}`;
  }
  return String(value);
};

// Render games table
const renderGames = () => {
  const { games } = window.basketStatData.loadData();
  
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
      const playerCount = playerNames.length;
      const locationLabel = game.homeAway === "home" ? "Home" : "Away";
      
      return `
        <tr data-game-id="${game.id}">
          <td>${formatDate(game.date)}</td>
          <td>${game.opponent}</td>
          <td>${game.league || "—"}</td>
          <td>${locationLabel}</td>
          <td>${playerCount} players</td>
          <td class="actions">
            <button class="btn-icon" onclick="viewGameStats('${game.id}')" title="View Stats">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
            <button class="btn-icon" onclick="editGame('${game.id}')" title="Edit">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
            </button>
            <button class="btn-icon danger" onclick="deleteGame('${game.id}')" title="Delete">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
            </button>
          </td>
        </tr>
      `;
    })
    .join("");
};

// Render players table
const renderPlayers = () => {
  const { players, games } = window.basketStatData.loadData();
  
  // Count games per player
  const gamesPlayed = {};
  games.forEach((game) => {
    Object.keys(game.performances || {}).forEach((name) => {
      gamesPlayed[name] = (gamesPlayed[name] || 0) + 1;
    });
  });

  // Get all unique player names from games (in case player registry is incomplete)
  const allPlayers = new Set([...Object.keys(players), ...Object.keys(gamesPlayed)]);
  
  if (allPlayers.size === 0) {
    playersTable.innerHTML = `
      <tr>
        <td colspan="3" class="empty-state">No players yet</td>
      </tr>
    `;
    return;
  }

  const sortedPlayers = Array.from(allPlayers).sort((a, b) => a.localeCompare(b));

  playersTable.innerHTML = sortedPlayers
    .map((name) => {
      const info = players[name] || {};
      const count = gamesPlayed[name] || 0;
      return `
        <tr>
          <td>${info.number || "—"}</td>
          <td>${name}</td>
          <td>${count}</td>
        </tr>
      `;
    })
    .join("");
};

// View game stats
window.viewGameStats = (gameId) => {
  const { games } = window.basketStatData.loadData();
  const game = games.find((g) => g.id === gameId);
  
  if (!game) return;

  const locationLabel = game.homeAway === "home" ? "vs" : "@";
  statsModalTitle.textContent = `${formatDate(game.date)} ${locationLabel} ${game.opponent}`;

  // Get all stat keys
  const allStats = new Set();
  Object.values(game.performances || {}).forEach((stats) => {
    Object.keys(stats).forEach((key) => allStats.add(key));
  });
  const statKeys = Array.from(allStats);

  // Build header
  statsTableHead.innerHTML = `
    <tr>
      <th>Player</th>
      ${statKeys.map((key) => `<th>${key}</th>`).join("")}
    </tr>
  `;

  // Build body
  const players = Object.entries(game.performances || {}).sort(([a], [b]) => a.localeCompare(b));
  statsTableBody.innerHTML = players
    .map(([name, stats]) => `
      <tr>
        <td><strong>${name}</strong></td>
        ${statKeys.map((key) => `<td>${formatStatValue(stats[key])}</td>`).join("")}
      </tr>
    `)
    .join("");

  statsModal.classList.add("active");
};

// Edit game
window.editGame = (gameId) => {
  const { games } = window.basketStatData.loadData();
  const game = games.find((g) => g.id === gameId);
  
  if (!game) return;

  document.getElementById("editGameId").value = game.id;
  document.getElementById("editGameDate").value = game.date;
  document.getElementById("editOpponent").value = game.opponent;
  document.getElementById("editLeague").value = game.league || "";
  document.getElementById("editHomeAway").value = game.homeAway || "home";

  editGameModal.classList.add("active");
};

// Delete game
window.deleteGame = (gameId) => {
  const { games } = window.basketStatData.loadData();
  const game = games.find((g) => g.id === gameId);
  
  if (!game) return;

  const locationLabel = game.homeAway === "home" ? "vs" : "@";
  if (confirm(`Delete game: ${formatDate(game.date)} ${locationLabel} ${game.opponent}?`)) {
    window.basketStatData.deleteGame(gameId);
    renderGames();
    renderPlayers();
    uploadStatus.textContent = "Deleted";
    uploadDetails.textContent = `Removed game vs ${game.opponent}`;
  }
};

// Close modals
const closeAllModals = () => {
  editGameModal.classList.remove("active");
  statsModal.classList.remove("active");
};

closeEditGame.addEventListener("click", closeAllModals);
cancelEditGame.addEventListener("click", closeAllModals);
closeStats.addEventListener("click", closeAllModals);
closeStatsBtn.addEventListener("click", closeAllModals);

// Close modal on overlay click
editGameModal.addEventListener("click", (e) => {
  if (e.target === editGameModal) closeAllModals();
});
statsModal.addEventListener("click", (e) => {
  if (e.target === statsModal) closeAllModals();
});

// Close modal on Escape key
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeAllModals();
});

// Edit game form submit
editGameForm.addEventListener("submit", (e) => {
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
    uploadStatus.textContent = "✓ Updated";
    uploadDetails.textContent = `Game vs ${updates.opponent} updated`;
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
    
    window.basketStatData.addGame({
      date,
      opponent,
      league,
      homeAway,
      performances,
      playersFound,
    });

    const playerCount = Object.keys(performances).length;
    uploadStatus.textContent = "✓ Done";
    uploadDetails.textContent = `${playerCount} players · ${opponent} · ${homeAway === "home" ? "Home" : "Away"}`;
    uploadForm.reset();
    renderGames();
    renderPlayers();
  } catch (error) {
    uploadStatus.textContent = "✗ Error";
    uploadDetails.textContent = error.message;
  }
});

// Clear all data
clearData.addEventListener("click", () => {
  if (confirm("Clear all stored games and player data? This cannot be undone.")) {
    window.basketStatData.saveData({ players: {}, games: [] });
    renderGames();
    renderPlayers();
    uploadStatus.textContent = "Cleared";
    uploadDetails.textContent = "All data has been removed";
  }
});

// Initial render
renderGames();
renderPlayers();