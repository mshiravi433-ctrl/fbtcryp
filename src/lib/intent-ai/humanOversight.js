/**
 * FBT INTENT AI — PHASE 98: HUMAN OVERSIGHT CHARTER
 * ---------------------------------------------------------------------------
 * Autonomy is not the absence of supervision. A DCA plan or a long-running
 * goal is exactly the kind of thing that keeps working long after the person
 * who authorised it stopped paying attention — so a long programme carries a
 * mandatory check-in, and silence stops it.
 *
 *   · every long-running programme has a next check-in date from the moment it
 *     starts; a programme without one cannot run
 *   · a missed check-in gives a grace window, then PAUSES the programme; the
 *     default on silence is stop, never continue
 *   · resuming needs an explicit, timestamped human answer — the same shape of
 *     confirmation as any other authorisation
 *   · a programme cannot extend its own check-in, and answering "later"
 *     without a decision is silence, not consent
 */

import { classifyFailure } from './failureModes.js';

export const OVERSIGHT_SCHEMA = 'fbt.human-oversight.v1';
export const OVERSIGHT_STATES = Object.freeze(['active', 'due', 'grace', 'paused', 'ended']);
export const PROGRAM_KINDS = Object.freeze(['dca', 'goal', 'recurring', 'automation']);
export const CHECKIN_INTERVAL_MS = 14 * 24 * 60 * 60 * 1000;
export const CHECKIN_GRACE_MS = 48 * 60 * 60 * 1000;
export const CHECKIN_RESPONSES = Object.freeze(['continue', 'pause', 'stop']);

const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean'
  ? null
  : (Number.isFinite(Number(v)) ? Number(v) : null));

const id = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 64) : null);

/** Attach the mandatory check-in to a long-running programme. */
export function scheduleCheckIn({
  programId = null,
  kind = 'dca',
  intervalMs = CHECKIN_INTERVAL_MS,
  startedAt = null,
  now = Date.now()
} = {}) {
  const pid = id(programId);
  if (!pid) {
    return { ok: false, scheduled: false, i18nKey: 'intentAI.oversight.notScheduled', error: classifyFailure('MISSING_DATA', { detail: 'NO_PROGRAM' }) };
  }
  if (!PROGRAM_KINDS.includes(kind)) {
    return { ok: false, scheduled: false, i18nKey: 'intentAI.oversight.notScheduled', error: classifyFailure('MISSING_DATA', { detail: 'UNKNOWN_KIND' }) };
  }
  const interval = num(intervalMs);
  if (interval === null || interval <= 0 || interval > CHECKIN_INTERVAL_MS) {
    // A programme may shorten its own leash, never lengthen it.
    return { ok: false, scheduled: false, i18nKey: 'intentAI.oversight.intervalRefused', error: classifyFailure('GUARDIAN_REJECTED', { detail: 'INTERVAL_TOO_LONG' }) };
  }
  const start = num(startedAt) ?? now;
  return {
    ok: true,
    schema: OVERSIGHT_SCHEMA,
    programId: pid,
    kind,
    intervalMs: interval,
    startedAt: start,
    nextCheckInAt: start + interval,
    graceMs: CHECKIN_GRACE_MS,
    state: 'active',
    // Supervision is not optional and the programme cannot turn it off.
    mandatory: true,
    missedCheckIns: 0,
    i18nKey: 'intentAI.oversight.scheduled',
    i18nParams: { days: Math.round(interval / 86_400_000) }
  };
}

/** Record a human answer. "Later" is not an answer. */
export function recordCheckInResponse({ schedule = null, response = null, respondedAt = null, userConfirmed = false, now = Date.now() } = {}) {
  if (!schedule?.programId) {
    return { ok: false, i18nKey: 'intentAI.oversight.notScheduled', error: classifyFailure('MISSING_DATA', { detail: 'NO_SCHEDULE' }) };
  }
  if (!CHECKIN_RESPONSES.includes(response)) {
    return { ok: false, schedule, i18nKey: 'intentAI.oversight.answerRefused', error: classifyFailure('MISSING_DATA', { detail: 'BAD_RESPONSE' }) };
  }
  const at = num(respondedAt) ?? (userConfirmed === true ? now : null);
  if (userConfirmed !== true || at === null) {
    // An unconfirmed or untimestamped answer is silence with extra steps.
    return {
      ok: false, schedule,
      i18nKey: 'intentAI.oversight.answerRefused',
      error: classifyFailure('USER_AUTHORIZATION_REQUIRED', { detail: 'ANSWER_NOT_CONFIRMED' })
    };
  }
  if (response === 'stop') {
    return {
      ok: true,
      schema: OVERSIGHT_SCHEMA,
      schedule: { ...schedule, state: 'ended', endedAt: at, nextCheckInAt: null },
      resumed: false,
      i18nKey: 'intentAI.oversight.ended'
    };
  }
  if (response === 'pause') {
    return {
      ok: true,
      schema: OVERSIGHT_SCHEMA,
      schedule: { ...schedule, state: 'paused', pausedAt: at },
      resumed: false,
      i18nKey: 'intentAI.oversight.paused'
    };
  }
  return {
    ok: true,
    schema: OVERSIGHT_SCHEMA,
    schedule: {
      ...schedule,
      state: 'active',
      lastCheckInAt: at,
      nextCheckInAt: at + num(schedule.intervalMs),
      missedCheckIns: 0
    },
    resumed: true,
    i18nKey: 'intentAI.oversight.continued',
    at: now
  };
}

/**
 * Where does this programme stand right now? The whole phase is in the
 * default: no answer means the programme stops running.
 */
export function evaluateOversight({ schedule = null, now = Date.now() } = {}) {
  if (!schedule?.programId) {
    return { ok: false, mayRun: false, state: 'paused', i18nKey: 'intentAI.oversight.notScheduled', error: classifyFailure('MISSING_DATA', { detail: 'NO_SCHEDULE' }) };
  }
  if (schedule.state === 'ended') {
    return { ok: true, mayRun: false, state: 'ended', programId: schedule.programId, i18nKey: 'intentAI.oversight.ended' };
  }
  if (schedule.state === 'paused') {
    return { ok: true, mayRun: false, state: 'paused', programId: schedule.programId, requiresHumanAnswer: true, i18nKey: 'intentAI.oversight.pausedNeedsAnswer' };
  }
  const due = num(schedule.nextCheckInAt);
  if (due === null) {
    // No date means no supervision. That programme does not run.
    return { ok: false, mayRun: false, state: 'paused', programId: schedule.programId, i18nKey: 'intentAI.oversight.noDate', error: classifyFailure('GUARDIAN_REJECTED', { detail: 'NO_CHECKIN_DATE' }) };
  }
  const grace = num(schedule.graceMs) ?? CHECKIN_GRACE_MS;
  if (now <= due) {
    return {
      ok: true, mayRun: true, state: 'active', programId: schedule.programId,
      nextCheckInAt: due, msUntilCheckIn: due - now,
      i18nKey: 'intentAI.oversight.active'
    };
  }
  if (now <= due + grace) {
    return {
      ok: true, mayRun: true, state: 'grace', programId: schedule.programId,
      nextCheckInAt: due, requiresHumanAnswer: true, graceEndsAt: due + grace,
      i18nKey: 'intentAI.oversight.due'
    };
  }
  return {
    ok: true,
    mayRun: false,
    // Silence stops the programme. It does not extend it.
    state: 'paused',
    programId: schedule.programId,
    autoPaused: true,
    missedCheckIn: true,
    requiresHumanAnswer: true,
    i18nKey: 'intentAI.oversight.autoPaused',
    at: now
  };
}

/** Silence must never read as consent, anywhere in the chain. */
export function assertStopOnSilence({ schedule = null, evaluation = null, runs = [] } = {}) {
  const reasons = [];
  if (schedule) {
    if (schedule.mandatory !== true) reasons.push('OVERSIGHT_OPTIONAL');
    if (schedule.state !== 'ended' && num(schedule.nextCheckInAt) === null) reasons.push('PROGRAM_WITHOUT_CHECKIN');
    if (num(schedule.intervalMs) !== null && num(schedule.intervalMs) > CHECKIN_INTERVAL_MS) reasons.push('CHECKIN_INTERVAL_TOO_LONG');
  }
  if (evaluation) {
    if (evaluation.state === 'paused' && evaluation.mayRun === true) reasons.push('PAUSED_BUT_RUNNING');
    if (evaluation.state === 'ended' && evaluation.mayRun === true) reasons.push('ENDED_BUT_RUNNING');
    if (evaluation.missedCheckIn === true && evaluation.mayRun === true) reasons.push('MISSED_CHECKIN_STILL_RUNNING');
  }
  for (const run of Array.isArray(runs) ? runs : []) {
    if (run?.executed === true && run?.oversightState === 'paused') reasons.push('EXECUTED_WHILE_PAUSED');
    if (run?.executed === true && run?.oversightState === 'ended') reasons.push('EXECUTED_AFTER_END');
    if (run?.executed === true && run?.checkInAnswered === false && run?.oversightState !== 'active') reasons.push('EXECUTED_WITHOUT_ANSWER');
  }
  const unique = [...new Set(reasons)];
  return unique.length
    ? { ok: false, reasons: unique, error: classifyFailure('GUARDIAN_REJECTED', { detail: unique[0] }) }
    : { ok: true };
}
