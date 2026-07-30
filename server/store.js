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

export async function storeSet(key, value) {
  mem.set(key, value);
  if (blobConfigured()) await blobSet(`kv:${key}`, value, YEAR);
  return value;
}

/* -------------------------------------------------------------------------- */
/* leaderboard                                                                 */
/* -------------------------------------------------------------------------- */

const LB_KEY = 'leaderboard:v1';
const MAX_ROWS = 500;

/** Trim a display name to something safe to render in someone else's client. */
function safeName(name, fallbackId) {
  const clean = String(name ?? '')
    .replace(/[\u0000-\u001f<>"'`\\]/g, '')
    .trim()
    .slice(0, 24);
  return clean || `trader${String(fallbackId).slice(-4)}`;
}

export async function readLeaderboard() {
  const rows = await storeGet(LB_KEY, []);
  return Array.isArray(rows) ? rows : [];
}

/**
 * Record a user's score.
 *
 * Identity comes from the verified Telegram user id when present. An anonymous
 * client id is accepted too, but those rows are flagged so the client can show
 * the board without pretending an unauthenticated score is verified — anyone
 * can POST a number, and a leaderboard that hides that is just a lie with a
 * ranking on it.
 */
export async function submitScore({ id, name, points, swaps = 0, referrals = 0, verified = false }) {
  if (!id) throw new Error('NO_ID');
  const pts = Math.max(0, Math.min(10_000_000, Math.round(Number(points) || 0)));

  const rows = await readLeaderboard();
  const idx = rows.findIndex((r) => r.id === id);
  const row = {
    id,
    name: safeName(name, id),
    points: pts,
    swaps: Math.max(0, Math.round(Number(swaps) || 0)),
    referrals: Math.max(0, Math.round(Number(referrals) || 0)),
    verified: Boolean(verified),
    at: Date.now()
  };

  if (idx >= 0) {
    // Points only ever go up; a client replaying an old payload must not
    // rewind someone's rank.
    row.points = Math.max(rows[idx].points ?? 0, pts);
    rows[idx] = row;
  } else {
    rows.push(row);
  }

  rows.sort((a, b) => b.points - a.points);
  const trimmed = rows.slice(0, MAX_ROWS);
  await storeSet(LB_KEY, trimmed);

  return {
    rank: trimmed.findIndex((r) => r.id === id) + 1 || null,
    total: trimmed.length
  };
}

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
