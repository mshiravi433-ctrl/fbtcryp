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

const { downloadModel, cachedModelState, readModelFile, deleteModel, fetchManifest, sha256Hex, KronosStorageError, modelCacheKey }
  = await import('../src/lib/kronosLocal/storage.js');
const { cacheName } = await import('../src/lib/kronosLocal/config.js');

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

test('model cache identity changes when any published file digest changes', () => {
  const base = {
    schema: 'fbt.kronos.browser.v1',
    model: { id: 'NeoQuasar/Kronos-mini' },
    files: [{ name: 'graph.onnx', bytes: 3, sha256: 'a'.repeat(64) }]
  };
  const nextRevision = {
    ...base,
    files: [{ ...base.files[0], sha256: 'b'.repeat(64) }]
  };
  assert.notEqual(cacheName(base), cacheName(nextRevision));
  assert.equal(cacheName(base), cacheName({ ...base }));
});

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

/*
 * ─── WHICH HOST ACTUALLY HAS THE FILES ─────────────────────────────────────
 * A deployment can have a host configured (VITE_KRONOS_MODEL_BASE_URL) and the
 * files served from its own origin — the build vendors them in. Presenting a
 * cross-origin 404 as «the model was never published» while 33 MB sit next to
 * index.html is the specific lie this covers: the manifest fetch must try the
 * next candidate, and the host that answered is the one the graphs come from.
 */
test('a dead configured host falls through to the app\'s own origin', async () => {
  const schema = { schema: 'fbt.kronos.browser.v1', files: [{ name: 'a.onnx', bytes: 1, sha256: 'x' }], totalBytes: 1 };
  const calls = [];
  const realFetch = globalThis.fetch;
  /* The same-origin candidate is derived from window.location; Node has none. */
  const hadWindow = 'window' in globalThis;
  globalThis.window = { location: { origin: 'https://app.example' } };
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes('dead.example')) return new Response('nope', { status: 404 });
    if (String(url).endsWith('/model-manifest.json')) {
      return new Response(JSON.stringify(schema), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('', { status: 200 });
  };
  try {
    const got = await fetchManifest({ base: 'https://dead.example/' });
    assert.equal(got.schema, schema.schema);
    assert.ok(calls.some((u) => u.startsWith('https://dead.example/')), 'the configured host is tried first');
    assert.ok(calls.some((u) => u === 'https://app.example/kronos-local/model-manifest.json'),
      'the app\'s own copy is tried second');
    assert.equal(calls.filter((u) => u.includes('model-manifest.json')).length, 2,
      'both candidates were attempted, in order');
  } finally {
    globalThis.fetch = realFetch;
    if (!hadWindow) delete globalThis.window;
  }
});

test('when no host answers, the error names the last attempt honestly', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('nope', { status: 404 });
  try {
    await assert.rejects(
      () => fetchManifest({ base: 'https://dead.example/' }),
      (err) => err.code === 'MANIFEST_HTTP_404'
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});

/*
 * Cache Storage keys are URLs. A relative name resolves against the caller's
 * base — the page for the downloader, the worker script for the engine — so
 * the two sides would never see the same entry. The stable key must not.
 */
test('a relative cache name differs for the page and the worker; modelCacheKey does not', () => {
  const relative = 'tokenizer-encode.onnx';
  const page = new URL(relative, 'https://fbtswap.ir/markets');
  const worker = new URL(relative, 'https://fbtswap.ir/assets/kronos.worker.js');
  assert.notEqual(page.href, worker.href, 'a relative name resolves differently for the page and the worker');
  assert.equal(page.origin, worker.origin);
  assert.equal(modelCacheKey(relative, page.origin), modelCacheKey(relative, worker.origin));
  assert.equal(modelCacheKey(relative, page.origin), 'https://fbtswap.ir/__fbt_kronos__/tokenizer-encode.onnx');
});

test('a file stored under the page URL is copied onto the stable key', async () => {
  const manifest = await manifestFor({ 'a.onnx': 'one' });
  memory.clear();
  const pageUrl = 'https://fbtswap.ir/coin/btc';
  const legacy = new URL('a.onnx', pageUrl).href;
  const { bytes } = body('one');
  memory.set(legacy, new Response(bytes));
  const buffer = await readModelFile(manifest, 'a.onnx', { pageUrl });
  assert.equal(new TextDecoder().decode(buffer), 'one');
  const stable = modelCacheKey('a.onnx');
  assert.notEqual(stable, legacy);
  assert.ok(memory.has(stable), 'the legacy hit is copied so the worker can read it');
});

test('a dead file host falls through before the graphs are given up', async () => {
  const files = { 'kronos-decode.onnx': 'graph-one' };
  const manifest = await manifestFor(files);
  const calls = [];
  const hadWindow = 'window' in globalThis;
  globalThis.window = { location: { origin: 'https://app.example' } };
  globalThis.fetch = async (url) => {
    const href = String(url);
    calls.push(href);
    if (href.startsWith('https://dead.example/')) throw new TypeError('failed to fetch');
    if (href.startsWith('https://app.example/kronos-local/')) return body('graph-one').response();
    return new Response('nope', { status: 404 });
  };
  memory.clear();
  try {
    const result = await downloadModel(manifest, { base: 'https://dead.example/kronos/' });
    assert.equal(result.verified, true);
    assert.ok(calls.some((u) => u.startsWith('https://dead.example/')));
    assert.ok(calls.some((u) => u.startsWith('https://app.example/kronos-local/kronos-decode.onnx')));
    const buffer = await readModelFile(manifest, 'kronos-decode.onnx');
    assert.equal(new TextDecoder().decode(buffer), 'graph-one');
  } finally {
    if (!hadWindow) delete globalThis.window;
  }
});

test('bytes above 1 MB are assembled from 206 ranges', async () => {
  const size = 1024 * 1024 + 7;
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) bytes[i] = i % 251;
  const sha = await sha256Hex(bytes.buffer);
  const manifest = {
    schema: 'fbt.kronos.browser.v1',
    model: { id: 'NeoQuasar/Kronos-mini' },
    files: [{ name: 'big.onnx', bytes: size, sha256: sha }],
    totalBytes: size
  };
  const ranges = [];
  globalThis.fetch = async (_url, init) => {
    const range = init?.headers?.Range || '';
    ranges.push(range);
    const match = /bytes=(\d+)-(\d+)/.exec(range);
    if (!match) return new Response(bytes, { status: 200 });
    const start = Number(match[1]);
    const end = Number(match[2]);
    return new Response(bytes.subarray(start, end + 1), {
      status: 206,
      headers: { 'content-range': `bytes ${start}-${end}/${size}` }
    });
  };
  memory.clear();
  const result = await downloadModel(manifest, { base: 'https://range.example/' });
  assert.equal(result.verified, true);
  assert.ok(ranges.every((range) => range.startsWith('bytes=')), 'large files ask for ranges');
  assert.ok(ranges.length >= 2, 'the body is stitched from more than one range');
  const back = new Uint8Array(await readModelFile(manifest, 'big.onnx'));
  assert.equal(back.byteLength, size);
  assert.equal(back[0], bytes[0]);
  assert.equal(back[size - 1], bytes[size - 1]);
  assert.equal(back[1024 * 1024], bytes[1024 * 1024]);
});

test('an HTML 200 is not a model file, so the next host is tried', async () => {
  const files = { 'kronos-decode.onnx': 'graph-one' };
  const manifest = await manifestFor(files);
  globalThis.fetch = async (url) => {
    if (String(url).includes('spa.example')) {
      return new Response('<!doctype html><html><body>missing</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' }
      });
    }
    return body('graph-one').response();
  };
  memory.clear();
  const result = await downloadModel(manifest, { base: 'https://spa.example/' });
  assert.equal(result.verified, true);
  assert.equal(new TextDecoder().decode(await readModelFile(manifest, 'kronos-decode.onnx')), 'graph-one');
});
