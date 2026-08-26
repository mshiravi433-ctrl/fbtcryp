/**
 * FBT INTENT AI — Spec 65 item 25: Parallel Strategies.
 *
 * Capital may be split across several strategies (DEX / DeFi / futures hedge /
 * external) only when the split is compatible with the user's capital and
 * risk limits. Any incompatibility — over-allocation, a strategy above the
 * risk cap, an unevidenced weight — is fail-closed. Allocation is a plan;
 * it never executes and never moves funds.
 */

import { bounded, containsRawSecret, fail, finite, noExecutionPermission, safeId } from './phaseBoundary.js';

export const PARALLEL_STRATEGIES_SCHEMA = 'fbt.intent-parallel-strategies.v1';

/**
 * Allocate capital across strategies. Weights are bounded percentages that
 * must sum to at most 100. Each strategy must individually respect the risk
 * cap, and the weighted risk must respect the portfolio cap.
 */
export function allocateParallelCapital({
  capitalUsd = null,
  allocations = [],
  riskPolicy = {},
  now = Date.now()
} = {}) {
  if (containsRawSecret({ capitalUsd, allocations, riskPolicy })) return fail('RAW_CREDENTIAL_FORBIDDEN');
  const capital = finite(capitalUsd);
  if (capital === null || capital <= 0) return fail('CAPITAL_REQUIRED');
  const rows = (Array.isArray(allocations) ? allocations : []).slice(0, 8).map((row, index) => {
    if (!row || typeof row !== 'object') return null;
    const strategyId = safeId(row.strategyId);
    const weightPct = bounded(row.weightPct);
    const riskPct = bounded(row.riskPct);
    if (!strategyId || weightPct === null || weightPct <= 0) return null;
    return { strategyId, weightPct, riskPct, evidenceRows: Array.isArray(row.evidence) ? row.evidence.length : 0 };
  }).filter(Boolean);
  if (!rows.length) return fail('ALLOCATIONS_REQUIRED');

  const maxCapitalPct = bounded(riskPolicy.maxCapitalPerStrategyPct) ?? 100;
  const maxStrategyRiskPct = bounded(riskPolicy.maxRiskPerStrategyPct);
  const maxPortfolioRiskPct = bounded(riskPolicy.maxPortfolioRiskPct);

  const totalWeight = Math.round(rows.reduce((sum, row) => sum + row.weightPct, 0) * 100) / 100;
  const violations = [];
  for (const row of rows) {
    if (row.weightPct > maxCapitalPct) violations.push({ strategyId: row.strategyId, code: 'CAPITAL_WEIGHT_ABOVE_POLICY', detail: `${row.weightPct}% > ${maxCapitalPct}%` });
    if (maxStrategyRiskPct !== null && row.riskPct !== null && row.riskPct > maxStrategyRiskPct) {
      violations.push({ strategyId: row.strategyId, code: 'STRATEGY_RISK_ABOVE_POLICY', detail: `${row.riskPct}% > ${maxStrategyRiskPct}%` });
    }
    if (row.riskPct === null) violations.push({ strategyId: row.strategyId, code: 'STRATEGY_RISK_UNEVIDENCED' });
    if (row.evidenceRows === 0) violations.push({ strategyId: row.strategyId, code: 'STRATEGY_EVIDENCE_MISSING' });
  }
  if (totalWeight > 100) violations.push({ code: 'OVER_ALLOCATION', detail: `${totalWeight}% > 100%` });
  const weightedRisk = rows.reduce((sum, row) => sum + (row.riskPct ?? 0) * (row.weightPct / 100), 0);
  if (maxPortfolioRiskPct !== null && weightedRisk > maxPortfolioRiskPct) {
    violations.push({ code: 'PORTFOLIO_RISK_ABOVE_POLICY', detail: `${Math.round(weightedRisk * 100) / 100}% > ${maxPortfolioRiskPct}%` });
  }

  if (violations.length) {
    return fail('POLICY_INCOMPATIBLE', 'The proposed split is incompatible with capital/risk policy; nothing is allocated.', { violations });
  }

  return noExecutionPermission({
    ok: true,
    schema: PARALLEL_STRATEGIES_SCHEMA,
    capitalUsd: capital,
    allocations: rows.map((row) => ({
      strategyId: row.strategyId,
      weightPct: row.weightPct,
      amountUsd: Math.round(capital * (row.weightPct / 100) * 100) / 100,
      riskPct: row.riskPct
    })),
    totalWeightPct: totalWeight,
    unallocatedWeightPct: Math.round((100 - totalWeight) * 100) / 100,
    weightedRiskPct: Math.round(weightedRisk * 100) / 100,
    compatible: true,
    fundsMoved: false,
    executionAuthorized: false,
    requiresUserChoice: true,
    requiresFreshAuthorizationBeforeExecution: true,
    allocatedAt: now
  });
}
