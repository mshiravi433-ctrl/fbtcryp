/**
 * LENDING ENGINE — protocol router (§9 of the production spec).
 * ---------------------------------------------------------------------------
 * One asset can be lendable on several protocols. The router ranks the
 * candidates, but APY alone is NOT the criterion. The score is the weighted
 * sum the spec lists — APY, liquidity, utilization, protocol risk, oracle
 * risk, smart-contract risk, gas, historical reliability — and every weight
 * and every risk table is configuration, not a constant buried in a hook.
 *
 * `bestRoute` returns the ranking with the *why* attached, so the UI can
 * show "Aave wins: higher liquidity, lower protocol risk" instead of a
 * silent number. A candidate with status !== 'active' or from a
 * circuit-broken protocol is excluded, never ranked.
 */

export const DEFAULT_WEIGHTS = Object.freeze({
  apy: 0.30,
  liquidity: 0.20,
  utilization: 0.10,
  protocolRisk: 0.15,
  oracleRisk: 0.05,
  contractRisk: 0.10,
  gas: 0.05,
  reliability: 0.05
});

/** Protocol risk tables — configuration, adjustable as audits land. */
export const DEFAULT_RISK_TABLES = Object.freeze({
  'aave-v3':       { protocolRisk: 0.15, oracleRisk: 0.10, contractRisk: 0.10, reliability: 0.98 },
  'compound-v3':   { protocolRisk: 0.25, oracleRisk: 0.15, contractRisk: 0.15, reliability: 0.95 },
  'morpho':        { protocolRisk: 0.45, oracleRisk: 0.20, contractRisk: 0.20, reliability: 0.85 },
  'solana-lending': { protocolRisk: 0.60, oracleRisk: 0.30, contractRisk: 0.25, reliability: 0.70 }
});

/** Normalize a percentage/APY into a 0..1 score (cap ±50% APY to the range). */
const ratioScore = (value, cap = 0.5) => {
  const v = Number(value);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v / cap));
};

/** Utilization has a sweet spot: 0.7–0.9 is efficient, both tails are worse. */
const utilizationScore = (utilization) => {
  const u = Number(utilization);
  if (!Number.isFinite(u)) return 0.4;
  if (u >= 0.7 && u <= 0.9) return 1;
  if (u > 0.9) return Math.max(0, 1 - (u - 0.9) * 8);   // crowded pool
  return Math.max(0.3, u / 0.7 * 0.7);                   // idle pool
};

/** Liquidity on a log scale: $1M → ~0.35, $100M → ~0.8, $1B → ~1. */
const liquidityScore = (liquidityUsd) => {
  const l = Number(liquidityUsd);
  if (!Number.isFinite(l) || l <= 0) return 0;
  return Math.max(0, Math.min(1, Math.log10(l) / 10 + 0.3));
};

/** Gas: cheaper is better. $0.10 → 1, $10 → 0. */
const gasScore = (gasUsd) => {
  const g = Number(gasUsd);
  if (!Number.isFinite(g)) return 0.5;
  return Math.max(0, Math.min(1, 1 - Math.log10(Math.max(0.1, g)) / 2));
};

const riskScore = (risk) => Math.max(0, Math.min(1, 1 - Number(risk ?? 0.5)));

/**
 * Score one candidate. Shape:
 *   { protocol, supplyApy, borrowApy, liquidityUsd, utilization, gasUsd,
 *     status, chainId }
 * Returns { total, parts } with each part 0..1 and the weighted total 0..1.
 */
export function scoreProtocol(candidate, { weights = DEFAULT_WEIGHTS, riskTables = DEFAULT_RISK_TABLES, side = 'supply' } = {}) {
  const risk = riskTables[candidate?.protocol] ?? riskTables['aave-v3'];
  const apy = Number(side === 'borrow' ? candidate?.borrowApy : candidate?.supplyApy ?? 0);
  const parts = {
    apy: side === 'borrow' ? 1 - ratioScore(apy) : ratioScore(apy),   // borrow: lower APY wins
    liquidity: liquidityScore(candidate?.liquidityUsd),
    utilization: utilizationScore(candidate?.utilization),
    protocolRisk: riskScore(risk?.protocolRisk),
    oracleRisk: riskScore(risk?.oracleRisk),
    contractRisk: riskScore(risk?.contractRisk),
    gas: gasScore(candidate?.gasUsd),
    reliability: riskScore(1 - (risk?.reliability ?? 0))
  };
  let total = 0;
  for (const [key, weight] of Object.entries(weights)) total += (parts[key] ?? 0) * Number(weight);
  return { total: Math.round(total * 10000) / 10000, parts };
}

/**
 * Rank candidates. Excludes anything not `active`, and (when a circuit map
 * is supplied) any protocol the breaker has opened.
 */
export function bestRoute(candidates, { weights, riskTables, side = 'supply', circuit = {} } = {}) {
  const list = Array.isArray(candidates) ? candidates : [];
  const ranked = list
    .filter((candidate) => candidate && candidate.status === 'active')
    .filter((candidate) => circuit[candidate.protocol] !== 'READ_ONLY')
    .map((candidate) => ({
      ...candidate,
      score: scoreProtocol(candidate, { weights, riskTables, side })
    }))
    .sort((a, b) => b.score.total - a.score.total);

  const excluded = list
    .filter((candidate) => !candidate || candidate.status !== 'active')
    .map((candidate) => ({ protocol: candidate?.protocol ?? 'unknown', reason: candidate?.reason ?? 'INACTIVE' }));

  return {
    side,
    best: ranked[0] ?? null,
    ranked,
    excluded,
    reason: ranked[0] ? bestReason(ranked[0]) : (excluded.length ? 'NO_ACTIVE_CANDIDATE' : 'NO_CANDIDATES')
  };
}

function bestReason(winner) {
  const { parts } = winner.score;
  const names = { apy: 'APY', liquidity: 'liquidity', utilization: 'healthy utilization', protocolRisk: 'lower protocol risk', oracleRisk: 'lower oracle risk', contractRisk: 'lower contract risk', gas: 'cheaper gas', reliability: 'track record' };
  const top = Object.entries(parts)
    .filter(([, value]) => value >= 0.6)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([key]) => names[key])
    .join(' + ');
  return `Best ${winner.protocol}: ${top || 'balanced profile'}`;
}
