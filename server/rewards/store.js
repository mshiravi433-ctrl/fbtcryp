/**
 * FBT REWARDS — minimal persistence.
 * ---------------------------------------------------------------------------
 * Storage law (spec §3/§16): rewards must never grow into a database of user
 * activity. Everything the engine keeps is:
 *
 *   · ONE aggregated ledger document per account — current total, per-action
 *     counters (ever + last 45 calendar days), a 25-row recent-credit
 *     history, streak state and which missions completed on which day.
 *   · ONE bounded seen-set per account (≤300 fingerprints) for idempotency.
 *   · referral code → owner registry + attribution list (bounded).
 *   · claim nonce hashes (single-use, short TTL, ≤10).
 *
 * Wallet balances, market prices, portfolio state and transaction history are
 * NEVER stored — they are read from the blockchain / existing APIs, exactly
 * as the rest of the app does.
 *
 * Backed by the existing server/store.js KV (in-process Map + Vercel Blob
 * when BLOB_READ_WRITE_TOKEN is configured). Same durability trade-off as the
 * push subscriptions and goal engine: durable when Blob is configured,
 * per-instance otherwise, reported honestly in every API meta block.
 *
 * ─── WHY THE SEEN-SET MOVED TO A v2 KEY ───────────────────────────────────
 * v1 stored seen fingerprints as a JSON array of `{ k, at }` where `k` was the
 * RAW fingerprint — `tx:8453:0x<64 hex>:0x<40 hex>`, 117 characters. Three
 * hundred of those is ~42 KB of Redis PER ACCOUNT: roughly twenty times the
 * ledger it protects, and by far the largest thing rewards stored. On a 2 GB
 * budget that capped the whole system at ~47 k accounts.
 *
 * v2 stores an 8-byte hash of the fingerprint (see `fingerprintKey` in
 * config.js) in a Redis sorted set, claimed atomically with `ZADD … NX`:
 *
 *   · ~42 KB → ~4.7 KB per account, so the same budget holds ~9× more users.
 *   · idempotency becomes ONE atomic command instead of a read-modify-write,
 *     which is what makes a duplicate impossible rather than merely unlikely.
 *
 * The v1 key is migrated lazily the first time an account ingests an event
 * after this change, and emptied once the new set holds it. Skipping the
 * migration would let an account re-earn points for activity already credited.
 */
import { storeGet, storeGetFresh, storeSet, storeDurable } from '../store.js';
import { REFERRAL, SEEN_CAP, DAYS_RETAINED, LEDGER_HISTORY_CAP, fingerprintKey } from './config.js';
import * as atomic from './atomic.js';

export const SCHEMA = 'fbt.rewards.ledger.v1';
export const TABLES = Object.freeze([
  'rewards:v1:ledger:<owner>      — one aggregated ledger per account (bounded)',
  'rewards:v2:seen:<owner>        — idempotency fingerprints: 8-byte hashes in a capped sorted set',
  'rewards:v1:refcode:<CODE>      — referral code → verified owner wallet',
  'rewards:v1:refattr:<CODE>      — attributed invitee wallets, capped',
  'rewards:v1:refbind:<wallet>    — wallet → its own code (reverse index)',
  'rewards:v1:nonce:<owner>       — single-use claim-nonce hashes, capped',
  'rewards:v2:lock:<owner>        — short-lived ingest lease (Redis only)'
]);

export const limits = { LEDGER_HISTORY_CAP, SEEN_CAP, DAYS_RETAINED };

/**
 * Rewards records are not a cache — a point credited today is redeemed when
 * FBT launches, so they outlive every other key in the store by design.
 */
export const REWARDS_TTL_MS = Number(process.env.REWARDS_STORE_TTL_MS || 365 * 24 * 3600_000);
const SEEN_TTL_SECONDS = Math.max(3600, Math.ceil(REWARDS_TTL_MS / 1000));

export const durable = () => storeDurable();
export const atomicBackend = () => atomic.atomicBackend();

export const ledgerKey = (owner) => `rewards:v1:ledger:${owner}`;
/** v1 — legacy JSON array. Read only to migrate; never written again. */
export const seenKey = (owner) => `rewards:v1:seen:${owner}`;
/** v2 — capped sorted set of 8-byte fingerprint hashes (atomic claims). */
export const seenV2Key = (owner) => `rewards:v2:seen:${owner}`;
export const ledgerLockKey = (owner) => `rewards:v2:lock:${owner}`;
export const refcodeKey = (code) => `rewards:v1:refcode:${code}`;
export const refattrKey = (code) => `rewards:v1:refattr:${code}`;
export const refbindKey = (wallet) => `rewards:v1:refbind:${wallet}`;
export const nonceKey = (owner) => `rewards:v1:nonce:${owner}`;

/** A fresh empty ledger. */
export function emptyLedger(owner) {
  return {
    schema: SCHEMA,
    owner,
    points: 0,
    byAction: {},      // actionId -> { count, points } (ever)
    days: {},          // 'YYYYMMDD' -> { actionId: count }
    firsts: {},        // actionId -> epoch ms of first credit
    history: [],       // recent credits, capped
    missionsDone: {},  // missionId -> dayKey (or 'ever' / 'streak3'...)
    streak: { lastDay: null, count: 0 },
    referrals: 0,      // invitees who qualified through this account's code
    refCode: null,     // code bound to this account (server side)
    created: null,
    updated: null
  };
}

export async function getLedger(owner) {
  const doc = await storeGet(ledgerKey(owner), null);
  return doc || emptyLedger(owner);
}

/**
 * Read the ledger past the warm in-process cache.
 *
 * A lease is worthless if the holder still reads a value this process cached
 * before another instance advanced the record — which is exactly what plain
 * `storeGet` does. The ingest path must use this.
 */
export async function getLedgerFresh(owner) {
  const doc = await storeGetFresh(ledgerKey(owner), null);
  return doc || emptyLedger(owner);
}

export async function saveLedger(owner, ledger, ttlMs = REWARDS_TTL_MS) {
  await storeSet(ledgerKey(owner), ledger, ttlMs);
  return ledger;
}

/* ------------------------------ ingest lease ------------------------------ */

/**
 * Serialise one account's read-modify-write. Redis when configured, an
 * in-process lock otherwise (the guarantee this code always had).
 */
export async function acquireLedgerLease(owner, ttlMs = 20_000) {
  return atomic.acquireLease({ key: ledgerLockKey(owner), ttlMs });
}

export async function releaseLedgerLease(owner, token) {
  return atomic.releaseLease({ key: ledgerLockKey(owner), token });
}

/* --------------------------------- seen ---------------------------------- */

/** v1 — legacy array. Kept for the fallback path and for migration only. */
export async function getSeen(owner) {
  const rows = await storeGet(seenKey(owner), []);
  return Array.isArray(rows) ? rows : [];
}

export async function saveSeen(owner, rows) {
  await storeSet(seenKey(owner), rows, REWARDS_TTL_MS);
  return rows;
}

/**
 * Claim a fingerprint atomically.
 *
 * The three-way return is deliberate and the caller depends on it:
 *
 *   1         — newly claimed; credit the event.
 *   0         — already seen; never credit it again.
 *   null      — the store could not answer. The caller must FAIL CLOSED,
 *               because crediting blind is what inflates a redeemable ledger.
 *   undefined — no atomic backend here (Blob or memory). The caller falls back
 *               to the bounded array, which is the behaviour this code always
 *               had. Distinct from `null`: a missing feature is not an error.
 */
export async function seenAddAtomic(owner, member, at = Date.now()) {
  if (atomic.atomicBackend() !== 'upstash-redis') return undefined;
  await migrateSeenOnce(owner);
  return atomic.claimSeen({
    key: seenV2Key(owner),
    member,
    at,
    cap: SEEN_CAP,
    ttlSeconds: SEEN_TTL_SECONDS
  });
}

/**
 * One-time migration from the v1 array to the v2 sorted set.
 *
 * Guarded by an in-process set so a hot account does not re-read the legacy
 * key on every event, and the guard is only made permanent once the migration
 * actually succeeded — a failed attempt stays retryable.
 */
const migrated = new Set();

async function migrateSeenOnce(owner) {
  if (migrated.has(owner)) return;
  migrated.add(owner);

  let legacy;
  try {
    legacy = await storeGet(seenKey(owner), null);
  } catch {
    migrated.delete(owner);
    return;
  }
  if (!Array.isArray(legacy) || legacy.length === 0) return;

  const entries = legacy
    .map((row) => ({ member: fingerprintKey(String(row?.k ?? '')), at: Number(row?.at) || 0 }))
    .filter((e) => e.member);

  const added = await atomic.claimSeenMany({
    key: seenV2Key(owner),
    entries,
    cap: SEEN_CAP,
    ttlSeconds: SEEN_TTL_SECONDS
  });

  if (added === null) {
    migrated.delete(owner); // store did not answer — let a later event retry
    return;
  }
  /* The v2 set now protects everything v1 did, so the 42 KB can go. */
  await storeSet(seenKey(owner), [], REWARDS_TTL_MS).catch(() => {});
}

/* ------------------------------- pruning --------------------------------- */

/** Prune old day keys so the ledger cannot grow forever. */
export function pruneDays(ledger, todayKey, retain = DAYS_RETAINED) {
  const days = ledger.days || {};
  const keys = Object.keys(days).sort();
  const keep = new Set(keys.slice(-retain));
  if (!keep.has(todayKey)) keep.add(todayKey);
  for (const k of keys) if (!keep.has(k)) delete days[k];
  return ledger;
}

export function pruneSeen(rows, cap = SEEN_CAP) {
  const sorted = [...rows].sort((a, b) => (a.at || 0) - (b.at || 0));
  return sorted.slice(-cap);
}

export function pruneHistory(rows, cap = LEDGER_HISTORY_CAP) {
  return rows.slice(0, cap);
}

export function recordHistory(ledger, entry) {
  ledger.history = pruneHistory([entry, ...(ledger.history || [])]);
  return ledger;
}

export async function addSeen(owner, fingerprint, at) {
  const rows = await getSeen(owner);
  if (rows.some((r) => r.k === fingerprint)) return rows;
  rows.push({ k: fingerprint, at });
  await saveSeen(owner, pruneSeen(rows));
  return rows;
}

/* ---------------------------- referral registry ---------------------------- */

export async function getRefcode(code) {
  const doc = await storeGet(refcodeKey(code), null);
  return doc || null;
}

export async function bindRefcode({ code, owner, wallet, via, at }) {
  await storeSet(refcodeKey(code), { code, owner, wallet, via, at }, REWARDS_TTL_MS);
  await storeSet(refbindKey(wallet), { code, owner, at }, REWARDS_TTL_MS);
  return { code, owner, wallet, via, at };
}

export async function getRefbind(wallet) {
  const doc = await storeGet(refbindKey(wallet), null);
  return doc || null;
}

export async function getRefattr(code) {
  const rows = await storeGet(refattrKey(code), []);
  return Array.isArray(rows) ? rows : [];
}

export async function savePendingNonces(owner, rows) {
  await storeSet(nonceKey(owner), rows, REWARDS_TTL_MS);
  return rows;
}

export async function addRefattr(code, wallet, at) {
  const rows = await getRefattr(code);
  if (rows.some((r) => r.wallet === wallet)) return rows;
  rows.push({ wallet, at });
  await storeSet(refattrKey(code), rows.slice(-REFERRAL.maxAttributedPerCode), REWARDS_TTL_MS);
  return rows;
}

/* ------------------------------ claim nonces ------------------------------ */

export async function getPendingNonces(owner) {
  const rows = await storeGet(nonceKey(owner), []);
  return Array.isArray(rows) ? rows : [];
}
