/**
 * FBT INTENT AI — PHASE 85: MULTI-REGION EDGE, MADE PRODUCT-LEVEL
 * ---------------------------------------------------------------------------
 * Phase 33 proved we *can* fail over. Phase 85 makes it something the user can
 * see: which region is serving them, how fast it actually is for them, and
 * what happened when it moved.
 *
 *   · latency is MEASURED per request, not configured. An unmeasured region
 *     has unknown latency — never a default number.
 *   · failover is announced, with the reason, and it is recorded so the panel
 *     can say "we moved you, here is why"
 *   · a region that fails its health check is drained; the last region
 *     standing is used honestly, and zero healthy regions is honest-unavailable
 *   · the numbers shown are percentiles from real samples, and a sample set
 *     too small to speak for itself says so
 */

import { classifyFailure } from './failureModes.js';

export const EDGE_SCHEMA = 'fbt.regional-edge.v1';
export const REGIONS = Object.freeze(['eu-central', 'us-east', 'ap-south', 'me-central']);
export const MIN_LATENCY_SAMPLES = 5;
export const SLOW_P95_MS = 1200;
export const SAMPLE_MAX_AGE_MS = 5 * 60 * 1000;

const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean'
  ? null
  : (Number.isFinite(Number(v)) ? Number(v) : null));

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

/** Turn raw request timings into something honest to display. */
export function measureRegion({ region = null, samples = [], now = Date.now() } = {}) {
  const fresh = (Array.isArray(samples) ? samples : [])
    .filter((s) => num(s?.latencyMs) !== null && num(s?.at) !== null && now - num(s.at) <= SAMPLE_MAX_AGE_MS);
  if (!REGIONS.includes(region)) {
    return { ok: false, region, latencyKnown: false, error: classifyFailure('MISSING_DATA', { detail: 'UNKNOWN_REGION' }) };
  }
  if (fresh.length < MIN_LATENCY_SAMPLES) {
    // Too little data is "unknown", not "fast".
    return {
      ok: true, schema: EDGE_SCHEMA, region, latencyKnown: false,
      sampleSize: fresh.length, p50Ms: null, p95Ms: null, errorRate: null,
      i18nKey: 'intentAI.edge.latencyUnknown'
    };
  }
  const values = fresh.map((s) => num(s.latencyMs)).sort((a, b) => a - b);
  const failures = fresh.filter((s) => s.ok === false).length;
  const p95 = percentile(values, 95);
  return {
    ok: true,
    schema: EDGE_SCHEMA,
    region,
    latencyKnown: true,
    sampleSize: fresh.length,
    p50Ms: percentile(values, 50),
    p95Ms: p95,
    errorRate: Math.round((failures / fresh.length) * 100) / 100,
    slow: p95 > SLOW_P95_MS,
    observedAt: now,
    i18nKey: p95 > SLOW_P95_MS ? 'intentAI.edge.slow' : 'intentAI.edge.healthy',
    i18nParams: { region, ms: p95 }
  };
}

/** Which region should serve this user right now? */
export function selectRegion({ measurements = [], preferred = null, now = Date.now() } = {}) {
  const rows = (Array.isArray(measurements) ? measurements : []).filter((m) => m?.ok === true && REGIONS.includes(m.region));
  const healthy = rows.filter((m) => m.latencyKnown === true && (num(m.errorRate) ?? 1) < 0.2 && m.drained !== true);
  if (!healthy.length) {
    return {
      ok: false, region: null, degraded: true,
      i18nKey: 'intentAI.edge.noRegion',
      error: classifyFailure('PROVIDER_ERROR', { detail: 'NO_HEALTHY_REGION' })
    };
  }
  const ranked = [...healthy].sort((a, b) => num(a.p95Ms) - num(b.p95Ms));
  const chosen = healthy.find((m) => m.region === preferred && m.slow !== true) || ranked[0];
  return {
    ok: true,
    schema: EDGE_SCHEMA,
    region: chosen.region,
    p95Ms: num(chosen.p95Ms),
    alternatives: ranked.filter((m) => m.region !== chosen.region).map((m) => m.region),
    switchedFromPreferred: Boolean(preferred && chosen.region !== preferred),
    i18nKey: 'intentAI.edge.serving',
    i18nParams: { region: chosen.region, ms: num(chosen.p95Ms) },
    at: now
  };
}

/** Move the user, and tell them. A silent failover is a support ticket. */
export function recordFailover({ from = null, to = null, reason = null, measurements = [], now = Date.now() } = {}) {
  if (!REGIONS.includes(to)) {
    return { ok: false, announced: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_TARGET_REGION' }) };
  }
  const target = (Array.isArray(measurements) ? measurements : []).find((m) => m?.region === to);
  if (target && target.latencyKnown === true && (num(target.errorRate) ?? 0) >= 0.2) {
    return { ok: false, announced: false, reason: 'TARGET_UNHEALTHY', error: classifyFailure('PROVIDER_ERROR', { detail: 'TARGET_UNHEALTHY' }) };
  }
  return {
    ok: true,
    schema: EDGE_SCHEMA,
    event: Object.freeze({ from: from ?? null, to, reason: typeof reason === 'string' ? reason.slice(0, 64) : 'UNKNOWN', at: now }),
    // The user is told, in their own language, that they were moved.
    announced: true,
    userVisible: true,
    i18nKey: 'intentAI.edge.failover',
    i18nParams: { from: from ?? '—', to }
  };
}

/** Take a region out of rotation without pretending it is fine. */
export function drainRegion(measurement, { reason = null, now = Date.now() } = {}) {
  if (!measurement?.region) return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_REGION' }) };
  return {
    ok: true,
    measurement: { ...measurement, drained: true, drainedAt: now, drainReason: reason ?? 'UNKNOWN' },
    i18nKey: 'intentAI.edge.drained',
    i18nParams: { region: measurement.region }
  };
}

/** Nothing may be presented as a latency figure unless it was measured. */
export function assertEdgeHonest(view) {
  const reasons = [];
  if (!view || view.schema !== EDGE_SCHEMA) reasons.push('NOT_AN_EDGE_VIEW');
  if (view?.latencyKnown === false && (num(view?.p95Ms) !== null || num(view?.p50Ms) !== null)) reasons.push('LATENCY_INVENTED');
  if (view?.latencyKnown === true && (num(view?.sampleSize) ?? 0) < MIN_LATENCY_SAMPLES) reasons.push('UNDER_SAMPLED_LATENCY');
  if (view?.region && !REGIONS.includes(view.region)) reasons.push('UNKNOWN_REGION');
  const unique = [...new Set(reasons)];
  return unique.length
    ? { ok: false, reasons: unique, error: classifyFailure('MISSING_DATA', { detail: unique[0] }) }
    : { ok: true };
}
