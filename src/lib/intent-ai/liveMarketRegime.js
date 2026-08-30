/**
 * FBT INTENT AI — PHASE 58: LIVE MARKET REGIME
 * ---------------------------------------------------------------------------
 * A cached snapshot is not a market regime. Phase 65/27 gave us a deterministic
 * regime detector that only reads SOURCED, FRESH evidence; this module feeds it
 * with real prices instead of a hand-written evidence array.
 *
 *   · the price series is injected (`priceSource`) so the module stays free of
 *     Vite-only imports — at the call site it is `getChart()` from src/lib/api.js
 *   · a dead feed is `dataStatus: 'unavailable'`, never a remembered regime
 *   · a series whose NEWEST point is older than `maxAgeHrs` cannot produce a
 *     regime: staleness is not smoothed over, it is reported
 *   · trend / volatility / liquidity are computed from the real points, and the
 *     answer always carries its source, its timestamp and its sample size
 */

import { detectMarketRegime, MARKET_REGIME_SCHEMA } from './marketRegime.js';
import { classifyFailure } from './failureModes.js';

export const LIVE_REGIME_SCHEMA = 'fbt.live-market-regime.v1';
export const DEFAULT_REGIME_MAX_AGE_HRS = 24;
/** Fewer points than this cannot describe a regime honestly. */
export const MIN_REGIME_POINTS = 8;

const HOUR = 3_600_000;
// Number(null) === 0 and Number('') === 0, so an absent value must be
// rejected BEFORE the finite check or "missing" silently reads as zero.
const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean'
  ? null
  : (Number.isFinite(Number(v)) ? Number(v) : null));

/** Normalise a chart series ([{t,p}] or [[t,p]]) into sorted, finite points. */
export function normalizeSeries(series) {
  if (!Array.isArray(series)) return [];
  return series
    .map((row) => {
      if (Array.isArray(row)) return { t: num(row[0]), p: num(row[1]) };
      if (row && typeof row === 'object') return { t: num(row.t ?? row.time ?? row.at), p: num(row.p ?? row.price ?? row.c) };
      return null;
    })
    .filter((row) => row && row.t !== null && row.p !== null && row.p > 0)
    .sort((a, b) => a.t - b.t);
}

/** Trend %, realised volatility % and sample size from real points. */
export function seriesMetrics(points) {
  if (!Array.isArray(points) || points.length < 2) {
    return { trendPct: null, volatilityPct: null, points: points?.length || 0, firstAt: null, lastAt: null };
  }
  const first = points[0].p;
  const last = points[points.length - 1].p;
  const trendPct = ((last - first) / first) * 100;
  const returns = [];
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1].p;
    if (prev > 0) returns.push((points[i].p - prev) / prev);
  }
  const mean = returns.reduce((sum, r) => sum + r, 0) / (returns.length || 1);
  const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (returns.length || 1);
  const volatilityPct = Math.sqrt(variance) * 100 * Math.sqrt(returns.length || 1);
  return {
    trendPct: Math.round(trendPct * 100) / 100,
    volatilityPct: Math.round(volatilityPct * 100) / 100,
    points: points.length,
    firstAt: points[0].t,
    lastAt: points[points.length - 1].t
  };
}

/** Build ONE sourced evidence row from a real series (the detector's input). */
export function buildRegimeEvidence({ series, source, liquidityUsd = null, riskAppetite = null, now = Date.now(), maxAgeHrs = DEFAULT_REGIME_MAX_AGE_HRS } = {}) {
  const src = typeof source === 'string' && source.trim() ? source.trim().slice(0, 60) : null;
  if (!src) return { ok: false, reason: 'NO_SOURCE' };
  const points = normalizeSeries(series).filter((row) => now - row.t <= maxAgeHrs * HOUR);
  if (points.length < MIN_REGIME_POINTS) return { ok: false, reason: 'NOT_ENOUGH_FRESH_POINTS', points: points.length };
  const metrics = seriesMetrics(points);
  return {
    ok: true,
    metricsSummary: metrics,
    evidence: {
      source: src,
      observedAt: metrics.lastAt,
      // Quality is the share of the requested window that is really covered.
      quality: Math.min(1, points.length / Math.max(MIN_REGIME_POINTS, 24)),
      metrics: {
        trendPct: metrics.trendPct,
        volatilityPct: metrics.volatilityPct,
        ...(num(liquidityUsd) !== null ? { liquidityUsd: num(liquidityUsd) } : {}),
        ...(riskAppetite ? { riskAppetite: String(riskAppetite).slice(0, 16) } : {})
      }
    }
  };
}

function unavailable(detail, extra = {}) {
  return {
    ok: false,
    schema: LIVE_REGIME_SCHEMA,
    dataStatus: 'unavailable',
    regime: 'unavailable',
    status: 'insufficient-evidence',
    strategyChangesAutomatically: false,
    executionAuthorized: false,
    sources: [],
    error: classifyFailure('MISSING_DATA', { detail }),
    ...extra
  };
}

/**
 * Detect the regime from REAL prices.
 * @param {function} priceSource async ({assetId, days, vs}) → series
 * @param {number|null} now  fixed instant for deterministic callers; when
 *   omitted the FRESHNESS WINDOW is anchored at entry while DETECTION is
 *   anchored just after the feed loop — a live feed's newest point (stamped
 *   during the await) must never read as "from the future".
 */
export async function detectLiveMarketRegime({
  assets = [],
  priceSource,
  days = 7,
  vs = 'usd',
  liquidityBy = null,
  now = null,
  maxAgeHrs = DEFAULT_REGIME_MAX_AGE_HRS
} = {}) {
  if (typeof priceSource !== 'function') return unavailable('NO_PRICE_SOURCE');
  const ids = (Array.isArray(assets) ? assets : [assets]).filter(Boolean).slice(0, 6);
  if (!ids.length) return unavailable('NO_ASSETS');

  // Window anchor: the instant the collection started. A point stamped while
  // the feed was being fetched is obviously not stale, so the window uses
  // THIS instant, never a later one.
  const windowNow = now ?? Date.now();

  const evidence = [];
  const sources = [];
  const skipped = [];
  for (const assetId of ids) {
    let series = null;
    try {
      series = await priceSource({ assetId, days, vs });
    } catch {
      skipped.push({ assetId, reason: 'FEED_FAILED' });
      continue;
    }
    const built = buildRegimeEvidence({
      series,
      source: `price:${assetId}`,
      liquidityUsd: liquidityBy && typeof liquidityBy === 'object' ? liquidityBy[assetId] : null,
      now: windowNow,
      maxAgeHrs
    });
    if (!built.ok) {
      skipped.push({ assetId, reason: built.reason });
      continue;
    }
    evidence.push(built.evidence);
    sources.push({
      assetId,
      source: built.evidence.source,
      observedAt: built.evidence.observedAt,
      // ageMs is finalised below, against the detection instant, so a live
      // feed's newest point (stamped during the await) can never read as
      // "from the future" merely because the loop took a millisecond.
      ageMs: null,
      points: built.metricsSummary.points,
      trendPct: built.metricsSummary.trendPct,
      volatilityPct: built.metricsSummary.volatilityPct
    });
  }

  if (!evidence.length) return unavailable('NO_FRESH_PRICE_EVIDENCE', { skipped });

  /*
   * Detection instant: the caller's fixed `now` when determinism was asked
   * for; otherwise captured AFTER the feed loop, not at entry. The detector's
   * freshness gate must compare each row against the instant the rows were
   * actually collected — otherwise a feed that resolves 1ms after entry would
   * make its own newest point look future-dated and the whole regime would
   * collapse to unavailable under any real-world latency.
   */
  const detectNow = now ?? Date.now();
  const detected = detectMarketRegime({ evidence, maxAgeHrs, now: detectNow });
  for (const s of sources) s.ageMs = detectNow - s.observedAt;
  return {
    ok: true,
    schema: LIVE_REGIME_SCHEMA,
    detectorSchema: MARKET_REGIME_SCHEMA,
    dataStatus: 'live',
    regime: detected.regime,
    status: detected.status,
    detectable: detected.detectable,
    metrics: detected.metrics,
    // Every answer can be checked: which source, observed when, how many points.
    sources,
    skipped,
    maxAgeHrs,
    evidenceRows: detected.evidenceRows,
    staleRowsExcluded: detected.staleRowsExcluded,
    requiresStrategyReview: detected.requiresStrategyReview === true,
    strategyChangesAutomatically: false,
    executionAuthorized: false,
    detectedAt: detectNow
  };
}

/**
 * The chat-facing summary. Returns i18n keys + params only — the panel never
 * builds a sentence from raw numbers, and an unavailable regime says so.
 */
export function describeLiveRegime(result) {
  if (!result || result.dataStatus !== 'live') {
    return {
      available: false,
      i18nKey: 'intentAI.regime.unavailable',
      params: {},
      sources: []
    };
  }
  const labels = Array.isArray(result.regime) ? result.regime : [];
  return {
    available: labels.length > 0,
    i18nKey: labels.length ? 'intentAI.regime.summary' : 'intentAI.regime.unavailable',
    params: {
      labels: labels.join(', '),
      trend: result.metrics?.trendPct ?? null,
      volatility: result.metrics?.volatilityPct ?? null,
      sources: result.sources.map((s) => s.source).join(', '),
      observedAt: result.sources[0]?.observedAt ?? null
    },
    sources: result.sources
  };
}
