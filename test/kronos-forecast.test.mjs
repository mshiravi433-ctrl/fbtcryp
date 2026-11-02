/**
 * KRONOS FORECAST — route, worker client, breaker, cache, baseline.
 * ------------------------------------------------------------------
 * The real Express app is driven over HTTP; the Python worker and CoinGecko
 * are replaced by stubs on globalThis.fetch, so nothing leaves the sandbox.
 *
 * What this pins:
 *   1. POST /api/forecast returns the worker's projection VERBATIM when the
 *      worker answers (provider=kronos, model name intact, horizon matched).
 *   2. A dead worker degrades to the LABELLED baseline — 200, never a 503,
 *      with the worker's error preserved beside it.
 *   3. The breaker opens after N failures and then stops paying for a worker
 *      that is down (calls freeze), while the endpoint keeps answering.
 *   4. The per-series cache: the same window costs ONE worker call, however
 *      many readers ask.
 *   5. Structural garbage is a 400, not a 500 — and too few candles is
 *      refused at the door.
 *   6. GET /api/forecast/:id runs the same pipeline over the OHLC feed.
 *
 * Run: node --test --test-force-exit test/kronos-forecast.test.mjs
 */
import { test, before, after, beforeEach } from 'node:test';
process.env.FORECAST_RATE_LIMIT = '200';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import {
  normalizeCandles,
  inferPredLen,
  intervalMsOf,
  baselineForecast,
  forecastService,
  FORECAST_MIN_CANDLES
} from '../server/kronosForecast.js';

/* ── stubs ─────────────────────────────────────────────────────────────────── */

const realFetch = globalThis.fetch;
let workerMode = 'ok'; // ok | down | refuse
let workerCalls = 0;
let ohlcBars = [];

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function futureBars(candles, predLen) {
  const step = intervalMsOf(candles) || 60_000;
  const last = candles[candles.length - 1];
  return Array.from({ length: predLen }, (_, i) => {
    const c = last.c * (1 + (i + 1) * 0.001);
    return { t: last.t + step * (i + 1), o: last.c, h: c * 1.002, l: last.c * 0.998, c, v: 5 };
  });
}

globalThis.fetch = async (url, init) => {
  const href = String(url);
  /* The Python worker (server/kronosForecast.js posts to KRONOS_WORKER_URL). */
  if (href.includes('127.0.0.1:8765/forecast')) {
    workerCalls += 1;
    if (workerMode === 'down') throw new Error('ECONNREFUSED');
    if (workerMode === 'refuse') return json({ ok: false, error: 'MODEL_UNAVAILABLE:weights' }, 503);
    const body = JSON.parse(init.body);
    return json({
      ok: true,
      provider: 'kronos',
      model: 'NeoQuasar/Kronos-small',
      generatedAt: 1_760_000_000_000,
      predLen: body.predLen,
      candles: futureBars(body.candles, body.predLen)
    });
  }
  /* CoinGecko OHLC for GET /api/forecast/:id. */
  if (href.includes('coingecko.com') && href.includes('/ohlc')) {
    return json(ohlcBars);
  }
  return realFetch(url, init);
};

/* ── helpers ───────────────────────────────────────────────────────────────── */

function makeCandles(n = 120, { start = 1_760_000_000_000, step = 300_000, base = 100 } = {}) {
  const out = [];
  let price = base;
  for (let i = 0; i < n; i += 1) {
    const o = price;
    const c = price * (1 + (((i * 37) % 11) - 5) / 500);
    out.push({
      t: start + i * step,
      o,
      h: Math.max(o, c) * 1.004,
      l: Math.min(o, c) * 0.996,
      c,
      v: 10 + (i % 7)
    });
    price = c;
  }
  return out;
}

let app;
let server;
let base;

async function post(path, payload) {
  const res = await realFetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, headers: res.headers, body };
}

async function get(path) {
  const res = await realFetch(`${base}${path}`);
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, headers: res.headers, body };
}

before(async () => {
  app = (await import('../server/app.js')).default;
  server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  globalThis.fetch = realFetch;
  if (server) await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  workerMode = 'ok';
  workerCalls = 0;
  ohlcBars = [];
  forecastService.reset();
});

/* ── unit: the pure helpers ────────────────────────────────────────────────── */

test('normalizeCandles accepts the chart shape, sorts, dedupes, trims to 512', () => {
  const rows = makeCandles(600);
  const shuffled = [...rows.slice(0, 50), ...rows.slice(50)].reverse();
  const norm = normalizeCandles(shuffled);
  assert.equal(norm.ok, true);
  assert.equal(norm.candles.length, 512);
  assert.equal(norm.candles[0].t, rows[88].t); // last 512 of 600, ascending
  assert.ok(norm.candles.every((c, i, a) => i === 0 || c.t > a[i - 1].t));
});

test('normalizeCandles rejects inverted bars, non-positive prices, junk', () => {
  const rows = makeCandles(80);
  assert.equal(normalizeCandles(null).ok, false);
  assert.equal(normalizeCandles([]).ok, false);
  assert.equal(normalizeCandles([{ t: 'x' }]).ok, false);
  const inverted = rows.map((r, i) => (i === 3 ? { ...r, h: r.l - 1 } : r));
  assert.match(normalizeCandles(inverted).error, /INCONSISTENT_OHLC/);
  const zero = rows.map((r, i) => (i === 3 ? { ...r, c: 0 } : r));
  assert.match(normalizeCandles(zero).error, /BAD_PRICE/);
});

test('inferPredLen clamps an explicit horizon and derives a sane default', () => {
  const rows = makeCandles(120);
  assert.equal(inferPredLen(rows, 24), 24);
  assert.equal(inferPredLen(rows, 9999), 120); // capped at the model's ceiling
  assert.equal(inferPredLen(rows, 'nope'), 15); // 120/8
  assert.equal(inferPredLen(makeCandles(64), undefined), 12); // floor
  assert.equal(inferPredLen(makeCandles(512), undefined), 48); // ceiling of the default band
});

test('baselineForecast is deterministic, positive, and a valid candle set', () => {
  const rows = makeCandles(200);
  const a = baselineForecast(rows, 30);
  const b = baselineForecast(rows, 30);
  assert.deepEqual(a, b);
  assert.equal(a.length, 30);
  assert.ok(a.every((c, i, arr) => i === 0 || c.t > arr[i - 1].t));
  assert.ok(a.every((c) => c.c > 0 && c.h >= Math.max(c.o, c.c) - 1e-9 && c.l <= Math.min(c.o, c.c) + 1e-9));
});

/* ── route: the happy path through a healthy worker ────────────────────────── */

test('POST /api/forecast returns the worker projection verbatim (provider=kronos)', async () => {
  const candles = makeCandles(120);
  const r = await post('/api/forecast', { candles, predLen: 18 });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.provider, 'kronos');
  assert.equal(r.body.model, 'NeoQuasar/Kronos-small');
  assert.equal(r.body.candles.length, 18);
  assert.equal(r.body.predLen, 18);
  assert.equal(r.body.lookback, 120);
  assert.equal(r.body.schema, 'fbt.forecast.v2');
  assert.ok(Number.isFinite(r.body.intervalMs) && r.body.intervalMs > 0);
  assert.equal(r.body.worker.ok, true);
  assert.match(r.headers.get('cache-control'), /no-store/);
  assert.equal(r.headers.get('x-forecast-provider'), 'kronos');
  /* The projection continues AFTER the last real bar, at the same rhythm. */
  const lastReal = candles[candles.length - 1].t;
  assert.equal(r.body.candles[0].t - lastReal, 300_000);
});

test('the same window costs ONE worker call — the cache absorbs every reader', async () => {
  const candles = makeCandles(150);
  const first = await post('/api/forecast', { candles, predLen: 12 });
  const second = await post('/api/forecast', { candles, predLen: 12 });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(workerCalls, 1);
  assert.equal(second.body.cached, true);
  assert.deepEqual(second.body.candles, first.body.candles);
});

/* ── route: the worker is optional ─────────────────────────────────────────── */

test('a dead worker degrades to the LABELLED baseline — 200, error preserved', async () => {
  workerMode = 'down';
  const r = await post('/api/forecast', { candles: makeCandles(120), predLen: 16 });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.provider, 'baseline');
  assert.equal(r.body.model, 'drift-volatility baseline');
  assert.equal(r.body.candles.length, 16);
  assert.equal(r.body.worker.ok, false);
  assert.equal(r.body.worker.error, 'WORKER_UNAVAILABLE');
  /* The baseline must never be mistaken for the model: provider says so. */
  assert.notEqual(r.body.provider, 'kronos');
});

test('a503 from the worker (model unavailable) is also a labelled baseline', async () => {
  workerMode = 'refuse';
  const r = await post('/api/forecast', { candles: makeCandles(120, { start: 1_770_000_000_000 }), predLen: 16 });
  assert.equal(r.status, 200);
  assert.equal(r.body.provider, 'baseline');
  assert.equal(r.body.worker.error, 'WORKER_NOT_READY');
});

test('the breaker opens after 3 failures and then stops calling the worker', async () => {
  workerMode = 'down';
  /* Three DIFFERENT series → three cache misses → three worker attempts. */
  for (let i = 0; i < 3; i += 1) {
    const r = await post('/api/forecast', {
      candles: makeCandles(120, { start: 1_780_000_000_000 + i * 86_400_000 }),
      predLen: 10
    });
    assert.equal(r.body.provider, 'baseline');
  }
  assert.equal(workerCalls, 3);
  assert.equal(forecastService.stats().breakerOpen, true);

  const r = await post('/api/forecast', {
    candles: makeCandles(120, { start: 1_790_000_000_000 }),
    predLen: 10
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.provider, 'baseline');
  assert.equal(r.body.worker.error, 'WORKER_BREAKER_OPEN');
  assert.equal(workerCalls, 3); // no fourth attempt — the breaker held
});

/* ── route: structural garbage is a 400 ────────────────────────────────────── */

test('too few candles is refused at the door', async () => {
  const r = await post('/api/forecast', { candles: makeCandles(FORECAST_MIN_CANDLES - 1) });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /CANDLES_TOO_FEW/);
});

test('an inverted bar is a 400 with the row index, not a 500', async () => {
  const candles = makeCandles(90);
  candles[7] = { ...candles[7], h: candles[7].l - 5 };
  const r = await post('/api/forecast', { candles });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /CANDLE_7_INCONSISTENT_OHLC/);
});

test('a non-array body is a 400', async () => {
  const r = await post('/api/forecast', { candles: 'nope' });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'CANDLES_NOT_AN_ARRAY');
});

/* ── route: server-side variant over the OHLC feed ─────────────────────────── */

test('GET /api/forecast/:id runs the same pipeline over the OHLC feed', async () => {
  /* CoinGecko's OHLC feed is arrays of [ts, o, h, l, c] — the stub speaks
     the upstream's own dialect, so fetchOhlc exercises its real normaliser. */
  ohlcBars = makeCandles(90, { step: 1_800_000 }).map((c) => [c.t, c.o, c.h, c.l, c.c]);
  const r = await get('/api/forecast/bitcoin?days=7&predLen=12');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.candles.length, 12);
  assert.equal(r.body.source, 'coingecko-ohlc:7d');
  assert.equal(r.body.provider, 'kronos');
});

test('GET with an empty feed answers 400, not a fabricated projection', async () => {
  ohlcBars = [];
  const r = await get('/api/forecast/bitcoin?days=7');
  assert.equal(r.status, 400);
  assert.match(r.body.error, /CANDLES_TOO_FEW/);
});


test('the production default windows (42 and 48 bars) are accepted', async () => {
  for (const n of [42, 48]) {
    const r = await post('/api/forecast', { candles: makeCandles(n, { start: 1_751_000_000_000 + n }), predLen: 12 });
    assert.equal(r.status, 200);
    assert.equal(r.body.lookback, n);
    assert.equal(r.body.candles.length, 12);
  }
});

test('cache fingerprint includes the whole window, not just the last close', async () => {
  const a = makeCandles(80, { start: 1_752_000_000_000 });
  const b = a.map((row, i) => i === 10 ? { ...row, c: row.c * 1.01, h: row.h * 1.02 } : row);
  assert.equal(a.at(-1).c, b.at(-1).c);
  await post('/api/forecast', { candles: a, predLen: 12 });
  await post('/api/forecast', { candles: b, predLen: 12 });
  assert.equal(workerCalls, 2);
});

test('refresh retries a fallback but never duplicates a cached Kronos call', async () => {
  workerMode = 'down';
  const candles = makeCandles(80, { start: 1_753_000_000_000 });
  const first = await post('/api/forecast', { candles, predLen: 12, refresh: true });
  assert.equal(first.body.provider, 'baseline');
  workerMode = 'ok';
  const second = await post('/api/forecast', { candles, predLen: 12, refresh: true });
  assert.equal(second.body.provider, 'kronos');
  assert.equal(workerCalls, 2);
  const third = await post('/api/forecast', { candles, predLen: 12, refresh: true });
  assert.equal(third.body.cached, true);
  assert.equal(workerCalls, 2);
});

test('a mock worker is never promoted to Kronos', async () => {
  const old = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('127.0.0.1:8765/forecast')) {
      const body = JSON.parse(init.body);
      return json({ ok: true, provider: 'mock', model: 'mock', generatedAt: Date.now(), candles: futureBars(body.candles, body.predLen) });
    }
    return old(url, init);
  };
  try {
    const r = await post('/api/forecast', { candles: makeCandles(80, { start: 1_754_000_000_000 }), predLen: 12 });
    assert.equal(r.body.provider, 'baseline');
    assert.equal(r.body.worker.code, 'WORKER_INVALID_RESPONSE');
  } finally { globalThis.fetch = old; }
});

test('status exposes configuration and limits, never a URL or token', async () => {
  const r = await get('/api/forecast/status');
  assert.equal(r.status, 200);
  assert.equal(r.body.schema, 'fbt.forecast.v2');
  assert.equal(r.body.minCandles, 40);
  assert.equal(r.body.maxHorizon, 120);
  assert.equal(typeof r.body.configured, 'boolean');
  assert.equal(typeof r.body.verified, 'boolean');
  assert.equal(r.body.workerUrl, undefined);
  assert.equal(r.body.workerToken, undefined);
});
