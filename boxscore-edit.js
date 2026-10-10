// ========================================
// BOX SCORE EDIT (after-the-fact events)
// ========================================
// Pure helpers for adding events to an already-saved box score line. The
// increments mirror recorder-aggregator.js exactly, so a stat fixed up "after
// the fact" in the Games view is identical to one the live recorder would have
// produced. The derived metrics (reb, a/to, atk, def, shoot) are layered on by
// data.js addComputedStats(); this module owns only the raw increments and the
// three shooting percentages.
//
// UMD: window.boxscoreEdit in the browser; module.exports under Node/Jest.

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.boxscoreEdit = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Zeroed stat line, matching recorder-aggregator.js emptyStatLine().
  function emptyLine() {
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

  // Ordered quick-add actions for the UI. `type` matches the recorder event
  // vocabulary; `group` drives the two button rows (shooting vs other).
  const ACTIONS = [
    { type: '2pt_made', label: '2PT \u2713', group: 'shooting', made: true },
    { type: '2pt_miss', label: '2PT \u2717', group: 'shooting', made: false },
    { type: '3pt_made', label: '3PT \u2713', group: 'shooting', made: true },
    { type: '3pt_miss', label: '3PT \u2717', group: 'shooting', made: false },
    { type: 'ft_made', label: 'FT \u2713', group: 'shooting', made: true },
    { type: 'ft_miss', label: 'FT \u2717', group: 'shooting', made: false },
    { type: 'oreb', label: 'OREB', group: 'other' },
    { type: 'dreb', label: 'DREB', group: 'other' },
    { type: 'ast', label: 'AST', group: 'other' },
    { type: 'stl', label: 'STL', group: 'other' },
    { type: 'blk', label: 'BLK', group: 'other' },
    { type: 'to', label: 'TO', group: 'other' },
    { type: 'foul', label: 'FOUL', group: 'other' }
  ];

  // Coerce a possibly-missing counting value to a number.
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);

  // Coerce a possibly-missing shooting value to a {made, attempted} object.
  function pair(v) {
    if (v && typeof v === 'object') {
      return { made: num(v.made), attempted: num(v.attempted) };
    }
    return { made: 0, attempted: 0 };
  }

  /**
   * Return a NEW stat line with one event applied. Increments match
   * recorder-aggregator.js: a made field goal bumps fg (and 3pt for threes) and
   * points; a miss bumps only attempts. Unknown types are a no-op clone.
   */
  function applyEvent(line, type) {
    const s = Object.assign({}, line || {});
    // Normalize the fields this event may touch so edits work on sparse CSV lines.
    s.fg = pair(s.fg);
    s['3pt'] = pair(s['3pt']);
    s.ft = pair(s.ft);
    s.oreb = num(s.oreb); s.dreb = num(s.dreb); s.foul = num(s.foul);
    s.stl = num(s.stl); s.to = num(s.to); s.blk = num(s.blk);
    s.asst = num(s.asst); s.pts = num(s.pts);

    switch (type) {
      case '2pt_made': s.fg.made += 1; s.fg.attempted += 1; s.pts += 2; break;
      case '2pt_miss': s.fg.attempted += 1; break;
      case '3pt_made':
        s.fg.made += 1; s.fg.attempted += 1;
        s['3pt'].made += 1; s['3pt'].attempted += 1;
        s.pts += 3; break;
      case '3pt_miss': s.fg.attempted += 1; s['3pt'].attempted += 1; break;
      case 'ft_made': s.ft.made += 1; s.ft.attempted += 1; s.pts += 1; break;
      case 'ft_miss': s.ft.attempted += 1; break;
      case 'oreb': s.oreb += 1; break;
      case 'dreb': s.dreb += 1; break;
      case 'ast': s.asst += 1; break;
      case 'stl': s.stl += 1; break;
      case 'blk': s.blk += 1; break;
      case 'to': s.to += 1; break;
      case 'foul': s.foul += 1; break;
      default: break;
    }
    return s;
  }

  function pct(made, attempted) {
    if (!attempted || attempted <= 0) return null;
    return Math.round((made / attempted) * 100);
  }

  /**
   * Recompute the three shooting percentages in place from the made/attempted
   * pairs, and return the same line for chaining.
   */
  function recomputePercentages(line) {
    if (!line) return line;
    const fg = pair(line.fg);
    const tp = pair(line['3pt']);
    const ft = pair(line.ft);
    line['fg%'] = pct(fg.made, fg.attempted);
    line['3pt%'] = pct(tp.made, tp.attempted);
    line['ft%'] = pct(ft.made, ft.attempted);
    return line;
  }

  return { emptyLine, ACTIONS, applyEvent, recomputePercentages, pct };
});
