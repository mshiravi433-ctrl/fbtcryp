/**
 * FBT INTENT AI — target reality check.
 *
 * A target is a user objective, not a promise. This module only derives
 * arithmetic, risk labels and negotiation choices from supplied evidence. It
 * never invents a probability or expected return when no evidence exists.
 */

export const TARGET_REALITY_SCHEMA = 'fbt.intent-target-reality.v1';
export const TARGET_DISCLAIMERS = Object.freeze([
  'NOT_GUARANTEED',
  'PARTIAL_LOSS_POSSIBLE',
  'MARKET_CONDITIONS_CHANGE',
  'PAST_PERFORMANCE_IS_NOT_A_PROMISE'
]);

const numberOrNull = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const boundedPct = (value) => {
  const n = numberOrNull(value);
  return n != null && n >= -100 && n <= 1000 ? n : null;
};
const boundedProbability = (value) => {
  const n = numberOrNull(value);
  return n != null && n >= 0 && n <= 100 ? n : null;
};

function realism(targetPct, durationHrs) {
  if (targetPct == null) return { level: 'unknown', reason: 'No target percentage was supplied.' };
  const horizon = Math.max(0, numberOrNull(durationHrs) ?? 0);
  if (targetPct >= 50 && horizon <= 24) return {
    level: 'extreme',
    reason: 'This is an extreme short-horizon target. It requires unusually large market movement and carries a high loss/liquidation risk.'
  };
  if (targetPct >= 25 && horizon <= 72) return {
    level: 'very-high-risk',
    reason: 'The target is very high for the stated horizon; a loss scenario must be shown beside every projection.'
  };
  if (targetPct >= 10) return {
    level: 'high-risk',
    reason: 'The target is material and should not be presented as an expected baseline without evidence.'
  };
  if (targetPct > 0) return {
    level: 'elevated',
    reason: 'The target is positive and remains uncertain; costs, slippage and drawdown reduce the net result.'
  };
  return { level: 'bounded', reason: 'The target is not a positive-return claim.' };
}

/**
 * Derive a transparent target report. `expectedReturnPct`, `probabilityPct`,
 * `potentialLossPct` and `confidencePct` are null unless supplied as bounded
 * evidence by a strategy/risk engine.
 */
export function assessTarget({
  capital,
  targetCapital,
  targetPct,
  durationHrs,
  expectedReturnPct,
  probabilityPct,
  potentialLossPct,
  maximumDrawdownPct,
  confidencePct,
  strategyId = null
} = {}) {
  const initial = numberOrNull(capital);
  if (initial == null || initial <= 0) {
    return { ok: false, schema: TARGET_REALITY_SCHEMA, code: 'CAPITAL_REQUIRED' };
  }

  const parsedTargetCapital = targetCapital == null ? null : numberOrNull(targetCapital);
  if (targetCapital != null && (parsedTargetCapital == null || parsedTargetCapital < 0)) {
    return { ok: false, schema: TARGET_REALITY_SCHEMA, code: 'INVALID_TARGET_CAPITAL' };
  }
  const derivedTargetPct = parsedTargetCapital != null
    ? ((parsedTargetCapital / initial) - 1) * 100
    : boundedPct(targetPct);
  const target = derivedTargetPct == null ? null : Number(derivedTargetPct.toFixed(4));
  const duration = numberOrNull(durationHrs);
  const reality = realism(target, duration);
  const probability = boundedProbability(probabilityPct);
  const expected = boundedPct(expectedReturnPct);
  const loss = boundedPct(potentialLossPct);
  const drawdown = boundedPct(maximumDrawdownPct);
  const confidence = boundedProbability(confidencePct);
  const recommendations = [];

  if (reality.level === 'extreme' || reality.level === 'very-high-risk') {
    recommendations.push('REDUCE_RISK', 'EXTEND_DURATION', 'CHANGE_STRATEGY');
  } else if (reality.level === 'high-risk') {
    recommendations.push('REDUCE_RISK', 'EXTEND_DURATION', 'INCREASE_CAPITAL');
  } else if (target != null && target > 0) {
    recommendations.push('KEEP_TARGET', 'REDUCE_RISK', 'EXTEND_DURATION');
  } else {
    recommendations.push('KEEP_TARGET', 'CHANGE_STRATEGY');
  }

  return {
    ok: true,
    schema: TARGET_REALITY_SCHEMA,
    strategyId: strategyId ? String(strategyId).slice(0, 128) : null,
    capital: initial,
    targetCapital: targetCapital == null ? null : numberOrNull(targetCapital),
    targetPct: target,
    durationHrs: duration,
    realism: reality,
    estimatedProbabilityPct: probability,
    expectedReturnPct: expected,
    potentialLossPct: loss,
    maximumDrawdownPct: drawdown,
    confidencePct: confidence,
    recommendations,
    disclaimers: [...TARGET_DISCLAIMERS],
    guaranteed: false,
    automaticExecution: false,
    userMustChooseIfChanged: true
  };
}

export function realityChoice(choice) {
  const allowed = new Set(['KEEP_TARGET', 'REDUCE_RISK', 'EXTEND_DURATION', 'INCREASE_CAPITAL', 'CHANGE_STRATEGY']);
  const value = String(choice || '').toUpperCase();
  return allowed.has(value) ? { ok: true, choice: value } : { ok: false, code: 'UNKNOWN_TARGET_CHOICE' };
}
