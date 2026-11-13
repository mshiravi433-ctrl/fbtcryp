import { useEffect, useRef, useState } from 'react';

/**
 * ─── ONE CLOCK FOR THE WHOLE SCREEN ──────────────────────────────────────────
 * Three components on the market screen each own a "what time is it now" state
 * so their age labels can move without re-rendering the page above them
 * (MarketFreshness at 10 s, BtClock and DecisionOrb at 15 s). That isolation
 * is worth keeping — it is what stops the stories reel and 250 rows from
 * re-rendering to move one string.
 *
 * What was NOT worth keeping is three `setInterval`s. They all fire while the
 * tab is open, they are not aligned, so two age labels on screen can disagree
 * about the current time by a second or two, and three timers mean three
 * separate wakeups on a phone that is trying to sleep.
 *
 * This hook keeps ONE interval per period and fans it out to every subscriber:
 *
 *   • the interval exists only while at least one component is subscribed, so
 *     a screen with no age label pays nothing;
 *   • it is torn down on the last unsubscribe — leaving /market leaves no timer
 *     behind, which is a leak this screen has had before;
 *   • a hidden tab clears it entirely and re-reads the clock once on return, so
 *     a backgrounded tab cannot come back claiming the age it had when hidden;
 *   • every subscriber on the same period receives the SAME millisecond.
 *
 * It deliberately does NOT run a free-running global ticker: an idle tab holds
 * zero intervals.
 */

const PERIODS = new Map();
/** Visible-tab timers are throttled to >=1 s; a faster period buys nothing. */
const MIN_PERIOD_MS = 1000;

/** One entry per period, shared by every subscriber on that period. */
function slotFor(periodMs) {
  let slot = PERIODS.get(periodMs);
  if (!slot) {
    slot = { subscribers: new Set(), timer: null };
    PERIODS.set(periodMs, slot);
  }
  return slot;
}

function stopSlot(slot) {
  if (slot.timer != null) {
    clearInterval(slot.timer);
    slot.timer = null;
  }
}

/*
 * The visibility listener is installed once for the module, not once per
 * period or per subscriber: one `visibilitychange` should produce one pass
 * over the live clocks.
 */
let listening = false;

function onVisibilityChange() {
  if (typeof document === 'undefined') return;
  const visible = document.visibilityState === 'visible';
  for (const [periodMs, slot] of PERIODS) {
    if (slot.subscribers.size === 0) continue;
    if (visible) {
      /* Correct the age immediately: the tab may have been away for hours. */
      const now = Date.now();
      for (const fn of slot.subscribers) fn(now);
      if (slot.timer == null) {
        slot.timer = setInterval(() => {
          if (document.visibilityState === 'hidden') return;
          const t = Date.now();
          for (const fn of slot.subscribers) fn(t);
        }, periodMs);
      }
    } else {
      stopSlot(slot);
    }
  }
}

function attachVisibilityListener() {
  if (listening || typeof document === 'undefined') return;
  document.addEventListener('visibilitychange', onVisibilityChange);
  listening = true;
}

function detachVisibilityListenerIfIdle() {
  if (!listening || typeof document === 'undefined') return;
  for (const slot of PERIODS.values()) {
    if (slot.subscribers.size > 0) return;
  }
  document.removeEventListener('visibilitychange', onVisibilityChange);
  listening = false;
}

/**
 * Subscribe to the shared clock for `periodMs`; returns the newest tick.
 *
 * `enabled: false` unsubscribes without unmounting — DecisionOrb uses it while
 * the orb is dismissed, so a hidden orb holds no timer at all.
 */
export function useSharedClock(periodMs = 15000, enabled = true) {
  const period = Math.max(MIN_PERIOD_MS, Math.round(periodMs) || 15000);
  const [now, setNow] = useState(() => Date.now());
  /*
   * `setNow` identity is stable, but keeping it behind a ref means the effect
   * below never needs it in its dependency list, so a re-render of the leaf
   * cannot tear down and re-create the shared interval.
   */
  const setter = useRef(setNow);
  setter.current = setNow;

  useEffect(() => {
    if (!enabled) return undefined;
    const slot = slotFor(period);
    const fn = (value) => setter.current(value);
    slot.subscribers.add(fn);
    attachVisibilityListener();

    /* Read the clock on mount, so a component that appears between ticks is
       never one period stale, then make sure the shared interval is running. */
    setter.current(Date.now());
    if (slot.timer == null && (typeof document === 'undefined' || document.visibilityState === 'visible')) {
      slot.timer = setInterval(() => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
        const t = Date.now();
        for (const sub of slot.subscribers) sub(t);
      }, period);
    }

    return () => {
      slot.subscribers.delete(fn);
      if (slot.subscribers.size === 0) {
        stopSlot(slot);
        PERIODS.delete(period);
      }
      detachVisibilityListenerIfIdle();
    };
  }, [period, enabled]);

  return now;
}

/**
 * Test/debug seam: the intervals that are live right now, by period. Nothing in
 * the app calls this; `test/market-clock.test.mjs` does, to prove that
 * unmounting the last subscriber leaves zero timers behind.
 */
export function __clockState() {
  const live = [];
  for (const [periodMs, slot] of PERIODS) {
    live.push({ periodMs, subscribers: slot.subscribers.size, running: slot.timer != null });
  }
  return live;
}
