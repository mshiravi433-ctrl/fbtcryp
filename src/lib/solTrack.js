/**
 * SOLANA TRACKING — the client half of the Smart Wallet's read side.
 * ---------------------------------------------------------------------------
 *   «در کیف پول هوشمند ردیابی sol کیف پول و تراکنش و نهنگ های سولانا را اضافه کن»
 *
 * Two endpoints (server/solanaTrack.js owns both, and the header there explains
 * where every number comes from):
 *
 *   GET /api/solana/track/wallet?address=…&vs=…   one wallet + its last 25 txs
 *   GET /api/solana/track/whales?vs=…             large SOL movements around it
 *
 * ─── WHY THE WATCHED ADDRESS IS STORED HERE AND NOT IN A WALLET ──────────────
 * The Smart Wallet's whole job is to bound what this app may sign. A tracking
 * address is the opposite of a signing key: it is a PUBLIC key the reader wants
 * to watch, and it is often somebody else's (an exchange, a fund, their own
 * hardware wallet that this app never holds). So it lives in its own storage
 * slot, prefilled from the connected Solana wallet when there is one, editable
 * at any time, and never used to sign anything.
 *
 * ─── WHAT "UNAVAILABLE" MEANS ───────────────────────────────────────────────
 * Every reader here returns `{ ok:false, code }` rather than throwing: the panel
 * has a sentence for each code (`RPC_UNAVAILABLE`, `BAD_ADDRESS`,
 * `NO_MOVEMENTS_IN_SAMPLE`), and a screen that shows "no whales" when a node did
 * not answer is a screen that lies about the chain.
 */
import { apiBase } from './apiBase.js';

const STORE_KEY = 'fbt-sol-track:v1';
const WALLET_TTL_MS = 45_000;
const WHALE_TTL_MS = 120_000;
const REQUEST_TIMEOUT_MS = 15_000;

/** Solscan, the explorer every other Solana surface in this app links to. */
export const SOL_EXPLORER = 'https://solscan.io';
export const solTxUrl = (signature) => (signature ? `${SOL_EXPLORER}/tx/${encodeURIComponent(signature)}` : null);
export const solAddressUrl = (address) => (address ? `${SOL_EXPLORER}/account/${encodeURIComponent(address)}` : null);

/** A base-58 public key. The same shape the server accepts — checked here so a
    typo is answered in the field, not after a round trip. */
const PUBKEY_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export function isSolanaAddress(value) {
  return PUBKEY_RE.test(String(value || '').trim());
}

export const shortSolAddress = (value, head = 4, tail = 4) => {
  const s = String(value || '');
  return s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;
};

/* ── the watched address ──────────────────────────────────────────────────── */

export function loadWatchedAddress() {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const address = String(parsed?.address || '').trim();
    return isSolanaAddress(address) ? address : null;
  } catch {
    /* A storage read that throws (private mode, a quota, a corrupt value) must
       not stop the panel from rendering — it just has nothing prefilled. */
    return null;
  }
}

export function saveWatchedAddress(address) {
  const value = String(address || '').trim();
  try {
    if (!isSolanaAddress(value)) {
      window.localStorage.removeItem(STORE_KEY);
      return null;
    }
    window.localStorage.setItem(STORE_KEY, JSON.stringify({ address: value, at: Date.now() }));
    return value;
  } catch {
    return isSolanaAddress(value) ? value : null;
  }
}

/* ── one shared fetch, with the codes the panel prints ────────────────────── */

async function getJson(path, { timeout = REQUEST_TIMEOUT_MS } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${apiBase()}${path}`, {
      signal: ctrl.signal,
      headers: { accept: 'application/json' }
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, code: body?.error || `HTTP_${res.status}` };
    return { ok: true, data: body };
  } catch (err) {
    return { ok: false, code: err?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK' };
  } finally {
    clearTimeout(timer);
  }
}

/*
 * A tiny in-memory TTL cache.
 *
 * The panel is mounted inside a page that also polls prices, and a reader who
 * taps between the three segments should not pay a round trip per tap. The
 * server caches too (60s a wallet, 5min the whales); this layer only stops the
 * SAME screen asking twice inside a minute. Deliberately not persisted: a
 * balance from a previous session printed as current is the one thing a wallet
 * screen must never do.
 */
const cache = new Map();
async function cached(key, ttlMs, load) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await load();
  /* Only a successful read is cached. A failed one is retried on the next tap
     rather than served back for a minute as if it were an answer. */
  if (value?.ok) cache.set(key, { at: Date.now(), value });
  return value;
}

export function invalidateSolTrack() {
  cache.clear();
}

/** One wallet: balance, tokens, its last 25 signatures, and the arithmetic. */
export function getSolanaWalletTrack(address, vs = 'usd') {
  const target = String(address || '').trim();
  if (!isSolanaAddress(target)) return Promise.resolve({ ok: false, code: 'BAD_ADDRESS' });
  return cached(`wallet:${target}:${vs}`, WALLET_TTL_MS, () =>
    getJson(`/solana/track/wallet?address=${encodeURIComponent(target)}&vs=${encodeURIComponent(vs)}`));
}

/** The whale feed: large movements, plus the coverage statement that goes with them. */
export function getSolanaWhales(vs = 'usd') {
  return cached(`whales:${vs}`, WHALE_TTL_MS, () =>
    getJson(`/solana/track/whales?vs=${encodeURIComponent(vs)}`));
}

/* ── formatting ───────────────────────────────────────────────────────────── */

/**
 * SOL amounts read at the size they are, not at a fixed number of decimals.
 *
 * A fixed two decimals would print a whale's 4 200.5 SOL as «4200.50» in a list
 * where every other row is a whole thousand — noise. A fixed ZERO decimals, the
 * tempting alternative, prints 4 200.5 as «4,201»: a rounding that quietly moves
 * half a coin out of somebody's wallet, on the one screen whose whole job is to
 * report what a wallet holds. So the precision follows the magnitude, the floor
 * for a large balance is two decimals (it reads as money), and nothing below
 * that is padded: 0.0413 stays 0.0413, not 0.04.
 *
 * Nine decimals is Solana's own smallest unit; nothing is rounded away below it.
 */
export function fmtSol(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const abs = Math.abs(n);
  const maximumFractionDigits = abs >= 1_000_000 ? 0 : abs >= 1000 ? 2 : abs >= 1 ? 4 : abs >= 0.01 ? 6 : 9;
  const minimumFractionDigits = abs >= 1000 ? 2 : 0;
  return n.toLocaleString('en-US', { minimumFractionDigits, maximumFractionDigits });
}

/** A money amount in the reader's own currency, or null — never a fake zero. */
export function fmtMoney(value, { maximumFractionDigits = 2 } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n.toLocaleString('en-US', { maximumFractionDigits, minimumFractionDigits: n >= 1000 ? 0 : 2 });
}

/** «۳ دقیقه پیش» without a library: the same three steps every live screen here
    uses, and the only one that stays honest past an hour. */
export function agoLabel(atMs, now = Date.now()) {
  const at = Number(atMs);
  if (!Number.isFinite(at) || at <= 0) return null;
  const secs = Math.max(0, Math.round((now - at) / 1000));
  if (secs < 60) return { unit: 'seconds', value: Math.max(1, secs) };
  const mins = Math.round(secs / 60);
  if (mins < 60) return { unit: 'minutes', value: mins };
  const hours = Math.round(mins / 60);
  if (hours < 24) return { unit: 'hours', value: hours };
  return { unit: 'days', value: Math.round(hours / 24) };
}
