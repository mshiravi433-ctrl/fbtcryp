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
  fetchManifest, rememberedManifest, storageEstimate
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
    const result = await callWorker({
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
  workerReady = callWorker({ type: 'init', manifest: nextManifest }, 120000, { signal })
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
    } else if (msg.type === 'ready' || msg.type === 'probe' || msg.type === 'result') {
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
  if (hit && Date.now() - hit.at < RESULT_CACHE_TTL_MS) return hit.value;
  if (hit) resultCache.delete(key);
  try {
    const raw = globalThis.localStorage?.getItem(`${RESULT_CACHE_PREFIX}${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || Date.now() - parsed.at > RESULT_CACHE_TTL_MS) {
      globalThis.localStorage?.removeItem(`${RESULT_CACHE_PREFIX}${key}`);
      return null;
    }
    resultCache.set(key, parsed);
    return parsed.value;
  } catch { return null; }
}

function cacheSet(key, value) {
  const entry = { at: Date.now(), value };
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
