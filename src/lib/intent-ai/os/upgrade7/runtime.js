/**
 * FBT INTENT OS — UPGRADE 7 · Runtime (performance + learning loop)
 * ---------------------------------------------------------------------------
 * Spec §38 (never block the UI thread: async, caching, dedupe, debounce,
 * background), §39 (request de-duplication — the primitive lives in agentMesh,
 * this is the cache around it), §42 (learning metrics, but no unvalidated model
 * change in production).
 */

export const RUNTIME_SCHEMA = 'fbt.upgrade7-runtime.v7';

/* -------------------------------------------------------------------------- */
/*  TTL CACHE (§38)                                                             */
/* -------------------------------------------------------------------------- */

const cache = new Map();
const DEFAULT_TTL = 30_000;
const MAX_ENTRIES = 200;

export function cacheGet(key, { now = Date.now() } = {}) {
  const hit = cache.get(key);
  if (!hit) return { hit: false, value: undefined };
  if (now > hit.expiresAt) { cache.delete(key); return { hit: false, value: undefined, expired: true }; }
  hit.hits += 1;
  return { hit: true, value: hit.value, ageMs: now - hit.storedAt };
}

export function cacheSet(key, value, { ttlMs = DEFAULT_TTL } = {}) {
  if (cache.size >= MAX_ENTRIES) {
    // Cheap LRU-ish eviction: drop the oldest quarter rather than thrash.
    const oldest = [...cache.entries()].sort((a, b) => a[1].storedAt - b[1].storedAt).slice(0, Math.ceil(MAX_ENTRIES / 4));
    for (const [k] of oldest) cache.delete(k);
  }
  cache.set(key, { value, storedAt: Date.now(), expiresAt: Date.now() + ttlMs, hits: 0 });
  return value;
}

export async function cached(key, factory, { ttlMs = DEFAULT_TTL } = {}) {
  const got = cacheGet(key);
  if (got.hit) return got.value;
  const value = await factory();
  cacheSet(key, value, { ttlMs });
  return value;
}

export function cacheStats() {
  let hits = 0;
  for (const v of cache.values()) hits += v.hits;
  return { entries: cache.size, totalHits: hits };
}

export function clearCache() { cache.clear(); }

/* -------------------------------------------------------------------------- */
/*  DEBOUNCE + IDLE SCHEDULING (§38)                                            */
/* -------------------------------------------------------------------------- */

export function debounce(fn, waitMs = 250) {
  let timer = null;
  let lastArgs = null;
  const debounced = (...args) => {
    lastArgs = args;
    if (timer) clearTimeout(timer);
    return new Promise((resolve) => {
      timer = setTimeout(() => { timer = null; resolve(fn(...lastArgs)); }, waitMs);
    });
  };
  debounced.cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
  return debounced;
}

/**
 * Run heavy work off the interaction path. In a browser this yields to
 * requestIdleCallback; in Node (tests) it is a plain microtask-ish timeout.
 * Either way the caller never awaits it, so the UI is never held up.
 */
export function runInBackground(fn, { timeoutMs = 2000 } = {}) {
  const exec = () => { try { const r = fn(); if (r?.catch) r.catch(() => {}); } catch { /* background work never surfaces */ } };
  try {
    if (typeof requestIdleCallback === 'function') { requestIdleCallback(exec, { timeout: timeoutMs }); return; }
  } catch { /* fall through */ }
  setTimeout(exec, 0);
}

/** Bound how long any enrichment may take; on timeout the base answer wins. */
export function withBudget(promise, ms, fallback = null) {
  let timer = null;
  return Promise.race([
    Promise.resolve(promise).catch(() => fallback),
    new Promise((resolve) => { timer = setTimeout(() => resolve(fallback), ms); })
  ]).finally(() => { if (timer) clearTimeout(timer); });
}

/* -------------------------------------------------------------------------- */
/*  §42 LEARNING LOOP — measure, never auto-mutate production                   */
/* -------------------------------------------------------------------------- */

export const METRIC = Object.freeze({
  USER_CORRECTION: 'user_correction',
  REPEATED_QUESTION: 'repeated_question',
  FAILED_INTENT: 'failed_intent',
  SUCCESSFUL_INTENT: 'successful_intent',
  AGENT_FAILURE: 'agent_failure',
  TOOL_FAILURE: 'tool_failure',
  USER_ABANDONMENT: 'user_abandonment'
});

const STORE_KEY = 'fbt.upgrade7.metrics.v1';
let metrics = null;

function loadMetrics() {
  if (metrics) return metrics;
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) { const p = JSON.parse(raw); if (p && Array.isArray(p.events)) { metrics = p; return metrics; } }
    }
  } catch { /* ignore */ }
  metrics = { events: [], counters: {} };
  return metrics;
}

function persistMetrics() {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(STORE_KEY, JSON.stringify(metrics)); } catch { /* ignore */ }
}

export function recordMetric(kind, payload = {}) {
  const m = loadMetrics();
  m.counters[kind] = (m.counters[kind] || 0) + 1;
  m.events.push({ kind, at: Date.now(), ...sanitizeMetric(payload) });
  if (m.events.length > 300) m.events = m.events.slice(-300);
  persistMetrics();
  return m.counters[kind];
}

function sanitizeMetric(payload) {
  // Metrics are diagnostics, not a transcript store — keep them small and dull.
  const out = {};
  for (const [k, v] of Object.entries(payload || {})) {
    if (v == null) continue;
    if (typeof v === 'string') out[k] = v.slice(0, 120);
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
  }
  return out;
}

export function getMetrics() {
  const m = loadMetrics();
  const total = (m.counters[METRIC.SUCCESSFUL_INTENT] || 0) + (m.counters[METRIC.FAILED_INTENT] || 0);
  return {
    counters: { ...m.counters },
    recent: m.events.slice(-30).reverse(),
    successRate: total ? Math.round(((m.counters[METRIC.SUCCESSFUL_INTENT] || 0) / total) * 100) / 100 : null,
    correctionRate: total ? Math.round(((m.counters[METRIC.USER_CORRECTION] || 0) / total) * 100) / 100 : null,
    // The spec's hard line: metrics inform humans; they do not rewrite the
    // production model on their own.
    autoModelUpdateAllowed: false
  };
}

export function clearMetrics() { metrics = { events: [], counters: {} }; persistMetrics(); }

/**
 * §42 — a proposed change is only allowed to ship once it has been validated
 * offline. This returns a recommendation, never an applied mutation.
 */
export function proposeImprovement() {
  const m = getMetrics();
  const proposals = [];
  if ((m.correctionRate ?? 0) > 0.2) proposals.push({ area: 'intent_understanding', reason: 'correction rate above 20%', requiresValidation: true });
  if ((m.counters[METRIC.REPEATED_QUESTION] || 0) > 5) proposals.push({ area: 'slot_inference', reason: 'questions repeated more than 5 times', requiresValidation: true });
  if ((m.counters[METRIC.AGENT_FAILURE] || 0) > 5) proposals.push({ area: 'agent_health', reason: 'repeated agent failures', requiresValidation: true });
  if ((m.counters[METRIC.TOOL_FAILURE] || 0) > 5) proposals.push({ area: 'tool_fallback', reason: 'repeated tool failures', requiresValidation: true });
  return { proposals, applied: false, note: 'Validation required before any production model change.' };
}
