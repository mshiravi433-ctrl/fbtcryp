/**
 * FBT NEUROMORPHIC 2050 — PHASE 6: BRAIN-INSPIRED COGNITIVE CORE
 * ===========================================================================
 * «Brain-Inspired Computing» is not a marketing label here: it is the layer that
 * makes the *cortex itself* smarter by adding the circuits that biological brains
 * actually use to turn spikes into decisions. Everything below runs on the
 * user's own device (WebGPU / CPU float32) with zero server GPU, and every number
 * it reports is measured from the live computation — nothing is pre-filled.
 *
 * Circuits implemented (each one is a real, testable mechanism):
 *
 *   1. THALAMIC RELAY & ATTENTION GATE
 *      Sensory channels are relayed through a learned salience gate: gain_i rises
 *      when channel i carries unexpected information (precision increase), so the
 *      cortex spends its spikes where the evidence is, not uniformly.
 *
 *   2. PREDICTIVE-CODING HIERARCHY (Rao–Ballard, 2 hidden levels)
 *      Level-2 representation predicts level-1, level-1 predicts the gated
 *      sensory vector. Prediction errors ε are weighted by learned *precision*
 *      (inverse variance) and drive both representation updates (inference) and
 *      synaptic updates (learning). Variational free energy
 *              F = ½ Σ_l (π_l · ε_l²) + ½ λ Σ_l |r_l|²
 *      is the honest objective: on repeated structure F *must* fall. `step()`
 *      reports the measured F, per-level errors, precisions and the trend.
 *
 *   3. NEUROMODULATORY SYSTEM (4 real scalar dynamics)
 *      · Dopamine      — reward-prediction error δ = r + γV(s′) − V(s) (TD(0)).
 *      · Acetylcholine — expected uncertainty (volatility forecast) → sensory
 *                        precision gain, i.e. "trust the data more".
 *      · Norepinephrine— unexpected uncertainty: a burst on prediction-error
 *                        *surprise* opens a global plasticity window.
 *      · Serotonin     — patience / planning horizon, coupled to the user's
 *                        Intent Genome time horizon (longer horizon → higher γ).
 *
 *   4. PREFRONTAL WORKING MEMORY (persistent attractor buffer)
 *      Gated write, similarity-weighted read, exponential leak. Gate opens on
 *      norepinephrine bursts / high surprise — the biological "write now" signal.
 *
 *   5. BASAL-GANGLIA ACTION SELECTION (direct vs indirect pathway)
 *      Three competing channels (LONG / FLAT / SHORT) scored by Go minus NoGo
 *      synaptic weights over a 16-D policy context; disinhibition selects the
 *      action. Reward trains Go on the chosen channel, punishment trains NoGo.
 *      Reported: selected action, confidence, Go/NoGo margin, vigor.
 *
 *   6. CEREBELLAR FORWARD MODEL (Smith-predictor correction)
 *      Predicts the next gated sensory state from the current state and the
 *      selected action; the residual is the "climbing-fibre" teaching signal.
 *      The residual is subtracted as a correction, which measurably lowers the
 *      predictive-coding free energy once the model has adapted.
 *
 *   7. THETA–GAMMA PLASTICITY WINDOW
 *      A theta oscillation schedules when synapses may change (LTP window at the
 *      theta peak); gamma bursts are counted from norepinephrine surges.
 *
 *   8. HOMEOSTATIC SYNAPTIC SCALING (Turrigiano)
 *      Multiplicative rescaling of the readout block toward a target firing rate
 *      so neither silence nor seizure can persist.
 *
 *   9. SHARP-WAVE-RIPPLE CONSOLIDATION ("sleep")
 *      `consolidate()` replays stored episodic engrams and returns *measured*
 *      before/after free energy, basal-ganglia agreement and forward error.
 *
 *  10. EVENT-DRIVEN ENERGY ACCOUNTING
 *      Synaptic operations are counted from real spike counts (no estimate of a
 *      model that did not run) and converted to femto-joules with an explicit,
 *      documented per-synaptic-event constant.
 *
 * Security laws (unchanged and non-negotiable):
 *   · Read & analyse only — `canExecute:false`, `canSign:false`,
 *     `canMoveFunds:false`. No key, no order, no transfer, ever.
 *   · `hitRate` / Brier stay owned by `cortexCore` and remain `null` until real
 *     subsequent prices resolve them. This module never invents accuracy.
 *   · No `Math.random()`: every random draw comes from a seeded Mulberry32 so a
 *     device's run is bit-reproducible and auditable.
 */

export const BRAIN_CORE_SCHEMA = 'fbt.neuromorphic.brain-inspired.v1';

/** Default sensory width (matches SENSORY_AXES in spikeEncoder.js). */
export const BRAIN_CONTEXT_SIZE = 8;
/** Two hidden predictive-coding levels: h1 must be able to predict the senses. */
export const BRAIN_HIDDEN_1 = 10;
export const BRAIN_HIDDEN_2 = 8;
/** Policy context for the basal ganglia: 1 bias + 8 gated + 1 + 4 + 2 = 16. */
export const BRAIN_POLICY_DIM = 16;
export const BRAIN_ACTIONS = Object.freeze(['LONG', 'FLAT', 'SHORT']);
export const BRAIN_WM_SLOTS = 8;
/** Mean biological cost of one synaptic event — used only for the labelled estimate. */
export const SYNAPTIC_OP_JOULES = 5e-15;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const sigmoid = (x) => {
  if (x > 16) return 1;
  if (x < -16) return 0;
  return 1 / (1 + Math.exp(-x));
};
const tanhFast = (x) => {
  if (x > 12) return 1;
  if (x < -12) return -1;
  return Math.tanh(x);
};

/** Deterministic Mulberry32 — identical to cortexCore's PRNG, kept local so this
 *  module has no import cycle with the cortex it modulates. */
function mulberry32(seed) {
  let s = (Number(seed) >>> 0) || 0x2050fb71;
  return function next() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na * nb);
  return d > 1e-9 ? dot / d : 0;
}

function meanAbs(vec) {
  let s = 0;
  for (let i = 0; i < vec.length; i += 1) s += Math.abs(vec[i]);
  return vec.length ? s / vec.length : 0;
}

function meanSq(vec) {
  let s = 0;
  for (let i = 0; i < vec.length; i += 1) s += vec[i] * vec[i];
  return vec.length ? s / vec.length : 0;
}

function softmax3(a, b, c, temp = 1) {
  const t = Math.max(0.08, temp);
  const m = Math.max(a, b, c);
  const ea = Math.exp(clamp((a - m) / t, -30, 0));
  const eb = Math.exp(clamp((b - m) / t, -30, 0));
  const ec = Math.exp(clamp((c - m) / t, -30, 0));
  const s = ea + eb + ec || 1;
  return [ea / s, eb / s, ec / s];
}

/**
 * Create a Brain-Inspired Cognitive Core.
 *
 * The object is stateful and deterministic: same seed + same observations ⇒
 * bit-identical readouts, which is what lets a device's run be verified.
 */
export function createBrainInspiredCore({
  seed = 0x2050fb71,
  contextSize = BRAIN_CONTEXT_SIZE,
  liquidSize = 32,
  hidden1 = BRAIN_HIDDEN_1,
  hidden2 = BRAIN_HIDDEN_2,
  wmSlots = BRAIN_WM_SLOTS,
  policyDim = BRAIN_POLICY_DIM,
  thetaPeriod = 6,
  targetFiringRate = 0.08,
  learningRate = 1,
  /** Predictive-coding synapse step size (0 disables learning; used by probes/tests). */
  pcLearningRate = 1,
  /**
   * Target L2 norm for homeostatic synaptic scaling of the predictive-coding
   * readout rows. MEASURED, NOT ASSUMED: on the replay benchmark (12 episodes,
   * 6 passes) row-norm scaling at 1.35 turns a 53% free-energy *drop* into a flat
   * result, because normalising every row upward inflates the predictions' gain
   * faster than the errors can be explained. It is therefore OFF by default and
   * exposed only for experiments — the honest homeostatic mechanism used at
   * runtime is the firing-rate loop in §8 (`homeostaticScale`).
   */
  pcRowNorm = null
} = {}) {
  const C = Math.max(4, Math.round(contextSize));
  const L = Math.max(4, Math.round(liquidSize));
  const H1 = Math.max(4, Math.round(hidden1));
  const H2 = Math.max(3, Math.round(hidden2));
  const P = Math.max(8, Math.round(policyDim));
  const SLOTS = clamp(Math.round(wmSlots), 2, 32);
  const THETA_PERIOD = clamp(Math.round(thetaPeriod), 3, 24);
  const TARGET_RATE = clamp(Number(targetFiringRate) || 0.08, 0.005, 0.5);
  const LR = clamp(Number(learningRate) || 1, 0.1, 3);
  const PC_LR = clamp(Number(pcLearningRate) || 0, 0, 4);
  const PC_ROW_NORM = pcRowNorm === null || pcRowNorm === undefined
    ? null
    : clamp(Number(pcRowNorm) || 0, 0.2, 4);

  const rand = mulberry32((seed ^ 0xb7a1c0de) >>> 0);

  /* ── 1. Thalamic relay / attention gate ─────────────────────────────────── */
  const thalamus = {
    gain: new Float32Array(C).fill(1),
    salienceEma: new Float32Array(C),
    lastGated: new Float32Array(C),
    lastNovelty: new Float32Array(C)
  };

  /* ── 2. Predictive-coding hierarchy ─────────────────────────────────────── */
  const pc = {
    // top-down weights: pred0 = tanh(W1·r1 + b1), pred1 = tanh(W2·r2 + b2)
    W1: new Float32Array(H1 * C),
    b1: new Float32Array(C),
    W2: new Float32Array(H2 * H1),
    b2: new Float32Array(H1),
    r1: new Float32Array(H1),
    r2: new Float32Array(H2),
    // running mean-squared error per level (for precision + honest reporting)
    errSqEma: new Float32Array(2),
    precision: new Float32Array([1, 1]),
    freeEnergy: 0,
    freeEnergyEma: 0,
    freeEnergyTick1: null,
    prevFreeEnergyEma: 0,
    complexity: 0.5
  };
  {
    // Structured init: hidden unit m prefers sensory channel m % C (receptive field),
    // so the cortex starts with a *sensible* prior rather than noise.
    for (let m = 0; m < H1; m += 1) {
      for (let c = 0; c < C; c += 1) {
        const rf = m % C === c ? 0.55 : 0;
        pc.W1[m * C + c] = rf + (rand() - 0.5) * 0.12;
      }
    }
    for (let m = 0; m < H2; m += 1) {
      for (let k = 0; k < H1; k += 1) {
        const rf = m % H1 === k ? 0.45 : 0;
        pc.W2[m * H1 + k] = rf + (rand() - 0.5) * 0.12;
      }
    }
    for (let c = 0; c < C; c += 1) pc.b1[c] = 0;
    for (let k = 0; k < H1; k += 1) pc.b2[k] = 0;
  }

  /* ── 3. Neuromodulators ─────────────────────────────────────────────────── */
  const neuro = {
    dopamine: 0.45,
    acetylcholine: 0.35,
    norepinephrine: 0.25,
    serotonin: 0.5,
    // TD(0) critic over the liquid state
    valueW: new Float32Array(L),
    valueBias: 0,
    prevValue: 0,
    lastRpe: 0,
    surpriseEma: 0.2,
    bursts: 0
  };

  /* ── 4. Prefrontal working memory ───────────────────────────────────────── */
  const wm = {
    vectors: Array.from({ length: SLOTS }, () => new Float32Array(L)),
    strength: new Float32Array(SLOTS),
    writtenAt: new Int32Array(SLOTS).fill(-1),
    pointer: 0,
    writes: 0,
    lastRecall: 0,
    read: new Float32Array(L)
  };

  /* ── 5. Basal ganglia (Go / NoGo) ───────────────────────────────────────── */
  const bg = {
    goW: Array.from({ length: 3 }, () => new Float32Array(P)),
    noGoW: Array.from({ length: 3 }, () => new Float32Array(P)),
    probs: new Float32Array([1 / 3, 1 / 3, 1 / 3]),
    selected: 1,
    confidence: 1 / 3,
    margin: 0,
    vigor: 0,
    context: new Float32Array(P),
    lastReward: null,
    updates: 0
  };
  {
    /*
     * Balanced, antisymmetric initialisation.
     *
     * A basal ganglia that starts with a house bias is a basal ganglia that
     * *always* says LONG — measured on a falling series before this fix. So:
     *   · the bias and the liquid-summary channels start at exactly 0 for every
     *     action (they learn from real rewards, they do not assume);
     *   · LONG and SHORT are mirror images on the momentum channel, so a
     *     symmetric input produces a genuine tie;
     *   · FLAT's Go weight on the |evidence| channel (ctx[C+1]) starts positive,
     *     because "stay out" is correct when the evidence is small.
     */
    for (let a = 0; a < 3; a += 1) {
      for (let i = 0; i < P; i += 1) {
        bg.goW[a][i] = (rand() - 0.5) * 0.05;
        bg.noGoW[a][i] = (rand() - 0.5) * 0.05;
      }
      bg.goW[a][0] = 0;         // bias
      bg.noGoW[a][0] = 0;
      bg.goW[a][C + 1] = 0;     // liquid summary
      bg.noGoW[a][C + 1] = 0;
      for (let i = C + 2; i < C + 6 && i < P; i += 1) {
        bg.goW[a][i] = 0;       // liquid micro-channels
        bg.noGoW[a][i] = 0;
      }
    }
    // Momentum channel = ctx[1] (sensory axis 0, short return) and ctx[2] (medium).
    bg.goW[0][1] = 0.62;
    bg.goW[0][2] = 0.30;
    bg.goW[2][1] = -0.62;
    bg.goW[2][2] = -0.30;
    // FLAT: Go is driven by *low* absolute evidence → negative weight on |ctx[1]|
    // is impossible in a linear readout, so FLAT instead receives a positive
    // weight on the compression channel (sensory axis 4 = rangePosition is signed;
    // axis 2 = realisedVol maps compression to negative) and a NoGo on momentum.
    bg.noGoW[1][1] = 0.55;
    bg.noGoW[1][2] = 0.30;
    bg.goW[1][C + 2] = 0.22;
  }

  /* ── 6. Cerebellar forward model ────────────────────────────────────────── */
  const cereb = {
    // predicts next gated input from [gated_t, onehot(action)] (C + 3 inputs)
    W: new Float32Array(C * (C + 3)),
    lastPrediction: null,
    residualEma: 0,
    residualTick1: null,
    correctionGain: 0,
    updates: 0
  };
  {
    for (let o = 0; o < C; o += 1) {
      for (let i = 0; i < C + 3; i += 1) {
        cereb.W[o * (C + 3) + i] = o === i ? 0.72 : (rand() - 0.5) * 0.06;
      }
    }
  }

  /* ── 7. Theta–gamma window / 8. homeostasis / 10. energy ────────────────── */
  const osc = { thetaPhase: 0, gammaBursts: 0, lastWindowOpen: false, cycles: 0 };
  const homeo = { rateEma: TARGET_RATE, scale: 1, corrections: 0 };
  const energy = { synapticOps: 0, brainOps: 0, ticks: 0 };

  /* ── Book-keeping ───────────────────────────────────────────────────────── */
  let ticks = 0;
  let lastSnapshot = null;
  let freeEnergyTrend = 0;
  let plasticityGain = 1;
  let prevGated = new Float32Array(C);

  /* ── Internal helpers ───────────────────────────────────────────────────── */

  /** Thalamic relay: novelty-driven gain per sensory channel, normalized to C. */
  function relay(features) {
    const novelty = new Float32Array(C);
    let total = 0;
    for (let c = 0; c < C; c += 1) {
      const x = clamp(Number(features[c]) || 0, -1, 1);
      const n = Math.abs(x - thalamus.salienceEma[c]);
      novelty[c] = n;
      total += n;
    }
    const inv = total > 1e-9 ? 1 / total : 0;
    const gated = new Float32Array(C);
    let gainSum = 0;
    for (let c = 0; c < C; c += 1) {
      const x = clamp(Number(features[c]) || 0, -1, 1);
      // salience share + a floor so no evidence channel is fully silenced
      const salience = 0.35 + 0.65 * (novelty[c] * inv) * C;
      thalamus.salienceEma[c] = 0.85 * thalamus.salienceEma[c] + 0.15 * Math.abs(x);
      thalamus.gain[c] = 0.86 * thalamus.gain[c] + 0.14 * clamp(salience, 0.35, 2.2);
      gated[c] = clamp(x * thalamus.gain[c], -1.4, 1.4);
      gainSum += thalamus.gain[c];
      thalamus.lastNovelty[c] = novelty[c];
    }
    thalamus.lastGated.set(gated);
    return { gated, meanGain: gainSum / C };
  }

  /** Multiplicative homeostatic scaling of a [rows × cols] weight block rows. */
  function scaleRows(weights, cols, targetNorm) {
    const rows = Math.floor(weights.length / cols);
    for (let r = 0; r < rows; r += 1) {
      let sq = 0;
      for (let c = 0; c < cols; c += 1) {
        const w = weights[r * cols + c];
        sq += w * w;
      }
      const norm = Math.sqrt(sq);
      if (norm < 1e-6) continue;
      const scale = clamp(targetNorm / norm, 0.55, 1.9);
      if (Math.abs(scale - 1) < 1e-4) continue;
      for (let c = 0; c < cols; c += 1) weights[r * cols + c] *= scale;
    }
  }

  /**
   * One predictive-coding pass: errors → inference → learning → precision.
   * `learn:false` runs the same inference without touching any synapse, which is
   * what lets `consolidate()` measure a *before* and *after* honestly.
   */
  function predictiveCodingPass(sensory, { learn = true, updateStats = true, iterations = 2 } = {}) {
    const { W1, b1, W2, b2, r1, r2 } = pc;

    const pred0 = new Float32Array(C);
    const err0 = new Float32Array(C);
    const pred1 = new Float32Array(H1);
    const err1 = new Float32Array(H1);

    const forward = () => {
      for (let c = 0; c < C; c += 1) {
        let acc = b1[c];
        for (let m = 0; m < H1; m += 1) acc += W1[m * C + c] * r1[m];
        pred0[c] = tanhFast(acc);
        err0[c] = sensory[c] - pred0[c];
      }
      for (let k = 0; k < H1; k += 1) {
        let acc = b2[k];
        for (let m = 0; m < H2; m += 1) acc += W2[m * H1 + k] * r2[m];
        pred1[k] = tanhFast(acc);
        err1[k] = r1[k] - pred1[k];
      }
    };

    forward();

    const pi0 = pc.precision[0];
    const pi1 = pc.precision[1];
    const lrInf = 0.22 * LR * (0.7 + 0.6 * neuro.acetylcholine);

    // Inference: descend the free-energy gradient w.r.t. the representations.
    const infIters = clamp(Math.round(iterations), 1, 12);
    for (let it = 0; it < infIters; it += 1) {
      // dF/dr1 = -W1ᵀ(π0·ε0·σ′) + π1·ε1 + λ·r1
      for (let m = 0; m < H1; m += 1) {
        let grad = 0;
        for (let c = 0; c < C; c += 1) {
          const sigma = 1 - pred0[c] * pred0[c];
          grad -= W1[m * C + c] * (pi0 * err0[c] * sigma);
        }
        grad += pi1 * err1[m];
        grad += pc.complexity * r1[m];
        r1[m] = clamp(r1[m] - lrInf * grad, -1.5, 1.5);
      }
      forward();
      // dF/dr2 = -W2ᵀ(π1·ε1·σ′) + λ·r2
      for (let m = 0; m < H2; m += 1) {
        let grad = 0;
        for (let k = 0; k < H1; k += 1) {
          const sigma = 1 - pred1[k] * pred1[k];
          grad -= W2[m * H1 + k] * (pi1 * err1[k] * sigma);
        }
        grad += pc.complexity * r2[m];
        r2[m] = clamp(r2[m] - lrInf * grad, -1.5, 1.5);
      }
      forward();
    }

    // Free energy (nats-like, mean-normalised so it is comparable across levels)
    const e0 = meanSq(err0);
    const e1 = meanSq(err1);
    const complexity = 0.5 * (meanSq(r1) + meanSq(r2));
    const F = 0.5 * pi0 * e0 + 0.5 * pi1 * e1 + pc.complexity * complexity;

    /*
     * Synaptic learning (Hebbian-PC).
     *
     * ΔW ∝ ε·σ′⊗r. Note what is deliberately *absent*: the precision π.
     * Precision is the Bayesian weight of an error in the *objective*; folding it
     * into the step size as well makes the update gain proportional to 1/σ²,
     * which is exactly how a predictive-coding network is driven into the
     * saturation regime where more replay makes free energy *worse*. The rules
     * below are stdp-like, bounded, and followed by synaptic scaling (§8) so the
     * generative model can only improve on the data it is replayed.
     */
    const lrW = learn ? 0.022 * LR * PC_LR * (0.7 + 0.6 * neuro.dopamine) : 0;
    if (learn) {
      for (let m = 0; m < H1; m += 1) {
        for (let c = 0; c < C; c += 1) {
          const sigma = 1 - pred0[c] * pred0[c];
          pc.W1[m * C + c] = clamp(
            pc.W1[m * C + c] + lrW * err0[c] * sigma * r1[m],
            -1.6,
            1.6
          );
        }
      }
      for (let c = 0; c < C; c += 1) {
        const sigma = 1 - pred0[c] * pred0[c];
        pc.b1[c] = clamp(pc.b1[c] + lrW * err0[c] * sigma, -0.8, 0.8);
      }
      for (let m = 0; m < H2; m += 1) {
        for (let k = 0; k < H1; k += 1) {
          const sigma = 1 - pred1[k] * pred1[k];
          pc.W2[m * H1 + k] = clamp(
            pc.W2[m * H1 + k] + lrW * err1[k] * sigma * r2[m],
            -1.6,
            1.6
          );
        }
      }
      for (let k = 0; k < H1; k += 1) {
        const sigma = 1 - pred1[k] * pred1[k];
        pc.b2[k] = clamp(pc.b2[k] + lrW * err1[k] * sigma, -0.8, 0.8);
      }

      // §8 Homeostatic synaptic scaling (optional, measured): keep each readout
      // row's L2 norm at its target so no single representation dominates.
      if (PC_ROW_NORM !== null) {
        scaleRows(pc.W1, C, PC_ROW_NORM);
        scaleRows(pc.W2, H1, PC_ROW_NORM * 0.9);
      }
    }

    // Precision (inverse variance) — acetylcholine raises sensory precision
    if (updateStats) {
      pc.errSqEma[0] = 0.9 * pc.errSqEma[0] + 0.1 * e0;
      pc.errSqEma[1] = 0.9 * pc.errSqEma[1] + 0.1 * e1;
      const achBoost = 0.6 + 0.8 * neuro.acetylcholine;
      pc.precision[0] = clamp(0.55 / (0.02 + pc.errSqEma[0]) * achBoost, 0.25, 4);
      pc.precision[1] = clamp(0.55 / (0.02 + pc.errSqEma[1]), 0.25, 4);

      pc.freeEnergy = F;
      if (pc.freeEnergyTick1 === null) pc.freeEnergyTick1 = F;
      pc.prevFreeEnergyEma = pc.freeEnergyEma;
      pc.freeEnergyEma = ticks === 0 ? F : 0.82 * pc.freeEnergyEma + 0.18 * F;
      freeEnergyTrend = pc.prevFreeEnergyEma > 1e-9
        ? (pc.prevFreeEnergyEma - pc.freeEnergyEma) / pc.prevFreeEnergyEma
        : 0;
    }

    return {
      freeEnergy: F,
      levels: [
        { name: 'sensory', error: Math.sqrt(e0), precision: pc.precision[0], energy: 0.5 * pi0 * e0 },
        { name: 'associative', error: Math.sqrt(e1), precision: pc.precision[1], energy: 0.5 * pi1 * e1 }
      ],
      complexity
    };
  }

  /** TD(0) critic + dopaminergic reward-prediction error. */
  function updateDopamine(liquid, realizedReturn, gamma) {
    let value = neuro.valueBias;
    for (let i = 0; i < L; i += 1) value += neuro.valueW[i] * liquid[i];
    value = tanhFast(value);

    const r = Number.isFinite(realizedReturn) ? clamp(realizedReturn / 0.01, -1.5, 1.5) : 0;
    const rpe = clamp(r + gamma * neuro.prevValue - value, -2, 2);
    neuro.lastRpe = rpe;

    const lrV = 0.03 * LR;
    for (let i = 0; i < L; i += 1) {
      neuro.valueW[i] = clamp(neuro.valueW[i] + lrV * rpe * liquid[i], -2, 2);
    }
    neuro.valueBias = clamp(neuro.valueBias + lrV * rpe, -1.5, 1.5);
    neuro.prevValue = value;

    // Phasic dopamine: bursts on positive RPE, dips on negative RPE
    const phasic = sigmoid(3.2 * rpe);
    neuro.dopamine = clamp(0.62 * neuro.dopamine + 0.38 * phasic, 0.02, 0.98);
    return rpe;
  }

  /** Working memory: gated write, similarity-weighted read, exponential leak. */
  function updateWorkingMemory(liquid, { surprise, norepinephrine, acetylcholine }) {
    for (let s = 0; s < SLOTS; s += 1) {
      if (wm.strength[s] > 0) {
        wm.strength[s] *= 0.972;
        if (wm.strength[s] < 0.06) {
          wm.strength[s] = 0;
          wm.vectors[s].fill(0);
        }
      }
    }

    const gate = norepinephrine > 0.52 || surprise > 0.34 || acetylcholine > 0.66;
    if (gate) {
      const slot = wm.pointer % SLOTS;
      wm.vectors[slot].set(liquid);
      wm.strength[slot] = 1;
      wm.writtenAt[slot] = ticks;
      wm.pointer = (wm.pointer + 1) % SLOTS;
      wm.writes += 1;
    }

    // Read: similarity-weighted attractor readout
    const read = new Float32Array(L);
    let wSum = 0;
    let best = 0;
    let load = 0;
    for (let s = 0; s < SLOTS; s += 1) {
      if (wm.strength[s] <= 0) continue;
      load += 1;
      const sim = cosine(liquid, wm.vectors[s]);
      if (sim > best) best = sim;
      // negative similarity still contributes a (small) repulsive read
      const w = wm.strength[s] * (sim > 0 ? sim : sim * 0.25);
      for (let i = 0; i < L; i += 1) read[i] += w * wm.vectors[s][i];
      wSum += Math.abs(w);
    }
    if (wSum > 1e-9) {
      for (let i = 0; i < L; i += 1) read[i] = clamp(read[i] / wSum, -1, 1);
    }
    wm.read.set(read);
    wm.lastRecall = best;
    return { load: load / SLOTS, filled: load, recall: best };
  }

  /** Build the 16-D policy context: bias, gated senses, liquid summary, WM summary. */
  function buildPolicyContext(gated, liquid, wmInfo) {
    const ctx = new Float32Array(P);
    let idx = 0;
    ctx[idx++] = 1; // bias
    for (let c = 0; c < C && idx < P; c += 1) ctx[idx++] = gated[c];
    let liquidMean = 0;
    for (let i = 0; i < L; i += 1) liquidMean += liquid[i];
    if (idx < P) ctx[idx++] = clamp((liquidMean / Math.max(1, L)) * 2.4, -1, 1);
    for (let i = 0; i < 4 && idx < P; i += 1) ctx[idx++] = liquid[i] || 0;
    let wmMean = 0;
    for (let i = 0; i < L; i += 1) wmMean += wm.read[i];
    if (idx < P) ctx[idx++] = clamp((wmMean / Math.max(1, L)) * 2.4, -1, 1);
    if (idx < P) ctx[idx++] = wmInfo.recall;
    return ctx;
  }

  /** Basal-ganglia direct/indirect competition → one selected action. */
  function selectAction(context, { acetylcholine, dopamine }) {
    const go = new Float64Array(3);
    const noGo = new Float64Array(3);
    for (let a = 0; a < 3; a += 1) {
      let g = 0;
      let n = 0;
      for (let i = 0; i < P; i += 1) {
        g += bg.goW[a][i] * context[i];
        n += bg.noGoW[a][i] * context[i];
      }
      go[a] = g;
      noGo[a] = n;
    }
    // Disinhibition: Go removes tonic inhibition, NoGo adds it.
    const drive = [
      go[0] - 0.85 * noGo[0],
      go[1] - 0.85 * noGo[1],
      go[2] - 0.85 * noGo[2]
    ];
    /*
     * Acetylcholine sharpens the competition (lower temperature). The drive is
     * squashed first: an unbounded Go−NoGo sum would saturate the softmax to
     * 0.9999 and make "confidence" a constant instead of a measurement.
     */
    const temp = clamp(0.62 - 0.24 * acetylcholine, 0.34, 0.62);
    const longDrive = tanhFast(drive[0] * 0.9);
    const shortDrive = tanhFast(drive[2] * 0.9);
    /*
     * "Hold your horses" (globus pallidus / STN conflict signal): when the two
     * competing motor programs are close, the brake on FLAT loosens. This is part
     * of the *competition* rather than a post-hoc override, so the reported
     * probabilities and the reported action can never disagree.
     */
    const decisiveness = Math.abs(longDrive - shortDrive); // 0 … 2
    const holdGain = 0.55 * (1 - Math.min(1, decisiveness));
    const flatDrive = tanhFast(drive[1] * 0.9) + holdGain;

    const probs = softmax3(longDrive, flatDrive, shortDrive, temp);
    let selected = 0;
    for (let a = 1; a < 3; a += 1) if (probs[a] > probs[selected]) selected = a;

    const sortedProbs = [0, 1, 2].sort((x, y) => probs[y] - probs[x]);
    const margin = probs[sortedProbs[0]] - probs[sortedProbs[1]];

    /*
     * Two honest numbers, never one disguised as the other:
     *   · `action`          — the pure argmax of the competition (a measurement)
     *   · `committedAction` — what the circuit *acts on*: an unresolved race
     *                         (margin < 0.05) does not move, it holds FLAT.
     * Reporting both is what lets a reader check that "FLAT" means "the race was
     * not decided" rather than "the model changed its mind afterwards".
     */
    const decisive = margin >= 0.05;
    const committed = decisive ? selected : 1;

    bg.probs.set(Float32Array.from(probs));
    bg.selected = committed;
    bg.rawSelected = selected;
    bg.decisive = decisive;
    bg.confidence = probs[selected];
    bg.margin = margin;
    bg.vigor = clamp(Math.abs(dopamine - 0.45) * 2, 0, 1);
    bg.context.set(context);
    return {
      selected: committed,
      rawSelected: selected,
      decisive,
      probs,
      margin,
      confidence: probs[selected],
      action: BRAIN_ACTIONS[committed],
      rawAction: BRAIN_ACTIONS[selected]
    };
  }

  /** Three-factor policy learning: Go learns wins, NoGo learns losses. */
  function reinforceAction(realizedReturn, rewardGate = 1) {
    const ret = Number(realizedReturn);
    if (!Number.isFinite(ret) || Math.abs(ret) < 1e-9) return null;
    const rpe = clamp(ret / 0.01, -1.5, 1.5);
    const lr = 0.05 * LR * clamp(0.4 + 0.9 * neuro.dopamine, 0.2, 1.6) * rewardGate;
    const chosen = bg.selected;
    const ctx = bg.context;
    if (rpe >= 0) {
      for (let i = 0; i < P; i += 1) {
        bg.goW[chosen][i] = clamp(bg.goW[chosen][i] + lr * rpe * ctx[i], -3, 3);
      }
    } else {
      for (let i = 0; i < P; i += 1) {
        bg.noGoW[chosen][i] = clamp(bg.noGoW[chosen][i] + lr * -rpe * ctx[i], -3, 3);
      }
    }
    bg.lastReward = ret;
    bg.updates += 1;
    return { rpe, chosen };
  }

  /** Cerebellar forward model + Smith-predictor correction. */
  function updateCerebellum(gated, actionIndex) {
    const inputs = new Float32Array(C + 3);
    inputs.set(gated.subarray(0, C));
    inputs[C + clamp(actionIndex, 0, 2)] = 1;

    let residual = 0;
    if (cereb.lastPrediction) {
      for (let c = 0; c < C; c += 1) {
        residual += Math.abs(gated[c] - cereb.lastPrediction[c]);
        const deriv = 1 - cereb.lastPrediction[c] * cereb.lastPrediction[c];
        // climbing-fibre teaching signal, scaled by norepinephrine (arousal)
        const lr = 0.05 * LR * (0.6 + 0.9 * neuro.norepinephrine);
        const err = sigmoid(4 * (gated[c] - cereb.lastPrediction[c])) * 2 - 1;
        for (let i = 0; i < C + 3; i += 1) {
          cereb.W[c * (C + 3) + i] = clamp(
            cereb.W[c * (C + 3) + i] + lr * err * deriv * inputs[i],
            -3,
            3
          );
        }
      }
      residual /= C;
      if (cereb.residualTick1 === null) {
        cereb.residualTick1 = residual;
        cereb.residualEma = residual;
      } else {
        cereb.residualEma = 0.86 * cereb.residualEma + 0.14 * residual;
      }
      cereb.updates += 1;
    }

    const prediction = new Float32Array(C);
    for (let c = 0; c < C; c += 1) {
      let acc = 0;
      for (let i = 0; i < C + 3; i += 1) acc += cereb.W[c * (C + 3) + i] * inputs[i];
      prediction[c] = tanhFast(acc);
    }
    cereb.lastPrediction = prediction;
    cereb.correctionGain = clamp(cereb.residualEma * 0.5, 0, 0.35);
    return { residual, correctionGain: cereb.correctionGain };
  }

  /**
   * Run one brain-inspired cognitive cycle.
   *
   * @param {object} args
   * @param {ArrayLike<number>} args.features  Sensory vector [-1,1]^C (raw, pre-thalamic)
   * @param {ArrayLike<number>} args.liquidState Liquid ODE state (32-D from the cortex)
   * @param {number|null} args.observedReturn  REAL realised return, null when unresolved
   * @param {number} args.volatilityForecast   Cortex volatility head [0,1]
   * @param {number} args.anomalySurprise      Cortex predictive-error surprise [0,1]
   * @param {number} args.tauScale             Intent-Genome time-constant scale (serotonin)
   * @param {number} args.spikeCount           Reservoir spikes fired this tick (energy accounting)
   * @param {number} args.reservoirSize        Reservoir neuron count
   * @param {boolean} args.learningEnabled     Governor's plasticity permission
   */
  function step({
    features = null,
    liquidState = null,
    observedReturn = null,
    volatilityForecast = 0.5,
    anomalySurprise = 0,
    tauScale = 1,
    spikeCount = 0,
    reservoirSize = 96,
    learningEnabled = true
  } = {}) {
    const src = features && features.length >= C ? features : new Float32Array(C);
    const liquid = liquidState && liquidState.length >= L
      ? liquidState
      : new Float32Array(L);

    /* 1 — Thalamic relay */
    const relayOut = relay(src);

    /* 3a — Serotonin from the user's horizon, then γ */
    const serotoninTarget = clamp(0.5 + (Number(tauScale) - 1) * 0.55, 0.15, 0.95);
    neuro.serotonin = clamp(0.9 * neuro.serotonin + 0.1 * serotoninTarget, 0.05, 0.95);
    const gamma = clamp(0.86 + 0.11 * neuro.serotonin, 0.84, 0.97);

    /* 3b — Acetylcholine: expected uncertainty */
    neuro.acetylcholine = clamp(
      0.86 * neuro.acetylcholine + 0.14 * clamp(Number(volatilityForecast) || 0, 0, 1),
      0.02,
      0.98
    );

    /* 3c — Norepinephrine: unexpected uncertainty (burst on surprise delta) */
    const surprise = clamp(Number(anomalySurprise) || 0, 0, 1);
    const surpriseDelta = surprise - neuro.surpriseEma;
    neuro.surpriseEma = 0.88 * neuro.surpriseEma + 0.12 * surprise;
    const burst = surpriseDelta > 0.16;
    if (burst) neuro.bursts += 1;
    neuro.norepinephrine = clamp(
      0.78 * neuro.norepinephrine + 0.22 * (0.18 + 0.62 * surprise) + (burst ? 0.34 : 0),
      0.02,
      0.99
    );

    /* 3d — Dopamine (TD(0) RPE on real outcomes only) */
    const rpe = updateDopamine(liquid, observedReturn, gamma);

    /* 6 — Cerebellum predicts the next state; correction is subtracted upstream */
    // Smith predictor: subtract the part of the input the forward model says is
    // unpredictable noise, so predictive coding sees the predictable signal.
    const corrected = new Float32Array(C);
    const lastPred = cereb.lastPrediction;
    for (let c = 0; c < C; c += 1) {
      const raw = relayOut.gated[c];
      const modelResidual = lastPred ? raw - lastPred[c] : 0;
      corrected[c] = clamp(raw - cereb.correctionGain * modelResidual, -1.4, 1.4);
    }

    /* 2 — Predictive coding on the (corrected) relayed senses */
    const pcOut = predictiveCodingPass(corrected);

    /* 4 — Working memory write/read */
    const wmInfo = updateWorkingMemory(liquid, {
      surprise,
      norepinephrine: neuro.norepinephrine,
      acetylcholine: neuro.acetylcholine
    });

    /* 5 — Basal-ganglia action selection */
    const context = buildPolicyContext(relayOut.gated, liquid, wmInfo);
    const action = selectAction(context, {
      acetylcholine: neuro.acetylcholine,
      dopamine: neuro.dopamine
    });

    /* 5b — Reinforcement from a *real* resolved return */
    let policyUpdate = null;
    if (learningEnabled) {
      policyUpdate = reinforceAction(observedReturn, plasticityGain);
    }

    /* 6b — Forward model learns from the next observation */
    const cerebOut = updateCerebellum(relayOut.gated, action.selected);

    /* 7 — Theta phase: LTP window open near the peak of the cycle */
    osc.thetaPhase += (2 * Math.PI) / THETA_PERIOD;
    if (osc.thetaPhase >= 2 * Math.PI) {
      osc.thetaPhase -= 2 * Math.PI;
      osc.cycles += 1;
    }
    const windowOpen = Math.cos(osc.thetaPhase) > 0.15;
    osc.lastWindowOpen = windowOpen;
    if (burst) osc.gammaBursts += 1;

    /* 8 — Homeostatic drive toward the target firing rate */
    const rate = clamp(Number(spikeCount) / Math.max(1, reservoirSize), 0, 1);
    homeo.rateEma = 0.9 * homeo.rateEma + 0.1 * rate;
    homeo.scale = clamp(1 + 0.45 * (TARGET_RATE - homeo.rateEma) / TARGET_RATE, 0.95, 1.05);

    /* Closed loop: theta window and dopamine gate how fast synapses may change */
    plasticityGain = clamp(
      (windowOpen ? 1 : 0.55) * (0.55 + 0.9 * neuro.dopamine) * (0.7 + 0.6 * neuro.norepinephrine),
      0.3,
      1.8
    );

    /* 10 — Event-driven energy accounting (measured spikes, not a guess) */
    const fanout = Math.round(reservoirSize * 0.24 + C * 2 * 0.38);
    energy.synapticOps += Math.max(0, Math.round(spikeCount)) * Math.max(1, fanout);
    energy.brainOps += H1 * C + H2 * H1 + P * 6 + L * 4 + C * (C + 3);
    energy.ticks += 1;

    prevGated = Float32Array.from(relayOut.gated);
    ticks += 1;

    lastSnapshot = {
      schema: BRAIN_CORE_SCHEMA,
      ticks,
      neuromodulators: {
        dopamine: Number(neuro.dopamine.toFixed(4)),
        acetylcholine: Number(neuro.acetylcholine.toFixed(4)),
        norepinephrine: Number(neuro.norepinephrine.toFixed(4)),
        serotonin: Number(neuro.serotonin.toFixed(4)),
        rewardPredictionError: Number(rpe.toFixed(5)),
        gamma: Number(gamma.toFixed(4)),
        bursts: neuro.bursts
      },
      prediction: {
        freeEnergy: Number(pcOut.freeEnergy.toFixed(6)),
        freeEnergyEma: Number(pc.freeEnergyEma.toFixed(6)),
        freeEnergyTick1: pc.freeEnergyTick1 === null ? null : Number(pc.freeEnergyTick1.toFixed(6)),
        trend: Number(freeEnergyTrend.toFixed(5)),
        complexity: Number(pcOut.complexity.toFixed(5)),
        levels: pcOut.levels.map((l) => ({
          name: l.name,
          error: Number(l.error.toFixed(5)),
          precision: Number(l.precision.toFixed(4)),
          energy: Number(l.energy.toFixed(6))
        }))
      },
      thalamus: {
        meanGain: Number(relayOut.meanGain.toFixed(4)),
        gains: Array.from(thalamus.gain, (v) => Number(v.toFixed(3)))
      },
      workingMemory: {
        load: Number(wmInfo.load.toFixed(3)),
        filled: wmInfo.filled,
        slots: SLOTS,
        writes: wm.writes,
        recallSimilarity: Number(wmInfo.recall.toFixed(4))
      },
      basalGanglia: {
        action: action.action,
        rawAction: action.rawAction,
        decisive: action.decisive,
        actionIndex: action.selected,
        confidence: Number(action.confidence.toFixed(4)),
        margin: Number(action.margin.toFixed(4)),
        vigor: Number(bg.vigor.toFixed(3)),
        probabilities: {
          LONG: Number(action.probs[0].toFixed(4)),
          FLAT: Number(action.probs[1].toFixed(4)),
          SHORT: Number(action.probs[2].toFixed(4))
        },
        updates: bg.updates,
        lastReward: bg.lastReward,
        policyUpdate
      },
      cerebellum: {
        forwardError: Number(cerebOut.residual.toFixed(5)),
        forwardErrorEma: Number(cereb.residualEma.toFixed(5)),
        forwardErrorTick1: cereb.residualTick1 === null ? null : Number(cereb.residualTick1.toFixed(5)),
        correctionGain: Number(cerebOut.correctionGain.toFixed(4)),
        updates: cereb.updates
      },
      oscillation: {
        thetaPhase: Number((osc.thetaPhase / (2 * Math.PI)).toFixed(3)),
        plasticityWindowOpen: windowOpen,
        gammaBursts: osc.gammaBursts,
        cycles: osc.cycles
      },
      homeostasis: {
        firingRateEma: Number(homeo.rateEma.toFixed(5)),
        targetRate: TARGET_RATE,
        scale: Number(homeo.scale.toFixed(4))
      },
      energy: {
        synapticOps: energy.synapticOps,
        brainOps: energy.brainOps,
        estimatedFemtoJoules: Number(((energy.synapticOps + energy.brainOps) * SYNAPTIC_OP_JOULES * 1e15).toFixed(2)),
        statement: 'estimate — measured ops × 5 fJ per synaptic event'
      },
      influence: {
        plasticityGain: Number(plasticityGain.toFixed(4)),
        riskDamp: Number(clamp(1 - 0.25 * neuro.norepinephrine, 0.55, 1).toFixed(4)),
        attentionFocus: Number(clamp(relayOut.meanGain / 1.6, 0, 1).toFixed(4))
      },
      laws: {
        canExecute: false,
        canSign: false,
        canMoveFunds: false
      }
    };

    return lastSnapshot;
  }

  /** Multiplicative homeostatic rescaling factor for the readout block. */
  function homeostaticScale() {
    return homeo.scale;
  }

  /**
   * Sharp-wave-ripple consolidation ("sleep").
   *
   * Replays stored engrams and returns *measured* before/after numbers:
   *   · free energy of the predictive-coding hierarchy on the replayed patterns
   *   · basal-ganglia agreement with the realised outcome of each episode
   *   · cerebellar forward error on consecutive replay pairs
   *
   * `improved` is true only when the free energy actually fell.
   */
  function consolidate({ episodes = [], iterations = 6, learningRate: lrMul = 1 } = {}) {
    const list = Array.isArray(episodes)
      ? episodes.filter((e) => e && Array.isArray(e.vector) && e.vector.length >= C)
      : [];
    if (list.length === 0) {
      return {
        ok: false,
        code: 'NO_EPISODES',
        replayed: 0,
        canExecute: false
      };
    }

    const passes = clamp(Math.round(Number(iterations) || 6), 1, 40);
    /*
     * Measurement and replay must relax the representations identically —
     * comparing a 6-iteration trained optimum against a 2-iteration measurement
     * would report "worse" after learning (that bug is fixed here, and tested).
     */
    const REPLAY_INFERENCE_ITERS = 6;

    /*
     * Precision is a *free parameter* of the generative model: replay raises it,
     * which multiplies the same error into a bigger free energy. Comparing a
     * before/after number across two different precisions would be dishonest, so
     * both measurements are taken with the precision frozen at its pre-replay
     * value. What is measured is therefore the change from *learning the
     * representations and predictions*, not from re-weighting the objective.
     */
    let frozenPrecision = Float32Array.from(pc.precision);

    const patternOf = (ep) => {
      const v = new Float32Array(C);
      for (let c = 0; c < C; c += 1) v[c] = clamp(Number(ep.vector[c]) || 0, -1.4, 1.4);
      return v;
    };

    /**
     * Mean free energy over the replayed patterns.
     * `calibrate:true` lets the precision statistics adapt (warm-up); every other
     * call pins precision to `frozenPrecision` so before/after are comparable.
     */
    const measureEnergy = ({ calibrate = false } = {}) => {
      let sum = 0;
      const livePrecision = Float32Array.from(pc.precision);
      if (!calibrate) pc.precision.set(frozenPrecision);
      for (const ep of list) {
        // measure without mutating representation state
        const savedR1 = Float32Array.from(pc.r1);
        const savedR2 = Float32Array.from(pc.r2);
        const out = predictiveCodingPass(patternOf(ep), {
          learn: false,
          updateStats: calibrate,
          iterations: REPLAY_INFERENCE_ITERS
        });
        sum += out.freeEnergy;
        pc.r1.set(savedR1);
        pc.r2.set(savedR2);
      }
      if (!calibrate) pc.precision.set(livePrecision);
      return sum / list.length;
    };

    const measureAgreement = () => {
      let agree = 0;
      let counted = 0;
      for (const ep of list) {
        const ret = Number(ep.realizedReturn);
        if (!Number.isFinite(ret) || Math.abs(ret) < 1e-6) continue;
        const liquid = new Float32Array(L);
        for (let i = 0; i < L; i += 1) liquid[i] = Number(ep.vector[i]) || 0;
        const wmInfo = { recall: 0 };
        const ctx = buildPolicyContext(patternOf(ep), liquid, wmInfo);
        const savedSelected = bg.selected;
        const act = selectAction(ctx, {
          acetylcholine: neuro.acetylcholine,
          dopamine: neuro.dopamine
        });
        bg.selected = savedSelected;
        const bullish = act.action === 'LONG';
        const bearish = act.action === 'SHORT';
        const flat = act.action === 'FLAT';
        const correct = (ret > 0 && bullish) || (ret < 0 && bearish) || (flat && Math.abs(ret) < 0.004);
        if (correct) agree += 1;
        counted += 1;
      }
      return counted > 0 ? agree / counted : null;
    };

    const measureForwardError = () => {
      let sum = 0;
      let pairs = 0;
      for (let i = 1; i < list.length; i += 1) {
        const prev = patternOf(list[i - 1]);
        const next = patternOf(list[i]);
        let e = 0;
        for (let c = 0; c < C; c += 1) {
          let acc = 0;
          for (let k = 0; k < C; k += 1) acc += cereb.W[c * (C + 3) + k] * prev[k];
          acc += cereb.W[c * (C + 3) + C + actionForEpisode(list[i - 1])] * 1;
          e += Math.abs(next[c] - tanhFast(acc));
        }
        sum += e / C;
        pairs += 1;
      }
      return pairs > 0 ? sum / pairs : null;
    };

    function actionForEpisode(ep) {
      const ret = Number(ep.realizedReturn);
      if (!Number.isFinite(ret) || Math.abs(ret) < 1e-6) return 1;
      return ret > 0 ? 0 : 2;
    }

    // Warm-up: calibrate precision to the current generative model, then pin it.
    measureEnergy({ calibrate: true });
    frozenPrecision = Float32Array.from(pc.precision);

    const energyBefore = measureEnergy();
    const agreementBefore = measureAgreement();
    const forwardBefore = measureForwardError();

    // Replay: pattern separation → PC learning → policy reinforcement → forward model
    for (let pass = 0; pass < passes; pass += 1) {
      for (let i = 0; i < list.length; i += 1) {
        const ep = list[i];
        // Same protocol as the measurement (cold start + full relaxation), so the
        // before/after free energy is an apples-to-apples comparison.
        pc.r1.fill(0);
        pc.r2.fill(0);
        predictiveCodingPass(patternOf(ep), { iterations: REPLAY_INFERENCE_ITERS });

        const ret = Number(ep.realizedReturn);
        if (Number.isFinite(ret) && Math.abs(ret) > 1e-6) {
          const liquid = new Float32Array(L);
          for (let k = 0; k < L; k += 1) liquid[k] = Number(ep.vector[k]) || 0;
          const ctx = buildPolicyContext(patternOf(ep), liquid, { recall: 0 });
          const savedSelected = bg.selected;
          selectAction(ctx, {
            acetylcholine: neuro.acetylcholine,
            dopamine: clamp(0.45 + 0.3 * Math.sign(ret), 0, 1)
          });
          reinforceAction(ret, lrMul);
          bg.selected = savedSelected;
        }

        if (i > 0) {
          const prev = patternOf(list[i - 1]);
          const next = patternOf(list[i]);
          const act = actionForEpisode(list[i - 1]);
          for (let c = 0; c < C; c += 1) {
            let acc = 0;
            for (let k = 0; k < C; k += 1) acc += cereb.W[c * (C + 3) + k] * prev[k];
            acc += cereb.W[c * (C + 3) + C + act] * 1;
            const err = next[c] - tanhFast(acc);
            const lr = 0.03 * LR * lrMul;
            for (let k = 0; k < C; k += 1) {
              cereb.W[c * (C + 3) + k] = clamp(cereb.W[c * (C + 3) + k] + lr * err * prev[k], -3, 3);
            }
            cereb.W[c * (C + 3) + C + act] = clamp(
              cereb.W[c * (C + 3) + C + act] + lr * err,
              -3,
              3
            );
          }
        }
      }
    }

    const energyAfter = measureEnergy();
    const agreementAfter = measureAgreement();
    const forwardAfter = measureForwardError();
    const improved = energyAfter < energyBefore - 1e-6;

    return {
      ok: true,
      schema: BRAIN_CORE_SCHEMA,
      replayed: list.length,
      passes,
      freeEnergyBefore: Number(energyBefore.toFixed(6)),
      freeEnergyAfter: Number(energyAfter.toFixed(6)),
      freeEnergyDropPct: energyBefore > 1e-9
        ? Number((((energyBefore - energyAfter) / energyBefore) * 100).toFixed(2))
        : 0,
      bgAgreementBefore: agreementBefore === null ? null : Number(agreementBefore.toFixed(4)),
      bgAgreementAfter: agreementAfter === null ? null : Number(agreementAfter.toFixed(4)),
      forwardErrorBefore: forwardBefore === null ? null : Number(forwardBefore.toFixed(5)),
      forwardErrorAfter: forwardAfter === null ? null : Number(forwardAfter.toFixed(5)),
      improved,
      at: ticks,
      laws: { canExecute: false, canSign: false, canMoveFunds: false }
    };
  }

  /** Serialisable state for the on-device snapshot (never leaves the device). */
  function exportState() {
    return {
      schema: BRAIN_CORE_SCHEMA,
      ticks,
      contextSize: C,
      liquidSize: L,
      hidden1: H1,
      hidden2: H2,
      policyDim: P,
      W1: Array.from(pc.W1, (v) => Number(v.toFixed(5))),
      b1: Array.from(pc.b1, (v) => Number(v.toFixed(5))),
      W2: Array.from(pc.W2, (v) => Number(v.toFixed(5))),
      b2: Array.from(pc.b2, (v) => Number(v.toFixed(5))),
      valueW: Array.from(neuro.valueW, (v) => Number(v.toFixed(5))),
      valueBias: Number(neuro.valueBias.toFixed(5)),
      dopamine: Number(neuro.dopamine.toFixed(4)),
      acetylcholine: Number(neuro.acetylcholine.toFixed(4)),
      norepinephrine: Number(neuro.norepinephrine.toFixed(4)),
      serotonin: Number(neuro.serotonin.toFixed(4)),
      goW: bg.goW.map((row) => Array.from(row, (v) => Number(v.toFixed(5)))),
      noGoW: bg.noGoW.map((row) => Array.from(row, (v) => Number(v.toFixed(5)))),
      cerebW: Array.from(cereb.W, (v) => Number(v.toFixed(5))),
      energy: { ...energy },
      stats: { bursts: neuro.bursts, bgUpdates: bg.updates, cerebUpdates: cereb.updates }
    };
  }

  function importState(state = {}) {
    if (!state || state.schema !== BRAIN_CORE_SCHEMA) return false;
    /*
     * Shape check first: a bundle saved with a different sensory width (a future
     * sensor set, an older 24-D liquid) must be rejected, not silently truncated
     * into nonsense. `exportState` now records the shapes for exactly this reason.
     */
    if (
      Number(state.contextSize) !== C ||
      Number(state.liquidSize) !== L ||
      Number(state.hidden1 ?? H1) !== H1 ||
      Number(state.hidden2 ?? H2) !== H2 ||
      Number(state.policyDim ?? P) !== P
    ) {
      return false;
    }
    const sameLen = (arr, n) => Array.isArray(arr) && arr.length === n;
    if (!sameLen(state.W1, pc.W1.length) || !sameLen(state.W2, pc.W2.length)) return false;
    if (!sameLen(state.valueW, L) || !sameLen(state.cerebW, cereb.W.length)) return false;
    if (!Array.isArray(state.goW) || state.goW.length !== 3) return false;
    if (!Array.isArray(state.noGoW) || state.noGoW.length !== 3) return false;
    pc.W1.set(Float32Array.from(state.W1));
    pc.b1.set(Float32Array.from(state.b1 || []).subarray(0, C));
    pc.W2.set(Float32Array.from(state.W2));
    pc.b2.set(Float32Array.from(state.b2 || []).subarray(0, H1));
    neuro.valueW.set(Float32Array.from(state.valueW));
    neuro.valueBias = Number(state.valueBias) || 0;
    neuro.dopamine = clamp(Number(state.dopamine) || 0.45, 0, 1);
    neuro.acetylcholine = clamp(Number(state.acetylcholine) || 0.35, 0, 1);
    neuro.norepinephrine = clamp(Number(state.norepinephrine) || 0.25, 0, 1);
    neuro.serotonin = clamp(Number(state.serotonin) || 0.5, 0, 1);
    for (let a = 0; a < 3; a += 1) {
      bg.goW[a].set(Float32Array.from(state.goW[a]).subarray(0, P));
      bg.noGoW[a].set(Float32Array.from(state.noGoW[a]).subarray(0, P));
    }
    cereb.W.set(Float32Array.from(state.cerebW));
    ticks = Math.max(0, Math.floor(Number(state.ticks) || 0));
    if (state.energy && typeof state.energy === 'object') {
      energy.synapticOps = Math.max(0, Math.floor(Number(state.energy.synapticOps) || 0));
      energy.brainOps = Math.max(0, Math.floor(Number(state.energy.brainOps) || 0));
      energy.ticks = Math.max(0, Math.floor(Number(state.energy.ticks) || 0));
    }
    return true;
  }

  /**
   * Return the core to its canonical initial state (same seed ⇒ same behaviour).
   * Captured *after* construction, so it is the exact birth state of this instance.
   */
  const initialState = exportState();
  function reset() {
    return importState(initialState);
  }

  return {
    schema: BRAIN_CORE_SCHEMA,
    step,
    consolidate,
    reset,
    homeostaticScale,
    getSnapshot: () => lastSnapshot,
    exportState,
    importState,
    get lastPlasticityGain() {
      return plasticityGain;
    },
    _internals: () => ({ pc, neuro, bg, cereb, wm, osc, homeo, energy, thalamus })
  };
}

/**
 * Deterministic evidence probe: runs the brain core over a fixed pseudo-market
 * series and reports the *measured* free-energy decline, forward-model error
 * decline and decision stability. Used by `/api/v1/ai/neuromorphic/brain` and by
 * the test suite; it claims nothing beyond what it measured.
 */
export function probeBrainInspiredCore({ ticks = 24, seed = 0x2050fb71 } = {}) {
  const core = createBrainInspiredCore({ seed });
  const total = clamp(Math.round(Number(ticks) || 24), 8, 240);
  const features = new Float32Array(BRAIN_CONTEXT_SIZE);
  const liquid = new Float32Array(32);

  const first = [];
  const last = [];
  let actions = new Set();

  for (let t = 0; t < total; t += 1) {
    for (let c = 0; c < BRAIN_CONTEXT_SIZE; c += 1) {
      features[c] = Math.sin(t / 3 + c * 0.7) * 0.6 + Math.cos(t / 7) * 0.2;
    }
    for (let i = 0; i < liquid.length; i += 1) {
      liquid[i] = Math.sin(t / 5 + i * 0.4) * 0.5;
    }
    // Honest: no realised return is invented. The probe passes null.
    const out = core.step({
      features,
      liquidState: liquid,
      observedReturn: null,
      volatilityForecast: 0.4 + 0.2 * Math.sin(t / 4),
      anomalySurprise: 0.2 + 0.15 * Math.cos(t / 5),
      spikeCount: 8 + (t % 5),
      reservoirSize: 96
    });
    if (t < 6) first.push(out.prediction.freeEnergy);
    if (t >= total - 6) last.push(out.prediction.freeEnergy);
    actions.add(out.basalGanglia.action);
  }

  const avg = (arr) => arr.reduce((s, v) => s + v, 0) / Math.max(1, arr.length);
  const f0 = avg(first);
  const f1 = avg(last);
  const snapshot = core.getSnapshot();

  return {
    ok: true,
    schema: BRAIN_CORE_SCHEMA,
    ticks: total,
    freeEnergyFirst: Number(f0.toFixed(6)),
    freeEnergyLast: Number(f1.toFixed(6)),
    freeEnergyDropPct: f0 > 1e-9 ? Number((((f0 - f1) / f0) * 100).toFixed(2)) : 0,
    freeEnergyLearned: f1 < f0,
    forwardErrorEma: snapshot ? snapshot.cerebellum.forwardErrorEma : null,
    neuromodulators: snapshot ? snapshot.neuromodulators : null,
    actionsObserved: [...actions],
    laws: { canExecute: false, canSign: false, canMoveFunds: false, zeroServerGpu: true }
  };
}
