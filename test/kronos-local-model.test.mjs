/**
 * REAL-MODEL test for the on-device Kronos engine.
 * ================================================
 *
 * This is not a mock: it loads the four exported ONNX graphs (produced by
 * `scripts/kronos-export-onnx.py` from the official NeoQuasar/Kronos-mini +
 * Kronos-Tokenizer-2k weights) into onnxruntime-web — the exact runtime the
 * browser worker uses — and compares a full forecast against the reference
 * implementation (`KronosPredictor.predict(..., top_k=1)`, which is
 * deterministic) stored in test/fixtures/kronos-reference.json.
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

const candles = JSON.parse(readFileSync(join(HERE, 'fixtures', 'kronos-candles.json'), 'utf8'));
const reference = JSON.parse(readFileSync(join(HERE, 'fixtures', 'kronos-reference.json'), 'utf8'));

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
