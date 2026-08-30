// ========================================
// MOBILE GAME RECORDER — app logic
// ========================================
// Touch-first play-by-play recorder. The event log is the single source of
// truth; the box score, minutes, +/- and clock-rule triggers are all derived by
// re-running the aggregator. Recordings are saved as per-team drafts and only
// enter live stats when a platform admin imports them from the Settings portal.

(function () {
  'use strict';

  const AGG = window.recorderAggregator;
  const CLK = window.recorderClock;

  // ---------- tiny DOM helpers ----------
  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach((k) => {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k === 'onclick') node.addEventListener('click', attrs[k]);
        else if (k === 'dataset') Object.assign(node.dataset, attrs[k]);
        else if (k === 'style') node.setAttribute('style', attrs[k]);
        else node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach((c) => {
      if (c == null) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  const uid = () => 'e_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  const todayISO = () => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  const fmtClock = (ms) => {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const TYPE_LABELS = {
    '2pt_made': '2PT \u2713', '2pt_miss': '2PT \u2717',
    '3pt_made': '3PT \u2713', '3pt_miss': '3PT \u2717',
    'ft_made': 'FT \u2713', 'ft_miss': 'FT \u2717',
    oreb: 'Off reb', dreb: 'Def reb', ast: 'Assist',
    stl: 'Steal', blk: 'Block', to: 'Turnover', foul: 'Foul',
    sub_in: 'Sub in', sub_out: 'Sub out', opp_pts: 'Opp points', opp_foul: 'Opp foul',
    period_end: 'Period end', finish: 'Finish'
  };

  const MADE_2_3 = new Set(['2pt_made', '3pt_made']);
  // Live-ball events imply play is in progress. If the clock is stopped when one
  // is recorded during live play (e.g. the recorder forgot to restart it), the
  // clock auto-starts. Excludes dead-ball/stoppage events (fouls, subs, free
  // throws) and markers (period_end, finish).
  const LIVE_BALL_TYPES = new Set([
    '2pt_made', '2pt_miss', '3pt_made', '3pt_miss',
    'oreb', 'dreb', 'stl', 'blk', 'to', 'ast', 'opp_pts'
  ]);
  // Every event type the log editor can create/switch to (shots, plays, subs, opponent).
  const ALL_EVENT_TYPES = [
    '2pt_made', '2pt_miss', '3pt_made', '3pt_miss', 'ft_made', 'ft_miss',
    'oreb', 'dreb', 'ast', 'stl', 'blk', 'to', 'foul',
    'sub_in', 'sub_out', 'opp_pts', 'opp_foul'
  ];
  // Opponent events belong to "the other team" and carry no of-our-players attribution.
  function isAttributableType(type) { return type !== 'opp_pts' && type !== 'opp_foul'; }

  // ---------- state ----------
  const state = {
    auth: null,
    teams: [],
    teamId: null,
    teamName: '',
    teamData: null,
    draft: null,
    clock: null,
    seq: 0,
    saveTimer: null,
    screen: 'home',
    finishEventId: null,
    logFilter: { period: 'all', type: 'all' }
  };

  // ---------- API ----------
  async function api(method, url, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    if (res.status === 401) { window.location.href = '/login.html?redirect=/recorder.html'; throw new Error('unauthorized'); }
    let data = null;
    try { data = await res.json(); } catch (e) { /* ignore */ }
    if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
    return data;
  }

  // ---------- toast ----------
  let toastTimer = null;
  function toast(msg) {
    const t = $('#recToast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 1600);
  }

  // ---------- sheet ----------
  function openSheet(titleText, contentNode) {
    const sheet = $('#recSheet');
    sheet.innerHTML = '';
    const head = el('div', { class: 'rec-sheet-head' }, [
      el('div', { class: 'rec-sheet-title', text: titleText }),
      el('button', { class: 'rec-sheet-close', text: '\u00d7', onclick: closeSheet })
    ]);
    sheet.appendChild(head);
    sheet.appendChild(contentNode);
    $('#recSheetBackdrop').classList.add('show');
  }
  function closeSheet() { $('#recSheetBackdrop').classList.remove('show'); }
  $('#recSheetBackdrop').addEventListener('click', (e) => {
    if (e.target === $('#recSheetBackdrop')) closeSheet();
  });

  // ---------- screens ----------
  function showScreen(id) {
    state.screen = id;
    document.querySelectorAll('.rec-screen').forEach((s) => s.classList.remove('active'));
    const scr = document.getElementById('screen-' + id);
    if (scr) scr.classList.add('active');
    $('#recBottomBar').style.display = id === 'live' ? 'flex' : 'none';
    $('#recBackBtn').style.display = id === 'home' ? 'none' : 'block';
    window.scrollTo(0, 0);
    updateTopbar();
  }

  function updateTopbar() {
    const title = $('#recTitle');
    const sub = $('#recSubtitle');
    if (state.screen === 'home') {
      title.textContent = 'Game Recorder';
      sub.textContent = state.auth && state.auth.email ? state.auth.email : '';
    } else if (state.screen === 'setup') {
      title.textContent = state.teamName || 'New game';
      sub.textContent = 'New game';
    } else if (state.screen === 'squad') {
      title.textContent = state.teamName || 'Squad';
      sub.textContent = 'Squad & starting five';
    } else if (state.screen === 'live' && state.draft) {
      title.textContent = `${state.teamName} vs ${state.draft.meta.opponent}`;
      sub.textContent = state.draft.meta.league || '';
    } else if (state.screen === 'review' && state.draft) {
      title.textContent = 'Review';
      sub.textContent = `${state.teamName} vs ${state.draft.meta.opponent}`;
    }
  }

  function goBack() {
    if (state.screen === 'setup') showScreen('home');
    else if (state.screen === 'squad') showScreen('setup');
    else if (state.screen === 'live') showScreen('home');
    else if (state.screen === 'review') keepRecording();
  }

  // ---------- home ----------
  async function renderHome() {
    const list = $('#recTeamList');
    list.innerHTML = '';
    if (!state.teams.length) {
      list.appendChild(el('div', { class: 'rec-empty', text: 'You are not a member of any team yet. Ask an admin to add you.' }));
    }
    state.teams.forEach((t) => {
      list.appendChild(el('button', { class: 'rec-tile', onclick: () => selectTeam(t) }, [
        el('div', { class: 'rec-tile-main' }, [
          el('div', { class: 'rec-tile-title', text: t.name }),
          el('div', { class: 'rec-tile-meta', text: 'Tap to start a new game' })
        ]),
        el('span', { class: 'rec-badge', text: 'Record' })
      ]));
    });

    // Resume drafts across all teams
    const draftList = $('#recDraftList');
    draftList.innerHTML = '';
    let anyDraft = false;
    for (const t of state.teams) {
      try {
        const { drafts } = await api('GET', `/api/teams/${encodeURIComponent(t.id)}/drafts`);
        (drafts || []).filter((d) => d.status !== 'completed').forEach((d) => {
          anyDraft = true;
          const evs = Array.isArray(d.events) ? d.events.length : 0;
          draftList.appendChild(el('button', { class: 'rec-tile', onclick: () => resumeDraft(t, d) }, [
            el('div', { class: 'rec-tile-main' }, [
              el('div', { class: 'rec-tile-title', text: `${t.name} vs ${d.meta ? d.meta.opponent : '?'}` }),
              el('div', { class: 'rec-tile-meta', text: `${d.meta ? d.meta.league || '' : ''} \u00b7 ${evs} events \u00b7 ${d.meta ? d.meta.date : ''}` })
            ]),
            el('span', { class: 'rec-badge', text: 'Resume' })
          ]));
        });
      } catch (e) { /* ignore per-team */ }
    }
    if (!anyDraft) draftList.appendChild(el('div', { class: 'rec-empty', text: 'No in-progress recordings.' }));
    showScreen('home');
  }

  async function selectTeam(team) {
    state.teamId = team.id;
    state.teamName = team.name;
    try {
      state.teamData = await api('GET', `/api/teams/${encodeURIComponent(team.id)}/data`);
    } catch (e) {
      state.teamData = { players: {}, games: [], leagues: [], finishedLeagues: [] };
    }
    setupNewGame();
  }

  // ---------- setup ----------
  function setupNewGame() {
    $('#recDate').value = todayISO();
    $('#recOpponent').value = '';
    $('#recPeriods').value = 4;
    $('#recPeriodMin').value = 10;
    $('#recOtMin').value = 5;
    // home/away default home
    document.querySelectorAll('#recHomeAway button').forEach((b) => b.classList.toggle('active', b.dataset.val === 'home'));

    // Competition options come only from the team's registered competitions
    // (union with any leagues already present on past games). New competitions
    // must be created in Team Admin — the recorder never creates them.
    const registry = (state.teamData && Array.isArray(state.teamData.leagues)) ? state.teamData.leagues : [];
    const fromGames = ((state.teamData && state.teamData.games) || [])
      .map((g) => g.league).filter(Boolean);
    // Finished competitions stay in stats but must not be offered for a new game.
    const finished = new Set(
      ((state.teamData && state.teamData.finishedLeagues) || []).map((l) => String(l).toLowerCase())
    );
    const leagues = Array.from(new Set([...registry, ...fromGames]))
      .filter((l) => !finished.has(String(l).toLowerCase()));
    const sel = $('#recLeague');
    sel.innerHTML = '';
    leagues.forEach((l) => sel.appendChild(el('option', { value: l, text: l })));
    const note = $('#recLeagueNote');
    if (note) note.style.display = leagues.length ? 'none' : 'block';
    sel.disabled = !leagues.length;
    showScreen('setup');
  }

  function selectedHomeAway() {
    const b = document.querySelector('#recHomeAway button.active');
    return b ? b.dataset.val : 'home';
  }

  function toSquad() {
    const opponent = $('#recOpponent').value.trim();
    const league = $('#recLeague').value;
    if (!opponent) { toast('Enter the opposition name'); $('#recOpponent').focus(); return; }
    if (!league) { toast('No competition available. Add one in Team Admin → Competitions first.'); return; }

    const periods = Math.max(1, parseInt($('#recPeriods').value, 10) || 4);
    const periodLengthMin = Math.max(1, parseInt($('#recPeriodMin').value, 10) || 10);
    const otLengthMin = Math.max(1, parseInt($('#recOtMin').value, 10) || 5);

    state.draft = {
      status: 'in_progress',
      meta: {
        date: $('#recDate').value || todayISO(),
        league,
        opponent,
        homeAway: selectedHomeAway(),
        periods,
        periodLengthMin,
        otLengthMin,
        clockRules: Object.assign({}, CLK.DEFAULT_CLOCK_RULES)
      },
      roster: buildInitialRoster(),
      events: [],
      boxScore: { performances: {} }
    };
    renderSquad();
    showScreen('squad');
  }

  function buildInitialRoster() {
    const players = (state.teamData && state.teamData.players) || {};
    // Start from an empty squad: nobody is in until the recorder taps them in.
    return Object.keys(players).map((name) => ({
      name,
      number: players[name] && (players[name].number === 0 || players[name].number) ? players[name].number : null,
      included: false,
      starter: false
    }));
  }

  // ---------- squad ----------
  function renderSquad() {
    const wrap = $('#recSquadList');
    wrap.className = 'rec-squad-grid';
    wrap.innerHTML = '';
    const roster = state.draft.roster;
    roster.forEach((r) => {
      const stateCls = r.starter ? 'starter' : (r.included ? 'in' : 'out');
      // Editable number badge. Its own clicks are swallowed so tapping the number
      // to fix it doesn't also cycle the tile's in/out/starter state.
      const numInput = el('input', {
        class: 'rec-tile-num' + ((r.included && (r.number === null || r.number === '')) ? ' missing' : ''),
        type: 'number', inputmode: 'numeric', value: r.number == null ? '' : r.number,
        'aria-label': 'Number for ' + r.name
      });
      numInput.addEventListener('click', (e) => e.stopPropagation());
      numInput.addEventListener('input', () => {
        const v = numInput.value.trim();
        r.number = v === '' ? null : parseInt(v, 10);
        numInput.classList.toggle('missing', r.included && r.number == null);
        updateSquadNote();
      });
      const badge = el('span', {
        class: 'rec-tile-badge', text: r.starter ? '\u2605' : (r.included ? 'IN' : '')
      });
      const tile = el('div', {
        class: 'rec-squad-tile ' + stateCls, role: 'button', tabindex: '0',
        'aria-pressed': r.included ? 'true' : 'false'
      }, [
        el('div', { class: 'rec-tile-top' }, [numInput, badge]),
        el('div', { class: 'rec-squad-tile-name', text: r.name })
      ]);
      const cycle = () => {
        // out -> in (bench) -> starter -> out
        if (!r.included) { r.included = true; r.starter = false; }
        else if (!r.starter) { r.starter = true; }
        else { r.included = false; r.starter = false; }
        renderSquad();
      };
      tile.addEventListener('click', cycle);
      tile.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cycle(); }
      });
      wrap.appendChild(tile);
    });
    updateSquadNote();
  }

  function updateSquadNote() {
    const roster = state.draft.roster;
    const included = roster.filter((r) => r.included);
    const starters = included.filter((r) => r.starter);
    const missing = included.filter((r) => r.number == null);
    const note = $('#recSquadNote');
    const parts = [`${included.length} in squad`, `${starters.length}/5 starters`];
    if (missing.length) parts.push(`${missing.length} missing number`);
    note.textContent = parts.join(' \u00b7 ');
    note.className = 'rec-note' + ((missing.length || starters.length !== 5) ? ' warn' : '');
    $('#recStartGame').disabled = starters.length !== 5 || missing.length > 0;
  }

  async function startGame() {
    // Persist only the included players as the roster snapshot.
    state.draft.roster = state.draft.roster
      .filter((r) => r.included)
      .map((r) => ({ name: r.name, number: r.number, starter: !!r.starter }));

    try {
      const { draft } = await api('POST', `/api/teams/${encodeURIComponent(state.teamId)}/drafts`, state.draft);
      state.draft = normalizeDraft(draft);
    } catch (e) {
      toast('Could not save draft: ' + e.message);
      return;
    }
    enterLive();
  }

  function normalizeDraft(d) {
    d.meta = d.meta || {};
    d.meta.clockRules = Object.assign({}, CLK.DEFAULT_CLOCK_RULES, d.meta.clockRules || {});
    d.roster = Array.isArray(d.roster) ? d.roster : [];
    d.events = Array.isArray(d.events) ? d.events : [];
    d.boxScore = d.boxScore || { performances: {} };
    return d;
  }

  // ---------- live ----------
  function enterLive() {
    // A finish anchor only belongs to a completed recording; drop any that were
    // autosaved before the recorder returned to live so it never lingers.
    state.draft.events = state.draft.events.filter((e) => e.type !== 'finish');
    state.finishEventId = null;
    state.seq = state.draft.events.reduce((m, e) => Math.max(m, typeof e.seq === 'number' ? e.seq : 0), 0) + 1;
    initClock();
    $('#recUsLbl').textContent = state.teamName.length > 8 ? state.teamName.slice(0, 8) + '\u2026' : state.teamName;
    $('#recThemLbl').textContent = 'Opp';
    recompute();
    renderLive();
    showScreen('live');
  }

  function initClock() {
    if (state.clock) state.clock.destroy();
    state.clock = CLK.createClockController({
      meta: state.draft.meta,
      // Always use the current restart-nag cadence, even for drafts created before
      // it changed (there's no per-game UI for it).
      rules: Object.assign({}, state.draft.meta.clockRules, { restartReminderSec: CLK.DEFAULT_CLOCK_RULES.restartReminderSec }),
      onTick: () => renderClock(),
      onStateChange: () => { renderClock(); updateClockButton(); },
      onExpire: () => toast('Period ended'),
      onRestartReminder: () => {
        // Only nudge while actively recording — not on the review screen, where
        // the clock is intentionally stopped at the finish time.
        if (state.screen !== 'live') return;
        $('#recReminder').classList.add('show');
        $('#recClockTime').classList.add('reminder');
        if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
      }
    });
    // Resume: position clock at the last recorded event.
    const last = state.draft.events[state.draft.events.length - 1];
    if (last && last.type === 'period_end' && typeof last.period === 'number') {
      // The last thing recorded was the end of a period: resume at the tip-off of
      // the next period (setPeriod resets the clock to that period's full length).
      state.clock.setPeriod(last.period + 1);
    } else if (last && typeof last.period === 'number') {
      state.clock.setPeriod(last.period);
      if (typeof last.clockMs === 'number') state.clock.setRemaining(last.clockMs);
    } else {
      state.clock.setPeriod(1);
    }
    renderClock();
    updateClockButton();
  }

  function renderClock() {
    const s = state.clock.getState();
    const timeEl = $('#recClockTime');
    timeEl.textContent = fmtClock(s.remainingMs);
    timeEl.classList.toggle('stopped', !s.running);
    if (s.running) {
      timeEl.classList.remove('reminder');
      $('#recReminder').classList.remove('show');
    }
    $('#recPeriodLbl').textContent = s.period > state.draft.meta.periods ? 'OT' + (s.period - state.draft.meta.periods) : 'P' + s.period;
    updateFouls();
  }

  function updateClockButton() {
    const btn = $('#recClockToggle');
    const running = state.clock.getState().running;
    btn.textContent = running ? 'Stop clock' : 'Start clock';
    btn.classList.toggle('start', !running);
    btn.classList.toggle('stop', running);
  }

  function computeOnCourt() {
    const set = new Set(state.draft.roster.filter((r) => r.starter).map((r) => r.name));
    state.draft.events.forEach((ev) => {
      if (ev.type === 'sub_in' && ev.player) set.add(ev.player);
      else if (ev.type === 'sub_out' && ev.player) set.delete(ev.player);
    });
    return set;
  }

  function rosterNumber(name) {
    const r = state.draft.roster.find((x) => x.name === name);
    return r && (r.number === 0 || r.number) ? r.number : '';
  }

  function usScore() {
    return state.draft.events.reduce((sum, e) => sum + (AGG.POINT_VALUES[e.type] || 0), 0);
  }
  function themScore() {
    return state.draft.events.reduce((sum, e) => sum + (e.type === 'opp_pts' ? (Number(e.value) || 0) : 0), 0);
  }

  // Team fouls are tracked per period (reset each period, bonus at 5), counting
  // every foul of the given type in the current period regardless of attribution.
  function foulsThisPeriod(type) {
    const p = state.clock.getState().period;
    return state.draft.events.filter((e) => e.type === type && e.period === p).length;
  }
  function updateFouls() {
    const usEl = $('#recUsFouls');
    const themEl = $('#recThemFouls');
    if (!usEl || !themEl) return;
    const us = foulsThisPeriod('foul');
    const them = foulsThisPeriod('opp_foul');
    usEl.textContent = us;
    themEl.textContent = them;
    usEl.parentElement.classList.toggle('bonus', us >= 5);
    themEl.parentElement.classList.toggle('bonus', them >= 5);
  }

  function renderLive() {
    $('#recUsScore').textContent = usScore();
    $('#recThemScore').textContent = themScore();
    updateFouls();
    const grid = $('#recOnCourt');
    grid.innerHTML = '';
    const onCourt = computeOnCourt();
    const perf = state.draft.boxScore.performances || {};
    Array.from(onCourt).forEach((name) => {
      const pm = perf[name] ? perf[name]['+/-'] : 0;
      const pmStr = (pm > 0 ? '+' : '') + pm;
      grid.appendChild(el('button', { class: 'rec-player-tile', onclick: () => openPlayerSheet(name) }, [
        el('div', { class: 'rec-player-num', text: String(rosterNumber(name)) }),
        el('div', { class: 'rec-player-name', text: name }),
        el('div', { class: 'rec-player-pm', text: pmStr })
      ]));
    });
    if (!onCourt.size) grid.appendChild(el('div', { class: 'rec-empty', text: 'No players on court. Use Subs to add players.' }));
  }

  // "Next period ›": for regulation periods this just advances. On the last
  // configured period (or any OT period), ending it is the natural end of the
  // game, so offer a choice: finish now (box-score review) or play overtime.
  function endPeriod() {
    const period = state.clock ? state.clock.getState().period : 1;
    const periods = (state.draft && state.draft.meta && state.draft.meta.periods) || 4;
    if (period >= periods) {
      const otNum = period - periods + 1; // index of the OT we'd start next
      const body = el('div', {}, [
        el('button', { class: 'rec-btn primary block', text: 'Finish game', style: 'margin-bottom:10px;', onclick: () => { closeSheet(); openReview(); } }),
        el('button', { class: 'rec-btn block', text: 'Go to overtime (OT' + otNum + ')', onclick: () => { closeSheet(); advancePeriod(); } })
      ]);
      openSheet('End of ' + (period > periods ? 'OT' + (period - periods) : 'P' + period), body);
      return;
    }
    if (!confirm('End this period and advance to the next?')) return;
    advancePeriod();
  }

  // Stop the clock, drop a `period_end` anchor at the exact game time so the
  // just-completed period's minutes are credited to every on-court player, then
  // advance to the next period. addEvent recomputes the box score, so it's up to
  // date the moment the period ends.
  function advancePeriod() {
    if (state.clock) state.clock.stop('period-end');
    addEvent({ type: 'period_end' });
    state.clock.nextPeriod();
    renderClock();
    updateClockButton();
    renderLive();
    // New period: clock is stopped awaiting the tip-off — nudge to restart.
    state.clock.remindRestart();
  }

  // ---------- events ----------
  // opts.autoStart (default true): live-ball events restart a stopped clock.
  // The log editor passes autoStart:false so after-the-fact edits never move the
  // live clock.
  function addEvent(partial, opts) {
    opts = opts || {};
    const s = state.clock.getState();
    const ev = Object.assign({
      id: uid(),
      seq: state.seq++,
      period: s.period,
      clockMs: s.remainingMs,
      wallTs: Date.now(),
      player: null,
      value: null,
      linkedEventId: null
    }, partial);
    state.draft.events.push(ev);
    // Play resumed: if the clock was stopped, start it. Done before handleEvent so
    // rule-based auto-stops (e.g. a made basket in the last 2:00) still apply.
    if (opts.autoStart !== false && !s.running && LIVE_BALL_TYPES.has(ev.type)) {
      state.clock.start();
    }
    state.clock.handleEvent(ev);
    afterChange();
    return ev;
  }

  // Opponent scoring submenu: +1 / +2 / +3 in one tap-through.
  function openOppPointsSheet() {
    const body = el('div', {});
    body.appendChild(el('div', { class: 'rec-sheet-section', text: 'Opponent scored' }));
    const labels = { 1: 'Free throw', 2: 'Field goal', 3: 'Three' };
    const grid = el('div', { class: 'rec-oppmenu' }, [1, 2, 3].map((v) =>
      el('button', {
        class: 'rec-btn block',
        html: `+${v}<span class="sub">${labels[v]}</span>`,
        onclick: () => { addEvent({ type: 'opp_pts', value: v }); toast('Opponent +' + v); closeSheet(); }
      })
    ));
    body.appendChild(grid);
    openSheet('Opponent point', body);
  }

  function removeEventById(id) {
    // Cascade: also remove assists linked to this event.
    state.draft.events = state.draft.events.filter((e) => e.id !== id && e.linkedEventId !== id);
    afterChange();
  }

  function undo() {
    if (!state.draft.events.length) { toast('Nothing to undo'); return; }
    const last = state.draft.events[state.draft.events.length - 1];
    removeEventById(last.id);
    toast('Undone');
  }

  function afterChange() {
    recompute();
    renderLive();
    scheduleSave();
  }

  function recompute() {
    state.draft.boxScore = { performances: AGG.eventsToPerformances(state.draft) };
  }

  // ---------- autosave ----------
  function scheduleSave() {
    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(saveDraft, 700);
  }
  async function saveDraft() {
    if (!state.draft || !state.draft.id) return;
    try {
      const { draft } = await api('PUT',
        `/api/teams/${encodeURIComponent(state.teamId)}/drafts/${encodeURIComponent(state.draft.id)}`,
        state.draft);
      if (draft) state.draft.updatedAt = draft.updatedAt;
    } catch (e) {
      toast('Save failed: ' + e.message);
    }
  }

  // ---------- player action sheet ----------
  function openPlayerSheet(name) {
    const num = rosterNumber(name);
    const shots = el('div', { class: 'rec-stat-grid three' }, [
      statBtn('2PT', 'make', () => shotMake(name, '2pt_made')),
      statBtn('3PT', 'make', () => shotMake(name, '3pt_made')),
      statBtn('FT', 'make', () => { addEvent({ type: 'ft_made', player: name }); closeSheet(); }),
      statBtn('2PT', 'miss', () => { addEvent({ type: '2pt_miss', player: name }); closeSheet(); }),
      statBtn('3PT', 'miss', () => { addEvent({ type: '3pt_miss', player: name }); closeSheet(); }),
      statBtn('FT', 'miss', () => { addEvent({ type: 'ft_miss', player: name }); closeSheet(); })
    ]);
    const others = el('div', { class: 'rec-stat-grid three' }, [
      simpleStat('Off reb', () => quick(name, 'oreb')),
      simpleStat('Def reb', () => quick(name, 'dreb')),
      simpleStat('Assist', () => quick(name, 'ast')),
      simpleStat('Steal', () => quick(name, 'stl')),
      simpleStat('Block', () => quick(name, 'blk')),
      simpleStat('Turnover', () => quick(name, 'to')),
      simpleStat('Foul', () => quick(name, 'foul'))
    ]);
    const subOut = el('button', {
      class: 'rec-btn danger block', text: 'Sub out ' + name, style: 'margin-top:14px;',
      onclick: () => { closeSheet(); openSubSheet(name); }
    });
    const body = el('div', {}, [
      el('div', { class: 'rec-sheet-section', text: 'Shooting' }), shots,
      el('div', { class: 'rec-sheet-section', text: 'Other' }), others,
      subOut
    ]);
    openSheet(`#${num} ${name}`, body);
  }

  function statBtn(label, kind, onClick) {
    return el('button', { class: 'rec-stat-btn ' + kind, onclick: onClick, html: `${label}<span class="sub">${kind === 'make' ? 'made' : 'miss'}</span>` });
  }
  function simpleStat(label, onClick) {
    return el('button', { class: 'rec-stat-btn', text: label, onclick: onClick });
  }
  function quick(name, type) { addEvent({ type, player: name }); closeSheet(); toast(`${TYPE_LABELS[type]} \u2014 ${name}`); }
  function shotMake(name, type) {
    const basket = addEvent({ type, player: name });
    closeSheet();
    openAssistSheet(name, basket);
  }

  // ---------- event-first entry: pick player after the event ----------
  const SHORT_LABEL = { '2pt_made': '2PT', '2pt_miss': '2PT', '3pt_made': '3PT', '3pt_miss': '3PT', 'ft_made': 'FT', 'ft_miss': 'FT' };
  function pickerTitle(type) {
    if (MADE_2_3.has(type) || type === 'ft_made') return `Who scored the ${SHORT_LABEL[type]}?`;
    if (type === '2pt_miss' || type === '3pt_miss' || type === 'ft_miss') return `Who missed the ${SHORT_LABEL[type]}?`;
    return `${TYPE_LABELS[type] || type} \u2014 who?`;
  }

  function pickerTile(name, onClick) {
    const perf = (state.draft.boxScore && state.draft.boxScore.performances) || {};
    const pm = perf[name] ? perf[name]['+/-'] : 0;
    return el('button', { class: 'rec-player-tile', onclick: onClick }, [
      el('div', { class: 'rec-player-num', text: String(rosterNumber(name)) }),
      el('div', { class: 'rec-player-name', text: name }),
      el('div', { class: 'rec-player-pm', text: (pm > 0 ? '+' : '') + pm })
    ]);
  }

  // Tapping an event opens the player picker; the player is chosen next.
  function openPlayerPickerForType(type) {
    // Only on-court players can be credited with an event. Bench players must be
    // subbed in first, so they are intentionally not offered here.
    const onCourt = Array.from(computeOnCourt());
    const body = el('div', {});
    body.appendChild(el('div', { class: 'rec-sheet-section', text: 'On court' }));
    const onGrid = el('div', { class: 'rec-oncourt' }, onCourt.map((n) => pickerTile(n, () => recordEventFor(type, n))));
    if (!onCourt.length) onGrid.appendChild(el('div', { class: 'rec-empty', text: 'No players on court. Use Subs first.' }));
    body.appendChild(onGrid);
    body.appendChild(el('button', {
      class: 'rec-btn ghost block', text: 'Assign later', style: 'margin-top:14px;',
      onclick: () => recordEventFor(type, null)
    }));
    openSheet(pickerTitle(type), body);
  }

  function recordEventFor(type, player) {
    const ev = addEvent({ type, player: player || null });
    closeSheet();
    if (MADE_2_3.has(type) && player) { openAssistSheet(player, ev); return; }
    const who = player ? `#${rosterNumber(player)} ${player}` : 'unassigned';
    toast(`${TYPE_LABELS[type]} \u2014 ${who}`);
  }

  // ---------- assist chooser ----------
  function openAssistSheet(scorer, basketEv) {
    const onCourt = Array.from(computeOnCourt()).filter((n) => n !== scorer);
    const grid = el('div', { class: 'rec-assistmenu' }, onCourt.map((n) => el('button', {
      class: 'rec-btn block', onclick: () => { addEvent({ type: 'ast', player: n, linkedEventId: basketEv.id }); closeSheet(); toast('Assist \u2014 ' + n); },
      html: `#${rosterNumber(n)}<span class="sub">${esc(n)}</span>`
    })));
    const noAssist = el('button', { class: 'rec-btn block', text: 'No assist', style: 'margin-top:12px;', onclick: closeSheet });
    const later = el('button', {
      class: 'rec-btn ghost block', text: 'Assign later', style: 'margin-top:8px;',
      onclick: () => { addEvent({ type: 'ast', player: null, linkedEventId: basketEv.id }); closeSheet(); toast('Assist \u2014 assign later'); }
    });
    openSheet('Assisted by?', el('div', {}, [grid, noAssist, later]));
  }

  // ---------- substitutions ----------
  function openSubSheet(preselectOff) {
    // Stop the clock the moment the Subs UI opens (models the whistle), not when
    // the sub is finalized. Covers both the bottom-bar Subs button and the
    // per-player "Sub out" entry point.
    if (state.clock) state.clock.stop('substitution');
    renderClock();
    updateClockButton();
    const render = () => {
      const onCourt = Array.from(computeOnCourt());
      const bench = state.draft.roster.map((r) => r.name).filter((n) => !onCourt.includes(n));
      let pendingOff = preselectOff && onCourt.includes(preselectOff) ? preselectOff : null;

      const offGrid = el('div', { class: 'rec-choose-grid' });
      const onGrid = el('div', { class: 'rec-choose-grid' });

      const paint = () => {
        Array.from(offGrid.children).forEach((c) => c.classList.toggle('make', c.dataset.name === pendingOff));
      };

      onCourt.forEach((n) => {
        offGrid.appendChild(el('button', {
          class: 'rec-stat-btn', dataset: { name: n }, html: `#${rosterNumber(n)}<span class="sub">${esc(n)}</span>`,
          onclick: () => { pendingOff = n; paint(); }
        }));
      });
      bench.forEach((n) => {
        onGrid.appendChild(el('button', {
          class: 'rec-stat-btn', html: `#${rosterNumber(n)}<span class="sub">${esc(n)}</span>`,
          onclick: () => {
            if (!pendingOff) { toast('Pick who comes off first'); return; }
            addEvent({ type: 'sub_out', player: pendingOff });
            addEvent({ type: 'sub_in', player: n });
            toast(`${pendingOff} \u2192 ${n}`);
            openSubSheet(null); // re-render with fresh state
          }
        }));
      });

      const body = el('div', {}, [
        el('div', { class: 'rec-sheet-section', text: 'Coming off' }), offGrid,
        el('div', { class: 'rec-sheet-section', text: 'Coming on' }),
        bench.length ? onGrid : el('div', { class: 'rec-empty', text: 'No bench players available.' }),
        el('button', { class: 'rec-btn primary block', text: 'Done', style: 'margin-top:14px;', onclick: closeSheet })
      ]);
      openSheet('Substitution', body);
      paint();
    };
    render();
  }

  // ---------- play log + editing ----------
  function eventDescription(ev) {
    if (ev.type === 'opp_pts') return `Opponent +${ev.value}`;
    if (ev.type === 'opp_foul') return 'Opponent foul';
    const label = TYPE_LABELS[ev.type] || ev.type;
    const num = ev.player ? rosterNumber(ev.player) : '';
    if (ev.player) return `${label} \u2014 #${num} ${ev.player}`;
    return AGG.SUBJECT_STAT_TYPES.has(ev.type) ? `${label} \u2014 Unassigned` : label;
  }
  function periodLabel(p) {
    const periods = state.draft.meta.periods;
    return p > periods ? 'OT' + (p - periods) : 'P' + p;
  }
  function eventTimeLabel(ev) {
    return `${periodLabel(ev.period)} ${fmtClock(typeof ev.clockMs === 'number' ? ev.clockMs : 0)}`;
  }

  function openLogSheet() {
    const all = state.draft.events;
    const filter = state.logFilter;
    const list = el('div', {});
    list.appendChild(el('button', {
      class: 'rec-btn primary block', text: '+ Add event', style: 'margin-bottom:12px;',
      onclick: () => openCreateEventSheet()
    }));

    // Filters: by period and by event type. Options are derived from the events
    // actually present so the recorder only ever sees relevant choices.
    const periodsPresent = Array.from(new Set(all.map((e) => e.period))).sort((a, b) => a - b);
    // Distinct types present, ordered by ALL_EVENT_TYPES (markers like finish/
    // period_end fall to the end).
    const typesPresent = Array.from(new Set(all.map((e) => e.type)))
      .sort((a, b) => {
        const ia = ALL_EVENT_TYPES.indexOf(a); const ib = ALL_EVENT_TYPES.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      });
    // Drop a stale selection whose value is no longer present.
    if (filter.period !== 'all' && !periodsPresent.some((p) => String(p) === filter.period)) filter.period = 'all';
    if (filter.type !== 'all' && !typesPresent.includes(filter.type)) filter.type = 'all';
    const periodSel = el('select', { class: 'rec-select', 'aria-label': 'Filter by period' }, [
      el('option', { value: 'all', text: 'All periods' })
    ].concat(periodsPresent.map((p) => el('option', { value: String(p), text: periodLabel(p) }))));
    periodSel.value = filter.period;
    periodSel.addEventListener('change', () => { filter.period = periodSel.value; openLogSheet(); });
    const typeSel = el('select', { class: 'rec-select', 'aria-label': 'Filter by event type' }, [
      el('option', { value: 'all', text: 'All types' })
    ].concat(typesPresent.map((t) => el('option', { value: t, text: TYPE_LABELS[t] || t }))));
    typeSel.value = filter.type;
    typeSel.addEventListener('change', () => { filter.type = typeSel.value; openLogSheet(); });
    list.appendChild(el('div', { class: 'rec-btn-row', style: 'gap:8px; margin-bottom:12px;' }, [periodSel, typeSel]));

    const events = all.filter((e) =>
      (filter.period === 'all' || String(e.period) === filter.period) &&
      (filter.type === 'all' || e.type === filter.type)
    ).reverse();

    if (!all.length) list.appendChild(el('div', { class: 'rec-empty', text: 'No events yet.' }));
    else if (!events.length) list.appendChild(el('div', { class: 'rec-empty', text: 'No events match this filter.' }));
    events.forEach((ev) => {
      const unassigned = AGG.SUBJECT_STAT_TYPES.has(ev.type) && !ev.player;
      let tagCls = '';
      if (AGG.POINT_VALUES[ev.type]) tagCls = ' pos';
      else if (ev.type === 'opp_pts' || ev.type === 'opp_foul' || ev.type === 'to' || ev.type === 'foul') tagCls = ' neg';
      list.appendChild(el('div', { class: 'rec-log-item' + (unassigned ? ' unassigned' : ''), onclick: () => openEditSheet(ev.id) }, [
        el('div', { class: 'rec-log-time', text: eventTimeLabel(ev) }),
        el('div', { class: 'rec-log-main', text: eventDescription(ev) }),
        el('div', { class: 'rec-log-tag' + (unassigned ? ' assign' : tagCls), text: unassigned ? 'Assign' : 'Edit' })
      ]));
    });
    openSheet('Play log', list);
  }

  // Shared editor body used by both the edit (existing event) and create (new
  // event) flows. `mode` is 'edit' or 'create'. In edit mode every change is
  // applied live via afterChange(); in create mode changes only mutate the draft
  // object until the user confirms with "Add event". `rerender` reopens the same
  // sheet so the visible selection/state stays in sync.
  function buildEventEditorBody(ev, mode, rerender) {
    const live = mode === 'edit';
    const body = el('div', {});

    // Event type — any type is allowed.
    body.appendChild(el('div', { class: 'rec-sheet-section', text: 'Event type' }));
    const typeGrid = el('div', { class: 'rec-stat-grid three' });
    ALL_EVENT_TYPES.forEach((t) => typeGrid.appendChild(el('button', {
      class: 'rec-stat-btn' + (t === ev.type ? ' make' : ''), text: TYPE_LABELS[t],
      onclick: () => {
        ev.type = t;
        if (!isAttributableType(t)) ev.player = null;      // opponent events have no player
        if (t === 'opp_pts') { if (!ev.value) ev.value = 2; } else { ev.value = null; }
        if (live) afterChange();
        rerender();
      }
    })));
    body.appendChild(typeGrid);

    // Player (attributable types only).
    if (isAttributableType(ev.type)) {
      body.appendChild(el('div', { class: 'rec-sheet-section', text: 'Player' }));
      const grid = el('div', { class: 'rec-choose-grid' });
      if (AGG.SUBJECT_STAT_TYPES.has(ev.type)) {
        grid.appendChild(el('button', {
          class: 'rec-stat-btn' + (ev.player == null ? ' make' : ''), text: 'Unassigned',
          onclick: () => { ev.player = null; if (live) afterChange(); rerender(); }
        }));
      }
      state.draft.roster.forEach((r) => {
        grid.appendChild(el('button', {
          class: 'rec-stat-btn' + (r.name === ev.player ? ' make' : ''),
          html: `#${rosterNumber(r.name)}<span class="sub">${esc(r.name)}</span>`,
          onclick: () => { ev.player = r.name; if (live) afterChange(); rerender(); }
        }));
      });
      body.appendChild(grid);
    }

    // Opponent points value (+1 / +2 / +3).
    if (ev.type === 'opp_pts') {
      body.appendChild(el('div', { class: 'rec-sheet-section', text: 'Opponent points' }));
      const grid = el('div', { class: 'rec-stat-grid three' });
      [1, 2, 3].forEach((v) => grid.appendChild(el('button', {
        class: 'rec-stat-btn' + (Number(ev.value) === v ? ' make' : ''), text: '+' + v,
        onclick: () => { ev.value = v; if (live) afterChange(); rerender(); }
      })));
      body.appendChild(grid);
    }

    // Assist management for made 2/3 (edit mode only; create mode chains to the
    // assist picker after the basket is inserted).
    if (live && MADE_2_3.has(ev.type)) {
      const linkedAssist = state.draft.events.find((e) => e.type === 'ast' && e.linkedEventId === ev.id);
      body.appendChild(el('div', { class: 'rec-sheet-section', text: 'Assist' }));
      const row = el('div', { class: 'rec-btn-row' }, [
        el('button', { class: 'rec-btn', text: linkedAssist ? 'Change assist' : 'Add assist', onclick: () => chooseAssistFor(ev) }),
        linkedAssist ? el('button', { class: 'rec-btn danger', text: 'Remove assist', onclick: () => { removeEventById(linkedAssist.id); rerender(); } }) : null
      ]);
      body.appendChild(row);
      if (linkedAssist) body.appendChild(el('div', { class: 'rec-note', text: 'Assisted by ' + linkedAssist.player }));
    }

    // Game time (period + mm:ss).
    body.appendChild(el('div', { class: 'rec-sheet-section', text: 'Game time' }));
    const periodInput = el('input', { class: 'rec-num-input', type: 'number', value: ev.period, min: 1 });
    const timeInput = el('input', { class: 'rec-input', type: 'text', value: fmtClock(typeof ev.clockMs === 'number' ? ev.clockMs : 0), placeholder: 'mm:ss', style: 'flex:1;' });
    const applyTime = () => {
      ev.period = Math.max(1, parseInt(periodInput.value, 10) || 1);
      const m = /^(\d+):(\d{1,2})$/.exec(timeInput.value.trim());
      if (m) ev.clockMs = (parseInt(m[1], 10) * 60 + parseInt(m[2], 10)) * 1000;
      if (live) afterChange();
    };
    periodInput.addEventListener('change', applyTime);
    timeInput.addEventListener('change', applyTime);
    body.appendChild(el('div', { class: 'rec-btn-row', style: 'align-items:center;' }, [
      el('div', { style: 'flex:0 0 auto;', html: '<span class="rec-note" style="margin:0;">Period</span>' }),
      periodInput, timeInput
    ]));

    return { body, applyTime };
  }

  function openEditSheet(eventId) {
    const ev = state.draft.events.find((e) => e.id === eventId);
    if (!ev) { closeSheet(); return; }
    const { body } = buildEventEditorBody(ev, 'edit', () => openEditSheet(eventId));

    body.appendChild(el('button', {
      class: 'rec-btn danger block', text: 'Delete event', style: 'margin-top:16px;',
      onclick: () => { removeEventById(ev.id); closeSheet(); openLogSheet(); }
    }));

    openSheet('Edit \u00b7 ' + eventDescription(ev), body);
  }

  // Create a brand-new event of any type from the log. `draftEv` is a plain
  // object (not yet in state.draft.events) that the shared editor mutates.
  function openCreateEventSheet(draftEv) {
    if (!draftEv) {
      const s = state.clock.getState();
      draftEv = { type: '2pt_made', player: null, value: null, period: s.period, clockMs: s.remainingMs, linkedEventId: null };
    }
    const { body, applyTime } = buildEventEditorBody(draftEv, 'create', () => openCreateEventSheet(draftEv));

    body.appendChild(el('button', {
      class: 'rec-btn primary block', text: 'Add event', style: 'margin-top:16px;',
      onclick: () => {
        applyTime(); // capture any typed period/time before inserting
        const created = addEvent({
          type: draftEv.type,
          player: isAttributableType(draftEv.type) ? draftEv.player : null,
          value: draftEv.type === 'opp_pts' ? (Number(draftEv.value) || 1) : null,
          period: draftEv.period,
          clockMs: draftEv.clockMs
        }, { autoStart: false });
        closeSheet();
        if (MADE_2_3.has(created.type) && created.player) { openAssistSheet(created.player, created); return; }
        openLogSheet();
        toast('Event added');
      }
    }));
    body.appendChild(el('button', { class: 'rec-btn ghost block', text: 'Cancel', style: 'margin-top:8px;', onclick: openLogSheet }));

    openSheet('Add event', body);
  }

  function chooseAssistFor(basketEv) {
    const scorer = basketEv.player;
    const onCourt = Array.from(computeOnCourt()).filter((n) => n !== scorer);
    const grid = el('div', { class: 'rec-assistmenu' }, onCourt.map((n) => el('button', {
      class: 'rec-btn block', html: `#${rosterNumber(n)}<span class="sub">${esc(n)}</span>`,
      onclick: () => {
        // Replace any existing linked assist, then add the new one.
        const existing = state.draft.events.find((e) => e.type === 'ast' && e.linkedEventId === basketEv.id);
        if (existing) state.draft.events = state.draft.events.filter((e) => e.id !== existing.id);
        addEvent({ type: 'ast', player: n, linkedEventId: basketEv.id }, { autoStart: false });
        openEditSheet(basketEv.id);
      }
    })));
    openSheet('Assisted by?', el('div', {}, [grid, el('button', { class: 'rec-btn block', text: 'Cancel', style: 'margin-top:12px;', onclick: () => openEditSheet(basketEv.id) })]));
  }

  // ---------- review / finish ----------
  function openReview() {
    // Pressing Finish stops the clock at the current second and drops a "finish"
    // anchor event at that game time. The aggregator uses it as the end of the
    // game, so every on-court player's minutes count up to the whistle (not just
    // to their last recorded stat). Rejecting the finish (Keep recording) deletes
    // the anchor and restarts the clock at that same time.
    if (state.clock) state.clock.stop('finish');
    if (state.finishEventId) { removeEventById(state.finishEventId); state.finishEventId = null; }
    const fin = addEvent({ type: 'finish' });
    state.finishEventId = fin.id;
    recompute();
    const wrap = $('#recBoxPreview');
    wrap.innerHTML = '';
    wrap.appendChild(buildBoxTable(state.draft.boxScore.performances || {}));
    showScreen('review');
  }

  // Build the box-score table from a performances map. Shared by the Finish review
  // screen and the read-only "Box score" peek.
  function buildBoxTable(perf) {
    perf = perf || {};
    const cols = ['pts', 'fg', '3pt', 'ft', 'oreb', 'dreb', 'reb', 'asst', 'stl', 'blk', 'to', 'foul', '+/-', 'min'];
    const table = el('table', { class: 'rec-box' });
    const thead = el('thead', {}, [el('tr', {}, [el('th', { text: 'Player' })].concat(cols.map((c) => el('th', { text: c.toUpperCase() }))))]);
    const tbody = el('tbody', {});
    const fmtCell = (s, c) => {
      const v = s[c];
      if (v == null) return '-';
      if (typeof v === 'object' && 'made' in v) return `${v.made}-${v.attempted}`;
      if (c === 'min') return fmtClock((Number(v) || 0) * 60000);
      return String(v);
    };
    Object.keys(perf).sort((a, b) => (perf[b].pts || 0) - (perf[a].pts || 0)).forEach((name) => {
      const s = perf[name];
      const reb = (s.oreb || 0) + (s.dreb || 0);
      const withReb = Object.assign({ reb }, s);
      tbody.appendChild(el('tr', {}, [el('td', { text: `#${rosterNumber(name)} ${name}` })]
        .concat(cols.map((c) => el('td', { text: fmtCell(withReb, c) })))));
    });
    table.appendChild(thead); table.appendChild(tbody);
    return table;
  }

  // Read-only peek at the current box score. Unlike Finish, it does NOT stop the
  // clock or drop a finish anchor — recording continues untouched.
  function openBoxPeek() {
    recompute();
    const wrap = el('div', { class: 'rec-box-wrap' });
    wrap.appendChild(buildBoxTable(state.draft.boxScore.performances || {}));
    openSheet('Box score', wrap);
  }

  // Reject the finish: remove the finish anchor and resume the clock at the exact
  // time the game was stopped, returning to the live recorder.
  function keepRecording() {
    if (state.finishEventId) { removeEventById(state.finishEventId); state.finishEventId = null; }
    showScreen('live');
    if (state.clock) state.clock.start();
    renderClock();
    updateClockButton();
  }

  async function saveComplete() {
    // Keep the finish anchor — it marks the end of the game for minutes.
    state.finishEventId = null;
    state.draft.status = 'completed';
    recompute();
    try {
      await api('PUT', `/api/teams/${encodeURIComponent(state.teamId)}/drafts/${encodeURIComponent(state.draft.id)}`, state.draft);
      toast('Saved. An admin can now import it.');
      if (state.clock) { state.clock.destroy(); state.clock = null; }
      setTimeout(() => { state.draft = null; renderHome(); }, 900);
    } catch (e) {
      toast('Save failed: ' + e.message);
    }
  }

  // ---------- resume ----------
  async function resumeDraft(team, draft) {
    state.teamId = team.id;
    state.teamName = team.name;
    try { state.teamData = await api('GET', `/api/teams/${encodeURIComponent(team.id)}/data`); }
    catch (e) { state.teamData = { players: {}, games: [], leagues: [], finishedLeagues: [] }; }
    state.draft = normalizeDraft(draft);
    enterLive();
  }

  // ---------- menu ----------
  function openMenu() {
    const body = el('div', {}, [
      state.screen === 'live' ? el('button', { class: 'rec-btn primary block', text: 'Finish game', style: 'margin-bottom:10px;', onclick: () => { closeSheet(); openReview(); } }) : null,
      el('button', { class: 'rec-btn block', text: 'Open stats app', style: 'margin-bottom:10px;', onclick: () => { window.location.href = '/'; } }),
      state.screen === 'live' ? el('button', { class: 'rec-btn danger block', text: 'Discard this recording', style: 'margin-bottom:10px;', onclick: discardDraft }) : null,
      el('button', { class: 'rec-btn ghost block', text: 'Log out', onclick: logout })
    ]);
    openSheet('Menu', body);
  }
  async function discardDraft() {
    if (!state.draft || !state.draft.id) { closeSheet(); return; }
    if (!confirm('Delete this recording? This cannot be undone.')) return;
    try {
      await api('DELETE', `/api/teams/${encodeURIComponent(state.teamId)}/drafts/${encodeURIComponent(state.draft.id)}`);
      // Clear the discarded game and reset the UI to the New Game create form for
      // the same team (the draft is already removed server-side, so Home would no
      // longer list it either).
      if (state.clock) { state.clock.destroy(); state.clock = null; }
      state.draft = null;
      closeSheet();
      if (state.teamId) setupNewGame();
      else renderHome();
    } catch (e) { toast('Delete failed: ' + e.message); }
  }
  async function logout() {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch (e) { /* ignore */ }
    window.location.href = '/login.html';
  }

  // ---------- wire up static controls ----------
  function bind() {
    $('#recBackBtn').addEventListener('click', goBack);
    $('#recMenuBtn').addEventListener('click', openMenu);
    document.querySelectorAll('#recHomeAway button').forEach((b) => b.addEventListener('click', () => {
      document.querySelectorAll('#recHomeAway button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
    }));
    $('#recToSquad').addEventListener('click', toSquad);
    $('#recStartGame').addEventListener('click', startGame);
    $('#recClockToggle').addEventListener('click', () => { state.clock.toggle(); });
    $('#recNextPeriod').addEventListener('click', endPeriod);
    document.querySelectorAll('[data-opp-menu]').forEach((b) => b.addEventListener('click', openOppPointsSheet));
    document.querySelectorAll('[data-opp-foul]').forEach((b) => b.addEventListener('click', () => {
      addEvent({ type: 'opp_foul' });
      toast('Opponent foul');
    }));
    document.querySelectorAll('.rec-ev[data-ev]').forEach((b) => b.addEventListener('click', () => openPlayerPickerForType(b.dataset.ev)));
    $('#recUndo').addEventListener('click', undo);
    $('#recSubs').addEventListener('click', () => openSubSheet(null));
    $('#recLog').addEventListener('click', openLogSheet);
    $('#recBoxScore').addEventListener('click', openBoxPeek);
    $('#recSaveComplete').addEventListener('click', saveComplete);
    $('#recBackToLive').addEventListener('click', keepRecording);
  }

  // ---------- init ----------
  async function init() {
    bind();
    let info;
    try { info = await api('GET', '/api/auth/check'); }
    catch (e) { return; }
    if (!info || !info.authenticated) { window.location.href = '/login.html?redirect=/recorder.html'; return; }
    state.auth = info;
    state.teams = Array.isArray(info.teams) ? info.teams : [];
    await renderHome();
    $('#recLoading').classList.add('hidden');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
