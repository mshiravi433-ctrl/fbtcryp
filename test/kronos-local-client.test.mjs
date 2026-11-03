/**
 * Regression test for the desktop/mobile retry loop: a complete-looking model
 * cache can fail integrity verification when the worker opens it. `prepareModel`
 * must evict and redownload that cache once, rather than showing a Retry action
 * that repeats the same corrupt bytes forever.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const cacheBuckets = new Map();
const fakeCaches = {
  async open(name) {
    if (!cacheBuckets.has(name)) cacheBuckets.set(name, new Map());
    const bucket = cacheBuckets.get(name);
    return {
      async match(key) { return bucket.get(key)?.clone?.() ?? bucket.get(key) ?? null; },
      async put(key, value) { bucket.set(key, value); },
      async delete(key) { return bucket.delete(key); }
    };
  },
  async delete(name) { return cacheBuckets.delete(name); },
  async keys() { return [...cacheBuckets.keys()]; }
};

globalThis.caches = fakeCaches;
globalThis.window = { location: { origin: 'https://app.example' } };

const modelBytes = new TextEncoder().encode('verified-test-model');
const digestBytes = await globalThis.crypto.subtle.digest('SHA-256', modelBytes);
const sha256 = [...new Uint8Array(digestBytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
const manifest = {
  schema: 'fbt.kronos.browser.v1',
  model: { id: 'NeoQuasar/Kronos-mini' },
  tokenizer: { encode: 'graph.onnx', decode: 'graph.onnx' },
  files: [{ name: 'graph.onnx', bytes: modelBytes.byteLength, sha256 }],
  totalBytes: modelBytes.byteLength
};

let fileDownloads = 0;
globalThis.fetch = async (url) => {
  if (String(url).endsWith('/model-manifest.json')) {
    return new Response(JSON.stringify(manifest), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  fileDownloads += 1;
  return new Response(modelBytes, { status: 200 });
};

let initAttempts = 0;
let predictAttempts = 0;
let predictMode = 'ok';
const WORKER_RESULT = {
  provider: 'kronos-local',
  model: 'NeoQuasar/Kronos-mini',
  backend: 'wasm',
  repaired: 0,
  options: { window: 50, horizon: 2 },
  timing: { totalMs: 42 },
  candles: [
    { t: 1_700_086_400_000, o: 100, h: 103, l: 99, c: 102, v: 10 },
    { t: 1_700_172_800_000, o: 102, h: 105, l: 101, c: 104, v: 11 }
  ]
};
class FakeWorker {
  listeners = new Map();
  addEventListener(type, callback) {
    const callbacks = this.listeners.get(type) || [];
    callbacks.push(callback);
    this.listeners.set(type, callbacks);
  }
  postMessage(message) {
    let response = null;
    if (message.type === 'init') {
      initAttempts += 1;
      response = initAttempts === 1
        ? { type: 'error', id: message.id, code: 'MODEL_FILE_CORRUPT', detail: 'simulated stale cache' }
        : { type: 'ready', id: message.id, backend: 'wasm', adapter: null };
    } else if (message.type === 'predict') {
      predictAttempts += 1;
      /* The REAL worker protocol (kronos.worker.js `predict`): the forecast
         rides INSIDE an envelope — `{type:'result', id, result}`. Faking a
         flat message here is exactly how the 2026-11-03 crash shipped: the
         client resolved the envelope, the chart read `forecast.candles.length`
         off `undefined`, and the token page died after the download. */
      response = predictMode === 'garbage'
        ? { type: 'result', id: message.id, result: { provider: 'kronos-local' } }
        : { type: 'result', id: message.id, result: WORKER_RESULT };
    }
    if (!response) return;
    queueMicrotask(() => {
      for (const callback of this.listeners.get('message') || []) callback({ data: response });
    });
  }
  terminate() {}
}
globalThis.Worker = FakeWorker;

/* A localStorage the result cache can enumerate, so a poisoned entry written
   by the buggy build can be seeded and its rescue asserted. */
const lsData = {};
const fakeLocalStorage = {};
Object.defineProperties(fakeLocalStorage, {
  getItem: { value: (k) => (k in lsData ? lsData[k] : null) },
  setItem: { value: (k, v) => { lsData[k] = String(v); fakeLocalStorage[k] = String(v); } },
  removeItem: { value: (k) => { delete lsData[k]; delete fakeLocalStorage[k]; } }
});
globalThis.localStorage = fakeLocalStorage;

const client = await import('../src/lib/kronosLocal/client.js');
const { RESULT_CACHE_PREFIX } = await import('../src/lib/kronosLocal/config.js');

const DAY = 86_400_000;
const payload = (lastClose = 100) => Array.from({ length: 50 }, (_, i) => ({
  t: 1_700_000_000_000 + i * DAY, o: 99, h: 102, l: 98, c: i === 49 ? lastClose : 100, v: 10
}));

test('prepareModel repairs a corrupt cached model once and retries engine startup', async () => {
  const phases = [];
  const result = await client.prepareModel({ onPhase: (phase) => phases.push(phase) });

  assert.equal(result.backend, 'wasm');
  assert.equal(initAttempts, 2, 'worker startup was retried once after model-cache repair');
  assert.equal(fileDownloads, 2, 'the model was downloaded again after removing the suspect cache');
  assert.deepEqual(phases, ['manifest', 'download', 'engine', 'download', 'engine']);
});

test('runForecast returns the forecast INSIDE the worker envelope, not the envelope', async () => {
  /* The reported crash, end to end: download finished, inference ran, the
     worker posted `{type:'result', result:{…candles}}` — and the client used
     to resolve that whole envelope. `forecast.candles` was then undefined and
     the token page threw while rendering the badge. */
  const result = await client.runForecast(payload(), { horizon: 2 });
  assert.equal(predictAttempts, 1);
  assert.equal(result.type, undefined, 'the {type:"result"} envelope must not leak to callers');
  assert.equal(result.backend, 'wasm');
  assert.ok(Array.isArray(result.candles), 'candles ride at the top level, where the chart reads them');
  assert.equal(result.candles.length, 2);
  assert.equal(result.candles[result.candles.length - 1].c, 104);

  /* Same inputs again: answered from the result cache, in the same flat shape. */
  const cached = await client.runForecast(payload(), { horizon: 2 });
  assert.equal(predictAttempts, 1, 'a cache hit must not re-run the model');
  assert.equal(cached.cached, true);
  assert.equal(cached.candles.length, 2);
});

test('an envelope-shaped cache entry from the buggy build is rescued, not replayed', async () => {
  /* Devices that already crashed once hold the ENVELOPE in localStorage
     (`cacheSet` persisted whatever the client resolved). Replaying it as-is
     is why going back to the market and re-opening the token crashed again
     instantly. The real forecast is inside it — unwrap and serve that. */
  const bars = payload(123);
  const key = `${RESULT_CACHE_PREFIX}${client.forecastSignature(bars, { horizon: 2 })}`;
  globalThis.localStorage.setItem(key, JSON.stringify({
    at: Date.now(),
    value: { type: 'result', id: 'job-1', result: WORKER_RESULT }
  }));
  const before = predictAttempts;
  const rescued = await client.runForecast(bars, { horizon: 2 });
  assert.equal(predictAttempts, before, 'served from cache, model not re-run');
  assert.equal(rescued.cached, true);
  assert.equal(rescued.type, undefined);
  assert.equal(rescued.candles.length, 2);
});

test('a worker result without candles is rejected as INVALID_PROJECTION', async () => {
  predictMode = 'garbage';
  try {
    await assert.rejects(
      client.runForecast(payload(77), { horizon: 2 }),
      (error) => error?.code === 'INVALID_PROJECTION',
      'a shape the chart cannot render must become a named error, never a render crash'
    );
  } finally {
    predictMode = 'ok';
  }
});

test('normalizeForecastResult is the one shape gate', () => {
  assert.equal(typeof client.normalizeForecastResult, 'function');
  assert.deepEqual(client.normalizeForecastResult(WORKER_RESULT), WORKER_RESULT);
  assert.deepEqual(
    client.normalizeForecastResult({ type: 'result', id: 'job-1', result: WORKER_RESULT }),
    WORKER_RESULT
  );
  assert.equal(client.normalizeForecastResult({ type: 'result', id: 'job-1' }), null);
  assert.equal(client.normalizeForecastResult({ provider: 'kronos-local' }), null);
  assert.equal(client.normalizeForecastResult({ candles: [] }), null);
  assert.equal(client.normalizeForecastResult(null), null);
  assert.equal(client.normalizeForecastResult(undefined), null);
});

test('cleanup resets globals for this isolated test process', async () => {
  await client.forgetModel();
  delete globalThis.window;
  delete globalThis.Worker;
  delete globalThis.fetch;
  delete globalThis.caches;
  delete globalThis.localStorage;
});
