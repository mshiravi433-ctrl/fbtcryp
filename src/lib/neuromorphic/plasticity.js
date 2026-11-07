/**
 * FBT NEUROMORPHIC 2050 — PHASE 2: STRUCTURAL SELF-DEVELOPMENT & NEUROGENESIS
 * ===========================================================================
 * Enables the cortex to physically re-architect its own neural topology on the
 * user's device as market regimes evolve:
 *
 *   1. Synaptic Apoptosis (Pruning): eliminates dead, low-utility synapses to
 *      keep biological sparsity high (70%–86%) and local execution sub-ms.
 *   2. Hebbian Synaptogenesis (Sprouting): forms fresh synapses between
 *      co-active neurons when high free-energy surprise signals a new pattern.
 *   3. Autonomous Neurogenesis: dynamically grows new LIF neurons (in blocks of
 *      8, up to hardware budget <= 192) while preserving 100% of learned weights.
 *   4. Intent Genome Coupling: tunes liquid time-constants & risk damping from
 *      the user's preference genome without ever granting execution permission.
 */

import {
  CANONICAL_SEED,
  LIQUID_SIZE,
  MAX_RESERVOIR_SIZE,
  createPrng,
  measureSynapseTopology
} from './cortexCore.js';
import { SENSORY_CHANNELS } from './spikeEncoder.js';
import { containsSensitiveKeyOrPhrase } from '../intent-ai/orchestrator/redact.js';

export const PLASTICITY_SCHEMA = 'fbt.neuromorphic.plasticity.v1';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Grow `deltaNeurons` brand-new LIF neurons into an existing reservoir state,
 * preserving every existing neuron's membrane state, thresholds, and synapses.
 */
export function growReservoirNeurons(res, deltaNeurons = 8, seed = CANONICAL_SEED) {
  const oldN = res.size;
  const add = clamp(Math.round(deltaNeurons), 0, MAX_RESERVOIR_SIZE - oldN);
  if (add <= 0) return { grown: 0, reservoir: res };

  const newN = oldN + add;
  const rand = createPrng((seed ^ (newN * 0x45d9f3b)) >>> 0);

  const neuronSigns = new Float32Array(newN);
  const alphaDecay = new Float32Array(newN);
  const baseThreshold = new Float32Array(newN);
  const thresholdAdapt = new Float32Array(newN);
  const membraneV = new Float32Array(newN);
  const spikes = new Float32Array(newN);
  const preTrace = new Float32Array(newN);
  const firingRateEma = new Float32Array(newN);

  neuronSigns.set(res.neuronSigns);
  alphaDecay.set(res.alphaDecay);
  baseThreshold.set(res.baseThreshold);
  thresholdAdapt.set(res.thresholdAdapt);
  membraneV.set(res.membraneV);
  spikes.set(res.spikes);
  preTrace.set(res.preTrace);
  firingRateEma.set(res.firingRateEma);

  for (let i = oldN; i < newN; i += 1) {
    const isInh = i % 5 === 4;
    neuronSigns[i] = isInh ? -1 : 1;
    alphaDecay[i] = 0.74 + ((i - oldN) / Math.max(1, add)) * 0.21;
    baseThreshold[i] = isInh ? 0.48 : 0.55;
    firingRateEma[i] = 0.10;
  }

  // Copy & expand wIn [newN x 16]
  const wIn = new Float32Array(newN * SENSORY_CHANNELS);
  wIn.set(res.wIn);
  for (let j = oldN; j < newN; j += 1) {
    for (let c = 0; c < SENSORY_CHANNELS; c += 1) {
      if (rand() < 0.45) {
        wIn[j * SENSORY_CHANNELS + c] = (0.20 + rand() * 0.50) * (rand() < 0.72 ? 1 : -0.5);
      }
    }
  }

  // Copy & expand wRec, eligibility, utility [newN x newN]
  const wRec = new Float32Array(newN * newN);
  const eligibility = new Float32Array(newN * newN);
  const utility = new Float32Array(newN * newN);

  for (let j = 0; j < oldN; j += 1) {
    for (let k = 0; k < oldN; k += 1) {
      const oldIdx = j * oldN + k;
      const newIdx = j * newN + k;
      wRec[newIdx] = res.wRec[oldIdx];
      eligibility[newIdx] = res.eligibility[oldIdx];
      utility[newIdx] = res.utility[oldIdx];
    }
  }

  // Wire nascent neurons sparsely into & from the existing cortex
  for (let j = 0; j < newN; j += 1) {
    for (let k = 0; k < newN; k += 1) {
      if (j === k || (j < oldN && k < oldN)) continue;
      if (rand() < 0.22) {
        const mag = 0.05 + rand() * 0.14;
        wRec[j * newN + k] = neuronSigns[k] * mag;
        utility[j * newN + k] = mag * 0.6;
      }
    }
  }

  // Copy & expand Reservoir-to-Liquid projection [24 x newN]
  const wProj = new Float32Array(LIQUID_SIZE * newN);
  for (let m = 0; m < LIQUID_SIZE; m += 1) {
    for (let j = 0; j < oldN; j += 1) {
      wProj[m * newN + j] = res.wProj[m * oldN + j];
    }
    for (let j = oldN; j < newN; j += 1) {
      if ((j + m) % 3 === 0) {
        wProj[m * newN + j] = neuronSigns[j] * (0.07 + rand() * 0.13);
      }
    }
  }

  return {
    grown: add,
    reservoir: {
      size: newN,
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
    }
  };
}

/**
 * Execute one structural self-development cycle on `cortex`:
 *   1) Prune weak, low-utility recurrent synapses (above min density floor)
 *   2) Sprout Hebbian synapses between co-active neurons under surprise
 *   3) Trigger Neurogenesis (+8 LIF neurons) when novelty saturates capacity
 */
export function runStructuralPlasticity(cortex, {
  anomalySurprise = 0,
  maxReservoirNeurons = MAX_RESERVOIR_SIZE,
  pruneMagnitude = 0.018,
  pruneUtilityMax = 0.012,
  minDensity = 0.14,
  maxDensity = 0.34,
  growthBlock = 8,
  seed = CANONICAL_SEED
} = {}) {
  const internals = cortex._internals();
  let res = internals.getReservoir();
  const N = res.size;
  const maxSynapses = N * (N - 1);
  let activeCount = 0;
  for (let i = 0; i < res.wRec.length; i += 1) {
    if (Math.abs(res.wRec[i]) > 1e-6) activeCount += 1;
  }

  const minKeep = Math.floor(maxSynapses * minDensity);
  const maxKeep = Math.floor(maxSynapses * maxDensity);
  let pruned = 0;
  let sprouted = 0;

  // 1. Synaptic Apoptosis (Pruning)
  for (let j = 0; j < N && activeCount > minKeep; j += 1) {
    const row = j * N;
    for (let k = 0; k < N && activeCount > minKeep; k += 1) {
      if (j === k) continue;
      const idx = row + k;
      const mag = Math.abs(res.wRec[idx]);
      if (mag > 0 && mag < pruneMagnitude && res.utility[idx] < pruneUtilityMax) {
        res.wRec[idx] = 0;
        res.eligibility[idx] = 0;
        res.utility[idx] = 0;
        pruned += 1;
        activeCount -= 1;
      }
    }
  }

  // 2. Activity-Dependent Hebbian Synaptogenesis
  const surprise = clamp(Number(anomalySurprise) || 0, 0, 1);
  if (surprise >= 0.32 && activeCount < maxKeep) {
    const rand = createPrng((seed ^ Math.round(surprise * 100000) ^ (N * 7919)) >>> 0);
    const sproutBudget = Math.min(maxKeep - activeCount, Math.ceil(6 + surprise * 22));
    for (let j = 0; j < N && sprouted < sproutBudget; j += 1) {
      if (res.firingRateEma[j] < 0.06) continue;
      const row = j * N;
      for (let k = 0; k < N && sprouted < sproutBudget; k += 1) {
        if (j === k || res.wRec[row + k] !== 0) continue;
        if (res.firingRateEma[k] >= 0.08 && rand() < 0.25) {
          const initMag = 0.045 + surprise * 0.065;
          res.wRec[row + k] = res.neuronSigns[k] * initMag;
          res.utility[row + k] = initMag * 0.5;
          sprouted += 1;
          activeCount += 1;
        }
      }
    }
  }

  // 3. Autonomous Neurogenesis when surprise is high and hardware budget allows
  const cap = clamp(Math.round(maxReservoirNeurons) || MAX_RESERVOIR_SIZE, 32, MAX_RESERVOIR_SIZE);
  let grown = 0;
  if (surprise >= 0.56 && res.size + growthBlock <= cap) {
    const out = growReservoirNeurons(res, growthBlock, seed ^ internals.getStats().localTicks);
    res = out.reservoir;
    grown = out.grown;
  }

  internals.replaceReservoir(res, { grown, pruned, sprouted });
  const topology = measureSynapseTopology(res);

  return {
    ok: true,
    schema: PLASTICITY_SCHEMA,
    grownNeurons: grown,
    prunedSynapses: pruned,
    sproutedSynapses: sprouted,
    reservoirNeurons: res.size,
    activeSynapses: topology.activeSynapses,
    sparsity: Number(topology.sparsity.toFixed(4)),
    canExecute: false
  };
}

/**
 * Couple the user's Intent Genome (preference vector 0..100) to neuromorphic
 * time-constants and risk damping. Rejects any secret-tainted input.
 */
export function coupleIntentGenome(cortex, genomeInput = {}) {
  if (containsSensitiveKeyOrPhrase(genomeInput)) {
    return { ok: false, code: 'SECRET_INPUT_REJECTED', canExecute: false };
  }
  const vals = genomeInput?.values && typeof genomeInput.values === 'object'
    ? genomeInput.values
    : (genomeInput || {});

  const horizon = clamp(Number(vals.timeHorizon ?? 50), 0, 100);
  const riskTol = clamp(Number(vals.riskTolerance ?? 50), 0, 100);
  const drawdownTol = clamp(Number(vals.drawdownTolerance ?? 50), 0, 100);
  const autoPref = clamp(Number(vals.automationPreference ?? 50), 0, 100);

  // Longer horizon → slower liquid time constants τ0; lower risk tolerance → stronger volatility damping
  const tauScale = Number((0.72 + (horizon / 100) * 0.72).toFixed(3));
  const riskAversion = Number(clamp(1 - (riskTol * 0.6 + drawdownTol * 0.4) / 100, 0.1, 0.9).toFixed(3));
  const plasticityBoost = Number((0.75 + (autoPref / 100) * 0.55).toFixed(3));

  cortex.setGenomeModulation({ tauScale, riskAversion, plasticityBoost });

  return {
    ok: true,
    modulation: { tauScale, riskAversion, plasticityBoost },
    canExecute: false,
    canSign: false
  };
}
