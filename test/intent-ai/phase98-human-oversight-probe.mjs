/**
 * PHASE 98 — HUMAN OVERSIGHT CHARTER
 * A long-running plan carries a mandatory check-in. The whole phase lives in
 * the default: no answer means the plan stops, never that it quietly carries
 * on without the person who authorised it.
 */
import { readFileSync } from 'node:fs';
import {
  scheduleCheckIn, recordCheckInResponse, evaluateOversight, assertStopOnSilence,
  CHECKIN_INTERVAL_MS, CHECKIN_GRACE_MS, CHECKIN_RESPONSES, PROGRAM_KINDS,
  OVERSIGHT_STATES, OVERSIGHT_SCHEMA
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

try {
  /* ---------- scheduling ---------- */
  const schedule = scheduleCheckIn({ programId: 'dca-1', kind: 'dca', now: NOW });
  check('a DCA plan gets a check-in', schedule.ok === true && schedule.schema === OVERSIGHT_SCHEMA);
  check('the check-in has a date from the moment the plan starts', schedule.nextCheckInAt === NOW + CHECKIN_INTERVAL_MS);
  check('the check-in is mandatory', schedule.mandatory === true);
  check('the plan starts active', schedule.state === 'active' && OVERSIGHT_STATES.includes(schedule.state));
  check('nothing has been missed yet', schedule.missedCheckIns === 0);
  check('a grace window is defined', schedule.graceMs === CHECKIN_GRACE_MS);
  for (const kind of PROGRAM_KINDS) {
    check(`a ${kind} plan can be scheduled`, scheduleCheckIn({ programId: `p-${kind}`, kind, now: NOW }).ok === true);
  }
  check('an unknown plan kind is refused', scheduleCheckIn({ programId: 'x', kind: 'lottery', now: NOW }).ok === false);
  check('a plan with no id is refused', scheduleCheckIn({ kind: 'dca', now: NOW }).ok === false);
  check('a plan cannot lengthen its own leash',
    scheduleCheckIn({ programId: 'greedy', kind: 'dca', intervalMs: CHECKIN_INTERVAL_MS * 2, now: NOW }).ok === false);
  check('the over-long interval is a guardian rejection',
    scheduleCheckIn({ programId: 'greedy', kind: 'dca', intervalMs: CHECKIN_INTERVAL_MS * 2, now: NOW }).error.code === 'GUARDIAN_REJECTED');
  check('a plan may shorten its own leash',
    scheduleCheckIn({ programId: 'careful', kind: 'goal', intervalMs: DAY, now: NOW }).nextCheckInAt === NOW + DAY);
  check('a null interval is not read as zero', scheduleCheckIn({ programId: 'x', kind: 'dca', intervalMs: null, now: NOW }).ok === false);
  check('an empty-string interval is not read as zero', scheduleCheckIn({ programId: 'x', kind: 'dca', intervalMs: '', now: NOW }).ok === false);
  check('a boolean interval is not read as one', scheduleCheckIn({ programId: 'x', kind: 'dca', intervalMs: true, now: NOW }).ok === false);
  check('a zero interval is refused', scheduleCheckIn({ programId: 'x', kind: 'dca', intervalMs: 0, now: NOW }).ok === false);

  /* ---------- the state machine ---------- */
  const active = evaluateOversight({ schedule, now: NOW + DAY });
  check('a plan inside its window may run', active.mayRun === true && active.state === 'active');
  check('the user can see when the next check-in is', active.msUntilCheckIn > 0);
  const due = evaluateOversight({ schedule, now: NOW + CHECKIN_INTERVAL_MS + 1000 });
  check('a due check-in still runs during the grace window', due.mayRun === true && due.state === 'grace');
  check('the grace window asks for an answer', due.requiresHumanAnswer === true);
  check('the grace window has an end', due.graceEndsAt === NOW + CHECKIN_INTERVAL_MS + CHECKIN_GRACE_MS);
  const silent = evaluateOversight({ schedule, now: NOW + CHECKIN_INTERVAL_MS + CHECKIN_GRACE_MS + 1 });
  check('silence past the grace window stops the plan', silent.mayRun === false);
  check('the stop is automatic, not a request', silent.autoPaused === true && silent.state === 'paused');
  check('the missed check-in is recorded', silent.missedCheckIn === true);
  check('the stop is a translatable notice, not a crash', silent.i18nKey === 'intentAI.oversight.autoPaused');
  check('the stopped plan still asks for a human answer', silent.requiresHumanAnswer === true);
  check('a plan with no check-in date never runs',
    evaluateOversight({ schedule: { ...schedule, nextCheckInAt: null }, now: NOW }).mayRun === false);
  check('an empty-string check-in date is not read as the epoch',
    evaluateOversight({ schedule: { ...schedule, nextCheckInAt: '' }, now: NOW }).mayRun === false);
  check('a dateless plan is a guardian rejection',
    evaluateOversight({ schedule: { ...schedule, nextCheckInAt: null }, now: NOW }).error.code === 'GUARDIAN_REJECTED');
  check('no schedule at all means no running', evaluateOversight({ now: NOW }).mayRun === false);

  /* ---------- answering ---------- */
  const continued = recordCheckInResponse({ schedule, response: 'continue', userConfirmed: true, respondedAt: NOW + CHECKIN_INTERVAL_MS, now: NOW + CHECKIN_INTERVAL_MS });
  check('a confirmed continue resumes the plan', continued.ok === true && continued.resumed === true);
  check('continuing schedules the NEXT check-in', continued.schedule.nextCheckInAt === NOW + CHECKIN_INTERVAL_MS + schedule.intervalMs);
  check('continuing clears the missed counter', continued.schedule.missedCheckIns === 0);
  check('the continued plan may run again', evaluateOversight({ schedule: continued.schedule, now: NOW + CHECKIN_INTERVAL_MS + 10 }).mayRun === true);
  const paused = recordCheckInResponse({ schedule, response: 'pause', userConfirmed: true, respondedAt: NOW, now: NOW });
  check('a pause answer pauses the plan', paused.schedule.state === 'paused' && paused.resumed === false);
  check('a paused plan does not run', evaluateOversight({ schedule: paused.schedule, now: NOW + 10 }).mayRun === false);
  const ended = recordCheckInResponse({ schedule, response: 'stop', userConfirmed: true, respondedAt: NOW, now: NOW });
  check('a stop answer ends the plan', ended.schedule.state === 'ended');
  check('an ended plan has no next check-in', ended.schedule.nextCheckInAt === null);
  check('an ended plan never runs again', evaluateOversight({ schedule: ended.schedule, now: NOW + 10 * DAY }).mayRun === false);
  check('an unconfirmed answer is silence with extra steps',
    recordCheckInResponse({ schedule, response: 'continue', userConfirmed: false, respondedAt: NOW, now: NOW }).ok === false);
  check('the unconfirmed answer is an authorization failure',
    recordCheckInResponse({ schedule, response: 'continue', respondedAt: NOW, now: NOW }).error.code === 'USER_AUTHORIZATION_REQUIRED');
  check('a "later" answer is not one of the accepted answers', CHECKIN_RESPONSES.includes('later') === false);
  check('an invented answer is refused',
    recordCheckInResponse({ schedule, response: 'later', userConfirmed: true, respondedAt: NOW, now: NOW }).ok === false);
  check('an answer with no schedule is refused',
    recordCheckInResponse({ response: 'continue', userConfirmed: true, respondedAt: NOW, now: NOW }).ok === false);
  check('the three accepted answers are continue, pause and stop',
    CHECKIN_RESPONSES.join(',') === 'continue,pause,stop');

  /* ---------- the guard ---------- */
  check('an honest oversight round passes the guard',
    assertStopOnSilence({ schedule, evaluation: active, runs: [{ executed: true, oversightState: 'active', checkInAnswered: true }] }).ok === true);
  check('optional oversight is caught',
    assertStopOnSilence({ schedule: { ...schedule, mandatory: false } }).reasons.includes('OVERSIGHT_OPTIONAL'));
  check('a plan with no check-in is caught',
    assertStopOnSilence({ schedule: { ...schedule, nextCheckInAt: null } }).reasons.includes('PROGRAM_WITHOUT_CHECKIN'));
  check('an over-long interval is caught',
    assertStopOnSilence({ schedule: { ...schedule, intervalMs: CHECKIN_INTERVAL_MS * 3 } }).reasons.includes('CHECKIN_INTERVAL_TOO_LONG'));
  check('a paused plan that still runs is caught',
    assertStopOnSilence({ evaluation: { state: 'paused', mayRun: true } }).reasons.includes('PAUSED_BUT_RUNNING'));
  check('an ended plan that still runs is caught',
    assertStopOnSilence({ evaluation: { state: 'ended', mayRun: true } }).reasons.includes('ENDED_BUT_RUNNING'));
  check('a missed check-in that still runs is caught',
    assertStopOnSilence({ evaluation: { missedCheckIn: true, mayRun: true } }).reasons.includes('MISSED_CHECKIN_STILL_RUNNING'));
  check('an execution while paused is caught',
    assertStopOnSilence({ runs: [{ executed: true, oversightState: 'paused' }] }).reasons.includes('EXECUTED_WHILE_PAUSED'));
  check('an execution after the plan ended is caught',
    assertStopOnSilence({ runs: [{ executed: true, oversightState: 'ended' }] }).reasons.includes('EXECUTED_AFTER_END'));
  check('an execution with no answer is caught',
    assertStopOnSilence({ runs: [{ executed: true, oversightState: 'grace', checkInAnswered: false }] }).reasons.includes('EXECUTED_WITHOUT_ANSWER'));
  check('an ended plan without a next date is NOT flagged',
    assertStopOnSilence({ schedule: ended.schedule }).ok === true);
  check('the guard rejection is a guardian rejection',
    assertStopOnSilence({ evaluation: { state: 'paused', mayRun: true } }).error.code === 'GUARDIAN_REJECTED');

  /* ---------- copy ---------- */
  const locales = ['en', 'fa', 'ar'].map((l) => JSON.parse(readFileSync(`src/i18n/locales/${l}.json`, 'utf8')));
  check('the oversight copy is translated in en, fa and ar',
    locales.every((loc) => ['scheduled', 'due', 'autoPaused', 'continued', 'ended', 'pausedNeedsAnswer', 'noDate']
      .every((k) => typeof loc?.intentAI?.oversight?.[k] === 'string')));
  check('the english copy says silence stops the plan',
    /stopped by itself/i.test(locales[0].intentAI.oversight.autoPaused));
  check('the english copy asks for an answer rather than assuming one',
    /please answer/i.test(locales[0].intentAI.oversight.due));

  console.log(JSON.stringify({ probe: 'phase98-human-oversight', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}

export default results;
