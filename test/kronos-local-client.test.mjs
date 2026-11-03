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
class FakeWorker {
  listeners = new Map();
  addEventListener(type, callback) {
    const callbacks = this.listeners.get(type) || [];
    callbacks.push(callback);
    this.listeners.set(type, callbacks);
  }
  postMessage(message) {
    if (message.type !== 'init') return;
    initAttempts += 1;
    const response = initAttempts === 1
      ? { type: 'error', id: message.id, code: 'MODEL_FILE_CORRUPT', detail: 'simulated stale cache' }
      : { type: 'ready', id: message.id, backend: 'wasm', adapter: null };
    queueMicrotask(() => {
      for (const callback of this.listeners.get('message') || []) callback({ data: response });
    });
  }
  terminate() {}
}
globalThis.Worker = FakeWorker;

const client = await import('../src/lib/kronosLocal/client.js');

test('prepareModel repairs a corrupt cached model once and retries engine startup', async () => {
  const phases = [];
  const result = await client.prepareModel({ onPhase: (phase) => phases.push(phase) });

  assert.equal(result.backend, 'wasm');
  assert.equal(initAttempts, 2, 'worker startup was retried once after model-cache repair');
  assert.equal(fileDownloads, 2, 'the model was downloaded again after removing the suspect cache');
  assert.deepEqual(phases, ['manifest', 'download', 'engine', 'download', 'engine']);
});

test('cleanup resets globals for this isolated test process', async () => {
  await client.forgetModel();
  delete globalThis.window;
  delete globalThis.Worker;
  delete globalThis.fetch;
  delete globalThis.caches;
});
