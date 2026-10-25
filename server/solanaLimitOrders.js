/**
 * Solana limit orders through Jupiter's Trigger V1 API — the server's share.
 *
 * ─── WHY V1, AND WHAT THAT COSTS ────────────────────────────────────────────
 * Trigger V1 builds an UNSIGNED transaction that opens an on-chain order
 * account owned by the user's own wallet. The user signs it there, the server
 * submits the signed bytes through Jupiter's /execute, and the keeper fills
 * the order on-chain later. No custody, no vault, no key on our side.
 *
 * Trigger V2 is not used: it keeps the funds in a Privy-custodied vault and
 * authenticates with a JWT challenge, which this app's non-custodial rule
 * forbids. The cost of choosing V1 is that Jupiter describes it as no longer
 * actively maintained and receives critical fixes only. That is recorded in
 * docs/2026-10-25-orders-phase2-keeper-fa.md and must be re-checked before
 * each release.
 *
 * ─── THE PLATFORM FEE, AND WHEN IT IS REAL ──────────────────────────────────
 * Jupiter takes a fee only when a referral token account is supplied as
 * `feeAccount`. That account must be created through Jupiter's referral
 * programme and be owned by our payout address. It is read from
 * JUP_TRIGGER_FEE_ACCOUNT. Until it is set, orders are created WITHOUT a fee
 * and the response says so (`feeBps: null`), so nothing claims a fee that is
 * not being taken.
 */
import { PAYOUT_ADDRESSES } from '../src/lib/payout.js';
import { PLATFORM_FEE_BPS } from '../src/lib/cowOrders.js';

const JUP = 'https://api.jup.ag/trigger/v1';
const TIMEOUT_MS = Math.max(3000, Number(process.env.UPSTREAM_TIMEOUT_MS || 15000));
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const DIGITS = /^[1-9]\d*$/;
const BASE64 = /^[A-Za-z0-9+/=]{16,}$/;
const MAX_ORDERS_PER_LIST = 3;

const apiKey = () => String(process.env.JUPITER_API_KEY || '').trim();
const feeAccount = () => {
  const acct = String(process.env.JUP_TRIGGER_FEE_ACCOUNT || '').trim();
  return B58.test(acct) ? acct : null;
};

/** True when the server can talk to Trigger V1 at all. Never reveals the key. */
export function solanaLimitConfigured() {
  return apiKey().length > 0;
}

/** Whether a platform fee is being taken on new orders, and where it goes. */
export function solanaLimitFeeStatus() {
  const acct = feeAccount();
  return {
    feeBps: acct ? PLATFORM_FEE_BPS : null,
    feeAccountConfigured: Boolean(acct),
    payoutOwner: PAYOUT_ADDRESSES.solana
  };
}

async function jup(path, init = {}) {
  if (!solanaLimitConfigured()) return { status: 503, body: { error: 'NOT_CONFIGURED' } };
  try {
    const res = await fetch(`${JUP}${path}`, {
      ...init,
      headers: {
        accept: 'application/json',
        'x-api-key': apiKey(),
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(init.headers || {})
      },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text || null; }
    return { status: res.status, body };
  } catch {
    return { status: 502, body: { error: 'UPSTREAM_FAILED' } };
  }
}

/** Normalise Jupiter's status words into the states the app understands. */
export function normaliseSolanaStatus(raw) {
  const s = String(raw ?? '').toLowerCase();
  if (/fill|complete|execut/.test(s)) return 'fulfilled';
  if (/cancel/.test(s)) return 'cancelled';
  if (/expir/.test(s)) return 'expired';
  if (/open|active|pending/.test(s)) return 'open';
  return 'unknown';
}

/**
 * POST /api/solana/orders/create — the unsigned open-order transaction.
 * `makingAmount` and `takingAmount` are RAW base units (lamports, micro-USDC…),
 * computed by the client from the human amounts with the token decimals.
 */
export async function createSolanaLimitOrder(input) {
  if (!input || typeof input !== 'object') return { status: 400, body: { error: 'BAD_REQUEST' } };
  const { maker, inputMint, outputMint, makingAmount, takingAmount, expiredAt } = input;
  if (!B58.test(String(maker))) return { status: 400, body: { error: 'BAD_MAKER' } };
  if (!B58.test(String(inputMint)) || !B58.test(String(outputMint))) return { status: 400, body: { error: 'BAD_MINT' } };
  if (inputMint === outputMint) return { status: 400, body: { error: 'SAME_TOKEN' } };
  if (!DIGITS.test(String(makingAmount))) return { status: 400, body: { error: 'BAD_MAKING_AMOUNT' } };
  if (!DIGITS.test(String(takingAmount))) return { status: 400, body: { error: 'BAD_TAKING_AMOUNT' } };
  let expires = null;
  if (expiredAt != null) {
    const n = Number(expiredAt);
    if (!Number.isInteger(n) || n * 1000 <= Date.now()) return { status: 400, body: { error: 'ORDER_EXPIRED' } };
    expires = n;
  }

  const fee = feeAccount();
  const params = {
    makingAmount: String(makingAmount),
    takingAmount: String(takingAmount),
    ...(expires ? { expiredAt: expires } : {}),
    ...(fee ? { feeBps: String(PLATFORM_FEE_BPS) } : {})
  };
  const r = await jup('/createOrder', {
    method: 'POST',
    body: JSON.stringify({
      inputMint,
      outputMint,
      maker,
      payer: maker,
      params,
      computeUnitPrice: 'auto',
      ...(fee ? { feeAccount: fee } : {})
    })
  });
  if (r.status !== 200 || !r.body?.transaction || !r.body?.requestId) {
    return { status: r.status >= 400 ? r.status : 502, body: r.body && typeof r.body === 'object' ? r.body : { error: 'UPSTREAM_REJECTED' } };
  }
  return {
    status: 200,
    body: {
      requestId: r.body.requestId,
      transaction: r.body.transaction,
      order: r.body.order ?? null,
      ...solanaLimitFeeStatus()
    }
  };
}

/** POST /api/solana/orders/submit — broadcast a wallet-signed transaction via Jupiter. */
export async function submitSolanaTrigger({ signedTransaction, requestId }) {
  if (!BASE64.test(String(signedTransaction || ''))) return { status: 400, body: { error: 'BAD_SIGNED_TRANSACTION' } };
  if (!/^[A-Za-z0-9-]{8,80}$/.test(String(requestId || ''))) return { status: 400, body: { error: 'BAD_REQUEST_ID' } };
  const r = await jup('/execute', {
    method: 'POST',
    body: JSON.stringify({ signedTransaction, requestId })
  });
  if (r.status !== 200) {
    return { status: r.status >= 400 ? r.status : 502, body: r.body && typeof r.body === 'object' ? r.body : { error: 'UPSTREAM_REJECTED' } };
  }
  return { status: 200, body: r.body };
}

/** POST /api/solana/orders/cancel — the unsigned cancel transaction for one order. */
export async function cancelSolanaLimitOrder({ maker, order }) {
  if (!B58.test(String(maker))) return { status: 400, body: { error: 'BAD_MAKER' } };
  if (!B58.test(String(order))) return { status: 400, body: { error: 'BAD_ORDER_KEY' } };
  const r = await jup('/cancelOrder', {
    method: 'POST',
    body: JSON.stringify({ maker, order, computeUnitPrice: 'auto' })
  });
  if (r.status !== 200 || !r.body?.transaction) {
    return { status: r.status >= 400 ? r.status : 502, body: r.body && typeof r.body === 'object' ? r.body : { error: 'UPSTREAM_REJECTED' } };
  }
  return { status: 200, body: { requestId: r.body.requestId, transaction: r.body.transaction } };
}

function mapOrder(o) {
  return {
    orderKey: o.orderKey,
    inputMint: o.inputMint,
    outputMint: o.outputMint,
    makingAmount: o.makingAmount ?? null,
    takingAmount: o.takingAmount ?? null,
    rawMakingAmount: o.rawMakingAmount ?? null,
    rawTakingAmount: o.rawTakingAmount ?? null,
    status: normaliseSolanaStatus(o.status),
    rawStatus: String(o.status ?? ''),
    expiredAt: o.expiredAt ?? null,
    createdAt: o.createdAt ?? null
  };
}

/** GET /api/solana/orders/open?wallet= — the wallet's active trigger orders. */
export async function listSolanaLimitOrders(wallet, status = 'active') {
  if (!B58.test(String(wallet))) return { status: 400, body: { error: 'BAD_WALLET' } };
  const r = await jup(`/getTriggerOrders?user=${encodeURIComponent(wallet)}&orderStatus=${status === 'history' ? 'history' : 'active'}&page=1`);
  if (r.status !== 200) {
    return { status: r.status >= 400 ? r.status : 502, body: r.body && typeof r.body === 'object' ? r.body : { error: 'UPSTREAM_FAILED' } };
  }
  const rows = Array.isArray(r.body?.orders) ? r.body.orders : [];
  return { status: 200, body: { wallet, orders: rows.map(mapOrder) } };
}

/**
 * The fill check for a keeper row. Looks in ACTIVE first (still open is the
 * common answer), then HISTORY. Not finding the order in either is 'unknown'
 * — never 'fulfilled' — so an upstream hiccup cannot produce a false fill.
 */
export async function checkSolanaFill(maker, orderKey) {
  if (!B58.test(String(maker)) || !B58.test(String(orderKey))) return 'unknown';
  for (const status of ['active', 'history']) {
    for (let page = 1; page <= MAX_ORDERS_PER_LIST; page += 1) {
      const r = await jup(`/getTriggerOrders?user=${encodeURIComponent(maker)}&orderStatus=${status}&page=${page}`);
      if (r.status !== 200) return 'unknown';
      const rows = Array.isArray(r.body?.orders) ? r.body.orders : [];
      const hit = rows.find((o) => o.orderKey === orderKey);
      if (hit) {
        const state = normaliseSolanaStatus(hit.status);
        if (state !== 'unknown') return state;
        return 'unknown';
      }
      if (!rows.length || Number(r.body?.totalPages ?? 1) <= page) break;
    }
  }
  return 'unknown';
}
