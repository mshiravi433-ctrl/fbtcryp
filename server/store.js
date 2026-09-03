/**
 * Small persistent key-value store for things the API owns rather than
 * proxies: leaderboard scores and push subscriptions.
 *
 * WHY NOT A DATABASE
 * The rest of this API is a stateless cache in front of public market data, so
 * bolting on Postgres would mean a connection pool, migrations and a second
 * deploy target for two collections that hold kilobytes. Instead we use the
 * same Vercel Blob store the AI cache already uses when it is configured, and
 * fall back to an in-process Map when it is not.
 *
 * BE HONEST ABOUT THE TRADE-OFF
 * Without BLOB_READ_WRITE_TOKEN this store is per-instance and disappears on a
 * cold start. That is fine for a preview deploy and NOT fine for production —
 * `storeDurable()` reports which mode we are in, and `/api/leaderboard` passes
 * it through so the client can label the board accurately instead of implying
 * a global ranking that does not exist.
 *
 * Concurrency: read-modify-write on Blob is last-writer-wins. For a
 * leaderboard that is acceptable (a lost point update self-heals on the next
 * write). Do not reuse this for anything where a lost write costs money.
 */

import { blobGet, blobSet, blobConfigured } from './blobCache.js';

const mem = new Map();

export const storeDurable = () => blobConfigured();

const YEAR = 365 * 24 * 3600_000;

export async function storeGet(key, fallback = null) {
  const local = mem.get(key);
  if (local !== undefined) return local;
  if (blobConfigured()) {
    const v = await blobGet(`kv:${key}`);
    if (v !== null && v !== undefined) {
      mem.set(key, v);
      return v;
    }
  }
  return fallback;
}

/**
 * Read through the durable backend even when this warm process has a cached
 * value. Ordinary app preferences can tolerate a warm cache; payment/order
 * state cannot, because a webhook may have advanced the record on another
 * serverless instance. This helper remains a read only — callers that need a
 * compare-and-set transition must also take an Upstash atomic lease.
 */
export async function storeGetFresh(key, fallback = null) {
  if (blobConfigured()) {
    const v = await blobGet(`kv:${key}`);
    if (v !== null && v !== undefined) {
      mem.set(key, v);
      return v;
    }
    return fallback;
  }
  return mem.has(key) ? mem.get(key) : fallback;
}

export async function storeSet(key, value) {
  mem.set(key, value);
  if (blobConfigured()) {
    const persisted = await blobSet(`kv:${key}`, value, YEAR);
    // A configured provider is a durability contract, not a best-effort cache.
    // Propagate a failed REST/Blob write so probes cannot report stored:true
    // merely because credentials were present while the provider was paused,
    // unreachable or rejected them.
    if (!persisted) throw new Error('DURABLE_STORE_WRITE_FAILED');
  }
  return value;
}

/* -------------------------------------------------------------------------- */
/* points were never stored here                                               */
/* -------------------------------------------------------------------------- */
/*
 * `readLeaderboard` and `submitScore` used to live here, backing a public
 * ranking board. The board was replaced by a private per-device points screen
 * (see src/pages/Leaderboard.jsx) and the two routes that called these were
 * deleted from server/app.js.
 *
 * These are removed rather than left exported and unused. An exported writer
 * that accepts a display name plus a score, still wired to durable storage, is
 * one import away from silently resurrecting the collection the product just
 * promised it does not do. Unused code gets re-imported; that is the whole
 * reason the fifty invented leaderboard names were deleted rather than
 * commented out.
 */

/* -------------------------------------------------------------------------- */
/* push subscriptions                                                          */
/* -------------------------------------------------------------------------- */

const PUSH_KEY = 'push:subs:v1';
const MAX_SUBS = 20000;

export async function readSubscriptions() {
  const subs = await storeGet(PUSH_KEY, []);
  return Array.isArray(subs) ? subs : [];
}

export async function addSubscription(subscription, lang = 'fa') {
  if (!subscription?.endpoint) throw new Error('BAD_SUBSCRIPTION');
  const subs = await readSubscriptions();
  if (subs.some((s) => s.endpoint === subscription.endpoint)) return { added: false, total: subs.length };
  if (subs.length >= MAX_SUBS) return { added: false, total: subs.length, full: true };

  subs.push({ ...subscription, lang: String(lang).slice(0, 5), at: Date.now() });
  await storeSet(PUSH_KEY, subs);
  return { added: true, total: subs.length };
}

export async function removeSubscription(endpoint) {
  const subs = await readSubscriptions();
  const next = subs.filter((s) => s.endpoint !== endpoint);
  await storeSet(PUSH_KEY, next);
  return { removed: subs.length - next.length, total: next.length };
}

/* -------------------------------------------------------------------------- */
/* FCM device tokens                                                           */
/*                                                                             */
/* Stored separately from web-push subscriptions because they are a different  */
/* shape and a different transport. A device can legitimately appear in both   */
/* lists (PWA installed AND the APK installed); the shared notification `tag`  */
/* collapses the duplicate in the OS shade rather than showing it twice.       */
/* -------------------------------------------------------------------------- */

const FCM_KEY = 'push:fcm:v1';

export async function readFcmTokens() {
  const rows = await storeGet(FCM_KEY, []);
  return Array.isArray(rows) ? rows : [];
}

export async function addFcmToken(token, lang = 'fa') {
  // FCM registration tokens are long opaque strings; a short value is a bug or
  // an attempt to poison the list, and storing it would waste a send forever.
  if (typeof token !== 'string' || token.length < 40) throw new Error('BAD_TOKEN');
  const rows = await readFcmTokens();
  if (rows.some((r) => r.token === token)) return { added: false, total: rows.length };
  if (rows.length >= MAX_SUBS) return { added: false, total: rows.length, full: true };

  rows.push({ token, lang: String(lang).slice(0, 5), at: Date.now() });
  await storeSet(FCM_KEY, rows);
  return { added: true, total: rows.length };
}

export async function removeFcmToken(token) {
  const rows = await readFcmTokens();
  const next = rows.filter((r) => r.token !== token);
  await storeSet(FCM_KEY, next);
  return { removed: rows.length - next.length, total: next.length };
}
