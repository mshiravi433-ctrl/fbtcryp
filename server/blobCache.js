/**
 * Persistent cache backed by Upstash Redis REST or Vercel Blob.
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
const UPSTASH_URL = String(process.env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/+$/, '');
const UPSTASH_TOKEN = String(process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();
const PREFIX = 'ai-cache/';
const PROVIDER_TIMEOUT_MS = 6_000;

// Pin credential-bearing requests to Upstash-owned Redis hosts. This rejects
// paths, query strings, localhost and operator typos before fetch().
export const upstashConfigured = () => /^https:\/\/[a-z0-9-]+\.upstash\.io$/i.test(UPSTASH_URL) && UPSTASH_TOKEN.length >= 20;
export const blobConfigured = () => Boolean(TOKEN) || upstashConfigured();

/**
 * Atomically claim a durable key in Redis.  Financial workflows use this for
 * idempotency locks: a Blob overwrite is not a compare-and-set operation and
 * is therefore deliberately not an acceptable fallback for a payment action.
 * The value is JSON so callers never need to handle a credential or a Redis
 * response directly. `true` means this caller acquired the lock.
 */
export async function upstashSetIfAbsent(key, value, ttlMs) {
  if (!upstashConfigured() || typeof key !== 'string' || !key) return false;
  const seconds = Math.max(60, Math.ceil(Number(ttlMs) / 1000));
  const answer = await upstashCommand(['SET', safeKey(key), JSON.stringify(value), 'NX', 'EX', seconds]);
  return answer.ok && answer.result === 'OK';
}

/**
 * Read / replace / remove the value behind an atomic Redis key.
 *
 * These are intentionally separate from blobGet/blobSet. Those helpers store
 * a cache envelope (`{ value, expires }`) and are safe for cache entries;
 * financial idempotency leases need the raw record written by SET NX instead.
 * Only code that already requires `upstashConfigured()` should use this small
 * escape hatch. There is deliberately no Blob fallback: Blob cannot provide a
 * compare-and-set lease and must never become an accidental payment lock.
 */
export async function upstashGetAtomic(key) {
  if (!upstashConfigured() || typeof key !== 'string' || !key) return null;
  const answer = await upstashCommand(['GET', safeKey(key)]);
  if (!answer.ok || typeof answer.result !== 'string') return null;
  try { return JSON.parse(answer.result); } catch { return null; }
}

export async function upstashSetAtomic(key, value, ttlMs) {
  if (!upstashConfigured() || typeof key !== 'string' || !key) return false;
  const seconds = Math.max(60, Math.ceil(Number(ttlMs) / 1000));
  const answer = await upstashCommand(['SET', safeKey(key), JSON.stringify(value), 'EX', seconds]);
  return answer.ok && answer.result === 'OK';
}

/**
 * Release a SET-NX lease only when it is still the exact record acquired by
 * this caller. An unconditional DEL after a lease has expired could otherwise
 * erase a newer worker's lease and admit two money-moving transitions.
 */
export async function upstashReleaseAtomicLease(key, leaseValue) {
  if (!upstashConfigured() || typeof key !== 'string' || !key) return false;
  const script = "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end";
  const answer = await upstashCommand(['EVAL', script, '1', safeKey(key), JSON.stringify(leaseValue)]);
  return answer.ok && Number(answer.result) === 1;
}

/**
 * Atomically increment a fixed-window counter and set its expiry on the first
 * hit. Financial route limiters must use this rather than a warm-process Map:
 * serverless instances do not share memory, whereas the same Upstash instance
 * already required for the workflow's idempotency keys does.
 *
 * `null` means the durable limiter could not be reached. Callers that can move
 * money must fail closed in that case rather than silently becoming unlimited.
 */
export async function upstashIncrementWindow(key, ttlMs) {
  if (!upstashConfigured() || typeof key !== 'string' || !key) return null;
  const seconds = Math.max(1, Math.ceil(Number(ttlMs) / 1000));
  const script = "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]); end; return n";
  const answer = await upstashCommand(['EVAL', script, '1', safeKey(key), String(seconds)]);
  const count = Number(answer.result);
  return answer.ok && Number.isSafeInteger(count) && count >= 1 ? count : null;
}

/** Public, secret-free storage status for activation and diagnostics. */
export function durableBackendStatus() {
  return {
    configured: blobConfigured(),
    vercelBlob: Boolean(TOKEN),
    upstashRedis: upstashConfigured(),
    preferred: upstashConfigured() ? 'upstash-redis' : (TOKEN ? 'vercel-blob' : 'memory'),
    /* Upstash fully suppresses Blob operations when both are configured. This
       prevents a paused/quota-exhausted Blob account from continuing to burn
       Advanced Requests. */
    fallback: null
  };
}

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

/** Run one Redis command over Upstash REST without exposing credentials. */
async function upstashCommand(command) {
  if (!upstashConfigured()) return { ok: false, result: null };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const response = await fetch(UPSTASH_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${UPSTASH_TOKEN}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify(command),
      signal: controller.signal,
      cache: 'no-store'
    });
    if (!response.ok) return { ok: false, result: null };
    const body = await response.json();
    if (body?.error) return { ok: false, result: null };
    return { ok: true, result: body?.result ?? null };
  } catch {
    return { ok: false, result: null };
  } finally {
    clearTimeout(timer);
  }
}

async function upstashGetEntry(path) {
  const answer = await upstashCommand(['GET', path]);
  if (!answer.ok || typeof answer.result !== 'string') return null;
  try { return JSON.parse(answer.result); } catch { return null; }
}

async function upstashSetEntry(path, entry, ttlMs) {
  const seconds = Math.max(60, Math.ceil(Number(ttlMs) / 1000));
  const answer = await upstashCommand(['SET', path, JSON.stringify(entry), 'EX', seconds]);
  return answer.ok && answer.result === 'OK';
}

async function vercelGetEntry(path) {
  const mod = await api();
  if (!mod) return null;
  try {
    // `head` gives us the URL without downloading; then a plain fetch.
    const meta = await mod.head(path, { token: TOKEN }).catch(() => null);
    if (!meta?.url) return null;
    const res = await fetch(meta.url, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function vercelSetEntry(path, entry, ttlMs) {
  const mod = await api();
  if (!mod) return false;
  try {
    await mod.put(path, JSON.stringify(entry), {
      token: TOKEN,
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: Math.max(60, Math.floor(ttlMs / 1000))
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Read a cached entry. Upstash fully replaces Blob when configured. We do not
 * fall through on a Redis miss: doing so would turn every legitimate cache
 * miss into another billable/blocked Blob Advanced Request.
 */
export async function blobGet(key) {
  const path = safeKey(key);
  const entry = upstashConfigured()
    ? await upstashGetEntry(path)
    : await vercelGetEntry(path);
  if (!entry || typeof entry.expires !== 'number' || Date.now() > entry.expires) return null;
  return entry.value;
}

/** Upstash fully suppresses Blob writes when both credentials still exist. */
export async function blobSet(key, value, ttlMs) {
  const path = safeKey(key);
  const entry = { value, expires: Date.now() + ttlMs, at: Date.now() };
  return upstashConfigured()
    ? upstashSetEntry(path, entry, ttlMs)
    : vercelSetEntry(path, entry, ttlMs);
}

/**
 * Two-tier cache: memory first (free, instant), then the configured durable
 * backend (survives cold starts), then generate.
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
    return { value: stored, cached: true, tier: upstashConfigured() ? 'upstash' : 'blob' };
  }

  // 3. actually generate — the expensive path we're trying to avoid
  const value = await producer();
  memo?.set(key, { value, expires: Date.now() + ttlMs, at: Date.now() });
  blobSet(key, value, ttlMs).catch(() => {});

  return { value, cached: false, tier: 'generated' };
}
