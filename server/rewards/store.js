/**
 * FBT REWARDS — minimal persistence.
 * ---------------------------------------------------------------------------
 * Storage law (spec §3/§16): rewards must never grow into a database of user
 * activity. Everything the engine keeps is:
 *
 *   · ONE aggregated ledger document per account — current total, per-action
 *     counters (ever + last 45 calendar days), a 25-row recent-credit
 *     history, streak state and which missions completed on which day.
 *   · ONE seen-set per account (≤300 fingerprints) for idempotency.
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
 */
import { storeGet, storeSet, storeDurable } from '../store.js';
import { REFERRAL } from './config.js';

export const SCHEMA = 'fbt.rewards.ledger.v1';
export const TABLES = Object.freeze([
  'rewards:v1:ledger:<owner>      — one aggregated ledger per account (bounded)',
  'rewards:v1:seen:<owner>        — idempotency fingerprints, capped at 300',
  'rewards:v1:refcode:<CODE>      — referral code → verified owner wallet',
  'rewards:v1:refattr:<CODE>      — attributed invitee wallets, capped',
  'rewards:v1:refbind:<wallet>    — wallet → its own code (reverse index)',
  'rewards:v1:nonce:<owner>       — single-use claim-nonce hashes, capped'
]);

const LEDGER_HISTORY_CAP = 25;
const SEEN_CAP = 300;
const DAYS_RETAINED = 45;
export const limits = { LEDGER_HISTORY_CAP, SEEN_CAP, DAYS_RETAINED };

export const durable = () => storeDurable();

export const ledgerKey = (owner) => `rewards:v1:ledger:${owner}`;
export const seenKey = (owner) => `rewards:v1:seen:${owner}`;
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

export async function saveLedger(owner, ledger) {
  await storeSet(ledgerKey(owner), ledger);
  return ledger;
}

export async function getSeen(owner) {
  const rows = await storeGet(seenKey(owner), []);
  return Array.isArray(rows) ? rows : [];
}

export async function saveSeen(owner, rows) {
  await storeSet(seenKey(owner), rows);
  return rows;
}

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
  await storeSet(refcodeKey(code), { code, owner, wallet, via, at });
  await storeSet(refbindKey(wallet), { code, owner, at });
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

/* ------------------------------ claim nonces ------------------------------ */

export async function getPendingNonces(owner) {
  const rows = await storeGet(nonceKey(owner), []);
  return Array.isArray(rows) ? rows : [];
}

export async function savePendingNonces(owner, rows) {
  await storeSet(nonceKey(owner), rows);
  return rows;
}

export async function addRefattr(code, wallet, at) {
  const rows = await getRefattr(code);
  if (rows.some((r) => r.wallet === wallet)) return rows;
  rows.push({ wallet, at });
  await storeSet(refattrKey(code), rows.slice(-REFERRAL.maxAttributedPerCode));
  return rows;
}
