/**
 * THORCHAIN — client side.
 * ---------------------------------------------------------------------------
 * Thin, like lib/bridge.js and lib/yields.js. The affiliate address and the
 * per-chain memo logic live in `server/thorchain.js` and must stay there: if
 * the affiliate were attached in the browser, anyone could edit it and
 * redirect our commission.
 *
 * ─── WHAT THIS OFFERS THAT THE BRIDGE DOES NOT ──────────────────────────────
 * LI.FI moves TOKENS between EVM chains. THORChain settles NATIVE assets —
 * real Bitcoin, real Litecoin, real Dogecoin — on their own chains. A user
 * holding actual BTC has, until now, been unable to do anything at all in
 * this app.
 */

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE) || '/api';

async function getJson(path, { timeout = 20000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      signal: ctrl.signal,
      headers: { accept: 'application/json' }
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      /* Surface the server's own error CODE rather than an HTTP number, so
         the UI can translate it instead of showing "400" to a user. */
      throw new Error(body?.error || `HTTP ${res.status}`);
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

/** Tradeable pools, deepest first. Halted chains are already filtered out. */
export const getThorPools = () => getJson('/thor/pools');

/** Is the integration configured, and which chains currently pay us? */
export const getThorStatus = () => getJson('/thor/status');

/**
 * A quote.
 *
 * `amount` is in the source asset's BASE UNITS as a decimal STRING — 1e8 for
 * BTC, 1e18 for ETH. Passed as a string all the way down because a JS number
 * loses precision above 2^53, which on an 8-decimal chain is only about 90
 * million units. Formatting it as a float here would silently corrupt large
 * amounts.
 */
export function getThorQuote({ from, to, amount, destination, streaming = false }) {
  const qs = new URLSearchParams({ from, to, amount: String(amount) });
  if (destination) qs.set('destination', destination);
  if (streaming) qs.set('streaming', '1');
  return getJson(`/thor/quote?${qs.toString()}`);
}

/**
 * `BTC.BTC` -> `BTC`; `ETH.USDC-0X…` -> `USDC`.
 *
 * The long form carries the contract address so two tokens with the same
 * ticker cannot be confused — which is why the full identifier, not this
 * label, is what gets sent to the server.
 */
export function assetLabel(asset) {
  const raw = String(asset ?? '');
  const right = raw.split('.')[1] ?? raw;
  return right.split('-')[0] || raw;
}

/** `BTC.BTC` -> `BTC`. */
export const assetChain = (asset) => String(asset ?? '').split('.')[0];

/**
 * Base units -> a human amount.
 *
 * THORChain quotes EVERYTHING in 1e8 regardless of the asset's own decimals —
 * a detail that is easy to miss and produces answers wrong by ten orders of
 * magnitude when it is. Their docs call this "the 1e8 convention".
 */
export const fromThorUnits = (v) => Number(v ?? 0) / 1e8;

/** A human amount -> the 1e8 base units their API expects. */
export function toThorUnits(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  /* Rounded, not truncated toward zero: `Math.round` avoids an off-by-one
     that would make a "max" button quote slightly less than the balance. */
  return String(Math.round(n * 1e8));
}
