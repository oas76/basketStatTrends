// ========================================
// RECORDER AGGREGATOR
// ========================================
// Pure functions that turn a play-by-play event log (the recorder's source of
// truth) into the exact box-score `performances` shape produced by parseCsv in
// data.js, so a draft can be imported through the normal addGame() pipeline.
//
// Output stat line per player (same keys/format as a parsed CSV row):
//   { fg:{made,attempted}, 'fg%', '3pt':{made,attempted}, '3pt%',
//     ft:{made,attempted}, 'ft%', oreb, dreb, foul, stl, to, blk, asst,
//     '+/-', min, pts }
//
// UMD: attaches to window.recorderAggregator in the browser and module.exports
// under Node/Jest.

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.recorderAggregator = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Event types the recorder can emit.
  const EVENT_TYPES = {
    TWO_MADE: '2pt_made',
    TWO_MISS: '2pt_miss',
    THREE_MADE: '3pt_made',
    THREE_MISS: '3pt_miss',
    FT_MADE: 'ft_made',
    FT_MISS: 'ft_miss',
    OREB: 'oreb',
    DREB: 'dreb',
    AST: 'ast',
    STL: 'stl',
    BLK: 'blk',
    TO: 'to',
    FOUL: 'foul',
    SUB_IN: 'sub_in',
    SUB_OUT: 'sub_out',
    OPP_PTS: 'opp_pts',
    OPP_FOUL: 'opp_foul',
    PERIOD_START: 'period_start',
    PERIOD_END: 'period_end'
  };

  // Points contributed by each made-shot event.
  const POINT_VALUES = {
    '2pt_made': 2,
    '3pt_made': 3,
    'ft_made': 1
  };

  // Counting-stat events that make a player "count" as having played.
  const SUBJECT_STAT_TYPES = new Set([
    '2pt_made', '2pt_miss', '3pt_made', '3pt_miss', 'ft_made', 'ft_miss',
    'oreb', 'dreb', 'ast', 'stl', 'blk', 'to', 'foul'
  ]);

  const DEFAULT_PERIODS = 4;
  const DEFAULT_PERIOD_MIN = 10;
  const DEFAULT_OT_MIN = 5;

  /** Length (ms) of a given 1-based period, honoring OT length. */
  function periodLengthMs(period, meta) {
    const m = meta || {};
    const regCount = Number(m.periods) > 0 ? Number(m.periods) : DEFAULT_PERIODS;
    const regLen = (Number(m.periodLengthMin) > 0 ? Number(m.periodLengthMin) : DEFAULT_PERIOD_MIN) * 60000;
    const otLen = (Number(m.otLengthMin) > 0 ? Number(m.otLengthMin) : DEFAULT_OT_MIN) * 60000;
    return period > regCount ? otLen : regLen;
  }

  /** Total ms elapsed before the start of the given 1-based period. */
  function periodOffsetMs(period, meta) {
    let offset = 0;
    for (let p = 1; p < period; p += 1) offset += periodLengthMs(p, meta);
    return offset;
  }

  /**
   * Convert an event's (period, clockMs-remaining) into a single monotonic
   * "elapsed game time" in ms, so events across periods can be ordered and
   * used for minutes / +/- math.
   */
  function globalTimeOf(ev, meta) {
    const period = Number(ev.period) > 0 ? Number(ev.period) : 1;
    const len = periodLengthMs(period, meta);
    const remaining = typeof ev.clockMs === 'number' ? Math.max(0, Math.min(len, ev.clockMs)) : len;
    return periodOffsetMs(period, meta) + (len - remaining);
  }

  function emptyStatLine() {
    return {
      fg: { made: 0, attempted: 0 },
      'fg%': null,
      '3pt': { made: 0, attempted: 0 },
      '3pt%': null,
      ft: { made: 0, attempted: 0 },
      'ft%': null,
      oreb: 0,
      dreb: 0,
      foul: 0,
      stl: 0,
      to: 0,
      blk: 0,
      asst: 0,
      '+/-': 0,
      min: 0,
      pts: 0
    };
  }

  function pct(made, attempted) {
    if (!attempted || attempted <= 0) return null;
    return Math.round((made / attempted) * 100);
  }

  /**
   * Aggregate a draft's event log into a { [playerName]: statLine } map.
   * Includes every player who was on the floor: all starters, anyone subbed in,
   * anyone with a counting stat, and anyone with measured court time. Substitutes
   * appear even with a scoreless, sub-second stint so the box score reflects who
   * actually played — not just who scored.
   */
  function eventsToPerformances(draft) {
    const meta = (draft && draft.meta) || {};
    const roster = Array.isArray(draft && draft.roster) ? draft.roster : [];
    const rawEvents = Array.isArray(draft && draft.events) ? draft.events : [];

    // Attach global time + stable order, then sort chronologically.
    const events = rawEvents.map((ev, i) => ({
      ev,
      i,
      seq: typeof ev.seq === 'number' ? ev.seq : i,
      t: globalTimeOf(ev, meta)
    }));
    events.sort((a, b) => (a.t - b.t) || (a.seq - b.seq));

    const knownEventIds = new Set(rawEvents.map(e => e.id).filter(Boolean));
    const endTime = events.length ? events[events.length - 1].t : 0;

    const starters = roster.filter(r => r && r.starter && r.name).map(r => r.name);

    // ----- Minutes + plus/minus (single chronological pass) -----
    const minutesMs = {};
    const plusMinus = {};
    const onCourt = new Set(starters);
    const openStart = new Map();
    starters.forEach(n => openStart.set(n, 0));

    const accumulate = (name, t) => {
      if (!openStart.has(name)) return;
      minutesMs[name] = (minutesMs[name] || 0) + Math.max(0, t - openStart.get(name));
    };

    events.forEach(({ ev, t }) => {
      const type = ev.type;
      if (POINT_VALUES[type]) {
        const delta = POINT_VALUES[type];
        onCourt.forEach(n => { plusMinus[n] = (plusMinus[n] || 0) + delta; });
      } else if (type === EVENT_TYPES.OPP_PTS) {
        const delta = Number(ev.value) || 0;
        onCourt.forEach(n => { plusMinus[n] = (plusMinus[n] || 0) - delta; });
      } else if (type === EVENT_TYPES.SUB_IN) {
        if (ev.player && !onCourt.has(ev.player)) {
          onCourt.add(ev.player);
          openStart.set(ev.player, t);
        }
      } else if (type === EVENT_TYPES.SUB_OUT) {
        if (ev.player && onCourt.has(ev.player)) {
          accumulate(ev.player, t);
          onCourt.delete(ev.player);
          openStart.delete(ev.player);
        }
      }
    });
    // Close any still-on-court intervals at the final event time.
    onCourt.forEach(n => accumulate(n, endTime));

    // ----- Counting stats (per subject player) -----
    const lines = {};
    const ensure = (name) => {
      if (!lines[name]) lines[name] = emptyStatLine();
      return lines[name];
    };

    rawEvents.forEach((ev) => {
      const name = ev.player;
      const type = ev.type;
      if (!name) return;
      switch (type) {
        case EVENT_TYPES.TWO_MADE: {
          const s = ensure(name); s.fg.made += 1; s.fg.attempted += 1; s.pts += 2; break;
        }
        case EVENT_TYPES.TWO_MISS: {
          const s = ensure(name); s.fg.attempted += 1; break;
        }
        case EVENT_TYPES.THREE_MADE: {
          const s = ensure(name);
          s.fg.made += 1; s.fg.attempted += 1;
          s['3pt'].made += 1; s['3pt'].attempted += 1;
          s.pts += 3; break;
        }
        case EVENT_TYPES.THREE_MISS: {
          const s = ensure(name); s.fg.attempted += 1; s['3pt'].attempted += 1; break;
        }
        case EVENT_TYPES.FT_MADE: {
          const s = ensure(name); s.ft.made += 1; s.ft.attempted += 1; s.pts += 1; break;
        }
        case EVENT_TYPES.FT_MISS: {
          const s = ensure(name); s.ft.attempted += 1; break;
        }
        case EVENT_TYPES.OREB: { ensure(name).oreb += 1; break; }
        case EVENT_TYPES.DREB: { ensure(name).dreb += 1; break; }
        case EVENT_TYPES.STL: { ensure(name).stl += 1; break; }
        case EVENT_TYPES.BLK: { ensure(name).blk += 1; break; }
        case EVENT_TYPES.TO: { ensure(name).to += 1; break; }
        case EVENT_TYPES.FOUL: { ensure(name).foul += 1; break; }
        case EVENT_TYPES.AST: {
          // Ignore an assist whose linked basket no longer exists (safe delete).
          if (ev.linkedEventId && !knownEventIds.has(ev.linkedEventId)) break;
          ensure(name).asst += 1; break;
        }
        default:
          break;
      }
    });

    // Union of everyone who belongs in the box score. A player counts if they:
    //   1. recorded a counting stat,
    //   2. logged at least one second of measured court time, OR
    //   3. were on the floor at any point — every starter, plus anyone subbed in.
    // Rule 3 is essential: a substitute who played but didn't score (and whose
    // measured seconds rounded to 0 because the clock was stopped during their
    // stint) must still appear. The box score reflects who was on the court, not
    // just who scored.
    const played = new Set(Object.keys(lines));
    Object.keys(minutesMs).forEach((n) => {
      if (Math.round(minutesMs[n] / 1000) > 0) played.add(n);
    });
    starters.forEach((n) => { if (n) played.add(n); });
    rawEvents.forEach((ev) => {
      if (ev.type === EVENT_TYPES.SUB_IN && ev.player) played.add(ev.player);
    });

    const performances = {};
    played.forEach((name) => {
      const s = ensure(name);
      s['fg%'] = pct(s.fg.made, s.fg.attempted);
      s['3pt%'] = pct(s['3pt'].made, s['3pt'].attempted);
      s['ft%'] = pct(s.ft.made, s.ft.attempted);
      s['+/-'] = plusMinus[name] || 0;
      // Store minutes with second precision (e.g. 8.4 => 8:24) instead of
      // rounding to whole minutes, so accumulated court time keeps its seconds.
      s.min = Math.round((minutesMs[name] || 0) / 1000) / 60;
      performances[name] = s;
    });

    return performances;
  }

  /** Build the { [name]: { number, active } } registry map from a draft roster. */
  function rosterToPlayersFound(draft) {
    const roster = Array.isArray(draft && draft.roster) ? draft.roster : [];
    const out = {};
    roster.forEach((r) => {
      if (!r || !r.name) return;
      out[r.name] = {
        number: (r.number === 0 || r.number) ? r.number : null,
        active: true
      };
    });
    return out;
  }

  return {
    EVENT_TYPES,
    POINT_VALUES,
    SUBJECT_STAT_TYPES,
    periodLengthMs,
    periodOffsetMs,
    globalTimeOf,
    emptyStatLine,
    eventsToPerformances,
    rosterToPlayersFound
  };
});
