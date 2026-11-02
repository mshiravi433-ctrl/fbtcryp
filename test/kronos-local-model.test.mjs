/**
 * REAL-MODEL test for the on-device Kronos engine.
 * ================================================
 *
 * This is not a mock: it loads the four exported ONNX graphs (produced by
 * `scripts/kronos-export-onnx.py` from the official NeoQuasar/Kronos-mini +
 * Kronos-Tokenizer-2k weights) into onnxruntime-web — the same package and
 * engine version as the browser worker, but its NODE entry point (see below) —
 * and compares a full forecast against the reference implementation (`KronosPredictor.predict(..., top_k=1)`, which is
 * deterministic) stored in test/fixtures/kronos-reference.json.
 *
 * ─── WHAT THIS TEST CANNOT TELL YOU ────────────────────────────────────────
 * `import('onnxruntime-web')` in NODE resolves to `ort.node.min.mjs`, which opens
 * its engine from node_modules with `fs`. It is NOT the bundle the browser runs
 * and it never looks at dist/. This file proves the model numerics; it does not
 * prove the browser can start the engine (that was a production outage: the
 * glue module 404ed while this test stayed green). The browser bundle is
 * covered, as far as Node can, by test/kronos-ort-dist.test.mjs — and fully
 * only by opening the chart in a real browser. See docs/kronos-local-browser.md.
 *
 * Skipped when the graphs are not present (they are build artifacts, ~33 MB,
 * deliberately not committed). CI produces them, then runs this file.
 *
 *   node --test test/kronos-local-model.test.mjs
 *   KRONOS_ONNX_DIR=/path/to/kronos-local node --test test/kronos-local-model.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const ONNX_DIR = process.env.KRONOS_ONNX_DIR || join(ROOT, 'public', 'kronos-local');
const haveGraphs = existsSync(join(ONNX_DIR, 'model-manifest.json'))
  && existsSync(join(ONNX_DIR, 'kronos-decode.onnx'));

/*
 * ─── THE REFERENCE IS A RECORDED RUN, AND IT SAYS SO ───────────────────────
 * test/fixtures/kronos-reference.json holds the output of
 * `KronosPredictor.predict(..., top_k=1)` on the committed candle window. It
 * is produced by scripts/kronos-make-fixture.py from the official weights and
 * is deterministic for a given torch build — but NOT bit-identical across torch
 * versions or machines, so it carries its own provenance and this test refuses
 * to compare against a reference it cannot attribute.
 *
 *   KRONOS_REFRESH_REFERENCE=1 node --test test/kronos-local-model.test.mjs
 *     re-earns the reference from the real predictor, then asserts.
 *
 * The tolerance below is a round-off allowance for a 12-step autoregressive
 * decode, not a fudge factor: if the graphs and the reference ever disagree by
 * more than that, one of them is wrong and this test has to say so.
 */
const candles = JSON.parse(readFileSync(join(HERE, 'fixtures', 'kronos-candles.json'), 'utf8'));
const reference = JSON.parse(readFileSync(join(HERE, 'fixtures', 'kronos-reference.json'), 'utf8'));

/* Which weights, which torch, which exporter self-check produced these bars. */
const referenceProvenance = reference.provenance || null;

async function loadEngine() {
  const ort = await import('onnxruntime-web');
  ort.env.wasm.numThreads = 1;
  const manifest = JSON.parse(readFileSync(join(ONNX_DIR, 'model-manifest.json'), 'utf8'));
  const opts = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
  const sessions = {
    encode: await ort.InferenceSession.create(join(ONNX_DIR, manifest.tokenizer.encode), opts),
    decode: await ort.InferenceSession.create(join(ONNX_DIR, manifest.tokenizer.decode), opts),
    transformer: await ort.InferenceSession.create(join(ONNX_DIR, 'kronos-decode.onnx'), opts),
    s2head: await ort.InferenceSession.create(join(ONNX_DIR, 'kronos-s2head.onnx'), opts),
    backend: 'wasm'
  };
  const { LocalKronos } = await import('../src/lib/kronosLocal/infer.js');
  return { ort, manifest, engine: new LocalKronos(ort, sessions, manifest) };
}

/*
 * THE MODEL MUST BE THE MODEL.
 * ---------------------------------
 * The reference fixture records the SHA-256 of the weights it was produced
 * from. Those two digests are the official Hugging Face LFS objects for
 * NeoQuasar/Kronos-mini and NeoQuasar/Kronos-Tokenizer-2k (MIT). Pinning them
 * here means "the forecast" cannot quietly become a different model — a
 * differently-sized Kronos, a fine-tune, or a locally trained stand-in — while
 * every other test still passes, because they would all compare the new model
 * against a reference produced by the new model.
 *
 * Runs even when the 33 MB graphs are absent, which is every fresh clone.
 */
const OFFICIAL_WEIGHTS = {
  'Kronos-mini/model.safetensors': 'a7d5f37e2e9fbd9891f7d7d4f72574512dd1f704fee14223e0a8cd0fbf54197c',
  'Kronos-Tokenizer-2k/model.safetensors': 'b97ec46b3b72160509e289183eaf7bdf5f0dac5bb9b49522f6d46638a99a8717'
};

test('the committed reference came from the official MIT weights', () => {
  assert.ok(referenceProvenance, 'kronos-reference.json must record its provenance');
  assert.equal(referenceProvenance.model, 'NeoQuasar/Kronos-mini');
  assert.equal(referenceProvenance.tokenizer, 'NeoQuasar/Kronos-Tokenizer-2k');
  for (const [name, digest] of Object.entries(OFFICIAL_WEIGHTS)) {
    assert.equal(referenceProvenance.weightsSha256?.[name], digest,
      `${name} is not the published NeoQuasar checkpoint — the forecast would be a different model`);
  }
  assert.equal(reference.model, 'NeoQuasar/Kronos-mini');
  assert.equal(reference.horizon, reference.candles.length);
});

test('the context window is capped, never silently exceeded', { skip: !haveGraphs && 'onnx graphs not exported' }, async () => {
  const { manifest, engine } = await loadEngine();
  assert.equal(manifest.model.license, 'MIT');
  /* The browser cap is stated in the manifest and is what the phone pays for;
     the checkpoint's own 2048 is deliberately not used. */
  assert.ok(manifest.browserMaxContext <= 512, 'the mobile context cap is in force');
  assert.equal(engine.maxContext, Math.min(manifest.browserMaxContext, manifest.model.contextLimit));

  /*
   * 220 bars go in; the engine uses a window that leaves room for the horizon,
   * so no bar is ever evicted mid-decode (which is the assumption that makes
   * the KV cache equal to the reference's full recompute). The cap is applied
   * by slicing — a documented behaviour, not a failure — and the result reports
   * the window it actually used.
   */
  const horizon = 12;
  const out = await engine.forecast(candles.candles, { horizon, topK: 1 });
  assert.ok(out.options.window <= engine.maxContext - horizon,
    `window ${out.options.window} + horizon ${horizon} must fit ${engine.maxContext}`);
  assert.equal(out.candles.length, horizon);
  assert.equal(engine.fitsContext(out.options.window, horizon), true);
});

test('real Kronos graphs reproduce the reference predictor', { skip: !haveGraphs && 'onnx graphs not exported' }, async (t) => {
  const { manifest, engine } = await loadEngine();
  assert.equal(manifest.schema, 'fbt.kronos.browser.v1');
  assert.equal(manifest.model.id, 'NeoQuasar/Kronos-mini');
  assert.ok(manifest.totalBytes > 30e6 && manifest.totalBytes < 40e6, 'model download stays under ~40 MB');

  const started = Date.now();
  const out = await engine.forecast(candles.candles, {
    horizon: reference.horizon, temperature: 1, topP: 1, topK: 1
  });
  const elapsed = Date.now() - started;

  assert.equal(out.provider, 'kronos-local');
  assert.equal(out.candles.length, reference.horizon);
  assert.equal(out.intervalMs, candles.step);
  assert.equal(out.repaired, 0, 'reference input must not need OHLC repair');

  let worst = 0;
  for (let i = 0; i < reference.horizon; i += 1) {
    const got = out.candles[i];
    const want = reference.candles[i];
    assert.equal(got.t, want.t, `bar ${i} timestamp`);
    for (const key of ['o', 'h', 'l', 'c', 'v']) {
      const scale = Math.max(1e-9, Math.abs(want[key]));
      const rel = Math.abs(got[key] - want[key]) / scale;
      worst = Math.max(worst, rel);
      assert.ok(rel < 5e-3,
        `bar ${i}.${key}: onnx=${got[key]} reference=${want[key]} rel=${rel.toExponential(2)}`);
    }
    assert.ok(got.h >= Math.max(got.o, got.c) - 1e-9, `bar ${i} high`);
    assert.ok(got.l <= Math.min(got.o, got.c) + 1e-9, `bar ${i} low`);
  }
  t.diagnostic(`worst relative deviation vs reference: ${worst.toExponential(2)}`);
  t.diagnostic(`engine wall time: ${elapsed} ms (${out.timing.generateMs} ms in the token loop)`);
});

test('engine refuses short windows and invalid horizons', { skip: !haveGraphs && 'onnx graphs not exported' }, async () => {
  const { engine } = await loadEngine();
  await assert.rejects(
    () => engine.forecast(candles.candles.slice(0, 10), { horizon: 8 }),
    (err) => err.code === 'INSUFFICIENT_CANDLES'
  );
  const out = await engine.forecast(candles.candles.slice(0, 60), { horizon: 400, topK: 1 });
  assert.equal(out.candles.length, 48, 'horizon is clamped to the mobile budget');
});

test('cancellation stops the loop and reports CANCELLED', { skip: !haveGraphs && 'onnx graphs not exported' }, async () => {
  const { engine } = await loadEngine();
  let calls = 0;
  await assert.rejects(
    () => engine.forecast(candles.candles, {
      horizon: 24, topK: 1, shouldCancel: () => (calls += 1) > 4
    }),
    (err) => err.code === 'CANCELLED'
  );
});
