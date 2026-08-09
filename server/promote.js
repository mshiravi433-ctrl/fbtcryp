/**
 * VERIFY A PROMOTION PAYMENT, ON-CHAIN, WITH NO API KEY AND NO CUSTODY.
 * ---------------------------------------------------------------------------
 *
 * ─── WHY WE VERIFY INSTEAD OF TRUSTING THE CLIENT ───────────────────────────
 * The browser tells us "I paid, here is the hash". If we believed that, anyone
 * could post any 66-character string and get a free promotion. So the server
 * fetches the transaction receipt itself and checks four things:
 *
 *   1. the transaction succeeded (status 1)
 *   2. it contains an ERC-20 Transfer log for the expected stablecoin
 *   3. the recipient is OUR payout address
 *   4. the amount is at least the price
 *
 * Only then is the listing promoted. Everything below is a READ of public
 * chain data — no key, no account, no cost.
 *
 * ─── WHY NOT ALCHEMY, WHICH WE ALREADY HAVE A KEY FOR ───────────────────────
 * Because it is not needed. `eth_getTransactionReceipt` is served by every
 * public RPC endpoint, and the ones already listed in src/lib/chains.js are
 * enough. Spending the Alchemy quota on this would couple a revenue feature to
 * a key that has been rotated once already.
 *
 * ─── WHY BASE, AND WHY USDC ─────────────────────────────────────────────────
 * The user pays gas on top of the $25. On Ethereum that could be several
 * dollars; on Base it is cents. USDC on Base is also the pair our own swap
 * screen can produce, so somebody without it can get it in-app — and we earn
 * 70 bps when they do.
 *
 * ─── THE REPLAY PROBLEM, WHICH IS THE EASY ONE TO MISS ──────────────────────
 * A valid payment hash stays valid forever. Without a check, one $25 payment
 * could promote a listing every month, or be handed to a friend. server/board.js
 * records `paidTx` on the promoted row and `txAlreadyUsed()` is consulted
 * BEFORE promoting, so each hash buys exactly one promotion.
 *
 * We also require the payment to come FROM the wallet that owns the listing.
 * Otherwise anybody could watch the chain for a large USDC transfer to our
 * address and claim someone else's payment as their own.
 */

/** Base mainnet. Cheap, and where our swap screen can already source USDC. */
import { TIERS } from './board.js';

export const PROMO_CHAIN_ID = 8453;
export const PROMO_CHAIN_NAME = 'Base';

/** Canonical USDC on Base — 6 decimals. */
export const PROMO_TOKEN = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
export const PROMO_TOKEN_SYMBOL = 'USDC';
const TOKEN_DECIMALS = 6;

/**
 * The CHEAPEST tier's price, which is the floor a payment must clear to count
 * for anything. The exact tier is decided from the amount actually received —
 * see tierForAmount in board.js — so this is a minimum, not a price.
 *
 * Imported rather than repeated: a duplicated price list is how the screen
 * advertises $1 and the server silently demands $25.
 */
const MIN_PRICE_USD = Math.min(...TIERS.map((t) => t.usd));
const MIN_UNITS = BigInt(Math.round(MIN_PRICE_USD * 10 ** TOKEN_DECIMALS));

/**
 * Where the money goes. Read from the environment so it can be changed without
 * a code edit, defaulting to the published payout address.
 *
 * This is a RECEIVING address. There is no key here and there must never be.
 */
export const PROMO_RECIPIENT = (
  process.env.PROMO_RECIPIENT ||
  process.env.VITE_PAYOUT_EVM ||
  '0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6'
).trim();

/*
 * Public Base RPCs, tried in order. Two independent providers rather than one:
 * a single free endpoint rate-limiting would otherwise mean "payment failed"
 * for a user who really did pay.
 */
const RPCS = ['https://mainnet.base.org', 'https://base.publicnode.com'];

/** keccak256("Transfer(address,address,uint256)") */
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

const HASH_RE = /^0x[a-fA-F0-9]{64}$/;

/** A 32-byte log topic holds an address in its last 20 bytes. */
const topicToAddress = (topic) => `0x${String(topic).slice(-40)}`.toLowerCase();

const same = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

async function rpc(method, params) {
  let lastError = null;

  for (const url of RPCS) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: ctrl.signal
      }).finally(() => clearTimeout(timer));

      if (!res.ok) {
        lastError = new Error(`HTTP_${res.status}`);
        continue;
      }
      const data = await res.json();
      if (data?.error) {
        lastError = new Error(String(data.error?.message || 'RPC_ERROR'));
        continue;
      }
      return data?.result ?? null;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError ?? new Error('RPC_UNREACHABLE');
}

/**
 * Check that `txHash` is a real, successful payment of at least $25 in USDC
 * from `payer` to our address on Base.
 *
 * @returns {Promise<{ok:boolean, reason?:string, amount?:number}>}
 */
export async function verifyPromotionPayment(txHash, payer) {
  if (!HASH_RE.test(String(txHash || ''))) return { ok: false, reason: 'BAD_HASH' };
  if (!/^0x[a-fA-F0-9]{40}$/.test(String(payer || ''))) return { ok: false, reason: 'BAD_PAYER' };

  let receipt;
  try {
    receipt = await rpc('eth_getTransactionReceipt', [txHash]);
  } catch {
    /*
     * Reported separately from "invalid" on purpose. A user who really paid
     * and hits a flaky RPC must be told to retry, not told their payment was
     * rejected — the second message would cost us a customer and $25 of
     * goodwill over a network blip.
     */
    return { ok: false, reason: 'RPC_UNAVAILABLE' };
  }

  /* Not mined yet, or the hash does not exist on this chain. */
  if (!receipt) return { ok: false, reason: 'NOT_FOUND' };
  if (String(receipt.status).toLowerCase() !== '0x1') return { ok: false, reason: 'TX_FAILED' };

  /*
   * The payer must be the sender. Checked against the receipt's `from` rather
   * than the log's, because that is the account that actually authorised the
   * spend — a Transfer log can be emitted on behalf of someone else.
   */
  if (!same(receipt.from, payer)) return { ok: false, reason: 'WRONG_PAYER' };

  const logs = Array.isArray(receipt.logs) ? receipt.logs : [];

  for (const log of logs) {
    if (!same(log.address, PROMO_TOKEN)) continue;
    if (!Array.isArray(log.topics) || log.topics.length < 3) continue;
    if (!same(log.topics[0], TRANSFER_TOPIC)) continue;
    if (!same(topicToAddress(log.topics[2]), PROMO_RECIPIENT)) continue;

    let value;
    try {
      value = BigInt(log.data);
    } catch {
      continue;
    }
    /*
     * Below the cheapest tier this buys nothing. Reported as its own reason so
     * somebody who underpaid is told they underpaid, rather than being told
     * their transaction was not found.
     */
    if (value < MIN_UNITS) return { ok: false, reason: 'UNDERPAID', amount: Number(value) / 10 ** TOKEN_DECIMALS };

    /*
     * The AMOUNT is what decides the tier, upstream. Deliberately not trusting
     * any tier the client claims: otherwise a $1 payment could ask for 30 days
     * and get it.
     */
    return { ok: true, amount: Number(value) / 10 ** TOKEN_DECIMALS };
  }

  return { ok: false, reason: 'NO_MATCHING_TRANSFER' };
}

/** Everything the client needs to build the payment. All of it public. */
export function promotionTerms() {
  return {
    chainId: PROMO_CHAIN_ID,
    chainName: PROMO_CHAIN_NAME,
    token: PROMO_TOKEN,
    symbol: PROMO_TOKEN_SYMBOL,
    decimals: TOKEN_DECIMALS,
    recipient: PROMO_RECIPIENT,
    /* The whole price list, so the UI can never disagree with the server. */
    tiers: TIERS
  };
}
