import { apiBase } from './apiBase.js';
import { computeBuyAmountRaw, toBaseUnits } from './cowOrders.js';
/**
 * Local Solana swap handoffs.
 *
 * These are NOT price-watched orders. `createOrder` requires an integer
 * chainId, and the server watcher prices CoinGecko ids — a Solana mint has
 * neither. Saving one here only remembers the pair so the swap screen can be
 * opened with it filled in. Nothing in this file claims a fill.
 */
const KEY = 'fbt.solanaOrders.v1';

function readAll() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((row) => row && row.id && row.fromMint && row.toMint) : [];
  } catch {
    return [];
  }
}

function writeAll(rows) {
  localStorage.setItem(KEY, JSON.stringify(rows.slice(0, 40)));
  return rows.slice(0, 40);
}

export function loadSolanaHandoffs() {
  return readAll();
}

export function addSolanaHandoff(input) {
  const amountIn = String(input?.amountIn ?? '').trim();
  const fromMint = String(input?.fromMint || '');
  const toMint = String(input?.toMint || '');
  if (!(Number(amountIn) > 0)) return { error: 'BAD_AMOUNT' };
  if (!fromMint || !toMint || fromMint === toMint) return { error: 'SAME_TOKEN' };
  const order = {
    id: `sol-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    network: 'solana',
    fromMint,
    toMint,
    fromSymbol: String(input.fromSymbol || ''),
    toSymbol: String(input.toSymbol || ''),
    fromIcon: input.fromIcon || null,
    toIcon: input.toIcon || null,
    amountIn,
    side: 'sell',
    createdAt: Date.now(),
    watched: false
  };
  const orders = writeAll([order, ...readAll().filter((row) => row.id !== order.id)]);
  return { order, orders };
}

export function removeSolanaHandoff(id) {
  return writeAll(readAll().filter((row) => row.id !== id));
}

/* ────────────────────────────────────────────────────────────────────────── */
/* KEEPER ORDERS — Jupiter Trigger V1, signed by the user's Solana wallet      */
/* ────────────────────────────────────────────────────────────────────────── */
/*
 * The functions above are the swap handoff: remember a pair, open the swap
 * screen later. The functions below are the automatic kind. The server builds
 * an UNSIGNED open-order transaction, this module asks the user's own wallet to
 * sign it, and the server submits the signed bytes. Funds stay in the user's
 * wallet until the keeper fills the order.
 *
 * Amounts are exact: the human amount and the human rate are converted with the
 * token decimals in BigInt (src/lib/cowOrders.js), never through a float.
 */

const KEEPER_TIMEOUT_MS = 20000;

async function keeperFetch(path, init = {}) {
  const res = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: { accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}) },
    signal: AbortSignal.timeout(KEEPER_TIMEOUT_MS)
  });
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { ok: res.ok, status: res.status, body };
}

/** Explorer link for a Solana transaction signature. */
export function solscanTxUrl(signature) {
  return /^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(String(signature || ''))
    ? `https://solscan.io/tx/${signature}`
    : null;
}

/**
 * The raw amounts for a keeper order, from the human inputs.
 * `minOut` is "how many OUT you receive for 1 IN" — the same meaning as the
 * EVM keeper's targetRate. Returns { error } rather than guessing.
 */
export function solanaKeeperAmounts({ amountIn, inputDecimals, outputDecimals, minOut }) {
  const making = toBaseUnits(amountIn, inputDecimals);
  if (making === null || making <= 0n) return { error: 'BAD_AMOUNT' };
  const taking = computeBuyAmountRaw({
    sellAmountRaw: making.toString(),
    sellDecimals: inputDecimals,
    buyDecimals: outputDecimals,
    targetRate: String(minOut)
  });
  if (taking === null || taking <= 0n) return { error: 'BAD_RATE' };
  return { makingAmount: making.toString(), takingAmount: taking.toString() };
}

/** Sign one base64 transaction with the user's wallet; returns the signed base64. */
async function signWithWallet(base64Tx) {
  const { signSolanaTransaction } = await import('./solanaWallet.js');
  return signSolanaTransaction(base64Tx);
}

/**
 * Place a keeper limit order. Two round trips and one wallet signature:
 * create (unsigned tx) → sign in the wallet → submit (broadcast via Jupiter).
 * @returns {Promise<{ok:true, orderKey:string, signature:string|null, feeBps:number|null, explorerUrl:string|null} | {ok:false, error:string}>}
 */
export async function createSolanaKeeperOrder({
  wallet,
  inputMint,
  outputMint,
  inputDecimals,
  outputDecimals,
  amountIn,
  minOut,
  expiredAt = null
}) {
  const amounts = solanaKeeperAmounts({ amountIn, inputDecimals, outputDecimals, minOut });
  if (amounts.error) return { ok: false, error: amounts.error };
  try {
    const created = await keeperFetch('/solana/orders/create', {
      method: 'POST',
      body: JSON.stringify({ maker: wallet, inputMint, outputMint, ...amounts, expiredAt })
    });
    if (!created.ok || !created.body?.transaction) {
      return { ok: false, error: created.body?.error || 'CREATE_FAILED' };
    }
    const signed = await signWithWallet(created.body.transaction);
    const sent = await keeperFetch('/solana/orders/submit', {
      method: 'POST',
      body: JSON.stringify({ signedTransaction: signed, requestId: created.body.requestId })
    });
    if (!sent.ok) return { ok: false, error: sent.body?.error || 'SUBMIT_FAILED' };
    const orderKey = created.body.order;
    if (!orderKey) return { ok: false, error: 'NO_ORDER_KEY' };
    const signature = sent.body?.signature ?? null;
    return {
      ok: true,
      orderKey,
      signature,
      feeBps: created.body.feeBps ?? null,
      explorerUrl: solscanTxUrl(signature)
    };
  } catch (err) {
    return { ok: false, error: /reject|denied|cancel/i.test(String(err?.message)) ? 'REJECTED' : 'SIGN_FAILED' };
  }
}

/** Cancel an open keeper order: unsigned cancel tx → wallet signs → submit. */
export async function cancelSolanaKeeperOrder({ wallet, orderKey }) {
  try {
    const built = await keeperFetch('/solana/orders/cancel', {
      method: 'POST',
      body: JSON.stringify({ maker: wallet, order: orderKey })
    });
    if (!built.ok || !built.body?.transaction) return { ok: false, error: built.body?.error || 'CANCEL_FAILED' };
    const signed = await signWithWallet(built.body.transaction);
    const sent = await keeperFetch('/solana/orders/submit', {
      method: 'POST',
      body: JSON.stringify({ signedTransaction: signed, requestId: built.body.requestId })
    });
    return sent.ok ? { ok: true } : { ok: false, error: sent.body?.error || 'SUBMIT_FAILED' };
  } catch (err) {
    return { ok: false, error: /reject|denied|cancel/i.test(String(err?.message)) ? 'REJECTED' : 'SIGN_FAILED' };
  }
}

/** The wallet's active keeper orders, as the network reports them. */
export async function fetchOpenSolanaKeeperOrders(wallet) {
  if (!wallet) return { ok: true, orders: [] };
  const r = await keeperFetch(`/solana/orders/open?wallet=${encodeURIComponent(wallet)}`);
  if (!r.ok) return { ok: false, error: r.body?.error || 'UNAVAILABLE', orders: [] };
  return { ok: true, orders: Array.isArray(r.body?.orders) ? r.body.orders : [] };
}
