/**
 * THE AI ANSWER CACHE — the free tier's memory.
 * ============================================================================
 *
 * WHY THIS EXISTS (2026-11-11)
 * ---------------------------------------------------------------------------
 * The deployment's AI fleet is three free tiers: OpenRouter's `:free`
 * catalogue, Groq's free tier and Cloudflare Workers AI's free tier. Two
 * ceilings bind that fleet, and they bind it in opposite directions:
 *
 *   · FLUID ACTIVE CPU — 4 hours per rolling 30 days on Hobby, i.e. about
 *     EIGHT MINUTES OF CPU PER DAY. A `max` turn spends seconds of CPU
 *     (three independent analyses, a verifier, an adversarial repair pass),
 *     so the arithmetic is brutal: at ~480 s of daily budget, a handful of
 *     deep turns is the whole day's allowance.
 *
 *   · THE FREE PROVIDERS' OWN DAILY CAPS — OpenRouter's `:free` tier allows
 *     50 requests/day (1,000 once $10 has been bought on the account). A
 *     single `max` turn can spend THREE of them (three analyses) plus the
 *     verifier and the repair pass. At that rate the daily allowance is
 *     gone in about fifteen questions.
 *
 * So the cache is not an optimisation here — it is the difference between a
 * fleet that works and a fleet that is exhausted before lunch. It cuts BOTH
 * ceilings at once: a hit costs no CPU to produce and no provider quota to
 * spend.
 *
 * ─── WHY THE KEY IS A HASH AND NOT THE QUESTION ─────────────────────────────
 * A question is up to 4 KB of Persian text. Keying a map with it would be
 * fine, but hashing gives two things the raw string cannot: a bounded key
 * length regardless of input size, and a key that cannot leak the user's
 * words into a map someone might later dump. `sha256` is used because the
 * key must be stable across instances and across processes — a cheap
 * non-cryptographic hash would do too, but the map is keyed by material
 * that came from a human, and a 256-bit digest costs nothing measurable.
 *
 * ─── WHY THE KEY IS MORE THAN THE QUESTION ─────────────────────────────────
 * Two questions with the same words are NOT the same turn:
 *
 *   · the LOCALE changes the answer (Persian vs English);
 *   · the INTELLIGENCE MODE changes the answer (swift vs max);
 *   · the CONVERSATION HISTORY changes the answer («what about the second
 *     one?» depends on what was said before);
 *   · the USER's PORTFOLIO changes the answer (a question about "my
 *     positions" is about that user's positions).
 *
 * So the key includes a digest of each of those. A cache that ignored them
 * would serve one user's portfolio-grounded answer to another user, which
 * would be a privacy leak, not just a wrong answer.
 *
 * ─── WHAT IS NEVER CACHED ───────────────────────────────────────────────────
 * Only the MODEL ANSWER is cached, and only when it is safe to reuse:
 *
 *   · a DEGRADED answer (the deterministic rule engine answered because no
 *     provider was reachable) is not cached — it is a fallback, and caching
 *     it would make a transient outage permanent;
 *   · an answer with no answer text is not cached;
 *   · an answer whose sources are all live market data is only cached for a
 *     SHORT time — a price from ten minutes ago is not a price;
 *   · a turn that carried USER-SPECIFIC ground truth (a portfolio, a
 *     wallet, a pending intent) is cached under a key that includes a
 *     digest of that ground truth, never shared across users.
 *
 * ─── WHAT THE CACHE DOES NOT DO ─────────────────────────────────────────────
 * It does not change what the answer says, who produced it, or whether it
 * was verified. A cached answer keeps its `providersUsed`, `modelsConsulted`,
 * `claims`, `verifiedClaims`, `aiConsensusOnly` and `uncertainty` exactly
 * as produced — the cache replays a VERDICT, not a guess, so a client
 * cannot tell a cached answer from a fresh one and cannot be misled by
 * one. The one thing that changes is a `cached` marker, which the panel
 * shows so an operator can see the fleet is being spared.
 *
 * ─── WHY THE STORE IS ITS OWN, AND NOT `cache.js` ───────────────────────────
 * `cache.js` is a general-purpose TTL cache for READ-ONLY upstream data, and
 * it keeps expired entries as a stale fallback. That is right for a price
 * (a slightly old price beats a 500) and WRONG for a model answer: a stale
 * model answer is not "slightly old", it is a different answer, and serving
 * it silently would be dishonest. So this store has its own bounds, its own
 * TTL policy, and no stale-serving behaviour at all.
 */

import { createHash } from 'node:crypto';
import { blobConfigured as durableStoreConfigured } from './blobCache.js';

export const AI_CACHE_SCHEMA = 'fbt.ai-answer-cache.v1';
export const AI_CACHE_VERSION = '1.0.0';

/**
 * TTL by freshness class, in milliseconds.
 *
 * The classes are not "market vs not-market" — they are "how fast does this
 * kind of answer go out of date":
 *
 *   · `STATIC`   — a fact that does not change: how a feature works, what a
 *                  fee means, what the app can do. One day is generous.
 *   · `RECENT`   — a general question whose answer depends on what is
 *                  happening now but not on a price. Fifteen minutes.
 *   · `LIVE`     — a question whose answer IS a price or a market reading.
 *                  Two minutes. After that it is not an answer, it is a
 *                  stale number presented as current.
 *   · `BREAKING` — a question about a just-happened event. One minute.
 *
 * These are deliberately conservative. The cache exists to spare the fleet,
 * not to serve stale prices; a wrong price is worse than a slow answer.
 */
export const AI_CACHE_TTL_MS = Object.freeze({
  STATIC: 24 * 60 * 60 * 1000,
  RECENT: 15 * 60 * 1000,
  LIVE: 2 * 60 * 1000,
  BREAKING: 60 * 1000
});

/**
 * The absolute ceiling on live entries.
 *
 * A serverless instance is short-lived, so this is mostly a guard against a
 * long-lived warm instance accumulating one entry per distinct question.
 * 500 answers × ~4 KB of JSON ≈ 2 MB, which is a rounding error against a
 * 1 GB function's memory — so the ceiling is set for safety, not for size.
 */
const MAX_ENTRIES = Math.max(50, Number(process.env.AI_CACHE_MAX_ENTRIES) || 500);

/** What fraction of the ceiling we evict down to when it is crossed. */
const EVICT_TO = 0.8;

/**
 * The store. One Map, one instance — plus a DURABLE tier behind it.
 *
 * The Map alone is the reason this cache never did anything in
 * production. On Vercel every request is a fresh lambda, so an in-memory
 * Map is empty when the turn starts, and a question asked twice costs
 * two full collaborations — five provider calls each on the `:free`
 * tier, whose whole daily budget is fifty.
 *
 * So the store is now two tiers:
 *
 *   · the Map — fast, and the only tier when no durable backend exists;
 *   · `store.js` — Blob-backed, and therefore SHARED between lambdas.
 *
 * The durable tier is opt-in by configuration, because a cache that
 * silently writes every answer to a metered store has a bill, and a
 * cache that silently does not persist has no value on a serverless
 * deployment. `AI_ANSWER_CACHE_DURABLE=1` turns it on; the default
 * follows the deployment's own durable-store configuration, which is
 * the honest default: a deployment that has a durable store configured
 * wants its cache to be durable too.
 */
const store = new Map();

/** The durable key namespace. It is namespaced so it cannot collide. */
const DURABLE_PREFIX = 'ai-cache/v1/';

/** Is the durable tier on? */
function durableEnabled(env = process.env) {
  const raw = String(env?.AI_ANSWER_CACHE_DURABLE ?? 'auto').trim().toLowerCase();
  if (raw === '0' || raw === 'off' || raw === 'false' || raw === 'no') return false;
  if (raw === '1' || raw === 'on' || raw === 'true' || raw === 'yes') return true;
  /* 'auto': follow the deployment's own durable store. */
  return durableStoreConfigured();
}

/** Read one entry from the durable tier. Never throws. */
async function durableGet(key) {
  if (!durableEnabled()) return null;
  try {
    const { storeGet } = await import('./store.js');
    const row = await storeGet(`${DURABLE_PREFIX}${key}`, null);
    if (!row || typeof row !== 'object') return null;
    if (row.expires && Date.now() > row.expires) return null;
    return row.value ?? null;
  } catch {
    return null;
  }
}

/** Write one entry to the durable tier. Never throws. */
async function durableSet(key, value, ttlMs) {
  if (!durableEnabled()) return false;
  const ttl = Number(ttlMs);
  if (!Number.isFinite(ttl) || ttl <= 0) return false;
  try {
    const { storeSet } = await import('./store.js');
    await storeSet(`${DURABLE_PREFIX}${key}`, { value, expires: Date.now() + ttl }, ttl);
    return true;
  } catch {
    return false;
  }
}

/** In-flight producers, so two identical questions do not both call a model. */
const inflight = new Map();

/** Counters, for the panel. Cheap, and they are the proof the cache works. */
const stats = {
  hits: 0,
  misses: 0,
  stores: 0,
  skipped: 0,
  evicted: 0
};

/**
 * A stable digest of a value, used for the parts of the key that are not the
 * question itself.
 *
 * `undefined` and `null` digest to the same thing, and an empty string
 * digests to the same thing as absent — so "no context" and "empty context"
 * share a cache entry, which is correct: they mean the same thing.
 */
function digest(value) {
  if (value === undefined || value === null) return '';
  const text = typeof value === 'string' ? value : safeStringify(value);
  if (!text) return '';
  return createHash('sha256').update(text).digest('hex').slice(0, 32);
}

/**
 * JSON that cannot throw on a cycle and cannot lose a field to `undefined`.
 *
 * `JSON.stringify` throws on a circular structure, and this function is
 * called on values that came from a request body — a client can send
 * anything. A cache key must never be the thing that crashes a turn.
 */
function safeStringify(value) {
  const seen = new WeakSet();
  try {
    return JSON.stringify(value, (_key, val) => {
      if (typeof val === 'object' && val !== null) {
        if (seen.has(val)) return '[Circular]';
        seen.add(val);
      }
      if (typeof val === 'function') return undefined;
      if (typeof val === 'bigint') return String(val);
      return val;
    });
  } catch {
    return '';
  }
}

/**
 * The cache key for one turn.
 *
 * Everything that can change the answer is in here. The question is hashed
 * in full; the rest are digested because they are usually bigger and often
 * only need to be distinguished, not stored.
 */
export function aiAnswerCacheKey({
  question = '',
  locale = 'fa',
  intelligence = 'balanced',
  conversationId = null,
  priorMessages = null,
  groundTruth = null,
  surface = null,
  intentType = null,
  /*
   * The FLEET that answered the turn.
   *
   * This is part of the key because the fleet determines the answer: the
   * same question asked with a different set of providers — or the same
   * providers with a different candidate ladder — can legitimately produce
   * a different answer. A cache that ignored this would serve one fleet's
   * answer to another.
   *
   * It is also what keeps a test honest: two test cases that ask the SAME
   * question with DIFFERENT mock fleets must not share a cache entry, or
   * the second case would silently assert against the first case's
   * answer. That is not a test-only concern — it is the same property
   * stated in production terms.
   */
  fleet = null
} = {}) {
  const q = String(question || '').trim();
  if (!q) return null;
  const parts = [
    'v1',
    digest(q),
    String(locale || '').slice(0, 8),
    String(intelligence || '').slice(0, 16),
    digest(conversationId),
    digest(priorMessages),
    digest(groundTruth),
    digest(surface),
    digest(intentType),
    digest(fleet)
  ];
  return parts.join('|');
}

/**
 * The TTL for one answer, from the freshness class the collaboration layer
 * already computed.
 *
 * An unknown class gets the CONSERVATIVE ttl (RECENT), never the long one:
 * a new freshness class must not accidentally become a day-long cache.
 */
export function aiAnswerCacheTtlMs(freshness) {
  const cls = String(freshness || '').toUpperCase();
  if (cls === 'STATIC') return AI_CACHE_TTL_MS.STATIC;
  if (cls === 'LIVE') return AI_CACHE_TTL_MS.LIVE;
  if (cls === 'BREAKING') return AI_CACHE_TTL_MS.BREAKING;
  return AI_CACHE_TTL_MS.RECENT;
}

/**
 * Can this answer be cached at all?
 *
 * The rules, and why each one exists:
 *
 *   · `degraded` — the deterministic engine answered because no provider was
 *     reachable. Caching that would turn a transient outage into a
 *     permanent one: every later question would be served the fallback.
 *   · empty answer — nothing to save.
 *   · `uncertainty` with a low confidence — the model itself said it was
 *     unsure. Serving that repeatedly is not helpful, and the `max` mode's
 *     whole point is that a later, deeper turn may do better.
 *   · `freshness: LIVE` — allowed, but only for the short TTL. The price
 *     case is handled by the TTL, not by a refusal.
 */
export function isCacheableAnswer(result, { freshness = null } = {}) {
  if (!result || typeof result !== 'object') return false;
  if (result.degraded === true) return false;
  const answer = typeof result.answer === 'string' ? result.answer.trim() : '';
  if (!answer) return false;
  /* An answer the model flagged as low-confidence is not a fact to replay. */
  const confidence = Number(result.uncertainty?.confidence ?? result.confidence);
  if (Number.isFinite(confidence) && confidence < 0.35) return false;
  const cls = String(freshness || result.freshness || 'RECENT').toUpperCase();
  if (!Object.prototype.hasOwnProperty.call(AI_CACHE_TTL_MS, cls)) return false;
  return true;
}

/**
 * Evict down to the ceiling: expired entries first, then the ones that
 * expire soonest. Called on every write, so it never becomes an expensive
 * sweep — it only does work once the ceiling is crossed.
 */
function boundStore(now) {
  if (store.size <= MAX_ENTRIES) return;
  for (const [key, hit] of store) {
    if (store.size <= MAX_ENTRIES * EVICT_TO) break;
    if (hit.expires <= now) {
      store.delete(key);
      stats.evicted += 1;
    }
  }
  if (store.size <= MAX_ENTRIES) return;
  const order = [...store.entries()].sort((a, b) => a[1].expires - b[1].expires);
  const target = Math.floor(MAX_ENTRIES * EVICT_TO);
  for (const [key] of order) {
    if (store.size <= target) break;
    store.delete(key);
    stats.evicted += 1;
  }
}

/**
 * Read a cached answer.
 *
 * An EXPIRED entry is deleted and reported as a miss — unlike `cache.js`,
 * which keeps expired entries as a stale fallback. A stale model answer is
 * not a slightly old price; it is a different answer, and serving it
 * silently would be dishonest.
 */
export function aiAnswerCacheGet(key) {
  if (!key) return null;
  const hit = store.get(key);
  if (!hit) {
    stats.misses += 1;
    return null;
  }
  if (Date.now() > hit.expires) {
    store.delete(key);
    stats.misses += 1;
    return null;
  }
  stats.hits += 1;
  return hit.value;
}

/** Write an answer into the cache. */
export function aiAnswerCacheSet(key, value, ttlMs) {
  if (!key || !value) return value;
  const ttl = Number(ttlMs);
  if (!Number.isFinite(ttl) || ttl <= 0) return value;
  const now = Date.now();
  store.set(key, { value, expires: now + ttl, at: now });
  stats.stores += 1;
  boundStore(now);
  return value;
}

/**
 * Run a turn through the cache.
 *
 * `producer` is called only on a miss. Two identical questions arriving
 * together do not both call a model: the second awaits the first's promise
 * (single-flight), so the fleet is spared the duplicate too.
 *
 * `opts.freshness` decides the TTL. `opts.enabled = false` turns the whole
 * thing into a pass-through, which is what the operator's kill-switch does.
 */
export async function withAiAnswerCache(key, ttlMs, producer, opts = {}) {
  if (!key || opts.enabled === false) {
    return { value: await producer(), cached: false, stale: false };
  }
  const hit = aiAnswerCacheGet(key);
  if (hit) {
    return { value: { ...hit, cached: true }, cached: true, stale: false };
  }
  /*
   * The DURABLE tier, and this is the line that makes the cache worth
   * having on a serverless deployment.
   *
   * The Map above is empty on a fresh lambda, so without this read the
   * same question asked twice costs two full collaborations — five
   * provider calls each, on a tier whose whole daily budget is fifty.
   * The durable tier is shared between instances, so the second lambda
   * finds the first lambda's answer.
   *
   * The read is best-effort and never throws: a cache that breaks the
   * turn when its backend is unreachable would be worse than no cache.
   */
  if (!opts.skipDurable) {
    const durable = await durableGet(key);
    if (durable) {
      stats.hits += 1;
      /* Warm the local tier too, so the rest of this instance's turns
         find it without another round trip. */
      aiAnswerCacheSet(key, durable, ttlMs || AI_CACHE_TTL_MS.RECENT);
      return { value: { ...durable, cached: true }, cached: true, stale: false };
    }
  }
  if (inflight.has(key)) {
    const value = await inflight.get(key);
    return { value: { ...value, cached: true }, cached: true, stale: false };
  }
  const p = (async () => producer())();
  inflight.set(key, p);
  try {
    const value = await p;
    aiAnswerCacheSet(key, value, ttlMs);
    /* And write it where the next lambda can find it. */
    if (!opts.skipDurable) await durableSet(key, value, ttlMs);
    return { value, cached: false, stale: false };
  } finally {
    inflight.delete(key);
  }
}

/**
 * Write one turn's answer to the durable tier.
 *
 * Kept separate from the read path so the TTL decision — which needs the
 * plan's freshness verdict — lives next to the plan that produced it. It
 * is exported so the collaboration layer can write the answer with the
 * TTL it earned, once the plan is in hand.
 */
export async function aiAnswerCachePersist(key, value, ttlMs) {
  return durableSet(key, value, ttlMs);
}

/**
 * Is the cache switched on?
 *
 * The operator's kill-switch. When it is off, every turn is live — which is
 * the honest behaviour for a diagnostic run, and the reason a "why is my
 * answer not updating?" question has an answer.
 */
export function aiAnswerCacheEnabled(env = process.env) {
  const raw = String(env?.AI_ANSWER_CACHE ?? '1').trim().toLowerCase();
  if (raw === '0' || raw === 'off' || raw === 'false' || raw === 'no') return false;
  return true;
}

/**
 * The cache's own report, for the provider panel and for the CPU report.
 *
 * `hitRate` is the number that matters: it is the fraction of turns the
 * fleet did not have to answer.
 */
export function aiAnswerCacheStats() {
  const total = stats.hits + stats.misses;
  return {
    schema: AI_CACHE_SCHEMA,
    version: AI_CACHE_VERSION,
    enabled: aiAnswerCacheEnabled(),
    entries: store.size,
    inflight: inflight.size,
    hits: stats.hits,
    misses: stats.misses,
    stores: stats.stores,
    skipped: stats.skipped,
    evicted: stats.evicted,
    hitRate: total ? Number((stats.hits / total).toFixed(3)) : 0,
    maxEntries: MAX_ENTRIES,
    ttlMs: { ...AI_CACHE_TTL_MS },
    envVar: 'AI_ANSWER_CACHE'
  };
}

/**
 * Drop every cached answer (never the in-flight map — a probe that clears
 * the cache must not orphan a promise another caller is awaiting). Tests use
 * this between scenarios so one fixture's answer cannot leak into the next;
 * it is also the honest escape hatch for an operator who has just changed a
 * source and wants every turn live again.
 */
export function __clearAiAnswerCacheForTests() {
  store.clear();
  stats.hits = 0;
  stats.misses = 0;
  stats.stores = 0;
  stats.skipped = 0;
  stats.evicted = 0;
}

export default withAiAnswerCache;
