/**
 * EXECUTION-OBSERVATION MODEL — empirical trainer.
 * ---------------------------------------------------------------------------
 * Consumes the durable `intent-observations:<dayBucket>` dataset written by
 * server/intentObservation.js and publishes a bounded statistical description
 * of what actually happened: completion rate, per-route rates (chain × policy
 * × solver) with sample counts, failure-code frequencies, and the gas /
 * output-error / latency bucket distributions.
 *
 * WHAT THIS IS NOT
 *   Not a classifier. Not an LLM. Not route optimisation. Not a claim of
 *   MEV protection, atomicity or escrow. The published object is a count of
 *   observations, nothing more — and `modelTrained` is only true when there
 *   are enough of them to describe anything at all.
 *
 * FAIL CLOSED
 *   Fewer than MIN_EXEC_TRAIN records, or no route with MIN_EXEC_ROUTE_SAMPLES
 *   samples, publishes `modelTrained: false`. Missing Blob, a thrown read or
 *   a blown budget leaves whatever was previously served (or the empty
 *   untrained shape). The trainer never throws.
 *
 * SERVING
 *   Same contract as server/learning/params.js: Blob at most once per cold
 *   start (and after each daily run); every later request is an in-memory
 *   map read. Tests inject `io` and that path NEVER touches the shared
 *   memoryStore, so a probe cannot leak a fake model into later HTTP suites.
 */

import { getCached, memoryStore, setCached } from '../cache.js';
import { blobConfigured, blobGet, blobSet } from '../blobCache.js';
import {
  OBSERVATION_STORE_KEY,
  validateObservation
} from '../intentObservation.js';

export const EXEC_MODEL_SCHEMA = 'fbt.intent-execution-model.v1';
export const EXEC_MODEL_STORE_KEY = 'intent-execution-model';
export const EXEC_OBS_CACHE_KEY = 'learning.exec-observation-model';
export const EXEC_MODEL_WINDOW_DAYS = 60;
export const MIN_EXEC_TRAIN = 50;
export const MIN_EXEC_ROUTE_SAMPLES = 5;
export const EXEC_TRAIN_BUDGET_MS = 20000;

const DAY_MS = 24 * 3600 * 1000;
const CACHE_TTL_MS = 30 * 24 * 3600 * 1000;
const MODEL_TTL_MS = 90 * DAY_MS;
const MAX_PUBLISHED_ROUTES = 200;

const round4 = (v) => Math.round(v * 10000) / 10000;

const HONEST_CLAIMS = Object.freeze({
  classifier: false,
  llm: false,
  mevProtection: false,
  atomicCrossChain: false,
  escrow: false,
  routeOptimization: false
});

const defaultIo = {
  configured: blobConfigured,
  get: (key) => blobGet(key),
  set: (key, value, ttlMs = MODEL_TTL_MS) => blobSet(key, value, ttlMs)
};

const emptyOutcomes = () => ({ completed: 0, failed: 0, cancelled: 0 });

function asCountMap(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (typeof k !== 'string' || k.length > 80) continue;
    const n = Math.floor(Number(v));
    if (Number.isFinite(n) && n >= 0) out[k] = n;
  }
  return out;
}

function sanitizeRoutes(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const row of raw.slice(0, MAX_PUBLISHED_ROUTES)) {
    if (!row || typeof row !== 'object') continue;
    const n = Math.max(0, Math.floor(Number(row.n) || 0));
    const completed = Math.max(0, Math.floor(Number(row.completed) || 0));
    out.push({
      chainId: Number(row.chainId) || 0,
      routePolicy: typeof row.routePolicy === 'string' ? row.routePolicy.slice(0, 80) : '',
      solver: typeof row.solver === 'string' ? row.solver.slice(0, 32) : '',
      n,
      completed,
      failed: Math.max(0, Math.floor(Number(row.failed) || 0)),
      cancelled: Math.max(0, Math.floor(Number(row.cancelled) || 0)),
      completionRate: n > 0 ? round4(completed / n) : null
    });
  }
  return out;
}

/** Drop unknown keys so a poisoned Blob file cannot smuggle identifiers. */
export function sanitizeExecModel(raw, { now = Date.now() } = {}) {
  if (!raw || typeof raw !== 'object') return emptyExecModel({ now, reason: 'NOT_ENOUGH_DATA' });
  const records = Math.max(0, Math.floor(Number(raw.records) || 0));
  const outcomes = {
    completed: Math.max(0, Math.floor(Number(raw.outcomes?.completed) || 0)),
    failed: Math.max(0, Math.floor(Number(raw.outcomes?.failed) || 0)),
    cancelled: Math.max(0, Math.floor(Number(raw.outcomes?.cancelled) || 0))
  };
  const routes = sanitizeRoutes(raw.routes);
  const enough = records >= MIN_EXEC_TRAIN && routes.some((r) => r.n >= MIN_EXEC_ROUTE_SAMPLES);
  return {
    schema: EXEC_MODEL_SCHEMA,
    modelTrained: Boolean(raw.modelTrained) && enough,
    trainedAt: typeof raw.trainedAt === 'string' ? raw.trainedAt : new Date(now).toISOString(),
    windowDays: EXEC_MODEL_WINDOW_DAYS,
    records,
    reason: typeof raw.reason === 'string' ? raw.reason.slice(0, 40) : (enough ? 'OK' : 'NOT_ENOUGH_DATA'),
    completionRate: records > 0 ? round4(outcomes.completed / records) : null,
    outcomes,
    routes,
    failureCodes: asCountMap(raw.failureCodes),
    gasEstimate: asCountMap(raw.gasEstimate),
    gasErrorBps: asCountMap(raw.gasErrorBps),
    outputErrorBps: asCountMap(raw.outputErrorBps),
    confirmationLatency: asCountMap(raw.confirmationLatency),
    simulationStatus: asCountMap(raw.simulationStatus),
    intentKind: asCountMap(raw.intentKind),
    claims: { ...HONEST_CLAIMS }
  };
}

export function emptyExecModel({ now = Date.now(), records = 0, reason = 'NOT_ENOUGH_DATA' } = {}) {
  return {
    schema: EXEC_MODEL_SCHEMA,
    modelTrained: false,
    trainedAt: new Date(now).toISOString(),
    windowDays: EXEC_MODEL_WINDOW_DAYS,
    records,
    reason,
    completionRate: null,
    outcomes: emptyOutcomes(),
    routes: [],
    failureCodes: {},
    gasEstimate: {},
    gasErrorBps: {},
    outputErrorBps: {},
    confirmationLatency: {},
    simulationStatus: {},
    intentKind: {},
    claims: { ...HONEST_CLAIMS }
  };
}

/** Re-validate a stored row against the ingest schema, using its own day so
 *  a 31–60-day-old observation is not rejected for recency. */
export function isTrainableObservation(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
  const day = Number(row.dayBucket);
  if (!Number.isInteger(day)) return false;
  return validateObservation(row, day * DAY_MS + 12 * 3600 * 1000).ok === true;
}

function bump(map, key) {
  if (typeof key !== 'string' && typeof key !== 'number') return;
  const k = String(key);
  map[k] = (map[k] ?? 0) + 1;
}

/**
 * Pure aggregation. `rows` is the already-fetched window; no I/O.
 * Thin routes (n < MIN_EXEC_ROUTE_SAMPLES) are still listed with their
 * counts — hiding them would pretend the sample is cleaner than it is —
 * but they cannot flip `modelTrained` to true.
 */
export function buildExecObservationModel(rows, { now = Date.now() } = {}) {
  const today = Math.floor(now / DAY_MS);
  const cutoff = today - EXEC_MODEL_WINDOW_DAYS;
  const outcomes = emptyOutcomes();
  const failureCodes = {};
  const gasEstimate = {};
  const gasErrorBps = {};
  const outputErrorBps = {};
  const confirmationLatency = {};
  const simulationStatus = {};
  const intentKind = {};
  const byRoute = new Map();

  let records = 0;
  for (const row of rows ?? []) {
    if (!isTrainableObservation(row)) continue;
    if (row.dayBucket < cutoff || row.dayBucket > today + 1) continue;
    records += 1;
    if (row.outcome === 'completed') outcomes.completed += 1;
    else if (row.outcome === 'failed') outcomes.failed += 1;
    else if (row.outcome === 'cancelled') outcomes.cancelled += 1;
    bump(failureCodes, row.failureCode);
    bump(gasEstimate, row.gasEstimateBucket);
    bump(gasErrorBps, row.gasErrorBpsBucket);
    bump(outputErrorBps, row.outputErrorBpsBucket);
    bump(confirmationLatency, row.confirmationLatencyBucket);
    bump(simulationStatus, row.simulationStatus);
    bump(intentKind, row.intentKind);

    const key = `${row.chainId}\t${row.routePolicy}\t${row.solver}`;
    const slot = byRoute.get(key) ?? {
      chainId: row.chainId,
      routePolicy: row.routePolicy,
      solver: row.solver,
      n: 0,
      completed: 0,
      failed: 0,
      cancelled: 0
    };
    slot.n += 1;
    if (row.outcome === 'completed') slot.completed += 1;
    else if (row.outcome === 'failed') slot.failed += 1;
    else if (row.outcome === 'cancelled') slot.cancelled += 1;
    byRoute.set(key, slot);
  }

  const routes = [...byRoute.values()]
    .map((r) => ({
      ...r,
      completionRate: r.n > 0 ? round4(r.completed / r.n) : null
    }))
    .sort((a, b) => b.n - a.n || a.chainId - b.chainId || String(a.solver).localeCompare(b.solver))
    .slice(0, MAX_PUBLISHED_ROUTES);

  const enoughRecords = records >= MIN_EXEC_TRAIN;
  const enoughRoute = routes.some((r) => r.n >= MIN_EXEC_ROUTE_SAMPLES);
  const modelTrained = enoughRecords && enoughRoute;

  return {
    schema: EXEC_MODEL_SCHEMA,
    modelTrained,
    trainedAt: new Date(now).toISOString(),
    windowDays: EXEC_MODEL_WINDOW_DAYS,
    records,
    reason: modelTrained ? 'OK' : 'NOT_ENOUGH_DATA',
    completionRate: records > 0 ? round4(outcomes.completed / records) : null,
    outcomes,
    routes,
    failureCodes,
    gasEstimate,
    gasErrorBps,
    outputErrorBps,
    confirmationLatency,
    simulationStatus,
    intentKind,
    claims: { ...HONEST_CLAIMS }
  };
}

export async function readObservationWindow({
  days = EXEC_MODEL_WINDOW_DAYS,
  now = Date.now(),
  io = defaultIo
} = {}) {
  if (!io?.get) return [];
  const today = Math.floor(now / DAY_MS);
  const rows = [];
  for (let d = 0; d < days; d += 1) {
    try {
      const existing = await io.get(`${OBSERVATION_STORE_KEY}:${today - d}`);
      if (Array.isArray(existing)) rows.push(...existing);
    } catch {
      /* a missing day is not a training failure */
    }
  }
  return rows;
}

/**
 * One daily run. `io` is injectable; when it is not the production default
 * the shared memory cache is left alone so tests cannot poison later probes.
 */
export async function runExecObservationTraining({
  now = Date.now(),
  io = defaultIo,
  budgetMs = EXEC_TRAIN_BUDGET_MS
} = {}) {
  const started = Date.now();
  const cacheable = io === defaultIo;
  try {
    if (!io?.configured?.()) {
      return { skipped: 'NO_STORE', modelTrained: false, ms: Date.now() - started };
    }
    if (Date.now() - started > budgetMs) {
      return { skipped: 'BUDGET', modelTrained: false, ms: Date.now() - started };
    }
    const rows = await readObservationWindow({ now, io });
    const model = buildExecObservationModel(rows, { now });
    const written = await io.set(EXEC_MODEL_STORE_KEY, model, MODEL_TTL_MS);
    if (written === false) {
      return { skipped: 'WRITE_FAILED', modelTrained: false, records: model.records, ms: Date.now() - started };
    }
    const snapshot = { model, at: Date.now() };
    if (cacheable) setCached(EXEC_OBS_CACHE_KEY, snapshot, CACHE_TTL_MS);
    return {
      ok: true,
      modelTrained: model.modelTrained,
      records: model.records,
      reason: model.reason,
      routes: model.routes.length,
      ms: Date.now() - started
    };
  } catch (e) {
    console.warn('[exec-observation] training failed:', e?.message);
    return {
      skipped: 'ERROR',
      error: String(e?.message || e).slice(0, 160),
      modelTrained: false,
      ms: Date.now() - started
    };
  }
}

let inflight = null;

export async function getExecServingParams({ force = false, io = defaultIo } = {}) {
  const cacheable = io === defaultIo;
  if (cacheable && !force) {
    const hit = getCached(EXEC_OBS_CACHE_KEY);
    if (hit) return hit.value;
  }
  if (cacheable && inflight && !force) return inflight;
  const load = (async () => {
    let snapshot;
    try {
      const stored = io?.configured?.() ? await io.get(EXEC_MODEL_STORE_KEY) : null;
      const model = stored && stored.schema === EXEC_MODEL_SCHEMA
        ? sanitizeExecModel(stored)
        : emptyExecModel({ reason: io?.configured?.() ? 'NOT_ENOUGH_DATA' : 'NO_STORE' });
      snapshot = { model, at: Date.now() };
    } catch {
      snapshot = { model: emptyExecModel({ reason: 'ERROR' }), at: Date.now() };
    }
    if (cacheable) setCached(EXEC_OBS_CACHE_KEY, snapshot, CACHE_TTL_MS);
    return snapshot;
  })();
  if (cacheable) {
    inflight = load;
    try {
      return await load;
    } finally {
      inflight = null;
    }
  }
  return load;
}

export function warmExecParamsCache() {
  return getExecServingParams({ force: true });
}

export function execServingSnapshot() {
  return getCached(EXEC_OBS_CACHE_KEY)?.value ?? null;
}

export function execServingResponse(snapshot = execServingSnapshot()) {
  const model = snapshot?.model ?? emptyExecModel({ reason: 'NO_STORE' });
  return {
    schema: EXEC_MODEL_SCHEMA,
    modelTrained: Boolean(model.modelTrained),
    trainedAt: model.trainedAt ?? null,
    model
  };
}

/** Tests only: drop the shared snapshot so later HTTP probes stay honest. */
export function clearExecServingCache() {
  memoryStore.delete(EXEC_OBS_CACHE_KEY);
}
