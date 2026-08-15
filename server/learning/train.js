/**
 * LEARNING CORE — the daily trainer.
 * ---------------------------------------------------------------------------
 * Runs from /api/cron/train (03:17 UTC — off-peak on the Hobby plan's second
 * cron slot) and, on every run:
 *
 *   1. reads the rolling window of anonymized outcomes (buckets.ndjson +
 *      dated rolls, last 60 days);
 *   2. joins each signal with the resolutions submitted on later visits;
 *   3. when there is enough resolved data, fits a closed-form logistic
 *      calibration and computes per-layer / per-order modulation inside the
 *      hard bounds from schema.js;
 *   4. writes learning/params-YYYY-MM-DD.json (immutable), points the
 *      manifest at it, prunes params older than 90 days and rolls the bucket
 *      file at 100K records;
 *   5. when there is NOT enough data, publishes a no-op params file with
 *      fallbackHardcoded: true — the engine behaves exactly as before.
 *
 * THE ALGORITHM — deliberately no tfjs / ONNX / LLM / gradient descent:
 *
 *   · DIRECTIONAL HIT RATE per horizon. For every resolved signal we know the
 *     predicted stance and the observed bucket; hit = direction agreed.
 *
 *   · LOGISTIC CALIBRATION. Confidence (0-100) is binned into 10 buckets and
 *     the empirical hit fraction is fitted in logit space by closed-form
 *     least squares: logit(P(correct)) = k·conf + b. AUC (rank-sum) measures
 *     how well confidence separates right from wrong answers. Both are
 *     diagnostic: k/b never touch the UI sentence, only the badge's honesty
 *     and the decision whether a model can be published at all.
 *
 *   · PER-LAYER WEIGHTS — two bounded terms that only move when data exists:
 *       (a) ATTRIBUTION: when a horizon's hit rate strays from 0.5, credit or
 *           blame flows mostly to the layer that dominates that horizon
 *           (technical on short, macro on long), with a smaller share to the
 *           satellites. This is the seed that lets the model first differ
 *           from hardcoded weights; deltas are capped at ±0.08.
 *       (b) CONTRAST: once more than one weights-snapshot has real data
 *           (hc, p1, p2, …), a Beta-Bernoulli posterior per snapshot says
 *           which configuration is actually winning, and each layer's
 *           multiplier steps part-way toward the winner. This is the
 *           self-improvement loop: signals made under yesterday's params get
 *           compared with signals made under today's.
 *
 *   · ORDER DEFAULTS. The median |1-day return| of the window (from real
 *     outcomes) vs the previous window's median nudges the trailing-stop
 *     distance, the stop-loss buffer and the ladder step divisor — bounded
 *     by ORDER_BOUNDS. Higher realized volatility → wider trail, coarser
 *     ladder rungs.
 *
 * Everything is closed-form, bounded, and O(n) — comfortably under 2s on a
 * 100 MHz serverless CPU even at 100K records.
 */

import {
  ADVISOR_K_BOUNDS,
  ATTR_MAX_DELTA,
  BANDIT_MULT_BOUNDS,
  BUCKET_MID,
  DRIFT_MAX_DAILY,
  HORIZONS,
  LAYER_KEYS,
  LAYER_MAX_MULT,
  LAYER_MIN_MULT,
  MIN_SNAPSHOT,
  MIN_TRAIN,
  ORDER_BOUNDS,
  REGIMES,
  REGIME_MAX_STEP,
  REGIME_MULT_BOUNDS,
  WINDOW_DAYS,
  bucketSign,
  defaultParams,
  directionOf,
  lineToRecord,
  paramsAreNoop,
  sanitizeParams
} from './schema.js';
import {
  blobIo,
  listParamsKeys,
  paramsKeyFor,
  pruneParams,
  readBucketsWindow,
  readManifest,
  readParamsFile,
  rollAndPruneBuckets,
  writeManifest,
  writeParamsFile
} from './store.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round3 = (v) => Math.round(v * 1000) / 1000;

/* -------------------------------------------------------------------------- */
/* calibration math                                                           */
/* -------------------------------------------------------------------------- */

export function logit(p) {
  const x = clamp(p, 0.01, 0.99);
  return Math.log(x / (1 - x));
}

export function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Closed-form least-squares fit of logit(P(correct)) = k·conf + b.
 *
 * @param {Array<{x:number, y:number}>} points  binned (mean confidence, hit fraction)
 * @returns {{k:number, b:number}|null} null when the fit is degenerate (fewer
 *          than 3 bins) or the slope is not positive — a non-positive slope
 *          means confidence does not order outcomes, so we refuse to publish.
 */
export function fitLogistic(points) {
  const pts = (points ?? []).filter((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y));
  if (pts.length < 3) return null;
  const n = pts.length;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const p of pts) {
    const x = p.x;
    const y = logit(p.y);
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
  }
  const den = n * sxx - sx * sx;
  if (Math.abs(den) < 1e-12) return null;
  const k = (n * sxy - sx * sy) / den;
  const b = (sy - k * sx) / n;
  if (!Number.isFinite(k) || !Number.isFinite(b) || k <= 0) return null;
  return { k, b };
}

/**
 * Rank-sum (Mann–Whitney) AUC over (score, label) pairs. AUC here answers:
 * "a higher predicted confidence really is more likely to be a correct
 * direction call than a lower one?" 1.0 = perfect separation, 0.5 = useless.
 */
export function auc(pairs) {
  const pts = (pairs ?? []).filter((p) => Number.isFinite(p?.score) && (p.label === 0 || p.label === 1));
  if (pts.length < 4) return null;
  const sorted = [...pts].sort((a, b) => a.score - b.score || a.label - b.label);
  const nPos = sorted.filter((p) => p.label === 1).length;
  const nNeg = sorted.length - nPos;
  if (nPos === 0 || nNeg === 0) return null;
  // Average rank of positives (ties get the mean of their rank range).
  let rankSumPos = 0;
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1].score === sorted[i].score) j += 1;
    const avgRank = (i + 1 + j + 1) / 2;
    for (let k = i; k <= j; k += 1) {
      if (sorted[k].label === 1) rankSumPos += avgRank;
    }
    i = j + 1;
  }
  return (rankSumPos - (nPos * (nPos + 1)) / 2) / (nPos * nNeg);
}

/* -------------------------------------------------------------------------- */
/* outcome parsing                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Parse raw bucket lines into joined records:
 *   { c, h, ts, s, p, g, w, resolutions: {'1'?:bucket, '7'?:bucket, '30'?:bucket} }
 * Signals without any resolution are kept but flagged unresolved — training
 * simply skips them (the 60-day window will drop them eventually).
 */
export function parseLearningLines(lines) {
  const signals = new Map(); // key c|h|ts → signal
  const order = [];
  for (const line of lines ?? []) {
    const rec = lineToRecord(line);
    if (!rec) continue;
    if (rec.t === 's') {
      const key = `${rec.c}|${rec.h}|${rec.ts}`;
      if (!signals.has(key)) {
        signals.set(key, rec);
        order.push(key);
      }
    }
  }
  const joined = new Map();
  for (const key of order) {
    const s = signals.get(key);
    joined.set(key, { ...s, resolutions: {} });
  }
  for (const line of lines ?? []) {
    const rec = lineToRecord(line);
    if (!rec || rec.t !== 'r') continue;
    const key = `${rec.c}|${rec.h}|${rec.ts}`;
    const j = joined.get(key);
    if (!j) continue;
    for (const [k, v] of Object.entries(rec.r ?? {})) {
      j.resolutions[k] = v;
    }
  }
  return [...joined.values()];
}

/** The resolution whose span best matches a horizon, falling back shorter. */
export function primaryResolution(horizon, resolutions) {
  if (horizon === 'short') return resolutions['7'] ?? resolutions['1'] ?? null;
  return resolutions['30'] ?? resolutions['7'] ?? null;
}

/* -------------------------------------------------------------------------- */
/* statistics over the window                                                 */
/* -------------------------------------------------------------------------- */

export function computeStats(records) {
  const byHorizon = {};
  for (const h of HORIZONS) {
    byHorizon[h] = { n: 0, hits: 0, resolved: 0, stance: {} };
  }
  const aucPairs = [];
  const bins = new Map(); // conf bucket (0..9) → { sum, hits, n }
  const abs1 = [];

  for (const rec of records ?? []) {
    const dir = directionOf(rec.s);
    const pk = primaryResolution(rec.h, rec.resolutions);
    if (!pk || dir === 0) continue; // "unclear" claims no direction — not trainable
    const sign = bucketSign(pk);
    if (sign === 0) continue; // a flat outcome is neither hit nor miss for a direction claim

    const st = byHorizon[rec.h];
    st.n += 1;
    st.resolved += 1;
    const hit = dir === sign ? 1 : 0;
    if (hit) st.hits += 1;
    st.stance[rec.s] = st.stance[rec.s] ?? { n: 0, hits: 0 };
    st.stance[rec.s].n += 1;
    st.stance[rec.s].hits += hit;

    const conf = clamp(Number(rec.p) || 0, 0, 100);
    aucPairs.push({ score: conf, label: hit });

    const bin = Math.min(9, Math.floor(conf / 10));
    const b = bins.get(bin) ?? { sum: 0, hits: 0, n: 0 };
    b.sum += conf;
    b.hits += hit;
    b.n += 1;
    bins.set(bin, b);

    if (rec.resolutions['1'] != null) {
      const mid = Math.abs(BUCKET_MID[rec.resolutions['1']] ?? 0);
      if (mid > 0) abs1.push(mid);
    }
  }

  const calPoints = [];
  for (const [bin, b] of [...bins.entries()].sort((a, b) => a[0] - b[0])) {
    if (b.n < 10) continue;
    calPoints.push({ x: b.sum / b.n, y: b.hits / b.n, n: b.n });
  }

  const medAbs1 = abs1.length
    ? [...abs1].sort((a, b) => a - b)[Math.floor(abs1.length / 2)]
    : null;

  return {
    usable: records?.filter((r) => primaryResolution(r.h, r.resolutions) && directionOf(r.s) !== 0).length ?? 0,
    byHorizon,
    calPoints,
    aucPairs,
    medAbs1
  };
}

/* -------------------------------------------------------------------------- */
/* the two bounded learning terms                                             */
/* -------------------------------------------------------------------------- */

/**
 * (a) Attribution — credit/blame for a horizon's hit rate, mostly to the
 * layer that dominates that horizon. Zero when the sample is too thin.
 */
export function attributionDeltas(stats) {
  const out = {};
  for (const h of HORIZONS) {
    const one = { technical: 1, historical: 1, structural: 1, macro: 1 };
    const st = stats?.byHorizon?.[h];
    if (!st || st.n < 100) {
      out[h] = one;
      continue;
    }
    const delta = clamp((st.hits / st.n - 0.5) * 0.16, -ATTR_MAX_DELTA, ATTR_MAX_DELTA);
    if (h === 'short') {
      one.technical = 1 + delta;
      one.historical = 1 + delta * 0.5;
      one.structural = 1 + delta * 0.5;
      one.macro = 1 + delta * 0.5;
    } else {
      one.macro = 1 + delta;
      one.technical = 1 + delta * 0.5;
      one.historical = 1 + delta * 0.5;
      one.structural = 1 + delta * 0.5;
    }
    out[h] = one;
  }
  return out;
}

/**
 * (b) Contrast — step each layer's multiplier part-way toward the weights
 * snapshot that is empirically winning. `configs`:
 *   [{ hash, n, hits, mults: { short: {...}, long: {...} } }]
 * Beta-Bernoulli posterior mean = (1 + hits) / (2 + n), prior (1,1). The
 * 'hc' snapshot (hardcoded weights, all 1.0) is the baseline when present.
 *
 * Per layer, the signed posterior advantage of each snapshot — how much
 * better (or worse) it is than baseline — is multiplied by how far that
 * snapshot's multiplier deviates from 1.0, and the result is normalized:
 * a WINNING snapshot pulls the multiplier toward its own value, a LOSING
 * one pushes it away. Half a step per run, bounded by schema.js.
 */
export function bayesianContrast(configs) {
  const list = (configs ?? []).filter((c) => c && c.n >= MIN_SNAPSHOT);
  if (!list.length) return null;

  const hc = list.find((c) => c.hash === 'hc');
  const baseline = hc ? (1 + hc.hits) / (2 + hc.n) : 0.5;

  const out = {};
  for (const h of HORIZONS) {
    out[h] = {};
    for (const layer of LAYER_KEYS) {
      let num = 0;
      let den = 0;
      for (const c of list) {
        const post = (1 + c.hits) / (2 + c.n);
        const d = post - baseline;
        if (Math.abs(d) < 0.02) continue; // noise floor — no meaningful edge
        const mult = clamp(Number(c.mults?.[h]?.[layer]) || 1, LAYER_MIN_MULT, LAYER_MAX_MULT);
        num += d * (mult - 1);
        den += Math.abs(d);
      }
      if (den === 0) {
        out[h][layer] = 1;
        continue;
      }
      out[h][layer] = clamp(1 + (num / den) * 0.5, LAYER_MIN_MULT, LAYER_MAX_MULT);
    }
  }
  return out;
}

/**
 * Combine attribution + contrast; clamp and round.
 *
 * Per layer: the contrast term (statistically grounded — real outcomes under
 * different weight snapshots) wins when it has any signal at all; layers
 * without contrast evidence fall back to the attribution seed. This keeps the
 * two terms from cancelling each other on the same data.
 */
export function mergeMultipliers(attribution, contrast) {
  const out = {};
  for (const h of HORIZONS) {
    out[h] = {};
    for (const layer of LAYER_KEYS) {
      const c = contrast?.[h]?.[layer];
      const a = attribution?.[h]?.[layer] ?? 1;
      const m = c != null && c !== 1 ? c : a;
      out[h][layer] = round3(clamp(m, LAYER_MIN_MULT, LAYER_MAX_MULT));
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* order defaults                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Nudge the orderAdvisor/autopilot defaults from the window's realized
 * volatility (median |1-day return|) vs the previous window's baseline.
 */
export function volatilityTune(medAbs1, baseline = 3) {
  if (medAbs1 == null || !Number.isFinite(medAbs1) || medAbs1 <= 0) {
    return { trailMult: 1, ladderStepDiv: 3, stopBufferMult: 1, medAbs1: null };
  }
  const ratio = medAbs1 / Math.max(baseline, 0.5);
  return {
    trailMult: round3(clamp(1 + (ratio - 1) * 0.25, ...ORDER_BOUNDS.trailMult)),
    ladderStepDiv: round3(clamp(3 * ratio, ...ORDER_BOUNDS.ladderStepDiv)),
    stopBufferMult: round3(clamp(1 + (ratio - 1) * 0.2, ...ORDER_BOUNDS.stopBufferMult)),
    medAbs1
  };
}

/* -------------------------------------------------------------------------- */
/* v2: server-resolved pipeline — closed-form Bayesian updates                */
/* -------------------------------------------------------------------------- */
/*
 * Everything below is the second-generation trainer: it consumes the SAME
 * joined records but produces the v2 parameter block (calibration2, bandit,
 * regimeMult, advisorK) with an explicit held-out gate and a drift clamp.
 * All of it is deterministic for a given (data, date): the RNG is seeded
 * with a constant derived from the run date, so re-running the daily cron
 * with the same inputs produces byte-identical params (idempotence
 * guardrail). No gradient descent, no dependency, O(n).
 */

/** Deterministic PRNG — the standard mulberry32, seeded from the run date. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seed constant derived from the run date (UTC), e.g. 20260815. */
export function seedForDate(d = new Date()) {
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

/**
 * 1) LOGISTIC CALIBRATION via Newton–Raphson.
 * Model: P(hit) = σ(a·x + b), x = logit(conf/100). 20 iterations of the
 * exact 2×2 Newton step — on <2000 rows this is microseconds. Returns
 * {a, b} or null when degenerate (all-hit / all-miss / singular Hessian).
 */
export function newtonCalibration(rows, iters = 20) {
  const pts = (rows ?? [])
    .filter((r) => Number.isFinite(r?.conf) && (r.hit === 0 || r.hit === 1))
    .map((r) => ({ x: logit(clamp(r.conf, 1, 99) / 100), y: r.hit }));
  if (pts.length < 20) return null;
  const pos = pts.filter((p) => p.y === 1).length;
  if (pos === 0 || pos === pts.length) return null;

  let a = 1;
  let b = 0;
  for (let it = 0; it < iters; it += 1) {
    // Gradient and Hessian of the log-likelihood.
    let g0 = 0;
    let g1 = 0;
    let h00 = 0;
    let h01 = 0;
    let h11 = 0;
    for (const { x, y } of pts) {
      const p = sigmoid(a * x + b);
      const w = p * (1 - p);
      const d = y - p;
      g0 += d * x;
      g1 += d;
      h00 += w * x * x;
      h01 += w * x;
      h11 += w;
    }
    const det = h00 * h11 - h01 * h01;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
    a += (h11 * g0 - h01 * g1) / det;
    b += (h00 * g1 - h01 * g0) / det;
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    a = clamp(a, 0.2, 5);
    b = clamp(b, -3, 3);
  }
  return { a: round3(a), b: round3(b) };
}

/** Calibrated hit probability for a confidence 0..100 under {a,b}; identity
 *  (conf/100) when the calibration is absent — i.e. today's engine. */
export function calibratedP(conf, cal) {
  const c = clamp(Number(conf) || 0, 1, 99) / 100;
  if (!cal || !Number.isFinite(cal.a) || !Number.isFinite(cal.b)) return c;
  return sigmoid(cal.a * logit(c) + cal.b);
}

/** Log-loss of probability predictions over held-out rows. Lower is better. */
export function logLoss(rows, cal) {
  const pts = (rows ?? []).filter((r) => Number.isFinite(r?.conf) && (r.hit === 0 || r.hit === 1));
  if (!pts.length) return null;
  let sum = 0;
  for (const r of pts) {
    const p = clamp(calibratedP(r.conf, cal), 1e-6, 1 - 1e-6);
    sum += r.hit === 1 ? -Math.log(p) : -Math.log(1 - p);
  }
  return sum / pts.length;
}

/**
 * 2) THOMPSON-SAMPLING BANDIT, per layer.
 * For each resolved outcome a layer scores a hit when its sign agreed with
 * the resolved return. The posterior Beta(10+hits, 10+misses) — the Beta(10,10)
 * prior keeps early data from swinging the multiplier — is sampled once per
 * run (normal approximation, seeded RNG → deterministic per day) and divided
 * by the prior mean 0.5, then clamped to [0.4, 1.8]. The raw multiplier is
 * PUBLISHED for the record but only ever applied through the [0.85, 1.15]
 * layer band in applyParams — belt and braces.
 *
 * rows: [{ layerSigns: {technical:±1|0, ...}, outcome: ±1 }]
 */
export function banditUpdate(rows, rng = Math.random) {
  const stats = {};
  for (const k of LAYER_KEYS) stats[k] = { hits: 0, misses: 0 };
  for (const r of rows ?? []) {
    const out = r?.outcome;
    if (out !== 1 && out !== -1) continue;
    for (const k of LAYER_KEYS) {
      const sign = r.layerSigns?.[k];
      if (sign !== 1 && sign !== -1) continue;
      if (sign === out) stats[k].hits += 1;
      else stats[k].misses += 1;
    }
  }
  const mult = {};
  for (const k of LAYER_KEYS) {
    const a = 10 + stats[k].hits;
    const b = 10 + stats[k].misses;
    const mean = a / (a + b);
    const sd = Math.sqrt((a * b) / ((a + b) ** 2 * (a + b + 1)));
    // Box–Muller draw from the seeded RNG — deterministic for a given day.
    const u1 = Math.max(rng(), 1e-12);
    const u2 = rng();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const draw = clamp(mean + z * sd, 0.01, 0.99);
    mult[k] = round3(clamp(draw / 0.5, ...BANDIT_MULT_BOUNDS));
  }
  return { mult, stats };
}

/**
 * 3) REGIME ADJUSTMENT with shrinkage toward 1.0.
 * Average absolute calibration error per regime (|conf/100 − hit|); a regime
 * where the engine is systematically overconfident earns a multiplier below
 * 1. Max movement REGIME_MAX_STEP (0.1) per day so the model cannot flip
 * overnight; hard band [0.7, 1.3].
 *
 * rows: [{ regime, conf, hit }]
 */
export function regimeAdjust(rows, prev = null) {
  const by = {};
  for (const g of REGIMES) by[g] = { n: 0, err: 0 };
  for (const r of rows ?? []) {
    const g = REGIMES.includes(r?.regime) ? r.regime : 'unknown';
    if (!(r?.hit === 0 || r?.hit === 1) || !Number.isFinite(r?.conf)) continue;
    by[g].n += 1;
    by[g].err += Math.abs(clamp(r.conf, 0, 100) / 100 - r.hit);
  }
  const out = {};
  for (const g of REGIMES) {
    const prevMult = clamp(Number(prev?.[g]) || 1, ...REGIME_MULT_BOUNDS);
    if (by[g].n < 30) {
      // Thin data: shrink back toward 1.0, never further away.
      const step = clamp(1 - prevMult, -REGIME_MAX_STEP, REGIME_MAX_STEP);
      out[g] = round3(clamp(prevMult + step, ...REGIME_MULT_BOUNDS));
      continue;
    }
    const mae = by[g].err / by[g].n;
    // 0.35 is the base-rate error of an honest ~65%-hit engine; better than
    // that earns a small boost, worse earns a small cut. 0.3 shrinkage.
    const target = clamp(1 + (0.35 - mae), ...REGIME_MULT_BOUNDS);
    const step = clamp(0.3 * (target - prevMult), -REGIME_MAX_STEP, REGIME_MAX_STEP);
    out[g] = round3(clamp(prevMult + step, ...REGIME_MULT_BOUNDS));
  }
  return out;
}

/**
 * 4) ADVISOR NUDGE — least squares (through the origin) between the
 * engine's predicted trail distance and the realized max adverse move over
 * the next 24h, then a strongly-shrunk k-factor:
 *     k = clamp(0.8·k_prev + 0.2·k_ols, 0.7, 1.4)
 *
 * rows: [{ predictedTrail, realizedDrawdown }] (both in percent, positive)
 */
export function advisorFit(rows, prevK = 1) {
  const pts = (rows ?? []).filter(
    (r) => Number.isFinite(r?.predictedTrail) && r.predictedTrail > 0
      && Number.isFinite(r?.realizedDrawdown) && r.realizedDrawdown >= 0
  );
  const prev = clamp(Number(prevK) || 1, ...ADVISOR_K_BOUNDS);
  if (pts.length < 30) return prev;
  let sxy = 0;
  let sxx = 0;
  for (const r of pts) {
    sxy += r.predictedTrail * r.realizedDrawdown;
    sxx += r.predictedTrail * r.predictedTrail;
  }
  if (sxx < 1e-9) return prev;
  const ols = clamp(sxy / sxx, 0.2, 5);
  return round3(clamp(0.8 * prev + 0.2 * ols, ...ADVISOR_K_BOUNDS));
}

/**
 * DRIFT CLAMP — no numeric parameter may move by more than DRIFT_MAX_DAILY
 * (15%) relative to the previous published vector in a single run. Applied
 * leaf-by-leaf; clamped paths are returned so the report can log them.
 */
export function driftClamp(next, prev, maxFrac = DRIFT_MAX_DAILY) {
  const clampedPaths = [];
  const walk = (n, p, path) => {
    if (n == null || typeof n !== 'object') return n;
    const out = Array.isArray(n) ? [...n] : { ...n };
    for (const [key, value] of Object.entries(out)) {
      const prevVal = p?.[key];
      if (typeof value === 'number' && typeof prevVal === 'number' && Number.isFinite(prevVal) && prevVal !== 0) {
        const lo = prevVal - Math.abs(prevVal) * maxFrac;
        const hi = prevVal + Math.abs(prevVal) * maxFrac;
        if (value < lo || value > hi) {
          out[key] = round3(clamp(value, lo, hi));
          clampedPaths.push(`${path}${key}`);
        }
      } else if (value && typeof value === 'object') {
        out[key] = walk(value, prevVal, `${path}${key}.`);
      }
    }
    return out;
  };
  return { params: walk(next, prev, ''), clamped: clampedPaths };
}

/** Split rows deterministically into 80% train / 20% held-out. */
export function splitRows(rows, rng) {
  const shuffled = [...(rows ?? [])];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const cut = Math.max(1, Math.floor(shuffled.length * 0.8));
  return { train: shuffled.slice(0, cut), hold: shuffled.slice(cut) };
}

/**
 * The complete v2 pass over joined records. Returns
 *   { fields: {calibration2, bandit, regimeMult, advisorK}, diag, published }
 * — `published:false` (with the PREVIOUS fields echoed back) whenever the
 * held-out diagnostics are worse than the null model. Honest fail-safe: the
 * null model IS today's engine (identity calibration, all multipliers 1).
 */
export function trainV2(records, { prevParams = null, rng = Math.random } = {}) {
  // Flatten joined records into scored rows.
  const rows = [];
  for (const rec of records ?? []) {
    const dir = directionOf(rec.s);
    const pk = primaryResolution(rec.h, rec.resolutions);
    if (!pk || dir === 0) continue;
    const sign = bucketSign(pk);
    if (sign === 0) continue;
    const layerSigns = {};
    // Telemetry stores the composite stance, not per-layer scores; every
    // layer that participates in the horizon is credited/blamed with the
    // stance's own direction. Coarse, bounded, and honest about its limits —
    // the [0.4,1.8] draw is then squeezed through the ±15% layer band anyway.
    for (const k of LAYER_KEYS) layerSigns[k] = dir;
    const ret1 = rec.resolutions['1'] != null ? Math.abs(BUCKET_MID[rec.resolutions['1']] ?? 0) : null;
    rows.push({
      conf: clamp(Number(rec.p) || 0, 0, 100),
      hit: dir === sign ? 1 : 0,
      regime: rec.g,
      layerSigns,
      outcome: sign,
      predictedTrail: Number.isFinite(rec.raw) && rec.raw > 0 ? rec.raw : null,
      realizedDrawdown: ret1
    });
  }

  const prevFields = {
    calibration2: prevParams?.calibration2 ?? { a: null, b: null },
    bandit: prevParams?.bandit ?? { technical: 1, historical: 1, structural: 1, macro: 1 },
    regimeMult: prevParams?.regimeMult ?? Object.fromEntries(REGIMES.map((g) => [g, 1])),
    advisorK: prevParams?.advisorK ?? 1
  };
  if (rows.length < MIN_TRAIN) {
    return { fields: prevFields, diag: { rows: rows.length, reason: 'NOT_ENOUGH_DATA' }, published: false };
  }

  const { train, hold } = splitRows(rows, rng);

  const calibration2 = newtonCalibration(train, 20);
  const { mult: bandit } = banditUpdate(train, rng);
  const regimeMult = regimeAdjust(train, prevFields.regimeMult);
  const advisorRows = train.filter((r) => r.predictedTrail != null && r.realizedDrawdown != null);
  const advisorK = advisorFit(advisorRows, prevFields.advisorK);

  // 5) DIAGNOSTICS on the held-out 20%: AUC + log-loss, both vs the null
  // model. Worse on either axis → keep previous params, do NOT publish.
  const holdPairs = hold.map((r) => ({ score: calibratedP(r.conf, calibration2), label: r.hit }));
  const nullPairs = hold.map((r) => ({ score: r.conf, label: r.hit }));
  const aucNew = auc(holdPairs);
  const aucNull = auc(nullPairs);
  const llNew = logLoss(hold, calibration2);
  const llNull = logLoss(hold, null);
  const eps = 1e-9;
  const gatePassed = calibration2 != null
    && aucNew != null && aucNull != null && llNew != null && llNull != null
    && aucNew >= aucNull - eps
    && llNew <= llNull + eps;

  const diag = {
    rows: rows.length,
    train: train.length,
    hold: hold.length,
    auc: aucNew == null ? null : round3(aucNew),
    aucNull: aucNull == null ? null : round3(aucNull),
    logLoss: llNew == null ? null : round3(llNew),
    logLossNull: llNull == null ? null : round3(llNull),
    gatePassed
  };
  if (!gatePassed) {
    return { fields: prevFields, diag: { ...diag, reason: 'WORSE_THAN_NULL' }, published: false };
  }

  const next = { calibration2, bandit, regimeMult, advisorK };
  const { params: drifted, clamped } = driftClamp(next, prevFields);
  return { fields: drifted, diag: { ...diag, driftClamped: clamped }, published: true };
}

/* -------------------------------------------------------------------------- */
/* orchestration                                                              */
/* -------------------------------------------------------------------------- */

/** Budget: the trainer must finish well inside the 60s maxDuration. */
export const TRAIN_BUDGET_MS = 20000;

/** learning/reports/{date}.json — the diagnostics trail for each run. */
export const reportKeyFor = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `learning/reports/${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}.json`;
};

/**
 * One daily training run. `io` is injectable for tests (see store.js).
 * NEVER throws — every failure path publishes/keeps a hardcoded fallback.
 * Deterministic per (data, date): the v2 RNG is seeded from the run date.
 */
export async function runTraining({ now = new Date(), io = blobIo, budgetMs = TRAIN_BUDGET_MS } = {}) {
  const started = Date.now();
  const overBudget = () => Date.now() - started > budgetMs;
  try {
    if (!io.configured() || process.env.LEARNING_ENABLED === '0') {
      return {
        skipped: io.configured() ? 'DISABLED' : 'NO_BLOB',
        fallbackHardcoded: true,
        ms: Date.now() - started
      };
    }

    const prevManifest = (await readManifest(io)) ?? {};
    const lines = await readBucketsWindow(WINDOW_DAYS, now, io);
    const records = parseLearningLines(lines);
    const stats = computeStats(records);
    const paramsKey = paramsKeyFor(now);
    const version = Math.max(0, Math.floor(Number(prevManifest.version) || 0)) + 1;

    if (stats.usable < MIN_TRAIN) {
      const params = defaultParams({ version, trainedAt: now.toISOString(), records: stats.usable });
      await writeParamsFile(paramsKey, params, io);
      await writeManifest(
        {
          version,
          paramsKey,
          trainedAt: now.toISOString(),
          recordCount: stats.usable,
          calibrationAuc: null,
          fallbackHardcoded: true,
          windowMedAbs1: prevManifest.windowMedAbs1 ?? null
        },
        io
      );
      return {
        skipped: 'NOT_ENOUGH_DATA',
        records: stats.usable,
        needed: MIN_TRAIN,
        fallbackHardcoded: true,
        paramsKey,
        ms: Date.now() - started
      };
    }

    // Calibration — diagnostic, and the gate for publishing a real model.
    const calibration = fitLogistic(stats.calPoints);
    const calibrationAuc = auc(stats.aucPairs);
    const canPublishModel = Boolean(calibration) && calibrationAuc != null;

    // Weight configs known to us: 'hc' (hardcoded) + every published params
    // file still inside the window (they carry the snapshot's multipliers).
    const configs = [{ hash: 'hc', n: 0, hits: 0, mults: null }];
    for (const key of await listParamsKeys(io)) {
      const pf = await readParamsFile(key, io);
      const clean = sanitizeParams(pf);
      if (!clean || paramsAreNoop(clean)) continue;
      configs.push({
        hash: `p${clean.version}`,
        n: 0,
        hits: 0,
        mults: clean.layers
      });
    }
    // Count resolved direction-holding records per snapshot.
    for (const rec of records) {
      const dir = directionOf(rec.s);
      const pk = primaryResolution(rec.h, rec.resolutions);
      if (!pk || dir === 0 || bucketSign(pk) === 0) continue;
      const cfg = configs.find((c) => c.hash === rec.w) ?? configs[0];
      cfg.n += 1;
      if (dir === bucketSign(pk)) cfg.hits += 1;
    }

    const attribution = attributionDeltas(stats);
    const contrast = canPublishModel ? bayesianContrast(configs) : null;
    const layers = mergeMultipliers(attribution, contrast);

    const tune = volatilityTune(stats.medAbs1, prevManifest.windowMedAbs1 ?? 3);
    const order = {
      trailMult: tune.trailMult,
      ladderStepDiv: tune.ladderStepDiv,
      stopBufferMult: tune.stopBufferMult
    };

    /*
     * V2 PASS — deterministic (RNG seeded from the run date), gated on
     * held-out diagnostics, drift-clamped against the previous vector. When
     * the gate fails the PREVIOUS v2 fields ride along unchanged: honest
     * fail-safe, the model can only ever publish something measured to be
     * at least as good as today's engine.
     */
    const prevParams = prevManifest.paramsKey
      ? sanitizeParams(await readParamsFile(prevManifest.paramsKey, io))
      : null;
    const rng = mulberry32(seedForDate(now));
    const v2 = overBudget()
      ? { fields: {
          calibration2: prevParams?.calibration2 ?? { a: null, b: null },
          bandit: prevParams?.bandit ?? { technical: 1, historical: 1, structural: 1, macro: 1 },
          regimeMult: prevParams?.regimeMult ?? Object.fromEntries(REGIMES.map((g) => [g, 1])),
          advisorK: prevParams?.advisorK ?? 1
        }, diag: { reason: 'BUDGET_EXCEEDED' }, published: false }
      : trainV2(records, { prevParams, rng });

    const params = {
      v: 1,
      version,
      trainedAt: now.toISOString(),
      windowDays: WINDOW_DAYS,
      records: stats.usable,
      auc: calibrationAuc ? round3(calibrationAuc) : null,
      fallbackHardcoded: !canPublishModel,
      layers,
      order,
      calibration: canPublishModel ? calibration : { k: null, b: null },
      ...v2.fields
    };

    await writeParamsFile(paramsKey, params, io);
    await writeManifest(
      {
        version,
        paramsKey,
        trainedAt: now.toISOString(),
        recordCount: stats.usable,
        calibrationAuc: calibrationAuc ? round3(calibrationAuc) : null,
        fallbackHardcoded: !canPublishModel,
        windowMedAbs1: tune.medAbs1
      },
      io
    );

    // Diagnostics report — learning/reports/{date}.json. Best-effort: a
    // failed report write never blocks the published params.
    await io.write(
      reportKeyFor(now),
      JSON.stringify(
        {
          date: now.toISOString(),
          version,
          records: stats.usable,
          calibrationAuc: calibrationAuc ? round3(calibrationAuc) : null,
          v2: { published: v2.published, ...v2.diag },
          ms: Date.now() - started
        },
        null,
        2
      ) + '\n'
    ).catch?.(() => {});

    const pruned = await pruneParams(90, now, io);
    const { rolled } = await rollAndPruneBuckets(now, io);

    return {
      ok: true,
      version,
      paramsKey,
      records: stats.usable,
      calibrationAuc,
      fallbackHardcoded: !canPublishModel,
      v2Published: v2.published,
      pruned,
      rolled,
      ms: Date.now() - started
    };
  } catch (e) {
    console.warn('[learning] training failed; staying on hardcoded weights:', e?.message);
    // Fail-safe: leave whatever manifest exists untouched — the engine keeps
    // using the previous params (or hardcoded if there never was one).
    return { skipped: 'ERROR', error: String(e.message || e).slice(0, 160), fallbackHardcoded: true, ms: Date.now() - started };
  }
}
