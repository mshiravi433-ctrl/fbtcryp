/** Tiny TTL cache with single-flight de-duplication. */

const store = new Map();
const inflight = new Map();

/** Exposed so blobCache.js can use the same hot-path map. */
export const memoryStore = store;

export function getCached(key) {
  const hit = store.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) {
    // keep it around as a stale fallback for when upstream is down
    return { ...hit, stale: true };
  }
  return hit;
}

export function setCached(key, value, ttlMs) {
  store.set(key, { value, expires: Date.now() + ttlMs, at: Date.now() });
  return value;
}

/**
 * Returns cached data if fresh; otherwise fetches (deduplicated) and caches.
 * If the fetch fails but we hold stale data, the stale copy is served — a
 * slightly old price beats a 500 on a mobile client.
 */
export async function withCache(key, ttlMs, producer) {
  const hit = getCached(key);
  if (hit && !hit.stale) return { value: hit.value, cached: true, stale: false };

  if (inflight.has(key)) return { value: await inflight.get(key), cached: false, stale: false };

  const p = (async () => producer())();
  inflight.set(key, p);

  try {
    const value = await p;
    setCached(key, value, ttlMs);
    return { value, cached: false, stale: false };
  } catch (err) {
    if (hit) return { value: hit.value, cached: true, stale: true };
    throw err;
  } finally {
    inflight.delete(key);
  }
}

export function cacheStats() {
  return { entries: store.size, inflight: inflight.size };
}
