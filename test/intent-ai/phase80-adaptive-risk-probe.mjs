/**
 * PHASE 80 — REAL-TIME RISK ENGINE
 * A fixed threshold is not risk management. Ceilings track live volatility,
 * they can only ever ratchet DOWN, unknown volatility is the strictest case
 * (not the calmest), and every adjustment is recorded with its evidence.
 */
import { readFileSync } from 'node:fs';
import {
  classifyVolatility, adaptiveLimits, assessAdaptiveRisk, riskDecisionRecord,
  assertNeverLoosens, VOLATILITY_TIERS, UNKNOWN_TIER, VOLATILITY_MAX_AGE_MS,
  ADAPTIVE_RISK_SCHEMA
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

const NOW = 1_800_000_000_000;
const vol = (pct, over = {}) => ({ volatilityPct: pct, source: 'price:ethereum', observedAt: NOW - 60_000, ...over });
const CLEAN = { tokenRisk: { level: 'low' }, walletRisk: { level: 'low' }, mev: { state: 'protected', confirmed: true }, simulation: { status: 'simulated-clean', provenSafe: true }, priceImpactPct: 0.2 };

try {
  /* ---------- the tiers ---------- */
  check('a calm market is classified calm', classifyVolatility({ ...vol(1), now: NOW }).tier === 'calm');
  check('a normal market is classified normal', classifyVolatility({ ...vol(4), now: NOW }).tier === 'normal');
  check('an elevated market is classified elevated', classifyVolatility({ ...vol(8), now: NOW }).tier === 'elevated');
  check('a fast market is classified high', classifyVolatility({ ...vol(15), now: NOW }).tier === 'high');
  check('a violent market is classified extreme', classifyVolatility({ ...vol(60), now: NOW }).tier === 'extreme');
  check('every tier only ever tightens', VOLATILITY_TIERS.every((row) => row.slippageFactor <= 1 && row.sizeFactor <= 1));
  check('the tiers are ordered from loose to tight',
    VOLATILITY_TIERS.every((row, i) => i === 0 || row.slippageFactor <= VOLATILITY_TIERS[i - 1].slippageFactor));

  /* ---------- unknown is the STRICTEST case, not the calmest ---------- */
  const noData = classifyVolatility({ now: NOW });
  check('missing volatility is not treated as calm', noData.tier !== 'calm' && noData.known === false);
  check('missing volatility gets the strictest factors', noData.slippageFactor === UNKNOWN_TIER.slippageFactor);
  check('missing volatility carries a translatable reason', noData.reasonKey === 'intentAI.risk.reason.noVolatility');
  const unsourced = classifyVolatility({ volatilityPct: 1, observedAt: NOW, now: NOW });
  check('an unsourced volatility reading is not trusted', unsourced.known === false && unsourced.reason === 'VOLATILITY_UNSOURCED');
  const stale = classifyVolatility({ ...vol(1, { observedAt: NOW - VOLATILITY_MAX_AGE_MS - 1 }), now: NOW });
  check('a stale volatility reading is not trusted', stale.known === false && stale.reason === 'VOLATILITY_STALE');
  check('a stale reading still gets the strictest factors', stale.slippageFactor === UNKNOWN_TIER.slippageFactor);
  check('a negative volatility reading is refused', classifyVolatility({ ...vol(-5), now: NOW }).known === false);

  /* ---------- the ceilings ---------- */
  const calmLimits = adaptiveLimits({ tier: classifyVolatility({ ...vol(1), now: NOW }), baseSlippagePct: 1, baseMaxPositionUsd: 1000 });
  check('a calm market keeps the base slippage cap', calmLimits.maxSlippagePct === 1);
  const wildLimits = adaptiveLimits({ tier: classifyVolatility({ ...vol(30), now: NOW }), baseSlippagePct: 1, baseMaxPositionUsd: 1000 });
  check('a violent market tightens the slippage cap', wildLimits.maxSlippagePct < calmLimits.maxSlippagePct);
  check('a violent market tightens the position cap', wildLimits.maxPositionUsd < calmLimits.maxPositionUsd);
  check('the tightening is recorded as such', wildLimits.tightened === true);
  const policyBound = adaptiveLimits({
    tier: classifyVolatility({ ...vol(1), now: NOW }),
    baseSlippagePct: 5, baseMaxPositionUsd: 10_000,
    policyMaxSlippagePct: 0.5, policyMaxPositionUsd: 200
  });
  check('the policy cap still wins in a calm market', policyBound.maxSlippagePct === 0.5 && policyBound.maxPositionUsd === 200);
  check('a ceiling is the minimum of everything constraining it',
    adaptiveLimits({ tier: classifyVolatility({ ...vol(30), now: NOW }), baseSlippagePct: 1, policyMaxSlippagePct: 3 }).maxSlippagePct < 1);

  /* ---------- the assessment ---------- */
  const calm = assessAdaptiveRisk({ amountUsd: 100, requestedSlippagePct: 0.5, volatility: vol(1), baseSlippagePct: 1, baseMaxPositionUsd: 1000, ...CLEAN, now: NOW });
  check('a reasonable trade in a calm market is allowed', calm.decision === 'allow' && calm.canProceed === true);
  check('the assessment declares its schema', calm.schema === ADAPTIVE_RISK_SCHEMA);
  check('the assessment reports the tier it used', calm.tier === 'calm');
  check('an assessment never authorizes execution', calm.executionAuthorized === false);

  const overSlip = assessAdaptiveRisk({ amountUsd: 100, requestedSlippagePct: 0.9, volatility: vol(30), baseSlippagePct: 1, baseMaxPositionUsd: 1000, ...CLEAN, now: NOW });
  check('the same slippage is blocked in a violent market', overSlip.decision === 'block' && overSlip.canProceed === false);
  check('the block names the adaptive cap', overSlip.violations[0].code === 'SLIPPAGE_OVER_ADAPTIVE_CAP');
  check('the violation is a friendly i18n key, not a crash', overSlip.violations[0].i18nKey === 'intentAI.risk.violation.slippage');
  check('the violation names both the request and the cap',
    overSlip.violations[0].params.requested === 0.9 && overSlip.violations[0].params.cap < 0.9);

  const overSize = assessAdaptiveRisk({ amountUsd: 900, requestedSlippagePct: 0.1, volatility: vol(30), baseSlippagePct: 1, baseMaxPositionUsd: 1000, ...CLEAN, now: NOW });
  check('an oversized position in a violent market is blocked', overSize.decision === 'block');
  check('the size block is named separately', overSize.violations.some((v) => v.code === 'SIZE_OVER_ADAPTIVE_CAP'));

  const unknownVol = assessAdaptiveRisk({ amountUsd: 900, requestedSlippagePct: 0.9, volatility: {}, baseSlippagePct: 1, baseMaxPositionUsd: 1000, ...CLEAN, now: NOW });
  check('unknown volatility is treated as the riskiest state', unknownVol.decision === 'block');
  check('unknown volatility is reported, not hidden', unknownVol.volatilityKnown === false);

  const clamped = assessAdaptiveRisk({ amountUsd: 10, requestedSlippagePct: 4, volatility: vol(30), baseSlippagePct: 10, baseMaxPositionUsd: 1000, ...CLEAN, now: NOW });
  check('the trade is evaluated against the ADAPTED cap, not the requested one',
    clamped.effectiveSlippagePct <= clamped.limits.maxSlippagePct);

  /* ---------- the decision is recorded with its evidence ---------- */
  const record = calm.rationale;
  check('the decision is recorded', record.decision === 'allow');
  check('the record names the tier', record.tier === 'calm');
  check('the record carries the volatility number that caused it', record.volatilityPct === 1);
  check('the record names its source', record.evidence.source === 'price:ethereum');
  check('the record carries the observation time', record.evidence.observedAt === NOW - 60_000);
  check('the record carries the applied caps', Number.isFinite(record.appliedSlippageCapPct));
  check('the record reason is a translatable key', record.reasonKey.startsWith('intentAI.risk.reason.'));
  check('the record is immutable', Object.isFrozen(record));
  const unknownRecord = riskDecisionRecord({ tier: classifyVolatility({ now: NOW }), limits: {}, decision: 'block', now: NOW });
  check('a record with unknown volatility has no invented evidence', unknownRecord.evidence === null);
  check('a record with unknown volatility says so', unknownRecord.volatilityKnown === false);
  check('a blocked decision records the violation codes',
    overSlip.rationale.violationCodes.includes('SLIPPAGE_OVER_ADAPTIVE_CAP'));

  /* ---------- the never-loosens guard ---------- */
  check('the guard accepts an assessment inside the policy caps',
    assertNeverLoosens(overSlip, { policyMaxSlippagePct: 5, policyMaxPositionUsd: 5000 }).ok === true);
  check('the guard rejects a widened slippage cap',
    assertNeverLoosens({ limits: { maxSlippagePct: 9, maxPositionUsd: null } }, { policyMaxSlippagePct: 1 }).ok === false);
  check('the guard rejects a widened position cap',
    assertNeverLoosens({ limits: { maxSlippagePct: null, maxPositionUsd: 9000 } }, { policyMaxPositionUsd: 200 }).ok === false);
  check('the guard rejects unknown volatility treated as calm',
    assertNeverLoosens({ volatilityKnown: false, limits: { slippageFactor: 1, maxSlippagePct: null, maxPositionUsd: null } }).ok === false);

  const locales = ['en', 'fa', 'ar'].map((l) => JSON.parse(readFileSync(`src/i18n/locales/${l}.json`, 'utf8')));
  check('every tier reason is translated in en, fa and ar',
    locales.every((loc) => ['calm', 'normal', 'elevated', 'high', 'extreme', 'noVolatility', 'unsourced', 'stale']
      .every((k) => typeof loc?.intentAI?.risk?.reason?.[k] === 'string')));
  check('both violation messages are translated in en, fa and ar',
    locales.every((loc) => typeof loc?.intentAI?.risk?.violation?.slippage === 'string'
      && typeof loc?.intentAI?.risk?.violation?.size === 'string'));

  console.log(JSON.stringify({ probe: 'phase80-adaptive-risk', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}

export default results;
