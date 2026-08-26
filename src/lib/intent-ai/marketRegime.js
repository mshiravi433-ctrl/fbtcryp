/**
 * FBT INTENT AI — Spec 65 item 27: Market Regime Detector.
 *
 * Bull / Bear / Sideways / High Volatility / Low Liquidity / Risk-On / Risk-Off
 * are labels derived ONLY from supplied, sourced and fresh-enough evidence.
 * Without regime evidence the answer is `regime: 'unavailable'`. A regime
 * label never switches a strategy by itself; it is review input.
 */

import { bounded, containsRawSecret, fail, finite, noExecutionPermission, safeString } from './phaseBoundary.js';
import { decayConfidence } from './confidenceDecay.js';

export const MARKET_REGIME_SCHEMA = 'fbt.intent-market-regime.v1';

export const REGIME_LABELS = Object.freeze([
  'bull', 'bear', 'sideways', 'high-volatility', 'low-liquidity', 'risk-on', 'risk-off'
]);

const DEFAULT_MAX_AGE_HRS = 24;

/**
 * Detect a regime from evidence rows shaped like
 * `{ source, observedAt, quality (0..1 evidence quality), metrics: { trendPct, volatilityPct, liquidityUsd, riskAppetite } }`.
 * Deterministic thresholds; the row's evidenced quality decays with age —
 * stale or unscored rows are excluded. Missing metrics keep individual
 * regimes undetectable, and no evidence at all yields `unavailable`.
 */
export function detectMarketRegime({ evidence = [], maxAgeHrs = DEFAULT_MAX_AGE_HRS, now = Date.now() } = {}) {
  if (containsRawSecret(evidence)) return fail('RAW_CREDENTIAL_FORBIDDEN');
  const rows = (Array.isArray(evidence) ? evidence : []).slice(0, 24).map((row) => {
    if (!row || typeof row !== 'object') return null;
    const source = safeString(String(row.source || row.type || ''), 80);
    const observedAt = finite(row.observedAt);
    const metrics = row.metrics && typeof row.metrics === 'object' ? row.metrics : {};
    if (!source || observedAt === null) return null;
    // evidence quality arrives on the 0..1 scale used across strategy
    // contracts; decayConfidence works on the 0..100 scale.
    const qualityPct = bounded(row.quality);
    return {
      source,
      observedAt,
      freshness: decayConfidence({ baseConfidence: qualityPct === null ? null : qualityPct * 100, observedAt, now, halfLifeHrs: maxAgeHrs }),
      trendPct: finite(metrics.trendPct),
      volatilityPct: finite(metrics.volatilityPct),
      liquidityUsd: finite(metrics.liquidityUsd),
      riskAppetite: safeString(String(metrics.riskAppetite || ''), 16)
    };
  }).filter(Boolean);

  if (!rows.length) {
    return noExecutionPermission({
      ok: true,
      schema: MARKET_REGIME_SCHEMA,
      regime: 'unavailable',
      status: 'insufficient-evidence',
      detectable: [],
      evidenceRows: 0,
      strategyChangesAutomatically: false,
      note: 'No sourced regime evidence was supplied; the regime stays unavailable instead of being guessed.',
      detectedAt: now
    });
  }

  const fresh = rows.filter((row) => row.freshness.status === 'fresh-enough');
  const avg = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
  const trend = avg(fresh.map((row) => row.trendPct).filter((value) => value !== null));
  const volatility = avg(fresh.map((row) => row.volatilityPct).filter((value) => value !== null));
  const liquidity = avg(fresh.map((row) => row.liquidityUsd).filter((value) => value !== null));
  const appetites = [...new Set(fresh.map((row) => row.riskAppetite).filter(Boolean))];

  const detectable = [];
  if (trend !== null) detectable.push(trend >= 10 ? 'bull' : trend <= -10 ? 'bear' : 'sideways');
  if (volatility !== null) detectable.push(volatility >= 8 ? 'high-volatility' : null);
  if (liquidity !== null) detectable.push(liquidity < 250_000 ? 'low-liquidity' : null);
  if (appetites.length === 1) detectable.push(appetites[0] === 'on' ? 'risk-on' : appetites[0] === 'off' ? 'risk-off' : null);

  const labels = [...new Set(detectable.filter(Boolean))];
  const stale = rows.length - fresh.length;
  return noExecutionPermission({
    ok: true,
    schema: MARKET_REGIME_SCHEMA,
    regime: labels.length ? labels : 'unavailable',
    status: labels.length ? (stale ? 'partial-stale-excluded' : 'observed') : 'insufficient-evidence',
    detectable: labels,
    metrics: { trendPct: trend, volatilityPct: volatility, liquidityUsd: liquidity, riskAppetite: appetites.length === 1 ? appetites[0] : null },
    evidenceRows: rows.length,
    staleRowsExcluded: stale,
    strategyChangesAutomatically: false,
    requiresStrategyReview: labels.some((label) => label === 'high-volatility' || label === 'low-liquidity'),
    note: 'A regime label is review input for Strategy and Risk; it never re-routes a live intent by itself.',
    detectedAt: now
  });
}
