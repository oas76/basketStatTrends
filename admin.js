// DOM Elements
const uploadForm = document.getElementById("uploadForm");
const uploadStatus = document.getElementById("uploadStatus");
const uploadDetails = document.getElementById("uploadDetails");
const gamesTable = document.getElementById("gamesTable");
const playersGrid = document.getElementById("playersGrid");
const gameCount = document.getElementById("gameCount");
const playerCount = document.getElementById("playerCount");
const cloudBadge = document.getElementById("cloudBadge");
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

/**
 * Sync data to cloud after a change (upload, delete, etc.)
 */
async function syncToCloudAfterChange() {
  // Multi-team: persist the active team's data to the server (per-team Blob).
  // saveData() already schedules a debounced write; this forces it immediately
  // so the admin sees a confirmed save.
  try {
    if (!window.basketStatData.getActiveTeam || !window.basketStatData.getActiveTeam()) {
      console.log('No active team; skipping server sync');
      return;
    }
    const ok = await window.basketStatData.saveToServer();
    if (ok) {
      console.log('Data saved to team storage');
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
  
  // Update count
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
          <td>${game.opponent}</td>
          <td>${game.league || "—"}</td>
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

// Render players grid
const renderPlayers = () => {
  const { players } = window.basketStatData.loadData();
  
  // Count games per player (only counting games with valid stats)
  const gamesPlayed = window.basketStatData.getPlayerGameCounts();

  // Get all unique player names from games
  const allPlayers = new Set([...Object.keys(players), ...Object.keys(gamesPlayed)]);
  
  // Update count
  if (playerCount) playerCount.textContent = allPlayers.size;
  
  if (!playersGrid) return;
  
  if (allPlayers.size === 0) {
    playersGrid.innerHTML = `<p class="empty-state">No players yet</p>`;
    return;
  }

  const sortedPlayers = Array.from(allPlayers).sort((a, b) => {
    // Sort by games played (descending), then by name
    const countA = gamesPlayed[a] || 0;
    const countB = gamesPlayed[b] || 0;
    if (countB !== countA) return countB - countA;
    return a.localeCompare(b);
  });

  playersGrid.innerHTML = sortedPlayers
    .map((name) => {
      const count = gamesPlayed[name] || 0;
      return `
        <div class="player-chip">
          <span class="name">${name}</span>
          <span class="games">${count} games</span>
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
  if (!row) {
    console.error("Action button clicked but no parent row with data-game-id found");
    return;
  }

  const gameId = row.dataset.gameId;
  const action = btn.dataset.action;
  const { games } = window.basketStatData.loadData();
  const game = games.find((g) => String(g.id) === String(gameId));

  if (!game) {
    console.error(`Game not found for id "${gameId}" (type: ${typeof gameId}). Stored ids:`, games.map(g => g.id));
    return;
  }

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
        ${statKeys.map((key) => `<th>${key}</th>`).join("")}
      </tr>
    `;

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
    uploadStatus.textContent = "✓ Updated";
    uploadDetails.textContent = `Game vs ${updates.opponent} updated`;
    
    // Sync edit to cloud
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
    
    // Sync to cloud after upload
    syncToCloudAfterChange();
  } catch (error) {
    uploadStatus.textContent = "Error";
    uploadDetails.textContent = error.message;
  }
});

// Clear all data
clearData.addEventListener("click", async () => {
  if (confirm("Clear all stored games and player data? This cannot be undone.")) {
    window.basketStatData.saveData({ players: {}, games: [] });
    renderGames();
    renderPlayers();
    uploadStatus.textContent = "Cleared";
    uploadDetails.textContent = "All data has been removed";
    
    // Sync the clear to cloud
    await syncToCloudAfterChange();
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
        window.basketStatData.saveData(existingData);
        
        uploadStatus.textContent = "Merged";
        uploadDetails.textContent = `${added} new games added`;
      }
      
      renderGames();
      renderPlayers();
      
      // Sync import to cloud
      await syncToCloudAfterChange();
    } catch (error) {
      uploadStatus.textContent = "Error";
      uploadDetails.textContent = `Import failed: ${error.message}`;
    }
    
    // Reset file input
    importDataInput.value = "";
  });
}

// ========================================
// CLOUD SYNC VIA SERVER PROXY
// ========================================
// API keys are now stored server-side in .env
// Client calls server proxy endpoints instead of JSONbin directly

// Cloud sync DOM elements
const cloudStatusText = document.getElementById("cloudStatusText");
const cloudSyncUpBtn = document.getElementById("cloudSyncUp");
const cloudSyncDownBtn = document.getElementById("cloudSyncDown");

// Cloud status cache
let cloudStatus = { configured: false, hasBin: false, binIdPrefix: null };

// Fetch cloud status from server
const fetchCloudStatus = async () => {
  try {
    const response = await fetch('/api/cloud/status');
    cloudStatus = await response.json();
    return cloudStatus;
  } catch (error) {
    console.warn('Failed to fetch cloud status:', error);
    return { configured: false, hasBin: false, binIdPrefix: null };
  }
};

// Update sync UI. Multi-team: data now persists per-team on the server
// automatically; the buttons force an explicit push/pull for the active team.
const updateCloudSyncUI = async () => {
  const ctx = window.BasketTeams || {};
  const active = (ctx.list || []).find(t => t.id === ctx.activeId);
  const hasTeam = !!active;

  if (cloudStatusText) {
    cloudStatusText.textContent = hasTeam
      ? `Team storage: ${active.name} (auto-saved)`
      : 'No active team';
  }
  if (cloudBadge) {
    cloudBadge.textContent = hasTeam ? 'Auto-saved' : 'No team';
    cloudBadge.className = hasTeam ? 'badge connected' : 'badge';
  }
  if (cloudSyncUpBtn) cloudSyncUpBtn.disabled = !hasTeam;
  if (cloudSyncDownBtn) cloudSyncDownBtn.disabled = !hasTeam;
};

// Create a new bin via server proxy
const createBin = async (data) => {
  const response = await fetch('/api/cloud/create', {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(data)
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || `Failed to create bin: ${response.status}`);
  }
  
  const result = await response.json();
  return result.binId;
};

// Update existing bin via server proxy
const updateBin = async (data) => {
  const response = await fetch('/api/cloud/data', {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(data)
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || `Failed to update bin: ${response.status}`);
  }
  
  return await response.json();
};

// Read bin via server proxy
const readBin = async () => {
  const response = await fetch('/api/cloud/data', {
    method: "GET"
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || `Failed to read bin: ${response.status}`);
  }
  
  const result = await response.json();
  return result.record;
};

// Push the active team's data to the server (force save)
if (cloudSyncUpBtn) {
  cloudSyncUpBtn.addEventListener("click", async () => {
    if (!window.basketStatData.getActiveTeam()) {
      uploadStatus.textContent = "Error";
      uploadDetails.textContent = "No active team selected";
      return;
    }
    try {
      cloudSyncUpBtn.disabled = true;
      cloudSyncUpBtn.textContent = "Saving...";
      const localData = window.basketStatData.loadData();
      const ok = await window.basketStatData.saveToServer();
      if (!ok) throw new Error('Server rejected the save');
      uploadStatus.textContent = "Saved";
      uploadDetails.textContent = `${localData.games.length} games saved to team storage`;
      await updateCloudSyncUI();
    } catch (error) {
      uploadStatus.textContent = "Save failed";
      uploadDetails.textContent = error.message;
    } finally {
      cloudSyncUpBtn.disabled = false;
      cloudSyncUpBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17V3"/><path d="m6 11 6-8 6 8"/><path d="M19 21H5"/></svg>
        Save to Server
      `;
    }
  });
}

// Pull the active team's data from the server (reload from source of truth)
if (cloudSyncDownBtn) {
  cloudSyncDownBtn.addEventListener("click", async () => {
    const teamId = window.basketStatData.getActiveTeam();
    if (!teamId) {
      uploadStatus.textContent = "Error";
      uploadDetails.textContent = "No active team selected";
      return;
    }
    try {
      cloudSyncDownBtn.disabled = true;
      cloudSyncDownBtn.textContent = "Loading...";
      const data = await window.basketStatData.hydrateTeam(teamId);
      if (!data) throw new Error('Failed to load team data');
      renderGames();
      renderPlayers();
      uploadStatus.textContent = "Loaded";
      uploadDetails.textContent = `${data.games.length} games loaded from team storage`;
    } catch (error) {
      uploadStatus.textContent = "Load failed";
      uploadDetails.textContent = error.message;
    } finally {
      cloudSyncDownBtn.disabled = false;
      cloudSyncDownBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v14"/><path d="m6 13 6 8 6-8"/><path d="M19 21H5"/></svg>
        Load from Server
      `;
    }
  });
}

// Initial render — wait until the active team's data is hydrated (config.js)
// so we render the correct team rather than stale/empty cache.
(async () => {
  try {
    if (window.basketStatReady) await window.basketStatReady;
  } catch (e) {
    console.warn('Team bootstrap failed on admin page:', e);
  }

  await updateCloudSyncUI();

  const removedCount = window.basketStatData.cleanupData();
  if (removedCount > 0) {
    console.log(`Cleaned up ${removedCount} player entries with no valid stats`);
  }

  renderGames();
  renderPlayers();
  reportPlayerCounts();
  loadTeamsAdmin();
})();

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

// ========================================
// AUDIT LOG
// ========================================

const auditLogTable = document.getElementById('auditLogTable');
const refreshAuditLog = document.getElementById('refreshAuditLog');

// Format timestamp for display
const formatTimestamp = (isoString) => {
  const date = new Date(isoString);
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
};

// Truncate user agent for display
const formatUserAgent = (ua) => {
  if (!ua || ua === 'unknown') return '—';
  // Extract browser name
  if (ua.includes('Chrome')) return 'Chrome';
  if (ua.includes('Firefox')) return 'Firefox';
  if (ua.includes('Safari')) return 'Safari';
  if (ua.includes('Edge')) return 'Edge';
  return ua.slice(0, 20) + '...';
};

// Load and render audit log
const loadAuditLog = async () => {
  if (!auditLogTable) return;
  
  auditLogTable.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">Loading...</td></tr>';
  
  try {
    const response = await fetch('/api/audit-log?limit=100');
    
    if (!response.ok) {
      if (response.status === 403) {
        auditLogTable.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">Admin access required</td></tr>';
        return;
      }
      throw new Error('Failed to load audit log');
    }
    
    const data = await response.json();
    
    if (data.entries.length === 0) {
      auditLogTable.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">No audit entries yet</td></tr>';
      return;
    }
    
    // Escape untrusted fields (email/IP are user-influenced) to prevent XSS.
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));

    auditLogTable.innerHTML = data.entries.map(entry => {
      const statusClass = entry.success ? 'color: var(--positive)' : 'color: var(--negative)';
      const statusText = entry.success ? '✓ Success' : '✗ Failed';
      const email = esc(entry.email || entry.emailHash || '—');
      
      return `
        <tr>
          <td style="white-space: nowrap; font-size: 12px;">${esc(formatTimestamp(entry.timestamp))}</td>
          <td><code style="font-size: 11px; background: var(--surface-raised); padding: 2px 6px; border-radius: 4px;">${esc(entry.action)}</code></td>
          <td style="font-size: 12px;">${email}</td>
          <td style="font-size: 12px;">${esc(entry.role || '—')}</td>
          <td style="font-size: 11px; color: var(--text-muted);">${esc(entry.ip || '—')}</td>
          <td style="${statusClass}; font-size: 12px;">${statusText}</td>
        </tr>
      `;
    }).join('');
    
  } catch (error) {
    console.error('Failed to load audit log:', error);
    auditLogTable.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--negative);">Failed to load audit log</td></tr>';
  }
};

// Refresh button
if (refreshAuditLog) {
  refreshAuditLog.addEventListener('click', loadAuditLog);
}

// Load audit log on page load
loadAuditLog();

// ========================================
// USER MANAGEMENT
// ========================================

const usersTable = document.getElementById('usersTable');
const userCount = document.getElementById('userCount');
const addUserBtn = document.getElementById('addUserBtn');
const addUserModal = document.getElementById('addUserModal');
const addUserForm = document.getElementById('addUserForm');
const closeAddUser = document.getElementById('closeAddUser');
const cancelAddUser = document.getElementById('cancelAddUser');
const addUserError = document.getElementById('addUserError');
const passwordModal = document.getElementById('passwordModal');
const generatedPassword = document.getElementById('generatedPassword');
const copyPasswordBtn = document.getElementById('copyPasswordBtn');
const closePasswordModal = document.getElementById('closePasswordModal');
const donePasswordModal = document.getElementById('donePasswordModal');

// Escape untrusted values before inserting into innerHTML (prevents XSS)
const escapeHtml = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

const openModal = (el) => el && el.classList.add('active');
const closeModal = (el) => el && el.classList.remove('active');

const PROVIDER_LABELS = { google: 'Google', apple: 'Apple', vipps: 'Vipps' };

// Render the users table
const renderUsers = (users) => {
  if (!usersTable) return;
  if (userCount) userCount.textContent = users.length;

  if (users.length === 0) {
    usersTable.innerHTML = '<tr><td colspan="6" style="text-align:center; color: var(--text-muted);">No users yet</td></tr>';
    return;
  }

  usersTable.innerHTML = users.map((u) => {
    const roleBadge = u.role === 'admin'
      ? '<span class="badge" style="background: var(--accent-dim); color: var(--accent);">admin</span>'
      : '<span class="badge">user</span>';
    const statusBadge = u.status === 'active'
      ? '<span style="color: var(--positive); font-size:12px;">● active</span>'
      : '<span style="color: var(--text-muted); font-size:12px;">○ disabled</span>';

    const signins = [];
    if (u.hasPassword) signins.push('<span class="badge" style="font-size:10px;">password</span>');
    (u.providers || []).forEach((p) => {
      signins.push(
        `<span class="badge" style="font-size:10px;">${escapeHtml(PROVIDER_LABELS[p] || p)}` +
        ` <a href="#" data-action="unlink" data-id="${escapeHtml(u.id)}" data-provider="${escapeHtml(p)}" title="Unlink ${escapeHtml(PROVIDER_LABELS[p] || p)}" style="color: var(--negative); text-decoration:none;">×</a></span>`
      );
    });
    const signinCell = signins.length ? signins.join(' ') : '<span style="color: var(--text-muted); font-size:11px;">—</span>';

    const roleAction = u.role === 'admin'
      ? `<button class="secondary" data-action="make-user" data-id="${escapeHtml(u.id)}" style="font-size:11px; padding:4px 8px;">Make user</button>`
      : `<button class="secondary" data-action="make-admin" data-id="${escapeHtml(u.id)}" style="font-size:11px; padding:4px 8px;">Make admin</button>`;
    const statusAction = u.status === 'active'
      ? `<button class="secondary" data-action="disable" data-id="${escapeHtml(u.id)}" style="font-size:11px; padding:4px 8px;">Disable</button>`
      : `<button class="secondary" data-action="enable" data-id="${escapeHtml(u.id)}" style="font-size:11px; padding:4px 8px;">Enable</button>`;

    return `
      <tr data-id="${escapeHtml(u.id)}">
        <td style="font-size:12px;">${escapeHtml(u.email)}</td>
        <td style="font-size:12px;">${escapeHtml(u.name) || '—'}</td>
        <td>${roleBadge}</td>
        <td>${statusBadge}</td>
        <td>${signinCell}</td>
        <td style="white-space:nowrap; display:flex; gap:4px; flex-wrap:wrap;">
          <button class="secondary" data-action="regenerate" data-id="${escapeHtml(u.id)}" data-email="${escapeHtml(u.email)}" style="font-size:11px; padding:4px 8px;">🔑 Password</button>
          ${roleAction}
          ${statusAction}
          <button data-action="delete" data-id="${escapeHtml(u.id)}" data-email="${escapeHtml(u.email)}" class="danger-link" style="font-size:11px; padding:4px 8px;">Delete</button>
        </td>
      </tr>`;
  }).join('');
};

// Load users from the server
const loadUsers = async () => {
  if (!usersTable) return;
  usersTable.innerHTML = '<tr><td colspan="6" style="text-align:center; color: var(--text-muted);">Loading...</td></tr>';
  try {
    const res = await fetch('/api/users');
    if (!res.ok) {
      if (res.status === 403) {
        usersTable.innerHTML = '<tr><td colspan="6" style="text-align:center; color: var(--text-muted);">Admin access required</td></tr>';
        return;
      }
      throw new Error('Failed to load users');
    }
    const data = await res.json();
    renderUsers(data.users || []);
    renderStorageWarning(data.storage);
  } catch (e) {
    console.error('Failed to load users:', e);
    usersTable.innerHTML = '<tr><td colspan="6" style="text-align:center; color: var(--negative);">Failed to load users</td></tr>';
  }
};

// Warn the admin when accounts cannot be persisted (e.g. no Vercel Blob store)
const renderStorageWarning = (storage) => {
  const card = usersTable && usersTable.closest('.settings-card');
  if (!card) return;
  let banner = card.querySelector('#userStorageWarning');
  if (!storage || storage.configured) {
    if (banner) banner.remove();
    return;
  }
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'userStorageWarning';
    banner.style.cssText = 'margin: 0 0 12px; padding: 10px 14px; border-radius: 8px; font-size: 13px; background: rgba(248,113,113,0.1); border: 1px solid rgba(248,113,113,0.3); color: #f87171;';
    const header = card.querySelector('.settings-card-header');
    if (header && header.nextSibling) card.insertBefore(banner, header.nextSibling);
    else card.appendChild(banner);
  }
  banner.textContent =
    '⚠️ Accounts will NOT persist: no durable user store is configured (' +
    (storage.mode || 'unknown') + '). Attach a Vercel Blob store and redeploy.';
};

// Show a generated password in the modal
const showPassword = (password) => {
  if (generatedPassword) generatedPassword.value = password;
  openModal(passwordModal);
};

// Add user modal open/close
if (addUserBtn) addUserBtn.addEventListener('click', () => {
  addUserForm.reset();
  addUserError.style.display = 'none';
  openModal(addUserModal);
});
if (closeAddUser) closeAddUser.addEventListener('click', () => closeModal(addUserModal));
if (cancelAddUser) cancelAddUser.addEventListener('click', () => closeModal(addUserModal));

// Create user
if (addUserForm) addUserForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  addUserError.style.display = 'none';
  const email = document.getElementById('newUserEmail').value.trim();
  const name = document.getElementById('newUserName').value.trim();
  const role = document.getElementById('newUserRole').value;
  try {
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name, role })
    });
    const data = await res.json();
    if (!res.ok) {
      addUserError.textContent = data.error || 'Failed to create user';
      addUserError.style.display = 'block';
      return;
    }
    closeModal(addUserModal);
    await loadUsers();
    showPassword(data.password);
  } catch (err) {
    addUserError.textContent = 'Connection error. Please try again.';
    addUserError.style.display = 'block';
  }
});

// Password modal actions
if (copyPasswordBtn) copyPasswordBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(generatedPassword.value);
    copyPasswordBtn.textContent = 'Copied!';
    setTimeout(() => { copyPasswordBtn.textContent = 'Copy'; }, 1500);
  } catch {
    generatedPassword.select();
  }
});
if (closePasswordModal) closePasswordModal.addEventListener('click', () => closeModal(passwordModal));
if (donePasswordModal) donePasswordModal.addEventListener('click', () => closeModal(passwordModal));

// Row actions (event delegation)
if (usersTable) usersTable.addEventListener('click', async (e) => {
  const trigger = e.target.closest('[data-action]');
  if (!trigger) return;
  e.preventDefault();
  const action = trigger.dataset.action;
  const id = trigger.dataset.id;
  const email = trigger.dataset.email || '';

  try {
    if (action === 'regenerate') {
      if (!confirm(`Generate a new password for ${email}? The old one stops working immediately.`)) return;
      const res = await fetch(`/api/users/${id}/regenerate-password`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) return alert(data.error || 'Failed to regenerate password');
      showPassword(data.password);
    } else if (action === 'make-admin' || action === 'make-user') {
      const role = action === 'make-admin' ? 'admin' : 'user';
      const res = await fetch(`/api/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role })
      });
      const data = await res.json();
      if (!res.ok) return alert(data.error || 'Failed to update role');
      await loadUsers();
    } else if (action === 'disable' || action === 'enable') {
      const status = action === 'disable' ? 'disabled' : 'active';
      const res = await fetch(`/api/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      const data = await res.json();
      if (!res.ok) return alert(data.error || 'Failed to update status');
      await loadUsers();
    } else if (action === 'delete') {
      if (!confirm(`Delete ${email}? This cannot be undone.`)) return;
      const res = await fetch(`/api/users/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) return alert(data.error || 'Failed to delete user');
      await loadUsers();
    } else if (action === 'unlink') {
      const provider = trigger.dataset.provider;
      if (!confirm(`Unlink ${PROVIDER_LABELS[provider] || provider} sign-in from this user?`)) return;
      const res = await fetch(`/api/users/${id}/identities/${provider}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) return alert(data.error || 'Failed to unlink');
      await loadUsers();
    }
  } catch (err) {
    console.error('User action error:', err);
    alert('Something went wrong. Please try again.');
  }
});

// Close modals when clicking the overlay
[addUserModal, passwordModal].forEach((m) => {
  if (m) m.addEventListener('click', (e) => { if (e.target === m) closeModal(m); });
});

// Load users on page load
loadUsers();

// ========================================
// TEAM & MEMBER MANAGEMENT
// ========================================

const teamsCard = document.getElementById('teamsCard');
const teamsTable = document.getElementById('teamsTable');
const teamCountEl = document.getElementById('teamCount');
const addTeamBtn = document.getElementById('addTeamBtn');
const membersCard = document.getElementById('membersCard');
const membersTable = document.getElementById('membersTable');
const membersTeamName = document.getElementById('membersTeamName');
const memberEmailInput = document.getElementById('memberEmail');
const memberRoleInput = document.getElementById('memberRole');
const addMemberBtn = document.getElementById('addMemberBtn');
const memberError = document.getElementById('memberError');

let teamsCache = [];
let isPlatformAdmin = false;
let manageTeamId = null;

// Load teams + wire member management. Called after team bootstrap resolves.
async function loadTeamsAdmin() {
  try {
    const res = await fetch('/api/teams');
    if (!res.ok) return;
    const data = await res.json();
    teamsCache = data.teams || [];
    isPlatformAdmin = !!data.isPlatformAdmin;

    if (isPlatformAdmin && teamsCard) {
      teamsCard.style.display = '';
      renderTeamsTable(teamsCache);
    }

    // Manage the active team's members if the caller may (platform or team admin).
    const activeId = (window.BasketTeams && window.BasketTeams.activeId) || null;
    const active = teamsCache.find(t => t.id === activeId) || teamsCache[0];
    if (active && (isPlatformAdmin || active.role === 'admin')) {
      openMembersFor(active.id, active.name);
    }
  } catch (e) {
    console.error('Failed to load teams:', e);
  }
}

function renderTeamsTable(teams) {
  if (teamCountEl) teamCountEl.textContent = teams.length;
  if (!teamsTable) return;
  if (!teams.length) {
    teamsTable.innerHTML = '<tr><td colspan="3" style="text-align:center; color:var(--text-muted);">No teams yet</td></tr>';
    return;
  }
  teamsTable.innerHTML = teams.map((t) => `
    <tr data-id="${escapeHtml(t.id)}">
      <td style="font-size:13px; font-weight:500;">${escapeHtml(t.name)}</td>
      <td style="font-size:12px; color:var(--text-muted);">${t.createdAt ? escapeHtml(new Date(t.createdAt).toLocaleDateString()) : '—'}</td>
      <td style="white-space:nowrap; display:flex; gap:4px;">
        <button class="secondary" data-taction="members" data-id="${escapeHtml(t.id)}" data-name="${escapeHtml(t.name)}" style="font-size:11px; padding:4px 8px;">Members</button>
        <button class="secondary" data-taction="rename" data-id="${escapeHtml(t.id)}" data-name="${escapeHtml(t.name)}" style="font-size:11px; padding:4px 8px;">Rename</button>
        <button class="danger-link" data-taction="delete-team" data-id="${escapeHtml(t.id)}" data-name="${escapeHtml(t.name)}" style="font-size:11px; padding:4px 8px;">Delete</button>
      </td>
    </tr>`).join('');
}

function openMembersFor(teamId, teamName) {
  manageTeamId = teamId;
  if (membersCard) membersCard.style.display = '';
  if (membersTeamName) membersTeamName.textContent = teamName || 'team';
  loadMembers(teamId);
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
  membersTable.innerHTML = members.map((m) => `
    <tr data-id="${escapeHtml(m.id)}">
      <td style="font-size:12px;">${escapeHtml(m.email)}</td>
      <td style="font-size:12px;">${escapeHtml(m.name) || '—'}</td>
      <td>
        <select data-maction="role" data-id="${escapeHtml(m.id)}" style="font-size:12px; padding:4px 8px;">
          <option value="member"${m.teamRole !== 'admin' ? ' selected' : ''}>Member</option>
          <option value="admin"${m.teamRole === 'admin' ? ' selected' : ''}>Team admin</option>
        </select>
      </td>
      <td><button class="danger-link" data-maction="remove" data-id="${escapeHtml(m.id)}" data-email="${escapeHtml(m.email)}" style="font-size:11px; padding:4px 8px;">Remove</button></td>
    </tr>`).join('');
}

// Add team (platform admin)
if (addTeamBtn) addTeamBtn.addEventListener('click', async () => {
  const name = prompt('New team name:');
  if (name === null) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  try {
    const res = await fetch('/api/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmed })
    });
    const data = await res.json();
    if (!res.ok) return alert(data.error || 'Failed to create team');
    // Reload so the header team switcher and memberships reflect the new team.
    window.location.reload();
  } catch (e) {
    alert('Failed to create team. Please try again.');
  }
});

// Teams table actions
if (teamsTable) teamsTable.addEventListener('click', async (e) => {
  const trigger = e.target.closest('[data-taction]');
  if (!trigger) return;
  const action = trigger.dataset.taction;
  const id = trigger.dataset.id;
  const name = trigger.dataset.name || '';

  if (action === 'members') {
    openMembersFor(id, name);
    if (membersCard) membersCard.scrollIntoView({ behavior: 'smooth' });
  } else if (action === 'rename') {
    const next = prompt('Rename team:', name);
    if (next === null) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === name) return;
    try {
      const res = await fetch(`/api/teams/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed })
      });
      const data = await res.json();
      if (!res.ok) return alert(data.error || 'Failed to rename team');
      window.location.reload();
    } catch (err) {
      alert('Failed to rename team.');
    }
  } else if (action === 'delete-team') {
    if (!confirm(`Delete team "${name}"? This permanently removes its games and stats and cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/teams/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) return alert(data.error || 'Failed to delete team');
      window.location.reload();
    } catch (err) {
      alert('Failed to delete team.');
    }
  }
});

// Add member to the currently managed team
if (addMemberBtn) addMemberBtn.addEventListener('click', async () => {
  if (!manageTeamId) return;
  if (memberError) memberError.style.display = 'none';
  const email = (memberEmailInput.value || '').trim();
  const role = memberRoleInput.value;
  if (!email) return;
  try {
    const res = await fetch(`/api/teams/${manageTeamId}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, role })
    });
    const data = await res.json();
    if (!res.ok) {
      if (memberError) { memberError.textContent = data.error || 'Failed to add member'; memberError.style.display = 'block'; }
      return;
    }
    memberEmailInput.value = '';
    await loadMembers(manageTeamId);
  } catch (e) {
    if (memberError) { memberError.textContent = 'Connection error. Please try again.'; memberError.style.display = 'block'; }
  }
});

// Member row: role change
if (membersTable) membersTable.addEventListener('change', async (e) => {
  const sel = e.target.closest('select[data-maction="role"]');
  if (!sel || !manageTeamId) return;
  const id = sel.dataset.id;
  try {
    const res = await fetch(`/api/teams/${manageTeamId}/members/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: sel.value })
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Failed to update role'); await loadMembers(manageTeamId); }
  } catch (err) {
    alert('Failed to update role.');
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
  } catch (err) {
    alert('Failed to remove member.');
  }
});