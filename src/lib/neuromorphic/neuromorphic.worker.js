/**
 * FBT NEUROMORPHIC 2050 — MODULE WEB WORKER
 * ===========================================================================
 * Runs the entire Spiking + Liquid Cortex, WebGPU WGSL Compute Shader kernel,
 * R-STDP plasticity, Phase 2 Neurogenesis/Pruning, IndexedDB Engram storage,
 * and Phase 3 Walk-Forward Swarm Evolution off the UI main thread.
 *
 * Message Protocol:
 *   → { id, type: 'init', swarmOptIn?, paused?, intentGenome? }
 *   → { id, type: 'tick', candles?, markets?, pulse?, symbol? }
 *   → { id, type: 'evolve', candles, symbol? }
 *   → { id, type: 'syncGenome', weights, generation, fresh? }
 *   → { id, type: 'configure', paused?, swarmOptIn?, intentGenome? }
 *   → { id, type: 'reset' }
 *   → { id, type: 'dispose' }
 */

import {
  SWARM_PARAM_COUNT,
  createNeuromorphicCortex
} from './cortexCore.js';
import { featuresFromCandles, featuresFromMarketPulse } from './spikeEncoder.js';
import { createWebGpuLifKernel } from './webgpuKernel.js';
import { createHardwareGovernor } from './hardwareGovernor.js';
import { coupleIntentGenome, runStructuralPlasticity } from './plasticity.js';
import {
  createEngramMemory,
  loadLocalCortexBundle,
  saveLocalCortexBundle,
  wipeLocalCortexBundle
} from './engramMemory.js';
import { blendGlobalSwarmWeights, runLocalSwarmEvolution } from './swarmClient.js';

let cortex = null;
let gpuKernel = null;
let governor = null;
let engrams = null;
let initialized = false;
let ticksSinceSave = 0;

function reply(id, payload) {
  self.postMessage({ id, ...payload });
}

function fail(id, err) {
  self.postMessage({
    id,
    ok: false,
    error: String(err?.message || err || 'WORKER_ERROR').slice(0, 180)
  });
}

async function ensureReady(msg = {}) {
  if (initialized && cortex) {
    governor.configure({ environment: msg.environment, computeMode: msg.computeMode });
    return;
  }
  cortex = createNeuromorphicCortex();
  engrams = createEngramMemory();
  governor = createHardwareGovernor({
    paused: Boolean(msg.paused),
    swarmOptIn: msg.swarmOptIn !== false,
    computeMode: msg.computeMode
  });
  governor.configure({ environment: msg.environment, computeMode: msg.computeMode });

  gpuKernel = await createWebGpuLifKernel();
  governor.configure({
    webgpuAvailable: gpuKernel.available,
    adapterLabel: gpuKernel.adapterLabel
  });

  const saved = await loadLocalCortexBundle();
  let restoredFromDisk = false;
  if (saved.ok && saved.bundle?.cortex) {
    restoredFromDisk = cortex.importSnapshot(saved.bundle.cortex);
    if (Array.isArray(saved.bundle.episodes)) {
      engrams = createEngramMemory(saved.bundle.episodes);
    }
  }

  if (msg.intentGenome) {
    coupleIntentGenome(cortex, msg.intentGenome);
  }

  initialized = true;
  return { restoredFromDisk, storageBackend: saved.ok ? saved.backend : 'none' };
}

async function handleInit(id, msg) {
  const boot = await ensureReady(msg);
  const gov = await governor.evaluate();
  const snap = cortex.exportSnapshot();
  reply(id, {
    ok: true,
    type: 'ready',
    backend: gpuKernel?.available ? 'webgpu' : 'cpu-float32',
    adapterLabel: gpuKernel?.adapterLabel || null,
    webgpuReason: gpuKernel?.reason || null,
    restoredFromDisk: Boolean(boot?.restoredFromDisk),
    governor: gov,
    generation: snap.generation,
    reservoirNeurons: snap.reservoirSize,
    engramCount: engrams.size(),
    stats: snap.stats
  });
}

async function handleTick(id, msg) {
  await ensureReady(msg);
  const gov = await governor.evaluate();
  if (!gov.allowInference) {
    reply(id, { ok: true, skipped: true, reason: gov.reason, governor: gov });
    return;
  }

  let feat = null;
  if (Array.isArray(msg.candles) && msg.candles.length >= 3) {
    feat = featuresFromCandles(msg.candles, { breadthRatio: msg.breadthRatio ?? null });
  } else if (Array.isArray(msg.markets) || msg.pulse) {
    feat = featuresFromMarketPulse({ markets: msg.markets || [], pulse: msg.pulse || null });
  }

  if (!feat || !feat.ok) {
    reply(id, {
      ok: false,
      reason: feat?.reason || 'NO_OBSERVATION_INPUT',
      governor: gov
    });
    return;
  }

  const readout = await cortex.step(feat.vector, {
    observedPrice: feat.meta?.lastClose ?? null,
    learningEnabled: gov.allowPlasticity,
    sparseMode: gov.mode === 'ECO_SPARSE',
    gpuLifRunner: gpuKernel?.available ? gpuKernel.runLifStep : null
  });

  governor.recordTickDuration(readout.latencyMs);

  // Imprint episodic liquid memory whenever a real prediction resolves
  if (readout.learning?.rewardOutcome) {
    const liq = cortex._internals().getLiquidState();
    engrams.imprint({
      liquidState: liq,
      realizedReturn: readout.learning.rewardOutcome.realizedReturn,
      regime: readout.dominantRegime,
      symbol: msg.symbol || feat.meta?.anchorSymbol || null
    });
  }

  // Periodic Phase 2 Structural Self-Development (every 6 ticks when allowed)
  let structural = null;
  if (gov.allowNeurogenesis && readout.localTicks % 6 === 0) {
    structural = runStructuralPlasticity(cortex, {
      anomalySurprise: readout.anomalySurprise,
      maxReservoirNeurons: gov.maxReservoirNeurons
    });
    readout.topology.reservoirNeurons = structural.reservoirNeurons;
    readout.topology.activeSynapses = structural.activeSynapses;
    readout.topology.sparsity = structural.sparsity;
  }

  const recall = engrams.recall(cortex._internals().getLiquidState(), { topK: 3 });

  ticksSinceSave += 1;
  if (ticksSinceSave >= 5) {
    ticksSinceSave = 0;
    await saveLocalCortexBundle({
      cortexSnapshot: cortex.exportSnapshot(),
      episodes: engrams.exportEpisodes()
    });
  }

  reply(id, {
    ok: true,
    type: 'tickResult',
    readout,
    structural,
    engramRecall: recall,
    governor: gov,
    observationMeta: feat.meta
  });
}

async function handleEvolve(id, msg) {
  await ensureReady(msg);
  const gov = await governor.evaluate();
  const candles = Array.isArray(msg.candles) ? msg.candles.slice(-256) : [];
  if (!gov.allowInference || !gov.allowPlasticity || !gov.swarmCloneBudget) {
    reply(id, { ok: false, reason: gov.reason, governor: gov });
    return;
  }
  if (candles.length < 16) {
    reply(id, { ok: false, reason: 'INSUFFICIENT_CANDLES_FOR_EVOLUTION', governor: gov });
    return;
  }

  // 1. Feed walk-forward stream through primary cortex so R-STDP, Engrams & Neurogenesis fire!
  const start = Math.max(4, candles.length - 36);
  let lastReadout = null;
  let structuralSummary = { grownNeurons: 0, prunedSynapses: 0, sproutedSynapses: 0 };

  for (let end = start; end <= candles.length; end += 1) {
    const feat = featuresFromCandles(candles.slice(0, end));
    if (!feat.ok) continue;
    // eslint-disable-next-line no-await-in-loop
    lastReadout = await cortex.step(feat.vector, {
      observedPrice: feat.meta.lastClose,
      learningEnabled: gov.allowPlasticity,
      sparseMode: gov.mode === 'ECO_SPARSE',
      gpuLifRunner: gpuKernel?.available ? gpuKernel.runLifStep : null
    });
    if (lastReadout.learning?.rewardOutcome) {
      engrams.imprint({
        liquidState: cortex._internals().getLiquidState(),
        realizedReturn: lastReadout.learning.rewardOutcome.realizedReturn,
        regime: lastReadout.dominantRegime,
        symbol: msg.symbol || 'BTC'
      });
    }
  }

  if (!lastReadout) {
    reply(id, { ok: false, reason: 'INSUFFICIENT_OBSERVATIONS', governor: gov });
    return;
  }
  if (gov.allowNeurogenesis) {
    const st = runStructuralPlasticity(cortex, {
      anomalySurprise: lastReadout.anomalySurprise,
      maxReservoirNeurons: gov.maxReservoirNeurons || 192
    });
    structuralSummary = st;
    lastReadout.topology.reservoirNeurons = st.reservoirNeurons;
    lastReadout.topology.activeSynapses = st.activeSynapses;
    lastReadout.topology.sparsity = st.sparsity;
  }

  // 2. Run Phase 3 Shadow-Clone Neuroevolution for Swarm Delta
  const snapBefore = cortex.exportSnapshot();
  const evo = runLocalSwarmEvolution({
    candles,
    baseWeights: cortex.getSwarmWeights(),
    baseGeneration: snapBefore.generation,
    cloneCount: gov.swarmCloneBudget,
    computeBackend: 'cpu-float32'
  });

  if (!evo.ok) {
    reply(id, { ok: false, reason: evo.reason, governor: gov });
    return;
  }
  // Never promote a candidate selected on the same sample without independent validation.

  await saveLocalCortexBundle({
    cortexSnapshot: cortex.exportSnapshot(),
    episodes: engrams.exportEpisodes()
  });

  const recall = engrams.recall(cortex._internals().getLiquidState(), { topK: 3 });

  reply(id, {
    ok: true,
    type: 'evolveResult',
    readout: lastReadout,
    structural: structuralSummary,
    evolution: {
      improved: Boolean(evo.improved),
      baselineFitness: evo.baselineFitness ?? null,
      winnerFitness: evo.winnerFitness ?? null,
      resolvedSteps: evo.resolvedSteps ?? 0,
      winnerHitRate: evo.winnerHitRate ?? null,
      winnerBrier: evo.winnerBrier ?? null,
      candidateApplied: false,
      validation: 'selection-sample-only'
    },
    engramRecall: recall,
    governor: gov
  });
}

async function handleSyncGenome(id, msg) {
  await ensureReady(msg);
  const arr = Array.isArray(msg.weights) ? Float32Array.from(msg.weights) : null;
  const gen = Math.max(0, Math.floor(Number(msg.generation) || 0));
  if (!arr || arr.length !== SWARM_PARAM_COUNT) {
    reply(id, { ok: false, reason: 'INVALID_GENOME_WEIGHTS' });
    return;
  }
  const snap = cortex.exportSnapshot();
  const blended = snap.stats.localTicks > 4 && !msg.fresh
    ? blendGlobalSwarmWeights(cortex.getSwarmWeights(), arr, { globalShare: 0.68 })
    : arr;
  cortex.setSwarmWeights(blended, gen);
  await saveLocalCortexBundle({
    cortexSnapshot: cortex.exportSnapshot(),
    episodes: engrams.exportEpisodes()
  });
  reply(id, { ok: true, generation: gen });
}

async function handleConfigure(id, msg) {
  await ensureReady(msg);
  governor.configure({
    paused: typeof msg.paused === 'boolean' ? msg.paused : undefined,
    swarmOptIn: typeof msg.swarmOptIn === 'boolean' ? msg.swarmOptIn : undefined,
    computeMode: msg.computeMode, environment: msg.environment
  });
  let genomeResult = null;
  if (msg.intentGenome) {
    genomeResult = coupleIntentGenome(cortex, msg.intentGenome);
  }
  const gov = await governor.evaluate();
  reply(id, { ok: true, governor: gov, genomeResult });
}

async function handleReset(id) {
  await ensureReady({});
  cortex.reset();
  engrams.clear();
  await wipeLocalCortexBundle();
  const gov = await governor.evaluate();
  reply(id, {
    ok: true,
    generation: 0,
    reservoirNeurons: cortex.exportSnapshot().reservoirSize,
    engramCount: 0,
    governor: gov
  });
}

// Serialize messages so initialization, reset and evolution cannot mutate the
// same cortex concurrently while awaiting GPU or IndexedDB operations.
let messageQueue = Promise.resolve();
self.onmessage = (event) => {
  const msg = event.data || {};
  const { id, type } = msg;
  messageQueue = messageQueue.then(async () => {
    if (type === 'init') await handleInit(id, msg);
    else if (type === 'tick') await handleTick(id, msg);
    else if (type === 'evolve') await handleEvolve(id, msg);
    else if (type === 'syncGenome') await handleSyncGenome(id, msg);
    else if (type === 'configure') await handleConfigure(id, msg);
    else if (type === 'reset') await handleReset(id);
    else if (type === 'dispose') { gpuKernel?.dispose?.(); reply(id, { ok: true }); }
    else reply(id, { ok: false, reason: 'UNKNOWN_MESSAGE' });
  }).catch((e) => fail(id, e));
};
