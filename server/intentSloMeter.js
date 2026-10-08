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

/*
 * ─── THE STALL WATCH: THE BILL THIS METER COULD NOT SEE ────────────────────
 * `res.on('finish')` below only fires when a response is SENT. A request that
 * never finishes therefore recorded nothing at all: for weeks this meter
 * reported a healthy p99 while a mount that never called `next()` was holding
 * requests open until the function's maximum duration — and on Vercel a held
 * request is BILLED Active CPU for every second it is held. The bug was
 * invisible in exactly the instrument built to see it.
 *
 * So a request is watched while it runs: crossing `SLO_STALL_MS` (default 10 s,
 * 0 disables) records one stall sample and logs ONE line naming the method and
 * the path template. The path is logged, never a query string or a header, and
 * the same route is logged at most once a minute — a stall is a fact about a
 * route, and a log flood is its own outage.
 *
 * This is detection, not enforcement: nothing here aborts a request. A route
 * that legitimately runs long (the daily cron, a probe, an SSE stream) is
 * free to do so; a route that STALLS now says so in the deployment logs and in
 * `/api/intents/v1/slo-status`.
 */
const STALL_MS = Number(process.env.SLO_STALL_MS ?? 10_000);
const MAX_STALLS = 1_000;
const STALL_LOG_COOLDOWN_MS = 60_000;

const samples = []; /* { at, ms, ok } — append-only ring */
const stalls = []; /* { at, ms, route } — ring, one row per stalled request */
const stallLogAt = new Map(); /* route → last logged at */
let startedAt = Date.now();

/** Record one observation. Exposed for tests and for non-HTTP callers. */
export function recordSloSample({ durationMs, ok, at = Date.now() } = {}) {
  const ms = Number(durationMs);
  if (!Number.isFinite(ms) || ms < 0) return;
  samples.push({ at, ms, ok: ok !== false });
  if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
}

/** Record a request that crossed the stall threshold. Idempotent per request. */
export function recordSloStall({ ms, route, at = Date.now() } = {}) {
  const durationMs = Number(ms);
  if (!Number.isFinite(durationMs) || durationMs < 0) return;
  stalls.push({ at, ms: durationMs, route: String(route || 'unknown').slice(0, 120) });
  if (stalls.length > MAX_STALLS) stalls.splice(0, stalls.length - MAX_STALLS);
  const key = String(route || 'unknown').slice(0, 120);
  const last = stallLogAt.get(key) || 0;
  if (at - last >= STALL_LOG_COOLDOWN_MS) {
    stallLogAt.set(key, at);
    if (stallLogAt.size > 200) stallLogAt.clear();
    const held = durationMs < 10_000 ? `${Math.round(durationMs)}ms` : `${Math.round(durationMs / 1000)}s`;
    console.warn(`[slo] stalled request: ${key} has been running ${held} — if this does not finish it is BILLED CPU (set SLO_STALL_MS=0 to mute)`);
  }
}

/** Reset — tests only. */
export function resetSloMeter(now = Date.now()) {
  samples.length = 0;
  stalls.length = 0;
  stallLogAt.clear();
  startedAt = now;
}

/** The stalled requests in the trailing window, newest last. */
export function sloStallSnapshot({ now = Date.now(), windowMs = DEFAULT_WINDOW_MS } = {}) {
  const cutoff = now - windowMs;
  const window = stalls.filter((s) => s.at >= cutoff);
  const byRoute = new Map();
  for (const s of window) byRoute.set(s.route, (byRoute.get(s.route) || 0) + 1);
  return {
    schema: 'fbt.slo-stalls.v1',
    windowMs,
    thresholdMs: STALL_MS,
    stalled: window.length,
    slowestMs: window.reduce((max, s) => Math.max(max, s.ms), 0) || null,
    routes: [...byRoute.entries()]
      .map(([route, count]) => ({ route, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20)
  };
}

/**
 * Express middleware. A response counts as available unless it is a 5xx,
 * which is the standard availability definition for an HTTP SLO: client
 * errors are the caller's, server errors are ours.
 */
export function sloMeterMiddleware() {
  return function sloMeter(req, res, next) {
    const started = Date.now();
    /* One timer per request, cleared the moment the response finishes: the
       cost is a few microseconds, and what it buys is that a request nobody
       ever answers can no longer be invisible (see the stall-watch note). */
    let watch = null;
    if (STALL_MS > 0) {
      const route = `${req.method} ${req.path}`;
      watch = setTimeout(() => {
        /* An SSE stream is SUPPOSED to be held open; it is not a stall. */
        if (route.endsWith('/stream')) return;
        recordSloStall({ ms: Date.now() - started, route });
      }, STALL_MS);
      watch.unref?.();
    }
    res.on('finish', () => {
      if (watch) clearTimeout(watch);
      recordSloSample({ durationMs: Date.now() - started, ok: res.statusCode < 500 });
    });
    res.on('close', () => {
      if (watch) clearTimeout(watch);
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
  const stallWindow = stalls.filter((s) => s.at >= cutoff);

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
    /* Requests still running past the stall threshold: they are NOT in the
       latency percentiles above (nothing finished), and on a serverless host
       each one is billed CPU for as long as it is held. */
    stalledRequests: stallWindow.length,
    stallThresholdMs: STALL_MS || null,
    slowestStallMs: stallWindow.reduce((max, s) => Math.max(max, s.ms), 0) || null,
    reason: measured ? null : 'INSUFFICIENT_SAMPLES'
  };
}
