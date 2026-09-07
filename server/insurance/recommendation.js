/**
 * FBT Insurance OS — ProviderScoreEngine / recommendation ranking (§7).
 *
 * Ranks quotes for the marketplace and the /recommend endpoint using ALL of:
 * premium, coverage, deductible, provider health, provider risk, capacity,
 * claim method, terms, exclusions, chain, protocol, duration, user
 * preferences, data freshness.
 *
 * Hard rules:
 *  - NEVER purely "cheapest wins" — price is one weighted factor among many;
 *  - a provider whose status is UNAVAILABLE / PAUSED / STALE / NOT_CONFIGURED /
 *    UNKNOWN is never recommended for a NEW purchase (its existing user
 *    coverage stays visible elsewhere);
 *  - stale quotes rank below fresh ones, visibly.
 */
import { PROVIDER_STATUS } from './constants.js';

const NON_RECOMMENDABLE = new Set(['UNAVAILABLE', 'PAUSED', 'STALE', 'NOT_CONFIGURED', 'UNKNOWN']);

const WEIGHTS = Object.freeze({
  price: 0.24,            // premium vs coverage (still capped — never decisive alone)
  coverage: 0.1,          // raw coverage amount fit
  deductible: 0.06,       // lower deductible ranks higher when present
  providerHealth: 0.16,   // health + latency
  providerRisk: 0.1,      // audit status + declared risk score
  capacity: 0.1,          // provider-reported remaining capacity
  claimMethod: 0.08,      // on-chain proof & membership clarity
  terms: 0.06,            // published wording/annex present
  exclusions: 0.03,       // fewer unknowns disclosed (transparency, not leniency)
  chainFit: 0.02,         // exact chain match (quotes are already filtered)
  protocolFit: 0.02,      // product targets the user's protocol when declared
  durationFit: 0.01,      // requested duration supported natively
  freshness: 0.02         // fresher data ranks higher
});

function clamp01(n) { return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0)); }

function healthScore(status, latencyMs) {
  if (status === PROVIDER_STATUS.HEALTHY) return clamp01(1 - Math.min(0.3, (latencyMs || 0) / 10000));
  if (status === PROVIDER_STATUS.DEGRADED) return 0.4;
  return 0;
}

function riskScore(providerMeta) {
  const audit = String(providerMeta?.auditStatus || '').toLowerCase();
  let s = 0.4;
  if (audit.includes('provider-published') || audit.includes('audited')) s = 0.75;
  if (providerMeta?.riskScore === 'LOW') s = Math.min(1, s + 0.2);
  if (providerMeta?.riskScore === 'HIGH' || providerMeta?.riskScore === 'CRITICAL') s = Math.max(0, s - 0.4);
  return s;
}

function claimMethodScore(method) {
  const m = String(method || '').toLowerCase();
  if (m.includes('on-chain') || m.includes('nexus-assessment')) return 0.9;
  if (m.includes('insurace')) return 0.7;
  if (!m) return 0.2;
  return 0.5;
}

/**
 * rankQuotes({ quotes, preferences })
 *   preferences: { prioritize: 'price'|'health'|'capacity'|..., maxPremiumMicro? }
 * Returns ranked list annotated with score + explain (auditable, no black box).
 */
export function rankQuotes(quotes = [], { preferences = {}, providerMeta = {} } = {}) {
  const enriched = (quotes || []).map((q) => {
    const meta = providerMeta[q.provider] || {};
    const premium = BigInt(q.premiumMicro ?? q.totalCostMicro ?? '0');
    const coverage = BigInt(q.coverageAmountMicro ?? '0');
    const priceScore = premium > 0n && coverage > 0n
      ? clamp01(1 - (Number(premium) / Math.max(1, Number(coverage)))) // cheap premium per unit covered
      : 0;
    const freshnessScore = q?._freshness?.stale === true ? 0 : q?._freshness?.updatedAt ? 0.9 : 0.5;

    const parts = {
      price: priceScore,
      coverage: coverage > 0n ? 0.8 : 0.2,
      deductible: q.deductibleMicro != null ? clamp01(1 - Number(BigInt(q.deductibleMicro)) / Math.max(1, Number(coverage))) : 0.6,
      providerHealth: healthScore(q.providerHealth || meta.healthStatus, meta.latencyMs),
      providerRisk: riskScore(meta),
      capacity: q.capacity ? clamp01(q.capacityRatio ?? 0.6) : 0.5,
      claimMethod: claimMethodScore(q.claimMethod),
      terms: (q.termsHash && (q.termsUrl || q.annexUrl || q.exclusions?.length != null)) ? 0.9 : 0.3,
      exclusions: Array.isArray(q.exclusions) ? clamp01(0.5 + Math.min(0.5, q.exclusions.length / 10)) : 0.3,
      chainFit: Number(q.chainId) > 0 ? 1 : 0.3,
      protocolFit: q.protocol && (q.productName || q.label || '').toLowerCase().includes(String(q.protocol).toLowerCase()) ? 1 : 0.5,
      durationFit: q.durationDays ? 0.9 : 0.4,
      freshness: freshnessScore
    };

    let score = 0;
    for (const [k, w] of Object.entries(WEIGHTS)) score += (parts[k] ?? 0) * w;

    // preference tilt (bounded — never overrides the hard gates below)
    const pref = String(preferences.prioritize || '').toLowerCase();
    if (pref === 'price') score += parts.price * 0.1;
    if (pref === 'health') score += parts.providerHealth * 0.1;
    if (pref === 'capacity') score += parts.capacity * 0.1;

    return {
      ...q,
      score: Number(score.toFixed(4)),
      scoreExplain: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, Number(clamp01(v).toFixed(3))]))
    };
  });

  return enriched.sort((a, b) => b.score - a.score);
}

/** Gates for NEW purchases; existing coverage display is never blocked here. */
export function recommendable(status, health) {
  if (NON_RECOMMENDABLE.has(String(status || '').toUpperCase())) return false;
  if (NON_RECOMMENDABLE.has(String(health || '').toUpperCase())) return false;
  return true;
}
