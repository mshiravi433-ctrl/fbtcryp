/**
 * KRONOS FORECAST — the Node side of the token-chart projection.
 * ================================================================
 *
 * The model itself runs in a durable Python worker (forecast/worker.py,
 * Kronos — the open-source K-line foundation model). This module is the
 * client for that worker plus the two things a public API must have:
 *
 *   1. A CIRCUIT BREAKER + timeout, so a dead or slow worker degrades in
 *      milliseconds instead of hanging every chart open behind it.
 *   2. An honest BASELINE fallback: when the worker cannot answer, the
 *      endpoint still returns a projection — computed from the window's own
 *      drift and volatility, deterministic, and LABELLED `provider: baseline`
 *      with the worker's error beside it. The browser prints that label. A
 *      forecast the reader can see the provenance of beats a 503 they cannot,
 *      and neither is ever dressed up as the model it is not.
 *
 * Cache: one entry per series signature (last two closes + window length +
 * horizon). A projection only changes when a NEW candle prints or the window
 * moves — so every reader of BTC today pays for one worker call, not one per
 * page view. In-flight requests for the same key share one promise.
 *
 * Contract (matches forecast/worker.py exactly):
 *   POST {workerUrl}/forecast  {candles:[{t(ms),o,h,l,c,v}], predLen, T, topP, samples}
 *   → 200 {ok, provider:"kronos", model, generatedAt, candles:[{t,o,h,l,c,v}]}
 *   → 4xx/503 {ok:false, error}  → caller falls back to baseline.
 */

/** Window bounds: the model supports 512 bars. CoinGecko returns 48 bars
 *  for 1D and about 42 for 7D: both are valid windows, not empty feeds. Keep
 *  this floor aligned with forecast/worker.py and the browser. */
import { createHash } from 'node:crypto';

export const FORECAST_MIN_CANDLES = 40;
export const FORECAST_MAX_CANDLES = 512;
export const FORECAST_PREDLEN_MAX = 120;
export const FORECAST_SCHEMA = 'fbt.forecast.v2';

const DEFAULTS = {
  workerUrl: () => normalizeWorkerUrl(process.env.KRONOS_WORKER_URL
    || (process.env.VERCEL ? '' : 'http://127.0.0.1:8765')),
  workerToken: () => process.env.KRONOS_WORKER_TOKEN || '',
  timeoutMs: () => Math.min(45000, Math.max(1000, Number(process.env.KRONOS_FORECAST_TIMEOUT_MS) || 25000)),
  failureThreshold: () => Math.max(1, Number(process.env.KRONOS_FORECAST_BREAKER) || 3),
  breakerCooldownMs: () => Math.max(1000, Number(process.env.KRONOS_FORECAST_BREAKER_COOLDOWN_MS) || 30000),
  cacheTtlMs: () => Math.max(1000, Number(process.env.KRONOS_FORECAST_CACHE_TTL_MS) || 300000)
};

/** A worker origin/prefix, never a credential-bearing or browser-supplied URL. */
export function normalizeWorkerUrl(value) {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return '';
    if (process.env.VERCEL && url.protocol !== 'https:') return '';
    return url.toString().replace(/\/+$/, '');
  } catch { return ''; }
}

/** Never expose an upstream URL, token, stack or response body to a reader. */
export function workerErrorCode(error) {
  if (error?.code && /^[A-Z0-9_]+$/.test(error.code)) return error.code;
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') return 'WORKER_TIMEOUT';
  if (error?.workerStatus === 401 || error?.workerStatus === 403) return 'WORKER_AUTH_FAILED';
  if (error?.workerStatus === 429) return 'WORKER_BUSY';
  if (error?.workerStatus === 503) return 'WORKER_NOT_READY';
  if (String(error?.message || '').startsWith('WORKER_BAD_')) return 'WORKER_INVALID_RESPONSE';
  return 'WORKER_UNAVAILABLE';
}

/**
 * Coerce an arbitrary payload into the candle shape the model eats.
 * Rejects (never repairs): a non-array, non-finite numbers, inverted bars,
 * non-positive prices. Sorting/deduping IS allowed — a chart feed that hands
 * us bars out of order is still a real series, just an unordered one.
 *
 * @returns {{ok: true, candles: Array}} | {{ok: false, error: string}}
 */
export function normalizeCandles(raw) {
  if (!Array.isArray(raw)) return { ok: false, error: 'CANDLES_NOT_AN_ARRAY' };
  if (raw.length > 4096) return { ok: false, error: 'CANDLES_TOO_MANY' };
  const seen = new Map();
  for (let i = 0; i < raw.length; i += 1) {
    const row = raw[i];
    if (!row || typeof row !== 'object') return { ok: false, error: `CANDLE_${i}_NOT_AN_OBJECT` };
    const t = Number(row.t ?? row.time);
    const o = Number(row.o ?? row.open);
    const h = Number(row.h ?? row.high);
    const l = Number(row.l ?? row.low);
    const c = Number(row.c ?? row.close);
    const vRaw = row.v ?? row.volume;
    const v = vRaw == null ? 0 : Number(vRaw);
    if (!Number.isFinite(t) || !Number.isSafeInteger(t) || t <= 0 || t > 8_640_000_000_000_000) return { ok: false, error: `CANDLE_${i}_BAD_TIME` };
    if (![o, h, l, c].every((n) => Number.isFinite(n) && n > 0)) {
      return { ok: false, error: `CANDLE_${i}_BAD_PRICE` };
    }
    if (h < l || h < Math.max(o, c) || l > Math.min(o, c)) {
      return { ok: false, error: `CANDLE_${i}_INCONSISTENT_OHLC` };
    }
    if (!Number.isFinite(v) || v < 0) return { ok: false, error: `CANDLE_${i}_BAD_VOLUME` };
    seen.set(t, { t, o, h, l, c, v });
  }
  const candles = [...seen.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c);
  if (!candles.length) return { ok: false, error: 'CANDLES_EMPTY' };
  if (candles.length > FORECAST_MAX_CANDLES) {
    candles.splice(0, candles.length - FORECAST_MAX_CANDLES);
  }
  return { ok: true, candles };
}

/**
 * Horizon for one request: an explicit `predLen` is clamped, an absent one
 * is derived from the window (≈1/8 of it, 12–48 bars) so a 1-day view gets a
 * short cone and a 30-day view gets a longer one — without the client having
 * to know the model's limits.
 */
export function inferPredLen(candles, requested) {
  const n = Number(requested);
  if (Number.isFinite(n) && Number.isInteger(n) && n > 0) {
    return Math.min(FORECAST_PREDLEN_MAX, n);
  }
  const derived = Math.round((candles?.length ?? 64) / 8);
  return Math.max(12, Math.min(48, derived));
}

/** Median bar spacing in ms — the projection continues at the SAME rhythm. */
export function intervalMsOf(candles) {
  const src = Array.isArray(candles) ? candles : [];
  if (src.length < 2) return 0;
  const deltas = [];
  for (let i = 1; i < src.length; i += 1) {
    const d = src[i].t - src[i - 1].t;
    if (Number.isFinite(d) && d > 0) deltas.push(d);
  }
  if (!deltas.length) return 0;
  deltas.sort((a, b) => a - b);
  return deltas[Math.floor(deltas.length / 2)];
}

/** Deterministic 32-bit string hash (FNV-1a) — seeds the baseline walk. */
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * BASELINE — drift + volatility continuation, labelled as itself.
 *
 * Not a model, not advice: the last window's log-return mean (shrunk by half,
 * because the past mean is a weak prior) and standard deviation drive a
 * seeded random walk. Deterministic per series, so two readers of the same
 * chart see the same projection and a test can pin it. `provider: baseline`
 * rides in every response — the UI must say so out loud.
 */
export function baselineForecast(candles, predLen) {
  const closes = candles.map((c) => c.c);
  const rets = [];
  for (let i = 1; i < closes.length; i += 1) {
    if (closes[i - 1] > 0) rets.push(closes[i] / closes[i - 1] - 1);
  }
  const window = rets.slice(-Math.min(120, rets.length));
  const mean = window.length ? window.reduce((a, b) => a + b, 0) / window.length : 0;
  const variance = window.length > 1
    ? window.reduce((a, r) => a + (r - mean) ** 2, 0) / (window.length - 1)
    : 0;
  const sigma = Math.max(1e-6, Math.sqrt(variance));
  const drift = mean * 0.5;
  const step = intervalMsOf(candles) || 60000;
  const last = candles[candles.length - 1];
  const seedBase = fnv1a(`${last.t}:${last.c.toFixed(10)}:${candles.length}:${predLen}`);
  let seed = seedBase;
  const rand = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed / 0x100000000 - 0.5;
  };
  const recentVol = candles.slice(-20).reduce((a, c) => a + (c.v || 0), 0) / Math.min(20, candles.length);
  let price = last.c;
  const out = [];
  for (let i = 1; i <= predLen; i += 1) {
    const o = price;
    const c = Math.max(1e-12, price * (1 + drift + sigma * rand() * 4));
    const spread = Math.abs(c - o) + price * sigma * 0.7;
    const h = Math.max(o, c) + spread * 0.5;
    const l = Math.max(1e-12, Math.min(o, c) - spread * 0.5);
    out.push({ t: last.t + step * i, o, h, l, c, v: recentVol });
    price = c;
  }
  return out;
}

/** Full-window fingerprint: two tokens with the same last close are NOT the
 *  same series. Include every OHLCV field, the horizon and the schema. */
export function seriesKey(candles, predLen) {
  const hash = createHash('sha256');
  hash.update(`${FORECAST_SCHEMA}|${candles.length}|${predLen}|`);
  for (const c of candles) hash.update(`${c.t},${c.o},${c.h},${c.l},${c.c},${c.v};`);
  return hash.digest('hex');
}

/** Validate the entire model contract before anything reaches a price axis. */
export function validateProjection(rows, input, predLen) {
  if (!Array.isArray(rows) || rows.length !== predLen) return { ok: false, error: 'WORKER_BAD_LENGTH' };
  const norm = normalizeCandles(rows);
  if (!norm.ok || norm.candles.length !== predLen) return { ok: false, error: 'WORKER_BAD_CANDLES' };
  const step = intervalMsOf(input);
  const anchor = input[input.length - 1].t;
  if (!step || norm.candles.some((c, i) => c.t !== anchor + step * (i + 1))) {
    return { ok: false, error: 'WORKER_BAD_TIMESTAMPS' };
  }
  return norm;
}

async function callWorker(cfg, candles, predLen) {
  const origin = cfg.workerUrl();
  if (!origin) {
    const err = new Error('Worker is not configured');
    err.code = 'WORKER_NOT_CONFIGURED';
    throw err;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs());
  const started = Date.now();
  try {
    const headers = { 'content-type': 'application/json' };
    const token = cfg.workerToken();
    if (token) headers['x-kronos-token'] = token;
    const res = await fetch(`${origin}/forecast`, {
      method: 'POST', headers, signal: ctrl.signal,
      body: JSON.stringify({ candles, predLen, T: 1.0, topP: 0.9, samples: 1 })
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.ok) {
      const err = new Error(`Worker HTTP ${res.status}`);
      err.workerStatus = res.status;
      throw err;
    }
    // A test double must never be presented as the production foundation model.
    if (body.provider !== 'kronos') throw new Error('WORKER_BAD_PROVIDER');
    const norm = validateProjection(body.candles, candles, predLen);
    if (!norm.ok) throw new Error(norm.error);
    const generatedAt = Number(body.generatedAt);
    if (!Number.isFinite(generatedAt) || generatedAt <= 0 || generatedAt > Date.now() + 60_000) {
      throw new Error('WORKER_BAD_TIMESTAMP');
    }
    return {
      provider: 'kronos', model: String(body.model || 'Kronos').slice(0, 120),
      generatedAt, candles: norm.candles, latencyMs: Date.now() - started
    };
  } finally { clearTimeout(timer); }
}

/**
 * Create an isolated service instance (tests pass their own config; the app
 * uses the singleton below).
 *
 * @param {object} [overrides] config overrides: workerUrl/workerToken as
 *   strings or functions, timeoutMs, failureThreshold, breakerCooldownMs,
 *   cacheTtlMs, fetchImpl (tests), now (tests).
 */
export function createForecastService(overrides = {}) {
  const cfg = {
    workerUrl: overrides.workerUrl ?? DEFAULTS.workerUrl(),
    workerToken: overrides.workerToken ?? DEFAULTS.workerToken(),
    timeoutMs: overrides.timeoutMs ?? DEFAULTS.timeoutMs(),
    failureThreshold: overrides.failureThreshold ?? DEFAULTS.failureThreshold(),
    breakerCooldownMs: overrides.breakerCooldownMs ?? DEFAULTS.breakerCooldownMs(),
    cacheTtlMs: overrides.cacheTtlMs ?? DEFAULTS.cacheTtlMs(),
    now: overrides.now ?? Date.now
  };
  /* Every knob is read through a function at call time — env-derived
     defaults can then be swapped per test without re-importing the module,
     and a numeric override stays a plain number until the moment it is read. */
  for (const key of ['workerUrl', 'workerToken', 'timeoutMs', 'failureThreshold', 'breakerCooldownMs', 'cacheTtlMs']) {
    if (typeof cfg[key] !== 'function') {
      const value = cfg[key];
      cfg[key] = () => value;
    }
  }

  const cache = new Map();   // key → { value, expiresAt }
  const inflight = new Map(); // key → Promise
  const state = { failures: 0, openUntil: 0, workerCalls: 0, cacheHits: 0, baselines: 0, lastProvider: null };

  const breakerOpen = (now) => state.openUntil > now;

  async function produce({ candles, predLen, refresh = false }) {
    if (!Array.isArray(candles) || candles.length < FORECAST_MIN_CANDLES || !Number.isInteger(predLen) || predLen < 1 || predLen > FORECAST_PREDLEN_MAX) {
      const err = new Error('FORECAST_BAD_ARGS');
      err.code = 'FORECAST_BAD_ARGS';
      throw err;
    }
    const now = cfg.now();
    const key = seriesKey(candles, predLen);
    const hit = cache.get(key);
    // Refresh may retry a fallback, never duplicate an expensive model call.
    if (hit && hit.expiresAt > now && (!refresh || hit.value.provider === 'kronos')) {
      state.cacheHits += 1;
      return { ...hit.value, cached: true };
    }
    const pending = inflight.get(key);
    if (pending) return pending;

    const work = (async () => {
      const base = {
        ok: true,
        schema: FORECAST_SCHEMA,
        generatedAt: now,
        lookback: candles.length,
        predLen,
        intervalMs: intervalMsOf(candles),
        anchorTime: candles[candles.length - 1].t
      };

      let result;
      if (breakerOpen(cfg.now()) && !refresh) {
        result = {
          ...base,
          provider: 'baseline',
          model: 'drift-volatility baseline',
          candles: baselineForecast(candles, predLen),
          worker: { ok: false, configured: Boolean(cfg.workerUrl()), error: 'WORKER_BREAKER_OPEN', code: 'WORKER_BREAKER_OPEN' }
        };
      } else {
        state.workerCalls += 1;
        try {
          const got = await callWorker(cfg, candles, predLen);
          state.failures = 0;
          state.openUntil = 0;
          state.lastProvider = 'kronos';
          result = {
            ...base,
            provider: got.provider,
            model: got.model,
            generatedAt: got.generatedAt,
            candles: got.candles,
            worker: { ok: true, configured: true, latencyMs: got.latencyMs }
          };
        } catch (err) {
          state.failures += 1;
          if (state.failures >= cfg.failureThreshold() || err?.code === 'WORKER_NOT_CONFIGURED') {
            state.openUntil = cfg.now() + cfg.breakerCooldownMs();
          }
          state.baselines += 1;
          state.lastProvider = 'baseline';
          result = {
            ...base,
            provider: 'baseline',
            model: 'drift-volatility baseline',
            candles: baselineForecast(candles, predLen),
            worker: { ok: false, configured: Boolean(cfg.workerUrl()), code: workerErrorCode(err), error: workerErrorCode(err) }
          };
        }
      }

      /* Cache even the baseline: its inputs are frozen until the next bar,
         and a chart full of readers must not re-run the walk per view. */
      const ttl = result.provider === 'baseline'
        ? Math.min(15_000, cfg.cacheTtlMs())
        : Math.min(cfg.cacheTtlMs(), Math.max(30_000, base.intervalMs || cfg.cacheTtlMs()));
      if (cache.size >= 400) {
        for (const [k, v] of cache) if (v.expiresAt <= cfg.now()) cache.delete(k);
        while (cache.size >= 400) cache.delete(cache.keys().next().value);
      }
      cache.set(key, { value: result, expiresAt: cfg.now() + ttl });
      return result;
    })();

    inflight.set(key, work);
    try {
      return await work;
    } finally {
      inflight.delete(key);
    }
  }

  return {
    forecast: produce,
    stats: () => ({ ...state, cacheSize: cache.size, breakerOpen: breakerOpen(cfg.now()) }),
    status: () => ({
      schema: FORECAST_SCHEMA,
      configured: Boolean(cfg.workerUrl()),
      provider: cfg.workerUrl() ? 'kronos' : 'baseline',
      minCandles: FORECAST_MIN_CANDLES,
      maxCandles: FORECAST_MAX_CANDLES,
      maxHorizon: FORECAST_PREDLEN_MAX,
      breakerOpen: breakerOpen(cfg.now()),
      // Configuration is not health: only a successful inference proves ready.
      verified: state.lastProvider === 'kronos',
      lastProvider: state.lastProvider || null
    }),
    reset() {
      cache.clear();
      inflight.clear();
      state.failures = 0;
      state.openUntil = 0;
      state.workerCalls = 0;
      state.cacheHits = 0;
      state.baselines = 0;
      state.lastProvider = null;
    }
  };
}

/** The instance server/app.js routes talk to. */
export const forecastService = createForecastService();
