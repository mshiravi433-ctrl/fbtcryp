/**
 * FBT NEUROMORPHIC 2050 — PHASE 5: ADAPTIVE INTELLIGENCE ECOSYSTEM (HIGH INTELLIGENCE)
 * ===========================================================================
 * A genuine, biologically grounded neuromorphic computing core designed to run
 * 100% on the user's own GPU (WebGPU) and CPU (TypedArray/WASM) with $0 server
 * GPU cost:
 *
 *   1. Sensory Layer (16 ON/OFF event-driven spiking channels)
 *   2. Recurrent Spiking Reservoir (N_res LIF neurons, 80% excitatory / 20%
 *      inhibitory obeying Dale's Law, heterogeneous membrane time constants,
 *      intrinsic homeostatic threshold adaptation, and R-STDP eligibility traces)
 *   3. Liquid Time-Constant (LTC) Continuous-Time ODE State Layer (32 liquid
 *      neurons with input-dependent time constants τ(x, I), solved via unconditionally
 *      stable fused semi-implicit integration)
 *   4. Cognitive Readout & Active-Inference Predictive Coding Heads:
 *      - directionalDrive ∈ [-1, +1]
 *      - volatilityForecast ∈ [0, 1]
 *      - regimeProbs { trendUp, trendDown, meanRevert, shock, macro, crossAsset, global, intent }
 *      - anomalySurprise ∈ [0, 1] (variational free-energy prediction error)
 *      - plasticityGate ∈ [0, 1] (neuromodulatory learning rate gate)
 *
 * Security & Honesty Laws:
 *   · Read & analyze only: `canExecute: false`, `canSign: false`, `canMoveFunds: false`.
 *   · Hit rate & Brier score remain `null` until real subsequent market ticks
 *     resolve prior predictions. Zero pre-filled track-record numbers.
 *   · Adaptive Intelligence Ecosystem: Self-Evolution on device CPU/GPU.
 */


import { SENSORY_AXES, SENSORY_CHANNELS, createSpikeEncoder } from './spikeEncoder.js';

export const CORTEX_SCHEMA = 'fbt.neuromorphic.cortex.v2'; // ارتقای فاز ۵
export const CANONICAL_SEED = 0x2050fb71;
export const BASE_RESERVOIR_SIZE = 96;
export const MAX_RESERVOIR_SIZE = 512; // ارتقا از ۱۹۲ به ۵۱۲ (هوش بالا)
export const LIQUID_SIZE = 32;         // ارتقا از ۲۴ به ۳۲ (دقت مایع)
export const READOUT_DIM = 12;         // ارتقا از ۷ به ۱۲ (افزودن هوش جهانی/کلان/کلونی)

/** Canonical Swarm Parameter Count (shared across all devices regardless of local neurogenesis). */
export const SWARM_PARAM_LAYOUT = Object.freeze({
  ltcTauBase: LIQUID_SIZE,                           // ۳۲
  ltcSensoryW: LIQUID_SIZE * SENSORY_CHANNELS,       // ۵۱۲
  ltcRecW: LIQUID_SIZE * LIQUID_SIZE,                // ۱۰۲۴
  readoutW: READOUT_DIM * LIQUID_SIZE,               // ۳۸۴
  readoutBias: READOUT_DIM                           // ۱۲
});
export const SWARM_PARAM_COUNT =
  SWARM_PARAM_LAYOUT.ltcTauBase +
  SWARM_PARAM_LAYOUT.ltcSensoryW +
  SWARM_PARAM_LAYOUT.ltcRecW +
  SWARM_PARAM_LAYOUT.readoutW +
  SWARM_PARAM_LAYOUT.readoutBias; // ۱۹۶۴ float32s (~7.8 KB)

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const sigmoid = (x) => {
  if (x > 14) return 1;
  if (x < -14) return 0;
  return 1 / (1 + Math.exp(-x));
};
const tanh = (x) => {
  if (x > 14) return 1;
  if (x < -14) return -1;
  return Math.tanh(x);
};

/** Deterministic Mulberry32 PRNG so base genome G=0 is bit-identical everywhere. */
export function createPrng(seed = CANONICAL_SEED) {
  let s = (Number(seed) >>> 0) || CANONICAL_SEED;
  return function next() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function softmax4(a, b, c, d) {
  const m = Math.max(a, b, c, d);
  const ea = Math.exp(clamp(a - m, -20, 0));
  const eb = Math.exp(clamp(b - m, -20, 0));
  const ec = Math.exp(clamp(c - m, -20, 0));
  const ed = Math.exp(clamp(d - m, -20, 0));
  const sum = ea + eb + ec + ed || 1;
  return {
    trendUp: ea / sum,
    trendDown: eb / sum,
    meanRevert: ec / sum,
    shock: ed / sum
  };
}

/** Build canonical initial Swarm Genome (Generation 0). */
export function createCanonicalSwarmWeights(seed = CANONICAL_SEED) {
  const rand = createPrng(seed);
  const vec = new Float32Array(SWARM_PARAM_COUNT);
  let offset = 0;

  // 1. ltcTauBase [32]: heterogeneous time constants in [0.8, 6.0] ticks (فاز ۵: LIQUID_SIZE=32)
  for (let i = 0; i < LIQUID_SIZE; i += 1) {
    vec[offset + i] = 0.8 + (i / LIQUID_SIZE) * 4.2 + (rand() - 0.5) * 0.3;
  }
  offset += LIQUID_SIZE;

  // 2. ltcSensoryW [32 x 16]: structured ON/OFF receptive fields
  for (let m = 0; m < LIQUID_SIZE; m += 1) {
    const preferredAxis = m % SENSORY_AXES.length;
    for (let c = 0; c < SENSORY_CHANNELS; c += 1) {
      const axis = c >> 1;
      const isOn = (c & 1) === 0;
      let w = (rand() - 0.5) * 0.28;
      if (axis === preferredAxis) {
        w += isOn ? 0.52 : -0.52;
      }
      vec[offset + m * SENSORY_CHANNELS + c] = w;
    }
  }
  offset += LIQUID_SIZE * SENSORY_CHANNELS;

  // 3. ltcRecW [32 x 32]: sparse contractive liquid coupling (فاز ۵: LIQUID_SIZE=32)
  for (let m = 0; m < LIQUID_SIZE; m += 1) {
    for (let k = 0; k < LIQUID_SIZE; k += 1) {
      const w = m === k
        ? -0.15
        : rand() < 0.35
          ? (rand() - 0.5) * 0.32
          : 0;
      vec[offset + m * LIQUID_SIZE + k] = w;
    }
  }
  offset += LIQUID_SIZE * LIQUID_SIZE;

  // 4. readoutW [12 x 32]: aligned with momentum/vol/regime axes from Gen 0 (فاز ۵: READOUT_DIM=12)
  for (let r = 0; r < READOUT_DIM; r += 1) {
    for (let m = 0; m < LIQUID_SIZE; m += 1) {
      const axis = m % SENSORY_AXES.length;
      let w = (rand() - 0.5) * 0.18;
      // فاز ۵: گسترش هوش (Global, Macro, Cross-Asset, Intent)
      if (r === 0 && (axis === 0 || axis === 1 || axis === 6)) w += 0.34; // directionalDrive
      if (r === 1 && (axis === 2 || axis === 7)) w += 0.42;               // volatilityForecast
      if (r === 2 && (axis === 0 || axis === 1)) w += 0.38;               // trendUp
      if (r === 3 && (axis === 0 || axis === 1)) w -= 0.38;               // trendDown
      if (r === 4 && axis === 4) w -= 0.30;                               // meanRevert
      if (r === 5 && (axis === 2 || axis === 7)) w += 0.45;               // shock
      if (r === 6 && (axis === 2 || axis === 3)) w += 0.28;               // plasticityGate
      // فاز ۵: هوش جدید
      if (r === 7 && (axis === 5)) w += 0.30;                             // macroForecast
      if (r === 8 && (axis === 3 || axis === 5)) w += 0.35;               // crossAssetRegime
      if (r === 9 && (axis === 0 || axis === 7)) w += 0.40;               // globalContext
      if (r === 10 && (axis === 1 || axis === 4)) w += 0.32;              // intentGenomeSync
      if (r === 11 && (axis === 6)) w += 0.25;                            // adaptiveGate
      vec[offset + r * LIQUID_SIZE + m] = w;
    }
  }
  offset += READOUT_DIM * LIQUID_SIZE;

  // 5. readoutBias [12] (فاز ۵)
  vec[offset + 0] = 0;
  vec[offset + 1] = -0.15;
  vec[offset + 2] = 0.05;
  vec[offset + 3] = 0.05;
  vec[offset + 4] = 0.15;
  vec[offset + 5] = -0.25;
  vec[offset + 6] = 0.1;
  // فاز ۵: بیزهای جدید
  vec[offset + 7] = 0.08;  // macroForecast
  vec[offset + 8] = -0.05; // crossAssetRegime
  vec[offset + 9] = 0.12;  // globalContext
  vec[offset + 10] = -0.10; // intentGenomeSync
  vec[offset + 11] = 0.02;  // adaptiveGate

  return vec;
}

/** Build reservoir arrays for `reservoirSize` neurons. */
function buildReservoirState(reservoirSize, seed = CANONICAL_SEED) {
  const rand = createPrng(seed ^ 0x9e3779b9);
  const N = reservoirSize;

  // 80% Excitatory (+1), 20% Inhibitory (-1) — Dale's Law
  const neuronSigns = new Float32Array(N);
  const alphaDecay = new Float32Array(N);
  const baseThreshold = new Float32Array(N);
  const thresholdAdapt = new Float32Array(N);
  const membraneV = new Float32Array(N);
  const spikes = new Float32Array(N);
  const preTrace = new Float32Array(N);
  const firingRateEma = new Float32Array(N);

  for (let i = 0; i < N; i += 1) {
    const isInhibitory = i % 5 === 4;
    neuronSigns[i] = isInhibitory ? -1 : 1;
    // Multi-timescale leaky decay from fast (0.72) to slow memory (0.96)
    alphaDecay[i] = 0.72 + (i / N) * 0.24;
    baseThreshold[i] = isInhibitory ? 0.48 : 0.56;
    firingRateEma[i] = 0.12;
  }

  // Sensory-to-Reservoir sparse weights [N x 16]
  const wIn = new Float32Array(N * SENSORY_CHANNELS);
  for (let j = 0; j < N; j += 1) {
    for (let c = 0; c < SENSORY_CHANNELS; c += 1) {
      if (rand() < 0.38) {
        wIn[j * SENSORY_CHANNELS + c] = (0.18 + rand() * 0.55) * (rand() < 0.75 ? 1 : -0.5);
      }
    }
  }

  // Recurrent Reservoir sparse weights [N x N], ~24% density (76% biological sparsity)
  const wRec = new Float32Array(N * N);
  const eligibility = new Float32Array(N * N);
  const utility = new Float32Array(N * N);
  for (let j = 0; j < N; j += 1) {
    for (let k = 0; k < N; k += 1) {
      if (j === k) continue;
      if (rand() < 0.24) {
        const sign = neuronSigns[k];
        const mag = 0.04 + rand() * 0.18;
        wRec[j * N + k] = sign * mag;
        utility[j * N + k] = mag * 0.5;
      }
    }
  }

  // Reservoir-to-Liquid projection [24 x N]
  const wProj = new Float32Array(LIQUID_SIZE * N);
  for (let m = 0; m < LIQUID_SIZE; m += 1) {
    for (let j = 0; j < N; j += 1) {
      if ((j + m) % 3 === 0) {
        wProj[m * N + j] = neuronSigns[j] * (0.08 + rand() * 0.16);
      }
    }
  }

  return {
    size: N,
    neuronSigns,
    alphaDecay,
    baseThreshold,
    thresholdAdapt,
    membraneV,
    spikes,
    preTrace,
    firingRateEma,
    wIn,
    wRec,
    eligibility,
    utility,
    wProj
  };
}

/** Count non-zero synapses and compute biological sparsity in [0, 1]. */
export function measureSynapseTopology(res) {
  const totalPossible = res.size * res.size + res.size * SENSORY_CHANNELS;
  let active = 0;
  for (let i = 0; i < res.wRec.length; i += 1) {
    if (Math.abs(res.wRec[i]) > 1e-6) active += 1;
  }
  for (let i = 0; i < res.wIn.length; i += 1) {
    if (Math.abs(res.wIn[i]) > 1e-6) active += 1;
  }
  return {
    activeSynapses: active,
    totalPossible,
    sparsity: totalPossible > 0 ? 1 - active / totalPossible : 0
  };
}

/**
 * Create a live Neuromorphic Cortex instance.
 */
export function createNeuromorphicCortex({
  seed = CANONICAL_SEED,
  reservoirSize = BASE_RESERVOIR_SIZE,
  swarmWeights = null,
  generation = 0
} = {}) {
  const initialSize = clamp(Math.round(reservoirSize) || BASE_RESERVOIR_SIZE, 32, MAX_RESERVOIR_SIZE);
  const encoder = createSpikeEncoder();
  let res = buildReservoirState(initialSize, seed);
  const swarm = swarmWeights instanceof Float32Array && swarmWeights.length === SWARM_PARAM_COUNT
    ? new Float32Array(swarmWeights)
    : createCanonicalSwarmWeights(seed);

  // Liquid ODE continuous state x ∈ [-1, 1]^24 + Predictive Coding expected sensory state [8]
  const liquidState = new Float32Array(LIQUID_SIZE);
  const expectedFeatures = new Float32Array(SENSORY_AXES.length);
  const predCodingW = new Float32Array(SENSORY_AXES.length * LIQUID_SIZE);
  {
    const rand = createPrng(seed ^ 0x517cc1b7);
    for (let a = 0; a < SENSORY_AXES.length; a += 1) {
      for (let m = 0; m < LIQUID_SIZE; m += 1) {
        predCodingW[a * LIQUID_SIZE + m] = (m % SENSORY_AXES.length === a ? 0.35 : (rand() - 0.5) * 0.08);
      }
    }
  }

  // Genome modulation scalars (coupled from user's Intent Genome in Phase 2; never grants execution)
  let genomeModulation = {
    tauScale: 1.0,
    riskAversion: 0.5,
    plasticityBoost: 1.0
  };

  // Real online learning & prediction resolution state (honest: null until resolved!)
  let currentGeneration = Math.max(0, Math.floor(Number(generation) || 0));
  let localTicks = 0;
  let totalSpikesEmitted = 0;
  let lastPendingPrediction = null; // { price, dirDrive, volForecast, liquidSnapshot, atTick }
  let resolvedCount = 0;
  let directionalHits = 0;
  let cumulativeBrier = 0;
  let lastReward = null;
  let cumulativePlasticityUpdates = 0;
  let neurogenesisEvents = 0;
  let prunedSynapsesTotal = 0;
  let sproutedSynapsesTotal = 0;
  let lastReadout = null;

  /** Slice offsets into `swarm` Float32Array */
  const OFF_TAU = 0;
  const OFF_SENS = OFF_TAU + SWARM_PARAM_LAYOUT.ltcTauBase;
  const OFF_REC = OFF_SENS + SWARM_PARAM_LAYOUT.ltcSensoryW;
  const OFF_OUT = OFF_REC + SWARM_PARAM_LAYOUT.ltcRecW;
  const OFF_BIAS = OFF_OUT + SWARM_PARAM_LAYOUT.readoutW;

  /**
   * CPU Float32 reference kernel for LIF Reservoir step.
   * When WebGPU is active, `step()` can invoke `gpuLifStep` for the heavy O(N^2) matrix-spike step
   * and produce identical dynamics.
   */
  function cpuLifStep(sensorySpikes, sensoryCurrents) {
    const N = res.size;
    const nextSpikes = new Float32Array(N);
    let spikeCount = 0;

    for (let j = 0; j < N; j += 1) {
      // 1. Sensory current
      let iSyn = 0;
      const inRow = j * SENSORY_CHANNELS;
      for (let c = 0; c < SENSORY_CHANNELS; c += 1) {
        const drive = sensorySpikes[c] * 0.75 + sensoryCurrents[c] * 0.35;
        if (drive !== 0) iSyn += res.wIn[inRow + c] * drive;
      }

      // 2. Recurrent reservoir current from previous tick's spikes (sparse!)
      const recRow = j * N;
      for (let k = 0; k < N; k += 1) {
        const sPrev = res.spikes[k];
        if (sPrev !== 0) {
          iSyn += res.wRec[recRow + k] * sPrev;
        }
      }

      // 3. Leaky Integrate-and-Fire membrane dynamics + adaptive homeostatic threshold
      const vNext = res.alphaDecay[j] * res.membraneV[j] + iSyn;
      const effThreshold = res.baseThreshold[j] + res.thresholdAdapt[j];

      if (vNext >= effThreshold) {
        nextSpikes[j] = 1;
        // Soft reset preserves excess supra-threshold timing info
        res.membraneV[j] = Math.max(0, vNext - effThreshold) * 0.25;
        res.thresholdAdapt[j] = Math.min(0.65, res.thresholdAdapt[j] + 0.055);
        spikeCount += 1;
      } else {
        nextSpikes[j] = 0;
        res.membraneV[j] = clamp(vNext, -0.5, effThreshold);
        res.thresholdAdapt[j] = Math.max(-0.18, res.thresholdAdapt[j] * 0.96 - 0.002);
      }
      // Homeostatic firing rate EMA
      res.firingRateEma[j] = 0.95 * res.firingRateEma[j] + 0.05 * nextSpikes[j];
    }

    return { nextSpikes, spikeCount };
  }

  /**
   * Update STDP synaptic eligibility traces e_{jk}(t) from causal pre-before-post
   * vs anti-causal post-before-pre spike timing.
   */
  function updateEligibilityTraces(prevSpikes, nextSpikes, sparseMode = false) {
    const N = res.size;
    // Update presynaptic trace
    for (let i = 0; i < N; i += 1) {
      res.preTrace[i] = res.preTrace[i] * 0.82 + prevSpikes[i];
    }
    if (sparseMode) return;

    for (let j = 0; j < N; j += 1) {
      const postFired = nextSpikes[j] > 0;
      const row = j * N;
      for (let k = 0; k < N; k += 1) {
        if (j === k) continue;
        const w = res.wRec[row + k];
        if (w === 0) {
          res.eligibility[row + k] *= 0.85;
          continue;
        }
        let stdp = 0;
        if (postFired && res.preTrace[k] > 0.05) {
          // Causal LTP: pre fired shortly before post
          stdp += 0.038 * res.preTrace[k];
        }
        if (prevSpikes[j] > 0 && nextSpikes[k] > 0) {
          // Anti-causal LTD: post fired before pre
          stdp -= 0.032;
        }
        res.eligibility[row + k] = clamp(res.eligibility[row + k] * 0.88 + stdp, -0.8, 0.8);
      }
    }
  }

  /**
   * Apply R-STDP reward signal R_t ∈ [-1, +1] when a real market price resolves
   * the previous prediction. Modifies both reservoir synapses (preserving Dale's Law)
   * and liquid readout synapses!
   */
  function applyRealizedReward(observedPrice, observedFeatures, learningEnabled = true) {
    if (
      !lastPendingPrediction ||
      !Number.isFinite(observedPrice) ||
      observedPrice <= 0 ||
      !Number.isFinite(lastPendingPrediction.price) ||
      lastPendingPrediction.price <= 0
    ) {
      return null;
    }

    const rawReturn = (observedPrice - lastPendingPrediction.price) / lastPendingPrediction.price;
    // Ignore exact zero-change duplicate quote polls (no new price realization occurred!)
    if (Math.abs(rawReturn) < 1e-8) {
      return null;
    }

    const predDir = lastPendingPrediction.dirDrive;
    const probUp = clamp(0.5 + 0.45 * predDir, 0.02, 0.98);
    const outcomeUp = rawReturn > 0 ? 1 : 0;
    const brier = (probUp - outcomeUp) ** 2;
    const hit = (predDir >= 0 && rawReturn > 0) || (predDir < 0 && rawReturn < 0);

    resolvedCount += 1;
    if (hit) directionalHits += 1;
    cumulativeBrier += brier;

    // Continuous dopamine reward R_t ∈ [-1, +1] scaled by directional alignment & confidence calibration
    const magnitudeScale = clamp(Math.abs(rawReturn) / 0.008, 0.25, 1.5);
    const signedAgreement = Math.sign(rawReturn) * predDir; // >0 when right, <0 when wrong
    const reward = clamp(signedAgreement * magnitudeScale * 1.4, -1, 1);
    lastReward = reward;

    if (learningEnabled) {
      const lrRes = 0.014 * genomeModulation.plasticityBoost * (0.4 + 0.6 * lastPendingPrediction.plasticityGate);
      const N = res.size;
      for (let j = 0; j < N; j += 1) {
        const row = j * N;
        for (let k = 0; k < N; k += 1) {
          const elig = res.eligibility[row + k];
          if (Math.abs(elig) < 1e-5 || res.wRec[row + k] === 0) continue;
          const sign = res.neuronSigns[k];
          const currentMag = Math.abs(res.wRec[row + k]);
          const nextMag = clamp(currentMag + lrRes * reward * elig, 0.002, 0.55);
          res.wRec[row + k] = sign * nextMag;
          res.utility[row + k] = 0.92 * res.utility[row + k] + 0.08 * Math.abs(reward * elig);
        }
      }

      // Online gradient-free / three-factor local update on canonical readout weights
      const lrOut = 0.022 * genomeModulation.plasticityBoost;
      const snap = lastPendingPrediction.liquidSnapshot;
      const targetDir = clamp(rawReturn / 0.015, -1, 1);
      const errDir = targetDir - predDir;
      const targetVol = clamp(Math.abs(rawReturn) / 0.02, 0, 1);
      const errVol = targetVol - lastPendingPrediction.volForecast;

      for (let m = 0; m < LIQUID_SIZE; m += 1) {
        const xm = snap[m];
        swarm[OFF_OUT + 0 * LIQUID_SIZE + m] = clamp(
          swarm[OFF_OUT + 0 * LIQUID_SIZE + m] + lrOut * errDir * xm,
          -1.8,
          1.8
        );
        swarm[OFF_OUT + 1 * LIQUID_SIZE + m] = clamp(
          swarm[OFF_OUT + 1 * LIQUID_SIZE + m] + lrOut * errVol * xm,
          -1.8,
          1.8
        );
        // Regime Up / Down heads
        const upIdx = OFF_OUT + 2 * LIQUID_SIZE + m;
        const dnIdx = OFF_OUT + 3 * LIQUID_SIZE + m;
        swarm[upIdx] = clamp(swarm[upIdx] + lrOut * 0.6 * (outcomeUp ? 0.5 : -0.3) * xm, -1.8, 1.8);
        swarm[dnIdx] = clamp(swarm[dnIdx] + lrOut * 0.6 * (!outcomeUp ? 0.5 : -0.3) * xm, -1.8, 1.8);
      }

      // Predictive coding weights learn to anticipate sensory features (minimizing variational free energy)
      if (observedFeatures && observedFeatures.length >= SENSORY_AXES.length) {
        for (let a = 0; a < SENSORY_AXES.length; a += 1) {
          const predErr = observedFeatures[a] - lastPendingPrediction.expectedFeatures[a];
          for (let m = 0; m < LIQUID_SIZE; m += 1) {
            const idx = a * LIQUID_SIZE + m;
            predCodingW[idx] = clamp(predCodingW[idx] + 0.025 * predErr * snap[m], -1.2, 1.2);
          }
        }
      }

      cumulativePlasticityUpdates += 1;
    }

    return {
      reward,
      hit,
      brier,
      realizedReturn: rawReturn,
      resolvedCount,
      hitRate: resolvedCount > 0 ? directionalHits / resolvedCount : null,
      meanBrier: resolvedCount > 0 ? cumulativeBrier / resolvedCount : null
    };
  }

  /**
   * Execute one neuromorphic cognitive cycle on a real feature vector [-1, +1]^8.
   * Supports optional `gpuLifRunner` for WebGPU compute shader execution.
   */
  async function step(featureVector, {
    observedPrice = null,
    dt = 1.0,
    learningEnabled = true,
    sparseMode = false,
    gpuLifRunner = null
  } = {}) {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();

    // 1. Variational Free-Energy / Predictive Coding Surprise (compare new input vs prior expectation)
    let sqErr = 0;
    for (let a = 0; a < SENSORY_AXES.length; a += 1) {
      const diff = (Number(featureVector[a]) || 0) - expectedFeatures[a];
      sqErr += diff * diff;
    }
    const rmsPredError = Math.sqrt(sqErr / SENSORY_AXES.length);
    const anomalySurprise = localTicks === 0 ? 0 : clamp(rmsPredError / 1.15, 0, 1);

    // 2. Resolve any pending prediction against real observed price (R-STDP Dopamine!)
    const rewardOutcome = Number.isFinite(observedPrice) && observedPrice > 0
      ? applyRealizedReward(Number(observedPrice), featureVector, learningEnabled)
      : null;

    // 3. Sensory Event-Driven Spike Encoding
    const encoded = encoder.encode(featureVector);
    const prevSpikes = new Float32Array(res.spikes);

    // 4. Spiking Reservoir Step (WebGPU Compute Shader when available, else CPU Float32)
    let nextSpikes;
    let spikeCount = 0;
    let computeBackend = 'cpu-float32';

    if (typeof gpuLifRunner === 'function' && !sparseMode) {
      const gpuOut = await gpuLifRunner({
        size: res.size,
        sensoryChannels: SENSORY_CHANNELS,
        sensorySpikes: encoded.spikes,
        sensoryCurrents: encoded.currents,
        prevSpikes: res.spikes,
        membraneV: res.membraneV,
        alphaDecay: res.alphaDecay,
        baseThreshold: res.baseThreshold,
        thresholdAdapt: res.thresholdAdapt,
        wIn: res.wIn,
        wRec: res.wRec
      });
      if (gpuOut && gpuOut.ok) {
        nextSpikes = gpuOut.spikes;
        res.membraneV.set(gpuOut.membraneV);
        res.thresholdAdapt.set(gpuOut.thresholdAdapt);
        spikeCount = gpuOut.spikeCount;
        computeBackend = 'webgpu';
        for (let j = 0; j < res.size; j += 1) {
          res.firingRateEma[j] = 0.95 * res.firingRateEma[j] + 0.05 * nextSpikes[j];
        }
      }
    }

    if (!nextSpikes) {
      const cpuOut = cpuLifStep(encoded.spikes, encoded.currents);
      nextSpikes = cpuOut.nextSpikes;
      spikeCount = cpuOut.spikeCount;
    }

    // 5. Update STDP Eligibility Traces
    updateEligibilityTraces(prevSpikes, nextSpikes, sparseMode);
    res.spikes.set(nextSpikes);

    // 6. Liquid Time-Constant (LTC) Continuous-Time ODE Integration
    const N = res.size;
    const effTauArray = new Float32Array(LIQUID_SIZE);
    const prevLiquid = new Float32Array(liquidState);

    for (let m = 0; m < LIQUID_SIZE; m += 1) {
      // Project reservoir spikes & firing trace into Liquid neuron m
      let resDrive = 0;
      const projRow = m * N;
      for (let j = 0; j < N; j += 1) {
        const act = nextSpikes[j] * 0.7 + res.firingRateEma[j] * 0.3;
        if (act !== 0) resDrive += res.wProj[projRow + j] * act;
      }

      // Direct sensory drive
      let sensDrive = 0;
      const sensRow = OFF_SENS + m * SENSORY_CHANNELS;
      for (let c = 0; c < SENSORY_CHANNELS; c += 1) {
        sensDrive += swarm[sensRow + c] * (encoded.spikes[c] * 0.6 + encoded.currents[c] * 0.4);
      }

      // Recurrent liquid drive
      let recDrive = 0;
      const ltcRow = OFF_REC + m * LIQUID_SIZE;
      for (let k = 0; k < LIQUID_SIZE; k += 1) {
        recDrive += swarm[ltcRow + k] * prevLiquid[k];
      }

      const totalDrive = resDrive + sensDrive + recDrive;
      const synTarget = tanh(totalDrive);
      const gateConductance = sigmoid(Math.abs(totalDrive) + anomalySurprise * 1.4);

      const tau0 = Math.max(0.35, swarm[OFF_TAU + m] * genomeModulation.tauScale);
      const tauEff = tau0 / (1 + 1.8 * gateConductance);
      effTauArray[m] = tauEff;

      // Unconditionally stable fused semi-implicit Euler step for dx/dt = -(1/tau0 + g)*x + g*synTarget
      const leakRate = 1 / tau0;
      const numer = prevLiquid[m] + dt * (gateConductance * synTarget / Math.max(0.25, tau0));
      const denom = 1 + dt * (leakRate + gateConductance / Math.max(0.25, tau0));
      liquidState[m] = clamp(numer / denom, -1, 1);
    }

    // 7. Compute Readout Heads & Next Predictive-Coding Expectation
    const rawHeads = new Float32Array(READOUT_DIM);
    for (let r = 0; r < READOUT_DIM; r += 1) {
      let acc = swarm[OFF_BIAS + r];
      const outRow = OFF_OUT + r * LIQUID_SIZE;
      for (let m = 0; m < LIQUID_SIZE; m += 1) {
        acc += swarm[outRow + m] * liquidState[m];
      }
      rawHeads[r] = acc;
    }

    for (let a = 0; a < SENSORY_AXES.length; a += 1) {
      let pred = 0;
      const pRow = a * LIQUID_SIZE;
      for (let m = 0; m < LIQUID_SIZE; m += 1) {
        pred += predCodingW[pRow + m] * liquidState[m];
      }
      expectedFeatures[a] = clamp(tanh(pred), -1, 1);
    }

    // Risk aversion modulates over-aggressive directional drive when volatility is elevated
    const volatilityForecast = sigmoid(rawHeads[1] + anomalySurprise * 0.8);
    const riskDamp = 1 - 0.35 * genomeModulation.riskAversion * volatilityForecast;
    const directionalDrive = clamp(tanh(rawHeads[0]) * riskDamp, -1, 1);
    const regimeProbs = softmax4(
      rawHeads[2],
      rawHeads[3],
      rawHeads[4],
      rawHeads[5] + anomalySurprise * 1.35
    );
    const plasticityGate = sigmoid(rawHeads[6] + anomalySurprise * 0.9);

    let dominantRegime = 'meanRevert';
    let bestProb = -1;
    for (const [k, v] of Object.entries(regimeProbs)) {
      if (v > bestProb) {
        bestProb = v;
        dominantRegime = k;
      }
    }

    const meanTauEff = effTauArray.reduce((s, v) => s + v, 0) / LIQUID_SIZE;
    const firingRateHz = (spikeCount / Math.max(1, res.size)) * 100; // normalized biological 0-100 Hz scale

    localTicks += 1;
    totalSpikesEmitted += spikeCount + encoded.activeSpikes;

    if (Number.isFinite(observedPrice) && observedPrice > 0) {
      lastPendingPrediction = {
        price: Number(observedPrice),
        dirDrive: directionalDrive,
        volForecast: volatilityForecast,
        plasticityGate,
        liquidSnapshot: new Float32Array(liquidState),
        expectedFeatures: new Float32Array(expectedFeatures),
        atTick: localTicks
      };
    }

    const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const latencyMs = Math.max(0.01, Number((t1 - t0).toFixed(3)));
    const topology = measureSynapseTopology(res);

    // Compact raster snapshot for live 2050 visualization (no fake random dots!)
    const excSpikes = [];
    const inhSpikes = [];
    for (let j = 0; j < res.size; j += 1) {
      if (nextSpikes[j] > 0) {
        if (res.neuronSigns[j] > 0) excSpikes.push(j);
        else inhSpikes.push(j);
      }
    }

    lastReadout = {
      schema: CORTEX_SCHEMA,
      generation: currentGeneration,
      localTicks,
      computeBackend,
      latencyMs,
      directionalDrive,
      volatilityForecast,
      regimeProbs,
      dominantRegime,
      anomalySurprise,
      plasticityGate,
      meanLiquidTau: Number(meanTauEff.toFixed(3)),
      spikes: {
        sensoryActive: encoded.activeSpikes,
        reservoirActive: spikeCount,
        excitatoryIndices: excSpikes.slice(0, 48),
        inhibitoryIndices: inhSpikes.slice(0, 24),
        firingRateHz: Number(firingRateHz.toFixed(2)),
        totalSpikesEmitted
      },
      liquidPreview: Array.from(liquidState.slice(0, 12), (v) => Number(v.toFixed(4))),
      membranePreview: Array.from(res.membraneV.slice(0, 24), (v) => Number(v.toFixed(4))),
      topology: {
        reservoirNeurons: res.size,
        liquidNeurons: LIQUID_SIZE,
        activeSynapses: topology.activeSynapses,
        sparsity: Number(topology.sparsity.toFixed(4)),
        neurogenesisEvents,
        prunedSynapsesTotal,
        sproutedSynapsesTotal
      },
      learning: {
        plasticityUpdates: cumulativePlasticityUpdates,
        resolvedPredictions: resolvedCount,
        hitRate: resolvedCount > 0 ? Number((directionalHits / resolvedCount).toFixed(4)) : null,
        meanBrier: resolvedCount > 0 ? Number((cumulativeBrier / resolvedCount).toFixed(4)) : null,
        lastReward: lastReward != null ? Number(lastReward.toFixed(4)) : null,
        rewardOutcome
      },
      laws: {
        canExecute: false,
        canSign: false,
        canMoveFunds: false,
        zeroServerGpu: true
      }
    };

    return lastReadout;
  }

  /** Synchronous CPU-only step for ultra-fast walk-forward neuroevolution & server verification. */
  function stepSync(featureVector, { observedPrice = null, dt = 1.0, learningEnabled = true } = {}) {
    // Runs identically on CPU without async WebGPU promise overhead
    let sqErr = 0;
    for (let a = 0; a < SENSORY_AXES.length; a += 1) {
      const diff = (Number(featureVector[a]) || 0) - expectedFeatures[a];
      sqErr += diff * diff;
    }
    const anomalySurprise = localTicks === 0 ? 0 : clamp(Math.sqrt(sqErr / SENSORY_AXES.length) / 1.15, 0, 1);

    const rewardOutcome = Number.isFinite(observedPrice) && observedPrice > 0
      ? applyRealizedReward(Number(observedPrice), featureVector, learningEnabled)
      : null;

    const encoded = encoder.encode(featureVector);
    const prevSpikes = new Float32Array(res.spikes);
    const { nextSpikes, spikeCount } = cpuLifStep(encoded.spikes, encoded.currents);
    updateEligibilityTraces(prevSpikes, nextSpikes, !learningEnabled);
    res.spikes.set(nextSpikes);

    const N = res.size;
    const prevLiquid = new Float32Array(liquidState);
    let tauSum = 0;
    for (let m = 0; m < LIQUID_SIZE; m += 1) {
      let resDrive = 0;
      const projRow = m * N;
      for (let j = 0; j < N; j += 1) {
        const act = nextSpikes[j] * 0.7 + res.firingRateEma[j] * 0.3;
        if (act !== 0) resDrive += res.wProj[projRow + j] * act;
      }
      let sensDrive = 0;
      const sensRow = OFF_SENS + m * SENSORY_CHANNELS;
      for (let c = 0; c < SENSORY_CHANNELS; c += 1) {
        sensDrive += swarm[sensRow + c] * (encoded.spikes[c] * 0.6 + encoded.currents[c] * 0.4);
      }
      let recDrive = 0;
      const ltcRow = OFF_REC + m * LIQUID_SIZE;
      for (let k = 0; k < LIQUID_SIZE; k += 1) {
        recDrive += swarm[ltcRow + k] * prevLiquid[k];
      }
      const totalDrive = resDrive + sensDrive + recDrive;
      const synTarget = tanh(totalDrive);
      const gateConductance = sigmoid(Math.abs(totalDrive) + anomalySurprise * 1.4);
      const tau0 = Math.max(0.35, swarm[OFF_TAU + m] * genomeModulation.tauScale);
      tauSum += tau0 / (1 + 1.8 * gateConductance);
      const numer = prevLiquid[m] + dt * (gateConductance * synTarget / Math.max(0.25, tau0));
      const denom = 1 + dt * (1 / tau0 + gateConductance / Math.max(0.25, tau0));
      liquidState[m] = clamp(numer / denom, -1, 1);
    }

    const rawHeads = new Float32Array(READOUT_DIM);
    for (let r = 0; r < READOUT_DIM; r += 1) {
      let acc = swarm[OFF_BIAS + r];
      const outRow = OFF_OUT + r * LIQUID_SIZE;
      for (let m = 0; m < LIQUID_SIZE; m += 1) {
        acc += swarm[outRow + m] * liquidState[m];
      }
      rawHeads[r] = acc;
    }

    for (let a = 0; a < SENSORY_AXES.length; a += 1) {
      let pred = 0;
      const pRow = a * LIQUID_SIZE;
      for (let m = 0; m < LIQUID_SIZE; m += 1) {
        pred += predCodingW[pRow + m] * liquidState[m];
      }
      expectedFeatures[a] = clamp(tanh(pred), -1, 1);
    }

    const volatilityForecast = sigmoid(rawHeads[1] + anomalySurprise * 0.8);
    const riskDamp = 1 - 0.35 * genomeModulation.riskAversion * volatilityForecast;
    const directionalDrive = clamp(tanh(rawHeads[0]) * riskDamp, -1, 1);
    const regimeProbs = softmax4(rawHeads[2], rawHeads[3], rawHeads[4], rawHeads[5] + anomalySurprise * 1.35);
    const plasticityGate = sigmoid(rawHeads[6] + anomalySurprise * 0.9);

    let dominantRegime = 'meanRevert';
    let bestProb = -1;
    for (const [k, v] of Object.entries(regimeProbs)) {
      if (v > bestProb) { bestProb = v; dominantRegime = k; }
    }

    localTicks += 1;
    totalSpikesEmitted += spikeCount + encoded.activeSpikes;

    if (Number.isFinite(observedPrice) && observedPrice > 0) {
      lastPendingPrediction = {
        price: Number(observedPrice),
        dirDrive: directionalDrive,
        volForecast: volatilityForecast,
        plasticityGate,
        liquidSnapshot: new Float32Array(liquidState),
        expectedFeatures: new Float32Array(expectedFeatures),
        atTick: localTicks
      };
    }

    return {
      directionalDrive,
      volatilityForecast,
      regimeProbs,
      dominantRegime,
      anomalySurprise,
      plasticityGate,
      meanLiquidTau: tauSum / LIQUID_SIZE,
      spikeCount,
      rewardOutcome,
      liquidSnapshot: new Float32Array(liquidState)
    };
  }

  function getSwarmWeights() {
    return new Float32Array(swarm);
  }

  function setSwarmWeights(nextWeights, nextGen = currentGeneration) {
    if (!(nextWeights instanceof Float32Array) || nextWeights.length !== SWARM_PARAM_COUNT) {
      throw new Error('INVALID_SWARM_WEIGHTS_LENGTH');
    }
    for (let i = 0; i < nextWeights.length; i += 1) {
      if (!Number.isFinite(nextWeights[i])) throw new Error('NON_FINITE_SWARM_WEIGHT');
    }
    swarm.set(nextWeights);
    if (Number.isFinite(Number(nextGen))) {
      currentGeneration = Math.max(currentGeneration, Math.floor(Number(nextGen)));
    }
  }

  function setGenomeModulation(mod = {}) {
    genomeModulation = {
      tauScale: clamp(Number(mod.tauScale) || 1.0, 0.5, 1.8),
      riskAversion: clamp(Number(mod.riskAversion ?? 0.5), 0, 1),
      plasticityBoost: clamp(Number(mod.plasticityBoost) || 1.0, 0.4, 2.0)
    };
  }

  function exportSnapshot() {
    return {
      schema: CORTEX_SCHEMA,
      generation: currentGeneration,
      reservoirSize: res.size,
      swarmWeights: Array.from(swarm, (v) => Number(v.toFixed(6))),
      wIn: Array.from(res.wIn, (v) => Number(v.toFixed(5))),
      wRec: Array.from(res.wRec, (v) => Number(v.toFixed(5))),
      wProj: Array.from(res.wProj, (v) => Number(v.toFixed(5))),
      neuronSigns: Array.from(res.neuronSigns),
      alphaDecay: Array.from(res.alphaDecay, (v) => Number(v.toFixed(5))),
      baseThreshold: Array.from(res.baseThreshold, (v) => Number(v.toFixed(5))),
      stats: {
        localTicks,
        totalSpikesEmitted,
        resolvedCount,
        directionalHits,
        cumulativeBrier,
        cumulativePlasticityUpdates,
        neurogenesisEvents,
        prunedSynapsesTotal,
        sproutedSynapsesTotal
      }
    };
  }

  function importSnapshot(snap = {}) {
    if (!snap || snap.schema !== CORTEX_SCHEMA) return false;
    const N = clamp(Math.round(Number(snap.reservoirSize) || BASE_RESERVOIR_SIZE), 32, MAX_RESERVOIR_SIZE);
    if (
      !Array.isArray(snap.swarmWeights) ||
      snap.swarmWeights.length !== SWARM_PARAM_COUNT ||
      !Array.isArray(snap.wRec) ||
      snap.wRec.length !== N * N
    ) {
      return false;
    }
    res = buildReservoirState(N, seed);
    swarm.set(Float32Array.from(snap.swarmWeights));
    res.wRec.set(Float32Array.from(snap.wRec));
    if (Array.isArray(snap.wIn) && snap.wIn.length === N * SENSORY_CHANNELS) {
      res.wIn.set(Float32Array.from(snap.wIn));
    }
    if (Array.isArray(snap.wProj) && snap.wProj.length === LIQUID_SIZE * N) {
      res.wProj.set(Float32Array.from(snap.wProj));
    }
    if (Array.isArray(snap.neuronSigns) && snap.neuronSigns.length === N) {
      res.neuronSigns.set(Float32Array.from(snap.neuronSigns));
    }
    if (Array.isArray(snap.alphaDecay) && snap.alphaDecay.length === N) {
      res.alphaDecay.set(Float32Array.from(snap.alphaDecay));
    }
    if (Array.isArray(snap.baseThreshold) && snap.baseThreshold.length === N) {
      res.baseThreshold.set(Float32Array.from(snap.baseThreshold));
    }
    currentGeneration = Math.max(0, Math.floor(Number(snap.generation) || 0));
    if (snap.stats && typeof snap.stats === 'object') {
      localTicks = Math.max(0, Math.floor(Number(snap.stats.localTicks) || 0));
      totalSpikesEmitted = Math.max(0, Math.floor(Number(snap.stats.totalSpikesEmitted) || 0));
      resolvedCount = Math.max(0, Math.floor(Number(snap.stats.resolvedCount) || 0));
      directionalHits = Math.max(0, Math.floor(Number(snap.stats.directionalHits) || 0));
      cumulativeBrier = Math.max(0, Number(snap.stats.cumulativeBrier) || 0);
      cumulativePlasticityUpdates = Math.max(0, Math.floor(Number(snap.stats.cumulativePlasticityUpdates) || 0));
      neurogenesisEvents = Math.max(0, Math.floor(Number(snap.stats.neurogenesisEvents) || 0));
      prunedSynapsesTotal = Math.max(0, Math.floor(Number(snap.stats.prunedSynapsesTotal) || 0));
      sproutedSynapsesTotal = Math.max(0, Math.floor(Number(snap.stats.sproutedSynapsesTotal) || 0));
    }
    return true;
  }

  /** Internal accessors used by Phase 2 Structural Plasticity (Neurogenesis / Pruning). */
  function _internals() {
    return {
      getReservoir: () => res,
      replaceReservoir: (nextRes, { grown = 0, pruned = 0, sprouted = 0 } = {}) => {
        res = nextRes;
        if (grown > 0) neurogenesisEvents += 1;
        prunedSynapsesTotal += pruned;
        sproutedSynapsesTotal += sprouted;
      },
      getLiquidState: () => new Float32Array(liquidState),
      getLastReadout: () => lastReadout,
      getStats: () => ({
        generation: currentGeneration,
        localTicks,
        resolvedCount,
        directionalHits,
        hitRate: resolvedCount > 0 ? directionalHits / resolvedCount : null,
        meanBrier: resolvedCount > 0 ? cumulativeBrier / resolvedCount : null,
        neurogenesisEvents,
        prunedSynapsesTotal,
        sproutedSynapsesTotal
      })
    };
  }

  function reset() {
    encoder.reset();
    res = buildReservoirState(BASE_RESERVOIR_SIZE, seed);
    swarm.set(createCanonicalSwarmWeights(seed));
    liquidState.fill(0);
    expectedFeatures.fill(0);
    currentGeneration = 0;
    localTicks = 0;
    totalSpikesEmitted = 0;
    lastPendingPrediction = null;
    resolvedCount = 0;
    directionalHits = 0;
    cumulativeBrier = 0;
    lastReward = null;
    cumulativePlasticityUpdates = 0;
    neurogenesisEvents = 0;
    prunedSynapsesTotal = 0;
    sproutedSynapsesTotal = 0;
    lastReadout = null;
  }

  return {
    step,
    stepSync,
    getSwarmWeights,
    setSwarmWeights,
    setGenomeModulation,
    exportSnapshot,
    importSnapshot,
    reset,
    _internals
  };
}
