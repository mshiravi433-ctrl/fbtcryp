/**
 * KHRONOS LOCAL — the inference engine (ORT session driver).
 * =========================================================
 *
 * This module is the browser-side transcription of
 * `auto_regressive_inference` + `KronosPredictor.predict` from the vendored
 * reference (forecast/kronos_model/kronos.py). It is deliberately free of DOM
 * and worker APIs so the exact same code path can be exercised in Node against
 * the exported ONNX graphs (see test/kronos-local-model.test.mjs).
 *
 * Nothing here talks to a network. The data it receives is already on the
 * device; the model files are already on the device; the arithmetic happens in
 * this process. That is the whole point of the local path.
 */

import {
  bitsToTokens, causalMask, denormalize, finalizeCandles, filteredProbs,
  medianStep, prepareWindow, ropeTables, sampleIndex, timeStamps, tokensToBits
} from './math.js';

export const ENGINE_VERSION = 'kronos-local-1';
export const MIN_CANDLES = 40;
export const MAX_HORIZON = 48;
export const DEFAULT_HORIZON = 12;

/** Forecast engine bound to a set of ORT sessions for one model manifest. */
export class LocalKronos {
  /**
   * @param {object} ort onnxruntime-web namespace (injected: browser bundle in
   *   the worker, onnxruntime-web in Node tests).
   * @param {{encode: object, decode: object, transformer: object, s2head: object}} sessions
   * @param {object} manifest parsed model-manifest.json
   */
  constructor(ort, sessions, manifest) {
    this.ort = ort;
    this.sessions = sessions;
    this.manifest = manifest;
    this.model = manifest.model;
    this.tokenizer = manifest.tokenizer;
    this.maxContext = Math.min(manifest.browserMaxContext || 512, manifest.model?.contextLimit || 2048);
    this.backend = sessions.backend || 'unknown';
  }

  /** True when the window + horizon fit the context (no bar ever evicted). */
  fitsContext(candleCount, horizon) {
    return candleCount + horizon <= this.maxContext;
  }

  /**
   * Run one forecast.
   *
   * @param {Array<{t:number,o:number,h:number,l:number,c:number,v:number}>} candles
   * @param {object} opts
   * @param {number} [opts.horizon] bars to generate (1..MAX_HORIZON)
   * @param {number} [opts.temperature] sampling temperature (default 1.0)
   * @param {number} [opts.topP] nucleus threshold (default 0.9)
   * @param {number} [opts.topK] top-k (0 = off)
   * @param {() => number} [opts.random] uniform [0,1) source
   * @param {(info: object) => void} [opts.onStep] progress callback
   * @param {() => boolean} [opts.shouldCancel] polled between steps
   * @returns {Promise<object>} validated forecast
   */
  async forecast(candles, opts = {}) {
    const {
      temperature = 1.0, topP = 0.9, topK = 0, random = Math.random,
      onStep = () => {}, shouldCancel = () => false
    } = opts;
    const horizon = clampInt(opts.horizon ?? DEFAULT_HORIZON, 1, MAX_HORIZON);
    if (!Array.isArray(candles) || candles.length < MIN_CANDLES) {
      throw new EngineError('INSUFFICIENT_CANDLES', `${MIN_CANDLES} candles required`);
    }
    const { window, x, mean, std } = prepareWindow(candles, { maxContext: this.maxContext, horizon });
    if (!this.fitsContext(window.length, horizon)) {
      throw new EngineError('CONTEXT_TOO_LARGE', `${window.length}+${horizon} > ${this.maxContext}`);
    }
    const step = medianStep(window);
    if (!step) throw new EngineError('INVALID_TIME_AXIS', 'candles have no positive spacing');

    const started = now();
    const marks = {};
    const t = window.length;
    const headDim = this.model.headDim;
    const s1Bits = this.model.s1Bits;
    const s2Bits = this.model.s2Bits;
    const times = window.map((c) => c.t);
    const futureTimes = Array.from({ length: horizon }, (_, i) => times[t - 1] + step * (i + 1));

    // ── 1. tokenise the window (tokenizer encoder, causal) ──────────────────
    onStep({ phase: 'encode', done: 1, total: horizon + 3 });
    const tokCos = ropeTables(range(0, t), this.tokenizer.headDim);
    const bits = await this.sessions.encode.run({
      ohlcv: new this.ort.Tensor('float32', x, [1, t, 6]),
      cos: new this.ort.Tensor('float32', tokCos.cos, [t, this.tokenizer.headDim]),
      sin: new this.ort.Tensor('float32', tokCos.sin, [t, this.tokenizer.headDim]),
      mask: new this.ort.Tensor('float32', causalMask(t), [1, 1, t, t])
    });
    marks.encodeMs = now() - started;
    const { s1, s2 } = bitsToTokens(bits.bits.data, t, s1Bits, s2Bits);

    // ── 2. prefill the transformer over the window ─────────────────────────
    const stamps = timeStamps(times.concat(futureTimes));
    const winStamps = stamps.subarray(0, t * 5);
    const cosM = ropeTables(range(0, t), headDim);
    const feeds = {
      s1: new this.ort.Tensor('int32', s1, [1, t]),
      s2: new this.ort.Tensor('int32', s2, [1, t]),
      stamp: new this.ort.Tensor('int32', winStamps, [1, t, 5]),
      cos: new this.ort.Tensor('float32', cosM.cos, [t, headDim]),
      sin: new this.ort.Tensor('float32', cosM.sin, [t, headDim]),
      mask: new this.ort.Tensor('float32', causalMask(t), [1, 1, t, t])
    };
    const empty = new Float32Array(0);
    for (const name of this.sessions.transformer.inputNames) {
      if (name.startsWith('past_k_') || name.startsWith('past_v_')) {
        feeds[name] = new this.ort.Tensor('float32', empty, [1, this.model.nHeads, 0, headDim]);
      }
    }
    let out = await this.sessions.transformer.run(feeds);
    marks.prefillMs = now() - started - marks.encodeMs;
    const presentKeys = this.sessions.transformer.outputNames
      .filter((n) => n.startsWith('present_k_')).map((n) => out[n]);
    const presentValues = this.sessions.transformer.outputNames
      .filter((n) => n.startsWith('present_v_')).map((n) => out[n]);

    // ── 3. autoregressive token loop ───────────────────────────────────────
    const genS1 = new Int32Array(horizon);
    const genS2 = new Int32Array(horizon);
    let context = out.context;
    let keys = presentKeys;
    let values = presentValues;
    const stepStart = now();
    for (let i = 0; i < horizon; i += 1) {
      if (shouldCancel()) throw new EngineError('CANCELLED', 'cancelled by caller');
      const lastLogits = lastRow(out.s1_logits);
      const s1Probs = filteredProbs(lastLogits, { temperature, topK, topP });
      const s1Token = sampleIndex(s1Probs, random);

      const head = await this.sessions.s2head.run({
        context,
        s1_id: new this.ort.Tensor('int32', new Int32Array([s1Token]), [1, 1])
      });
      const s2Logits = lastRow(head.s2_logits);
      const s2Probs = filteredProbs(s2Logits, { temperature, topK, topP });
      const s2Token = sampleIndex(s2Probs, random);

      genS1[i] = s1Token;
      genS2[i] = s2Token;
      onStep({ phase: 'generate', done: i + 1, total: horizon });

      if (i === horizon - 1) break;

      // One incremental step: KV cache grows, position = window + i, and the
      // mask is empty because the single query sees the whole window.
      const pos = t + i;
      const stepCos = ropeTables([pos], headDim);
      const stepFeeds = {
        s1: new this.ort.Tensor('int32', new Int32Array([s1Token]), [1, 1]),
        s2: new this.ort.Tensor('int32', new Int32Array([s2Token]), [1, 1]),
        stamp: new this.ort.Tensor('int32', stamps.subarray((pos) * 5, (pos) * 5 + 5), [1, 1, 5]),
        cos: new this.ort.Tensor('float32', stepCos.cos, [1, headDim]),
        sin: new this.ort.Tensor('float32', stepCos.sin, [1, headDim]),
        mask: new this.ort.Tensor('float32', new Float32Array(t + i + 1), [1, 1, 1, t + i + 1])
      };
      keys.forEach((tensor, layer) => { stepFeeds[`past_k_${layer}`] = tensor; });
      values.forEach((tensor, layer) => { stepFeeds[`past_v_${layer}`] = tensor; });
      out = await this.sessions.transformer.run(stepFeeds);
      context = out.context;
      keys = this.sessions.transformer.outputNames.filter((n) => n.startsWith('present_k_')).map((n) => out[n]);
      values = this.sessions.transformer.outputNames.filter((n) => n.startsWith('present_v_')).map((n) => out[n]);
    }
    marks.generateMs = now() - stepStart;

    // ── 4. de-tokenise the whole sequence and denormalise ──────────────────
    onStep({ phase: 'decode', done: horizon + 1, total: horizon + 3 });
    const allS1 = concatInt32(s1, genS1);
    const allS2 = concatInt32(s2, genS2);
    const allBits = tokensToBits(allS1, allS2, s1Bits, s2Bits);
    const seqLen = allS1.length;
    const decCos = ropeTables(range(0, seqLen), this.tokenizer.headDim);
    const decoded = await this.sessions.decode.run({
      bits: new this.ort.Tensor('float32', allBits, [1, seqLen, s1Bits + s2Bits]),
      cos: new this.ort.Tensor('float32', decCos.cos, [seqLen, this.tokenizer.headDim]),
      sin: new this.ort.Tensor('float32', decCos.sin, [seqLen, this.tokenizer.headDim]),
      mask: new this.ort.Tensor('float32', causalMask(seqLen), [1, 1, seqLen, seqLen])
    });
    const flat = decoded.ohlcv.data;
    const rows = denormalize(flat.subarray((seqLen - horizon) * 6), horizon, mean, std);
    const fallbackVolume = mean[4] > 0 ? mean[4] : 0;
    const fresh = finalizeCandles(rows, futureTimes, fallbackVolume);
    if (fresh.error) throw new EngineError('INVALID_PROJECTION', fresh.error);

    return {
      provider: 'kronos-local',
      model: this.manifest.model.id,
      tokenizer: this.manifest.tokenizer.id,
      engine: this.manifest.schema,
      backend: this.backend,
      generatedAt: Date.now(),
      intervalMs: step,
      candles: fresh.candles,
      repaired: fresh.repaired,
      options: { temperature, topP, topK, horizon, window: t },
      tokens: { s1: genS1.length, s2: genS2.length },
      timing: {
        totalMs: Math.round(now() - started),
        encodeMs: Math.round(marks.encodeMs || 0),
        prefillMs: Math.round(marks.prefillMs || 0),
        generateMs: Math.round(marks.generateMs || 0),
        perBarMs: Math.round((marks.generateMs || 0) / Math.max(1, horizon)),
        decodeMs: Math.round(now() - started - (marks.encodeMs || 0) - (marks.prefillMs || 0) - (marks.generateMs || 0))
      }
    };
  }
}

export class EngineError extends Error {
  constructor(code, detail) {
    super(code);
    this.name = 'EngineError';
    this.code = code;
    this.detail = detail || '';
  }
}

function clampInt(value, lo, hi) {
  const n = Number(value);
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function range(start, end) {
  return Array.from({ length: Math.max(0, end - start) }, (_, i) => start + i);
}

function lastRow(tensor) {
  const size = tensor.dims[tensor.dims.length - 1];
  const rows = tensor.data.length / size;
  return tensor.data.subarray((rows - 1) * size, rows * size);
}

function concatInt32(a, b) {
  const out = new Int32Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function now() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}
