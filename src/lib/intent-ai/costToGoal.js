/**
 * FBT INTENT AI — Spec 65 items 30–31: Cost-to-Goal Engine and Net Outcome
 * Predictor.
 *
 * All cost classes that apply to a goal are accounted: swap, gas, bridge,
 * funding, spread, slippage, performance and external agent fees. A cost that
 * is unknown or unevidenced is `unavailable`, never zero, so a goal can never
 * look cheaper than reality. The net outcome is Gross − All Costs; it is an
 * arithmetic expectation label, never a profit promise.
 */

import { containsRawSecret, fail, finite, noExecutionPermission } from './phaseBoundary.js';

export const COST_TO_GOAL_SCHEMA = 'fbt.intent-cost-to-goal.v1';
export const NET_OUTCOME_SCHEMA = 'fbt.intent-net-outcome.v1';

export const COST_CLASSES = Object.freeze([
  'swap',
  'gas',
  'bridge',
  'funding',
  'spread',
  'slippage',
  'performance',
  'externalAgent'
]);

const COST_LABELS = Object.freeze({
  swap: 'Swap fee',
  gas: 'Gas cost',
  bridge: 'Bridge cost',
  funding: 'Funding cost',
  spread: 'Spread cost',
  slippage: 'Slippage cost',
  performance: 'Performance fee',
  externalAgent: 'External agent fee'
});

function costRow(costs, costClass, evidence = {}) {
  const raw = finite(costs?.[costClass]);
  const source = typeof evidence?.[costClass]?.source === 'string' ? evidence[costClass].source.slice(0, 80) : null;
  const observedAt = finite(evidence?.[costClass]?.observedAt);
  if (raw === null || raw < 0) {
    return { costClass, label: COST_LABELS[costClass], valueUsd: null, status: 'unavailable', source, observedAt };
  }
  return { costClass, label: COST_LABELS[costClass], valueUsd: raw, status: 'evidenced', source, observedAt };
}

/**
 * Compute the full cost stack between the current position and the goal.
 * Unknown costs keep the whole report `partial` (or `unavailable` when nothing
 * is evidenced); they are never treated as zero.
 */
export function computeCostToGoal({
  targetUsd = null,
  capitalUsd = null,
  costs = {},
  costEvidence = {},
  now = Date.now()
} = {}) {
  if (containsRawSecret(costs) || containsRawSecret(costEvidence)) return fail('RAW_CREDENTIAL_FORBIDDEN');
  const target = finite(targetUsd);
  const capital = finite(capitalUsd);
  if (target === null || target <= 0) return fail('TARGET_REQUIRED');
  if (capital === null || capital <= 0) return fail('CAPITAL_REQUIRED');

  const rows = COST_CLASSES.map((costClass) => costRow(costs, costClass, costEvidence));
  const known = rows.filter((row) => row.status === 'evidenced');
  const unknown = rows.filter((row) => row.status !== 'evidenced');
  const totalKnownCostUsd = Math.round(known.reduce((sum, row) => sum + row.valueUsd, 0) * 1e6) / 1e6;
  const grossGainUsd = target - capital;
  // Unknown costs are NOT zeros: the net remainder can only be stated for the
  // evidenced subset and is explicitly flagged as a lower bound.
  const netRemainderIfKnownOnly = grossGainUsd - totalKnownCostUsd;

  return noExecutionPermission({
    ok: true,
    schema: COST_TO_GOAL_SCHEMA,
    capitalUsd: capital,
    targetUsd: target,
    grossGainUsd: Math.round(grossGainUsd * 1e6) / 1e6,
    costs: rows,
    knownCostCount: known.length,
    unknownCostCount: unknown.length,
    unknownCostClasses: unknown.map((row) => row.costClass),
    totalKnownCostUsd,
    netRemainderUsd: Math.round(netRemainderIfKnownOnly * 1e6) / 1e6,
    netIsLowerBound: unknown.length > 0,
    status: known.length === 0 ? 'unavailable' : unknown.length > 0 ? 'partial' : 'complete',
    note: unknown.length > 0
      ? 'Unknown costs are marked unavailable, not zero; the net remainder is a lower bound until every cost class is evidenced.'
      : 'All cost classes are evidenced; the net remainder remains an estimate, not a promise.',
    guaranteed: false,
    computedAt: now
  });
}

/**
 * Net Outcome Predictor: Expected Net = Gross − All Costs. Only evidenced,
 * non-negative cost values enter the sum. Missing cost data blocks the
 * "complete" status instead of flattering the result.
 */
export function predictNetOutcome({ grossOutputUsd = null, costs = {}, costEvidence = {}, now = Date.now() } = {}) {
  if (containsRawSecret(costs) || containsRawSecret(costEvidence)) return fail('RAW_CREDENTIAL_FORBIDDEN');
  const gross = finite(grossOutputUsd);
  if (gross === null || gross < 0) return fail('GROSS_OUTPUT_REQUIRED');
  const rows = COST_CLASSES.map((costClass) => costRow(costs, costClass, costEvidence));
  const known = rows.filter((row) => row.status === 'evidenced');
  const unknownClasses = rows.filter((row) => row.status !== 'evidenced').map((row) => row.costClass);
  const totalCostUsd = known.reduce((sum, row) => sum + row.valueUsd, 0);
  const expectedNetUsd = Math.round((gross - totalCostUsd) * 1e6) / 1e6;
  return noExecutionPermission({
    ok: true,
    schema: NET_OUTCOME_SCHEMA,
    grossOutputUsd: gross,
    totalKnownCostUsd: Math.round(totalCostUsd * 1e6) / 1e6,
    unknownCostClasses: unknownClasses,
    expectedNetUsd,
    netIsLowerBound: unknownClasses.length > 0,
    status: unknownClasses.length === 0 ? 'complete' : 'partial',
    profitPromised: false,
    disclaimers: [
      'NOT_GUARANTEED',
      'SLIPPAGE_AND_TIMEOUT_ARE_REAL_COSTS',
      unknownClasses.length ? 'UNKNOWN_COSTS_ARE_NOT_ZERO' : 'MARKET_CONDITIONS_CHANGE'
    ],
    computedAt: now
  });
}
