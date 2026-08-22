/**
 * SOLANA SWAP CLIENT — OpenOcean route
 * ---------------------------------------------------------------------------
 * The counterpart to server/solanaOcean.js. See that file for why this route
 * exists at all: Jupiter's fee needs on-chain accounts we cannot afford to
 * create, and its failure mode is silent, so the Solana screen has been
 * earning exactly zero.
 *
 * ─── WHY THERE IS NO KEYLESS FALLBACK HERE ──────────────────────────────────
 * lib/solana.js falls back to Jupiter's public endpoint when our backend is
 * unreachable. That is right for Jupiter — the fallback costs us nothing
 * because the Jupiter path earns nothing either way.
 *
 * It would be WRONG here. Calling OpenOcean straight from the browser means
 * the fee parameters travel in a URL the user can edit, so the "fallback"
 * would be a path where our revenue is optional and forgeable. If our backend
 * is down, the honest answer is that Solana swaps are unavailable, not that
 * they quietly run for free.
 *
 * ─── SIGNING DIFFERS FROM THE JUPITER PATH ──────────────────────────────────
 * Jupiter hands back a transaction and lands it itself via /execute, so we
 * sign only. OpenOcean returns an unsigned transaction and nothing else: WE
 * are responsible for broadcasting. That means `signAndSendTransaction` is the
 * correct wallet call here, and using the Jupiter-style sign-only helper would
 * produce a signed transaction that nobody ever sends.
 */

import { apiBase } from './apiBase';

/** Well-known mints, duplicated from lib/solana.js callers rather than re-derived. */
export const SOL_MINT = 'So11111111111111111111111111111111111111112';

/** Same base58 shape guard used by payout.js and solana.js. */
export function isSolanaAddress(addr) {
  return typeof addr === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr.trim());
}

/**
 * Fetch with a hard deadline.
 *
 * REAL BUG this fixes: the original fetch had NO timeout. On a connection
 * where packets silently vanish (exactly the networks our users are on) the
 * browser can hold a request open for minutes, and the Solana screen spun
 * with no price and no error the whole time. 15s is generous for a quote and
 * short enough that the user gets an actionable message instead of a spinner.
 *
 * Failures that happen at the network layer (timeout, DNS, refused, offline)
 * are tagged `err.network = true` so the UI can say "check your connection /
 * try again" instead of the misleading "no route between these tokens".
 */
async function ofetch(url) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 15000) : null;
  let res;
  try {
    res = await fetch(url, {
      headers: { accept: 'application/json' },
      ...(ctrl ? { signal: ctrl.signal } : {})
    });
  } catch (err) {
    // AbortError = our timeout; TypeError = DNS/refused/offline. Both mean
    // the network path is broken, not that the pair has no route.
    if (err?.name === 'AbortError') {
      const e = new Error('QUOTE_NETWORK');
      e.network = true;
      throw e;
    }
    if (err instanceof TypeError) err.network = true;
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* upstream gateways sometimes answer plain text */
  }
  if (!res.ok) {
    const err = new Error(body?.error || body?.detail || `HTTP ${res.status}`);
    err.status = res.status;
    // A gateway-level failure of OUR backend (404 in a build with no API,
    // 5xx, geo-block) is a connectivity problem, not a verdict on the pair.
    // 401 joins the list now that Solana sits behind OpenOcean's whitelist:
    // the upstream's auth rejection is passed through verbatim, and telling
    // the user "the pair has no route" for it would send them down the wrong
    // path — the caller's provider fallback then decides the real answer.
    if (res.status === 401 || res.status === 403 || res.status === 404 || res.status === 429 || res.status >= 500) {
      err.network = true;
    }
    throw err;
  }
  return body;
}

/**
 * Is the OpenOcean route configured to pay us?
 *
 * Unlike Jupiter's equivalent this is answered by the SERVER, because the
 * payout address and rate live in server env. Asking the bundle would report
 * what the build believed at compile time, which is the class of bug that
 * makes a VITE_ variable look updated when it is not.
 */
export async function oceanStatus() {
  return ofetch(`${apiBase()}/solana/oo/status`);
}

/**
 * Price only. No wallet required, and nothing signable comes back.
 *
 * @param {object} p
 * @param {string} p.inputMint
 * @param {string} p.outputMint
 * @param {string} p.amount        integer base units, as a string
 * @param {number} [p.slippageBps]
 */
export async function getOceanQuote({ inputMint, outputMint, amount, slippageBps }) {
  if (!isSolanaAddress(inputMint) || !isSolanaAddress(outputMint)) throw new Error('BAD_MINT');
  if (inputMint === outputMint) throw new Error('SAME_TOKEN');
  if (!amount || !/^\d+$/.test(String(amount)) || String(amount) === '0') {
    throw new Error('BAD_AMOUNT');
  }

  const params = new URLSearchParams({ inputMint, outputMint, amount: String(amount) });
  if (Number.isFinite(slippageBps)) params.set('slippageBps', String(Math.round(slippageBps)));

  return ofetch(`${apiBase()}/solana/oo/quote?${params}`);
}

/**
 * Build the unsigned transaction the user will sign.
 *
 * Requires `account` — OpenOcean returns only a quote without it, and a
 * missing transaction at signing time reads to the user as a broken button.
 */
export async function getOceanSwap({ inputMint, outputMint, amount, account, slippageBps }) {
  if (!isSolanaAddress(account)) throw new Error('BAD_TAKER');

  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount: String(amount),
    account
  });
  if (Number.isFinite(slippageBps)) params.set('slippageBps', String(Math.round(slippageBps)));

  return ofetch(`${apiBase()}/solana/oo/swap?${params}`);
}

/**
 * What we actually keep, in bps, after OpenOcean's documented 20% cut.
 *
 * Exposed so the disclosure can state the true number rather than implying the
 * whole 0.70% reaches us. Verified on-chain: a 1 SOL swap produced 5,600,000
 * lamports to us and 1,400,000 to OpenOcean out of 7,000,000 total.
 */
export const OCEAN_PROVIDER_CUT = 0.2;
export const netOceanBps = (bps) => Number(bps) * (1 - OCEAN_PROVIDER_CUT);
