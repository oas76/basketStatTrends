// =============================================
// TEAM BUILDER - Group Comparison Logic
// =============================================

(function () {
  'use strict';

  // ---- Constants ------------------------------------------------

  const RADAR_STATS = ['fg%', '3pt%', 'ft%', 'reb', 'asst', 'blk', 'stl', 'to'];
  const INVERTED_STATS = new Set(['to']); // lower is better — invert on radar

  const STAT_LABELS = {
    'fg%': 'FG%', '3pt%': '3PT%', 'ft%': 'FT%',
    'reb': 'REB', 'asst': 'AST', 'blk': 'BLK', 'stl': 'STL', 'to': 'TO↓'
  };

  const TEAM_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ec4899'];

  const MAX_TEAMS = 4;
  const MIN_TEAMS = 2;

  const PERSPECTIVES = [
    { key: 'top',      label: 'Top Performer' },
    { key: 'aboveAvg', label: 'Above-median Avg' },
    { key: 'median',   label: 'Median' },
    { key: 'belowAvg', label: 'Below-median Avg' },
    { key: 'bottom',   label: 'Bottom Performer' }
  ];

  // ---- State ----------------------------------------------------

  let allPlayers = [];      // all player names from data
  let teams = [[], [], [], []]; // team rosters (arrays of names), indexed 0-3
  let teamNames = ['Team A', 'Team B', 'Team C', 'Team D'];
  let teamCount = 4;
  let windowMonths = 6;     // 3 | 6 | 12 | 'all'
  let currentLeague = 'all';
  let searchFilter = '';
  let playerAveragesCache = {};  // name -> { stat: value, ... }
  let globalStatRanges = {};     // stat -> { min, max } across all teams+perspectives

  // DnD state
  let draggedPlayer = null;
  let dragSourceTeam = null; // 'pool' | 0 | 1 | 2 | 3

  // ---- DOM refs -------------------------------------------------

  const tbWindow   = document.getElementById('tbWindow');
  const tbLeague   = document.getElementById('tbLeague');
  const tbTeamCountSel = document.getElementById('tbTeamCount');
  const tbShuffle  = document.getElementById('tbShuffle');
  const tbClear    = document.getElementById('tbClear');
  const tbPool     = document.getElementById('tbPool');
  const tbPoolSearch = document.getElementById('tbPoolSearch');
  const tbPoolCount  = document.getElementById('tbPoolCount');
  const tbPoolEmpty  = document.getElementById('tbPoolEmpty');
  const tbTeamsEl  = document.getElementById('tbTeams');
  const tbLegend   = document.getElementById('tbLegend');
  const tbRadarGrid = document.getElementById('tbRadarGrid');
  const tbEmptyState = document.getElementById('tbEmptyState');
  const tbMainEl   = document.querySelector('.tb-main');

  // ---- Data helpers ---------------------------------------------

  /**
   * Get all games within the time window, optionally filtered by league.
   */
  function getFilteredGames() {
    const data = window.basketStatData.loadData();
    const now = new Date();
    return (data.games || []).filter(game => {
      if (currentLeague !== 'all' && game.league !== currentLeague) return false;
      if (windowMonths === 'all') return true;
      const gameDate = new Date(game.date);
      const months = typeof windowMonths === 'number' ? windowMonths : parseInt(windowMonths, 10);
      const cutoff = new Date(now.getFullYear(), now.getMonth() - months, now.getDate());
      return gameDate >= cutoff;
    });
  }

  /**
   * Compute per-player averages for the 8 radar stats from the filtered game set.
   * Returns { [playerName]: { 'fg%': num|null, ... } }
   */
  function computeAllPlayerAverages(games) {
    const records = {}; // name -> [{ date, ...stats }]

    games.forEach(game => {
      Object.entries(game.performances || {}).forEach(([name, stats]) => {
        if (!records[name]) records[name] = [];
        records[name].push({ date: game.date, ...stats });
      });
    });

    const result = {};
    Object.entries(records).forEach(([name, recs]) => {
      result[name] = {};
      RADAR_STATS.forEach(stat => {
        const ws = window.basketStatData.calculateWindowedStatsShared(recs, stat, 'all', false);
        result[name][stat] = ws && ws.avg !== null ? ws.avg : null;
      });
    });
    return result;
  }

  /**
   * Compute the global min/max for each stat across ALL teams and ALL perspectives.
   * This ensures all five radars share the same axis scale.
   */
  function computeGlobalRanges(teamsData) {
    const ranges = {};
    RADAR_STATS.forEach(stat => {
      let min = Infinity, max = -Infinity;
      teamsData.forEach(teamAvgs => {
        Object.values(teamAvgs).forEach(avg => {
          const v = avg[stat];
          if (v !== null && v !== undefined) {
            min = Math.min(min, v);
            max = Math.max(max, v);
          }
        });
      });
      if (min === Infinity || min === max) { min = 0; max = max === -Infinity ? 1 : max || 1; }
      const pad = (max - min) * 0.1 || 0.5;
      ranges[stat] = { min: Math.max(0, min - pad), max: max + pad };
    });
    return ranges;
  }

  // ---- Perspective computation ----------------------------------

  function median(arr) {
    if (!arr.length) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  }

  function mean(arr) {
    if (!arr.length) return null;
    return arr.reduce((s, v) => s + v, 0) / arr.length;
  }

  /**
   * Compute { top, bottom, median, aboveAvg, belowAvg } for each stat
   * from an array of per-player averages objects.
   * @param {Array<Object>} playerAvgs - e.g. [{ 'fg%': 45, 'reb': 3, ... }, ...]
   */
  function computePerspectives(playerAvgs) {
    const result = {};
    RADAR_STATS.forEach(stat => {
      const values = playerAvgs.map(p => p[stat]).filter(v => v !== null && v !== undefined);
      if (!values.length) {
        result[stat] = { top: null, bottom: null, median: null, aboveAvg: null, belowAvg: null };
        return;
      }
      const med = median(values);
      const inv = INVERTED_STATS.has(stat);

      // For inverted stats (TO: lower is better), "above median" raw means
      // MORE turnovers = worse performance, so we swap the group roles.
      const betterThanMedian = values.filter(v => inv ? v < med : v > med);
      const worseThanMedian  = values.filter(v => inv ? v > med : v < med);

      result[stat] = {
        // "top" = best-performing value for this stat (min for TO, max for others)
        top:      inv ? Math.min(...values) : Math.max(...values),
        // "bottom" = worst-performing value (max for TO, min for others)
        bottom:   inv ? Math.max(...values) : Math.min(...values),
        median:   med,
        // "aboveAvg" = mean of players performing better than median
        aboveAvg: betterThanMedian.length
          ? mean(betterThanMedian)
          : (values.length === 1 ? values[0] : (inv ? Math.min(...values) : Math.max(...values))),
        // "belowAvg" = mean of players performing worse than median
        belowAvg: worseThanMedian.length
          ? mean(worseThanMedian)
          : (values.length === 1 ? values[0] : (inv ? Math.max(...values) : Math.min(...values)))
      };
    });
    return result;
  }

  // ---- Radar rendering ------------------------------------------

  /**
   * Normalize a raw stat value to [0, 1] using global ranges.
   * Inverted stats are flipped so high radius = good.
   */
  function normalize(stat, value, ranges) {
    if (value === null || value === undefined) return null;
    const r = ranges[stat];
    if (!r || (r.max - r.min) === 0) return 0.5;
    let n = (value - r.min) / (r.max - r.min);
    n = Math.min(1, Math.max(0, n));
    if (INVERTED_STATS.has(stat)) n = 1 - n;
    return n;
  }

  /**
   * Render one SVG radar (small multiple) for a given perspective key.
   * @param {SVGElement} svg
   * @param {string} perspectiveKey - 'top' | 'aboveAvg' | 'median' | 'belowAvg' | 'bottom'
   * @param {Array<Object|null>} teamPerspectives - one entry per team (null if team has no data)
   * @param {Object} ranges - global stat ranges
   */
  function renderRadar(svg, perspectiveKey, teamPerspectives, ranges) {
    const W = 360, H = 360;
    const cx = W / 2, cy = H / 2;
    const maxR = 120;
    const labelR = maxR + 26;
    const n = RADAR_STATS.length;
    const angleStep = (2 * Math.PI) / n;

    const pt = (r, i) => {
      const a = i * angleStep - Math.PI / 2;
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    };

    let html = '';

    // Grid rings
    [0.25, 0.5, 0.75, 1].forEach(scale => {
      const pts = Array.from({ length: n }, (_, i) => pt(maxR * scale, i).join(','));
      html += `<polygon points="${pts.join(' ')}" fill="none" stroke="var(--border)" stroke-width="1" opacity="0.6"/>`;
    });

    // Axes + labels
    for (let i = 0; i < n; i++) {
      const [x1, y1] = pt(maxR, i);
      const [lx, ly] = pt(labelR, i);
      const stat = RADAR_STATS[i];
      html += `<line x1="${cx}" y1="${cy}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}" stroke="var(--border)" stroke-width="1" opacity="0.5"/>`;
      html += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" fill="var(--text-muted)" font-size="10" font-weight="600">${STAT_LABELS[stat]}</text>`;
    }

    // Team polygons
    teamPerspectives.forEach((persp, teamIdx) => {
      if (!persp) return;
      const values = RADAR_STATS.map(stat => persp[stat] ? persp[stat][perspectiveKey] : null);
      const hasData = values.some(v => v !== null);
      if (!hasData) return;

      const MIN_PAD = 0.12, MAX_PAD = 0.92;
      const pts = values.map((v, i) => {
        let norm = normalize(RADAR_STATS[i], v, ranges);
        if (norm === null) norm = MIN_PAD; // fallback to minimum ring
        const r = maxR * (MIN_PAD + norm * (MAX_PAD - MIN_PAD));
        return pt(r, i).map(x => x.toFixed(2)).join(',');
      });

      const color = TEAM_COLORS[teamIdx];
      html += `<polygon points="${pts.join(' ')}" fill="${color}" fill-opacity="0.18" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>`;

      // Dot per vertex
      values.forEach((v, i) => {
        let norm = normalize(RADAR_STATS[i], v, ranges);
        if (norm === null) norm = MIN_PAD;
        const r = maxR * (MIN_PAD + norm * (MAX_PAD - MIN_PAD));
        const [dx, dy] = pt(r, i);
        const raw = v !== null ? v.toFixed(1) : '—';
        html += `<circle cx="${dx.toFixed(2)}" cy="${dy.toFixed(2)}" r="4" fill="${color}" opacity="0.9">
          <title>${teamNames[teamIdx]}: ${STAT_LABELS[RADAR_STATS[i]]} = ${raw}</title>
        </circle>`;
      });
    });

    svg.innerHTML = html;
  }

  /**
   * Render all 5 perspective radars.
   */
  function renderAllRadars() {
    const activeTeams = teams.slice(0, teamCount);
    const filtered = getFilteredGames();
    const allAvgs = computeAllPlayerAverages(filtered);

    // Build per-team list of player averages
    const teamsPlayerAvgs = activeTeams.map(roster =>
      roster.map(name => allAvgs[name]).filter(Boolean)
    );

    // Compute perspectives per team
    const teamPerspectives = teamsPlayerAvgs.map(avgs =>
      avgs.length ? computePerspectives(avgs) : null
    );

    // Global ranges across all teams and ALL perspective values
    const valuesForRanges = teamsPlayerAvgs.flat();
    const ranges = computeGlobalRanges(valuesForRanges.length ? [valuesForRanges] : []);
    globalStatRanges = ranges;

    // Render each perspective card
    tbRadarGrid.querySelectorAll('.tb-radar-card').forEach(card => {
      const perspKey = card.dataset.perspective;
      const svg = card.querySelector('svg.tb-radar');
      const anyData = teamPerspectives.some(tp => tp !== null);
      if (!anyData) {
        svg.innerHTML = `<text x="180" y="180" text-anchor="middle" dominant-baseline="middle" fill="var(--text-muted)" font-size="13">Assign players to teams</text>`;
        return;
      }
      renderRadar(svg, perspKey, teamPerspectives, ranges);
    });

    renderLegend();
  }

  function renderLegend() {
    tbLegend.innerHTML = teams.slice(0, teamCount).map((roster, i) => `
      <div class="tb-legend-item">
        <span class="tb-legend-dot" style="background:${TEAM_COLORS[i]}"></span>
        <span class="tb-legend-name">${escHtml(teamNames[i])}</span>
        <span class="tb-legend-count">${roster.length}p</span>
      </div>
    `).join('');
  }

  // ---- Pool & team rendering ------------------------------------

  function poolPlayers() {
    const assigned = new Set(teams.flat());
    return allPlayers.filter(name => !assigned.has(name));
  }

  function renderPool() {
    const pool = poolPlayers();
    const filtered = searchFilter
      ? pool.filter(n => n.toLowerCase().includes(searchFilter.toLowerCase()))
      : pool;

    // Remove existing chips (not the empty notice)
    tbPool.querySelectorAll('.tb-chip').forEach(c => c.remove());

    filtered.forEach(name => {
      tbPool.appendChild(makeChip(name, 'pool'));
    });

    tbPoolCount.textContent = pool.length;
    tbPoolEmpty.hidden = filtered.length > 0;
  }

  function renderTeams() {
    tbTeamsEl.innerHTML = '';
    for (let i = 0; i < teamCount; i++) {
      tbTeamsEl.appendChild(makeTeamColumn(i));
    }
  }

  function makeTeamColumn(idx) {
    const col = document.createElement('div');
    col.className = 'tb-team-column';
    col.dataset.team = String(idx);

    const dot = document.createElement('span');
    dot.className = 'tb-team-color-dot';
    dot.style.background = TEAM_COLORS[idx];

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'tb-team-name-input';
    nameInput.value = teamNames[idx];
    nameInput.setAttribute('aria-label', `Team ${idx + 1} name`);
    nameInput.addEventListener('change', () => {
      teamNames[idx] = nameInput.value.trim() || `Team ${String.fromCharCode(65 + idx)}`;
      renderLegend();
    });

    const countPill = document.createElement('span');
    countPill.className = 'tb-count-pill';
    countPill.id = `tbTeamCount${idx}`;
    countPill.textContent = teams[idx].length;

    const header = document.createElement('div');
    header.className = 'tb-team-header';
    header.appendChild(dot);
    header.appendChild(nameInput);
    header.appendChild(countPill);

    const dropzone = document.createElement('div');
    dropzone.className = 'tb-chip-list tb-dropzone';
    dropzone.dataset.team = String(idx);

    const emptyNote = document.createElement('p');
    emptyNote.className = 'tb-empty';
    emptyNote.textContent = 'Drop players here';
    if (teams[idx].length > 0) emptyNote.hidden = true;
    dropzone.appendChild(emptyNote);

    teams[idx].forEach(name => dropzone.appendChild(makeChip(name, idx)));

    setupDropzone(dropzone);

    col.appendChild(header);
    col.appendChild(dropzone);
    return col;
  }

  function makeChip(name, sourceTeam) {
    const chip = document.createElement('div');
    chip.className = 'tb-chip';
    chip.draggable = true;
    chip.textContent = name;
    chip.dataset.player = name;
    chip.dataset.source = String(sourceTeam);
    chip.setAttribute('tabindex', '0');
    chip.setAttribute('title', `Drag to a team, or press Enter/Space to move`);

    // Color coding when in a team
    if (sourceTeam !== 'pool') {
      chip.style.borderLeftColor = TEAM_COLORS[sourceTeam];
    }

    chip.addEventListener('dragstart', e => {
      draggedPlayer = name;
      dragSourceTeam = sourceTeam;
      chip.classList.add('tb-chip--dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', name);
    });

    chip.addEventListener('dragend', () => {
      chip.classList.remove('tb-chip--dragging');
      draggedPlayer = null;
      dragSourceTeam = null;
    });

    // Keyboard accessibility: Enter/Space opens a picker
    chip.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openChipMoveMenu(chip, name, sourceTeam);
      }
    });

    return chip;
  }

  function setupDropzone(el) {
    el.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      el.classList.add('tb-dropzone--over');
    });
    el.addEventListener('dragleave', e => {
      if (!el.contains(e.relatedTarget)) {
        el.classList.remove('tb-dropzone--over');
      }
    });
    el.addEventListener('drop', e => {
      e.preventDefault();
      el.classList.remove('tb-dropzone--over');
      const player = draggedPlayer || e.dataTransfer.getData('text/plain');
      if (!player) return;
      const targetTeam = el.dataset.team; // 'pool' or '0'..'3'
      movePlayer(player, dragSourceTeam, targetTeam);
    });
  }

  // Pool also needs to be a dropzone (return players)
  setupDropzone(tbPool);

  /**
   * Move a player from source to target zone and re-render.
   */
  function movePlayer(name, from, to) {
    if (from === to) return;

    // Remove from source
    if (from !== 'pool') {
      const fi = parseInt(from, 10);
      teams[fi] = teams[fi].filter(n => n !== name);
    }

    // Add to destination
    if (to !== 'pool') {
      const ti = parseInt(to, 10);
      if (!teams[ti].includes(name)) teams[ti].push(name);
    }

    refresh();
  }

  /**
   * Minimal keyboard move picker (tooltip-style select)
   */
  function openChipMoveMenu(chip, name, currentSource) {
    const existing = document.getElementById('tbMoveMenu');
    if (existing) existing.remove();

    const menu = document.createElement('div');
    menu.id = 'tbMoveMenu';
    menu.className = 'tb-move-menu';
    menu.setAttribute('role', 'menu');

    const options = [{ label: 'Player Pool', value: 'pool' }];
    for (let i = 0; i < teamCount; i++) {
      options.push({ label: teamNames[i], value: String(i) });
    }

    options.forEach(opt => {
      if (opt.value === String(currentSource)) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = `Move to ${opt.label}`;
      btn.setAttribute('role', 'menuitem');
      btn.addEventListener('click', () => {
        movePlayer(name, String(currentSource), opt.value);
        menu.remove();
      });
      menu.appendChild(btn);
    });

    const rect = chip.getBoundingClientRect();
    menu.style.top = `${rect.bottom + window.scrollY + 4}px`;
    menu.style.left = `${rect.left + window.scrollX}px`;
    document.body.appendChild(menu);

    const close = e => {
      if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', close); }
    };
    setTimeout(() => document.addEventListener('click', close), 10);
  }

  // ---- Auto-balance ---------------------------------------------

  function autoBalance() {
    const pool = poolPlayers();
    if (!pool.length) return;

    // Shuffle pool
    const shuffled = [...pool].sort(() => Math.random() - 0.5);

    // Distribute round-robin into active teams
    shuffled.forEach((name, i) => {
      teams[i % teamCount].push(name);
    });

    refresh();
  }

  // ---- Global refresh ------------------------------------------

  function refresh() {
    renderPool();
    renderTeams();
    renderAllRadars();
  }

  // ---- League / window population ------------------------------

  function populateLeagues() {
    const data = window.basketStatData.loadData();
    const leagues = [...new Set((data.games || []).map(g => g.league).filter(Boolean))].sort();
    const prev = tbLeague.value;
    tbLeague.innerHTML = '<option value="all">All leagues</option>' +
      leagues.map(l => `<option value="${l}"${l === prev ? ' selected' : ''}>${escHtml(l)}</option>`).join('');
    if (leagues.length === 0 || !leagues.includes(prev)) {
      currentLeague = 'all';
      tbLeague.value = 'all';
    }
  }

  function populatePlayers() {
    const data = window.basketStatData.loadData();
    // All players that appear in any performance record
    const names = new Set();
    (data.games || []).forEach(g => Object.keys(g.performances || {}).forEach(n => names.add(n)));
    allPlayers = [...names].sort();
  }

  // ---- Utility --------------------------------------------------

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ---- Event wiring ---------------------------------------------

  tbWindow.addEventListener('change', () => {
    const v = tbWindow.value;
    windowMonths = v === 'all' ? 'all' : parseInt(v, 10);
    playerAveragesCache = {};
    renderAllRadars();
    renderLegend();
  });

  tbLeague.addEventListener('change', () => {
    currentLeague = tbLeague.value;
    playerAveragesCache = {};
    renderAllRadars();
  });

  tbTeamCountSel.addEventListener('change', () => {
    const prev = teamCount;
    teamCount = parseInt(tbTeamCountSel.value, 10);

    // If teams are being removed, return their players to pool
    for (let i = teamCount; i < prev; i++) {
      teams[i] = [];
    }

    refresh();
  });

  tbShuffle.addEventListener('click', autoBalance);

  tbClear.addEventListener('click', () => {
    teams = [[], [], [], []];
    refresh();
  });

  tbPoolSearch.addEventListener('input', () => {
    searchFilter = tbPoolSearch.value;
    renderPool();
  });

  // ---- Initialisation ------------------------------------------

  function init() {
    const data = window.basketStatData.loadData();

    if (!data.games || data.games.length === 0) {
      tbMainEl.innerHTML = `
        <div class="tb-empty-state" style="display:block">
          <h2>No data yet</h2>
          <p>Upload games in <a href="admin.html">Settings</a> to build teams.</p>
        </div>`;
      return;
    }

    // Ensure computed stats are fresh
    if (window.basketStatData.forceRecomputeAllStats) {
      window.basketStatData.forceRecomputeAllStats();
    }

    populateLeagues();
    populatePlayers();

    refresh();
  }

  // Wait for DOM + data.js
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
