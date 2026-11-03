/**
 * KHRONOS LOCAL — the inference worker.
 * ====================================
 *
 * A module Web Worker. The UI thread never touches the model: a 220-bar
 * prefill plus a 12-token loop takes a few hundred milliseconds on a laptop
 * and a couple of seconds on a phone, and doing that on the main thread would
 * freeze the chart, the crosshair and the ability to press Cancel.
 *
 * Protocol (all messages are postMessage objects):
 *   → {type:'probe', id}
 *   → {type:'init', id, manifest}
 *   → {type:'predict', id, candles, horizon, temperature, topP, topK, seed}
 *   → {type:'cancel', id}
 *   → {type:'dispose', id}
 *   ← {type:'ready', id, backend, adapter}
 *   ← {type:'progress', id, phase, done, total}
 *   ← {type:'result', id, result}
 *   ← {type:'error', id, code, detail}
 *
 * Backend policy: WebGPU when the device actually produces an adapter AND the
 * session builds on it; otherwise the plain WASM engine. "navigator.gpu exists"
 * is not treated as support — the session has to construct and run.
 */

import { ORT_ASSET_PATH, RUNTIME_BYTES } from './config.js';
import { LocalKronos, EngineError } from './infer.js';
import { readModelFile } from './storage.js';

let ort = null;
let engine = null;
let backend = 'none';
let adapterInfo = null;
let currentJob = null;
let cancelled = false;

self.onmessage = (event) => {
  const msg = event.data || {};
  const { id, type } = msg;
  if (type === 'probe') probe(id).catch((err) => fail(id, err));
  else if (type === 'init') init(id, msg.manifest).catch((err) => fail(id, err));
  else if (type === 'predict') predict(id, msg).catch((err) => fail(id, err));
  else if (type === 'cancel') cancel(id);
  else if (type === 'dispose') dispose(id);
};

async function probe(id) {
  const info = await gpuInfo();
  post({ type: 'probe', id, webgpu: Boolean(info.ok), adapter: info.adapter, reason: info.reason,
    runtimeBytes: info.ok ? RUNTIME_BYTES.webgpu : RUNTIME_BYTES.wasm });
}

async function gpuInfo() {
  try {
    if (typeof navigator === 'undefined' || !navigator.gpu) return { ok: false, reason: 'NO_WEBGPU' };
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return { ok: false, reason: 'NO_ADAPTER' };
    const info = adapter.info || {};
    const label = [info.vendor, info.architecture, info.description].filter(Boolean).join(' ').trim();
    return { ok: true, adapter: label || 'webgpu' };
  } catch (error) {
    return { ok: false, reason: String(error?.message || 'WEBGPU_ERROR') };
  }
}

/** Load the ONNX runtime + build sessions from the device cache. */
async function init(id, manifest) {
  if (engine && backend !== 'none') {
    post({ type: 'ready', id, backend, adapter: adapterInfo, runtimeBytes: 0 });
    return;
  }
  const gpu = await gpuInfo();
  const options = (ep) => ({ executionProviders: [ep], graphOptimizationLevel: 'all' });
  let used = gpu.ok ? 'webgpu' : 'wasm';
  let sessions;
  let primaryError = null;

  try {
    /* Include the dynamic import in the fallback boundary. A device can expose
       an adapter and still fail to load the WebGPU runtime chunk (policy, CSP,
       stale deployment cache); that must fall back to WASM just like a failed
       WebGPU session, not abort initialization before the fallback is tried. */
    ort = (await loadOrt(used)).ort;
    configureOrt(ort);
    sessions = await buildSessions(manifest, options(used));
    backend = used;
  } catch (error) {
    if (isModelStorageError(error)) throw error;
    if (used !== 'wasm') {
      primaryError = error;
      try {
        used = 'wasm';
        ort = (await loadOrt('wasm')).ort;
        configureOrt(ort);
        sessions = await buildSessions(manifest, options('wasm'));
        backend = 'wasm';
      } catch (fallbackError) {
        if (isModelStorageError(fallbackError)) throw fallbackError;
        throw new EngineError('SESSION_FAILED', [primaryError, fallbackError]
          .map((cause) => String(cause?.message || cause || ''))
          .filter(Boolean).join(' | ').slice(0, 200));
      }
    } else {
      throw new EngineError('SESSION_FAILED', String(error?.message || ''));
    }
  }
  sessions.backend = backend;
  engine = new LocalKronos(ort, sessions, manifest);
  adapterInfo = backend === 'webgpu' ? gpu.adapter : null;
  post({ type: 'ready', id, backend, adapter: adapterInfo, runtimeBytes: RUNTIME_BYTES[backend] || 0 });
}

function configureOrt(runtime) {
  /* MUST precede every InferenceSession.create: ORT requests its engine glue by
     name relative to this folder (public/kronos-ort/). If unset, it asks
     /assets/ for a file the build never emits. */
  if (ORT_ASSET_PATH) runtime.env.wasm.wasmPaths = ORT_ASSET_PATH;
  /* Threads need SharedArrayBuffer, which needs cross-origin isolation. Most
     deployments do not have it (and iOS Safari never does), so default to a
     single thread rather than failing at session creation. */
  runtime.env.wasm.numThreads = isIsolated()
    ? Math.min(4, Math.max(1, (self.navigator?.hardwareConcurrency || 4) - 1))
    : 1;
  runtime.env.wasm.simd = true;
  runtime.env.wasm.proxy = false;
  runtime.env.logLevel = 'error';
}

async function loadOrt(ep) {
  if (ep === 'webgpu') {
    const mod = await import('onnxruntime-web/webgpu');
    return { ort: mod, ep: 'webgpu' };
  }
  const mod = await import('onnxruntime-web/wasm');
  return { ort: mod, ep: 'wasm' };
}

async function buildSessions(manifest, options) {
  const bytes = async (name) => new Uint8Array(await readModelFile(manifest, name));
  const [encode, decode, transformer, s2head] = await Promise.all([
    bytes(manifest.tokenizer.encode),
    bytes(manifest.tokenizer.decode),
    bytes('kronos-decode.onnx'),
    bytes('kronos-s2head.onnx')
  ]);
  return {
    encode: await ort.InferenceSession.create(encode, options),
    decode: await ort.InferenceSession.create(decode, options),
    transformer: await ort.InferenceSession.create(transformer, options),
    s2head: await ort.InferenceSession.create(s2head, options)
  };
}

async function predict(id, msg) {
  if (!engine) {
    post({ type: 'error', id, code: 'MODEL_NOT_READY', detail: '' });
    return;
  }
  if (currentJob) {
    // One forecast at a time, always: a second concurrent run on a phone is
    // how you turn a slow forecast into an out-of-memory tab crash.
    post({ type: 'error', id, code: 'BUSY', detail: currentJob });
    return;
  }
  currentJob = id;
  cancelled = false;
  const random = msg.seed != null ? seededRandom(msg.seed) : Math.random;
  try {
    post({ type: 'progress', id, phase: 'preparing', done: 0, total: 1 });
    const result = await engine.forecast(msg.candles, {
      horizon: msg.horizon,
      temperature: msg.temperature,
      topP: msg.topP,
      topK: msg.topK,
      random,
      shouldCancel: () => cancelled,
      onStep: (info) => post({ type: 'progress', id, ...info })
    });
    if (!cancelled) post({ type: 'result', id, result });
    else post({ type: 'error', id, code: 'CANCELLED', detail: '' });
  } catch (error) {
    if (error instanceof EngineError) {
      post({ type: 'error', id, code: error.code, detail: error.detail });
    } else {
      const message = String(error?.message || error || '');
      // Out-of-memory shows up as a RangeError or a failed allocation deep in
      // the runtime; it is reported as such instead of a blank "failed".
      const oom = /allocate|out of memory|Array buffer allocation|OOM|RangeError/i.test(message);
      post({ type: 'error', id, code: oom ? 'OUT_OF_MEMORY' : 'INFERENCE_FAILED', detail: message.slice(0, 200) });
    }
  } finally {
    currentJob = null;
  }
}

function cancel(id) {
  if (currentJob && (id == null || id === currentJob)) cancelled = true;
  post({ type: 'cancelled', id });
}

function dispose(id) {
  engine = null;
  backend = 'none';
  ort = null;
  post({ type: 'disposed', id });
}

function post(payload) {
  try { self.postMessage(payload); } catch { /* worker is going away */ }
}

function fail(id, error) {
  post({
    type: 'error',
    id,
    code: error?.code || 'WORKER_ERROR',
    detail: String(error?.message || error || '').slice(0, 200)
  });
}

function isModelStorageError(error) {
  return ['MODEL_FILE_CORRUPT', 'MODEL_FILE_TRUNCATED', 'MODEL_NOT_DOWNLOADED', 'CACHE_UNAVAILABLE']
    .includes(error?.code);
}

function isIsolated() {
  try { return Boolean(self.crossOriginIsolated); } catch { return false; }
}

/** Small deterministic PRNG (mulberry32) for reproducible tests. */
function seededRandom(seed) {
  let a = Number(seed) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
