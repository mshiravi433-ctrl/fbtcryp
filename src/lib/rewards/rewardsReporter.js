/**
 * FBT REWARDS — event reporter (device → engine).
 * ---------------------------------------------------------------------------
 * The single funnel through which REAL activity reaches the rewards engine.
 * The store calls `reportActivity(...)` after every local award; the reporter
 *
 *   · builds the event envelope — canonical action, wallet identity (EVM or
 *     Solana, from the app's existing wallet layer), chain, txHash when the
 *     activity produced one, and the referral code that brought this device
 *   · persists a small retry queue (localStorage, capped) so a lost network
 *     never loses a real swap
 *   · flushes on a short debounce, on visibility/online, and applies engine
 *     responses: mission bonuses land in the local ledger exactly once.
 *
 * The queue holds fingerprints only (ids + payloads ≤ 30 items) — no balance,
 * no keys, nothing a wallet would call sensitive.
 */
import { reportRewardEvents } from './rewardsApi.js';
import { referredBy } from '../referral.js';
import { solanaAddress } from '../solanaWallet.js';

const QUEUE_KEY = 'fbt-rewards-queue-v1';
const QUEUE_CAP = 30;
const MAX_AGE_MS = 48 * 3600_000;

/* ----------------------------- identity ---------------------------------- */

let identity = { evm: null, chainId: null, solana: null };

/** Set from the wallet layer whenever the connected EVM account changes. */
export function bindRewardsIdentity({ evm = null, chainId = null, solana = null } = {}) {
  identity = {
    evm: evm || identity.evm,
    chainId: chainId != null ? Number(chainId) : identity.chainId,
    solana: solana || identity.solana
  };
}

/* Follow the Solana connection made from the Wallet page (same lightweight
   event the Solana swap listens to — the wallet layer is not React state). */
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('solana:wallet-change', (event) => {
    bindRewardsIdentity({ solana: event?.detail?.address || solanaAddress() || null });
  });
}

export function rewardsIdentity() {
  return { ...identity };
}

/* ------------------------------ queue ------------------------------------- */

function readQueue() {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((e) => Date.now() - (e?.at || 0) < MAX_AGE_MS) : [];
  } catch {
    return [];
  }
}

function writeQueue(list) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(list.slice(-QUEUE_CAP)));
  } catch {
    /* private mode — events stay in this session only */
  }
}

const uid = () =>
  `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

let timer = null;
let flushing = false;

/**
 * Report one awarded activity. Called by the store after the LOCAL award, so
 * the UI never waits on the network. Deduplication is the engine's contract:
 * the same (eventId | txHash+chain+wallet) is credited once, forever.
 */
export function reportActivity(action, meta = {}) {
  if (!action || typeof window === 'undefined') return;
  const at = Date.now();
  const network = meta.network || (identity.solana && !identity.evm ? 'solana' : 'evm');
  const wallet =
    network === 'solana'
      ? meta.solana || identity.solana || null
      : meta.wallet || identity.evm || null;
  const chainId = meta.chainId != null ? Number(meta.chainId) : network === 'evm' ? identity.chainId : null;
  /* gasless relay hashes are relay-scoped, not user on-chain txs — sending
     them as evidence would fail wallet verification; the event id still makes
     the activity idempotent. */
  const txHash = meta.gasless === true ? null : meta.txHash || meta.signature || null;
  const eventId =
    typeof meta.rewardId === 'string' && meta.rewardId
      ? meta.rewardId
      : txHash
        ? `${action}-${txHash.slice(0, 24)}`
        : `${action}-${uid()}`;

  const event = {
    id: eventId,
    action,
    at,
    ...(wallet ? { wallet } : {}),
    ...(chainId ? { chainId } : {}),
    ...(txHash ? { txHash } : {}),
    ...(referredBy() ? { refCode: referredBy() } : {})
  };

  const queue = readQueue();
  if (queue.some((e) => e.id === event.id && e.action === event.action)) return;
  queue.push(event);
  writeQueue(queue);
  scheduleFlush();
}

function scheduleFlush() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void flushQueue();
  }, 900);
}

export async function flushQueue() {
  if (flushing) return;
  const queue = readQueue();
  if (queue.length === 0) return;
  flushing = true;
  try {
    const res = await reportRewardEvents(queue.slice(0, 10));
    if (!res.ok) return; // keep the queue; a later flush retries
    const done = new Set();
    for (const row of res.data?.results || []) {
      if (row?.eventId) done.add(row.eventId);
      /* Mission bonuses decided by the engine land exactly once here. */
      for (const bonus of row?.missionBonuses || []) {
        applyMissionBonus(bonus.missionId, bonus.pts);
      }
    }
    const remaining = queue.filter((e) => !done.has(e.id));
    writeQueue(remaining);
  } finally {
    flushing = false;
  }
}

/**
 * The engine's mission bonus is applied locally ONCE per day per mission
 * (mirrors the server's own missionsDone marker). The store registers the
 * handler — the reporter never imports the store (no cycle).
 */
let missionBonusHandler = null;
export function setMissionBonusHandler(fn) {
  missionBonusHandler = fn;
}

function applyMissionBonus(missionId, pts) {
  try {
    if (missionBonusHandler) missionBonusHandler(missionId, pts);
  } catch {
    /* engine unreachable — the next summary sync repairs the total */
  }
}

/* Flush when the app comes back / goes online. */
if (typeof window !== 'undefined') {
  const flushSoon = () => setTimeout(() => void flushQueue(), 400);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') flushSoon();
  });
  window.addEventListener('online', flushSoon);
}

export const rewardsQueueLength = () => readQueue().length;
