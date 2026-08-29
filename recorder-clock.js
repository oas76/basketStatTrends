// ========================================
// RECORDER CLOCK + RULES ENGINE
// ========================================
// Owns the game clock (run/stop, period, remaining time) and the rule layer that
// auto-stops the clock the way basketball rules require:
//   - stop on a foul
//   - stop on a substitution
//   - stop on a made basket in the last 2:00 (final period + OT by default)
//   - remind the recorder to restart 10s after any stoppage
// Auto-rules only ever STOP the clock; the recorder always restarts manually
// (models the throw-in).
//
// The pure decision helpers (shouldStopClock / isLastTwoMinutes) are exported for
// unit testing. UMD: window.recorderClock in the browser, module.exports in Node.

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.recorderClock = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TWO_MINUTES_MS = 2 * 60 * 1000;

  const DEFAULT_CLOCK_RULES = {
    autoStopOnFoul: true,
    autoStopOnSub: true,
    lastTwoMinStopOnMadeBasket: true,
    lastTwoMinScope: 'finalAndOT', // or 'allPeriods'
    lastTwoMinIncludeFT: false,
    restartReminderSec: 10
  };

  const MADE_BASKET_TYPES = new Set(['2pt_made', '3pt_made']);

  function normalizeRules(rules) {
    return Object.assign({}, DEFAULT_CLOCK_RULES, rules || {});
  }

  /** Is the given remaining time within the last two minutes of the period? */
  function isLastTwoMinutes(clockMs) {
    return typeof clockMs === 'number' && clockMs >= 0 && clockMs <= TWO_MINUTES_MS;
  }

  /** Does the last-2-min scope apply to this period? */
  function lastTwoMinScopeApplies(period, periods, scope) {
    const regCount = Number(periods) > 0 ? Number(periods) : 4;
    if (scope === 'allPeriods') return true;
    // finalAndOT: the final regulation period and any overtime period.
    return Number(period) >= regCount;
  }

  /**
   * Decide whether an event should auto-stop the clock.
   * ctx = { period, periods, remainingMs }. Uses event.clockMs when present,
   * otherwise falls back to ctx.remainingMs.
   * Returns { stop: boolean, reason: string|null }.
   */
  function shouldStopClock(event, ctx, rules) {
    const r = normalizeRules(rules);
    const c = ctx || {};
    if (!event || !event.type) return { stop: false, reason: null };
    const type = event.type;

    if (type === 'foul' && r.autoStopOnFoul) {
      return { stop: true, reason: 'foul' };
    }
    if ((type === 'sub_in' || type === 'sub_out') && r.autoStopOnSub) {
      return { stop: true, reason: 'substitution' };
    }

    const isMadeBasket = MADE_BASKET_TYPES.has(type) ||
      (type === 'ft_made' && r.lastTwoMinIncludeFT);
    if (isMadeBasket && r.lastTwoMinStopOnMadeBasket) {
      const clockMs = typeof event.clockMs === 'number' ? event.clockMs : c.remainingMs;
      if (isLastTwoMinutes(clockMs) &&
          lastTwoMinScopeApplies(c.period, c.periods, r.lastTwoMinScope)) {
        return { stop: true, reason: 'last-2-min' };
      }
    }

    return { stop: false, reason: null };
  }

  /**
   * Create a clock controller. Options:
   *   meta                     { periods, periodLengthMin, otLengthMin }
   *   rules                    clock rules (merged over defaults)
   *   onTick(remainingMs)      called as the clock counts down
   *   onStateChange(state)     called on start/stop/period/remaining changes
   *   onExpire()               called when a period hits 0:00
   *   onRestartReminder()      called restartReminderSec after a stoppage (repeats)
   *   now / setTimeoutFn / clearTimeoutFn / setIntervalFn / clearIntervalFn
   *                            injectable timers (default to globals) for tests
   */
  function createClockController(options) {
    const opts = options || {};
    const meta = opts.meta || {};
    const rules = normalizeRules(opts.rules);
    const now = opts.now || (() => Date.now());
    const setTimeoutFn = opts.setTimeoutFn || ((fn, ms) => setTimeout(fn, ms));
    const clearTimeoutFn = opts.clearTimeoutFn || ((h) => clearTimeout(h));
    const setIntervalFn = opts.setIntervalFn || ((fn, ms) => setInterval(fn, ms));
    const clearIntervalFn = opts.clearIntervalFn || ((h) => clearInterval(h));

    const periods = Number(meta.periods) > 0 ? Number(meta.periods) : 4;
    const regLenMs = (Number(meta.periodLengthMin) > 0 ? Number(meta.periodLengthMin) : 10) * 60000;
    const otLenMs = (Number(meta.otLengthMin) > 0 ? Number(meta.otLengthMin) : 5) * 60000;

    const lengthForPeriod = (p) => (p > periods ? otLenMs : regLenMs);

    const state = {
      running: false,
      period: 1,
      remainingMs: regLenMs
    };

    let tickHandle = null;
    let reminderHandle = null;
    let lastTs = 0;

    const emitState = (reason) => {
      if (opts.onStateChange) opts.onStateChange(Object.assign({ reason }, state));
    };

    const stopReminder = () => {
      if (reminderHandle != null) {
        clearTimeoutFn(reminderHandle);
        reminderHandle = null;
      }
    };

    const scheduleReminder = () => {
      stopReminder();
      const sec = Number(rules.restartReminderSec);
      if (!(sec > 0)) return;
      reminderHandle = setTimeoutFn(function fire() {
        if (opts.onRestartReminder) opts.onRestartReminder();
        // Keep nudging until the recorder restarts the clock.
        reminderHandle = setTimeoutFn(fire, sec * 1000);
      }, sec * 1000);
    };

    const stopTick = () => {
      if (tickHandle != null) {
        clearIntervalFn(tickHandle);
        tickHandle = null;
      }
    };

    const tick = () => {
      const t = now();
      const elapsed = t - lastTs;
      lastTs = t;
      state.remainingMs = Math.max(0, state.remainingMs - elapsed);
      if (opts.onTick) opts.onTick(state.remainingMs);
      if (state.remainingMs <= 0) {
        stop('expired');
        if (opts.onExpire) opts.onExpire();
      }
    };

    function start() {
      if (state.running) return false;
      state.running = true;
      lastTs = now();
      stopReminder();
      stopTick();
      tickHandle = setIntervalFn(tick, 200);
      emitState('start');
      return true;
    }

    function stop(reason) {
      const was = state.running;
      state.running = false;
      stopTick();
      if (was) {
        scheduleReminder();
        emitState(reason || 'stop');
      }
      return was;
    }

    function toggle() {
      return state.running ? stop('manual') : start();
    }

    function setPeriod(p) {
      const period = Math.max(1, Math.floor(Number(p) || 1));
      state.period = period;
      state.remainingMs = lengthForPeriod(period);
      state.running = false;
      stopTick();
      stopReminder();
      emitState('period');
    }

    function nextPeriod() {
      setPeriod(state.period + 1);
    }

    /** Manually override the remaining time (used by after-the-fact edits). */
    function setRemaining(ms) {
      state.remainingMs = Math.max(0, Number(ms) || 0);
      emitState('remaining');
    }

    function getState() {
      return Object.assign({}, state);
    }

    /**
     * Feed an event through the rule layer. Auto-stops the clock when a rule
     * fires. Returns the decision { stop, reason }.
     */
    function handleEvent(event) {
      const decision = shouldStopClock(
        event,
        { period: state.period, periods, remainingMs: state.remainingMs },
        rules
      );
      if (decision.stop && state.running) {
        stop(decision.reason);
      }
      return decision;
    }

    function destroy() {
      stopTick();
      stopReminder();
    }

    return {
      start,
      stop,
      toggle,
      setPeriod,
      nextPeriod,
      setRemaining,
      getState,
      handleEvent,
      destroy,
      rules,
      periods
    };
  }

  return {
    TWO_MINUTES_MS,
    DEFAULT_CLOCK_RULES,
    normalizeRules,
    isLastTwoMinutes,
    lastTwoMinScopeApplies,
    shouldStopClock,
    createClockController
  };
});
