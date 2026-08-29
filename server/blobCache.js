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
