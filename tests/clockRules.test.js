const CLK = require('../recorder-clock');

describe('shouldStopClock', () => {
  const base = { period: 4, periods: 4, remainingMs: 300000 };

  test('stops on a foul', () => {
    expect(CLK.shouldStopClock({ type: 'foul' }, base).stop).toBe(true);
    expect(CLK.shouldStopClock({ type: 'foul' }, base).reason).toBe('foul');
  });

  test('stops on a substitution', () => {
    expect(CLK.shouldStopClock({ type: 'sub_in' }, base).reason).toBe('substitution');
    expect(CLK.shouldStopClock({ type: 'sub_out' }, base).reason).toBe('substitution');
  });

  test('stops on an opponent foul like our own foul', () => {
    expect(CLK.shouldStopClock({ type: 'opp_foul' }, base).stop).toBe(true);
    expect(CLK.shouldStopClock({ type: 'opp_foul' }, base).reason).toBe('foul');
    // Honors the same rule toggle as our fouls.
    expect(CLK.shouldStopClock({ type: 'opp_foul' }, base, { autoStopOnFoul: false }).stop).toBe(false);
  });

  test('respects autoStop rule toggles', () => {
    const rules = { autoStopOnFoul: false, autoStopOnSub: false };
    expect(CLK.shouldStopClock({ type: 'foul' }, base, rules).stop).toBe(false);
    expect(CLK.shouldStopClock({ type: 'sub_in' }, base, rules).stop).toBe(false);
  });

  test('stops on a made basket in the last two minutes of the final period', () => {
    const ev = { type: '2pt_made', clockMs: 90000 }; // 1:30 left
    expect(CLK.shouldStopClock(ev, { period: 4, periods: 4 }).reason).toBe('last-2-min');
  });

  test('does not stop in the last two minutes of an early period (finalAndOT scope)', () => {
    const ev = { type: '2pt_made', clockMs: 90000 };
    expect(CLK.shouldStopClock(ev, { period: 1, periods: 4 }).stop).toBe(false);
  });

  test('allPeriods scope stops on early-period late baskets', () => {
    const ev = { type: '3pt_made', clockMs: 90000 };
    const rules = { lastTwoMinScope: 'allPeriods' };
    expect(CLK.shouldStopClock(ev, { period: 1, periods: 4 }, rules).stop).toBe(true);
  });

  test('does not stop a made basket earlier than two minutes', () => {
    const ev = { type: '2pt_made', clockMs: 180000 }; // 3:00
    expect(CLK.shouldStopClock(ev, { period: 4, periods: 4 }).stop).toBe(false);
  });

  test('free throws only trigger the last-2-min stop when configured', () => {
    const ev = { type: 'ft_made', clockMs: 60000 };
    expect(CLK.shouldStopClock(ev, { period: 4, periods: 4 }).stop).toBe(false);
    expect(CLK.shouldStopClock(ev, { period: 4, periods: 4 }, { lastTwoMinIncludeFT: true }).stop).toBe(true);
  });
});

describe('clock controller restart reminder', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

  test('fires a repeating reminder after a stoppage and cancels on restart', () => {
    const onRestartReminder = jest.fn();
    const ctrl = CLK.createClockController({
      meta: { periods: 4, periodLengthMin: 10 },
      rules: { restartReminderSec: 10 },
      onRestartReminder
    });

    ctrl.start();
    ctrl.stop('manual');
    expect(onRestartReminder).not.toHaveBeenCalled();

    jest.advanceTimersByTime(10000);
    expect(onRestartReminder).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(10000);
    expect(onRestartReminder).toHaveBeenCalledTimes(2);

    // Restarting the clock cancels further reminders.
    ctrl.start();
    jest.advanceTimersByTime(30000);
    expect(onRestartReminder).toHaveBeenCalledTimes(2);
    ctrl.destroy();
  });

  test('remindRestart nudges immediately and repeats (used after next period)', () => {
    const onRestartReminder = jest.fn();
    const ctrl = CLK.createClockController({
      meta: { periods: 4, periodLengthMin: 10 },
      rules: { restartReminderSec: 10 },
      onRestartReminder
    });

    ctrl.nextPeriod(); // clock is stopped for the new period
    expect(ctrl.getState().running).toBe(false);
    expect(onRestartReminder).not.toHaveBeenCalled();

    ctrl.remindRestart();
    expect(onRestartReminder).toHaveBeenCalledTimes(1); // fires right away

    jest.advanceTimersByTime(10000);
    expect(onRestartReminder).toHaveBeenCalledTimes(2); // and keeps nudging

    ctrl.start(); // starting the clock cancels further reminders
    jest.advanceTimersByTime(30000);
    expect(onRestartReminder).toHaveBeenCalledTimes(2);
    ctrl.destroy();
  });

  test('handleEvent auto-stops the running clock on a foul', () => {
    const ctrl = CLK.createClockController({ meta: { periods: 4, periodLengthMin: 10 } });
    ctrl.setPeriod(1);
    ctrl.start();
    expect(ctrl.getState().running).toBe(true);
    const decision = ctrl.handleEvent({ type: 'foul' });
    expect(decision.stop).toBe(true);
    expect(ctrl.getState().running).toBe(false);
    ctrl.destroy();
  });
});
