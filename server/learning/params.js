/**
 * LEARNING CORE — parameter serving (the hot path).
 * ---------------------------------------------------------------------------
 * The verdict engine and autopilot read the published parameters from
 * MEMORY — never from Blob on the request path. The contract, verbatim from
 * the design:
 *
 *   "Fetching from Blob must happen at MOST once per cold start and after
 *    every daily training run; NEVER per request."
 *
 * The backing store IS the in-memory map from server/cache.js (memoryStore)
 * — the same cache the rest of the API hot paths use — with a deliberately
 * long TTL. On a cold instance the first request triggers exactly one
 * single-flight Blob fetch (a burst of cold requests still fetches once) and
 * every later request is served from memory with zero I/O — well under 1 ms.
 * The TTL is effectively "the life of this warm instance": params change once
 * a day, and a long-lived warm instance serving yesterday's params for the
 * rest of its life is fine — the badge shows the trainedAt date, so nothing
 * is misrepresented. After the daily training run, warmParamsCache({ force:
 * true }) reloads the same singleton so the instance that just trained also
 * serves the new params from memory.
 */

import { getCached, memoryStore, setCached } from '../cache.js';
import { readManifest, readParamsFile } from './store.js';
import { sanitizeParams } from './schema.js';

const CACHE_KEY = 'learning.params';
const CACHE_TTL_MS = 30 * 24 * 3600 * 1000; // instance-lifetime; see header

let inflight = null;

/**
 * @param {object} [opts]
 * @param {boolean} [opts.force]  reload from Blob (used by the trainer)
 * @returns {Promise<{params: object|null, manifest: object|null}>}
 */
export async function getServingParams({ force = false } = {}) {
  if (!force) {
    const hit = getCached(CACHE_KEY);
    if (hit) return hit.value;
  }
  if (inflight) return inflight;
  inflight = (async () => {
    let snapshot;
    try {
      const manifest = await readManifest();
      const raw = manifest?.paramsKey ? await readParamsFile(manifest.paramsKey) : null;
      snapshot = {
        params: sanitizeParams(raw),
        manifest,
        at: Date.now()
      };
    } catch {
      // Fail-safe: serve "no model" — callers fall back to hardcoded weights.
      snapshot = { params: null, manifest: null, at: Date.now() };
    } finally {
      inflight = null;
    }
    setCached(CACHE_KEY, snapshot, CACHE_TTL_MS);
    return snapshot;
  })();
  return inflight;
}

/** Reload after a training run so the training instance serves new params. */
export function warmParamsCache() {
  return getServingParams({ force: true });
}

/** The current in-memory snapshot (for diagnostics), without any I/O. */
export function servingSnapshot() {
  return getCached(CACHE_KEY)?.value ?? null;
}

/** Shape handed to the client: model flag + params + manifest. */
export function servingResponse(snapshot = servingSnapshot()) {
  const model = Boolean(snapshot?.params && !snapshot?.manifest?.fallbackHardcoded);
  return {
    model,
    params: snapshot?.params ?? null,
    manifest: snapshot?.manifest ?? null
  };
}

/** Exposed for tests/diagnostics. */
export const _memory = memoryStore;
