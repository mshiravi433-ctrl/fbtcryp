/**
 * INTENT RAIL STORE — one source of truth for the execution gate.
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * The pause / emergency-stop / human-agent controls used to live in the Intent
 * OS rail component, which owned their state in `useState` seeded from
 * localStorage. When those three were moved off that screen, they were moved
 * NOWHERE — the rail had been the only caller of `pauseExecution`,
 * `engageEmergencyStop` and `requestHumanAgent` in the whole app, so the gate
 * became unreachable while every probe kept passing (they test the module, not
 * the screen that calls it).
 *
 * The fix has to put the controls on another screen — and the moment two
 * screens can change the gate, they cannot each hold their own copy of it: one
 * would say STOPPED while the other said RUNNING, and "the emergency stop did
 * not work" is not a bug anyone should have to debug from a screenshot.
 *
 * So the state lives here: persisted, subscribable, and read through
 * `useSyncExternalStore` by every surface that shows or changes it. `commit()`
 * is the only way in, and it only accepts a result the module marked `ok`, so a
 * refused transition (releasing a stop without confirmation, pausing while
 * stopped) can never mutate what is on screen.
 */

import {
  initialRailState, restore, snapshot,
  pauseExecution, resumeExecution, engageEmergencyStop, releaseEmergencyStop,
  requestHumanAgent, toggleRail, mayExecute
} from './intentRailControls.js';

const RAIL_STORE_KEY = 'fbt-intent-rail-v1';

/* Same tamper-safe restore the component used: a record that fails its check
   degrades to STOPPED, never to running. */
const boot = () => {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(RAIL_STORE_KEY) : null;
    if (!raw) return { state: initialRailState(), degraded: false };
    return restore(raw);
  } catch {
    return { state: initialRailState(), degraded: false };
  }
};

let snap = { ...boot(), booted: true };
const listeners = new Set();

const emit = () => {
  for (const fn of listeners) {
    try { fn(); } catch { /* a broken listener must not stop the others */ }
  }
};

const persist = () => {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(RAIL_STORE_KEY, snapshot(snap.state));
  } catch { /* storage full or blocked — the in-memory state is still correct */ }
};

/** Fusion-style subscribe: called with no arguments, returns an unsubscribe. */
export function subscribeRail(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Stable between changes, which `useSyncExternalStore` requires. */
export const getRailSnapshot = () => snap;

/**
 * Apply a transition. Returns the module's own result, unchanged, so callers
 * can read `code` and explain a refusal. Only `ok: true` mutates the store.
 */
export function commitRail(result) {
  if (!result || result.ok !== true) return result;
  snap = { ...snap, state: result.state, degraded: false };
  persist();
  emit();
  return result;
}

/* ------------------------------- actions -------------------------------- */
/* Thin, named wrappers: every mutation of the gate is listed here, and none of
   them can bypass the module's own guards. */
/* `PAUSE_PRESETS_MS` is m5 / h1 / d1. An unknown preset is passed through and
   refused by the module as an indefinite pause rather than silently ignored —
   a pause with no end is the stricter of the two mistakes. */
export const railPause = (preset = 'h1', reason = null) =>
  commitRail(pauseExecution(snap.state, { preset, reason }));

export const railResume = () => commitRail(resumeExecution(snap.state));

export const railEngageStop = (reason = null, unwind = false) =>
  commitRail(engageEmergencyStop(snap.state, { reason, unwind }));

/** The two-tap rule lives in the module; a wrong token is simply refused. */
export const railReleaseStop = () =>
  commitRail(releaseEmergencyStop(snap.state, { confirmationToken: 'release-confirmed' }));

export const railRequestHuman = () => commitRail(requestHumanAgent(snap.state));

export const railToggleCollapse = () => commitRail(toggleRail(snap.state));

/** Read-only verdict. `clock` is passed so a paused rail re-evaluates as time
 *  passes without the caller having to subscribe to a timer. */
export const railMayExecute = (clock = Date.now()) => mayExecute(snap.state, { now: clock });

/* --------------------------- cross-tab agreement ------------------------ */
/*
 * Two tabs open is normal on desktop. Without this, pausing in one leaves the
 * other showing RUNNING and letting the user carry on — which is precisely the
 * disagreement this store was created to prevent.
 */
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (event) => {
    if (event.key !== RAIL_STORE_KEY) return;
    snap = { ...boot(), booted: true };
    emit();
  });
}
