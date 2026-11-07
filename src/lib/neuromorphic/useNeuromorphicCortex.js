/**
 * FBT NEUROMORPHIC 2050 — PHASE 4: SHARED CLIENT RUNTIME & REACT HOOK
 * ===========================================================================
 * Single shared bridge between any React surface (`/intent`, Chat Rooms,
 * `AiControlCenter`, `IntentOpsPanels`) and the off-main-thread WebGPU/CPU
 * Neuromorphic Worker (`neuromorphic.worker.js`); no network or swarm sync.
 *
 * Honesty Rules:
 *   · Initial readout, hitRate, meanBrier, latencyMs, and firingRateHz are
 *     `null` until real market data is processed (`—` in UI, never pre-filled).
 *   · In environments without `Worker` (jsdom/SSR tests), seamlessly executes
 *     the exact same pure-math cortex inline rather than faking results.
 */

import { useCallback, useEffect, useState } from 'react';
import { createNeuromorphicCortex } from './cortexCore.js';
import { featuresFromCandles, featuresFromMarketPulse } from './spikeEncoder.js';
import { createHardwareGovernor, readBatteryTelemetry } from './hardwareGovernor.js';
import { coupleIntentGenome, runStructuralPlasticity } from './plasticity.js';
import {
  createEngramMemory,
  wipeLocalCortexBundle
} from './engramMemory.js';
import { blendGlobalSwarmWeights, runLocalSwarmEvolution } from './swarmClient.js';

// New key deliberately does not inherit the legacy auto-start / swarm settings.
const PREFS_KEY = 'fbt.neuromorphic.local.v2';
function readPrefs() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(PREFS_KEY) : null;
    const parsed = raw ? JSON.parse(raw) : {};
    return { paused: parsed.paused !== false, computeMode: ['auto', 'eco', 'balanced'].includes(parsed.computeMode) ? parsed.computeMode : 'auto' };
  } catch { return { paused: true, computeMode: 'auto' }; }
}
function savePrefs(prefs) {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* storage optional */ }
}
async function deviceEnvironment() {
  return {
    tabVisible: typeof document === 'undefined' || document.visibilityState !== 'hidden',
    battery: await readBatteryTelemetry()
  };
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
  structuralLast: null,
  evolutionLast: null,
  swarmStatus: null,
  swarmOptIn: false, // remote sharing is disabled in the local ecosystem
  paused: initialPrefs.paused,
  computeMode: initialPrefs.computeMode,
  availableCandles: 0,
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

let latestCandles = null;
let latestCandleSymbol = null;
let workerInstance = null;
let workerInitPromise = null;
let msgSeq = 0;
const pendingWorkerCalls = new Map();

// Inline fallback instances when Worker is unavailable (jsdom / SSR)
let inlineCortex = null;
let inlineEngrams = null;
let inlineGovernor = null;

function ensureInlineRuntime() {
  if (!inlineCortex) {
    inlineCortex = createNeuromorphicCortex();
    inlineEngrams = createEngramMemory();
    inlineGovernor = createHardwareGovernor({
      paused: storeState.paused,
      swarmOptIn: true,
      computeMode: storeState.computeMode
    });
  }
}

async function sendWorkerMessage(payload, timeoutMs = 25000) {
  payload = { ...payload, environment: await deviceEnvironment(), computeMode: storeState.computeMode };
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
      workerInstance?.terminate();
      workerInstance = null;
      workerInitPromise = null;
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
      workerInstance?.terminate();
      workerInstance = null;
      workerInitPromise = null;
      for (const [pendingId, entry] of pendingWorkerCalls) {
        clearTimeout(entry.timer);
        pendingWorkerCalls.delete(pendingId);
        entry.reject(new Error('WORKER_TIMEOUT'));
      }
    }, timeoutMs);
    pendingWorkerCalls.set(id, { resolve, reject, timer });
    workerInstance.postMessage({ ...payload, id });
  });
}

async function requestWorker(payload) {
  try {
    return await sendWorkerMessage(payload);
  } catch (err) {
    const error = String(err?.message || err || 'WORKER_ERROR').slice(0, 140);
    emit({ lastError: error });
    return { ok: false, error };
  }
}

async function runInlineFallback(msg) {
  ensureInlineRuntime();
  const type = msg.type;
  inlineGovernor.configure({ environment: msg.environment, computeMode: msg.computeMode });
  if (type === 'init') {
    inlineGovernor.configure({ paused: msg.paused, swarmOptIn: msg.swarmOptIn });
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
      engramCount: inlineEngrams.size()
    };
  }
  if (type === 'tick') {
    const gov = await inlineGovernor.evaluate();
    if (!gov.allowInference) return { ok: true, skipped: true, governor: gov };
    const feat = Array.isArray(msg.candles) && msg.candles.length >= 3
      ? featuresFromCandles(msg.candles, { breadthRatio: msg.breadthRatio ?? null })
      : featuresFromMarketPulse({ markets: msg.markets || [], pulse: msg.pulse || null });
    if (!feat.ok) return { ok: false, reason: feat.reason, governor: gov };
    const readout = await inlineCortex.step(feat.vector, {
      observedPrice: feat.meta?.lastClose ?? null,
      learningEnabled: gov.allowPlasticity,
      sparseMode: gov.mode === 'ECO_SPARSE'
    });
    if (readout.learning?.rewardOutcome) {
      inlineEngrams.imprint({
        liquidState: inlineCortex._internals().getLiquidState(),
        realizedReturn: readout.learning.rewardOutcome.realizedReturn,
        regime: readout.dominantRegime,
        symbol: msg.symbol || feat.meta?.anchorSymbol || null
      });
    }
    let structural = null;
    if (gov.allowNeurogenesis && readout.localTicks % 6 === 0) {
      structural = runStructuralPlasticity(inlineCortex, {
        anomalySurprise: readout.anomalySurprise,
        maxReservoirNeurons: gov.maxReservoirNeurons
      });
    }
    return {
      ok: true,
      readout,
      structural,
      engramRecall: inlineEngrams.recall(inlineCortex._internals().getLiquidState()),
      governor: gov
    };
  }
  if (type === 'evolve') {
    const gov = await inlineGovernor.evaluate();
    const candles = Array.isArray(msg.candles) ? msg.candles : [];
    if (!gov.allowInference || !gov.allowPlasticity || !gov.swarmCloneBudget) return { ok: false, reason: gov.reason, governor: gov };
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
    const structural = gov.allowNeurogenesis && lastReadout ? runStructuralPlasticity(inlineCortex, {
      anomalySurprise: lastReadout.anomalySurprise,
      maxReservoirNeurons: gov.maxReservoirNeurons
    }) : null;
    const snap = inlineCortex.exportSnapshot();
    const evo = runLocalSwarmEvolution({
      candles,
      baseWeights: inlineCortex.getSwarmWeights(),
      baseGeneration: snap.generation,
      cloneCount: gov.swarmCloneBudget
    });
    if (!lastReadout) return { ok: false, reason: 'INSUFFICIENT_OBSERVATIONS', governor: gov };
    if (!evo.ok) return { ok: false, reason: evo.reason, governor: gov };
    // Experimental candidates are not promoted based on the selection sample.
    return {
      ok: true,
      readout: lastReadout,
      structural,
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
  if (type === 'configure') {
    inlineGovernor.configure({ paused: msg.paused, swarmOptIn: msg.swarmOptIn });
    if (msg.intentGenome) coupleIntentGenome(inlineCortex, msg.intentGenome);
    return { ok: true, governor: await inlineGovernor.evaluate() };
  }
  if (type === 'reset') {
    inlineCortex.reset();
    inlineEngrams.clear();
    await wipeLocalCortexBundle();
    return { ok: true, generation: 0, reservoirNeurons: 96, engramCount: 0, governor: await inlineGovernor.evaluate() };
  }
  return { ok: true };
}

/* ── Public Imperative Actions ────────────────────────────────────────────── */

export async function initNeuromorphicRuntime({ intentGenome = null } = {}) {
  if (!workerInitPromise) {
    workerInitPromise = requestWorker({
      type: 'init',
      swarmOptIn: true,
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
            lastError: null
          });
        } else {
          workerInitPromise = null;
          emit({ lastError: res.error || res.reason || 'INIT_FAILED' });
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

// Local-only by design. No sync, upload or server fallback, including old callers.
export async function syncWithGlobalSwarm() {
  return { ok: false, reason: 'LOCAL_ONLY' };
}

export async function tickNeuromorphicWithCandles(candles, { symbol = null, breadthRatio = null } = {}) {
  if (!Array.isArray(candles) || candles.length < 3) return { ok: false, reason: 'INSUFFICIENT_CANDLES' };
  latestCandles = candles.slice(-256).map((c) => ({ ...c }));
  latestCandleSymbol = symbol;
  emit({ availableCandles: latestCandles.length });
  if (storeState.paused) return { ok: false, reason: 'USER_PAUSED' };
  const init = await initNeuromorphicRuntime();
  if (!init.ok) return init;
  const res = await requestWorker({ type: 'tick', candles: latestCandles, symbol, breadthRatio });
  if (res.ok && res.readout) {
    emit({
      readout: res.readout,
      backend: res.readout.computeBackend || storeState.backend,
      engramRecall: res.engramRecall || storeState.engramRecall,
      structuralLast: res.structural || storeState.structuralLast,
      governor: res.governor || storeState.governor,
      reservoirNeurons: res.readout.topology?.reservoirNeurons ?? storeState.reservoirNeurons,
      engramCount: res.engramRecall?.totalEngrams ?? storeState.engramCount,
      lastSymbol: symbol || storeState.lastSymbol,
      lastUpdatedAt: Date.now(),
      lastError: null
    });
  }
  return res;
}

export async function tickNeuromorphicWithMarketPulse({ markets = [], pulse = null } = {}) {
  if (storeState.paused) return { ok: false, reason: 'USER_PAUSED' };
  const init = await initNeuromorphicRuntime();
  if (!init.ok) return init;
  const res = await requestWorker({ type: 'tick', markets, pulse, symbol: 'MARKET' });
  if (res.ok && res.readout) {
    emit({
      readout: res.readout,
      backend: res.readout.computeBackend || storeState.backend,
      engramRecall: res.engramRecall || storeState.engramRecall,
      structuralLast: res.structural || storeState.structuralLast,
      governor: res.governor || storeState.governor,
      reservoirNeurons: res.readout.topology?.reservoirNeurons ?? storeState.reservoirNeurons,
      engramCount: res.engramRecall?.totalEngrams ?? storeState.engramCount,
      lastSymbol: 'MARKET',
      lastUpdatedAt: Date.now(),
      lastError: null
    });
  }
  return res;
}

/** Research on candles already supplied by the application, without a request. */
export async function evolveNeuromorphicOnLiveCandles({ symbol = null, candles = null } = {}) {
  if (storeState.paused) return { ok: false, reason: 'USER_PAUSED' };
  if (storeState.evolving) return { ok: false, reason: 'ALREADY_EVOLVING' };
  const series = Array.isArray(candles) ? candles.slice(-256) : latestCandles;
  const selectedSymbol = symbol || latestCandleSymbol || 'MARKET';
  if (!series || series.length < 16) {
    emit({ lastError: 'INSUFFICIENT_LOCAL_CANDLES' });
    return { ok: false, reason: 'INSUFFICIENT_LOCAL_CANDLES' };
  }
  emit({ evolving: true, lastError: null });
  try {
    const init = await initNeuromorphicRuntime();
    if (!init.ok) throw new Error(init.error || 'INIT_FAILED');
    const res = await requestWorker({ type: 'evolve', candles: series, symbol: selectedSymbol });
    if (!res.ok) {
      emit({ evolving: false, lastError: res.reason || 'EVOLVE_FAILED', governor: res.governor || storeState.governor });
      return res;
    }
    emit({
      evolving: false, readout: res.readout || storeState.readout,
      backend: res.readout?.computeBackend || storeState.backend,
      structuralLast: res.structural || storeState.structuralLast,
      evolutionLast: { ...res.evolution, at: Date.now(), symbol: selectedSymbol },
      engramRecall: res.engramRecall || storeState.engramRecall,
      governor: res.governor || storeState.governor,
      reservoirNeurons: res.readout?.topology?.reservoirNeurons ?? storeState.reservoirNeurons,
      engramCount: res.engramRecall?.totalEngrams ?? storeState.engramCount,
      lastSymbol: selectedSymbol, lastUpdatedAt: Date.now()
    });
    return res;
  } catch (err) {
    const error = String(err?.message || err || 'EVOLVE_ERROR').slice(0, 140);
    emit({ evolving: false, lastError: error });
    return { ok: false, error };
  }
}

export async function setNeuromorphicPreferences({ paused, computeMode, intentGenome } = {}) {
  const nextPrefs = {
    paused: typeof paused === 'boolean' ? paused : storeState.paused,
    computeMode: ['auto', 'eco', 'balanced'].includes(computeMode) ? computeMode : storeState.computeMode
  };
  savePrefs(nextPrefs);
  emit(nextPrefs);
  const res = await requestWorker({ type: 'configure', swarmOptIn: true, ...nextPrefs, intentGenome });
  if (res.ok && res.governor) emit({ governor: res.governor });
  return res;
}

export async function resetLocalNeuromorphicCortex() {
  latestCandles = null; latestCandleSymbol = null;
  const res = await requestWorker({ type: 'reset' });
  if (res.ok) {
    emit({
      localGeneration: 0,
      availableCandles: 0,
      reservoirNeurons: res.reservoirNeurons ?? 96,
      engramCount: 0,
      readout: null,
      engramRecall: null,
      structuralLast: null,
      evolutionLast: null,
      governor: res.governor || storeState.governor,
      lastError: null
    });
  }
  return res;
}

/* ── React Hook ───────────────────────────────────────────────────────────── */

export function useNeuromorphicCortex() {
  const [state, setState] = useState(storeState);

  useEffect(() => {
    const onUpdate = (next) => setState(next);
    listeners.add(onUpdate);
    if (!storeState.paused) void initNeuromorphicRuntime();
    return () => {
      listeners.delete(onUpdate);
    };
  }, []);

  const toggleSwarmOptIn = useCallback(() => {
    // Remote sharing is intentionally unavailable in local-only mode.
  }, []);

  const togglePaused = useCallback(() => {
    void setNeuromorphicPreferences({ paused: !storeState.paused });
  }, []);

  return {
    ...state,
    tickWithCandles: tickNeuromorphicWithCandles,
    tickWithMarketPulse: tickNeuromorphicWithMarketPulse,
    evolveOnLiveCandles: evolveNeuromorphicOnLiveCandles,
    syncSwarm: syncWithGlobalSwarm,
    toggleSwarmOptIn,
    togglePaused,
    setComputeMode: (computeMode) => setNeuromorphicPreferences({ computeMode }),
    resetLocalCortex: resetLocalNeuromorphicCortex
  };
}
