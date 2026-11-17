/**
 * FBT INTENT AI — CACHE for the per-phase product-arc runtime probe.
 * ---------------------------------------------------------------------------
 * The probe is asynchronous (it imports the shared intent-ai entry point),
 * while `phaseStatusReport()` is synchronous and is called from sync code
 * across the server.
 *
 * So the probe result is cached, refreshed in the background, and forced
 * fresh by the status routes before they answer. A cold process reports the
 * arcs as "RUNTIME_PROBE_NOT_COMPLETED" — which is the honest state of a
 * process that has not yet exercised anything.
 */

import { probeProductArcPhases } from './intentPhaseRuntimeProbe.js';

const PROBE_TTL_MS = 60_000;

let cache = {
  byPhase: null,
  at: 0,
  refreshing: false,
  live: 0,
  total: 0,
  entryPointLoadable: null
};

/**
 * Force a fresh probe of every product-arc phase.
 * @param {{ now?: number }} [options]
 * @returns {Promise<object>} the probe result
 */
export async function refreshProductArcProbe({ now = Date.now() } = {}) {
  try {
    const result = await probeProductArcPhases({ now });
    cache = {
      byPhase: Object.fromEntries(result.phases.map((row) => [row.phase, row])),
      at: now,
      refreshing: false,
      live: result.live,
      total: result.total,
      entryPointLoadable: result.entryPointLoadable === true
    };
    return result;
  } catch {
    cache = { ...cache, refreshing: false };
    return { phases: [], live: 0, total: 0, entryPointLoadable: false };
  }
}

/**
 * Read the cached probe, refreshing it in the background when stale.
 * @param {{ now?: number }} [options]
 * @returns {{ byPhase: object|null, live: number, total: number, ageMs: number, stale: boolean }}
 */
export function getProductArcProbe({ now = Date.now() } = {}) {
  const ageMs = cache.byPhase ? now - cache.at : Infinity;
  const stale = ageMs > PROBE_TTL_MS;
  if (stale && !cache.refreshing) {
    cache.refreshing = true;
    Promise.resolve()
      .then(() => refreshProductArcProbe({ now: Date.now() }))
      .catch(() => { cache.refreshing = false; });
  }
  return {
    byPhase: cache.byPhase,
    live: cache.live,
    total: cache.total,
    ageMs,
    stale,
    entryPointLoadable: cache.entryPointLoadable
  };
}
