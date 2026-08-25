/**
 * GOAL MATHEMATICS — the pure-logic engine behind the Wealth Hub's Goal Progress
 * ----------------------------------------------------------------------------
 * A Goal is a target fiat value (USD) the user wants to reach by a deadline,
 * measured against the real portfolio total this app can read. The engine here
 * answers two questions and nothing more:
 *
 *   1.  How far along is the user RIGHT NOW? (Goal progress %)
 *   2.  Given the existing balance, the deadline, and a yield assumption,
 *       what monthly contribution reaches the target?
 *
 * ─── METHOD (mactobat, derived, pure) ──────────────────────────────────────
 * Standard future-value of a present sum + recurring payment:
 *
 *     FV = PV * (1 + r)^n + PMT * (((1 + r)^n - 1) / r)
 *
 * solved for PMT (monthly contribution):
 *
 *     PMT = (FV - PV * (1 + r)^n) / (((1 + r)^n - 1) / r)
 *
 * with r = monthly rate (annualYield / 12), n = months remaining (rounded
 * DOWN to a whole month, because paying in fractional months is nonsense).
 *
 * Boundaries the math respects:
 *
 *   • 0 ≤ progress ≤ 1. Clamping matters: a > 100% portfolio is possible when
 *     spot prices moved but the goal was set later; clamping a > 1 to 1 is a
 *     HUD choice — the underlying values are NOT lied about. The function
 *     returns both `progress` (clamped, for the UI bar) and `unclamped`
 *     (the raw ratio, for diagnostics).
 *
 *   • 0 ≤ annualYield ≤ 1. A 100% APR cap protects the math from an
 *     implausibly typed "yield" — a user typing 500% in a field should not
 *     produce a negative number of months. The cap is high enough that no
 *     realistic real-world APY on a curated venue trips it.
 *
 *   • 0 < monthsRemaining. A goal whose deadline has already passed returns
 *     null from `requiredMonthlyContribution`, because no finite payment
 *     reaches a goal already missed. The UI then shows "missed" honestly.
 *
 *   • NaN/Infinity in any input returns null. A 0/0 is not 0 PMT, it is no
 *     answer; the caller decides what to show.
 *
 * What this module does NOT do (intentional, and recorded in tests):
 *   • no yield projection for the user (the user is asked for, or the engine
 *     is fed, the annualYield from existing positions in a future call);
 *   • no selection of investment venue;
 *   • no signing or quoting — the only output is a number.
 */

/** Cap the user-supplied annual yield at 100% APR. Above this the math is
 *  implausible for any curated venue and we refuse to compute. */
const MAX_ANNUAL_YIELD = 1.0;

/** The number of full months between two timestamps, rounded DOWN. A 0-month
 *  result means the deadline is already in the past at the resolution the
 *  math uses. */
export function monthsBetween(fromMs, toMs, now = Date.now()) {
  const a = Number(fromMs);
  const b = Number(toMs);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  // Floor to month boundary, then count whole months. Calendar months, not
  // 30-day approximations, because the deadline is a calendar date.
  const dA = new Date(a);
  const dB = new Date(b);
  const years = dB.getFullYear() - dA.getFullYear();
  const months = dB.getMonth() - dA.getMonth();
  const total = years * 12 + months;
  // If the day-of-month has not been reached yet, the last month is partial.
  // The contribution is required MONTHLY, so partial final months do not
  // add a whole payment.
  if (dB.getDate() < dA.getDate()) return Math.max(0, total - 1);
  return Math.max(0, total);
}

/**
 * @param {object} args
 * @param {number} args.targetUsd        The fiat value the user wants to reach.
 * @param {number} args.currentUsd       The current portfolio total in fiat.
 *                                       Negative or NaN → progress 0.
 * @param {number} [args.now=Date.now()]  Reference time (ms). Exposed for tests.
 * @returns {{
 *   progress: number,         // clamped 0..1, for the bar
 *   unclamped: number,        // raw ratio, may exceed 1
 *   remainingUsd: number,     // target - current (>= 0 if not yet reached)
 *   reached: boolean,         // true when currentUsd >= targetUsd
 *   missing: boolean          // true when currentUsd or targetUsd is not usable
 * }}
 */
export function goalProgress({ targetUsd, currentUsd, now = Date.now() } = {}) {
  const t = Number(targetUsd);
  const c = Number(currentUsd);
  if (!Number.isFinite(t) || t <= 0 || !Number.isFinite(c) || c < 0) {
    return { progress: 0, unclamped: 0, remainingUsd: 0, reached: false, missing: true };
  }
  const raw = c / t;
  const clamped = raw < 0 ? 0 : raw > 1 ? 1 : raw;
  return {
    progress: clamped,
    unclamped: raw,
    remainingUsd: Math.max(0, t - c),
    reached: c >= t,
    missing: false
  };
}

/**
 * Required monthly contribution (in USD) to reach the target, starting from
 * the current balance and growing at the given annual yield. Returns null
 * when no finite contribution works.
 *
 * @param {object} args
 * @param {number} args.targetUsd       Goal value in fiat.
 * @param {number} args.currentUsd      Starting balance in fiat.
 * @param {number} args.deadlineMs      Deadline as a unix-ms timestamp.
 * @param {number} [args.annualYield=0] Annual yield, 0..1. 0 = no growth.
 * @param {number} [args.now=Date.now]   Reference time (ms). Exposed for tests.
 * @returns {number | null} PMT in USD, or null if not reachable / inputs bad.
 */
export function requiredMonthlyContribution({
  targetUsd,
  currentUsd,
  deadlineMs,
  annualYield = 0,
  now = Date.now()
} = {}) {
  const t = Number(targetUsd);
  const c = Number(currentUsd);
  const y = Number(annualYield);
  if (!Number.isFinite(t) || t <= 0) return null;
  if (!Number.isFinite(c) || c < 0) return null;
  if (!Number.isFinite(y) || y < 0 || y > MAX_ANNUAL_YIELD) return null;
  const months = monthsBetween(now, deadlineMs);
  if (months <= 0) {
    // Deadline already past (or this month): no schedule of monthly
    // contributions reaches the target. The caller can still inspect
    // `goalProgress` to see whether the existing balance alone hit it.
    return null;
  }

  // No growth: simple linear division, because (1+r)^n = 1 and the PMT
  // formula collapses to (target - current) / months. A goal whose PV
  // already meets the target returns 0, not a negative number — we never
  // tell the user to withdraw from an over-funded goal.
  if (y === 0) {
    const pmt = (t - c) / months;
    return pmt > 0 ? pmt : 0;
  }

  const r = y / 12;
  const growth = Math.pow(1 + r, months);
  const numerator = t - c * growth;
  const denominator = (growth - 1) / r;
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return null;
  }
  return numerator / denominator;
}

/**
 * Projected value at the deadline given the existing balance, a recurring
 * monthly contribution, and an annual yield. Companion to
 * requiredMonthlyContribution — same formula, no solving.
 *
 * @param {object} args
 * @param {number} args.currentUsd
 * @param {number} args.monthlyUsd
 * @param {number} args.deadlineMs
 * @param {number} [args.annualYield=0]
 * @param {number} [args.now=Date.now]
 * @returns {number | null} Projected future value in USD, or null on bad input.
 */
export function projectGoalValue({
  currentUsd,
  monthlyUsd,
  deadlineMs,
  annualYield = 0,
  now = Date.now()
} = {}) {
  const c = Number(currentUsd);
  const p = Number(monthlyUsd);
  const y = Number(annualYield);
  if (!Number.isFinite(c) || c < 0) return null;
  if (!Number.isFinite(p) || p < 0) return null;
  if (!Number.isFinite(y) || y < 0 || y > MAX_ANNUAL_YIELD) return null;
  const months = monthsBetween(now, deadlineMs);
  if (months <= 0) return c;
  if (y === 0) return c + p * months;
  const r = y / 12;
  const growth = Math.pow(1 + r, months);
  return c * growth + p * ((growth - 1) / r);
}

/** Maximum annual yield this engine will accept. Exposed so the UI can cap
 *  the input, not just rely on the runtime guard. */
export const GOAL_MAX_ANNUAL_YIELD = MAX_ANNUAL_YIELD;
