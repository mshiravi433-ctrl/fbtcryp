/**
 * FBT WALLET ENGINE — RECURRING TRANSACTIONS
 * ---------------------------------------------------------------------------
 * The schedule math for DCA, periodic transfers, periodic payments and
 * periodic investments. This module answers "when is the next one due and is
 * it overdue?", and leaves the EXECUTION to the orchestrator (which is the
 * only place that can check capability, sign and broadcast).
 *
 * ─── HONESTY RULES ──────────────────────────────────────────────────────────
 * · This is a planner, not a signer. Nothing here can move value; producing a
 *   due schedule never means "sent" — the wallet state machine is still the
 *   only path to CONFIRMED.
 * · `nextDue` returns null when the schedule is finished or the interval is
 *   invalid, and `due` distinguishes "due now" from "due in the future" — a
 *   schedule with no `startAt` is `due:false` until it has one.
 */

export const RECURRING_SCHEMA = 'fbt.recurring.v1';

export const RECURRING_TYPES = Object.freeze(['DCA', 'TRANSFER', 'PAYMENT', 'INVEST']);

const INTERVAL_MS = {
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000
};

export function parseRecurring(input = {}) {
  const type = String(input.type || 'DCA').toUpperCase();
  const intervalMs = INTERVAL_MS[input.interval] ?? null;
  return {
    schema: RECURRING_SCHEMA,
    id: String(input.id || `rec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`),
    type: RECURRING_TYPES.includes(type) ? type : null,
    asset: input.asset ? String(input.asset).toUpperCase() : null,
    amount: Number.isFinite(Number(input.amount)) ? Number(input.amount) : null,
    interval: INTERVAL_MS[input.interval] ? input.interval : null,
    intervalMs,
    startAt: Number.isFinite(Number(input.startAt)) ? Number(input.startAt) : null,
    maxRuns: Number.isFinite(Number(input.maxRuns)) ? Number(input.maxRuns) : null,
    runs: Number.isFinite(Number(input.runs)) ? Number(input.runs) : 0,
    status: input.status || 'active'
  };
}

/**
 * Next due timestamp for a schedule.
 * Returns `{ due, at, overdue, runsRemaining }`; `at` is null when finished.
 */
export function nextDue(schedule, { now = Date.now() } = {}) {
  const s = schedule?.schema === RECURRING_SCHEMA ? schedule : parseRecurring(schedule);
  if (!s.intervalMs || !s.startAt) {
    return { due: false, at: null, overdue: false, runsRemaining: s.maxRuns != null ? s.maxRuns - s.runs : null, code: 'NOT_SCHEDULED' };
  }
  const runsRemaining = s.maxRuns != null ? s.maxRuns - s.runs : null;
  if (runsRemaining != null && runsRemaining <= 0) {
    return { due: false, at: null, overdue: false, runsRemaining: 0, code: 'FINISHED' };
  }
  const at = s.startAt + (s.runs + 1) * s.intervalMs;
  return {
    due: at <= now,
    at,
    overdue: at <= now,
    runsRemaining,
    code: 'SCHEDULED'
  };
}

/** All schedules due at or before `now`. */
export function dueNow(schedules = [], { now = Date.now() } = {}) {
  return (Array.isArray(schedules) ? schedules : [])
    .filter((s) => nextDue(s, { now }).due);
}
