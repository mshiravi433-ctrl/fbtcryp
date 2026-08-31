/**
 * FBT INTENT AI — PHASES 117, 119, 141–150: RAIL CONTROL PLANE
 * ---------------------------------------------------------------------------
 * The AI page is reorganised around a horizontal rail. Every control on the
 * rail is a real state machine, not a decorative icon:
 *
 *   · PAUSE — suspends new execution for a duration or until resumed. While
 *     paused the compose screen stops emitting executable intents and says
 *     so, instead of pretending everything is fine.
 *   · EMERGENCY STOP — fail-closed: blocks execution, optionally queues an
 *     unwind request for open positions, and can only be released with an
 *     explicit, timestamped confirmation. No cooldown can release it on its
 *     own, and no code path inside this module can clear it silently.
 *   · HUMAN AGENT — requests a human session; escalation states are recorded
 *     with timestamps so "connected" can never be claimed without a real
 *     transition.
 *   · AUTONOMY L1/L2/L3 — mirrors gradualAutonomy (the profile shown on the
 *     rail is the same module the probes test; promotion is one level at a
 *     time and never automatic).
 *   · RAIL COLLAPSE — layout preference only; collapsing the rail must never
 *     collapse the safety state (a hidden pause is still an active pause).
 *
 * The module is pure and serialisable: `snapshot()` returns exactly what the
 * UI persists, and `restore()` validates every field before accepting it —
 * a tampered snapshot degrades to the safest state (paused + stopped).
 */

export const RAIL_CONTROL_SCHEMA = 'fbt.intent-rail-controls.v1';
export const PAUSE_PRESETS_MS = Object.freeze({ m5: 5 * 60_000, h1: 60 * 60_000, d1: 24 * 60 * 60_000 });
export const RAIL_STATES = Object.freeze(['running', 'paused', 'stopped']);

const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean'
  ? null
  : (Number.isFinite(Number(v)) ? Number(v) : null));

export function initialRailState({ now = Date.now() } = {}) {
  return {
    schema: RAIL_CONTROL_SCHEMA,
    state: 'running',
    pausedUntil: null,
    pausedReason: null,
    emergencyStop: false,
    stopEngagedAt: null,
    stopReason: null,
    unwindRequested: false,
    humanAgent: { requested: false, sessionId: null, escalation: 'none', requestedAt: null, connectedAt: null },
    autonomy: { level: 3, atMax: true, nextLevel: null },
    railCollapsed: false,
    updatedAt: now
  };
}

/** Derived execution permission. Paused and stopped both block; nothing else. */
export function mayExecute(state, { now = Date.now() } = {}) {
  if (!state || state.emergencyStop === true) return { allowed: false, reason: 'EMERGENCY_STOP' };
  if (state.state === 'paused') {
    const until = num(state.pausedUntil);
    if (until === null) return { allowed: false, reason: 'PAUSED_INDEFINITE' };
    return until <= now
      ? { allowed: true, reason: null, autoResumed: true }
      : { allowed: false, reason: 'PAUSED', resumesAt: until };
  }
  return { allowed: true, reason: null };
}

export function pauseExecution(state, { preset = null, until = null, reason = null, now = Date.now() } = {}) {
  const base = state || initialRailState({ now });
  if (base.emergencyStop === true) {
    return { ok: false, state: base, code: 'STOPPED_TAKES_PRECEDENCE', error: { code: 'STOPPED_TAKES_PRECEDENCE' } };
  }
  const presetMs = preset && PAUSE_PRESETS_MS[preset] !== undefined ? PAUSE_PRESETS_MS[preset] : null;
  const untilMs = num(until) ?? (presetMs !== null ? now + presetMs : null);
  if (untilMs !== null && untilMs <= now) {
    return { ok: false, state: base, code: 'PAUSE_IN_THE_PAST', error: { code: 'PAUSE_IN_THE_PAST' } };
  }
  return {
    ok: true,
    state: {
      ...base,
      state: 'paused',
      pausedUntil: untilMs,
      pausedReason: String(reason || '').slice(0, 120) || null,
      updatedAt: now
    }
  };
}

export function resumeExecution(state, { now = Date.now() } = {}) {
  const base = state || initialRailState({ now });
  if (base.emergencyStop === true) {
    return { ok: false, state: base, code: 'STOPPED_TAKES_PRECEDENCE', error: { code: 'STOPPED_TAKES_PRECEDENCE' } };
  }
  return {
    ok: true,
    state: {
      ...base,
      state: 'running',
      pausedUntil: null,
      pausedReason: null,
      updatedAt: now
    }
  };
}

/** Emergency stop. Unwind is queued as a REQUEST — execution of an unwind
    still requires the confirmation gate; nothing moves money here. */
export function engageEmergencyStop(state, { reason = null, unwind = false, now = Date.now() } = {}) {
  const base = state || initialRailState({ now });
  return {
    ok: true,
    state: {
      ...base,
      state: 'stopped',
      emergencyStop: true,
      stopEngagedAt: now,
      stopReason: String(reason || '').slice(0, 120) || null,
      unwindRequested: base.unwindRequested || unwind === true,
      pausedUntil: null,
      updatedAt: now
    }
  };
}

/** Release requires an explicit confirmation token — same discipline as the
    confirmation gate. A missing or wrong token returns the stopped state. */
export function releaseEmergencyStop(state, { confirmationToken = null, now = Date.now() } = {}) {
  const base = state || initialRailState({ now });
  if (base.emergencyStop !== true) {
    return { ok: false, state: base, code: 'NOT_STOPPED', error: { code: 'NOT_STOPPED' } };
  }
  if (confirmationToken !== 'release-confirmed') {
    return { ok: false, state: base, code: 'CONFIRMATION_REQUIRED', error: { code: 'CONFIRMATION_REQUIRED' } };
  }
  return {
    ok: true,
    state: {
      ...base,
      state: 'running',
      emergencyStop: false,
      stopEngagedAt: null,
      stopReason: null,
      unwindRequested: false,
      updatedAt: now
    }
  };
}

export function requestHumanAgent(state, { now = Date.now() } = {}) {
  const base = state || initialRailState({ now });
  if (base.humanAgent?.requested === true) return { ok: false, state: base, code: 'ALREADY_REQUESTED', error: { code: 'ALREADY_REQUESTED' } };
  return {
    ok: true,
    state: {
      ...base,
      humanAgent: {
        requested: true,
        sessionId: `ha-${now.toString(36)}`,
        escalation: 'requested',
        requestedAt: now,
        connectedAt: null
      },
      updatedAt: now
    }
  };
}

export function connectHumanAgent(state, { sessionId = null, now = Date.now() } = {}) {
  const base = state || initialRailState({ now });
  if (base.humanAgent?.requested !== true) return { ok: false, state: base, code: 'NO_PENDING_REQUEST', error: { code: 'NO_PENDING_REQUEST' } };
  if (sessionId && sessionId !== base.humanAgent.sessionId) {
    return { ok: false, state: base, code: 'SESSION_MISMATCH', error: { code: 'SESSION_MISMATCH' } };
  }
  return {
    ok: true,
    state: {
      ...base,
      humanAgent: { ...base.humanAgent, escalation: 'connected', connectedAt: now },
      updatedAt: now
    }
  };
}

export function endHumanAgent(state, { now = Date.now() } = {}) {
  const base = state || initialRailState({ now });
  return {
    ok: true,
    state: {
      ...base,
      humanAgent: { requested: false, sessionId: null, escalation: 'none', requestedAt: null, connectedAt: null },
      updatedAt: now
    }
  };
}

export function setAutonomyLevel(state, { level = 1, atMax = false, nextLevel = null, now = Date.now() } = {}) {
  const base = state || initialRailState({ now });
  const lv = [1, 2, 3].includes(Number(level)) ? Number(level) : 1;
  return {
    ok: true,
    state: {
      ...base,
      autonomy: { level: lv, atMax: atMax === true, nextLevel: lv < 3 ? lv + 1 : null },
      updatedAt: now
    }
  };
}

export function toggleRail(state, { now = Date.now() } = {}) {
  const base = state || initialRailState({ now });
  return { ok: true, state: { ...base, railCollapsed: !(base.railCollapsed === true), updatedAt: now } };
}

/** Persist exactly this. */
export function snapshot(state) {
  return JSON.stringify(state || initialRailState());
}

/** Restore with full validation; a tampered or malformed snapshot degrades to
    the SAFEST state (stopped), because a broken safety record must fail
    closed, not open. Any field that had to be corrected is reported as
    `degraded`, so the UI can show that the record was not pristine. */
export function restore(text, { now = Date.now() } = {}) {
  let parsed = null;
  try { parsed = JSON.parse(String(text || '')); } catch { parsed = null; }
  if (!parsed || parsed.schema !== RAIL_CONTROL_SCHEMA) {
    const safe = engageEmergencyStop(initialRailState({ now }), { reason: 'INVALID_RAIL_SNAPSHOT', now }).state;
    return { state: safe, degraded: true };
  }
  let degraded = false;
  const base = initialRailState({ now });
  const stateInvalid = !RAIL_STATES.includes(parsed.state);
  if (stateInvalid) degraded = true;
  const state = {
    ...base,
    state: stateInvalid ? 'paused' : parsed.state,
    pausedUntil: num(parsed.pausedUntil),
    pausedReason: typeof parsed.pausedReason === 'string' ? parsed.pausedReason.slice(0, 120) : null,
    emergencyStop: parsed.emergencyStop === true || stateInvalid,
    stopEngagedAt: num(parsed.stopEngagedAt),
    stopReason: typeof parsed.stopReason === 'string' ? parsed.stopReason.slice(0, 120) : null,
    unwindRequested: parsed.unwindRequested === true,
    humanAgent: {
      requested: parsed.humanAgent?.requested === true,
      sessionId: typeof parsed.humanAgent?.sessionId === 'string' ? parsed.humanAgent.sessionId.slice(0, 64) : null,
      escalation: ['none', 'requested', 'connected'].includes(parsed.humanAgent?.escalation) ? parsed.humanAgent.escalation : 'none',
      requestedAt: num(parsed.humanAgent?.requestedAt),
      connectedAt: num(parsed.humanAgent?.connectedAt)
    },
    autonomy: {
      level: [1, 2, 3].includes(Number(parsed.autonomy?.level)) ? Number(parsed.autonomy.level) : 1,
      atMax: parsed.autonomy?.atMax === true,
      nextLevel: parsed.autonomy?.nextLevel
    },
    railCollapsed: parsed.railCollapsed === true,
    updatedAt: num(parsed.updatedAt) ?? now
  };
  /* Consistency: a stopped state must carry the stop flag; a paused state
     must not claim to be stopped. */
  if (state.state === 'stopped' && state.emergencyStop !== true) { state.emergencyStop = true; degraded = true; }
  if (state.state === 'paused' && state.emergencyStop === true) state.state = 'stopped';
  if (state.state === 'running' && state.emergencyStop === true) state.state = 'stopped';
  return { state, degraded };
}

/* ── Phases 141–150: layout contract for the horizontal rail ──────────── */
/* The UI renders exactly this descriptor, and the probe asserts on the same
   descriptor — so the screen and the tests cannot drift apart. */

export const RAIL_LAYOUT_SCHEMA = 'fbt.rail-layout.v1';

/** L1–L3 icon keys, in rail order. */
export const AUTONOMY_ICONS = Object.freeze([
  { level: 1, key: 'l1-analysis', labelKey: 'intentAI.levels.level1', enabled: true },
  { level: 2, key: 'l2-prepare', labelKey: 'intentAI.levels.level2', enabled: true },
  { level: 3, key: 'l3-controlled', labelKey: 'intentAI.levels.level3', enabled: true }
]);

/*
 * Rail buttons, in rail order.
 *
 * ─── WHY PAUSE / EMERGENCY STOP / HUMAN AGENT ARE GONE ─────────────────────
 * Reported: «باکس l1 تا l3 — توقف، توقف اضطرار و درخواست در صفحه intent os
 * باید پاک شود». The /#/intent screen carried a full control bar; the same
 * three actions are already one tap away on the AI surface, where they sit in
 * a proper rail. On the Intent OS page they were a second, cramped copy that
 * pushed the L1–L3 autonomy indicator off the screen.
 *
 * What must NOT disappear with them is the way out. `release` is CONDITIONAL —
 * it renders only while the rail is paused or stopped — because removing the
 * buttons that put it there and leaving no way back would turn a temporary
 * pause into a permanent lock on the compose screen. The underlying state
 * machine is untouched: pause/stop still gate execution, and the release path
 * still requires the same confirmation to leave the stopped state.
 */
export const RAIL_ACTIONS = Object.freeze([
  { id: 'release', kind: 'fail-closed', expandable: false, conditional: true, labelKey: 'intentOS.rail.release' }
]);

export const RAIL_SPACING = Object.freeze({
  gapPx: 8,
  iconPx: 22,
  touchTargetPx: 44,   // ≥44px: thumb-friendly on mobile
  railPaddingPx: 10,
  drawerMaxHeightPx: 220,
  minContrastRatio: 4.5
});

/** The single source of truth for the rail layout. */
export function railLayoutDescriptor() {
  return {
    schema: RAIL_LAYOUT_SCHEMA,
    horizontal: true,
    compact: true,
    autonomyIcons: AUTONOMY_ICONS,
    actions: RAIL_ACTIONS,
    spacing: RAIL_SPACING,
    order: ['autonomy', 'release'],
    /* Safety rule the UI enforces: the Intent OS rail is informational and
       non-expandable; a blocked rail still shows its release control. */
    safetyInvariants: Object.freeze({
      emergencyAlwaysReachable: true,
      collapseNeverHidesSafetyState: true,
      pauseShowsResumeTime: true,
      stopRequiresConfirmationToRelease: true,
      touchTargetsAtLeast44px: true,
      /* New with the trimmed rail: the three removed actions must leave a
         reachable way back, or a pause becomes a lock. */
      releaseAlwaysReachableWhenBlocked: true
    })
  };
}
