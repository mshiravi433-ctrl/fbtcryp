/**
 * Persistent cache backed by Vercel Blob.
 *
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * The in-memory cache in cache.js works fine on a long-running server, but
 * Vercel serverless functions are stateless: every cold start gets an empty
 * Map. Without persistence the "one AI call per coin per day" guarantee
 * collapses into "one AI call per cold start", which on a busy day means
 * paying OpenRouter per *user* instead of per *day*.
 *
 * So AI responses — the only genuinely expensive thing we cache — are also
 * written to Blob storage. Market data stays memory-only: it's free to refetch
 * and changes every 30 seconds, so persisting it would add latency and storage
 * churn for no benefit.
 *
 * Degrades silently: if the token is missing or Blob is unreachable, we fall
 * back to memory-only. A slow cache must never break the endpoint.
 */

const TOKEN = process.env.BLOB_READ_WRITE_TOKEN || '';
const PREFIX = 'ai-cache/';

export const blobConfigured = () => Boolean(TOKEN);

let blobApi = null;

/** Lazy-load so the SDK isn't pulled in when Blob isn't configured. */
async function api() {
  if (!TOKEN) return null;
  if (!blobApi) {
    try {
      blobApi = await import('@vercel/blob');
    } catch {
      return null;
    }
  }
  return blobApi;
}

/** Blob keys must be URL-safe; our cache keys contain ':' and spaces. */
function safeKey(key) {
  return PREFIX + encodeURIComponent(key).replace(/%/g, '_') + '.json';
}

/**
 * Read a cached entry. Returns null on miss, expiry, or any failure —
 * callers treat all three the same way.
 */
export async function blobGet(key) {
  const mod = await api();
  if (!mod) return null;

  try {
    // `head` gives us the URL without downloading; then a plain fetch.
    const meta = await mod.head(safeKey(key), { token: TOKEN }).catch(() => null);
    if (!meta?.url) return null;

    const res = await fetch(meta.url, { cache: 'no-store' });
    if (!res.ok) return null;

    const entry = await res.json();
    if (!entry || typeof entry.expires !== 'number') return null;
    if (Date.now() > entry.expires) return null;

    return entry.value;
  } catch {
    return null;
  }
}

/** Write an entry. Fire-and-forget: never let a cache write fail a request. */
export async function blobSet(key, value, ttlMs) {
  const mod = await api();
  if (!mod) return false;

  try {
    await mod.put(
      safeKey(key),
      JSON.stringify({ value, expires: Date.now() + ttlMs, at: Date.now() }),
      {
        token: TOKEN,
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false,
        allowOverwrite: true,
        // Blob's own retention; generous vs. our logical TTL so we control expiry.
        cacheControlMaxAge: Math.max(60, Math.floor(ttlMs / 1000))
      }
    );
    return true;
  } catch (e) {
    console.warn('[blob] write failed:', e?.message);
    return false;
  }
}

/**
 * Two-tier cache: memory first (free, instant), then Blob (survives cold
 * starts), then generate.
 *
 * `memo` is the Map-based cache from cache.js so a warm function still avoids
 * the network round-trip entirely.
 */
export async function withPersistentCache(key, ttlMs, producer, memo) {
  // 1. hot path — same warm function instance
  const local = memo?.get(key);
  if (local && Date.now() < local.expires) {
    return { value: local.value, cached: true, tier: 'memory' };
  }

  // 2. survives cold starts
  const stored = await blobGet(key);
  if (stored) {
    memo?.set(key, { value: stored, expires: Date.now() + ttlMs, at: Date.now() });
    return { value: stored, cached: true, tier: 'blob' };
  }

  // 3. actually generate — the expensive path we're trying to avoid
  const value = await producer();
  memo?.set(key, { value, expires: Date.now() + ttlMs, at: Date.now() });
  blobSet(key, value, ttlMs).catch(() => {});

  return { value, cached: false, tier: 'generated' };
}
