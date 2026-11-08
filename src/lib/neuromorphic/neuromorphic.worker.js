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
 *   → { id, type: 'consolidate', iterations? }   (Phase 6 sharp-wave replay)
 *   → { id, type: 'science', action, packet? }   (Phase 7 universal scientific memory)
 *   → { id, type: 'adaptive', enabled?, learningOptIn? }  (Phase 9 data/device adaptation)
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
import { createScientificMemory } from './scientificMemory.js';
import {
  ADAPTIVE_SCHEMA,
  createAdaptiveEcosystem,
  replayServoCounterfactual
} from './adaptiveEcosystem.js';

let cortex = null;
let gpuKernel = null;
let governor = null;
let engrams = null;
let science = null;
/** PHASE 9 — data-conditioning + device-budget ecosystem (rate servo lives here). */
let ecosystem = null;
let adaptiveEnabled = true;
let learningOptIn = true;
let initialized = false;
let ticksSinceSave = 0;

/** One place that writes the whole sovereign bundle (cortex + engrams + science). */
async function persistBundle() {
  const res = await saveLocalCortexBundle({
    cortexSnapshot: cortex.exportSnapshot(),
    episodes: engrams.exportEpisodes(),
    science: science ? science.toJSON() : null
  });
  return res;
}

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
  if (initialized && cortex) return;
  cortex = createNeuromorphicCortex();
  engrams = createEngramMemory();
  science = createScientificMemory();
  ecosystem = createAdaptiveEcosystem({ learningOptIn });
  governor = createHardwareGovernor({
    paused: Boolean(msg.paused),
    swarmOptIn: msg.swarmOptIn !== false
  });

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
    // Phase 7: restore the scientific memory when the bundle carries it. An old
    // bundle without the block keeps its fresh, pre-specified family — nothing is
    // guessed and no belief is invented.
    if (saved.bundle.science && science) {
      science.loadJSON(saved.bundle.science);
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
    brainEnabled: cortex.isBrainEnabled(),
    adaptiveEnabled,
    adaptive: adaptiveEnabled ? ecosystem.report() : null,
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

  /*
   * PHASE 9 — the ecosystem plans BEFORE the step (homeostatic efficacy from the
   * previous measured rate, learning duty cycle, reservoir growth cap) and
   * observes AFTER it. The gate is the *intersection* of the device budget and
   * the data profile: a TURBO device on flat data no longer spends 512 neurons.
   */
  ecosystem.setGovernorPolicy(gov);
  const plan = adaptiveEnabled ? ecosystem.plan() : null;
  if (adaptiveEnabled) cortex.setSynapticEfficacy(plan.synapticEfficacy);

  const readout = await cortex.step(feat.vector, {
    observedPrice: feat.meta?.lastClose ?? null,
    learningEnabled: adaptiveEnabled ? (gov.allowPlasticity && plan.learnThisTick) : gov.allowPlasticity,
    sparseMode: gov.mode === 'ECO_SPARSE',
    gpuLifRunner: gpuKernel?.available ? gpuKernel.runLifStep : null
  });

  governor.recordTickDuration(readout.latencyMs);

  const adaptive = adaptiveEnabled
    ? ecosystem.observe({
        features: feat.vector,
        readout,
        /* The counterfactual the cortex already measured on this very tick. */
        staticSpikeBaseline: readout.rateCode?.spikesWithoutServo ?? null
      })
    : null;

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
  /*
   * PHASE 9 — the growth cap is the ecosystem's, i.e. the smaller of what the
   * device can afford and what the data justifies. Growth is also refused while
   * the profile is HOLD_SPARSE: growing a network on a stream the cortex cannot
   * predict adds parameters, not information.
   */
  const growthCap = plan?.reservoirCap ?? gov.maxReservoirNeurons;
  const growthJustified = adaptive?.profile !== 'HOLD_SPARSE';
  if (gov.allowNeurogenesis && growthJustified && readout.localTicks % 6 === 0) {
    structural = runStructuralPlasticity(cortex, {
      anomalySurprise: readout.anomalySurprise,
      maxReservoirNeurons: growthCap
    });
    readout.topology.reservoirNeurons = structural.reservoirNeurons;
    readout.topology.activeSynapses = structural.activeSynapses;
    readout.topology.sparsity = structural.sparsity;
  }

  const recall = engrams.recall(cortex._internals().getLiquidState(), { topK: 3 });

  // Phase 7 — every resolved episode is scored against the PRE-SPECIFIED family.
  // Provenance dedupe means re-ingesting the same engrams cannot inflate evidence.
  const scienceIngest = science.ingestEngrams(engrams.exportEpisodes());
  const scienceReport = science.report();
  const sciencePrior = science.priorForCortex({
    regime: readout.dominantRegime,
    symbol: msg.symbol || feat.meta?.anchorSymbol || null
  });

  ticksSinceSave += 1;
  if (ticksSinceSave >= 5) {
    ticksSinceSave = 0;
    await persistBundle();
  }

  reply(id, {
    ok: true,
    type: 'tickResult',
    readout,
    structural,
    engramRecall: recall,
    science: scienceReport,
    scienceIngest,
    sciencePrior,
    adaptive,
    governor: gov,
    observationMeta: feat.meta
  });
}

async function handleEvolve(id, msg) {
  await ensureReady(msg);
  const gov = await governor.evaluate();
  const candles = Array.isArray(msg.candles) ? msg.candles : [];
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
      learningEnabled: true,
      sparseMode: false,
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

  if (lastReadout) {
    const st = runStructuralPlasticity(cortex, {
      anomalySurprise: Math.max(0.58, lastReadout.anomalySurprise),
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
    cloneCount: Math.max(2, gov.swarmCloneBudget || 4),
    computeBackend: gpuKernel?.available ? 'webgpu' : 'cpu-float32'
  });

  if (evo.ok && evo.improved && evo.nextWeights) {
    cortex.setSwarmWeights(evo.nextWeights, snapBefore.generation);
  }

  const scienceIngest = science.ingestEngrams(engrams.exportEpisodes());
  await persistBundle();

  const recall = engrams.recall(cortex._internals().getLiquidState(), { topK: 3 });

  reply(id, {
    ok: true,
    type: 'evolveResult',
    science: science.report(),
    scienceIngest,
    readout: lastReadout,
    structural: structuralSummary,
    evolution: {
      improved: Boolean(evo.improved),
      baselineFitness: evo.baselineFitness ?? null,
      winnerFitness: evo.winnerFitness ?? null,
      resolvedSteps: evo.resolvedSteps ?? 0,
      winnerHitRate: evo.winnerHitRate ?? null,
      winnerBrier: evo.winnerBrier ?? null,
      deltaPacket: evo.deltaPacket || null
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
  await persistBundle();
  reply(id, { ok: true, generation: gen });
}

async function handleConfigure(id, msg) {
  await ensureReady(msg);
  governor.configure({
    paused: typeof msg.paused === 'boolean' ? msg.paused : undefined,
    swarmOptIn: typeof msg.swarmOptIn === 'boolean' ? msg.swarmOptIn : undefined
  });
  if (typeof msg.brainEnabled === 'boolean') {
    cortex.setBrainEnabled(msg.brainEnabled);
  }
  let genomeResult = null;
  if (msg.intentGenome) {
    genomeResult = coupleIntentGenome(cortex, msg.intentGenome);
  }
  const gov = await governor.evaluate();
  reply(id, {
    ok: true,
    governor: gov,
    genomeResult,
    brainEnabled: cortex.isBrainEnabled()
  });
}

/**
 * PHASE 6 — sharp-wave-ripple consolidation.
 * Replays this device's real episodic engrams through the brain-inspired core and
 * returns the *measured* free energy / basal-ganglia agreement / forward error
 * before and after. No episode is invented: an empty bank reports NO_EPISODES.
 */
async function handleConsolidate(id, msg) {
  await ensureReady(msg);
  const episodes = engrams.exportEpisodes();
  const iterations = Math.max(1, Math.min(30, Math.round(Number(msg.iterations) || 6)));
  const consolidation = cortex.consolidate({ episodes, iterations });
  const scienceIngest = science.ingestEngrams(engrams.exportEpisodes());
  if (consolidation.ok) {
    await persistBundle();
  }
  reply(id, {
    ok: Boolean(consolidation.ok),
    type: 'consolidateResult',
    consolidation,
    science: science.report(),
    scienceIngest,
    readout: cortex._internals().getLastReadout(),
    engramCount: engrams.size(),
    governor: await governor.evaluate()
  });
}

/**
 * PHASE 7 — universal scientific memory actions.
 *   report      → current beliefs (no new evidence)
 *   ingest      → score this device's real engrams against the pre-specified family
 *   exportPrior → portable packet (log BFs + counts, never raw data)
 *   mergePrior  → accept another device's packet, deduplicated by packet hash
 *   retire      → retire hypotheses whose declared expiry has passed
 */
async function handleScience(id, msg) {
  await ensureReady(msg);
  const action = String(msg.action || 'report');
  if (action === 'ingest') {
    const ingest = science.ingestEngrams(engrams.exportEpisodes());
    await persistBundle();
    reply(id, {
      ok: true,
      type: 'scienceResult',
      action,
      ingest,
      science: science.report(),
      engramCount: engrams.size()
    });
    return;
  }
  if (action === 'exportPrior') {
    reply(id, { ok: true, type: 'scienceResult', action, packet: science.exportPrior() });
    return;
  }
  if (action === 'mergePrior') {
    const merged = science.mergePrior(msg.packet || null);
    if (merged.ok) await persistBundle();
    reply(id, { ok: merged.ok, type: 'scienceResult', action, merged, science: science.report() });
    return;
  }
  if (action === 'retire') {
    const retired = science.retireExpired();
    reply(id, { ok: true, type: 'scienceResult', action, retired, science: science.report() });
    return;
  }
  reply(id, { ok: true, type: 'scienceResult', action: 'report', science: science.report() });
}

/**
 * PHASE 9 — adaptive ecosystem control.
 *   report      → the current measured condition, profile, servo and budget
 *   counterfactual → replay this device's measured spike counts through a fresh
 *                    servo and report where it would have moved efficacy
 *   enable/disable the ecosystem for an A/B comparison (cortex returns to the
 *   Phase-6 dynamics when it is off, because efficacy resets to 1)
 */
async function handleAdaptive(id, msg) {
  await ensureReady(msg);
  const action = String(msg.action || 'report');

  if (action === 'set') {
    if (typeof msg.enabled === 'boolean') {
      adaptiveEnabled = msg.enabled;
      cortex.setAdaptiveEnabled(adaptiveEnabled);
    }
    if (typeof msg.learningOptIn === 'boolean') {
      learningOptIn = msg.learningOptIn;
      ecosystem.setLearningOptIn(learningOptIn);
    }
    if (typeof msg.enabled === 'boolean' && !msg.enabled) ecosystem.reset();
    const gov = await governor.evaluate();
    ecosystem.setGovernorPolicy(gov);
    return reply(id, {
      ok: true,
      type: 'adaptiveResult',
      action: 'set',
      adaptiveEnabled,
      learningOptIn,
      adaptive: adaptiveEnabled ? ecosystem.report() : null,
      governor: gov
    });
  }

  if (action === 'counterfactual') {
    /*
     * Honest scope: this replays the rates this device ACTUALLY produced. It is
     * not a second simulation of a second cortex, and the reply says so.
     */
    const counts = Array.isArray(msg.spikeCounts) ? msg.spikeCounts.slice(0, 512) : [];
    const size = Math.max(1, Math.round(Number(msg.reservoirSize) || 96));
    const replay = replayServoCounterfactual(counts, size, msg.servo || {});
    return reply(id, {
      ok: true,
      type: 'adaptiveResult',
      action: 'counterfactual',
      schema: ADAPTIVE_SCHEMA,
      replay,
      note: 'replays measured rates; does not re-simulate the reservoir',
      laws: { canExecute: false, canSign: false, canMoveFunds: false }
    });
  }

  const gov = await governor.evaluate();
  ecosystem.setGovernorPolicy(gov);
  return reply(id, {
    ok: true,
    type: 'adaptiveResult',
    action: 'report',
    adaptiveEnabled,
    learningOptIn,
    adaptive: ecosystem.report(),
    governor: gov,
    constants: ecosystem.constants()
  });
}

async function handleReset(id) {
  await ensureReady({});
  cortex.reset();
  engrams.clear();
  science.wipe();
  if (ecosystem) ecosystem.reset();
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

self.onmessage = (event) => {
  const msg = event.data || {};
  const { id, type } = msg;
  if (type === 'init') handleInit(id, msg).catch((e) => fail(id, e));
  else if (type === 'tick') handleTick(id, msg).catch((e) => fail(id, e));
  else if (type === 'evolve') handleEvolve(id, msg).catch((e) => fail(id, e));
  else if (type === 'syncGenome') handleSyncGenome(id, msg).catch((e) => fail(id, e));
  else if (type === 'configure') handleConfigure(id, msg).catch((e) => fail(id, e));
  else if (type === 'consolidate') handleConsolidate(id, msg).catch((e) => fail(id, e));
  else if (type === 'science') handleScience(id, msg).catch((e) => fail(id, e));
  else if (type === 'adaptive') handleAdaptive(id, msg).catch((e) => fail(id, e));
  else if (type === 'reset') handleReset(id).catch((e) => fail(id, e));
  else if (type === 'dispose') {
    gpuKernel?.dispose?.();
    reply(id, { ok: true });
  }
};
