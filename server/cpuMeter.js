/**
 * FLUID ACTIVE CPU METER — who is spending the free tier, by route.
 * ============================================================================
 *
 * ─── WHY THIS EXISTS (2026-11-10) ───────────────────────────────────────────
 * The Hobby team was soft-blocked:
 *
 *   reason: FAIR_USE_LIMITS_EXCEEDED · blockedDueToOverageType: fluidCpuDuration
 *
 * i.e. 4h of Fluid Active CPU in a rolling 30-day window, at 103%. The 30-day
 * list of upstream hosts said WHICH SERVICES the app talks to (Solana RPCs,
 * CoinGecko, the AI providers) but nothing about which of our own 389 routes
 * spends the CPU — and Vercel's own dashboard shows the total, not the split
 * when the project is paused and observability is unavailable.
 *
 * So the next window is measured from inside. `process.cpuUsage()` is a delta
 * reading of THIS process's user+system CPU (microseconds), which is the same
 * quantity Vercel bills as Active CPU — not wall-clock time, so an `await`
 * that waits on an upstream node costs nothing here, exactly as on the bill.
 *
 * ─── WHAT IT DELIBERATELY DOES NOT DO ───────────────────────────────────────
 *   · No network, no storage on the hot path. Readings live in one Map per
 *     instance; the report is a GET an operator makes when they want it.
 *   · No throttling. A meter that changes the thing it measures is useless for
 *     the first question ("what did we spend?") and dangerous for the second.
 *   · No per-user identity. The key is the route, so nothing personal is kept.
 *
 * ─── HOW TO READ IT ─────────────────────────────────────────────────────────
 *   curl -s -H "x-cron-secret: $CRON_SECRET" https://<host>/api/usage/cpu
 *
 * One honest limitation: `process.cpuUsage()` measures the PROCESS. Two
 * requests in flight at once each see the other's CPU in their delta, so on a
 * busy instance the per-route split is approximate and the total can exceed
 * the real figure. It converges for exactly the traffic that matters here — a
 * free tier is a quiet tier — and the `calls`/`avgCpuMs` columns make an
 * obviously wrong row visible instead of silently trusting it.
 *
 * `share` is the fraction of measured CPU that route took ON THIS INSTANCE.
 * A warm instance is the only place the numbers mean anything: a cold start
 * bills module evaluation before any handler runs, and that cost is recorded
 * separately as `coldStart` (see `markColdStart`). Both are reported, because
 * the two have different fixes — a hot route wants a cache, a cold instance
 * wants a smaller import graph.
 */

/** Per-instance accumulator. Keyed by `METHOD /path` with ids collapsed. */
const routes = new Map();
/** When this instance started measuring (= module evaluation done). */
const bootedAt = Date.now();
/** CPU spent getting here: filled by markColdStart() from api/index.js. */
let coldStartMs = null;
/** Lifetime totals, so a report can say how much it actually saw. */
let totalCpuMs = 0;
let totalCalls = 0;

/**
 * Collapse the parts of a path that make every request a new row.
 *
 * Addresses, hashes and ids (anything hex, or 20+ alphanumeric characters) and
 * numeric segments become `:id` / `:n`, so `/api/missions/ab12…cd90/x` is one
 * row for the whole family. Short readable slugs (`/api/coin/bitcoin`) are left
 * alone on purpose: a report a human cannot read is a report nobody checks, and
 * the table is bounded by the routes one INSTANCE serves — and a serverless
 * instance is short-lived, so it cannot grow without limit.
 */
export function routeKey(req) {
  const path = String(req.path || req.url || '/')
    .replace(/\/[0-9a-f]{16,}/gi, '/:id')
    .replace(/\/[A-Za-z0-9]{20,}/g, '/:id')
    .replace(/\/\d+/g, '/:n')
    .replace(/\/+$/, '') || '/';
  return `${String(req.method || 'GET').toUpperCase()} ${path}`;
}

function bump(key, cpuMs, wallMs, status) {
  const row = routes.get(key) || { cpuMs: 0, calls: 0, maxCpuMs: 0, wallMs: 0, errors: 0 };
  row.cpuMs += cpuMs;
  row.calls += 1;
  row.wallMs += wallMs;
  if (cpuMs > row.maxCpuMs) row.maxCpuMs = cpuMs;
  if (status >= 500) row.errors += 1;
  routes.set(key, row);
  totalCpuMs += cpuMs;
  totalCalls += 1;
}

/**
 * Express middleware. Runs before every route, so it also catches the ones
 * that answer 404 and the ones a limiter rejects with 429 — both are CPU the
 * app paid for.
 */
export function cpuMeter(req, res, next) {
  /* Read the clock once per request; `process.cpuUsage(prev)` subtracts. */
  const before = typeof process.cpuUsage === 'function' ? process.cpuUsage() : null;
  const wall = Date.now();
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    if (!before) return;
    try {
      const delta = process.cpuUsage(before);
      bump(routeKey(req), (delta.user + delta.system) / 1000, Date.now() - wall, res.statusCode || 0);
    } catch {
      /* A meter must never be able to fail a request. */
    }
  };
  res.on('finish', finish);
  res.on('close', finish);
  next();
}

/**
 * Record the CPU a cold start already spent before the first request.
 *
 * Called once, by `api/index.js`, immediately after the app module graph has
 * finished evaluating. With no argument it reads the baseline that
 * `server/coldStart.js` took as the FIRST import of the function — module
 * evaluation order in ESM is declaration order, so that baseline is the
 * earliest point a module can observe, and the delta is the price of the whole
 * import graph (Node bootstrap + every route module). A negative or absurd
 * number is dropped rather than published — a meter that reports fiction is
 * worse than no meter.
 */
export function markColdStart(ms) {
  let value = Number(ms);
  if (!Number.isFinite(value)) {
    const baseline = globalThis.__fbtColdStartCpu;
    if (!baseline || typeof process.cpuUsage !== 'function') return null;
    const delta = process.cpuUsage(baseline);
    value = (delta.user + delta.system) / 1000;
  }
  if (Number.isFinite(value) && value >= 0 && value < 60_000 && coldStartMs == null) {
    coldStartMs = Math.round(value * 10) / 10;
    /* Same unit as the report, so a log line answers «how expensive is a fresh
       instance» without opening the JSON. */
    console.log(`[cpu] cold start module graph: ${coldStartMs} ms of CPU`);
    return coldStartMs;
  }
  return coldStartMs;
}

/** Reset the per-instance table (ops convenience; never called by a route). */
export function resetCpuMeter() {
  routes.clear();
  totalCpuMs = 0;
  totalCalls = 0;
}

/**
 * The report.
 *
 * `secondsPerDay` is the unit the free tier is measured in (4 hours per 30
 * days ≈ 8 minutes of CPU a day), so the last line of the payload answers the
 * only question that matters: «at this rate, are we over?».
 */
export function cpuSnapshot() {
  const rows = [...routes.entries()]
    .map(([route, row]) => ({
      route,
      calls: row.calls,
      cpuMs: Math.round(row.cpuMs * 10) / 10,
      avgCpuMs: row.calls ? Math.round((row.cpuMs / row.calls) * 100) / 100 : 0,
      maxCpuMs: Math.round(row.maxCpuMs * 10) / 10,
      avgWallMs: row.calls ? Math.round(row.wallMs / row.calls) : 0,
      errors: row.errors,
      share: totalCpuMs > 0 ? Math.round((row.cpuMs / totalCpuMs) * 1000) / 10 : 0
    }))
    .sort((a, b) => b.cpuMs - a.cpuMs);

  const upSec = Math.max(1, Math.round((Date.now() - bootedAt) / 1000));
  const cpuSec = totalCpuMs / 1000;
  /* Extrapolation, stated as such: an instance that lived 4 minutes is not a
     day. It is here so a 5-minute dev session still says «this route would be
     ~2h/day if it ran like this all day», which is how the 103% happened. */
  const perDaySec = (cpuSec / upSec) * 86_400;

  return {
    ok: true,
    scope: 'this-instance-only',
    note: 'Fluid Active CPU, measured with process.cpuUsage deltas. I/O wait is not counted, exactly as on the bill. Per-instance: several warm instances each keep their own table.',
    bootedAt: new Date(bootedAt).toISOString(),
    uptimeSec: upSec,
    coldStartCpuMs: coldStartMs,
    totals: {
      calls: totalCalls,
      cpuMs: Math.round(totalCpuMs * 10) / 10,
      cpuSec: Math.round(cpuSec * 100) / 100,
      avgCpuMs: totalCalls ? Math.round((totalCpuMs / totalCalls) * 100) / 100 : 0
    },
    budget: {
      includedHoursPer30Days: 4,
      includedSecPerDay: Math.round((4 * 3600) / 30),
      extrapolatedSecPerDayIfConstant: Math.round(perDaySec),
      verdict: perDaySec > (4 * 3600) / 30 ? 'OVER_BUDGET_AT_THIS_RATE' : 'WITHIN_BUDGET_AT_THIS_RATE'
    },
    routes: rows.slice(0, 40)
  };
}
