/**
 * FBT NEUROMORPHIC 2050 — PHASE 4: SHARED CLIENT RUNTIME & REACT HOOK
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
  wipeLocalCortexBundle
} from './engramMemory.js';
import { blendGlobalSwarmWeights, runLocalSwarmEvolution } from './swarmClient.js';

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
  structuralLast: null,
  evolutionLast: null,
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

function ensureInlineRuntime() {
  if (!inlineCortex) {
    inlineCortex = createNeuromorphicCortex();
    inlineEngrams = createEngramMemory();
    inlineGovernor = createHardwareGovernor({
      paused: storeState.paused,
      swarmOptIn: storeState.swarmOptIn
    });
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
      maxReservoirNeurons: gov.maxReservoirNeurons || 192
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
      governor: res.governor || storeState.governor,
      lastError: null
    });
  }
  return res;
}

/* ── React Hook ───────────────────────────────────────────────────────────── */

export function useNeuromorphicCortex({ autoSync = true } = {}) {
  const [state, setState] = useState(storeState);

  useEffect(() => {
    const onUpdate = (next) => setState(next);
    listeners.add(onUpdate);
    void initNeuromorphicRuntime();
    if (autoSync) {
      void syncWithGlobalSwarm();
    }
    return () => {
      listeners.delete(onUpdate);
    };
  }, [autoSync]);

  const toggleSwarmOptIn = useCallback(() => {
    void setNeuromorphicPreferences({ swarmOptIn: !storeState.swarmOptIn });
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
    resetLocalCortex: resetLocalNeuromorphicCortex
  };
}
