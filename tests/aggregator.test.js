const AGG = require('../recorder-aggregator');

// A deterministic period-1 scenario with a substitution, an assist, an opponent
// score, made/missed shots and a few counting stats. Times are clock-remaining.
function scenarioDraft() {
  const mk = (id, seq, clockMs, type, player, extra) =>
    Object.assign({ id, seq, period: 1, clockMs, type, player: player || null }, extra || {});
  return {
    meta: { periods: 4, periodLengthMin: 10, otLengthMin: 5 },
    roster: [
      { name: 'A', number: 4, starter: true },
      { name: 'B', number: 5, starter: true },
      { name: 'C', number: 6, starter: true },
      { name: 'D', number: 7, starter: true },
      { name: 'E', number: 8, starter: true },
      { name: 'F', number: 9, starter: false }
    ],
    events: [
      mk('bk1', 1, 540000, '2pt_made', 'A'),
      mk('as1', 2, 540000, 'ast', 'B', { linkedEventId: 'bk1' }),
      mk('bk2', 3, 480000, '3pt_made', 'C'),
      mk('op1', 4, 420000, 'opp_pts', null, { value: 2 }),
      mk('ms1', 5, 360000, '2pt_miss', 'A'),
      mk('so1', 6, 300000, 'sub_out', 'E'),
      mk('si1', 7, 300000, 'sub_in', 'F'),
      mk('bk3', 8, 240000, '2pt_made', 'F'),
      mk('rb1', 9, 180000, 'dreb', 'D'),
      mk('to1', 10, 120000, 'to', 'B')
    ]
  };
}

describe('eventsToPerformances', () => {
  const perf = AGG.eventsToPerformances(scenarioDraft());

  test('counts made/missed shots and points', () => {
    expect(perf.A.fg).toEqual({ made: 1, attempted: 2 });
    expect(perf.A['fg%']).toBe(50);
    expect(perf.A.pts).toBe(2);
    expect(perf.C.fg).toEqual({ made: 1, attempted: 1 });
    expect(perf.C['3pt']).toEqual({ made: 1, attempted: 1 });
    expect(perf.C.pts).toBe(3);
    expect(perf.F.pts).toBe(2);
  });

  test('counts assists, rebounds and turnovers', () => {
    expect(perf.B.asst).toBe(1);
    expect(perf.B.to).toBe(1);
    expect(perf.D.dreb).toBe(1);
  });

  test('computes minutes from starters + substitutions', () => {
    expect(perf.A.min).toBe(8);
    expect(perf.E.min).toBe(5); // subbed out at 5:00 elapsed
    expect(perf.F.min).toBe(3); // subbed in at 5:00, played to 8:00
  });

  test('computes +/- from on-court team vs opponent points', () => {
    // A/B/C/D on court for all scoring: +2 +3 -2(opp) +2 = +5
    expect(perf.A['+/-']).toBe(5);
    expect(perf.D['+/-']).toBe(5);
    // E left before F's basket: +2 +3 -2 = +3
    expect(perf.E['+/-']).toBe(3);
    // F only saw own basket: +2
    expect(perf.F['+/-']).toBe(2);
  });

  test('includes players with minutes but no counting stats', () => {
    expect(perf.E).toBeDefined();
    expect(perf.E.pts).toBe(0);
  });

  test('recorder-produced drafts only yield roster players (no implicit create)', () => {
    // The recorder builds its roster only from existing team players and its
    // events only reference those roster players, so the import path never
    // invents new players. Every performance key must map to a roster entry.
    const draft = scenarioDraft();
    const rosterNames = new Set(draft.roster.map((r) => r.name));
    Object.keys(perf).forEach((name) => {
      expect(rosterNames.has(name)).toBe(true);
    });
    // The registry map the importer applies is derived purely from the roster,
    // so it can only ever set numbers of existing roster players.
    const found = AGG.rosterToPlayersFound(draft);
    Object.keys(found).forEach((name) => {
      expect(rosterNames.has(name)).toBe(true);
    });
  });

  test('ignores an assist linked to a deleted basket (recompute after delete)', () => {
    const d = scenarioDraft();
    // Delete A's basket bk1; the linked assist as1 must no longer count.
    d.events = d.events.filter((e) => e.id !== 'bk1');
    const p2 = AGG.eventsToPerformances(d);
    expect(p2.B.asst).toBe(0);
    expect(p2.A.pts).toBe(0);
    expect(p2.A.fg).toEqual({ made: 0, attempted: 1 });
  });

  test('recompute reflects an edited event type', () => {
    const d = scenarioDraft();
    const miss = d.events.find((e) => e.id === 'ms1');
    miss.type = '2pt_made'; // fix a miss into a make
    const p2 = AGG.eventsToPerformances(d);
    expect(p2.A.fg).toEqual({ made: 2, attempted: 2 });
    expect(p2.A.pts).toBe(4);
  });

  test('event-first: an unassigned event contributes nothing until attributed', () => {
    // The event-first flow lets a recorder capture the event now and attribute
    // the player later ("Assign later" -> player: null). Such an event must not
    // credit any player until a name is filled in from the log/edit sheet.
    const d = scenarioDraft();
    d.events.push({ id: 'un1', seq: 11, period: 1, clockMs: 60000, type: '3pt_made', player: null });
    const before = AGG.eventsToPerformances(d);
    const totalPtsBefore = Object.keys(before).reduce((s, n) => s + before[n].pts, 0);

    // Now attribute the same event to D and recompute.
    d.events.find((e) => e.id === 'un1').player = 'D';
    const after = AGG.eventsToPerformances(d);
    const totalPtsAfter = Object.keys(after).reduce((s, n) => s + after[n].pts, 0);

    expect(totalPtsAfter - totalPtsBefore).toBe(3);
    expect(after.D['3pt']).toEqual({ made: 1, attempted: 1 });
    expect(after.D.pts).toBe(3);
  });
});

describe('period time helpers', () => {
  const meta = { periods: 4, periodLengthMin: 10, otLengthMin: 5 };
  test('globalTimeOf accumulates across periods', () => {
    // Start of period 2 with full clock => 10:00 elapsed of period 1.
    expect(AGG.globalTimeOf({ period: 2, clockMs: 600000 }, meta)).toBe(600000);
    // Overtime uses OT length.
    expect(AGG.periodLengthMs(5, meta)).toBe(5 * 60000);
  });
});
