/**
 * BUNDLE TEST — runs what `vite build` SHIPPED, not what node_modules contains.
 * =============================================================================
 *
 * Why this file exists
 * --------------------
 * The on-device forecast shipped broken in production — «موتور محلی روی این
 * دستگاه بالا نیامد» (SESSION_FAILED) after every user had downloaded the full
 * 33 MB model — while every test was green. The reason is a gap, not a typo:
 *
 *   test/kronos-local-model.test.mjs  does  import('onnxruntime-web')  in NODE.
 *   Node resolves that to `ort.node.min.mjs` and opens the engine files from
 *   node_modules with `fs`. It never loads the browser bundle, never looks at
 *   dist/, and so cannot see that the browser bundle asks for
 *   `ort-wasm-simd-threaded.mjs` — a file the build never wrote.
 *
 * This test closes the gap from the other side. It takes the browser bundle
 * the worker chunk in dist/ really imports, configures it exactly as the
 * worker does (env.wasm.wasmPaths = the same-origin engine folder, here
 * mapped onto dist/ because Node has no origin), and builds an
 * InferenceSession from the model files in dist/. If the bundle cannot find
 * its engine in dist/, this fails with the same ERR_MODULE_NOT_FOUND a browser
 * reports as a 404.
 *
 * What it still does NOT prove: that a real browser runs it. Node is not a
 * browser — no Worker, no fetch of the glue, no CSP, no cross-origin
 * isolation, no WebGPU. See docs/kronos-local-browser.md → "Verified / not".
 *
 *   NODE_OPTIONS='--max-old-space-size=2700 --max-semi-space-size=16' npx vite build && npm run test:kronos-dist
 *   KRONOS_DIST_REQUIRED=1 …   # fail instead of skip when dist/ is missing
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST = join(ROOT, 'dist');
const ASSETS = join(DIST, 'assets');
const ENGINE_DIR = join(DIST, 'kronos-ort');
const MODEL_DIR = join(DIST, 'kronos-local');
const required = process.env.KRONOS_DIST_REQUIRED === '1';

const ready = existsSync(ASSETS) && existsSync(join(MODEL_DIR, 'model-manifest.json'));
const skip = !ready && !required
  ? 'dist/ with dist/kronos-local/ is missing — run the build first (this test inspects build OUTPUT)'
  : false;

const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const assetsOf = (re) => readdirSync(ASSETS).filter((name) => re.test(name));

test('dist/ is present (KRONOS_DIST_REQUIRED=1 turns a skip into a failure)', { skip: !required }, () => {
  assert.ok(existsSync(ASSETS), 'dist/assets is missing — build before running this test');
  assert.ok(existsSync(join(MODEL_DIR, 'model-manifest.json')),
    'dist/kronos-local/model-manifest.json is missing — run scripts/fetch-kronos-model.mjs before building');
});

/** The ORT chunk(s) the worker chunk dynamically imports — i.e. what the browser runs. */
function workerChunk() {
  const files = assetsOf(/^kronos\.worker-.*\.js$/);
  assert.equal(files.length, 1, `expected exactly one built worker chunk in dist/assets, found: ${files.join(', ') || 'none'}`);
  const source = readFileSync(join(ASSETS, files[0]), 'utf8');
  const imports = [...source.matchAll(/import\(\s*["']\.\/([^"']+\.js)["']\s*\)/g)].map((m) => m[1]);
  const wasm = imports.find((name) => /^ort\.wasm[.-]/.test(name));
  const webgpu = imports.find((name) => /^ort\.webgpu[.-]/.test(name));
  assert.ok(wasm, `the worker chunk does not import a WASM ORT chunk (imports: ${imports.join(', ')})`);
  assert.ok(webgpu, `the worker chunk does not import a WebGPU ORT chunk (imports: ${imports.join(', ')})`);
  return { file: files[0], source, wasm, webgpu };
}

test('worker chunk points ORT at the self-hosted engine folder (wasmPaths is set)', { skip }, () => {
  const { source } = workerChunk();
  assert.match(source, /wasmPaths\s*=/, 'the built worker never assigns env.wasm.wasmPaths — ORT would look next to its own chunk in /assets/');
  assert.match(source, /kronos-ort/, 'the built worker does not reference the kronos-ort engine folder');
});

test('every engine file the ORT chunks request by name exists in dist/kronos-ort and is byte-identical to onnxruntime-web', { skip }, () => {
  const { wasm, webgpu } = workerChunk();
  for (const chunk of [wasm, webgpu]) {
    const text = readFileSync(join(ASSETS, chunk), 'utf8');
    const named = [...new Set([...text.matchAll(/ort-wasm-simd-threaded(?:\.asyncify)?\.(?:mjs|wasm)/g)].map((m) => m[0]))];
    assert.ok(named.length > 0, `${chunk} names no engine file — has the ORT layout changed?`);
    for (const name of named) {
      const shipped = join(ENGINE_DIR, name);
      assert.ok(existsSync(shipped), `${chunk} requests ${name}, but dist/kronos-ort/${name} does not exist (browser: 404 → SESSION_FAILED)`);
      const source = join(ROOT, 'node_modules', 'onnxruntime-web', 'dist', name);
      assert.equal(sha(shipped), sha(source), `dist/kronos-ort/${name} is not the installed onnxruntime-web file`);
    }
  }
});

test('the engine exists once: no second hashed copy of the .wasm in dist/assets', { skip }, () => {
  assert.deepEqual(assetsOf(/\.wasm$/), [], 'dist/assets contains a .wasm — the extern-wasm condition is not applied, so a 12–25 MB duplicate ships');
});

test('no worker URL or token reaches the browser bundle', { skip }, () => {
  for (const name of assetsOf(/\.(js|mjs)$/)) {
    const text = readFileSync(join(ASSETS, name), 'utf8');
    assert.ok(!/KRONOS_WORKER_(URL|TOKEN)/.test(text), `${name} mentions KRONOS_WORKER_*`);
  }
});

test('WASM path: the browser bundle from dist/assets builds a session from dist/kronos-local', { skip }, async () => {
  const { wasm } = workerChunk();
  const mod = await import(pathToFileURL(join(ASSETS, wasm)).href);
  const ort = mod.default || mod;
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  // Node has no origin: map the same-origin engine folder onto dist/.
  ort.env.wasm.wasmPaths = `${pathToFileURL(ENGINE_DIR).href}/`;

  const manifest = JSON.parse(readFileSync(join(MODEL_DIR, 'model-manifest.json'), 'utf8'));
  const options = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
  const bytes = (name) => new Uint8Array(readFileSync(join(MODEL_DIR, name)));

  const s2head = await ort.InferenceSession.create(bytes('kronos-s2head.onnx'), options);
  assert.ok(s2head.inputNames.includes('context'), `inputs: ${s2head.inputNames}`);
  assert.ok(s2head.inputNames.includes('s1_id'), `inputs: ${s2head.inputNames}`);

  // Same four graphs the worker builds.
  for (const name of [manifest.tokenizer.encode, manifest.tokenizer.decode, 'kronos-decode.onnx']) {
    const session = await ort.InferenceSession.create(bytes(name), options);
    assert.ok(session.inputNames.length > 0, `${name} built a session with no inputs`);
  }
});

test('WebGPU path: the asyncify glue the WebGPU chunk requests loads as a module (cannot run: no GPU in Node)', { skip }, async () => {
  const glue = join(ENGINE_DIR, 'ort-wasm-simd-threaded.asyncify.mjs');
  assert.ok(existsSync(glue), 'dist/kronos-ort/ort-wasm-simd-threaded.asyncify.mjs is missing');
  const wasmFile = join(ENGINE_DIR, 'ort-wasm-simd-threaded.asyncify.wasm');
  assert.ok(existsSync(wasmFile) && statSync(wasmFile).size > 1e6, 'asyncify .wasm is missing or empty');
  const mod = await import(pathToFileURL(glue).href);
  assert.equal(typeof mod.default, 'function', 'asyncify glue has no default module factory');
});
