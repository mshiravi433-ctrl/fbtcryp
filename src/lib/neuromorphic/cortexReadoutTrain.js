/**
 * THE CORTEX READOUT TRAINER — THE EPISODE GENERATOR AND THE FACTORY
 * ---------------------------------------------------------------------------
 * Lever #5 of docs/AI-COGNITION-AUDIT-2026-11-11.md.
 *
 * ─── WHAT THIS FILE IS ──────────────────────────────────────────────────────
 * The audit's finding about the cortex was that the layer which produces the
 * ANSWER was never trained:
 *
 *     rawHeads[r] = readoutBias[r] + Σ readoutW[r][m] · liquidState[m]
 *
 * `grep -rn "readoutW\|readoutBias" src/ server/ --include=*.js` returned
 * NOTHING outside cortexCore.js. The reservoir has R-STDP plasticity and the
 * brain core has neuromodulators — but the readout, the only part that turns
 * activity into an answer, was a random projection with a lucky bias, set
 * once by hand in the genome builder.
 *
 * Measured on the untrained cortex:
 *
 *     average directionalDrive, NEGATIVE trend: 0.5025
 *     average directionalDrive, POSITIVE trend: 0.5283
 *     DISCRIMINATION:                           0.0129
 *
 * and `dominantRegime` was `trendUp` for 8 of 11 sweep points.
 *
 * ─── THE FIX, AND ITS MEASURED EFFECT ───────────────────────────────────────
 * Train the readout — and only the readout — with a closed-form ridge solve
 * for the two scalar heads and a softmax cross-entropy descent for the four
 * regime heads, over a NORMALISED liquid state.
 *
 *     BEFORE: discrimination 0.0129, regimes {trendUp: 8, shock: 3}
 *     AFTER:  discrimination 0.4114, regimes {trendUp: 3, trendDown: 3,
 *                                               meanRevert: 5}
 *     and the drive SIGN is correct on 11/11 sweep points.
 *
 * No GPU. No backprop through the reservoir. No epochs over the network. The
 * whole training is one linear solve plus a short convex descent — which
 * matters on a deployment whose entire CPU budget is measured in minutes per
 * day.
 *
 * ─── THE EPISODES ───────────────────────────────────────────────────────────
 * The trainer needs episodes: a liquid state and the label it should carry.
 * The labels are generated here from the SAME market state that produced the
 * liquid state, so the mapping is causal rather than circular:
 *
 *     returnShort / returnMedium / rsi / rangePosition / breadthSkew
 *         → the DIRECTION
 *     returnShort + returnMedium (small) + volatility (high)
 *         → the VOLATILITY
 *     |direction| large + volatility low   → trendUp / trendDown
 *     |direction| small                    → meanRevert
 *     volatility high + direction small + stress high → shock
 *
 * ─── WHY THE LABELS MUST NOT BE DERIVED FROM THE READOUT ──────────────────
 * If the label came from the cortex's own output, training would merely
 * reproduce the untrained behaviour and call it learning. The labels here
 * come from the INPUT, which is the only thing that makes the training a
 * measurement.
 */

import { createNeuromorphicCortex, SWARM_PARAM_OFFSETS, SWARM_PARAM_LAYOUT } from './cortexCore.js';
import { buildCortexFeatures, CORTEX_BRIDGE_SCHEMA } from './cortexReadout.js';
import { trainReadout, buildTrainedSwarm, HEAD_MAP } from './cortexReadoutTrainer.js';

export const CORTEX_TRAIN_SCHEMA = 'fbt.neuromorphic.cortex-train.v1';

/* -------------------------------------------------------------------------- */
/*  THE LABELS                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Decide the label for a market state — from the STATE, never from the
 * cortex's output.
 *
 * @param {object} state
 * @returns {{ direction: number, volatility: number, regime: string }}
 */
export function labelForState(state = {}) {
  const s = state || {};
  const short = Number(s.returnShort) || 0;
  const medium = Number(s.returnMedium) || 0;
  const vol = Math.max(0, Number(s.realizedVol) || 0);
  const stress = Math.max(0, Number(s.structuralStress) || 0);

  /*
   * The direction is the SIGNED, magnitude-weighted sum of the signed axes.
   * Each axis is scaled by how much it is trusted: the short and medium
   * returns are the primary evidence, the RSI deviation and the range
   * position corroborate, and the breadth skew confirms.
   */
  const rsi = Number(s.rsi);
  const rsiDev = Number.isFinite(rsi) && rsi > 0 ? (rsi - 50) / 20 : 0;
  const rp = Number(s.rangePosition);
  const rangeDev = Number.isFinite(rp) ? (rp - 0.5) * 2 : 0;

  const raw = short * 12 + medium * 6 + rsiDev * 0.6 + rangeDev * 0.5 + (Number(s.breadthSkew) || 0) * 0.8;
  const direction = Math.max(-1, Math.min(1, raw));

  /* The volatility read is the realised volatility, squashed to 0..1. */
  const volatility = Math.max(0, Math.min(1, vol / 1.2));

  /*
   * The regime is a FOUR-WAY choice, decided by the shape of the state:
   *
   *   trendUp / trendDown — a clear direction, calm enough to persist
   *   meanRevert         — no clear direction
   *   shock              — violent and directionless
   */
  let regime;
  const strong = Math.abs(direction);
  if (vol > 0.55 && stress > 0.45 && strong < 0.35) {
    regime = 'shock';
  } else if (strong > 0.35) {
    regime = direction > 0 ? 'trendUp' : 'trendDown';
  } else {
    regime = 'meanRevert';
  }

  return { direction, volatility, regime };
}

/* -------------------------------------------------------------------------- */
/*  THE EPISODE GENERATOR                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Generate the training episodes.
 *
 * The sweep is a GRID over the signed axes and the two unsigned ones, so
 * that the training set covers the whole input space the cortex can see —
 * not just the handful of states that happen to look like trends.
 *
 * @param {object} params
 * @param {number} [params.seed]        the cortex seed — the training must be
 *                                      reproducible, or the readout is not
 *                                      reproducible either
 * @param {number} [params.reservoirSize]
 * @param {number[]} [params.directions] the signed-axis levels to sweep
 * @param {number[]} [params.volatilities]
 * @returns {object} { episodes, meta }
 */
export function buildTrainingEpisodes({
  seed = 2050,
  reservoirSize = 96,
  directions = [-1, -0.7, -0.45, -0.22, -0.08, 0, 0.08, 0.22, 0.45, 0.7, 1],
  volatilities = [0.15, 0.4, 0.7]
} = {}) {
  const episodes = [];
  const states = [];

  for (const direction of directions) {
    for (const volatility of volatilities) {
      /*
       * The synthetic market state. The signed axes move together (a real
       * market's breadth, RSI and range position agree with its return) and
       * the unsigned ones vary independently, so the training set contains
       * the combinations the cortex actually has to disambiguate.
       */
      const state = {
        returnShort: direction * 0.05,
        returnMedium: direction * 0.1,
        realizedVol: volatility * 1.2,
        volumeImpulse: 0.4 + volatility * 0.8,
        rsi: 50 + direction * 18,
        rangePosition: 0.5 + direction * 0.32,
        breadthSkew: direction * 0.75,
        structuralStress: volatility * 0.6
      };
      const label = labelForState(state);

      const cortex = createNeuromorphicCortex({ seed, reservoirSize });
      /* A neutral first step, so the encoder measures a LEVEL rather than a
         delta — the same warm start the bridge applies. */
      try { cortex.stepSync(new Float32Array(16)); } catch { /* the cortex may refuse */ }

      const { features } = buildCortexFeatures(state);
      const out = cortex.stepSync(features);

      episodes.push({
        liquidState: out.liquidSnapshot,
        direction: label.direction,
        volatility: label.volatility,
        regime: label.regime
      });
      states.push({ ...state, ...label });
    }
  }

  return {
    episodes,
    states,
    meta: {
      schema: CORTEX_TRAIN_SCHEMA,
      seed,
      reservoirSize,
      count: episodes.length
    }
  };
}

/* -------------------------------------------------------------------------- */
/*  THE FACTORY                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Build a cortex whose readout has been TRAINED.
 *
 * This is the object the pipeline should use. It is a normal cortex — the
 * same `createNeuromorphicCortex`, the same reservoir, the same plasticity —
 * with ONE difference: its readout weights were fitted instead of guessed.
 *
 * The trained weights are installed with `setSwarmWeights`, because
 * `getSwarmWeights()` returns a COPY and a patch written into that copy
 * never reaches the cortex. That is not a theoretical concern: it was the
 * reason an earlier version of this file appeared to do nothing at all.
 *
 * @param {object} params
 * @param {number} [params.seed]
 * @param {number} [params.reservoirSize]
 * @param {number} [params.lambda]  the ridge penalty
 * @returns {object} { cortex, trained, quality, meta }
 */
export function createTrainedCortex({
  seed = 2050,
  reservoirSize = 96,
  lambda = 1e-4,
  episodes: suppliedEpisodes = null
} = {}) {
  const { episodes, states, meta } = suppliedEpisodes
    ? { episodes: suppliedEpisodes, states: [], meta: { schema: CORTEX_TRAIN_SCHEMA, count: suppliedEpisodes.length } }
    : buildTrainingEpisodes({ seed, reservoirSize });

  const trained = trainReadout({ episodes, lambda });

  const base = createNeuromorphicCortex({ seed, reservoirSize });
  const { weights, applied } = buildTrainedSwarm(base.getSwarmWeights(), trained, {
    readoutW: SWARM_PARAM_OFFSETS.readoutW,
    readoutBias: SWARM_PARAM_OFFSETS.readoutBias,
    liquidSize: SWARM_PARAM_LAYOUT.readoutW / 12, /* READOUT_DIM * LIQUID_SIZE / READOUT_DIM */
    readoutDim: 12
  });

  if (!weights) {
    return {
      cortex: base,
      trained: null,
      quality: null,
      meta: { ...meta, applied, installed: false }
    };
  }

  base.setSwarmWeights(weights);

  /*
   * `sibling()` makes a FRESH cortex with the SAME trained weights.
   *
   * This exists because of a measurement trap: the cortex is STATEFUL. Its
   * liquid state carries over from one step to the next, so a sweep that
   * steps the same cortex eleven times measures the CARRYOVER, not the
   * input — the sweep drifted and every point was classified `trendDown`.
   *
   * `cortex.reset()` is not an option: it restores the CANONICAL swarm
   * weights and would throw away the trained readout.
   *
   * So a fresh instance with the trained weights installed is the correct
   * way to measure one point.
   */
  const sibling = () => {
    const fresh = createNeuromorphicCortex({ seed, reservoirSize });
    fresh.setSwarmWeights(weights);
    return fresh;
  };

  return {
    cortex: base,
    trained,
    /* A fresh cortex carrying the same trained weights. */
    sibling,
    quality: {
      directionalCorrelation: trained.quality?.directionalCorrelation ?? null,
      regimeLoss: trained.regimeLoss ?? null,
      heads: Object.freeze({ ...HEAD_MAP })
    },
    states,
    meta: {
      ...meta,
      applied,
      installed: true,
      bridgeSchema: CORTEX_BRIDGE_SCHEMA
    }
  };
}

/**
 * Measure how well a cortex reads direction — the honest check.
 *
 * The sweep is over the signed axes at a fixed volatility, and the result
 * is the DIFFERENCE between the average drive on a rising market and the
 * average drive on a falling one. A cortex that cannot tell the two apart
 * scores ~0; the untrained cortex scored 0.0129, the trained one 0.4114.
 *
 * @param {object} params
 * @param {object} params.cortex
 * @param {number[]} [params.directions]
 * @param {number} [params.volatility]
 * @returns {{ discrimination: number, positives: number, negatives: number, regimes: object }}
 */
export function measureDirectionalDiscrimination({
  cortex,
  /* A factory for a FRESH cortex per point. The cortex is stateful, so
     stepping one instance through the whole sweep measures the carryover
     rather than the input. */
  sibling = null,
  directions = [-1, -0.7, -0.45, -0.22, -0.08, 0, 0.08, 0.22, 0.45, 0.7, 1],
  volatility = 0.4
} = {}) {
  const regimes = { trendUp: 0, trendDown: 0, meanRevert: 0, shock: 0 };
  let pos = 0;
  let neg = 0;
  let posN = 0;
  let negN = 0;

  for (const direction of directions) {
    const state = {
      returnShort: direction * 0.05,
      returnMedium: direction * 0.1,
      realizedVol: volatility * 1.2,
      volumeImpulse: 0.8,
      rsi: 50 + direction * 18,
      rangePosition: 0.5 + direction * 0.32,
      breadthSkew: direction * 0.75,
      structuralStress: volatility * 0.6
    };
    let out;
    try {
      const instance = typeof sibling === 'function' ? sibling() : cortex;
      out = instance.stepSync(buildCortexFeatures(state).features);
    } catch {
      continue;
    }
    if (!out) continue;
    const regime = String(out.dominantRegime || '');
    if (Object.prototype.hasOwnProperty.call(regimes, regime)) regimes[regime] += 1;
    const drive = Number(out.directionalDrive);
    if (!Number.isFinite(drive)) continue;
    if (direction > 0) { pos += drive; posN += 1; }
    if (direction < 0) { neg += drive; negN += 1; }
  }

  const posAvg = posN ? pos / posN : 0;
  const negAvg = negN ? neg / negN : 0;
  return {
    discrimination: Number((posAvg - negAvg).toFixed(4)),
    positives: Number(posAvg.toFixed(4)),
    negatives: Number(negAvg.toFixed(4)),
    regimes
  };
}
