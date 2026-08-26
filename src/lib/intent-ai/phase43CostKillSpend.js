/** Phase 43 — cost / kill-spend. A budget spreadsheet is not a kill switch. */
import { fail, finite, unavailable } from './phaseBoundary.js';
import { opsPlane } from './opsPlane.js';

export const PHASE43_SCHEMA = 'fbt.cost-kill-spend.v1';

export function operateCostKillSpend({ budget = null, spent = null, kill = null } = {}) {
  if (finite(budget?.capUsd) === null) return unavailable('SPEND_CAP_UNDEFINED', null, { schema: PHASE43_SCHEMA });
  if (finite(spent?.usd) !== null && spent.usd > budget.capUsd && kill?.engaged !== true) {
    return fail('SPEND_CAP_BREACHED_WITHOUT_KILL');
  }
  if (kill?.bypassable === true) return fail('KILL_SPEND_MUST_NOT_BYPASS');
  return { ok: true, schema: PHASE43_SCHEMA, operational: false, executionActivated: false };
}

export function evaluateCostKillSpendPlane(input = {}) {
  const row = operateCostKillSpend(input);
  return opsPlane(43, PHASE43_SCHEMA, [row.code || 'COST_CONTROLS_NOT_OPERATIONAL'], { cost: row });
}
