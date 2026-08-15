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
  ATTR_MAX_DELTA,
  BUCKET_MID,
  HORIZONS,
  LAYER_KEYS,
  LAYER_MAX_MULT,
  LAYER_MIN_MULT,
  MIN_SNAPSHOT,
  MIN_TRAIN,
  ORDER_BOUNDS,
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
/* orchestration                                                              */
/* -------------------------------------------------------------------------- */

/**
 * One daily training run. `io` is injectable for tests (see store.js).
 * NEVER throws — every failure path publishes/keeps a hardcoded fallback.
 */
export async function runTraining({ now = new Date(), io = blobIo } = {}) {
  const started = Date.now();
  try {
    if (!io.configured()) {
      return { skipped: 'NO_BLOB', fallbackHardcoded: true, ms: Date.now() - started };
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
      calibration: canPublishModel ? calibration : { k: null, b: null }
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

    const pruned = await pruneParams(90, now, io);
    const { rolled } = await rollAndPruneBuckets(now, io);

    return {
      ok: true,
      version,
      paramsKey,
      records: stats.usable,
      calibrationAuc,
      fallbackHardcoded: !canPublishModel,
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
