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
  const tbAppearancesSection = document.getElementById('tbAppearancesSection');
  const tbAppearancesCard    = document.getElementById('tbAppearancesCard');
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
   * Get all games within the time window, WITHOUT league filtering.
   * Used for the appearances breakdown so all leagues are always visible.
   */
  function getWindowedGames() {
    const data = window.basketStatData.loadData();
    const now = new Date();
    return (data.games || []).filter(game => {
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

      // best/worst anchors are flipped for inverted stats (TO: lower is better)
      const topVal    = inv ? Math.min(...values) : Math.max(...values);
      const bottomVal = inv ? Math.max(...values) : Math.min(...values);

      // "above-avg" = mean of values strictly between median and top (both excluded)
      // For inverted stats the band sits below the median numerically.
      const [abLo, abHi] = [Math.min(med, topVal), Math.max(med, topVal)];
      const betterBand = values.filter(v => v > abLo && v < abHi);

      // "below-avg" = mean of values strictly between bottom and median (both excluded)
      const [blLo, blHi] = [Math.min(bottomVal, med), Math.max(bottomVal, med)];
      const worseBand  = values.filter(v => v > blLo && v < blHi);

      result[stat] = {
        // "top" = best-performing value for this stat (min for TO, max for others)
        top:    topVal,
        // "bottom" = worst-performing value (max for TO, min for others)
        bottom: bottomVal,
        median: med,
        // "aboveAvg" = mean of players strictly between median and top
        // Falls back to topVal when no player occupies that band
        aboveAvg: betterBand.length ? mean(betterBand) : topVal,
        // "belowAvg" = mean of players strictly between bottom and median
        // Falls back to bottomVal when no player occupies that band
        belowAvg: worseBand.length  ? mean(worseBand)  : bottomVal
      };
    });
    return result;
  }

  // ---- Tooltip infrastructure -----------------------------------

  let _tbTip = null;

  function getTip() {
    if (_tbTip) return _tbTip;
    _tbTip = document.createElement('div');
    _tbTip.id = 'tb-tooltip';
    _tbTip.setAttribute('role', 'tooltip');
    _tbTip.setAttribute('aria-hidden', 'true');
    document.body.appendChild(_tbTip);
    return _tbTip;
  }

  const PERSPECTIVE_LABELS = {
    top: 'Top Performer', aboveAvg: 'Above-median Avg',
    median: 'Median', belowAvg: 'Below-median Avg',
    bottom: 'Bottom Performer', peak: 'Peak Single Game'
  };

  function showTip(e, teamName, teamColor, statLabel, rawValue, perspKey) {
    const tip = getTip();
    tip.innerHTML =
      `<span class="tb-tip-team" style="color:${teamColor}">${teamName}</span>` +
      `<span class="tb-tip-stat">${statLabel}</span>` +
      `<span class="tb-tip-value">${rawValue}</span>` +
      `<span class="tb-tip-persp">${PERSPECTIVE_LABELS[perspKey] || perspKey}</span>`;
    tip.style.display = 'block';
    moveTip(e);
  }

  function moveTip(e) {
    const tip = getTip();
    const pad = 14;
    let x = e.clientX + pad;
    let y = e.clientY + pad;
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    if (x + tw > window.innerWidth - 8)  x = e.clientX - tw - pad;
    if (y + th > window.innerHeight - 8) y = e.clientY - th - pad;
    tip.style.left = x + 'px';
    tip.style.top  = y + 'px';
  }

  function hideTip() { getTip().style.display = 'none'; }

  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;'); }

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

      // Dot + value label per vertex
      values.forEach((v, i) => {
        let norm = normalize(RADAR_STATS[i], v, ranges);
        if (norm === null) norm = MIN_PAD;
        const r = maxR * (MIN_PAD + norm * (MAX_PAD - MIN_PAD));
        const [dx, dy] = pt(r, i);
        const raw = v !== null ? v.toFixed(1) : '—';
        const stat = RADAR_STATS[i];

        // Dot — data attributes drive the JS tooltip
        html += `<circle cx="${dx.toFixed(2)}" cy="${dy.toFixed(2)}" r="5"` +
          ` fill="${color}" opacity="0.9" class="tb-dot"` +
          ` data-team="${esc(teamNames[teamIdx])}"` +
          ` data-color="${color}"` +
          ` data-stat="${esc(STAT_LABELS[stat])}"` +
          ` data-value="${esc(raw)}"` +
          ` style="cursor:crosshair"/>`;

        // Value label — placed radially outward from the dot by 13 px
        const angle = i * angleStep - Math.PI / 2;
        const loff  = 13;
        const lx = dx + loff * Math.cos(angle);
        const ly = dy + loff * Math.sin(angle);
        html += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}"` +
          ` text-anchor="middle" dominant-baseline="middle"` +
          ` fill="${color}" font-size="8.5" font-weight="700" opacity="0.85"` +
          ` pointer-events="none">${raw}</text>`;
      });
    });

    svg.innerHTML = html;

    // Attach rich tooltip listeners to all dots in this SVG
    svg.querySelectorAll('.tb-dot').forEach(dot => {
      dot.addEventListener('mouseenter', e =>
        showTip(e, dot.dataset.team, dot.dataset.color,
                   dot.dataset.stat, dot.dataset.value, perspectiveKey));
      dot.addEventListener('mousemove',  moveTip);
      dot.addEventListener('mouseleave', hideTip);
    });
  }

  /**
   * Render all 5 perspective radars.
   */
  /**
   * For each stat, find the single best individual game value across all
   * players in the roster within the filtered game set.
   * Returns { stat: value|null } — same shape as one entry in teamsPlayerAvgs
   * so it can be passed directly to renderRadar via a synthetic perspective object.
   */
  function computePeakSingleGame(roster, games) {
    const rosterSet = new Set(roster);
    const peak = {};
    RADAR_STATS.forEach(stat => { peak[stat] = null; });

    games.forEach(game => {
      Object.entries(game.performances || {}).forEach(([name, stats]) => {
        if (!rosterSet.has(name)) return;
        RADAR_STATS.forEach(stat => {
          const raw = stats[stat];
          let val = null;

          // Handle made/attempted objects (fg, 3pt, ft → use percentage)
          if (raw && typeof raw === 'object' && 'made' in raw && 'attempted' in raw) {
            if (raw.attempted > 0) val = (raw.made / raw.attempted) * 100;
          } else if (typeof raw === 'number' && !Number.isNaN(raw)) {
            val = raw;
          }

          if (val === null) return;

          const current = peak[stat];
          if (current === null) {
            peak[stat] = val;
          } else {
            // For inverted stats (TO) a lower single-game value is "better"
            peak[stat] = INVERTED_STATS.has(stat)
              ? Math.min(current, val)
              : Math.max(current, val);
          }
        });
      });
    });

    return peak;
  }

  /**
   * Wrap a peak object into the perspective shape expected by renderRadar.
   * renderRadar reads persp[stat][perspectiveKey], so we wrap each value.
   */
  function peakToPerspective(peakObj) {
    const result = {};
    RADAR_STATS.forEach(stat => {
      const v = peakObj[stat];
      result[stat] = { peak: v };
    });
    return result;
  }

  function renderAllRadars() {
    const activeTeams = teams.slice(0, teamCount);
    const filtered = getFilteredGames();
    const allAvgs = computeAllPlayerAverages(filtered);

    // Build per-team list of player averages
    const teamsPlayerAvgs = activeTeams.map(roster =>
      roster.map(name => allAvgs[name]).filter(Boolean)
    );

    // Compute average-based perspectives per team
    const teamPerspectives = teamsPlayerAvgs.map(avgs =>
      avgs.length ? computePerspectives(avgs) : null
    );

    // Compute peak single-game per team
    const teamPeaks = activeTeams.map(roster =>
      roster.length ? computePeakSingleGame(roster, filtered) : null
    );
    const teamPeakPerspectives = teamPeaks.map(p => p ? peakToPerspective(p) : null);

    // Global ranges: include both average-based AND peak values so all 6
    // radars share the same axis scale and are directly comparable
    const allPlayerObjs = [
      ...teamsPlayerAvgs.flat(),
      ...teamPeaks.filter(Boolean)
    ];
    const ranges = computeGlobalRanges(allPlayerObjs.length ? [allPlayerObjs] : []);
    globalStatRanges = ranges;

    const anyData = teamPerspectives.some(tp => tp !== null);

    // Render the 5 average-based perspective cards
    tbRadarGrid.querySelectorAll('.tb-radar-card[data-perspective]').forEach(card => {
      const perspKey = card.dataset.perspective;
      if (perspKey === 'peak') return; // handled separately below
      const svg = card.querySelector('svg.tb-radar');
      if (!anyData) {
        svg.innerHTML = `<text x="180" y="180" text-anchor="middle" dominant-baseline="middle" fill="var(--text-muted)" font-size="13">Assign players to teams</text>`;
        return;
      }
      renderRadar(svg, perspKey, teamPerspectives, ranges);
    });

    // Render the 6th peak card
    const peakCard = tbRadarGrid.querySelector('.tb-radar-card[data-perspective="peak"]');
    if (peakCard) {
      const svg = peakCard.querySelector('svg.tb-radar');
      const anyPeak = teamPeakPerspectives.some(tp => tp !== null);
      if (!anyPeak) {
        svg.innerHTML = `<text x="180" y="180" text-anchor="middle" dominant-baseline="middle" fill="var(--text-muted)" font-size="13">Assign players to teams</text>`;
      } else {
        renderRadar(svg, 'peak', teamPeakPerspectives, ranges);
      }
    }

    renderLegend();
    renderAppearancesCard();
  }

  // ---- Appearances card -----------------------------------------

  /**
   * Count individual player game appearances per league per team.
   * Uses getWindowedGames() (no league filter) so all leagues always show.
   */
  function renderAppearancesCard() {
    if (!tbAppearancesSection || !tbAppearancesCard) return;

    const games = getWindowedGames();

    // Collect all leagues present in the window (sorted)
    const leagueSet = new Set(games.map(g => g.league).filter(Boolean));
    const leagues = [...leagueSet].sort();

    // Build appearance counts: teamIdx -> league -> count
    const activeTeams = teams.slice(0, teamCount);
    const anyAssigned = activeTeams.some(r => r.length > 0);

    if (!anyAssigned || leagues.length === 0) {
      tbAppearancesSection.hidden = true;
      return;
    }

    tbAppearancesSection.hidden = false;

    const counts = activeTeams.map(roster => {
      const byLeague = {};
      leagues.forEach(l => { byLeague[l] = 0; });
      let total = 0;
      games.forEach(game => {
        if (!game.league) return;
        roster.forEach(name => {
          if (game.performances && game.performances[name]) {
            byLeague[game.league] = (byLeague[game.league] || 0) + 1;
            total++;
          }
        });
      });
      byLeague['__total__'] = total;
      return byLeague;
    });

    // Render table
    const colHeaders = leagues.map(l => `<th>${escHtml(l)}</th>`).join('') + '<th class="tb-app-total">Total</th>';

    const rows = activeTeams.map((roster, i) => {
      const dot = `<span class="tb-legend-dot" style="background:${TEAM_COLORS[i]};display:inline-block;margin-right:6px;"></span>`;
      const leagueCells = leagues.map(l => {
        const n = counts[i][l] || 0;
        return `<td>${n > 0 ? n : '<span style="color:var(--text-muted)">—</span>'}</td>`;
      }).join('');
      const total = counts[i]['__total__'] || 0;
      return `<tr>
        <td class="tb-app-team">${dot}${escHtml(teamNames[i])} <span class="tb-app-pcount">${roster.length}p</span></td>
        ${leagueCells}
        <td class="tb-app-total">${total > 0 ? total : '—'}</td>
      </tr>`;
    }).join('');

    tbAppearancesCard.innerHTML = `
      <table class="tb-app-table">
        <thead><tr><th>Team</th>${colHeaders}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
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

  // ---- Handout generator ----------------------------------------

  function generateHandout() {
    const activeTeams = teams.slice(0, teamCount);
    const filtered    = getFilteredGames();
    const allAvgs     = computeAllPlayerAverages(filtered);

    const teamsPlayerAvgs = activeTeams.map(roster =>
      roster.map(name => allAvgs[name]).filter(Boolean)
    );
    const teamPerspectives = teamsPlayerAvgs.map(avgs =>
      avgs.length ? computePerspectives(avgs) : null
    );
    const teamPeaks = activeTeams.map(roster =>
      roster.length ? computePeakSingleGame(roster, filtered) : null
    );

    if (!teamPerspectives.some(tp => tp !== null)) {
      alert('Assign players to at least one team first, then generate the handout.');
      return;
    }

    // --- Serialize the live SVG elements (they already carry value labels + data) ---
    const radarCards = [...tbRadarGrid.querySelectorAll('.tb-radar-card[data-perspective]')];
    const radarBlocks = radarCards.map(card => {
      const svg   = card.querySelector('svg.tb-radar');
      const title = card.querySelector('h3').textContent.trim();
      const desc  = card.querySelector('p') ? card.querySelector('p').textContent.trim() : '';
      const clone = svg.cloneNode(true);
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      clone.setAttribute('width', '280');
      clone.setAttribute('height', '280');
      // Substitute CSS vars with concrete print colours
      const rawSvg = new XMLSerializer().serializeToString(clone)
        .replace(/var\(--border[^)]*\)/g, '#cbd5e1')
        .replace(/var\(--text-muted[^)]*\)/g, '#64748b')
        .replace(/var\(--text[^)]*\)/g, '#1e293b');
      return `<div class="radar-item">
        <h4>${escHtml(title)}</h4>
        <p class="radar-desc">${escHtml(desc)}</p>
        ${rawSvg}
      </div>`;
    }).join('');

    // --- Per-perspective stats tables ---
    const allPersp = [
      { key: 'top',      label: 'Top Performer',      desc: 'Best average per stat across the roster' },
      { key: 'aboveAvg', label: 'Above-median Avg',    desc: 'Mean of players strictly between Top and Median' },
      { key: 'median',   label: 'Median',              desc: 'Median player average per stat' },
      { key: 'belowAvg', label: 'Below-median Avg',    desc: 'Mean of players strictly between Bottom and Median' },
      { key: 'bottom',   label: 'Bottom Performer',    desc: 'Worst average per stat across the roster' },
      { key: 'peak',     label: 'Peak Single Game',    desc: 'Best individual game result per stat in the window' },
    ];

    function fmtVal(v) {
      if (v === null || v === undefined || Number.isNaN(v)) return '—';
      return parseFloat(v).toFixed(1);
    }

    // Subtle accent colours for each perspective section
    const perspAccents = ['#3b82f6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

    const tableSections = allPersp.map((p, pi) => {
      const accent = perspAccents[pi];
      const thStyle = `style="background:#f8fafc;font-weight:700;text-align:left;padding:6px 10px;border-bottom:2px solid #e2e8f0"`;
      const teamHeaders = activeTeams.map((_, i) =>
        `<th style="background:${TEAM_COLORS[i]}18;color:${TEAM_COLORS[i]};font-weight:700;text-align:center;padding:6px 10px;border-bottom:2px solid ${TEAM_COLORS[i]}40">${escHtml(teamNames[i])}</th>`
      ).join('');

      const rows = RADAR_STATS.map((stat, si) => {
        const cells = activeTeams.map((_, ti) => {
          let val = null;
          if (p.key === 'peak') {
            val = teamPeaks[ti] ? teamPeaks[ti][stat] : null;
          } else {
            const tp = teamPerspectives[ti];
            val = tp && tp[stat] ? tp[stat][p.key] : null;
          }
          const isInv = INVERTED_STATS.has(stat);
          // Highlight the best team for this stat (green-tinted)
          const allVals = activeTeams.map((_, ti2) => {
            if (p.key === 'peak') return teamPeaks[ti2] ? teamPeaks[ti2][stat] : null;
            const tp2 = teamPerspectives[ti2];
            return tp2 && tp2[stat] ? tp2[stat][p.key] : null;
          }).filter(v => v !== null);
          const best = allVals.length
            ? (isInv ? Math.min(...allVals) : Math.max(...allVals))
            : null;
          const isBest = val !== null && best !== null && parseFloat(val).toFixed(1) === parseFloat(best).toFixed(1);
          const cellBg = isBest ? 'background:#d1fae5' : (si % 2 === 0 ? 'background:#f8fafc' : '');
          return `<td style="text-align:center;padding:5px 10px;${cellBg};${isBest ? 'font-weight:700' : ''}">${fmtVal(val)}</td>`;
        }).join('');
        return `<tr><td style="padding:5px 10px;font-weight:600;white-space:nowrap;${si % 2 === 0 ? 'background:#f8fafc' : ''}">${STAT_LABELS[stat]}</td>${cells}</tr>`;
      }).join('');

      return `<div class="persp-block" style="margin-bottom:24px;break-inside:avoid">
        <h3 style="margin:0 0 8px;padding:8px 12px;border-left:4px solid ${accent};background:${accent}10;font-size:14px;display:flex;justify-content:space-between;align-items:baseline">
          <span>${p.label}</span>
          <span style="font-size:11px;font-weight:400;color:#64748b">${p.desc}</span>
        </h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr><th ${thStyle}>Stat</th>${teamHeaders}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
    }).join('');

    // --- Roster cards ---
    const rosterCards = activeTeams.map((roster, i) =>
      `<div style="border-top:3px solid ${TEAM_COLORS[i]};background:#fff;border-radius:6px;padding:12px 14px;box-shadow:0 1px 3px rgba(0,0,0,.08)">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span style="width:12px;height:12px;border-radius:50%;background:${TEAM_COLORS[i]};flex-shrink:0"></span>
          <strong style="font-size:14px;color:${TEAM_COLORS[i]}">${escHtml(teamNames[i])}</strong>
          <span style="font-size:11px;color:#94a3b8;margin-left:auto">${roster.length} player${roster.length !== 1 ? 's' : ''}</span>
        </div>
        <ul style="margin:0;padding-left:16px;font-size:12px;color:#334155;line-height:1.7">
          ${roster.length ? roster.map(n => `<li>${escHtml(n)}</li>`).join('') : '<li style="color:#94a3b8">—</li>'}
        </ul>
      </div>`
    ).join('');

    // --- Game appearances ---
    const games    = getWindowedGames();
    const leagues  = [...new Set(games.map(g => g.league).filter(Boolean))].sort();
    let appearancesHtml = '';
    if (leagues.length) {
      const counts = activeTeams.map(roster => {
        const byLeague = {};
        leagues.forEach(l => { byLeague[l] = 0; });
        let total = 0;
        games.forEach(game => {
          if (!game.league) return;
          roster.forEach(name => {
            if (game.performances && game.performances[name]) {
              byLeague[game.league] = (byLeague[game.league] || 0) + 1;
              total++;
            }
          });
        });
        byLeague['__total__'] = total;
        return byLeague;
      });
      const leagueHeaders = leagues.map(l => `<th style="padding:6px 10px;background:#f8fafc;font-weight:700">${escHtml(l)}</th>`).join('');
      const appRows = activeTeams.map((roster, i) => {
        const cells = leagues.map(l => {
          const n = counts[i][l] || 0;
          return `<td style="text-align:center;padding:5px 10px">${n || '—'}</td>`;
        }).join('');
        const total = counts[i]['__total__'] || 0;
        return `<tr><td style="padding:5px 10px;font-weight:600;white-space:nowrap"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${TEAM_COLORS[i]};margin-right:6px;vertical-align:middle"></span>${escHtml(teamNames[i])}</td>${cells}<td style="text-align:center;padding:5px 10px;font-weight:700">${total || '—'}</td></tr>`;
      }).join('');
      appearancesHtml = `
        <section style="margin-top:28px;break-inside:avoid">
          <h2 style="font-size:15px;margin:0 0 10px;padding-bottom:6px;border-bottom:2px solid #e2e8f0">Game Appearances</h2>
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead><tr><th style="padding:6px 10px;background:#f8fafc;font-weight:700;text-align:left">Team</th>${leagueHeaders}<th style="padding:6px 10px;background:#f8fafc;font-weight:700">Total</th></tr></thead>
            <tbody>${appRows}</tbody>
          </table>
        </section>`;
    }

    // --- Overall rating + comparison analysis ---

    // Normalized median score per stat per team (0=worst 1=best, TO already inverted)
    const handoutRanges = globalStatRanges;
    const teamStatScores = activeTeams.map((_, ti) => {
      const tp = teamPerspectives[ti];
      const out = {};
      RADAR_STATS.forEach(stat => {
        if (!tp || !tp[stat]) { out[stat] = null; return; }
        out[stat] = normalize(stat, tp[stat].median, handoutRanges);
      });
      return out;
    });

    // Overall 0-100 rating
    const ratings = teamStatScores.map(scores => {
      const vals = Object.values(scores).filter(v => v !== null);
      if (!vals.length) return null;
      return Math.round(vals.reduce((s, v) => s + v, 0) / vals.length * 100);
    });

    // Category scores
    const CATEGORIES = {
      'Shooting':    ['fg%', '3pt%', 'ft%'],
      'Rebounding':  ['reb'],
      'Playmaking':  ['asst', 'to'],
      'Defence':     ['blk', 'stl'],
    };
    const teamCatScores = teamStatScores.map(scores => {
      const cats = {};
      Object.entries(CATEGORIES).forEach(([cat, stats]) => {
        const vals = stats.map(s => scores[s]).filter(v => v !== null);
        cats[cat] = vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length * 100) : null;
      });
      return cats;
    });

    // Per-stat gap analysis (sorted by biggest gap first)
    const statGaps = RADAR_STATS.map(stat => {
      const vals = teamStatScores.map((s, ti) => ({ ti, v: s[stat] })).filter(x => x.v !== null);
      if (vals.length < 2) return { stat, gap: 0, leaderTi: null };
      const best  = vals.reduce((a, b) => a.v > b.v ? a : b);
      const worst = vals.reduce((a, b) => a.v < b.v ? a : b);
      // Raw median values for human-readable display
      const rawLeader = teamPerspectives[best.ti]  && teamPerspectives[best.ti][stat]  ? teamPerspectives[best.ti][stat].median  : null;
      const rawWorst  = teamPerspectives[worst.ti] && teamPerspectives[worst.ti][stat] ? teamPerspectives[worst.ti][stat].median : null;
      return { stat, gap: best.v - worst.v, leaderTi: best.ti, worstTi: worst.ti, rawLeader, rawWorst };
    }).sort((a, b) => b.gap - a.gap);

    const biggestDiffs  = statGaps.filter(s => s.gap > 0.01).slice(0, 3);
    const smallestDiffs = [...statGaps].sort((a, b) => a.gap - b.gap).filter(s => s.gap >= 0).slice(0, 3);

    // Rank teams overall
    const ranked = activeTeams
      .map((_, i) => ({ i, r: ratings[i] }))
      .filter(x => x.r !== null)
      .sort((a, b) => b.r - a.r);

    // Build rating HTML
    const ratingCards = activeTeams.map((_, i) => {
      const r = ratings[i];
      if (r === null) return '';
      const rank = ranked.findIndex(x => x.i === i) + 1;
      const rankLabel = ranked.length > 1 ? `<span style="font-size:10px;color:#64748b;margin-left:6px">#${rank} of ${ranked.length}</span>` : '';
      return `<div style="border-top:4px solid ${TEAM_COLORS[i]};background:#fff;border-radius:8px;padding:16px 20px;box-shadow:0 1px 4px rgba(0,0,0,.08);text-align:center;flex:1">
        <div style="font-size:13px;font-weight:700;color:${TEAM_COLORS[i]};margin-bottom:8px">${escHtml(teamNames[i])}${rankLabel}</div>
        <div style="font-size:44px;font-weight:900;color:${TEAM_COLORS[i]};line-height:1">${r}</div>
        <div style="font-size:11px;color:#94a3b8;margin-bottom:10px">/ 100</div>
        <div style="background:#e2e8f0;border-radius:4px;height:7px;overflow:hidden">
          <div style="height:100%;width:${r}%;background:${TEAM_COLORS[i]};border-radius:4px"></div>
        </div>
      </div>`;
    }).join('');

    // Category comparison table rows
    const catRows = Object.keys(CATEGORIES).map(cat => {
      const cells = activeTeams.map((_, i) => {
        const s = teamCatScores[i][cat];
        if (s === null) return `<td style="text-align:center;padding:5px 10px;color:#94a3b8">—</td>`;
        // Best in category gets highlighted
        const catVals = activeTeams.map((__, j) => teamCatScores[j][cat]).filter(v => v !== null);
        const best = catVals.length ? Math.max(...catVals) : null;
        const isBest = best !== null && s === best && catVals.filter(v => v === best).length < catVals.length;
        return `<td style="text-align:center;padding:5px 10px;font-weight:${isBest ? '800' : '500'};color:${isBest ? TEAM_COLORS[i] : '#1e293b'}">${s}</td>`;
      }).join('');
      return `<tr>
        <td style="padding:5px 10px;font-weight:600">${cat}</td>
        ${cells}
        <td style="padding:5px 10px;color:#64748b;font-size:11px">${CATEGORIES[cat].map(s => STAT_LABELS[s]).join(', ')}</td>
      </tr>`;
    }).join('');

    const catTeamHeaders = activeTeams.map((_, i) =>
      `<th style="text-align:center;padding:6px 10px;color:${TEAM_COLORS[i]};font-weight:700;background:${TEAM_COLORS[i]}10">${escHtml(teamNames[i])}</th>`
    ).join('');

    // Gap analysis bullets
    const biggestBullets = biggestDiffs.length ? biggestDiffs.map(g => {
      const leader = teamNames[g.leaderTi];
      const trailer = teamNames[g.worstTi];
      const rv1 = g.rawLeader !== null ? parseFloat(g.rawLeader).toFixed(1) : '—';
      const rv2 = g.rawWorst  !== null ? parseFloat(g.rawWorst).toFixed(1)  : '—';
      const invNote = INVERTED_STATS.has(g.stat) ? ' (lower is better)' : '';
      const pct = Math.round(g.gap * 100);
      return `<li style="margin-bottom:6px">
        <strong style="color:${TEAM_COLORS[g.leaderTi]}">${escHtml(leader)}</strong>
        leads in <strong>${STAT_LABELS[g.stat]}${invNote}</strong>
        — ${rv1} vs ${rv2}
        <span style="font-size:10px;background:#fee2e2;color:#b91c1c;border-radius:3px;padding:1px 5px;margin-left:4px">Δ ${pct}%</span>
      </li>`;
    }).join('') : '<li style="color:#94a3b8">No meaningful differences found.</li>';

    const smallestBullets = smallestDiffs.length ? smallestDiffs.map(g => {
      const vals = activeTeams
        .map((_, i) => {
          const tp = teamPerspectives[i];
          return tp && tp[g.stat] ? tp[g.stat].median : null;
        })
        .filter(v => v !== null)
        .map(v => parseFloat(v).toFixed(1));
      const pct = Math.round(g.gap * 100);
      return `<li style="margin-bottom:6px">
        <strong>${STAT_LABELS[g.stat]}</strong>
        — ${vals.join(' vs ')}
        <span style="font-size:10px;background:#d1fae5;color:#065f46;border-radius:3px;padding:1px 5px;margin-left:4px">Δ ${pct}%</span>
      </li>`;
    }).join('') : '<li style="color:#94a3b8">Not enough data.</li>';

    // Summary sentence
    const topTeam = ranked[0];
    const summaryLine = topTeam && ranked.length > 1
      ? `<strong style="color:${TEAM_COLORS[topTeam.i]}">${escHtml(teamNames[topTeam.i])}</strong> leads overall with a rating of <strong>${topTeam.r}/100</strong>. ${biggestDiffs.length ? `The biggest performance gap is in <strong>${STAT_LABELS[biggestDiffs[0].stat]}</strong>.` : ''}`
      : 'Only one team has enough data for comparison.';

    const ratingHtml = `
      <section style="margin-bottom:28px;break-inside:avoid">
        <h2 class="section-title">Overall Team Rating</h2>
        <p style="font-size:11px;color:#64748b;margin-bottom:14px">Composite score (0–100) based on per-player <em>median</em> averages across all 8 stats, normalized against the combined team range. TO is scored inversely (fewer turnovers = higher score).</p>
        <div style="display:flex;gap:12px;margin-bottom:20px">${ratingCards}</div>
        <p style="font-size:13px;margin-bottom:20px">${summaryLine}</p>

        <h3 style="font-size:13px;font-weight:700;margin-bottom:8px">Category Breakdown</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px">
          <thead>
            <tr>
              <th style="text-align:left;padding:6px 10px;background:#f8fafc;font-weight:700">Category</th>
              ${catTeamHeaders}
              <th style="text-align:left;padding:6px 10px;background:#f8fafc;font-weight:700;font-size:11px;color:#64748b">Stats included</th>
            </tr>
          </thead>
          <tbody>${catRows}</tbody>
        </table>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
          <div>
            <h3 style="font-size:13px;font-weight:700;margin-bottom:8px;color:#b91c1c">📊 Biggest Differences</h3>
            <ul style="list-style:none;padding:0;font-size:12px;color:#1e293b">${biggestBullets}</ul>
          </div>
          <div>
            <h3 style="font-size:13px;font-weight:700;margin-bottom:8px;color:#065f46">🤝 Most Similar Stats</h3>
            <ul style="list-style:none;padding:0;font-size:12px;color:#1e293b">${smallestBullets}</ul>
          </div>
        </div>
      </section>`;

    // --- Window + league label ---
    const windowLabel = windowMonths === 'all' ? 'All time' : `Last ${windowMonths} months`;
    const leagueLabel = currentLeague === 'all' ? 'All leagues' : currentLeague;
    const dateStr = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

    // --- Assemble full HTML ---
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>Team Builder – Handout</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           color: #1e293b; background: #fff; padding: 24px 28px; font-size: 13px; }
    h1 { font-size: 20px; font-weight: 800; }
    h2 { font-size: 15px; font-weight: 700; }
    h3 { font-size: 13px; font-weight: 700; }
    h4 { font-size: 12px; font-weight: 700; margin-bottom: 2px; }
    .meta { font-size: 12px; color: #64748b; margin-top: 4px; }
    .section-title { font-size: 15px; font-weight: 700; margin: 0 0 12px;
                     padding-bottom: 6px; border-bottom: 2px solid #e2e8f0; }
    .rosters { display: grid; grid-template-columns: repeat(${activeTeams.length}, 1fr);
               gap: 12px; margin: 16px 0 24px; }
    .radar-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 28px; }
    .radar-item { text-align: center; break-inside: avoid; }
    .radar-item svg { width: 100%; height: auto; max-width: 280px; }
    .radar-desc { font-size: 10px; color: #94a3b8; margin-bottom: 4px; }
    .legend { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 20px; font-size: 12px; }
    .legend-dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 5px; vertical-align: middle; }
    table { border-collapse: collapse; width: 100%; }
    @media print {
      body { padding: 12px 16px; }
      @page { size: A4 landscape; margin: 12mm; }
    }
  </style>
</head>
<body>
  <header style="margin-bottom:20px;display:flex;justify-content:space-between;align-items:flex-end">
    <div>
      <h1>🏀 Team Builder — Comparison Handout</h1>
      <p class="meta">${windowLabel} · ${leagueLabel} · Generated ${dateStr}</p>
    </div>
    <div class="legend">
      ${activeTeams.map((r, i) => `<span><span class="legend-dot" style="background:${TEAM_COLORS[i]}"></span>${escHtml(teamNames[i])} (${r.length}p)</span>`).join('')}
    </div>
  </header>

  ${ratingHtml}

  <section>
    <h2 class="section-title">Team Rosters</h2>
    <div class="rosters">${rosterCards}</div>
  </section>

  <section>
    <h2 class="section-title">Radar Comparison <span style="font-size:11px;font-weight:400;color:#64748b">— all charts share the same axis scale</span></h2>
    <div class="radar-grid">${radarBlocks}</div>
  </section>

  <section>
    <h2 class="section-title">Stats by Perspective <span style="font-size:11px;font-weight:400;color:#64748b">— highlighted cell = best team for that stat</span></h2>
    ${tableSections}
  </section>

  ${appearancesHtml}
</body>
</html>`;

    const w = window.open('', '_blank');
    if (!w) { alert('Pop-up blocked — please allow pop-ups for this page and try again.'); return; }
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 500);
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
  document.getElementById('tbPrint').addEventListener('click', generateHandout);

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
