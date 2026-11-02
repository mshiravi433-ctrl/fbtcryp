/**
 * KHRONOS LOCAL — pure numeric helpers for the on-device Kronos forecast.
 * ======================================================================
 *
 * Everything here is dependency-free and deterministic so it can be unit
 * tested in Node without a browser, a GPU or the model files. The functions
 * are transcriptions of the reference implementation in
 * `forecast/kronos_model/kronos.py` (MIT, shiyu-coder/Kronos) — when in doubt,
 * that file wins.
 */

/** Rotary tables. Positions are explicit: the JS side owns them, the ONNX
 *  graphs never compute them (fewer ops for the WebGPU backend, and it keeps
 *  prefill/incremental stepping on exactly the same table). */
export function ropeTables(positions, headDim) {
  const half = Math.floor(headDim / 2);
  const cos = new Float32Array(positions.length * headDim);
  const sin = new Float32Array(positions.length * headDim);
  for (let p = 0; p < positions.length; p += 1) {
    const pos = positions[p];
    for (let i = 0; i < half; i += 1) {
      const invFreq = 1 / (10000 ** ((2 * i) / headDim));
      const angle = pos * invFreq;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      cos[p * headDim + i] = c;
      cos[p * headDim + i + half] = c;
      sin[p * headDim + i] = s;
      sin[p * headDim + i + half] = s;
    }
  }
  return { cos, sin };
}

/** Additive causal mask [1, 1, t, t]: 0 on/below the diagonal, -1e9 above.
 *  -1e9 (not -Infinity) keeps fp32 Softmax finite, matching the exporter. */
export function causalMask(t) {
  const out = new Float32Array(t * t);
  for (let i = 0; i < t; i += 1) {
    for (let j = 0; j < t; j += 1) out[i * t + j] = j <= i ? 0 : -1e9;
  }
  return out;
}

/**
 * Pack the 20 bipolar BSQ bits back into the two 10-bit token ids the
 * transformer expects. `bits[i] > 0` is bit i, exactly like
 * `BinarySphericalQuantizer.codes_to_indexes` +
 * `BSQuantizer.bits_to_indices`.
 */
export function bitsToTokens(bits, seqLen, s1Bits, s2Bits) {
  const s1 = new Int32Array(seqLen);
  const s2 = new Int32Array(seqLen);
  for (let t = 0; t < seqLen; t += 1) {
    let a = 0;
    let b = 0;
    for (let i = 0; i < s1Bits; i += 1) if (bits[t * (s1Bits + s2Bits) + i] > 0) a |= 1 << i;
    for (let i = 0; i < s2Bits; i += 1) if (bits[t * (s1Bits + s2Bits) + s1Bits + i] > 0) b |= 1 << i;
    s1[t] = a;
    s2[t] = b;
  }
  return { s1, s2 };
}

/** Inverse of `bitsToTokens` → the [±1] input tensor the decoder eats. */
export function tokensToBits(s1, s2, s1Bits, s2Bits) {
  const seqLen = s1.length;
  const width = s1Bits + s2Bits;
  const out = new Float32Array(seqLen * width);
  for (let t = 0; t < seqLen; t += 1) {
    for (let i = 0; i < s1Bits; i += 1) out[t * width + i] = ((s1[t] >> i) & 1) ? 1 : -1;
    for (let i = 0; i < s2Bits; i += 1) out[t * width + s1Bits + i] = ((s2[t] >> i) & 1) ? 1 : -1;
  }
  return out;
}

/** Softmax over a Float32Array view (numerically stable, in place on a copy). */
export function softmax(logits, temperature = 1) {
  const n = logits.length;
  let max = -Infinity;
  for (let i = 0; i < n; i += 1) {
    const v = logits[i] / temperature;
    if (v > max) max = v;
  }
  const probs = new Float64Array(n);
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    const e = Math.exp(logits[i] / temperature - max);
    probs[i] = e;
    sum += e;
  }
  for (let i = 0; i < n; i += 1) probs[i] /= sum;
  return probs;
}

/**
 * Top-k / top-p filtering, faithful to `top_k_top_p_filtering` in the
 * reference: the "keep at least one token above the threshold" shift is
 * reproduced, not simplified — the last kept token is the first one whose
 * cumulative probability crosses `topP`.
 *
 * @returns {Float64Array} filtered probability distribution (sums to 1)
 */
export function filteredProbs(logits, { temperature = 1, topK = 0, topP = 0.9 } = {}) {
  const n = logits.length;
  const probs = softmax(logits, temperature);
  if (topK > 0) {
    const k = Math.min(Math.max(topK, 1), n);
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => probs[b] - probs[a]);
    const out = new Float64Array(n);
    let sum = 0;
    for (let i = 0; i < k; i += 1) {
      out[order[i]] = probs[order[i]];
      sum += probs[order[i]];
    }
    for (let i = 0; i < n; i += 1) out[i] /= sum;
    return out;
  }
  if (!(topP < 1)) return probs;

  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => probs[b] - probs[a]);
  const keep = new Uint8Array(n).fill(1);
  let cum = 0;
  let lastKept = 0;
  // cumulative over the descending order; drop everything after the first
  // index whose cumulative mass exceeds topP (with the reference's +1 shift).
  for (let i = 0; i < n; i += 1) {
    cum += probs[order[i]];
    if (cum > topP) { lastKept = i; break; }
    lastKept = i;
  }
  for (let i = lastKept + 1; i < n; i += 1) keep[order[i]] = 0;
  const out = new Float64Array(n);
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    out[i] = keep[i] ? probs[i] : 0;
    sum += out[i];
  }
  for (let i = 0; i < n; i += 1) out[i] /= sum;
  return out;
}

/** Sample one index from a (filtered) distribution with an injected uniform
 *  source so tests can pin the draw. */
export function sampleIndex(probs, random) {
  let r = random();
  if (!(r >= 0 && r < 1)) r = 0;
  let acc = 0;
  for (let i = 0; i < probs.length; i += 1) {
    acc += probs[i];
    if (r < acc) return i;
  }
  // floating-point tail: return the last non-zero index
  for (let i = probs.length - 1; i >= 0; i -= 1) if (probs[i] > 0) return i;
  return 0;
}

/** Median bar spacing of a series — the horizon's time step. Median, not mean,
 *  so one gapped bar cannot stretch the whole projection (same rule as the
 *  server worker's `future_times`). */
export function medianStep(candles) {
  const deltas = [];
  for (let i = 1; i < candles.length; i += 1) {
    const d = candles[i].t - candles[i - 1].t;
    if (d > 0) deltas.push(d);
  }
  if (!deltas.length) return 0;
  deltas.sort((a, b) => a - b);
  return deltas[Math.floor(deltas.length / 2)];
}

/** Reference `calc_time_stamps` in UTC: [minute, hour, weekday, day, month]. */
export function timeStamps(timesMs) {
  const out = new Int32Array(timesMs.length * 5);
  for (let i = 0; i < timesMs.length; i += 1) {
    const d = new Date(timesMs[i]);
    out[i * 5] = d.getUTCMinutes();
    out[i * 5 + 1] = d.getUTCHours();
    out[i * 5 + 2] = (d.getUTCDay() + 6) % 7; // pandas weekday: Monday = 0
    out[i * 5 + 3] = d.getUTCDate();
    out[i * 5 + 4] = d.getUTCMonth() + 1;
  }
  return out;
}

export const CLIP = 5;
const EPS = 1e-5;

/**
 * Turn chart candles into the model's input matrix + normalisation stats.
 * Columns are [open, high, low, close, volume, amount] with
 * amount = volume * mean(open, high, low, close), exactly like
 * `KronosPredictor.predict`. Standard deviation is population (ddof=0) to
 * match numpy's default.
 */
export function prepareWindow(candles, { maxContext = 512, horizon = 12 } = {}) {
  const usable = Math.min(candles.length, Math.max(24, maxContext - horizon));
  const window = candles.slice(-usable);
  const n = window.length;
  const x = new Float32Array(n * 6);
  const cols = [[], [], [], [], [], []];
  for (let i = 0; i < n; i += 1) {
    const c = window[i];
    const amount = c.v * ((c.o + c.h + c.l + c.c) / 4);
    const row = [c.o, c.h, c.l, c.c, c.v, amount];
    for (let k = 0; k < 6; k += 1) cols[k].push(row[k]);
  }
  const mean = new Float64Array(6);
  const std = new Float64Array(6);
  for (let k = 0; k < 6; k += 1) {
    const values = cols[k];
    let sum = 0;
    for (const v of values) sum += v;
    const m = sum / n;
    let sq = 0;
    for (const v of values) sq += (v - m) ** 2;
    mean[k] = m;
    std[k] = Math.sqrt(sq / n);
  }
  for (let i = 0; i < n; i += 1) {
    for (let k = 0; k < 6; k += 1) {
      const v = (cols[k][i] - mean[k]) / (std[k] + EPS);
      x[i * 6 + k] = Math.max(-CLIP, Math.min(CLIP, v));
    }
  }
  return { window, x, mean, std };
}

/** Undo the normalisation for the generated bars. */
export function denormalize(flat, length, mean, std) {
  const rows = [];
  for (let i = 0; i < length; i += 1) {
    const row = [];
    for (let k = 0; k < 6; k += 1) row.push(flat[i * 6 + k] * (std[k] + EPS) + mean[k]);
    rows.push(row);
  }
  return rows;
}

/**
 * Validate + shape generated bars into candles the chart can draw.
 *
 * The model is an unconstrained sampler: a bar can come out with high < close
 * or a non-positive price. Rather than dress that up (or silently drop a bar
 * and break the time axis) the bar is repaired to the nearest valid OHLC and
 * the count of repairs is reported to the caller, which surfaces it in the UI.
 *
 * @returns {{candles: Array, repaired: number|null, error: string|null}}
 */
export function finalizeCandles(rows, times, fallbackVolume) {
  const candles = [];
  let repaired = 0;
  let previous = times.length ? times[0] - 1 : 0;
  for (let i = 0; i < rows.length; i += 1) {
    const t = times[i];
    const raw = rows[i];
    if (!Array.isArray(raw) || raw.length < 4) return { candles: null, repaired: null, error: 'INVALID_ROW' };
    if (!Number.isFinite(t) || t <= 0 || t <= previous) return { candles: null, repaired: null, error: 'INVALID_TIME' };
    let [o, h, l, c] = raw;
    let v = raw[4];
    if (![o, h, l, c].every(Number.isFinite)) return { candles: null, repaired: null, error: 'NON_FINITE_PRICE' };
    if (!(v >= 0) || !Number.isFinite(v)) v = fallbackVolume;
    let fixed = false;
    if (!(o > 0)) { o = Math.max(1e-12, Math.abs(o)); fixed = true; }
    if (!(c > 0)) { c = Math.max(1e-12, Math.abs(c)); fixed = true; }
    if (h < Math.max(o, c)) { h = Math.max(o, c); fixed = true; }
    if (l > Math.min(o, c) || !(l > 0)) { l = Math.max(1e-12, Math.min(o, c)); fixed = true; }
    if (h < l) { h = l; fixed = true; }
    if (fixed) repaired += 1;
    candles.push({ t, o, h, l, c, v });
    previous = t;
  }
  return { candles, repaired, error: null };
}
