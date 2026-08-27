/**
 * FBT INTENT AI — PHASE 80: REAL-TIME RISK ENGINE
 * ---------------------------------------------------------------------------
 * A fixed threshold is not risk management. A 1% slippage cap that is sensible
 * in a calm market is an invitation in a violent one, and a position size that
 * is prudent on a Tuesday can be reckless during a liquidation cascade.
 *
 * This module makes the ceilings a function of the market that is actually
 * happening right now:
 *
 *   · realised volatility (from the phase-58 live series) selects a tier
 *   · each tier TIGHTENS the slippage cap and the maximum position size —
 *     it can only ever ratchet down from the caller's base, never up, and
 *     never above the session policy
 *   · unknown or stale volatility does NOT mean "calm": it selects the
 *     strictest tier, because not knowing is the riskiest state of all
 *   · every adjustment is recorded with the number that caused it, the
 *     source, the observation time and a translatable reason — so the user
 *     can ask "why is my cap 0.3% today?" and get a checkable answer
 */

import { evaluateRisk } from './riskEngine.js';
import { classifyFailure } from './failureModes.js';

export const ADAPTIVE_RISK_SCHEMA = 'fbt.adaptive-risk.v1';
export const VOLATILITY_MAX_AGE_MS = 60 * 60 * 1000;

/**
 * Tiers are ordered from calm to extreme. `slippageFactor` and `sizeFactor`
 * are multipliers applied to the caller's base ceilings; they are all ≤ 1, so
 * the engine can only ever tighten.
 */
export const VOLATILITY_TIERS = Object.freeze([
  { tier: 'calm', maxVolatilityPct: 2, slippageFactor: 1, sizeFactor: 1 },
  { tier: 'normal', maxVolatilityPct: 5, slippageFactor: 0.8, sizeFactor: 0.9 },
  { tier: 'elevated', maxVolatilityPct: 10, slippageFactor: 0.5, sizeFactor: 0.6 },
  { tier: 'high', maxVolatilityPct: 20, slippageFactor: 0.3, sizeFactor: 0.35 },
  { tier: 'extreme', maxVolatilityPct: Infinity, slippageFactor: 0.2, sizeFactor: 0.2 }
]);

/** The tier used when volatility is unknown or stale — the strictest one. */
export const UNKNOWN_TIER = Object.freeze({
  tier: 'unknown', slippageFactor: 0.2, sizeFactor: 0.2
});

// Number(null) === 0 and Number('') === 0, so an absent value must be
// rejected BEFORE the finite check or "missing" silently reads as zero.
const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean'
  ? null
  : (Number.isFinite(Number(v)) ? Number(v) : null));
const round = (v, dp = 4) => Math.round(v * 10 ** dp) / 10 ** dp;

/**
 * Which volatility tier are we in? Requires a sourced, fresh number.
 * @returns {{tier, known, volatilityPct, source, observedAt, reasonKey}}
 */
export function classifyVolatility({
  volatilityPct = null,
  source = null,
  observedAt = null,
  now = Date.now(),
  maxAgeMs = VOLATILITY_MAX_AGE_MS
} = {}) {
  const vol = num(volatilityPct);
  const src = typeof source === 'string' && source.trim() ? source.trim().slice(0, 60) : null;
  const at = num(observedAt);
  if (vol === null || vol < 0) {
    return { ...UNKNOWN_TIER, known: false, volatilityPct: null, source: src, observedAt: at, reason: 'NO_VOLATILITY_DATA', reasonKey: 'intentAI.risk.reason.noVolatility' };
  }
  if (!src) {
    return { ...UNKNOWN_TIER, known: false, volatilityPct: vol, source: null, observedAt: at, reason: 'VOLATILITY_UNSOURCED', reasonKey: 'intentAI.risk.reason.unsourced' };
  }
  if (at === null || now - at > maxAgeMs) {
    return { ...UNKNOWN_TIER, known: false, volatilityPct: vol, source: src, observedAt: at, reason: 'VOLATILITY_STALE', reasonKey: 'intentAI.risk.reason.stale' };
  }
  const band = VOLATILITY_TIERS.find((row) => vol < row.maxVolatilityPct) || VOLATILITY_TIERS[VOLATILITY_TIERS.length - 1];
  return {
    tier: band.tier,
    known: true,
    slippageFactor: band.slippageFactor,
    sizeFactor: band.sizeFactor,
    volatilityPct: vol,
    source: src,
    observedAt: at,
    ageMs: now - at,
    reason: `VOLATILITY_${band.tier.toUpperCase()}`,
    reasonKey: `intentAI.risk.reason.${band.tier}`
  };
}

/**
 * Turn a tier into concrete ceilings. The result can only be tighter than the
 * base AND tighter than any policy ceiling supplied.
 */
export function adaptiveLimits({
  tier = UNKNOWN_TIER,
  baseSlippagePct = 1,
  baseMaxPositionUsd = null,
  policyMaxSlippagePct = null,
  policyMaxPositionUsd = null
} = {}) {
  const baseSlip = num(baseSlippagePct);
  const basePos = num(baseMaxPositionUsd);
  const slipFactor = num(tier?.slippageFactor) ?? UNKNOWN_TIER.slippageFactor;
  const sizeFactor = num(tier?.sizeFactor) ?? UNKNOWN_TIER.sizeFactor;

  const candidates = (values) => values.filter((v) => v !== null && v >= 0);
  const slipOptions = candidates([
    baseSlip === null ? null : round(baseSlip * slipFactor),
    num(policyMaxSlippagePct)
  ]);
  const posOptions = candidates([
    basePos === null ? null : round(basePos * sizeFactor, 2),
    num(policyMaxPositionUsd)
  ]);

  return {
    tier: tier?.tier || 'unknown',
    // A ceiling is the MINIMUM of everything that constrains it.
    maxSlippagePct: slipOptions.length ? Math.min(...slipOptions) : null,
    maxPositionUsd: posOptions.length ? Math.min(...posOptions) : null,
    baseSlippagePct: baseSlip,
    baseMaxPositionUsd: basePos,
    slippageFactor: slipFactor,
    sizeFactor: sizeFactor,
    tightened: baseSlip !== null && slipFactor < 1
  };
}

/**
 * The full assessment: adapt the ceilings to live volatility, check the
 * requested trade against them, and run the existing risk gate on the result.
 */
export function assessAdaptiveRisk({
  amountUsd = null,
  requestedSlippagePct = null,
  volatility = {},
  baseSlippagePct = 1,
  baseMaxPositionUsd = null,
  policyMaxSlippagePct = null,
  policyMaxPositionUsd = null,
  tokenRisk = null,
  walletRisk = null,
  mev = null,
  simulation = null,
  priceImpactPct = null,
  acknowledgedHigh = false,
  now = Date.now()
} = {}) {
  const tier = classifyVolatility({ ...volatility, now });
  const limits = adaptiveLimits({
    tier, baseSlippagePct, baseMaxPositionUsd, policyMaxSlippagePct, policyMaxPositionUsd
  });

  const violations = [];
  const amount = num(amountUsd);
  const wanted = num(requestedSlippagePct);
  if (limits.maxSlippagePct !== null && wanted !== null && wanted > limits.maxSlippagePct) {
    violations.push({
      code: 'SLIPPAGE_OVER_ADAPTIVE_CAP',
      i18nKey: 'intentAI.risk.violation.slippage',
      params: { requested: wanted, cap: limits.maxSlippagePct, tier: limits.tier }
    });
  }
  if (limits.maxPositionUsd !== null && amount !== null && amount > limits.maxPositionUsd) {
    violations.push({
      code: 'SIZE_OVER_ADAPTIVE_CAP',
      i18nKey: 'intentAI.risk.violation.size',
      params: { requested: amount, cap: limits.maxPositionUsd, tier: limits.tier }
    });
  }

  // The trade is checked against the ADAPTED cap, not the one it asked for.
  const effectiveSlippage = wanted === null
    ? limits.maxSlippagePct
    : Math.min(wanted, limits.maxSlippagePct === null ? wanted : limits.maxSlippagePct);
  const gate = evaluateRisk({
    tokenRisk, walletRisk, mev, simulation, priceImpactPct,
    slippagePct: effectiveSlippage, acknowledgedHigh
  });

  const decision = violations.length ? 'block' : gate.decision;
  return {
    ok: true,
    schema: ADAPTIVE_RISK_SCHEMA,
    decision,
    canProceed: decision === 'allow',
    volatilityKnown: tier.known === true,
    tier: limits.tier,
    limits,
    effectiveSlippagePct: effectiveSlippage,
    violations,
    gate,
    // The audit trail: what was changed, by how much, on the strength of what.
    rationale: riskDecisionRecord({ tier, limits, violations, decision, now }),
    executionAuthorized: false,
    assessedAt: now
  };
}

/** One immutable record of an adaptive decision and the evidence behind it. */
export function riskDecisionRecord({ tier = UNKNOWN_TIER, limits = {}, violations = [], decision = 'block', now = Date.now() } = {}) {
  return Object.freeze({
    decision,
    tier: tier.tier || 'unknown',
    volatilityKnown: tier.known === true,
    volatilityPct: tier.volatilityPct ?? null,
    // The reason is a key, so the same record renders in any language.
    reasonKey: tier.reasonKey || 'intentAI.risk.reason.noVolatility',
    evidence: tier.known === true
      ? { source: tier.source, observedAt: tier.observedAt, ageMs: tier.ageMs ?? null }
      : null,
    appliedSlippageCapPct: limits.maxSlippagePct ?? null,
    appliedPositionCapUsd: limits.maxPositionUsd ?? null,
    tightenedFromBase: limits.tightened === true,
    violationCodes: violations.map((v) => v.code),
    recordedAt: now
  });
}

/** Fail-closed guard: an adaptive assessment can never widen a policy cap. */
export function assertNeverLoosens(assessment, { policyMaxSlippagePct = null, policyMaxPositionUsd = null } = {}) {
  const reasons = [];
  const slipCap = num(policyMaxSlippagePct);
  const posCap = num(policyMaxPositionUsd);
  const got = assessment?.limits || {};
  if (slipCap !== null && got.maxSlippagePct !== null && got.maxSlippagePct > slipCap) reasons.push('SLIPPAGE_CAP_WIDENED');
  if (posCap !== null && got.maxPositionUsd !== null && got.maxPositionUsd > posCap) reasons.push('POSITION_CAP_WIDENED');
  if (assessment?.volatilityKnown === false && got.slippageFactor > UNKNOWN_TIER.slippageFactor) reasons.push('UNKNOWN_TREATED_AS_CALM');
  return reasons.length
    ? { ok: false, reasons, error: classifyFailure('UNKNOWN', { detail: reasons.join(',') }) }
    : { ok: true, reasons: [] };
}
