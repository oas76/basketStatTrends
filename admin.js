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
  const { players } = window.basketStatData.loadData();
  
  // Count games per player (only counting games with valid stats)
  const gamesPlayed = window.basketStatData.getPlayerGameCounts();

  // Get all unique player names from games
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
    // Parse CSV data
    const { performances, playersFound } = await window.basketStatData.parseCsv(file);
    
    // Save CSV file to server
    const formData = new FormData();
    formData.append('csvFile', file);
    
    try {
      const uploadResponse = await fetch('/api/upload-csv', {
        method: 'POST',
        body: formData
      });
      
      if (uploadResponse.ok) {
        const result = await uploadResponse.json();
        console.log(`CSV saved to: ${result.path}`);
      }
    } catch (saveError) {
      console.warn('Could not save CSV to server (server may not be running):', saveError);
    }
    
    // Add game to local storage
    window.basketStatData.addGame({
      date,
      opponent,
      league,
      homeAway,
      performances,
      playersFound,
      csvFile: file.name // Store reference to CSV filename
    });

    const playerCount = Object.keys(performances).length;
    uploadStatus.textContent = "Done";
    uploadDetails.textContent = `${playerCount} players - ${opponent} - ${homeAway === "home" ? "Home" : "Away"}`;
    uploadForm.reset();
    renderGames();
    renderPlayers();
  } catch (error) {
    uploadStatus.textContent = "Error";
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

// ========================================
// EXPORT / IMPORT FUNCTIONALITY
// ========================================

const exportDataBtn = document.getElementById("exportData");
const importDataInput = document.getElementById("importData");

// Export data as JSON file
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

// Import data from JSON file
if (importDataInput) {
  importDataInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      
      // Validate basic structure
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
        // Merge: add games that don't exist (by ID or date+opponent)
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
        
        // Merge players
        Object.entries(data.players || {}).forEach(([name, info]) => {
          if (!existingData.players[name]) {
            existingData.players[name] = info;
          }
        });
        window.basketStatData.saveData(window.basketStatData.loadData());
        
        uploadStatus.textContent = "Merged";
        uploadDetails.textContent = `${added} new games added`;
      }
      
      renderGames();
      renderPlayers();
    } catch (error) {
      uploadStatus.textContent = "Error";
      uploadDetails.textContent = `Import failed: ${error.message}`;
    }
    
    // Reset file input
    importDataInput.value = "";
  });
}

// ========================================
// JSONBIN.IO CLOUD SYNC (Shared Storage)
// ========================================
// Configuration is in config.js - shared by all users

const JSONBIN_API_URL = "https://api.jsonbin.io/v3/b";

// Cloud sync DOM elements
const cloudStatusText = document.getElementById("cloudStatusText");
const cloudSyncUpBtn = document.getElementById("cloudSyncUp");
const cloudSyncDownBtn = document.getElementById("cloudSyncDown");

// Get config from global CLOUD_CONFIG (set in config.js)
const getCloudConfig = () => {
  return window.CLOUD_CONFIG || { apiKey: "", binId: "" };
};

// Update cloud sync UI based on config
const updateCloudSyncUI = () => {
  const config = getCloudConfig();
  
  if (config.apiKey) {
    cloudStatusText.textContent = config.binId 
      ? `☁️ Connected (Bin: ${config.binId.slice(0, 8)}...)`
      : "☁️ Ready - will create new bin on first upload";
    cloudSyncUpBtn.disabled = false;
    cloudSyncDownBtn.disabled = !config.binId;
  } else {
    cloudStatusText.textContent = "⚠️ Not configured - edit config.js";
    cloudSyncUpBtn.disabled = true;
    cloudSyncDownBtn.disabled = true;
  }
};

// Create a new bin on JSONbin.io
const createBin = async (apiKey, data) => {
  const response = await fetch(JSONBIN_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Master-Key": apiKey,
      "X-Bin-Name": "BasketStat Data"
    },
    body: JSON.stringify(data)
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || `Failed to create bin: ${response.status}`);
  }
  
  const result = await response.json();
  return result.metadata.id;
};

// Update existing bin on JSONbin.io
const updateBin = async (apiKey, binId, data) => {
  const response = await fetch(`${JSONBIN_API_URL}/${binId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Master-Key": apiKey
    },
    body: JSON.stringify(data)
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || `Failed to update bin: ${response.status}`);
  }
  
  return await response.json();
};

// Read bin from JSONbin.io
const readBin = async (apiKey, binId) => {
  const response = await fetch(`${JSONBIN_API_URL}/${binId}/latest`, {
    method: "GET",
    headers: {
      "X-Master-Key": apiKey
    }
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || `Failed to read bin: ${response.status}`);
  }
  
  const result = await response.json();
  return result.record;
};

// Upload to cloud
if (cloudSyncUpBtn) {
  cloudSyncUpBtn.addEventListener("click", async () => {
    const config = getCloudConfig();
    if (!config.apiKey) {
      uploadStatus.textContent = "Error";
      uploadDetails.textContent = "Add apiKey to config.js";
      return;
    }
    
    try {
      cloudSyncUpBtn.disabled = true;
      cloudSyncUpBtn.textContent = "Uploading...";
      
      const localData = window.basketStatData.loadData();
      
      if (localData.games.length === 0) {
        uploadStatus.textContent = "No data";
        uploadDetails.textContent = "No local data to upload";
        return;
      }
      
      let binId = config.binId;
      
      if (!binId) {
        // Create new bin
        binId = await createBin(config.apiKey, localData);
        console.log("=== NEW BIN CREATED ===");
        console.log("Add this to config.js:");
        console.log(`binId: "${binId}"`);
        console.log("=======================");
        
        uploadStatus.textContent = "Uploaded!";
        uploadDetails.textContent = `New bin created. Copy bin ID from console to config.js: ${binId}`;
        
        // Also show in alert for easy copying
        alert(`New bin created!\n\nBin ID: ${binId}\n\nCopy this to config.js and redeploy.`);
      } else {
        // Update existing bin
        await updateBin(config.apiKey, binId, localData);
        uploadStatus.textContent = "Uploaded";
        uploadDetails.textContent = `${localData.games.length} games synced to cloud`;
      }
      
      updateCloudSyncUI();
    } catch (error) {
      uploadStatus.textContent = "Upload failed";
      uploadDetails.textContent = error.message;
    } finally {
      cloudSyncUpBtn.disabled = false;
      cloudSyncUpBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17V3"/><path d="m6 11 6-8 6 8"/><path d="M19 21H5"/></svg>
        Upload to Cloud
      `;
    }
  });
}

// Download from cloud
if (cloudSyncDownBtn) {
  cloudSyncDownBtn.addEventListener("click", async () => {
    const config = getCloudConfig();
    if (!config.apiKey || !config.binId) {
      uploadStatus.textContent = "Error";
      uploadDetails.textContent = !config.apiKey ? "Add apiKey to config.js" : "Add binId to config.js (upload first)";
      return;
    }
    
    try {
      cloudSyncDownBtn.disabled = true;
      cloudSyncDownBtn.textContent = "Downloading...";
      
      const cloudData = await readBin(config.apiKey, config.binId);
      
      // Validate data structure
      if (!cloudData || !cloudData.games || !Array.isArray(cloudData.games)) {
        throw new Error("Invalid data in cloud");
      }
      
      const localData = window.basketStatData.loadData();
      const hasLocal = localData.games.length > 0;
      
      if (hasLocal) {
        const action = confirm(
          `You have ${localData.games.length} local games.\n` +
          `Cloud has ${cloudData.games.length} games.\n\n` +
          `OK = Replace local with cloud data\n` +
          `Cancel = Keep local data`
        );
        
        if (!action) {
          uploadStatus.textContent = "Cancelled";
          uploadDetails.textContent = "Local data kept";
          return;
        }
      }
      
      window.basketStatData.saveData(cloudData);
      renderGames();
      renderPlayers();
      
      uploadStatus.textContent = "Downloaded";
      uploadDetails.textContent = `${cloudData.games.length} games loaded from cloud`;
    } catch (error) {
      uploadStatus.textContent = "Download failed";
      uploadDetails.textContent = error.message;
    } finally {
      cloudSyncDownBtn.disabled = false;
      cloudSyncDownBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v14"/><path d="m6 13 6 8 6-8"/><path d="M19 21H5"/></svg>
        Download from Cloud
      `;
    }
  });
}

// Initialize cloud sync UI
updateCloudSyncUI();

// Initial render
// Clean up any existing data with players who have no valid stats
const removedCount = window.basketStatData.cleanupData();
if (removedCount > 0) {
  console.log(`Cleaned up ${removedCount} player entries with no valid stats`);
}

renderGames();
renderPlayers();

// Report player game counts to console
const reportPlayerCounts = () => {
  const counts = window.basketStatData.getPlayerGameCounts();
  console.log("=== Player Game Counts ===");
  const sorted = Object.entries(counts).sort(([,a], [,b]) => b - a);
  sorted.forEach(([name, count]) => console.log(`  ${name}: ${count} game(s)`));
  console.log(`Total: ${sorted.length} players with games`);
  return counts;
};
reportPlayerCounts();

// Make rebuild available globally for manual use
window.rebuildData = () => {
  const removed = window.basketStatData.cleanupData();
  renderGames();
  renderPlayers();
  console.log(`Rebuild complete. Removed ${removed} invalid entries.`);
  return reportPlayerCounts();
};