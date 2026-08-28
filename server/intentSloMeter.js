/**
 * FBT INTENT AI — SLO meter.
 *
 * The previous `sloMeasurement()` returned uptime 0.999 / p99 250ms as literal
 * constants. Those numbers were never measured; they were typed. An SLO that
 * is typed rather than measured is worse than no SLO, because it looks like a
 * measurement on every dashboard that renders it.
 *
 * This module records the latency and outcome of the requests the process
 * actually served, in a bounded ring buffer, and computes uptime and latency
 * percentiles from those samples. With zero samples it reports
 * `measured: false` — never a default.
 *
 * Only aggregate timing data is kept: method, route template, status code,
 * duration. No bodies, no headers, no identifiers.
 */

const MAX_SAMPLES = 5_000;
const DEFAULT_WINDOW_MS = 24 * 3600_000;

const samples = []; /* { at, ms, ok } — append-only ring */
let startedAt = Date.now();

/** Record one observation. Exposed for tests and for non-HTTP callers. */
export function recordSloSample({ durationMs, ok, at = Date.now() } = {}) {
  const ms = Number(durationMs);
  if (!Number.isFinite(ms) || ms < 0) return;
  samples.push({ at, ms, ok: ok !== false });
  if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
}

/** Reset — tests only. */
export function resetSloMeter(now = Date.now()) {
  samples.length = 0;
  startedAt = now;
}

/**
 * Express middleware. A response counts as available unless it is a 5xx,
 * which is the standard availability definition for an HTTP SLO: client
 * errors are the caller's, server errors are ours.
 */
export function sloMeterMiddleware() {
  return function sloMeter(req, res, next) {
    const started = Date.now();
    res.on('finish', () => {
      recordSloSample({ durationMs: Date.now() - started, ok: res.statusCode < 500 });
    });
    next();
  };
}

function percentile(sortedAsc, p) {
  if (sortedAsc.length === 0) return null;
  const index = Math.min(sortedAsc.length - 1, Math.ceil((p / 100) * sortedAsc.length) - 1);
  return sortedAsc[Math.max(0, index)];
}

/**
 * Compute the SLO snapshot over the trailing window.
 * `measured` is true only when there is at least `minSamples` of real traffic.
 */
export function sloSnapshot({ now = Date.now(), windowMs = DEFAULT_WINDOW_MS, minSamples = 20 } = {}) {
  const cutoff = now - windowMs;
  const window = samples.filter((s) => s.at >= cutoff);
  const total = window.length;
  const available = window.filter((s) => s.ok).length;
  const latencies = window.filter((s) => s.ok).map((s) => s.ms).sort((a, b) => a - b);

  const measured = total >= minSamples;

  return {
    schema: 'fbt.slo-measurement.v1',
    defined: true,
    measured,
    window: `${Math.round(windowMs / 3600_000)}h`,
    windowMs,
    meterStartedAt: startedAt,
    samples: total,
    minSamples,
    uptime: total > 0 ? Number((available / total).toFixed(4)) : null,
    errorRate: total > 0 ? Number(((total - available) / total).toFixed(4)) : null,
    p50LatencyMs: percentile(latencies, 50),
    p95LatencyMs: percentile(latencies, 95),
    p99LatencyMs: percentile(latencies, 99),
    reason: measured ? null : 'INSUFFICIENT_SAMPLES'
  };
}
