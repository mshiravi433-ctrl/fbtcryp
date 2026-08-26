/**
 * Unified Risk Engine wrapping executionGate + price impact + slippage.
 * Fail-closed: missing inputs never read as safe.
 */
import { evaluateExecutionGate, worse } from '../executionGate.js';

export function evaluateRisk(input = {}) {
  const {
    tokenRisk,
    walletRisk,
    mev,
    simulation,
    priceImpactPct,
    slippagePct,
    acknowledgedHigh = false
  } = input;

  const gate = evaluateExecutionGate({ tokenRisk, walletRisk, mev, simulation, acknowledgedHigh });
  const blocked = [...gate.blocked];
  const warnings = [...gate.warnings];
  let level = gate.level;

  if (priceImpactPct == null || !Number.isFinite(Number(priceImpactPct))) {
    warnings.push('price-impact-unknown');
    level = worse(level, 'unknown');
  } else if (Number(priceImpactPct) > 8) {
    blocked.push('price-impact-critical');
    level = worse(level, 'critical');
  } else if (Number(priceImpactPct) > 3) {
    warnings.push('price-impact-high');
    level = worse(level, 'high');
  }

  if (slippagePct == null || !Number.isFinite(Number(slippagePct))) {
    warnings.push('slippage-unknown');
    level = worse(level, 'unknown');
  } else if (Number(slippagePct) > 5) {
    blocked.push('slippage-critical');
    level = worse(level, 'critical');
  } else if (Number(slippagePct) > 1.5) {
    warnings.push('slippage-high');
    level = worse(level, 'high');
  }

  let decision;
  if (blocked.length > 0) decision = 'block';
  else if ((level === 'high' || level === 'unknown') && !acknowledgedHigh) decision = 'acknowledge';
  else decision = 'allow';

  return {
    decision,
    canProceed: decision === 'allow',
    blocked,
    warnings,
    level,
    gate,
    summary: `risk:${decision}:${level}:${blocked.length}:${warnings.length}`
  };
}
