const be = require('../boxscore-edit');

describe('boxscore-edit', () => {
  test('emptyLine has the aggregator shape', () => {
    const l = be.emptyLine();
    expect(l.fg).toEqual({ made: 0, attempted: 0 });
    expect(l['3pt']).toEqual({ made: 0, attempted: 0 });
    expect(l.ft).toEqual({ made: 0, attempted: 0 });
    expect(l.pts).toBe(0);
    expect(l.asst).toBe(0);
    expect(l['fg%']).toBeNull();
  });

  test('ACTIONS cover the recorder vocabulary', () => {
    const types = be.ACTIONS.map((a) => a.type);
    expect(types).toEqual([
      '2pt_made', '2pt_miss', '3pt_made', '3pt_miss', 'ft_made', 'ft_miss',
      '2pt_made_remove', '3pt_made_remove', 'ft_made_remove',
      'oreb', 'dreb', 'ast', 'stl', 'blk', 'to', 'foul'
    ]);
  });

  test('applyEvent is pure (does not mutate input)', () => {
    const base = be.emptyLine();
    const next = be.applyEvent(base, '2pt_made');
    expect(base.pts).toBe(0);
    expect(next.pts).toBe(2);
    expect(next).not.toBe(base);
  });

  test('made 2PT bumps fg + points only', () => {
    const l = be.applyEvent(be.emptyLine(), '2pt_made');
    expect(l.fg).toEqual({ made: 1, attempted: 1 });
    expect(l['3pt']).toEqual({ made: 0, attempted: 0 });
    expect(l.pts).toBe(2);
  });

  test('missed 2PT bumps only fg attempts', () => {
    const l = be.applyEvent(be.emptyLine(), '2pt_miss');
    expect(l.fg).toEqual({ made: 0, attempted: 1 });
    expect(l.pts).toBe(0);
  });

  test('made 3PT bumps fg, 3pt and points', () => {
    const l = be.applyEvent(be.emptyLine(), '3pt_made');
    expect(l.fg).toEqual({ made: 1, attempted: 1 });
    expect(l['3pt']).toEqual({ made: 1, attempted: 1 });
    expect(l.pts).toBe(3);
  });

  test('missed 3PT bumps fg + 3pt attempts', () => {
    const l = be.applyEvent(be.emptyLine(), '3pt_miss');
    expect(l.fg).toEqual({ made: 0, attempted: 1 });
    expect(l['3pt']).toEqual({ made: 0, attempted: 1 });
    expect(l.pts).toBe(0);
  });

  test('free throws affect ft + points', () => {
    let l = be.applyEvent(be.emptyLine(), 'ft_made');
    l = be.applyEvent(l, 'ft_miss');
    expect(l.ft).toEqual({ made: 1, attempted: 2 });
    expect(l.pts).toBe(1);
  });

  test('counting events increment the right keys', () => {
    const map = { oreb: 'oreb', dreb: 'dreb', ast: 'asst', stl: 'stl', blk: 'blk', to: 'to', foul: 'foul' };
    Object.entries(map).forEach(([type, key]) => {
      const l = be.applyEvent(be.emptyLine(), type);
      expect(l[key]).toBe(1);
    });
  });

  test('applyEvent works on a sparse CSV-style line (null/missing fields)', () => {
    const sparse = { pts: 4, fg: null, foul: null };
    const l = be.applyEvent(sparse, '3pt_made');
    expect(l.fg).toEqual({ made: 1, attempted: 1 });
    expect(l['3pt']).toEqual({ made: 1, attempted: 1 });
    expect(l.pts).toBe(7);
    expect(l.foul).toBe(0);
  });

  test('unknown type is a safe clone', () => {
    const base = be.applyEvent(be.emptyLine(), '2pt_made');
    const l = be.applyEvent(base, 'nonsense');
    expect(l.pts).toBe(2);
    expect(l).not.toBe(base);
  });

  test('recomputePercentages rounds and handles 0-attempt -> null', () => {
    const l = be.emptyLine();
    l.fg = { made: 5, attempted: 10 };
    l['3pt'] = { made: 1, attempted: 3 };
    l.ft = { made: 0, attempted: 0 };
    be.recomputePercentages(l);
    expect(l['fg%']).toBe(50);
    expect(l['3pt%']).toBe(33);
    expect(l['ft%']).toBeNull();
  });

  test('multi-event sequence totals correctly with percentages', () => {
    let l = be.emptyLine();
    l = be.applyEvent(l, '3pt_made');
    l = be.applyEvent(l, '3pt_made');
    l = be.applyEvent(l, '2pt_miss');
    be.recomputePercentages(l);
    expect(l.fg).toEqual({ made: 2, attempted: 3 });
    expect(l['3pt']).toEqual({ made: 2, attempted: 2 });
    expect(l.pts).toBe(6);
    expect(l['fg%']).toBe(67);
    expect(l['3pt%']).toBe(100);
  });

  describe('removing a made shot', () => {
    // 3/5 FG (2 twos + 1 three made), 2/3 FT, 9 pts
    const line = () => ({
      ...be.emptyLine(),
      fg: { made: 3, attempted: 5 },
      '3pt': { made: 1, attempted: 2 },
      ft: { made: 2, attempted: 3 },
      pts: 9
    });

    test('-2PT is the exact inverse of a made 2PT and keeps the ratio honest', () => {
      const l = be.recomputePercentages(be.applyEvent(line(), '2pt_made_remove'));
      expect(l.fg).toEqual({ made: 2, attempted: 4 });
      expect(l['3pt']).toEqual({ made: 1, attempted: 2 });
      expect(l.pts).toBe(7);
      expect(l['fg%']).toBe(50);
    });

    test('-3PT reverses fg, 3pt and points', () => {
      const l = be.applyEvent(line(), '3pt_made_remove');
      expect(l.fg).toEqual({ made: 2, attempted: 4 });
      expect(l['3pt']).toEqual({ made: 0, attempted: 1 });
      expect(l.pts).toBe(6);
    });

    test('-FT reverses ft and points', () => {
      const l = be.applyEvent(line(), 'ft_made_remove');
      expect(l.ft).toEqual({ made: 1, attempted: 2 });
      expect(l.pts).toBe(8);
    });

    test('add then remove round-trips to the original line', () => {
      ['2pt', '3pt', 'ft'].forEach((k) => {
        const l = be.applyEvent(be.applyEvent(line(), `${k}_made`), `${k}_made_remove`);
        expect(l).toEqual(line());
      });
    });

    test('remove is pure (does not mutate input)', () => {
      const base = line();
      const next = be.applyEvent(base, '3pt_made_remove');
      expect(base.pts).toBe(9);
      expect(base['3pt']).toEqual({ made: 1, attempted: 2 });
      expect(next).not.toBe(base);
    });

    test('canApply needs a matching made shot', () => {
      const onlyThrees = { fg: { made: 2, attempted: 4 }, '3pt': { made: 2, attempted: 3 }, ft: { made: 0, attempted: 2 } };
      expect(be.canApply(onlyThrees, '2pt_made_remove')).toBe(false);
      expect(be.canApply(onlyThrees, '3pt_made_remove')).toBe(true);
      expect(be.canApply(onlyThrees, 'ft_made_remove')).toBe(false);
      expect(be.canApply(null, '3pt_made_remove')).toBe(false);
      expect(be.canApply(null, '2pt_made')).toBe(true);
      expect(be.canApply(line(), '2pt_made_remove')).toBe(true);
    });

    test('a refused remove is a no-op, never going negative', () => {
      const onlyThrees = { ...be.emptyLine(), fg: { made: 1, attempted: 1 }, '3pt': { made: 1, attempted: 1 }, pts: 3 };
      const l = be.applyEvent(onlyThrees, '2pt_made_remove');
      expect(l.fg).toEqual({ made: 1, attempted: 1 });
      expect(l.pts).toBe(3);
      const e = be.applyEvent(be.emptyLine(), 'ft_made_remove');
      expect(e.ft).toEqual({ made: 0, attempted: 0 });
      expect(e.pts).toBe(0);
    });
  });
});
