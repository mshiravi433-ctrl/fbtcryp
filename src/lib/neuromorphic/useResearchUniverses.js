/**
 * FBT NEUROMORPHIC 2050 — PHASE 8: PARALLEL RESEARCH UNIVERSES (DEVICE RUNTIME)
 * ===========================================================================
 * Shared singleton bridge between any React surface and the pure research
 * engine (`researchUniverses.js`). Same discipline as `useNeuromorphicCortex`:
 *
 *   · The engine is deterministic. A pulse over live candles is labelled
 *     `retrospective` (the bars already existed), so it can never be reported as
 *     a confirmed prediction.
 *   · Nothing is pre-filled: the first report has `resolved: 0` and every score
 *     field is `null` (the UI renders `—`).
 *   · Prices come only from real OHLC candles (`getOhlc`); when the feed returns
 *     nothing, the pulse refuses with `INSUFFICIENT_LIVE_CANDLES` instead of
 *     inventing a series.
 *   · State persists in `localStorage` as a schema-versioned snapshot; a snapshot
 *     that does not match the schema is dropped, never half-interpreted.
 *   · No execution path: the engine is read-and-analyse only.
 */

import { useEffect, useState } from 'react';
import { getOhlc } from '../api.js';
import {
  DEFAULT_POPULATION,
  UNIVERSES_SCHEMA,
  createResearchUniverses
} from './researchUniverses.js';

export const UNIVERSES_STORAGE_KEY = 'fbt.neuromorphic.universes.v1';
export const UNIVERSES_PREFS_KEY = 'fbt.neuromorphic.universes.prefs.v1';

const COIN_SLUG = Object.freeze({
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  BNB: 'binancecoin',
  TON: 'the-open-network',
  ARB: 'arbitrum'
});

const listeners = new Set();
let engine = null;

let store = Object.freeze({
  ready: false,
  report: null,
  running: false,
  evolving: false,
  error: null,
  symbol: 'BTC',
  lastPulse: null,
  restored: false
});

function snapshot() {
  return store;
}

function emit(patch) {
  store = Object.freeze({ ...store, ...patch });
  for (const fn of listeners) {
    try {
      fn(store);
    } catch { /* a broken subscriber must not break the engine */ }
  }
}

function readPrefs() {
  try {
    if (typeof localStorage === 'undefined') return { symbol: 'BTC' };
    const raw = localStorage.getItem(UNIVERSES_PREFS_KEY);
    if (!raw) return { symbol: 'BTC' };
    const parsed = JSON.parse(raw);
    const symbol = String(parsed?.symbol || 'BTC').toUpperCase().slice(0, 8);
    return { symbol: COIN_SLUG[symbol] ? symbol : 'BTC' };
  } catch {
    return { symbol: 'BTC' };
  }
}

function savePrefs(prefs) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(UNIVERSES_PREFS_KEY, JSON.stringify(prefs));
    }
  } catch { /* storage may be disabled — the engine still works in memory */ }
}

function persist() {
  if (!engine) return false;
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem(UNIVERSES_STORAGE_KEY, JSON.stringify(engine.toJSON()));
    return true;
  } catch {
    return false;
  }
}

function ensureEngine() {
  if (engine) return engine;
  const prefs = readPrefs();
  engine = createResearchUniverses({ population: DEFAULT_POPULATION });
  let restored = false;
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(UNIVERSES_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.schema === UNIVERSES_SCHEMA) {
          const result = engine.restore(parsed);
          restored = Boolean(result?.ok);
          if (!restored) engine.reset();
        }
      }
    }
  } catch {
    engine.reset();
    restored = false;
  }
  // Initialise the shared state without notifying subscribers: ensureEngine()
  // may run inside a React render, and emitting there would schedule a state
  // update for components that are already rendering.
  store = Object.freeze({
    ...store,
    ready: true,
    restored,
    symbol: prefs.symbol,
    report: engine.report()
  });
  return engine;
}

function normalizeOhlc(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => ({
      t: row?.t ?? row?.time ?? null,
      o: Number(row?.o ?? row?.open),
      h: Number(row?.h ?? row?.high),
      l: Number(row?.l ?? row?.low),
      c: Number(row?.c ?? row?.close)
    }))
    .filter(
      (row) =>
        Number.isFinite(row.c) && row.c > 0 &&
        Number.isFinite(row.h) && Number.isFinite(row.l)
    );
}

async function fetchLiveCandles(symbol) {
  const id = COIN_SLUG[String(symbol || 'BTC').toUpperCase()] || 'bitcoin';
  const rows = await getOhlc(id, 90, 'usd');
  return normalizeOhlc(rows);
}

/**
 * Run one walk-forward research pulse over real candles.
 * Every step predicts bar t+1 using only bars up to t — the outcome is resolved
 * from the next real bar, so no step can see its own answer.
 */
export async function runResearchPulse({ symbol = null, candles = null, bars = 180 } = {}) {
  ensureEngine();
  if (store.running) return { ok: false, reason: 'ALREADY_RUNNING' };
  const activeSymbol = String(symbol || store.symbol || 'BTC').toUpperCase().slice(0, 8);
  emit({ running: true, error: null });
  try {
    const series = Array.isArray(candles) && candles.length >= 12
      ? normalizeOhlc(candles)
      : await fetchLiveCandles(activeSymbol);
    if (series.length < 12) {
      emit({ running: false, error: 'INSUFFICIENT_LIVE_CANDLES' });
      return { ok: false, reason: 'INSUFFICIENT_LIVE_CANDLES', bars: series.length };
    }
    const pulse = engine.runPulse({ candles: series, symbol: activeSymbol, maxBars: bars });
    if (!pulse.ok) {
      emit({ running: false, error: pulse.reason || 'PULSE_FAILED' });
      return pulse;
    }
    savePrefs({ symbol: activeSymbol });
    const persisted = persist();
    emit({
      running: false,
      error: null,
      symbol: activeSymbol,
      report: pulse.report,
      lastPulse: {
        symbol: activeSymbol,
        bars: pulse.bars,
        skipped: pulse.skipped,
        ties: pulse.ties,
        from: pulse.from,
        to: pulse.to,
        persisted,
        at: Date.now()
      }
    });
    return { ok: true, ...pulse, persisted };
  } catch (err) {
    const message = String(err?.message || err || 'PULSE_ERROR').slice(0, 140);
    emit({ running: false, error: message });
    return { ok: false, error: message };
  }
}

/** Force a selection round (cull worst quartile, breed survivors). */
export async function evolveResearchUniverses() {
  ensureEngine();
  if (store.evolving) return { ok: false, reason: 'ALREADY_EVOLVING' };
  emit({ evolving: true, error: null });
  try {
    const res = engine.evolve();
    if (!res.ok) {
      emit({
        evolving: false,
        error: res.reason === 'INSUFFICIENT_EVIDENCE' ? 'INSUFFICIENT_EVIDENCE' : (res.reason || 'EVOLVE_FAILED')
      });
      return res;
    }
    persist();
    emit({ evolving: false, report: engine.report(), error: null });
    return { ok: true, ...res };
  } catch (err) {
    const message = String(err?.message || err || 'EVOLVE_ERROR').slice(0, 140);
    emit({ evolving: false, error: message });
    return { ok: false, error: message };
  }
}

/** Wipe the population, its track record and the persisted snapshot. */
export async function resetResearchUniverses() {
  ensureEngine();
  try {
    engine.reset();
    if (typeof localStorage !== 'undefined') localStorage.removeItem(UNIVERSES_STORAGE_KEY);
  } catch { /* ignore storage failures */ }
  emit({ report: engine.report(), lastPulse: null, error: null, restored: false });
  return { ok: true };
}

/** Explicitly choose the tracked market (persisted, no network call). */
export function setResearchUniverseSymbol(symbol) {
  const next = String(symbol || 'BTC').toUpperCase().slice(0, 8);
  if (!COIN_SLUG[next]) return { ok: false, reason: 'UNSUPPORTED_SYMBOL' };
  savePrefs({ symbol: next });
  emit({ symbol: next });
  return { ok: true, symbol: next };
}

/** Report for non-React callers (diagnostics / server parity). */
export function getResearchUniversesReport() {
  ensureEngine();
  return engine.report();
}

/** Full snapshot for export/audit (same schema the hook persists). */
export function exportResearchUniverses() {
  ensureEngine();
  return engine.toJSON();
}

export function useResearchUniverses() {
  const [state, setState] = useState(() => {
    ensureEngine();
    return snapshot();
  });

  useEffect(() => {
    const listener = (next) => setState(next);
    listeners.add(listener);
    listener(snapshot());
    return () => listeners.delete(listener);
  }, []);

  return {
    ...state,
    runPulse: runResearchPulse,
    evolve: evolveResearchUniverses,
    reset: resetResearchUniverses,
    setSymbol: setResearchUniverseSymbol,
    refresh: () => {
      ensureEngine();
      emit({ report: engine.report() });
    }
  };
}

/** Test-only helper: drop the in-memory engine (does not touch storage). */
export function __resetResearchUniverseRuntime() {
  engine = null;
  store = Object.freeze({
    ready: false,
    report: null,
    running: false,
    evolving: false,
    error: null,
    symbol: 'BTC',
    lastPulse: null,
    restored: false
  });
}
