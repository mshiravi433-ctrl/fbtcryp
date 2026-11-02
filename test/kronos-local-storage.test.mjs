/**
 * Model files on the device — download, verify, cancel, delete.
 * =============================================================
 * The failure modes this feature actually meets on a phone are not "the maths
 * is wrong", they are: the connection dropped mid-file, the cache came back
 * corrupt, the reader pressed Stop, or the browser evicted everything. Each one
 * has to end in a state the UI can explain — never in "the model is ready" with
 * half a graph on disk.
 *
 * Node 22 has fetch/Response/crypto.subtle but no Cache Storage, so a small
 * in-memory stand-in is installed for the duration of the file.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const memory = new Map();

class MemoryCache {
  async match(name) { return memory.get(name)?.clone?.() ?? memory.get(name); }
  async put(name, response) { memory.set(name, response); }
  async delete(name) { return memory.delete(name); }
}

const fakeCaches = {
  open: async (name) => { fakeCaches._last = name; return new MemoryCache(); },
  delete: async (name) => { memory.clear(); return true; },
  keys: async () => [fakeCaches._last || 'fbt-kronos-test']
};

globalThis.caches = fakeCaches;

const { downloadModel, cachedModelState, readModelFile, deleteModel, fetchManifest, sha256Hex, KronosStorageError }
  = await import('../src/lib/kronosLocal/storage.js');

const BASE = 'https://models.example/';

function body(text) {
  const bytes = new TextEncoder().encode(text);
  return { bytes, response: () => new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.byteLength) } }) };
}

async function manifestFor(files) {
  const out = [];
  for (const [name, text] of Object.entries(files)) {
    const { bytes } = body(text);
    out.push({ name, bytes: bytes.byteLength, sha256: await sha256Hex(bytes.buffer) });
  }
  return {
    schema: 'fbt.kronos.browser.v1',
    model: { id: 'NeoQuasar/Kronos-mini' },
    tokenizer: { encode: 'tokenizer-encode.onnx', decode: 'tokenizer-decode.onnx' },
    files: out,
    totalBytes: out.reduce((sum, f) => sum + f.bytes, 0)
  };
}

function serve(map) {
  globalThis.fetch = async (url) => {
    const name = String(url).replace(BASE, '');
    if (!(name in map)) return new Response('nope', { status: 404 });
    return map[name]();
  };
}

test('a complete download is verified and readable back', async () => {
  const files = { 'kronos-decode.onnx': 'graph-one' };
  const manifest = await manifestFor(files);
  serve({ 'kronos-decode.onnx': body('graph-one').response });
  memory.clear();

  const progress = [];
  const result = await downloadModel(manifest, { base: BASE, onProgress: (p) => progress.push(p) });

  assert.equal(result.verified, true);
  assert.equal(result.bytes, manifest.files[0].bytes);
  assert.ok(progress.length >= 1);
  assert.equal(progress.at(-1).loaded, manifest.totalBytes);

  const state = await cachedModelState(manifest);
  assert.equal(state.downloaded, true);
  assert.equal(state.bytes, manifest.totalBytes);

  const buffer = await readModelFile(manifest, 'kronos-decode.onnx');
  assert.equal(new TextDecoder().decode(buffer), 'graph-one');
});

test('a corrupt file is refused and the partial cache is discarded', async () => {
  const files = { 'kronos-decode.onnx': 'graph-one' };
  const manifest = await manifestFor(files);
  serve({ 'kronos-decode.onnx': body('graph-ONE').response }); // one byte differs
  memory.clear();

  await assert.rejects(
    () => downloadModel(manifest, { base: BASE }),
    (error) => error instanceof KronosStorageError && error.code === 'MODEL_FILE_CORRUPT'
  );
  const state = await cachedModelState(manifest);
  assert.equal(state.downloaded, false, 'a bad download must never look complete');
});

test('a truncated body is caught before the hash is even trusted', async () => {
  const files = { 'kronos-decode.onnx': 'graph-one' };
  const manifest = await manifestFor(files);
  globalThis.fetch = async () => new Response('graph', { status: 200 });
  memory.clear();
  await assert.rejects(
    () => downloadModel(manifest, { base: BASE }),
    (error) => error.code === 'MODEL_FILE_TRUNCATED'
  );
});

test('cancel propagates as an AbortError and leaves nothing usable', async () => {
  const files = { 'kronos-decode.onnx': 'graph-one' };
  const manifest = await manifestFor(files);
  const controller = new AbortController();
  globalThis.fetch = async () => {
    controller.abort();
    const error = new Error('aborted');
    error.name = 'AbortError';
    throw error;
  };
  memory.clear();
  await assert.rejects(() => downloadModel(manifest, { base: BASE, signal: controller.signal }),
    (error) => error.name === 'AbortError');
  assert.equal((await cachedModelState(manifest)).downloaded, false);
});

test('a missing file on the host is reported by name-free code', async () => {
  const files = { 'kronos-decode.onnx': 'graph-one' };
  const manifest = await manifestFor(files);
  serve({});
  memory.clear();
  await assert.rejects(() => downloadModel(manifest, { base: BASE }),
    (error) => error.code === 'MODEL_FILE_HTTP_404');
});

test('an incomplete cache is not reported as downloaded', async () => {
  const files = { 'a.onnx': 'one', 'b.onnx': 'two' };
  const manifest = await manifestFor(files);
  serve({ 'a.onnx': body('one').response });
  memory.clear();
  await assert.rejects(() => downloadModel(manifest, { base: BASE }),
    (error) => error.code === 'MODEL_FILE_HTTP_404');
  assert.equal((await cachedModelState(manifest)).downloaded, false);
});

test('reading a file that was never stored fails loudly', async () => {
  const manifest = await manifestFor({ 'a.onnx': 'one' });
  memory.clear();
  await assert.rejects(() => readModelFile(manifest, 'a.onnx'),
    (error) => error.code === 'MODEL_NOT_DOWNLOADED');
  await assert.rejects(() => readModelFile(manifest, 'nope.onnx'),
    (error) => error.code === 'MODEL_FILE_UNKNOWN');
});

test('deleteModel removes the bucket and the remembered manifest', async () => {
  const manifest = await manifestFor({ 'a.onnx': 'one' });
  serve({ 'a.onnx': body('one').response });
  memory.clear();
  await downloadModel(manifest, { base: BASE });
  assert.equal((await cachedModelState(manifest)).downloaded, true);
  await deleteModel(manifest);
  assert.equal((await cachedModelState(manifest)).downloaded, false);
});

test('the manifest itself is validated, not trusted', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ schema: 'something-else' }), { status: 200 });
  await assert.rejects(() => fetchManifest({ base: BASE }), (error) => error.code === 'MANIFEST_INVALID');

  globalThis.fetch = async () => new Response('not json', { status: 200 });
  await assert.rejects(() => fetchManifest({ base: BASE }));

  globalThis.fetch = async () => { throw new TypeError('offline'); };
  await assert.rejects(() => fetchManifest({ base: BASE }), (error) => error.code === 'MANIFEST_UNREACHABLE');
});
