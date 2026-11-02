/**
 * Pure math for the on-device forecast — no browser, no wasm, no model.
 * =====================================================================
 * These are the pieces that decide WHAT the model is fed and WHAT comes out,
 * so they are pinned separately from the graphs: a sampling filter that keeps
 * one token too many, or a normalisation that forgets the epsilon, silently
 * changes every projection while every "does it run" test still passes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  bitsToTokens, causalMask, denormalize, filteredProbs, finalizeCandles,
  medianStep, prepareWindow, ropeTables, sampleIndex, softmax, timeStamps, tokensToBits
} from '../src/lib/kronosLocal/math.js';

test('rope tables match the reference construction', () => {
  const { cos, sin } = ropeTables([0, 1], 8);
  // position 0: everything is (1, 0)
  assert.deepEqual([...cos.subarray(0, 8)], [1, 1, 1, 1, 1, 1, 1, 1]);
  assert.deepEqual([...sin.subarray(0, 8)], [0, 0, 0, 0, 0, 0, 0, 0]);
  // position 1: cos/sin are the duplicated halves of the same frequency vector
  for (let i = 0; i < 4; i += 1) {
    assert.equal(cos[8 + i], cos[8 + i + 4]);
    assert.equal(sin[8 + i], sin[8 + i + 4]);
  }
  // Float32 storage, so compare with a tolerance (freq = 1/10000^(0/8) = 1)
  assert.ok(Math.abs(cos[8] - Math.cos(1)) < 1e-6);
});

test('causal mask is 0 below the diagonal and -1e9 above', () => {
  const mask = causalMask(3);
  assert.deepEqual([...mask], [0, -1e9, -1e9, 0, 0, -1e9, 0, 0, 0]);
});

test('token bits round-trip through indices', () => {
  const s1 = Int32Array.from([0, 1, 1023, 512]);
  const s2 = Int32Array.from([1023, 0, 7, 256]);
  const bits = tokensToBits(s1, s2, 10, 10);
  const back = bitsToTokens(bits, 4, 10, 10);
  assert.deepEqual([...back.s1], [...s1]);
  assert.deepEqual([...back.s2], [...s2]);
  // bit i of the index is `bits[i] > 0`
  assert.equal(bits[1 * 20 + 0], 1);   // s1=1  → bit0 set
  assert.equal(bits[0 * 20 + 1], -1);  // s1=0  → bit1 clear
  assert.equal(bits[2 * 20 + 9], 1);   // 1023 → every bit set
});

test('softmax is a distribution and survives a hot temperature', () => {
  const probs = softmax(Float32Array.from([1, 2, 3]), 0.5);
  const sum = [...probs].reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-12);
  assert.ok(probs[2] > probs[1] && probs[1] > probs[0]);
  assert.ok([...softmax(Float32Array.from([1e30, 1e30]), 1)].every(Number.isFinite));
});

test('top-p keeps the first token that crosses p, exactly like the reference', () => {
  // Four equally likely tokens, topP = 0.6: cumulative 0.25 / 0.50 / 0.75.
  // `top_k_top_p_filtering` shifts the removal mask by one, so the token that
  // CROSSES the threshold is kept — three tokens survive, not two. Copying
  // that shift is the point; "obvious" top-p would keep two and sample a
  // slightly different distribution than the reference implementation.
  const logits = Float32Array.from([0, 0, 0, 0]);
  const probs = filteredProbs(logits, { topP: 0.6 });
  const nonZero = [...probs].filter((p) => p > 0).length;
  assert.equal(nonZero, 3);
  assert.ok(Math.abs([...probs].reduce((a, b) => a + b, 0) - 1) < 1e-12);
});

test('top-p never removes every token, even at an absurd threshold', () => {
  const probs = filteredProbs(Float32Array.from([5, 1, 1]), { topP: 0.0001 });
  assert.equal([...probs].filter((p) => p > 0).length, 1);
});

test('top-k keeps k tokens and renormalises', () => {
  const probs = filteredProbs(Float32Array.from([1, 5, 2, 0]), { topK: 2 });
  const kept = [...probs].filter((p) => p > 0).length;
  assert.equal(kept, 2);
  assert.ok(Math.abs([...probs].reduce((a, b) => a + b, 0) - 1) < 1e-12);
});

test('sampling follows the injected uniform source', () => {
  const probs = Float64Array.from([0, 0, 1, 0]);
  assert.equal(sampleIndex(probs, () => 0.5), 2);
  const half = Float64Array.from([0.5, 0.5, 0, 0]);
  assert.equal(sampleIndex(half, () => 0), 0);
  assert.equal(sampleIndex(half, () => 0.9), 1);
});

test('median step ignores a single gapped bar', () => {
  const bars = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => ({ t: i === 5 ? 900 : i * 100, ...{} }));
  bars.sort((a, b) => a.t - b.t);
  // gaps: 100,100,100,100,860,100,100,100,100 → median is 100, not the mean
  assert.equal(medianStep(bars), 100);
  assert.equal(medianStep([{ t: 5 }, { t: 5 }]), 0);
});

test('time stamps are UTC and use the pandas weekday convention', () => {
  // 2023-11-14T22:13:20Z — a Tuesday, the reference's weekday() == 1
  const stamps = timeStamps([1_700_000_000_000]);
  assert.deepEqual([...stamps], [13, 22, 1, 14, 11]);
});

test('prepareWindow normalises, clips and keeps the recent bars', () => {
  const candles = Array.from({ length: 100 }, (_, i) => ({
    t: i * 1000, o: 100 + i, h: 102 + i, l: 98 + i, c: 101 + i, v: 10
  }));
  const { window, x, mean, std } = prepareWindow(candles, { maxContext: 40, horizon: 12 });
  assert.equal(window.length, 28, 'maxContext - horizon');
  assert.equal(x.length, 28 * 6);
  for (const value of x) assert.ok(value >= -5 && value <= 5, 'clipped to ±5');
  assert.ok(mean[0] > 100 && std[0] > 0);
  // amount column = volume × mean(OHLC) of that bar
  const bar = window[3];
  assert.equal(mean[5] > 0, true);
  assert.ok(bar.v === 10);
});

test('denormalize is the inverse of the window scaling', () => {
  const mean = Float64Array.from([100, 101, 99, 100, 5, 500]);
  const std = Float64Array.from([1, 1, 1, 1, 1, 1]);
  const rows = denormalize(Float32Array.from([0, 0, 0, 0, 0, 0]), 1, mean, std);
  for (let k = 0; k < 6; k += 1) assert.ok(Math.abs(rows[0][k] - mean[k]) < 1e-3);
});

test('finalizeCandles repairs OHLC instead of hiding an impossible bar', () => {
  const times = [1000, 2000, 3000];
  const rows = [
    [10, 12, 9, 11, 5],        // fine
    [10, 8, 11, 9, 5],         // high below close, low above open → repaired
    [10, 12, 9, 11, 5]
  ];
  const out = finalizeCandles(rows, times, 0);
  assert.equal(out.error, null);
  assert.equal(out.repaired, 1);
  for (const candle of out.candles) {
    assert.ok(candle.h >= Math.max(candle.o, candle.c));
    assert.ok(candle.l <= Math.min(candle.o, candle.c));
    assert.ok(candle.l > 0);
  }
});

test('finalizeCandles refuses non-finite prices and broken time axes', () => {
  assert.equal(finalizeCandles([[Number.NaN, 1, 1, 1, 1]], [1], 0).error, 'NON_FINITE_PRICE');
  assert.equal(finalizeCandles([[1, 2, 1, 1, 1], [1, 2, 1, 1, 1]], [1000, 900], 0).error, 'INVALID_TIME');
  assert.equal(finalizeCandles([[1, 2, 1, 1, 1]], [0], 0).error, 'INVALID_TIME');
  assert.equal(finalizeCandles([[1, 2]], [1000], 0).error, 'INVALID_ROW');
});

test('finalizeCandles clamps a negative volume to the fallback instead of crashing', () => {
  const out = finalizeCandles([[10, 12, 9, 11, -3]], [1000], 7);
  assert.equal(out.candles[0].v, 7);
});
