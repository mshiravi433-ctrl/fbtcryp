/**
 * FBT INTENT AI — Spec 65 items 49–50: Why This Decision / Why This Permission.
 *
 * Every consequential action carries an explicit WHY built from supplied
 * evidence: cost, liquidity, risk and execution likelihood. Without evidence
 * the engine refuses to say an option is "better". For permission requests
 * (dYdX, futures, external agents) the WHY must state reason, risk and a
 * viable alternative without the permission; a decline is a safe replan, not
 * a dead end and never an auto-enable.
 */

import { bounded, containsRawSecret, fail, noExecutionPermission, safeId, safeString } from './phaseBoundary.js';
import { replanAfterCapabilityDecline } from './strategyCompetition.js';

export const WHY_DECISION_SCHEMA = 'fbt.intent-why-decision.v1';
export const WHY_PERMISSION_SCHEMA = 'fbt.intent-why-permission.v1';

export const PERMISSION_REQUESTING_CAPABILITIES = Object.freeze(['dydx', 'futures', 'perpetuals', 'external-ai-agents', 'cex-connectors']);

const PERMISSION_RISK_SUMMARY = Object.freeze({
  dydx: 'Perpetual trading on dYdX exposes the position to leverage, funding costs and liquidation; it requires an active session and an explicit user sign-in.',
  futures: 'Futures add leverage and liquidation risk on top of market risk; they require an explicitly connected venue.',
  perpetuals: 'Perpetual contracts require leverage, funding and liquidation evidence before any consideration.',
  'external-ai-agents': 'External agents act outside FBT code; they get scoped, revocable permissions only and never receive seeds or keys.',
  'cex-connectors': 'CEX access is a scoped broker handle; withdrawal stays impossible and the handle is revocable.'
});

/**
 * Why This Decision — build an explanation for an action from evidence only.
 * A comparative claim ("this option is better") is emitted only when both
 * options have bounded evidence for the compared dimension.
 */
export function whyThisDecision({
  action = null,
  decision = null,
  actor = null,
  evidence = [],
  costs = null,
  liquidity = null,
  risk = null,
  executionLikelihood = null,
  alternative = null,
  now = Date.now()
} = {}) {
  if (containsRawSecret({ action, decision, actor, evidence, costs, liquidity, risk })) return fail('RAW_CREDENTIAL_FORBIDDEN');
  const reason = safeString(decision?.reason || decision, 240);
  if (!safeString(String(action || ''), 120) || !reason) return fail('ACTION_AND_REASON_REQUIRED');
  const rows = (Array.isArray(evidence) ? evidence : []).slice(0, 12).map((row) => ({
    source: safeString(String(row?.source || row?.type || 'unspecified'), 80) || 'unspecified',
    observedAt: row?.observedAt == null ? null : (Number.isFinite(Number(row.observedAt)) ? Number(row.observedAt) : null),
    quality: bounded(row?.quality)
  }));
  const factors = {
    cost: costs == null ? null : (Number.isFinite(Number(costs)) ? Number(costs) : null),
    liquidity: liquidity == null ? null : (Number.isFinite(Number(liquidity)) ? Number(liquidity) : null),
    risk: risk == null ? null : bounded(risk),
    executionLikelihood: executionLikelihood == null ? null : bounded(executionLikelihood)
  };
  const evidenceBacked = rows.some((row) => row.quality !== null);
  let comparative = null;
  if (alternative && typeof alternative === 'object') {
    const haveThis = factors.cost !== null || factors.risk !== null;
    const haveOther = Number.isFinite(Number(alternative.costs)) || bounded(alternative.risk) !== null;
    comparative = haveThis && haveOther
      ? {
          claim: 'COMPARED_ON_EVIDENCED_DIMENSIONS_ONLY',
          dimensions: [
            ...(factors.cost !== null && Number.isFinite(Number(alternative.costs)) ? ['cost'] : []),
            ...(factors.risk !== null && bounded(alternative.risk) !== null ? ['risk'] : [])
          ],
          claimIsBetter: true
        }
      : { claim: 'NO_COMPARISON_WITHOUT_EVIDENCE', dimensions: [], claimIsBetter: false };
  }
  return noExecutionPermission({
    ok: true,
    schema: WHY_DECISION_SCHEMA,
    action: safeString(String(action), 120),
    actor: safeId(actor) || safeString(String(actor || ''), 80) || null,
    reason,
    evidence: rows,
    evidenceBacked,
    factors,
    alternative: alternative ? { id: safeId(alternative.id) || safeString(String(alternative.id || ''), 80), comparison: comparative } : null,
    saysBetter: comparative?.claimIsBetter === true,
    executionAuthorized: false,
    explainedAt: now
  });
}

/**
 * Why This Permission — explain why a gated capability is being requested.
 * Always includes: reason, honest risk summary, an alternative without the
 * capability, and the decline path (safe replan). Declining never enables
 * anything automatically and never dead-ends the intent.
 */
export function whyThisPermission({
  capability = null,
  requestReason = null,
  strategy = null,
  alternatives = [],
  now = Date.now()
} = {}) {
  if (containsRawSecret({ capability, requestReason, strategy })) return fail('RAW_CREDENTIAL_FORBIDDEN');
  const id = safeString(String(capability || '').toLowerCase(), 64);
  if (!id) return fail('CAPABILITY_REQUIRED');
  const reason = safeString(requestReason, 240);
  if (!reason) return fail('REQUEST_REASON_REQUIRED');
  const gated = PERMISSION_REQUESTING_CAPABILITIES.includes(id);
  const riskSummary = PERMISSION_RISK_SUMMARY[id] || 'This capability changes what the plan can touch; its limits are reviewed before any authorization screen.';
  const alternativeWithout = (Array.isArray(alternatives) ? alternatives : [])
    .filter((row) => row && typeof row === 'object' && !row?.uses?.includes(id) && !row?.requiredCapabilities?.includes(id))
    .slice(0, 5)
    .map((row) => ({ id: safeId(row.id) || null, name: safeString(String(row.name || row.id || ''), 100) }));
  const replan = strategy ? replanAfterCapabilityDecline({ strategy, declinedCapability: id, alternatives }) : null;
  return noExecutionPermission({
    ok: true,
    schema: WHY_PERMISSION_SCHEMA,
    capability: id,
    gatedCapability: gated,
    requestedReason: reason,
    riskSummary,
    alternativesWithoutCapability: alternativeWithout,
    hasViableAlternative: alternativeWithout.length > 0,
    declinePath: {
      outcome: 'SAFE_REPLAN',
      deadEnd: false,
      autoEnable: false,
      replanStrategyId: replan?.ok ? safeId(strategy?.id) : null,
      replanAlternatives: replan?.alternatives || alternativeWithout.map((row) => row.id).filter(Boolean),
      requiresUserReview: true
    },
    grantsPermission: false,
    executionAuthorized: false,
    userChoiceRequired: true,
    explainedAt: now
  });
}
