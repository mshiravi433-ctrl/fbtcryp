/**
 * Tiny TTL cache with single-flight de-duplication.
 *
 * ─── BOUNDED ON PURPOSE (2026-10-28) ─────────────────────────────────────
 * «cpu ارور زده و گفته حجم داره تموم میشه.»
 *
 * This store used to grow forever. `getCached` deliberately keeps expired
 * entries as a stale fallback, but nothing ever removed them, so every token,
 * pool, candle and wallet a visitor looked at stayed in the heap for the life
 * of the process. On the token page — where each contract produced its own
 * key — that is a slow leak whose symptom is exactly the one reported: memory
 * climbing until the instance is killed.
 *
 * The bounds below are deliberately boring: expired entries are dropped as
 * soon as the map grows past the soft limit, and if that is not enough the
 * entries closest to expiry are evicted until the map is back under it. Values
 * are untouched; nothing changes for a caller.
 */

const store = new Map();
const inflight = new Map();

/** Soft ceiling on live cache entries (overridable for ops). */
const MAX_ENTRIES = Math.max(200, Number(process.env.CACHE_MAX_ENTRIES) || 4_000);
/** Evict down to this fraction when the ceiling is crossed. */
const EVICT_TO = 0.8;

/** Exposed so blobCache.js can use the same hot-path map. */
export const memoryStore = store;

/**
 * Drop expired entries first (they only exist as an error fallback, so a
 * bounded grace is enough), then — if the map is still too large — the
 * entries that expire soonest. Called on every write, so it never becomes an
 * expensive sweep: it only does work once the ceiling is crossed.
 */
function boundStore(now) {
  if (store.size <= MAX_ENTRIES) return;
  for (const [key, hit] of store) {
    if (store.size <= MAX_ENTRIES * EVICT_TO) break;
    if (hit.expires < now) store.delete(key);
  }
  if (store.size <= MAX_ENTRIES) return;
  const order = [...store.entries()].sort((a, b) => a[1].expires - b[1].expires);
  const target = Math.floor(MAX_ENTRIES * EVICT_TO);
  for (const [key] of order) {
    if (store.size <= target) break;
    store.delete(key);
  }
}

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
  const now = Date.now();
  store.set(key, { value, expires: now + ttlMs, at: now });
  boundStore(now);
  return value;
}

/**
 * Returns cached data if fresh; otherwise fetches (deduplicated) and caches.
 * If the fetch fails but we hold stale data, the stale copy is served — a
 * slightly old price beats a 500 on a mobile client.
 *
 * `opts.swr` (stale-while-revalidate): when a stale copy exists, return it
 * IMMEDIATELY and refresh in the background instead of making the caller
 * wait out a full upstream rebuild. This is what keeps heavy aggregate
 * endpoints (Smart Money overview) answering in milliseconds on a warm
 * instance instead of re-walking seven chains inline.
 */
export async function withCache(key, ttlMs, producer, opts) {
  const swr = !!(opts && opts.swr === true);
  const hit = getCached(key);
  if (hit && !hit.stale) return { value: hit.value, cached: true, stale: false };

  if (hit && swr) {
    if (!inflight.has(key)) {
      const bg = (async () => producer())();
      inflight.set(key, bg);
      bg.then((v) => setCached(key, v, ttlMs))
        .catch(() => { /* keep serving stale; next request retries */ })
        .finally(() => inflight.delete(key));
    }
    return { value: hit.value, cached: true, stale: true };
  }

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

/**
 * Drop every cached value (never the in-flight map — a probe that clears the
 * cache must not orphan a promise another caller is awaiting). Tests use this
 * between scenarios so one fixture's answer cannot leak into the next; it is
 * also the honest escape hatch for an operator who has just changed a source.
 */
export function __clearCacheForTests() {
  store.clear();
}
