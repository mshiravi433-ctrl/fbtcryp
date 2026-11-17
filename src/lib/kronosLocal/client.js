/**
 * KHRONOS LOCAL — the browser-side orchestrator.
 * =============================================
 *
 * One place that owns the whole on-device lifecycle so the chart component
 * only has to render states:
 *
 *   unsupported → absent → downloading → preparing → ready → running → ready
 *                              ↘ cancelled / error (retryable)
 *
 * What this module guarantees
 * ---------------------------------------------------------------------------
 * • No automatic download. Nothing is fetched until `prepareModel()` is called
 *   from an explicit user action, and the UI shows the byte cost first.
 * • No server model call. The only network requests here are (a) the ~1 KB
 *   manifest and (b) the model files — both plain static GETs. This module
 *   never imports the API client and never posts candles anywhere.
 * • One forecast at a time. `runForecast` serialises; a second call aborts the
 *   first (a phone that runs two 200-bar prefills is a phone that shows the
 *   out-of-memory screen).
 * • Cancellation really stops work: the worker is terminated, not just
 *   flagged, so an in-flight prefill cannot keep burning CPU behind a closed
 *   panel.
 * • Identical inputs on the same device are answered from a short-lived cache
 *   instead of re-running the model for a redraw.
 */

import {
  RESULT_CACHE_MAX, RESULT_CACHE_PREFIX, RESULT_CACHE_TTL_MS,
  RUNTIME_BYTES, modelBaseUrl
} from './config.js';
import {
  KronosStorageError, cachedModelState, deleteModel, downloadModel,
  fetchManifest, hasResolvedModelHost, rememberedManifest, storageEstimate
} from './storage.js';

let worker = null;
let workerReady = null;
let manifest = null;
let backend = null;
let adapter = null;
let jobSeq = 0;
let activeJob = null;
const resultCache = new Map();

/** Cheap, synchronous capability gate — runs before anything is downloaded. */
export function deviceSupport() {
  const reasons = [];
  if (typeof Worker === 'undefined') reasons.push('NO_WORKER');
  if (typeof WebAssembly === 'undefined') reasons.push('NO_WASM');
  if (!globalThis.crypto?.subtle) reasons.push('NO_CRYPTO');
  if (typeof caches === 'undefined') reasons.push('NO_CACHE');
  const ua = typeof navigator !== 'undefined' ? String(navigator.userAgent || '') : '';
  const telegram = /Telegram|TelegramWebview/i.test(ua);
  const ios = /iPhone|iPad|iPod/i.test(ua);
  const memory = Number(navigator?.deviceMemory || 0);
  return {
    ok: reasons.length === 0,
    reasons,
    telegram,
    ios,
    memory,
    /** iOS < 17 has no WebGPU in Safari; the WASM engine still runs there. */
    webgpuLikely: !ios || /OS 1[7-9]|OS [2-9]\d/.test(ua),
    crossOriginIsolated: Boolean(globalThis.crossOriginIsolated)
  };
}

/** Ask the worker what this device can actually do (adapter, not UA sniffing). */
export function probeDevice(timeoutMs = 8000) {
  if (!deviceSupport().ok) return Promise.resolve({ webgpu: false, reason: 'UNSUPPORTED' });
  return callWorker({ type: 'probe' }, timeoutMs).then(
    (msg) => ({ webgpu: Boolean(msg.webgpu), adapter: msg.adapter || '', reason: msg.reason || '', runtimeBytes: msg.runtimeBytes }),
    (error) => ({ webgpu: false, reason: error?.message || 'PROBE_FAILED' })
  );
}

/** What is on the device right now: manifest known? files present? bytes? */
export async function modelState() {
  const remembered = manifest || rememberedManifest();
  if (!remembered) return { state: 'unknown', manifest: null, bytes: 0, base: modelBaseUrl() };
  const cached = await cachedModelState(remembered);
  return {
    state: cached.downloaded ? 'ready' : (cached.partial ? 'partial' : 'absent'),
    manifest: remembered,
    bytes: cached.downloaded ? remembered.totalBytes : 0,
    totalBytes: remembered.totalBytes,
    base: modelBaseUrl()
  };
}

/** Byte cost of the next download: model + the runtime engine that will run it. */
export async function downloadEstimate() {
  const support = deviceSupport();
  const probe = await probeDevice();
  const nextManifest = manifest || rememberedManifest();
  const modelBytes = nextManifest?.totalBytes || 0;
  const runtimeBytes = probe.webgpu ? RUNTIME_BYTES.webgpu : RUNTIME_BYTES.wasm;
  return {
    modelBytes,
    runtimeBytes,
    totalBytes: modelBytes + runtimeBytes,
    webgpu: Boolean(probe.webgpu),
    adapter: probe.adapter || '',
    free: (await storageEstimate())?.available ?? null
  };
}

/**
 * Fetch the manifest, download the files (progress + cancel) and build the
 * sessions. Safe to call twice: the second call reuses what the first stored.
 *
 * @param {object} opts
 * @param {(p: {loaded:number,total:number,percent:number,file:string,index:number,count:number}) => void} [opts.onProgress]
 * @param {(phase: string) => void} [opts.onPhase] 'manifest' | 'verify' | 'engine'
 * @param {AbortSignal} [opts.signal]
 */
export async function prepareModel({ onProgress = () => {}, onPhase = () => {}, signal } = {}) {
  if (!deviceSupport().ok) throw new KronosStorageError('DEVICE_UNSUPPORTED');
  onPhase('manifest');
  manifest = manifest || rememberedManifest();
  if (!manifest) manifest = await fetchManifest({ signal });

  const before = await cachedModelState(manifest);
  if (!before.downloaded) {
    /* A remembered manifest skips the network, and `resolvedHost` does not
       survive a reload. Probe the 1 KB manifest — not the 33 MB graphs —
       before pulling files from a host that may have been dead since the
       last visit (GitHub Pages 404, a CORS-blocked CDN). */
    if (!hasResolvedModelHost()) {
      try {
        const live = await fetchManifest({ signal });
        if (live?.schema === 'fbt.kronos.browser.v1') manifest = live;
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
      }
    }
    onPhase('download');
    await downloadModel(manifest, {
      signal,
      onProgress: (p) => onProgress({ ...p, percent: p.total ? Math.round((p.loaded / p.total) * 100) : 0 })
    });
  }
  onPhase('engine');
  let ready;
  try {
    ready = await ensureWorker(manifest, signal);
  } catch (error) {
    /* A complete-looking Cache Storage bucket can still contain a truncated
       entry after browser eviction or interrupted writes. The worker verifies
       every SHA before session creation; if it catches a bad/missing model
       entry, repair that cache once instead of giving the user a Retry button
       that can only repeat the same failure forever. Runtime/session errors
       are deliberately not treated as model corruption: re-downloading 33 MB
       cannot fix a missing ORT engine or a device backend limitation. */
    if (!['MODEL_FILE_CORRUPT', 'MODEL_FILE_TRUNCATED', 'MODEL_NOT_DOWNLOADED'].includes(error?.code)) throw error;
    terminateWorker();
    await deleteModel(manifest);
    onPhase('download');
    await downloadModel(manifest, {
      signal,
      onProgress: (p) => onProgress({ ...p, percent: p.total ? Math.round((p.loaded / p.total) * 100) : 0 })
    });
    if (signal?.aborted) throw new KronosStorageError('WORKER_CANCELLED');
    onPhase('engine');
    ready = await ensureWorker(manifest, signal);
  }
  backend = ready.backend;
  adapter = ready.adapter || null;
  return { manifest, backend, adapter, bytes: manifest.totalBytes };
}

/**
 * The one shape gate between the worker and the chart.
 *
 * A forecast result is the flat object `LocalKronos.forecast` returns —
 * `{candles: […], backend, timing, …}` with at least one candle. Anything
 * else is NOT a forecast, no matter how truthy it looks.
 *
 * This gate exists because of the crash this feature shipped with: the worker
 * posts its answer inside an envelope (`{type:'result', id, result}`), and
 * the message handler used to resolve the ENVELOPE. The chart then held a
 * truthy "forecast" whose `candles` was `undefined`, and died rendering
 * `forecast.candles.length` — «این صفحه به مشکل خورد» right after the 33 MB
 * download finished, on every device, every time. Worse, the envelope was
 * written into the result cache, so leaving to the market and coming back
 * replayed the same poisoned shape instantly.
 *
 * So: envelopes are unwrapped here (which also RESCUES those persisted cache
 * entries — the real forecast is inside them), and a value without candles
 * becomes `null`, which callers turn into a named, retryable error instead
 * of a render crash.
 */
export function normalizeForecastResult(raw) {
  let value = raw;
  while (value && !Array.isArray(value.candles) && value.result && typeof value.result === 'object') {
    value = value.result;
  }
  return value && Array.isArray(value.candles) && value.candles.length ? value : null;
}

/* ── the forecast's DIRECTION, shared through the one store both screens use ─

   WHY A MODULE-LEVEL STORE AND NOT A NEW REQUEST
   ----------------------------------------------
   The Signals page is forbidden from running the model itself (it is a
   ~hundreds-of-MB download plus a WASM prefill — the opposite of what a
   Fluid-CPU budget allows), and it must not post candles anywhere either. But
   a reader who already ran KHRONOS on the token page has a real forecast in
   hand, and that forecast is a measured opinion about where this asset is
   going: exactly the fourth plane the signal consensus compares.

   The two screens share this module instance (Vite bundles it once), so a
   tiny record written when a forecast finishes is readable by the Signals
   page with ZERO network calls and zero storage. `pct` is the signed % move
   from the last real close to the last forecast candle — the same number the
   chart panel prints. It is `null` until a forecast has actually run.

   The record is also written to `sessionStorage`, so a tab that navigates
   between the chart and the signals page keeps the reading without keeping
   the model alive. It is deliberately small (five fields), has no price
   history in it, and expires on its own. */
const FORECAST_READ_KEY = 'fbt-kronos-read-v1';
const FORECAST_READ_TTL_MS = 30 * 60_000;
let lastRead = null;

/** The signed % move implied by a finished forecast, or null. Pure. */
export function forecastChangePct(result, lastClose) {
  const candles = Array.isArray(result?.candles) ? result.candles : null;
  if (!candles || !candles.length) return null;
  const lastBar = candles[candles.length - 1];
  const end = Number(lastBar?.c);
  const from = Number(lastClose);
  if (!Number.isFinite(end) || !Number.isFinite(from) || from <= 0) return null;
  return (end / from - 1) * 100;
}

/**
 * Remember the direction of a finished forecast so the signal engine can use
 * it as the «پیش‌بینی AI نمودار شمعی» plane. Called by the chart, never by the
 * signals page.
 */
export function rememberForecastRead({ assetId = null, pct = null, horizon = null, backend = null } = {}) {
  const value = Number(pct);
  const record = Number.isFinite(value) && assetId
    ? { assetId: String(assetId), pct: Math.round(value * 100) / 100, horizon: horizon ?? null, backend: backend ?? null, at: Date.now() }
    : null;
  lastRead = record;
  try {
    if (record) globalThis.sessionStorage?.setItem(FORECAST_READ_KEY, JSON.stringify(record));
    else globalThis.sessionStorage?.removeItem?.(FORECAST_READ_KEY);
  } catch { /* private mode / disabled storage: the in-memory copy still works */ }
  return record;
}

/**
 * The last forecast for THIS asset, or null.
 *
 * Returns null for another asset's forecast on purpose: a model reading for
 * ETH is not evidence about BTC, and using it would be a fabricated signal.
 */
export function lastForecastRead(assetId = null) {
  let record = lastRead;
  if (!record) {
    try {
      const raw = globalThis.sessionStorage?.getItem(FORECAST_READ_KEY);
      record = raw ? JSON.parse(raw) : null;
    } catch { record = null; }
  }
  if (!record || !Number.isFinite(Number(record.pct))) return null;
  if (Date.now() - Number(record.at || 0) > FORECAST_READ_TTL_MS) return null;
  if (assetId && String(record.assetId) !== String(assetId)) return null;
  return record;
}

export function __resetForecastReadForTests() {
  lastRead = null;
  try { globalThis.sessionStorage?.removeItem?.(FORECAST_READ_KEY); } catch { /* ignore */ }
}

/** Run one forecast on the device. Never falls back to a server model. */
export async function runForecast(candles, opts = {}) {
  const {
    horizon = 12, temperature = 1, topP = 0.9, topK = 0, signal,
    useCache = true, onPhase = () => {}, seed
  } = opts;
  const ready = workerReady ? await workerReady : null;
  if (!ready) throw new KronosStorageError('MODEL_NOT_READY');

  const key = forecastSignature(candles, { horizon, temperature, topP, topK });
  if (useCache) {
    const hit = cacheGet(key);
    if (hit) {
      onPhase('cached');
      return { ...hit, cached: true };
    }
  }

  activeJob?.abort();
  const id = `job-${(jobSeq += 1)}`;
  const controller = new AbortController();
  activeJob = { id, abort: () => { controller.abort(); terminateWorker(); } };
  const onAbort = () => { controller.abort(); terminateWorker(); };
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const raw = await callWorker({
      type: 'predict',
      id,
      candles,
      horizon,
      temperature,
      topP,
      topK,
      seed
    }, 180000, {
      id,
      signal: controller.signal,
      onProgress: (msg) => onPhase(msg.phase, msg)
    });
    /* The chart renders `result.candles` — a reply without candles is a
       failed projection with a name and a Retry button, never an object the
       UI has to guess about. See normalizeForecastResult. */
    const result = normalizeForecastResult(raw);
    if (!result) throw new KronosStorageError('INVALID_PROJECTION');
    if (useCache) cacheSet(key, result);
    return result;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    if (activeJob?.id === id) activeJob = null;
  }
}

/** Abort whatever is running (terminates the worker; sessions rebuild next run). */
export function abortForecast() {
  activeJob?.abort();
  activeJob = null;
}

/** Delete the model from this device. The next forecast re-offers the download. */
export async function forgetModel() {
  terminateWorker();
  await deleteModel(manifest || rememberedManifest());
  manifest = null;
  backend = null;
  adapter = null;
  clearResultCache();
}

export function currentBackend() {
  return backend;
}

export function currentAdapter() {
  return adapter;
}

export function cachedResult(candles, opts) {
  return cacheGet(forecastSignature(candles, opts));
}

/** Stable key: the bars that matter (last two) + window length + horizon + knobs. */
export function forecastSignature(candles, { horizon = 12, temperature = 1, topP = 0.9, topK = 0 } = {}) {
  if (!Array.isArray(candles) || !candles.length) return 'empty';
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2] || last;
  const model = manifest?.model?.id || 'kronos';
  return [
    model, candles.length, prev.t, prev.c.toPrecision(10), last.t, last.c.toPrecision(10),
    horizon, temperature, topP, topK
  ].join('|');
}

// ── worker plumbing ────────────────────────────────────────────────────────

const pendingCalls = new Map();

function ensureWorker(nextManifest, signal) {
  if (workerReady) return workerReady;
  if (typeof Worker === 'undefined') return Promise.reject(new KronosStorageError('NO_WORKER'));
  /*
   * The `new URL(...)` literal has to sit INSIDE `new Worker(...)`: that exact
   * shape is what the bundler rewrites into a real worker chunk. Hoisting it
   * into a constant first makes Vite treat the worker as a static asset — it
   * then ships the file verbatim, bare `import('onnxruntime-web/...')` and all,
   * which builds green and fails in the browser. `test/wiring.mjs` pins the
   * exact shape, which is why the options object is not hoisted either.
   */
  worker = new Worker(new URL('./kronos.worker.js', import.meta.url), { type: 'module', name: 'kronos-local' });
  attachWorkerEvents(worker);
  const pageUrl = (() => {
    try { return globalThis.location?.href || globalThis.window?.location?.href || ''; } catch { return ''; }
  })();
  workerReady = callWorker({ type: 'init', manifest: nextManifest, pageUrl }, 120000, { signal })
    .then((msg) => ({ backend: msg.backend, adapter: msg.adapter || null }))
    .catch((error) => {
      terminateWorker();
      throw error;
    });
  return workerReady;
}

function terminateWorker() {
  if (worker) {
    try { worker.terminate(); } catch { /* already gone */ }
  }
  worker = null;
  workerReady = null;
  backend = null;
  adapter = null;
  for (const [, pending] of pendingCalls) {
    pending.reject(new KronosStorageError('WORKER_CANCELLED'));
  }
  pendingCalls.clear();
}

function callWorker(message, timeoutMs = 30000, { id, signal, onProgress } = {}) {
  if (!worker) return Promise.reject(new KronosStorageError('NO_WORKER'));
  const callId = id || message.id || `call-${(jobSeq += 1)}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingCalls.delete(callId);
      reject(new KronosStorageError('WORKER_TIMEOUT'));
    }, timeoutMs);
    const fail = (error) => {
      clearTimeout(timer);
      pendingCalls.delete(callId);
      signal?.removeEventListener('abort', abort);
      reject(error);
    };
    const done = (value) => {
      clearTimeout(timer);
      pendingCalls.delete(callId);
      signal?.removeEventListener('abort', abort);
      resolve(value);
    };
    const abort = () => fail(new KronosStorageError('WORKER_CANCELLED'));
    signal?.addEventListener('abort', abort, { once: true });
    pendingCalls.set(callId, { resolve: done, reject: fail, onProgress });
    worker.postMessage({ ...message, id: callId });
  });
}

function attachWorkerEvents(target) {
  if (!target || target.__fbtBound) return;
  target.__fbtBound = true;
  target.addEventListener('message', (event) => {
    const msg = event.data || {};
    const pending = pendingCalls.get(msg.id);
    if (msg.type === 'progress') {
      pending?.onProgress?.(msg);
      return;
    }
    if (!pending) return;
    if (msg.type === 'error') {
      pending.reject(Object.assign(new KronosStorageError(msg.code || 'WORKER_ERROR'), { detail: msg.detail }));
    } else if (msg.type === 'result') {
      /* `ready`/`probe` carry their fields flat on the message; `result`
         does NOT — the forecast is `msg.result`. Resolving the whole
         envelope here is the exact slip that crashed the token page after
         every completed download (see normalizeForecastResult). */
      pending.resolve(msg.result ?? msg);
    } else if (msg.type === 'ready' || msg.type === 'probe') {
      pending.resolve(msg);
    } else if (msg.type === 'cancelled' || msg.type === 'disposed') {
      pending.resolve(msg);
    }
  });
  target.addEventListener('error', (event) => {
    for (const [, pending] of pendingCalls) pending.reject(new KronosStorageError('WORKER_CRASHED', String(event?.message || '')));
    pendingCalls.clear();
    terminateWorker();
  });
}

// ── result cache (memory + localStorage, both optional) ────────────────────

function cacheGet(key) {
  const hit = resultCache.get(key);
  if (hit && Date.now() - hit.at < RESULT_CACHE_TTL_MS) {
    /* Normalised on the way out, every time: an entry written by a build
       that persisted the worker envelope is rescued (the forecast is inside
       it) or evicted — never replayed into the chart as-is. */
    const clean = normalizeForecastResult(hit.value);
    if (clean) return clean;
  }
  if (hit) resultCache.delete(key);
  try {
    const raw = globalThis.localStorage?.getItem(`${RESULT_CACHE_PREFIX}${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const clean = parsed && Date.now() - parsed.at <= RESULT_CACHE_TTL_MS
      ? normalizeForecastResult(parsed.value)
      : null;
    if (!clean) {
      globalThis.localStorage?.removeItem(`${RESULT_CACHE_PREFIX}${key}`);
      return null;
    }
    resultCache.set(key, { at: parsed.at, value: clean });
    return clean;
  } catch { return null; }
}

function cacheSet(key, value) {
  const clean = normalizeForecastResult(value);
  if (!clean) return;
  const entry = { at: Date.now(), value: clean };
  resultCache.set(key, entry);
  try {
    globalThis.localStorage?.setItem(`${RESULT_CACHE_PREFIX}${key}`, JSON.stringify(entry));
    const keys = Object.keys(globalThis.localStorage)
      .filter((k) => k.startsWith(RESULT_CACHE_PREFIX));
    if (keys.length > RESULT_CACHE_MAX) {
      keys.sort();
      for (const k of keys.slice(0, keys.length - RESULT_CACHE_MAX)) globalThis.localStorage.removeItem(k);
    }
  } catch { /* quota or private mode: the memory cache still answers */ }
}

function clearResultCache() {
  resultCache.clear();
  try {
    const keys = Object.keys(globalThis.localStorage).filter((k) => k.startsWith(RESULT_CACHE_PREFIX));
    for (const k of keys) globalThis.localStorage.removeItem(k);
  } catch { /* noop */ }
}

/** Test seam: drop every module-level singleton. */
export function __resetForTests() {
  terminateWorker();
  manifest = null;
  backend = null;
  adapter = null;
  resultCache.clear();
}
