/**
 * FBT NEUROMORPHIC 2050 — PHASE 5: SHARED CLIENT RUNTIME & REACT HOOK (ADAPTIVE INTELLIGENCE)
 * ===========================================================================
 * Single shared bridge between any React surface (`/intent`, Chat Rooms,
 * `AiControlCenter`, `IntentOpsPanels`) and the off-main-thread WebGPU/CPU
 * Neuromorphic Worker (`neuromorphic.worker.js`), plus zero-GPU Swarm sync.
 *
 * Honesty Rules:
 *   · Initial readout, hitRate, meanBrier, latencyMs, and firingRateHz are
 *     `null` until real market data is processed (`—` in UI, never pre-filled).
 *   · In environments without `Worker` (jsdom/SSR tests), seamlessly executes
 *     the exact same pure-math cortex inline rather than faking results.
 *   · Adaptive Intelligence Ecosystem: Self-Evolution on device CPU/GPU.
 *   · PHASE 7: the Universal Scientific Memory is fed by this device's real
 *     resolved engrams and its report is exported here. Nothing is pre-computed
 *     in this module — the worker (or the inline mirror) owns the statistics.
 *   · PHASE 9: the Adaptive Intelligence Ecosystem runs in the same place as the
 *     cortex — worker thread in the browser, inline mirror in jsdom/SSR — so the
 *     console shows the same profile, servo and budget on both paths.
 */

import { useCallback, useEffect, useState } from 'react';
import { apiBase } from '../apiBase.js';
import { getOhlc } from '../api.js';
import { createNeuromorphicCortex } from './cortexCore.js';
import { featuresFromCandles, featuresFromMarketPulse } from './spikeEncoder.js';
import { createHardwareGovernor } from './hardwareGovernor.js';
import { coupleIntentGenome, runStructuralPlasticity } from './plasticity.js';
import {
  createEngramMemory,
  saveLocalCortexBundle,
  wipeLocalCortexBundle
} from './engramMemory.js';
import { blendGlobalSwarmWeights, runLocalSwarmEvolution } from './swarmClient.js';
import { createScientificMemory } from './scientificMemory.js';
import { createAdaptiveEcosystem } from './adaptiveEcosystem.js';

const PREFS_KEY = 'fbt.neuromorphic.prefs.v1';
const DEVICE_KEY = 'fbt.ai.device.v1';

function readPrefs() {
  try {
    if (typeof localStorage === 'undefined') return { swarmOptIn: true, paused: false };
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { swarmOptIn: true, paused: false };
    const parsed = JSON.parse(raw);
    return {
      swarmOptIn: parsed?.swarmOptIn !== false,
      paused: Boolean(parsed?.paused)
    };
  } catch {
    return { swarmOptIn: true, paused: false };
  }
}

function savePrefs(prefs) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    }
  } catch { /* ignore */ }
}

function deviceHeaderValue() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return '';
    let id = window.localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
      window.localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return '';
  }
}

async function swarmFetch(path, { method = 'GET', body = null, timeoutMs = 10000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const root = (typeof apiBase === 'function' ? apiBase() : '') || '/api';
    const headers = { accept: 'application/json' };
    if (body) headers['content-type'] = 'application/json';
    const dev = deviceHeaderValue();
    if (dev) headers['x-fbt-device'] = dev;
    const res = await fetch(`${root}${path}`, {
      method,
      signal: ctrl.signal,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    const json = text ? (() => { try { return JSON.parse(text); } catch { return {}; } })() : {};
    return { ok: res.ok && json.ok !== false, status: res.status, ...json };
  } catch (err) {
    return { ok: false, status: 0, error: String(err?.message || 'NETWORK_ERROR').slice(0, 120) };
  } finally {
    clearTimeout(timer);
  }
}

/* ── Shared Singleton Store ───────────────────────────────────────────────── */

const initialPrefs = readPrefs();

let storeState = {
  ready: false,
  backend: null,             // 'webgpu' | 'cpu-float32' | null
  adapterLabel: null,
  governor: null,
  localGeneration: 0,
  globalGeneration: null,
  reservoirNeurons: 96,
  engramCount: 0,
  readout: null,             // null until a real market/candle tick runs!
  engramRecall: null,
  science: null,             // Phase 7 report (hypotheses, FDR, meta-analysis)
  scienceIngest: null,
  sciencePrior: null,
  scienceWorld: null,        // world registry summary (consensus across devices)
  scienceAction: null,       // last explicit science action result
  scienceError: null,
  structuralLast: null,
  evolutionLast: null,
  consolidationLast: null,
  brainEnabled: true,
  /* PHASE 9 — adaptive ecosystem (data conditioning + device budget). */
  adaptiveEnabled: true,
  adaptive: null,
  adaptiveLearningOptIn: true,
  swarmStatus: null,
  swarmOptIn: initialPrefs.swarmOptIn,
  paused: initialPrefs.paused,
  evolving: false,
  lastSymbol: null,
  lastUpdatedAt: null,
  lastError: null
};

const listeners = new Set();
function emit(patch) {
  storeState = { ...storeState, ...patch };
  for (const fn of listeners) {
    try { fn(storeState); } catch { /* ignore */ }
  }
}

/* ── Worker + Inline Fallback Transport ───────────────────────────────────── */

let workerInstance = null;
let workerInitPromise = null;
let msgSeq = 0;
const pendingWorkerCalls = new Map();

// Inline fallback instances when Worker is unavailable (jsdom / SSR)
let inlineCortex = null;
let inlineEngrams = null;
let inlineGovernor = null;
let inlineScience = null;
let inlineEcosystem = null;

function ensureInlineRuntime() {
  if (!inlineCortex) {
    inlineCortex = createNeuromorphicCortex();
    inlineEngrams = createEngramMemory();
    inlineScience = createScientificMemory();
    inlineGovernor = createHardwareGovernor({
      paused: storeState.paused,
      swarmOptIn: storeState.swarmOptIn
    });
    inlineEcosystem = createAdaptiveEcosystem({ learningOptIn: storeState.adaptiveLearningOptIn });
  }
}

function sendWorkerMessage(payload, timeoutMs = 25000) {
  if (typeof Worker === 'undefined') {
    return runInlineFallback(payload);
  }
  if (!workerInstance) {
    /* Keep `new URL(...)` literally inside `new Worker(...)` for Vite bundler rewrite. */
    workerInstance = new Worker(
      new URL('./neuromorphic.worker.js', import.meta.url),
      { type: 'module', name: 'fbt-neuromorphic-2050' }
    );
    workerInstance.onmessage = (ev) => {
      const data = ev.data || {};
      const entry = pendingWorkerCalls.get(data.id);
      if (entry) {
        clearTimeout(entry.timer);
        pendingWorkerCalls.delete(data.id);
        entry.resolve(data);
      }
    };
    workerInstance.onerror = (err) => {
      for (const [, entry] of pendingWorkerCalls) {
        clearTimeout(entry.timer);
        entry.reject(err);
      }
      pendingWorkerCalls.clear();
    };
  }

  const id = `nm_${++msgSeq}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingWorkerCalls.delete(id);
      reject(new Error('WORKER_TIMEOUT'));
    }, timeoutMs);
    pendingWorkerCalls.set(id, { resolve, reject, timer });
    workerInstance.postMessage({ ...payload, id });
  });
}

async function runInlineFallback(msg) {
  ensureInlineRuntime();
  const type = msg.type;
  if (type === 'init') {
    if (msg.intentGenome) coupleIntentGenome(inlineCortex, msg.intentGenome);
    const gov = await inlineGovernor.evaluate();
    const snap = inlineCortex.exportSnapshot();
    return {
      ok: true,
      backend: 'cpu-float32',
      adapterLabel: null,
      governor: gov,
      generation: snap.generation,
      reservoirNeurons: snap.reservoirSize,
      engramCount: inlineEngrams.size(),
      brainEnabled: inlineCortex.isBrainEnabled(),
      adaptiveEnabled: storeState.adaptiveEnabled,
      adaptive: storeState.adaptiveEnabled ? inlineEcosystem.report() : null,
      science: inlineScience.report()
    };
  }
  if (type === 'tick') {
    const gov = await inlineGovernor.evaluate();
    if (!gov.allowInference) return { ok: true, skipped: true, governor: gov };
    const feat = Array.isArray(msg.candles) && msg.candles.length >= 3
      ? featuresFromCandles(msg.candles, { breadthRatio: msg.breadthRatio ?? null })
      : featuresFromMarketPulse({ markets: msg.markets || [], pulse: msg.pulse || null });
    if (!feat.ok) return { ok: false, reason: feat.reason, governor: gov };
    /* PHASE 9 — same plan → step → observe ordering as the worker. */
    const adaptiveOn = storeState.adaptiveEnabled !== false;
    inlineEcosystem.setGovernorPolicy(gov);
    const plan = adaptiveOn ? inlineEcosystem.plan() : null;
    if (adaptiveOn) inlineCortex.setSynapticEfficacy(plan.synapticEfficacy);
    const readout = await inlineCortex.step(feat.vector, {
      observedPrice: feat.meta?.lastClose ?? null,
      learningEnabled: adaptiveOn ? (gov.allowPlasticity && plan.learnThisTick) : gov.allowPlasticity,
      sparseMode: gov.mode === 'ECO_SPARSE'
    });
    const adaptive = adaptiveOn
      ? inlineEcosystem.observe({
          features: feat.vector,
          readout,
          staticSpikeBaseline: readout.rateCode?.spikesWithoutServo ?? null
        })
      : null;
    if (readout.learning?.rewardOutcome) {
      inlineEngrams.imprint({
        liquidState: inlineCortex._internals().getLiquidState(),
        realizedReturn: readout.learning.rewardOutcome.realizedReturn,
        regime: readout.dominantRegime,
        symbol: msg.symbol || feat.meta?.anchorSymbol || null
      });
    }
    let structural = null;
    const growthCap = plan?.reservoirCap ?? gov.maxReservoirNeurons;
    const growthJustified = adaptive?.profile !== 'HOLD_SPARSE';
    if (gov.allowNeurogenesis && growthJustified && readout.localTicks % 6 === 0) {
      structural = runStructuralPlasticity(inlineCortex, {
        anomalySurprise: readout.anomalySurprise,
        maxReservoirNeurons: growthCap
      });
    }
    const scienceIngest = inlineScience.ingestEngrams(inlineEngrams.exportEpisodes());
    return {
      ok: true,
      readout,
      structural,
      adaptive,
      engramRecall: inlineEngrams.recall(inlineCortex._internals().getLiquidState()),
      science: inlineScience.report(),
      scienceIngest,
      sciencePrior: inlineScience.priorForCortex({
        regime: readout.dominantRegime,
        symbol: msg.symbol || feat.meta?.anchorSymbol || null
      }),
      governor: gov
    };
  }
  if (type === 'evolve') {
    const gov = await inlineGovernor.evaluate();
    const candles = Array.isArray(msg.candles) ? msg.candles : [];
    if (candles.length < 16) return { ok: false, reason: 'INSUFFICIENT_CANDLES_FOR_EVOLUTION', governor: gov };
    let lastReadout = null;
    for (let end = Math.max(4, candles.length - 32); end <= candles.length; end += 1) {
      const feat = featuresFromCandles(candles.slice(0, end));
      if (!feat.ok) continue;
      // eslint-disable-next-line no-await-in-loop
      lastReadout = await inlineCortex.step(feat.vector, { observedPrice: feat.meta.lastClose, learningEnabled: true });
      if (lastReadout.learning?.rewardOutcome) {
        inlineEngrams.imprint({
          liquidState: inlineCortex._internals().getLiquidState(),
          realizedReturn: lastReadout.learning.rewardOutcome.realizedReturn,
          regime: lastReadout.dominantRegime,
          symbol: msg.symbol || 'BTC'
        });
      }
    }
    const structural = runStructuralPlasticity(inlineCortex, {
      anomalySurprise: Math.max(0.58, lastReadout?.anomalySurprise || 0.6),
      /* PHASE 9 — walk-forward evolution also respects the data-shaped budget. */
      maxReservoirNeurons: inlineEcosystem.report()?.actuators?.reservoirCap || gov.maxReservoirNeurons || 192
    });
    const snap = inlineCortex.exportSnapshot();
    const evo = runLocalSwarmEvolution({
      candles,
      baseWeights: inlineCortex.getSwarmWeights(),
      baseGeneration: snap.generation,
      cloneCount: Math.max(2, gov.swarmCloneBudget || 4)
    });
    if (evo.ok && evo.improved && evo.nextWeights) {
      inlineCortex.setSwarmWeights(evo.nextWeights, snap.generation);
    }
    return {
      ok: true,
      readout: lastReadout,
      structural,
      scienceIngest: inlineScience.ingestEngrams(inlineEngrams.exportEpisodes()),
      science: inlineScience.report(),
      evolution: {
        improved: Boolean(evo.improved),
        baselineFitness: evo.baselineFitness ?? null,
        winnerFitness: evo.winnerFitness ?? null,
        resolvedSteps: evo.resolvedSteps ?? 0,
        winnerHitRate: evo.winnerHitRate ?? null,
        winnerBrier: evo.winnerBrier ?? null,
        deltaPacket: evo.deltaPacket || null
      },
      engramRecall: inlineEngrams.recall(inlineCortex._internals().getLiquidState()),
      governor: gov
    };
  }
  if (type === 'syncGenome') {
    const arr = Float32Array.from(msg.weights || []);
    const blended = blendGlobalSwarmWeights(inlineCortex.getSwarmWeights(), arr, { globalShare: 0.68 });
    inlineCortex.setSwarmWeights(blended, msg.generation || 0);
    return { ok: true, generation: msg.generation || 0 };
  }
  if (type === 'adaptive') {
    const action = String(msg.action || 'report');
    if (action === 'set') {
      if (typeof msg.enabled === 'boolean') {
        emit({ adaptiveEnabled: msg.enabled });
        inlineCortex.setAdaptiveEnabled(msg.enabled);
        if (!msg.enabled) inlineEcosystem.reset();
      }
      if (typeof msg.learningOptIn === 'boolean') {
        emit({ adaptiveLearningOptIn: msg.learningOptIn });
        inlineEcosystem.setLearningOptIn(msg.learningOptIn);
      }
    }
    const gov = await inlineGovernor.evaluate();
    inlineEcosystem.setGovernorPolicy(gov);
    return {
      ok: true,
      action,
      adaptiveEnabled: storeState.adaptiveEnabled !== false,
      adaptive: inlineEcosystem.report(),
      governor: gov,
      constants: inlineEcosystem.constants()
    };
  }
  if (type === 'configure') {
    inlineGovernor.configure({ paused: msg.paused, swarmOptIn: msg.swarmOptIn });
    if (typeof msg.brainEnabled === 'boolean') inlineCortex.setBrainEnabled(msg.brainEnabled);
    if (msg.intentGenome) coupleIntentGenome(inlineCortex, msg.intentGenome);
    return {
      ok: true,
      governor: await inlineGovernor.evaluate(),
      brainEnabled: inlineCortex.isBrainEnabled()
    };
  }
  if (type === 'consolidate') {
    const iterations = Math.max(1, Math.min(30, Math.round(Number(msg.iterations) || 6)));
    const consolidation = inlineCortex.consolidate({
      episodes: inlineEngrams.exportEpisodes(),
      iterations
    });
    const scienceIngest = inlineScience.ingestEngrams(inlineEngrams.exportEpisodes());
    if (consolidation.ok) {
      await saveLocalCortexBundle({
        cortexSnapshot: inlineCortex.exportSnapshot(),
        episodes: inlineEngrams.exportEpisodes(),
        science: inlineScience.toJSON()
      });
    }
    return {
      ok: Boolean(consolidation.ok),
      consolidation,
      science: inlineScience.report(),
      scienceIngest,
      readout: inlineCortex._internals().getLastReadout(),
      engramCount: inlineEngrams.size(),
      governor: await inlineGovernor.evaluate()
    };
  }
  if (type === 'science') {
    const action = String(msg.action || 'report');
    if (action === 'ingest') {
      const ingest = inlineScience.ingestEngrams(inlineEngrams.exportEpisodes());
      return { ok: true, action, ingest, science: inlineScience.report(), engramCount: inlineEngrams.size() };
    }
    if (action === 'exportPrior') {
      return { ok: true, action, packet: inlineScience.exportPrior() };
    }
    if (action === 'mergePrior') {
      const merged = inlineScience.mergePrior(msg.packet || null);
      return { ok: merged.ok, action, merged, science: inlineScience.report() };
    }
    if (action === 'retire') {
      const retired = inlineScience.retireExpired();
      return { ok: true, action, retired, science: inlineScience.report() };
    }
    return { ok: true, action: 'report', science: inlineScience.report() };
  }
  if (type === 'reset') {
    inlineCortex.reset();
    inlineEngrams.clear();
    inlineScience.wipe();
    if (inlineEcosystem) inlineEcosystem.reset();
    await wipeLocalCortexBundle();
    return { ok: true, generation: 0, reservoirNeurons: 96, engramCount: 0, governor: await inlineGovernor.evaluate() };
  }
  return { ok: true };
}

/* ── Public Imperative Actions ────────────────────────────────────────────── */

export async function initNeuromorphicRuntime({ intentGenome = null } = {}) {
  if (!workerInitPromise) {
    workerInitPromise = sendWorkerMessage({
      type: 'init',
      swarmOptIn: storeState.swarmOptIn,
      paused: storeState.paused,
      intentGenome
    })
      .then((res) => {
        if (res.ok) {
          emit({
            ready: true,
            backend: res.backend || 'cpu-float32',
            adapterLabel: res.adapterLabel || null,
            governor: res.governor || null,
            localGeneration: res.generation ?? 0,
            reservoirNeurons: res.reservoirNeurons ?? 96,
            engramCount: res.engramCount ?? 0,
            brainEnabled: res.brainEnabled !== false,
            adaptiveEnabled: res.adaptiveEnabled !== false,
            adaptive: res.adaptive || storeState.adaptive,
            lastError: null
          });
        }
        return res;
      })
      .catch((err) => {
        workerInitPromise = null;
        emit({ lastError: String(err?.message || err).slice(0, 120) });
        return { ok: false, error: String(err?.message || err) };
      });
  }
  return workerInitPromise;
}

export async function syncWithGlobalSwarm() {
  await initNeuromorphicRuntime();
  const [statusRes, genomeRes] = await Promise.all([
    swarmFetch('/v1/ai/neuromorphic/status'),
    swarmFetch(`/v1/ai/neuromorphic/genome?sinceGeneration=${encodeURIComponent(storeState.localGeneration)}`)
  ]);

  if (statusRes.ok) {
    emit({
      swarmStatus: statusRes,
      globalGeneration: statusRes.globalGeneration ?? storeState.globalGeneration
    });
  }

  if (genomeRes.ok && genomeRes.upToDate === false && Array.isArray(genomeRes.weights)) {
    const syncOut = await sendWorkerMessage({
      type: 'syncGenome',
      weights: genomeRes.weights,
      generation: genomeRes.generation
    });
    if (syncOut.ok) {
      emit({
        localGeneration: genomeRes.generation,
        globalGeneration: genomeRes.generation
      });
    }
  }
  return { statusRes, genomeRes };
}

export async function tickNeuromorphicWithCandles(candles, { symbol = null, breadthRatio = null } = {}) {
  if (!Array.isArray(candles) || candles.length < 3) return { ok: false, reason: 'INSUFFICIENT_CANDLES' };
  await initNeuromorphicRuntime();
  const res = await sendWorkerMessage({ type: 'tick', candles, symbol, breadthRatio });
  if (res.ok && res.readout) {
    emit({
      readout: res.readout,
      engramRecall: res.engramRecall || storeState.engramRecall,
      structuralLast: res.structural || storeState.structuralLast,
      governor: res.governor || storeState.governor,
      reservoirNeurons: res.readout.topology?.reservoirNeurons ?? storeState.reservoirNeurons,
      engramCount: res.engramRecall?.totalEngrams ?? storeState.engramCount,
      science: res.science || storeState.science,
      scienceIngest: res.scienceIngest || storeState.scienceIngest,
      sciencePrior: res.sciencePrior || storeState.sciencePrior,
      adaptive: res.adaptive || storeState.adaptive,
      lastSymbol: symbol || storeState.lastSymbol,
      lastUpdatedAt: Date.now(),
      lastError: null
    });
  }
  return res;
}

export async function tickNeuromorphicWithMarketPulse({ markets = [], pulse = null } = {}) {
  await initNeuromorphicRuntime();
  const res = await sendWorkerMessage({ type: 'tick', markets, pulse, symbol: 'MARKET' });
  if (res.ok && res.readout) {
    emit({
      readout: res.readout,
      engramRecall: res.engramRecall || storeState.engramRecall,
      structuralLast: res.structural || storeState.structuralLast,
      governor: res.governor || storeState.governor,
      reservoirNeurons: res.readout.topology?.reservoirNeurons ?? storeState.reservoirNeurons,
      engramCount: res.engramRecall?.totalEngrams ?? storeState.engramCount,
      science: res.science || storeState.science,
      scienceIngest: res.scienceIngest || storeState.scienceIngest,
      sciencePrior: res.sciencePrior || storeState.sciencePrior,
      adaptive: res.adaptive || storeState.adaptive,
      lastSymbol: 'MARKET',
      lastUpdatedAt: Date.now(),
      lastError: null
    });
  }
  return res;
}

const COIN_SLUG = Object.freeze({
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  BNB: 'binancecoin',
  ARB: 'arbitrum',
  TON: 'the-open-network'
});

/**
 * Execute a full On-Device Walk-Forward Self-Evolution + Swarm Delta Upload
 * on real market OHLC candles using the user's own GPU/CPU!
 */
export async function evolveNeuromorphicOnLiveCandles({ symbol = 'BTC', candles = null } = {}) {
  if (storeState.evolving) return { ok: false, reason: 'ALREADY_EVOLVING' };
  emit({ evolving: true, lastError: null });
  try {
    await initNeuromorphicRuntime();
    await syncWithGlobalSwarm();

    let series = Array.isArray(candles) ? candles : null;
    if (!series || series.length < 16) {
      const id = COIN_SLUG[String(symbol || 'BTC').toUpperCase()] || 'bitcoin';
      const rows = await getOhlc(id, 30, 'usd');
      if (Array.isArray(rows)) {
        series = rows
          .map((r) => ({
            time: r.t ?? r.time ?? null,
            open: r.o ?? r.open,
            high: r.h ?? r.high,
            low: r.l ?? r.low,
            close: r.c ?? r.close
          }))
          .filter((c) => Number.isFinite(Number(c.close)) && Number(c.close) > 0);
      }
    }

    if (!series || series.length < 16) {
      emit({ evolving: false, lastError: 'INSUFFICIENT_LIVE_CANDLES' });
      return { ok: false, reason: 'INSUFFICIENT_LIVE_CANDLES' };
    }

    const res = await sendWorkerMessage({ type: 'evolve', candles: series, symbol });
    if (!res.ok) {
      emit({ evolving: false, lastError: res.reason || 'EVOLVE_FAILED' });
      return res;
    }

    let swarmUpload = null;
    if (storeState.swarmOptIn && res.evolution?.improved && res.evolution?.deltaPacket) {
      // Ensure baseGeneration matches latest known globalGeneration
      const packet = {
        ...res.evolution.deltaPacket,
        baseGeneration: storeState.globalGeneration ?? storeState.localGeneration ?? 0
      };
      swarmUpload = await swarmFetch('/v1/ai/neuromorphic/delta', {
        method: 'POST',
        body: packet
      });
      if (swarmUpload.ok) {
        if (swarmUpload.crystallized && Array.isArray(swarmUpload.globalWeights)) {
          await sendWorkerMessage({
            type: 'syncGenome',
            weights: swarmUpload.globalWeights,
            generation: swarmUpload.globalGeneration
          });
        }
        const refreshed = await swarmFetch('/v1/ai/neuromorphic/status');
        if (refreshed.ok) {
          emit({
            swarmStatus: refreshed,
            globalGeneration: refreshed.globalGeneration,
            localGeneration: swarmUpload.globalGeneration ?? storeState.localGeneration
          });
        }
      }
    }

    emit({
      evolving: false,
      readout: res.readout || storeState.readout,
      structuralLast: res.structural || storeState.structuralLast,
      evolutionLast: {
        ...res.evolution,
        swarmUpload,
        at: Date.now(),
        symbol
      },
      engramRecall: res.engramRecall || storeState.engramRecall,
      governor: res.governor || storeState.governor,
      reservoirNeurons: res.readout?.topology?.reservoirNeurons ?? storeState.reservoirNeurons,
      engramCount: res.engramRecall?.totalEngrams ?? storeState.engramCount,
      lastSymbol: symbol,
      lastUpdatedAt: Date.now()
    });

    return { ok: true, ...res, swarmUpload };
  } catch (err) {
    const msg = String(err?.message || err || 'EVOLVE_ERROR').slice(0, 140);
    emit({ evolving: false, lastError: msg });
    return { ok: false, error: msg };
  }
}

export async function setNeuromorphicPreferences({ swarmOptIn, paused, intentGenome } = {}) {
  const nextPrefs = {
    swarmOptIn: typeof swarmOptIn === 'boolean' ? swarmOptIn : storeState.swarmOptIn,
    paused: typeof paused === 'boolean' ? paused : storeState.paused
  };
  savePrefs(nextPrefs);
  emit(nextPrefs);
  const res = await sendWorkerMessage({
    type: 'configure',
    swarmOptIn: nextPrefs.swarmOptIn,
    paused: nextPrefs.paused,
    intentGenome
  });
  if (res.ok && res.governor) {
    emit({ governor: res.governor });
  }
  return res;
}

export async function resetLocalNeuromorphicCortex() {
  const res = await sendWorkerMessage({ type: 'reset' });
  if (res.ok) {
    emit({
      localGeneration: 0,
      reservoirNeurons: res.reservoirNeurons ?? 96,
      engramCount: 0,
      readout: null,
      engramRecall: null,
      structuralLast: null,
      evolutionLast: null,
      /* PHASE 9 — a reset wipes the measured condition, profile and servo too:
       * keeping the old report would show a state this cortex no longer has. */
      adaptive: null,
      governor: res.governor || storeState.governor,
      lastError: null
    });
  }
  return res;
}

/* ── Phase 6: brain-inspired consolidation & A/B switches ─────────────────── */

/**
 * Run sharp-wave-ripple consolidation over this device's real episodic engrams.
 * The numbers in the result are measured by the worker, not promised here.
 */
export async function consolidateLocalBrain({ iterations = 6 } = {}) {
  await initNeuromorphicRuntime();
  const res = await sendWorkerMessage({ type: 'consolidate', iterations });
  if (res.ok && res.consolidation) {
    emit({
      consolidationLast: res.consolidation,
      science: res.science || storeState.science,
      scienceIngest: res.scienceIngest || storeState.scienceIngest,
      readout: res.readout || storeState.readout,
      engramCount: res.engramCount ?? storeState.engramCount,
      lastUpdatedAt: Date.now(),
      lastError: null
    });
  }
  return res;
}

/** Turn the brain-inspired circuits on/off for A/B comparison (device-local). */
export async function setBrainCircuitsEnabled(enabled) {
  const on = enabled !== false;
  const res = await sendWorkerMessage({ type: 'configure', brainEnabled: on });
  if (res.ok) emit({ brainEnabled: on });
  return res;
}

/** Explicit governor/preference configuration (pause, swarm opt-in, genome). */
export async function configureGovernor({ paused, swarmOptIn, intentGenome } = {}) {
  return setNeuromorphicPreferences({ paused, swarmOptIn, intentGenome });
}

export async function resetNeuromorphicRuntime() {
  return resetLocalNeuromorphicCortex();
}

/* ── Phase 9: Adaptive Intelligence Ecosystem ─────────────────────────────── */

/**
 * Read the ecosystem's measured state: data condition, chosen profile, the
 * firing-rate servo, and the actuators currently in force.
 */
export async function refreshAdaptiveEcosystem() {
  await initNeuromorphicRuntime();
  const res = await sendWorkerMessage({ type: 'adaptive', action: 'report' });
  if (res.ok) emit({ adaptive: res.adaptive || storeState.adaptive });
  return res;
}

/** Turn the data-conditioned adaptation on/off (A/B against fixed Phase-6 dynamics). */
export async function setAdaptiveEcosystemEnabled(enabled) {
  const on = enabled !== false;
  const res = await sendWorkerMessage({ type: 'adaptive', action: 'set', enabled: on });
  if (res.ok) {
    emit({
      adaptiveEnabled: on,
      adaptive: on ? (res.adaptive || storeState.adaptive) : null
    });
  }
  return res;
}

/**
 * Consent switch for the *learning duty cycle* only. When off, the ecosystem keeps
 * adapting the firing rate and the budget but stops spending learning steps; it
 * never claims to have learned while this is false.
 */
export async function setAdaptiveLearningOptIn(optIn) {
  const on = optIn !== false;
  const res = await sendWorkerMessage({ type: 'adaptive', action: 'set', learningOptIn: on });
  if (res.ok) emit({ adaptiveLearningOptIn: on, adaptive: res.adaptive || storeState.adaptive });
  return res;
}

/**
 * Replay this device's measured spike counts through a fresh servo and report
 * where it would have moved synaptic efficacy. Reports `isConstant: true` if the
 * controller would have output a constant — which is the failure this check exists
 * to catch.
 */
export async function counterfactualServoReplay(spikeCounts = [], reservoirSize = 96) {
  await initNeuromorphicRuntime();
  return sendWorkerMessage({
    type: 'adaptive',
    action: 'counterfactual',
    spikeCounts,
    reservoirSize
  });
}

/* ── Phase 7: Universal Scientific Memory ─────────────────────────────────── */

/**
 * Score this device's resolved engrams against the pre-specified hypothesis
 * family and return the measured report. Nothing is fabricated: an empty bank
 * yields an honest "open" family with zero evidence.
 */
export async function ingestScientificMemory() {
  await initNeuromorphicRuntime();
  const res = await sendWorkerMessage({ type: 'science', action: 'ingest' });
  if (res.ok && res.science) {
    emit({
      science: res.science,
      scienceIngest: res.ingest || storeState.scienceIngest,
      scienceAction: { action: 'ingest', at: Date.now(), ingest: res.ingest || null },
      scienceError: null
    });
  } else {
    emit({ scienceError: res.error || res.reason || 'SCIENCE_INGEST_FAILED' });
  }
  return res;
}

/** Read the current beliefs without adding evidence. */
export async function refreshScientificMemory() {
  await initNeuromorphicRuntime();
  const res = await sendWorkerMessage({ type: 'science', action: 'report' });
  if (res.ok && res.science) emit({ science: res.science });
  return res;
}

/** Retire hypotheses whose declared expiry has passed (keeps beliefs finite). */
export async function retireScientificMemory() {
  await initNeuromorphicRuntime();
  const res = await sendWorkerMessage({ type: 'science', action: 'retire' });
  if (res.ok && res.science) {
    emit({
      science: res.science,
      scienceAction: { action: 'retire', at: Date.now(), retired: res.retired?.retired ?? 0 }
    });
  }
  return res;
}

/**
 * Publish only the portable prior (log Bayes factors + effective counts of
 * pre-specified families) to the world registry, then read the aggregate back.
 * Raw prices, vectors, engrams and device identifiers are never uploaded.
 */
export async function shareScientificPrior() {
  if (!storeState.swarmOptIn) {
    return { ok: false, reason: 'SWARM_OPT_OUT' };
  }
  await initNeuromorphicRuntime();
  const exported = await sendWorkerMessage({ type: 'science', action: 'exportPrior' });
  if (!exported.ok || !exported.packet) {
    emit({ scienceError: exported.error || 'NO_PRIOR_PACKET' });
    return { ok: false, reason: 'NO_PRIOR_PACKET' };
  }
  if (!Array.isArray(exported.packet.records) || exported.packet.records.length === 0) {
    return { ok: false, reason: 'NO_EVIDENCE_TO_SHARE', packet: exported.packet };
  }
  const upload = await swarmFetch('/v1/ai/neuromorphic/science/prior', {
    method: 'POST',
    body: { packet: exported.packet }
  });
  const world = await syncScienceWorld();
  emit({
    scienceAction: {
      action: 'share',
      at: Date.now(),
      records: exported.packet.records.length,
      accepted: Boolean(upload.ok),
      code: upload.code || (upload.ok ? 'ACCEPTED' : 'UPLOAD_FAILED')
    },
    scienceError: upload.ok ? null : (upload.code || upload.error || 'SHARE_FAILED')
  });
  return { ...upload, packet: exported.packet, world };
}

/** Pull the world registry (consensus across devices) — read-only. */
export async function syncScienceWorld() {
  const res = await swarmFetch('/v1/ai/neuromorphic/science');
  if (res.ok && res.world) {
    emit({ scienceWorld: res.world });
  }
  return res.world || null;
}

/** Accept another device's prior packet (deduplicated by packet hash). */
export async function mergeScientificPrior(packet) {
  await initNeuromorphicRuntime();
  const res = await sendWorkerMessage({ type: 'science', action: 'mergePrior', packet });
  if (res.ok && res.science) {
    emit({
      science: res.science,
      scienceAction: { action: 'mergePrior', at: Date.now(), merged: res.merged?.merged ?? 0 },
      scienceError: null
    });
  } else {
    emit({ scienceError: res.code || res.merged?.code || res.error || 'MERGE_REJECTED' });
  }
  return res;
}

/* ── React Hook ───────────────────────────────────────────────────────────── */

/**
 * Subscribe to the shared on-device cortex store.
 *
 * Returns a SINGLE OBJECT (`nm.readout`, `nm.backend`, `nm.paused`, …) exactly
 * the way every consumer uses it. It used to return `[state, actions]`, so
 * `nm.readout` was `undefined` in the panel, the chat strip and the Intent OS
 * header — the console rendered "—" forever even after the cortex had run.
 * The action names below are the ones the components call; aliases are kept for
 * the older call sites so nothing silently breaks.
 */
export function useNeuromorphicCortex({ autoSync = true } = {}) {
  const [state, setState] = useState(() => ({ ...storeState }));

  useEffect(() => {
    const onUpdate = (next) => setState(next);
    listeners.add(onUpdate);
    void initNeuromorphicRuntime();
    if (autoSync) {
      void syncWithGlobalSwarm();
      void syncScienceWorld();
    }
    return () => {
      listeners.delete(onUpdate);
    };
  }, [autoSync]);

  return {
    ...state,

    /* lifecycle */
    init: (args = {}) => initNeuromorphicRuntime(args),
    sync: () => syncWithGlobalSwarm(),

    /* feeding observations */
    tickWithCandles: (candles, args = {}) => tickNeuromorphicWithCandles(candles, args),
    tickWithMarketPulse: (args = {}) => tickNeuromorphicWithMarketPulse(args),
    tickCandles: (candles, args = {}) => tickNeuromorphicWithCandles(candles, args),
    tickPulse: (markets, pulse = null) => tickNeuromorphicWithMarketPulse({ markets, pulse }),

    /* self-evolution */
    evolveOnLiveCandles: (args = {}) => evolveNeuromorphicOnLiveCandles(args),
    evolve: (args = {}) => evolveNeuromorphicOnLiveCandles(args),

    /* Phase 6 — brain-inspired circuits */
    consolidateBrain: (args = {}) => consolidateLocalBrain(args),
    setBrainEnabled: (enabled) => setBrainCircuitsEnabled(enabled),

    /* Phase 7 — universal scientific memory */
    ingestScience: () => ingestScientificMemory(),
    refreshScience: () => refreshScientificMemory(),
    retireScience: () => retireScientificMemory(),
    shareSciencePrior: () => shareScientificPrior(),
    syncScienceWorld: () => syncScienceWorld(),
    mergeSciencePrior: (packet) => mergeScientificPrior(packet),

    /* Phase 9 — adaptive intelligence ecosystem */
    refreshAdaptive: () => refreshAdaptiveEcosystem(),
    setAdaptiveEnabled: (enabled) => setAdaptiveEcosystemEnabled(enabled),
    setLearningOptIn: (on) => setAdaptiveLearningOptIn(on),
    counterfactualServo: (counts, size) => counterfactualServoReplay(counts, size),

    /* preferences & governance */
    toggleSwarmOptIn: () => setNeuromorphicPreferences({ swarmOptIn: !storeState.swarmOptIn }),
    togglePaused: () => setNeuromorphicPreferences({ paused: !storeState.paused }),
    configure: (args = {}) => configureGovernor(args),
    configureGovernor: (args = {}) => configureGovernor(args),

    /* destructive */
    resetLocalCortex: () => resetLocalNeuromorphicCortex(),
    reset: () => resetNeuromorphicRuntime()
  };
}
