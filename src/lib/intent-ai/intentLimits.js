/**
 * FBT INTENT AI — USER-FACING FINANCIAL & TIME LIMITS
 * ---------------------------------------------------------------------------
 * Hard, friendly-enforced caps on what a user may ask for in one intent:
 *
 *   · total input amount        — the USD capital the user wants to deploy
 *   · per-transaction amount    — the size of a single executed transaction
 *   · goal / target profit      — maximum target percentage
 *   · goal duration             — maximum runtime of a timed goal
 *
 * These limits are enforced at every layer where a number can enter the
 * system: the intent parser, the guided chat flow, the interactive
 * confirmation screen and the policy caps (DEFAULT_POLICY_CAPS). Exceeding a
 * limit never throws and never silently clamps a user's money: the system
 * answers with a friendly warning that names the exact ceiling so the user
 * can restate the request within the allowed range (i18n keys:
 * `intentAI.limits.*`).
 */

/** Hard product limits — a single source of truth for parser, flow and UI. */
export const INTENT_LIMITS = Object.freeze({
  maxTotalInputUsd: 400_000,
  maxPerTransactionUsd: 5_000,
  maxGoalPct: 60,
  maxGoalDurationDays: 30
});

/** Maximum goal duration expressed in hours (30 days). */
export const MAX_GOAL_DURATION_HRS = INTENT_LIMITS.maxGoalDurationDays * 24;

const STABLE_UNITS = new Set(['USD', 'USDT', 'USDC', 'DAI', 'BUSD', 'FDUSD', 'TUSD', 'USDP', 'USDD']);

/** Kinds whose amount is executed as one on-chain transaction. */
const TRANSACTION_KINDS = new Set(['swap', 'bridge', 'send']);

/**
 * Best-effort USD value of an intent's input amount. Only USD-denominated or
 * stablecoin-denominated amounts can be judged against the USD limits without
 * a price feed; token amounts are left to the policy/Guardian stage where a
 * quoted USD value exists.
 */
export function usdValueOf(intent = {}) {
  const explicit = Number(intent.amountUsd);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const amount = Number(intent.amount);
  const unit = String(intent.amountUnit || '').toUpperCase();
  if (Number.isFinite(amount) && amount > 0 && (unit === 'USD' || STABLE_UNITS.has(unit))) return amount;
  return null;
}

/**
 * Validate an intent-shaped object against the product limits.
 *
 * @returns {Array<{code: string, field: string, value: number, limit: number, unit: string}>}
 *   Empty array when everything is within the allowed ceilings.
 */
export function checkIntentLimits(intent = {}) {
  const violations = [];
  const kind = String(intent.kind || intent.action || '');
  const total = usdValueOf(intent);
  if (total != null && total > INTENT_LIMITS.maxTotalInputUsd) {
    violations.push({
      code: 'TOTAL_INPUT_OVER_LIMIT',
      field: 'amountUsd',
      value: total,
      limit: INTENT_LIMITS.maxTotalInputUsd,
      unit: 'USD'
    });
  }
  if (total != null && TRANSACTION_KINDS.has(kind) && total > INTENT_LIMITS.maxPerTransactionUsd) {
    violations.push({
      code: 'PER_TX_OVER_LIMIT',
      field: 'amountUsd',
      value: total,
      limit: INTENT_LIMITS.maxPerTransactionUsd,
      unit: 'USD'
    });
  }
  const goalPct = Number(intent.goalPct);
  if (Number.isFinite(goalPct) && goalPct > INTENT_LIMITS.maxGoalPct) {
    violations.push({
      code: 'GOAL_PCT_OVER_LIMIT',
      field: 'goalPct',
      value: goalPct,
      limit: INTENT_LIMITS.maxGoalPct,
      unit: '%'
    });
  }
  const durationHrs = Number(intent.durationHrs);
  if (Number.isFinite(durationHrs) && durationHrs > MAX_GOAL_DURATION_HRS) {
    violations.push({
      code: 'GOAL_DURATION_OVER_LIMIT',
      field: 'durationHrs',
      value: durationHrs,
      limit: MAX_GOAL_DURATION_HRS,
      unit: 'h'
    });
  }
  return violations;
}

/** Limit hint for a UI field: { limit, unit } for the "max allowed" caption. */
export function limitHintFor(field) {
  switch (field) {
    case 'amountUsd':
    case 'amount':
      return { limit: INTENT_LIMITS.maxTotalInputUsd, unit: 'USD' };
    case 'perTransactionUsd':
      return { limit: INTENT_LIMITS.maxPerTransactionUsd, unit: 'USD' };
    case 'goalPct':
      return { limit: INTENT_LIMITS.maxGoalPct, unit: '%' };
    case 'durationHrs':
      return { limit: MAX_GOAL_DURATION_HRS, unit: 'h' };
    default:
      return null;
  }
}
