/**
 * FBT NEUROMORPHIC 2050 — PHASE 3: ON-DEVICE SWARM NEUROEVOLUTION CLIENT
 * ===========================================================================
 * Shifts 100% of neural training & evolutionary search from expensive cloud
 * GPUs onto the distributed edge GPUs/CPUs of FBT users:
 *
 *   · Spawns K antithetic mutated shadow clones around the current Swarm Genome
 *   · Evaluates baseline vs clones on real walk-forward market candles
 *   · Emits a norm-clipped, secret-free 1,159-parameter delta packet ONLY when
 *     a mutated clone demonstrably beats the baseline out-of-sample
 */

import {
  CANONICAL_SEED,
  SWARM_PARAM_COUNT,
  createNeuromorphicCortex,
  createPrng
} from './cortexCore.js';
import { featuresFromCandles } from './spikeEncoder.js';
import { containsSensitiveKeyOrPhrase } from '../intent-ai/orchestrator/redact.js';

export const SWARM_DELTA_SCHEMA = 'fbt.neuromorphic.swarm-delta.v1';
export const MAX_DELTA_INF = 0.25;
export const MAX_DELTA_L2 = 2.5;
export const MIN_PROOF_STEPS = 8;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Compute L2 and L-infinity norms of a Float32Array / numeric array. */
export function deltaNorms(vec) {
  let sumSq = 0;
  let maxAbs = 0;
  for (let i = 0; i < vec.length; i += 1) {
    const a = Math.abs(Number(vec[i]) || 0);
    sumSq += a * a;
    if (a > maxAbs) maxAbs = a;
  }
  return {
    l2: Math.sqrt(sumSq),
    linf: maxAbs
  };
}

/** Clip a delta vector to both L-infinity and L2 safety bounds. */
export function clipSynapticDelta(rawDelta, { maxInf = MAX_DELTA_INF, maxL2 = MAX_DELTA_L2 } = {}) {
  const out = new Float32Array(rawDelta.length);
  let sumSq = 0;
  for (let i = 0; i < rawDelta.length; i += 1) {
    const v = clamp(Number(rawDelta[i]) || 0, -maxInf, maxInf);
    out[i] = v;
    sumSq += v * v;
  }
  const l2 = Math.sqrt(sumSq);
  if (l2 > maxL2 && l2 > 1e-9) {
    const scale = maxL2 / l2;
    for (let i = 0; i < out.length; i += 1) {
      out[i] *= scale;
    }
  }
  return out;
}

/**
 * Evaluate a candidate `swarmWeights` vector on a real candle series using
 * strict walk-forward out-of-sample scoring (predict at bar t, score at bar t+1).
 */
export function evaluateWalkForwardCandidate(candles, swarmWeights, { seed = CANONICAL_SEED } = {}) {
  if (!Array.isArray(candles) || candles.length < 12) {
    return { ok: false, reason: 'INSUFFICIENT_CANDLES' };
  }
  const cortex = createNeuromorphicCortex({
    seed,
    reservoirSize: 64, // fast shadow-clone evaluation topology; canonical 24-D liquid cortex
    swarmWeights
  });

  let resolved = 0;
  let hits = 0;
  let brierSum = 0;

  const startIdx = Math.max(4, candles.length - 48);
  for (let end = startIdx; end <= candles.length; end += 1) {
    const slice = candles.slice(0, end);
    const feat = featuresFromCandles(slice);
    if (!feat.ok) continue;
    const out = cortex.stepSync(feat.vector, {
      observedPrice: feat.meta.lastClose,
      learningEnabled: true
    });
    if (out.rewardOutcome) {
      resolved += 1;
      if (out.rewardOutcome.hit) hits += 1;
      brierSum += out.rewardOutcome.brier;
    }
  }

  if (resolved < MIN_PROOF_STEPS) {
    return { ok: false, reason: 'INSUFFICIENT_RESOLVED_STEPS', resolved };
  }

  const hitRate = hits / resolved;
  const meanBrier = brierSum / resolved;
  // Composite fitness: rewards directional accuracy AND calibrated probability
  const fitness = hitRate - 1.15 * meanBrier;

  return {
    ok: true,
    resolvedSteps: resolved,
    hitRate: Number(hitRate.toFixed(4)),
    meanBrier: Number(meanBrier.toFixed(4)),
    fitness: Number(fitness.toFixed(5)),
    finalWeights: cortex.getSwarmWeights()
  };
}

/**
 * Run local micro-evolution on the user's device:
 *   1. Evaluates baseline weights on real walk-forward candles
 *   2. Evaluates `cloneCount` antithetic mutated shadow clones
 *   3. If a shadow clone beats baseline, returns the clipped delta packet
 */
export function runLocalSwarmEvolution({
  candles,
  baseWeights,
  baseGeneration = 0,
  cloneCount = 4,
  mutationSigma = 0.045,
  computeBackend = 'cpu-float32',
  seed = Date.now()
} = {}) {
  if (!(baseWeights instanceof Float32Array) || baseWeights.length !== SWARM_PARAM_COUNT) {
    return { ok: false, reason: 'INVALID_BASE_WEIGHTS' };
  }
  const baseline = evaluateWalkForwardCandidate(candles, baseWeights);
  if (!baseline.ok) {
    return { ok: false, reason: baseline.reason };
  }

  const kClones = clamp(Math.round(Number(cloneCount) || 2), 1, 8);
  const rand = createPrng((Number(seed) ^ 0xa5a55a5a) >>> 0);

  let best = baseline;
  let improved = false;

  // Baseline's own online R-STDP adaptation during walk-forward is Candidate 0!
  const onlineAdaptedEval = evaluateWalkForwardCandidate(candles, baseline.finalWeights);
  if (onlineAdaptedEval.ok && onlineAdaptedEval.fitness > best.fitness + 0.001) {
    best = onlineAdaptedEval;
    improved = true;
  }

  for (let c = 0; c < kClones; c += 1) {
    const mutated = new Float32Array(SWARM_PARAM_COUNT);
    const signFlip = c % 2 === 0 ? 1 : -1;
    for (let i = 0; i < SWARM_PARAM_COUNT; i += 1) {
      // Sparse antithetic mutation (mutates ~35% of readout/liquid synapses per clone)
      const mask = ((i + c * 17) % 3 === 0) ? 1 : 0.25;
      const noise = (rand() * 2 - 1) * mutationSigma * mask * signFlip;
      mutated[i] = clamp(baseWeights[i] + noise, -2.2, 2.2);
    }
    const res = evaluateWalkForwardCandidate(candles, mutated);
    if (res.ok && res.fitness > best.fitness + 0.0015) {
      best = res;
      improved = true;
    }
  }

  if (!improved) {
    return {
      ok: true,
      improved: false,
      baselineFitness: baseline.fitness,
      winnerFitness: baseline.fitness,
      resolvedSteps: baseline.resolvedSteps,
      winnerHitRate: baseline.hitRate,
      winnerBrier: baseline.meanBrier,
      deltaPacket: null
    };
  }

  const rawDelta = new Float32Array(SWARM_PARAM_COUNT);
  for (let i = 0; i < SWARM_PARAM_COUNT; i += 1) {
    rawDelta[i] = best.finalWeights[i] - baseWeights[i];
  }
  const clipped = clipSynapticDelta(rawDelta);
  const norms = deltaNorms(clipped);

  // Reconstruct exact post-clip weights so local cortex & swarm delta stay in lockstep
  const nextWeights = new Float32Array(SWARM_PARAM_COUNT);
  for (let i = 0; i < SWARM_PARAM_COUNT; i += 1) {
    nextWeights[i] = clamp(baseWeights[i] + clipped[i], -2.5, 2.5);
  }

  const deltaPacket = {
    schema: SWARM_DELTA_SCHEMA,
    baseGeneration: Math.max(0, Math.floor(Number(baseGeneration) || 0)),
    paramCount: SWARM_PARAM_COUNT,
    delta: Array.from(clipped, (v) => Number(v.toFixed(6))),
    norms: {
      l2: Number(norms.l2.toFixed(5)),
      linf: Number(norms.linf.toFixed(5))
    },
    proof: {
      resolvedSteps: best.resolvedSteps,
      baselineFitness: baseline.fitness,
      winnerFitness: best.fitness,
      baselineBrier: baseline.meanBrier,
      winnerBrier: best.meanBrier,
      winnerHitRate: best.hitRate,
      computeBackend: String(computeBackend || 'cpu-float32').slice(0, 32)
    }
  };

  if (containsSensitiveKeyOrPhrase(deltaPacket)) {
    return { ok: false, reason: 'SECRET_INPUT_REJECTED' };
  }

  return {
    ok: true,
    improved: true,
    nextWeights,
    baselineFitness: baseline.fitness,
    winnerFitness: best.fitness,
    resolvedSteps: best.resolvedSteps,
    winnerHitRate: best.hitRate,
    winnerBrier: best.meanBrier,
    deltaPacket
  };
}

/** Merge newly downloaded Global Swarm Weights with local adapted weights. */
export function blendGlobalSwarmWeights(localWeights, globalWeights, { globalShare = 0.7 } = {}) {
  if (!(globalWeights instanceof Float32Array) || globalWeights.length !== SWARM_PARAM_COUNT) {
    throw new Error('INVALID_GLOBAL_WEIGHTS');
  }
  if (!(localWeights instanceof Float32Array) || localWeights.length !== SWARM_PARAM_COUNT) {
    return new Float32Array(globalWeights);
  }
  const alpha = clamp(Number(globalShare) || 0.7, 0, 1);
  const out = new Float32Array(SWARM_PARAM_COUNT);
  for (let i = 0; i < SWARM_PARAM_COUNT; i += 1) {
    out[i] = alpha * globalWeights[i] + (1 - alpha) * localWeights[i];
  }
  return out;
}
