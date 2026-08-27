/**
 * PHASE 91 — PLAN GOVERNANCE
 * A subscription buys analysis, never permission. Execution caps, autonomy and
 * safety checks are byte-identical on every tier, and the test "a more
 * expensive plan grants more authority" must FAIL.
 */
import { readFileSync } from 'node:fs';
import {
  resolveEntitlements, executionPolicyFor, entitlementAllows, applyDowngrade,
  assertPlanBuysNoPermission, TIERS, ANALYTICAL_ENTITLEMENTS, FORBIDDEN_ENTITLEMENTS, PLAN_SCHEMA
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

const SESSION_POLICY = {
  maxNotionalUsd: 200, maxSlippageBps: 100, autonomyLevel: 'L2',
  requiresSimulation: true, sessionKeyTtlMs: 900_000
};

try {
  /* ---------- what money buys ---------- */
  const pro = resolveEntitlements({ tier: 'pro' });
  const free = resolveEntitlements({ tier: 'free' });
  check('a tier resolves', pro.ok === true && pro.schema === PLAN_SCHEMA);
  check('a paid tier gets more ANALYSIS', pro.entitlements.length > free.entitlements.length);
  check('every entitlement is analytical', TIERS.every((t) => resolveEntitlements({ tier: t }).entitlements.every((e) => ANALYTICAL_ENTITLEMENTS.includes(e))));
  check('no tier grants execution permission', TIERS.every((t) => resolveEntitlements({ tier: t }).grantsExecutionPermission === false));
  check('no tier grants higher caps', TIERS.every((t) => resolveEntitlements({ tier: t }).grantsHigherCaps === false));
  check('no tier grants autonomy', TIERS.every((t) => resolveEntitlements({ tier: t }).grantsAutonomy === false));
  check('the entitlement list is frozen', Object.isFrozen(pro.entitlements));
  check('an unknown tier falls back to free, not to pro', resolveEntitlements({ tier: 'platinum' }).tier === 'free');
  check('the entitlement notice is translatable', pro.i18nKey === 'intentAI.plan.entitlements');
  check('the forbidden list names the dangerous things',
    ['higher-cap', 'skip-confirmation', 'bypass-guardian', 'autonomy-l3'].every((e) => FORBIDDEN_ENTITLEMENTS.includes(e)));

  /* ---------- execution policy is identical everywhere ---------- */
  const policies = TIERS.map((t) => executionPolicyFor({ sessionPolicy: SESSION_POLICY, tier: t }));
  check('every tier resolves a policy', policies.every((p) => p.ok === true));
  check('the caps are byte-identical across tiers',
    new Set(policies.map((p) => JSON.stringify(p.policy))).size === 1);
  check('the cap comes from the session, not the plan', policies[2].policy.maxNotionalUsd === 200);
  check('the policy is not derived from the plan', policies.every((p) => p.derivedFromPlan === false));
  check('every tier still needs the confirmation gate', policies.every((p) => p.policy.requiresConfirmationGate === true));
  check('every tier still needs simulation', policies.every((p) => p.policy.requiresSimulation === true));
  check('autonomy is the session autonomy on every tier', policies.every((p) => p.policy.autonomyLevel === 'L2'));
  check('the session key lifetime is the same on every tier',
    new Set(policies.map((p) => p.policy.sessionKeyTtlMs)).size === 1);
  check('the policy object is frozen', Object.isFrozen(policies[0].policy));
  check('with no session policy nothing runs', executionPolicyFor({ tier: 'pro' }).ok === false);
  check('the missing policy is a translatable notice', executionPolicyFor({ tier: 'pro' }).i18nKey === 'intentAI.plan.policyUnavailable');

  /* ---------- the "pay for permission" test must fail ---------- */
  check('a higher cap can never be bought', entitlementAllows({ tier: 'pro', entitlement: 'higher-cap' }).allowed === false);
  check('the refusal explains it is a safety setting',
    entitlementAllows({ tier: 'pro', entitlement: 'higher-cap' }).i18nKey === 'intentAI.plan.notPurchasable');
  check('skipping the confirmation gate can never be bought',
    entitlementAllows({ tier: 'pro', entitlement: 'skip-confirmation' }).allowed === false);
  check('skipping simulation can never be bought',
    entitlementAllows({ tier: 'pro', entitlement: 'skip-simulation' }).allowed === false);
  check('bypassing the guardian can never be bought',
    entitlementAllows({ tier: 'pro', entitlement: 'bypass-guardian' }).allowed === false);
  check('L3 autonomy can never be bought', entitlementAllows({ tier: 'pro', entitlement: 'autonomy-l3' }).allowed === false);
  check('a longer session key can never be bought',
    entitlementAllows({ tier: 'pro', entitlement: 'longer-session-key' }).allowed === false);
  check('EVERY forbidden entitlement is refused on the top tier',
    FORBIDDEN_ENTITLEMENTS.every((e) => entitlementAllows({ tier: 'pro', entitlement: e }).allowed === false));
  check('every forbidden refusal is a guardian rejection',
    FORBIDDEN_ENTITLEMENTS.every((e) => entitlementAllows({ tier: 'pro', entitlement: e }).error?.code === 'GUARDIAN_REJECTED'));

  /* ---------- what a tier CAN unlock ---------- */
  check('an analytical feature is allowed on the tier that has it',
    entitlementAllows({ tier: 'pro', entitlement: 'backtest-runs' }).allowed === true);
  check('the same feature is not on the free tier',
    entitlementAllows({ tier: 'free', entitlement: 'backtest-runs' }).allowed === false);
  check('the upsell is about analysis only',
    entitlementAllows({ tier: 'free', entitlement: 'backtest-runs' }).i18nKey === 'intentAI.plan.upgradeForAnalysis');
  check('an unknown entitlement is refused', entitlementAllows({ tier: 'pro', entitlement: 'teleport' }).allowed === false);

  /* ---------- downgrading cannot remove safety ---------- */
  const down = applyDowngrade({ fromTier: 'pro', toTier: 'free', sessionPolicy: SESSION_POLICY });
  check('a downgrade resolves', down.ok === true);
  check('a downgrade only removes analysis', down.lostEntitlements.every((e) => ANALYTICAL_ENTITLEMENTS.includes(e)));
  check('a downgrade changes NO safety control', down.safetyUnchanged === true);
  check('the cap after a downgrade is the same cap', down.policy.maxNotionalUsd === 200);
  check('the downgrade is a translatable notice', down.i18nKey === 'intentAI.plan.downgraded');
  check('a downgrade without a session policy is refused', applyDowngrade({ fromTier: 'pro', toTier: 'free' }).ok === false);

  /* ---------- the structural guarantee ---------- */
  const guard = assertPlanBuysNoPermission({ sessionPolicy: SESSION_POLICY });
  check('the guarantee holds', guard.ok === true && guard.identicalAcrossTiers === true);
  check('the guarantee needs a session policy', assertPlanBuysNoPermission({}).ok === false);

  const locales = ['en', 'fa', 'ar'].map((l) => JSON.parse(readFileSync(`src/i18n/locales/${l}.json`, 'utf8')));
  check('the plan copy is translated in en, fa and ar',
    locales.every((loc) => ['entitlements', 'notPurchasable', 'upgradeForAnalysis', 'downgraded', 'sameLimitsNote']
      .every((k) => typeof loc?.intentAI?.plan?.[k] === 'string')));
  check('the english copy states the limits are identical everywhere',
    /identical on every plan/i.test(locales[0].intentAI.plan.sameLimitsNote));
  check('no plan copy promises more profit or more authority',
    Object.values(locales[0].intentAI.plan).every((v) => !/(higher limit|more profit|bigger trades)/i.test(v)));

  console.log(JSON.stringify({ probe: 'phase91-plan-governance', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}

export default results;
