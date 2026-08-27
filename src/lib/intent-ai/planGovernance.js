/**
 * FBT INTENT AI — PHASE 91: PLAN GOVERNANCE
 * ---------------------------------------------------------------------------
 * A subscription buys analysis, never permission. The most dangerous product
 * shape in this space is the one where paying more lets you skip a safety
 * step; phase 91 makes that structurally impossible.
 *
 *   · plans may only unlock ANALYTICAL entitlements from a closed list
 *   · execution caps, autonomy level and security policy are identical on
 *     every tier, including the free one, and are read from the session policy
 *     rather than the plan
 *   · `assertPlanBuysNoPermission()` fails if a paid tier has a wider cap, a
 *     higher autonomy level, or any security entitlement at all
 *   · downgrading never removes a safety control (it cannot: there were none)
 */

import { classifyFailure } from './failureModes.js';

export const PLAN_SCHEMA = 'fbt.plan-governance.v1';
export const TIERS = Object.freeze(['free', 'plus', 'pro']);

/** The ONLY things money may buy. */
export const ANALYTICAL_ENTITLEMENTS = Object.freeze([
  'history-depth', 'extra-indicators', 'more-alerts', 'export-reports',
  'priority-support', 'backtest-runs', 'saved-strategies'
]);

/** Things money may NEVER buy. */
export const FORBIDDEN_ENTITLEMENTS = Object.freeze([
  'higher-cap', 'higher-limit', 'autonomy-l3', 'skip-confirmation', 'skip-simulation',
  'bypass-guardian', 'longer-session-key', 'unlimited-approval', 'disable-2fa', 'raise-slippage-cap'
]);

export const PLAN_ENTITLEMENTS = Object.freeze({
  free: Object.freeze(['history-depth']),
  plus: Object.freeze(['history-depth', 'extra-indicators', 'more-alerts']),
  pro: Object.freeze(['history-depth', 'extra-indicators', 'more-alerts', 'export-reports', 'backtest-runs', 'saved-strategies', 'priority-support'])
});

const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean'
  ? null
  : (Number.isFinite(Number(v)) ? Number(v) : null));

/** Resolve what a tier actually gets. Anything unknown is dropped. */
export function resolveEntitlements({ tier = 'free' } = {}) {
  const key = TIERS.includes(tier) ? tier : 'free';
  const granted = (PLAN_ENTITLEMENTS[key] || []).filter((e) => ANALYTICAL_ENTITLEMENTS.includes(e));
  return {
    ok: true,
    schema: PLAN_SCHEMA,
    tier: key,
    entitlements: Object.freeze(granted),
    // Stated explicitly so a reader never has to infer it.
    grantsExecutionPermission: false,
    grantsHigherCaps: false,
    grantsAutonomy: false,
    i18nKey: 'intentAI.plan.entitlements',
    i18nParams: { tier: key, count: granted.length }
  };
}

/**
 * Execution policy comes from the SESSION, not from the wallet balance of the
 * person paying us. Every tier gets the same object.
 */
export function executionPolicyFor({ sessionPolicy = null, tier = 'free' } = {}) {
  const base = sessionPolicy && typeof sessionPolicy === 'object' ? sessionPolicy : null;
  if (!base) {
    return { ok: false, policy: null, i18nKey: 'intentAI.plan.policyUnavailable', error: classifyFailure('MISSING_DATA', { detail: 'NO_SESSION_POLICY' }) };
  }
  return {
    ok: true,
    schema: PLAN_SCHEMA,
    tier: TIERS.includes(tier) ? tier : 'free',
    // Identical for everybody: copied from the session, never widened.
    policy: Object.freeze({
      maxNotionalUsd: num(base.maxNotionalUsd),
      maxSlippageBps: num(base.maxSlippageBps),
      autonomyLevel: base.autonomyLevel ?? 'L1',
      requiresConfirmationGate: true,
      requiresSimulation: base.requiresSimulation !== false,
      sessionKeyTtlMs: num(base.sessionKeyTtlMs)
    }),
    derivedFromPlan: false
  };
}

/** Can this tier see this analytical feature? */
export function entitlementAllows({ tier = 'free', entitlement = null } = {}) {
  if (FORBIDDEN_ENTITLEMENTS.includes(entitlement)) {
    return { allowed: false, reason: 'NOT_PURCHASABLE', i18nKey: 'intentAI.plan.notPurchasable', error: classifyFailure('GUARDIAN_REJECTED', { detail: 'NOT_PURCHASABLE' }) };
  }
  if (!ANALYTICAL_ENTITLEMENTS.includes(entitlement)) {
    return { allowed: false, reason: 'UNKNOWN_ENTITLEMENT', i18nKey: 'intentAI.plan.unknownEntitlement' };
  }
  const resolved = resolveEntitlements({ tier });
  return resolved.entitlements.includes(entitlement)
    ? { allowed: true, tier: resolved.tier }
    : { allowed: false, reason: 'NOT_IN_TIER', tier: resolved.tier, i18nKey: 'intentAI.plan.upgradeForAnalysis' };
}

/** Losing a subscription must never remove a safety control. */
export function applyDowngrade({ fromTier = 'pro', toTier = 'free', sessionPolicy = null } = {}) {
  const before = executionPolicyFor({ sessionPolicy, tier: fromTier });
  const after = executionPolicyFor({ sessionPolicy, tier: toTier });
  if (!before.ok || !after.ok) return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_SESSION_POLICY' }) };
  const identical = JSON.stringify(before.policy) === JSON.stringify(after.policy);
  return {
    ok: true,
    schema: PLAN_SCHEMA,
    lostEntitlements: resolveEntitlements({ tier: fromTier }).entitlements
      .filter((e) => !resolveEntitlements({ tier: toTier }).entitlements.includes(e)),
    // The only thing a downgrade can take away is analysis.
    safetyUnchanged: identical,
    policy: after.policy,
    i18nKey: 'intentAI.plan.downgraded'
  };
}

/** The structural guarantee. */
export function assertPlanBuysNoPermission({ sessionPolicy = null } = {}) {
  const reasons = [];
  const policies = TIERS.map((t) => executionPolicyFor({ sessionPolicy, tier: t }));
  if (policies.some((p) => !p.ok)) reasons.push('NO_SESSION_POLICY');
  else {
    const first = JSON.stringify(policies[0].policy);
    if (!policies.every((p) => JSON.stringify(p.policy) === first)) reasons.push('TIERS_HAVE_DIFFERENT_EXECUTION_POLICY');
    if (policies.some((p) => p.policy.requiresConfirmationGate !== true)) reasons.push('TIER_SKIPS_CONFIRMATION');
    if (policies.some((p) => p.derivedFromPlan === true)) reasons.push('POLICY_DERIVED_FROM_PLAN');
  }
  for (const tier of TIERS) {
    const granted = resolveEntitlements({ tier });
    for (const e of granted.entitlements) {
      if (FORBIDDEN_ENTITLEMENTS.includes(e)) reasons.push(`FORBIDDEN_ENTITLEMENT:${e}`);
      if (!ANALYTICAL_ENTITLEMENTS.includes(e)) reasons.push(`NON_ANALYTICAL_ENTITLEMENT:${e}`);
    }
    if (granted.grantsExecutionPermission === true) reasons.push(`TIER_GRANTS_EXECUTION:${tier}`);
    if (granted.grantsHigherCaps === true) reasons.push(`TIER_GRANTS_CAPS:${tier}`);
  }
  const unique = [...new Set(reasons)];
  return unique.length
    ? { ok: false, reasons: unique, error: classifyFailure('GUARDIAN_REJECTED', { detail: unique[0] }) }
    : { ok: true, identicalAcrossTiers: true };
}
