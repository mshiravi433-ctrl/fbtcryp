/**
 * CoW Protocol order relay — the server's share of the EVM keeper.
 *
 * ─── THE SERVER HOLDS NO KEY ───────────────────────────────────────────────
 * It never signs anything and never sees a private key. Its job is narrow:
 *
 *   1. Refuse to relay an order whose signature does not recover to the
 *      claimed owner. A hand-built request cannot push an order the user never
 *      signed, and the order book would reject it anyway — this is the cheap
 *      check that happens before our IP is spent on the upstream call.
 *   2. Refuse an order whose appData does not hash to what the order signed,
 *      or whose partner-fee recipient is not our payout address. A mismatch
 *      here would mean an order paying somebody else's fee.
 *   3. Relay to the public order book, and map its answer back to the client
 *      without inventing success.
 *
 * Status reads and fill detection (`checkCowFill`) use the same upstream, and
 * are what lets the watcher send a «filled» notification while the app is
 * closed.
 */
import { keccak256, toUtf8Bytes, verifyTypedData } from 'ethers';
import { PAYOUT_ADDRESSES } from '../src/lib/payout.js';
import {
  COW_ORDER_TYPES,
  COW_CANCEL_TYPES,
  PLATFORM_FEE_BPS,
  cowCancelTypedData,
  cowOrderApiBase,
  cowOrderTypedData,
  cowSupports,
  isCowUid,
  isEvmAddress
} from '../src/lib/cowOrders.js';

const TIMEOUT_MS = Math.max(3000, Number(process.env.UPSTREAM_TIMEOUT_MS || 15000));
const MAX_APP_DATA_CHARS = 4096;
const DIGITS = /^(0|[1-9]\d*)$/;
const HEX_SIG = /^0x[0-9a-fA-F]{130}$/;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;

/** Normalise an upstream status into the four states the app understands. */
export function normaliseCowStatus(raw) {
  const s = String(raw ?? '').toLowerCase();
  if (s === 'fulfilled') return 'fulfilled';
  if (s === 'cancelled' || s === 'canceled') return 'cancelled';
  if (s === 'expired') return 'expired';
  if (s === 'open' || s === 'presignaturepending') return 'open';
  return 'unknown';
}

async function upstream(url, init = {}) {
  try {
    const res = await fetch(url, {
      ...init,
      headers: { accept: 'application/json', ...(init.headers || {}) },
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

/** Shape-check a create request. Returns an error CODE or null. */
function validateCreate(input) {
  if (!input || typeof input !== 'object') return 'BAD_REQUEST';
  const chainId = Number(input.chainId);
  if (!cowSupports(chainId)) return 'UNSUPPORTED_CHAIN';
  if (!isEvmAddress(input.from)) return 'BAD_OWNER';
  if (!HEX_SIG.test(String(input.signature || ''))) return 'BAD_SIGNATURE_FORMAT';
  if (input.signingScheme !== 'eip712') return 'BAD_SIGNING_SCHEME';
  const o = input.order;
  if (!o || typeof o !== 'object') return 'BAD_ORDER';
  if (!isEvmAddress(o.sellToken) || !isEvmAddress(o.buyToken) || !isEvmAddress(o.receiver)) return 'BAD_ADDRESS';
  if (o.sellToken.toLowerCase() === o.buyToken.toLowerCase()) return 'SAME_TOKEN';
  if (!DIGITS.test(String(o.sellAmount)) || BigInt(o.sellAmount) <= 0n) return 'BAD_SELL_AMOUNT';
  if (!DIGITS.test(String(o.buyAmount)) || BigInt(o.buyAmount) <= 0n) return 'BAD_BUY_AMOUNT';
  if (!Number.isInteger(o.validTo) || o.validTo <= 0 || o.validTo > 0xffffffff) return 'BAD_VALID_TO';
  if (o.validTo * 1000 <= Date.now()) return 'ORDER_EXPIRED';
  if (!BYTES32.test(String(o.appData))) return 'BAD_APP_DATA_HASH';
  if (String(o.feeAmount) !== '0') return 'FEE_AMOUNT_MUST_BE_ZERO';
  if (o.kind !== 'sell') return 'ONLY_SELL_ORDERS';
  if (o.partiallyFillable !== false) return 'ONLY_FILL_OR_KILL';
  if (o.sellTokenBalance !== 'erc20' || o.buyTokenBalance !== 'erc20') return 'BAD_TOKEN_BALANCE';
  if (o.receiver.toLowerCase() !== input.from.toLowerCase()) return 'RECEIVER_MUST_BE_OWNER';
  if (typeof input.appData !== 'string' || input.appData.length === 0 || input.appData.length > MAX_APP_DATA_CHARS) {
    return 'BAD_APP_DATA';
  }
  return null;
}

/** The appData must hash to what was signed AND pay our fee address. */
function checkAppData(appDataJson, appDataHash) {
  if (keccak256(toUtf8Bytes(appDataJson)).toLowerCase() !== String(appDataHash).toLowerCase()) {
    return 'APP_DATA_HASH_MISMATCH';
  }
  let doc;
  try { doc = JSON.parse(appDataJson); } catch { return 'APP_DATA_NOT_JSON'; }
  const pf = doc?.metadata?.partnerFee;
  if (!pf || Number(pf.volumeBps) !== PLATFORM_FEE_BPS) return 'PARTNER_FEE_MISSING';
  if (String(pf.recipient || '').toLowerCase() !== PAYOUT_ADDRESSES.evm.toLowerCase()) return 'PARTNER_FEE_RECIPIENT_MISMATCH';
  return null;
}

/**
 * POST /api/orders/cow/create — verify, then relay.
 * @returns {Promise<{status:number, body:object}>}
 */
export async function relayCowCreate(input) {
  const bad = validateCreate(input);
  if (bad) return { status: 400, body: { error: bad } };

  const chainId = Number(input.chainId);
  const appErr = checkAppData(input.appData, input.order.appData);
  if (appErr) return { status: 400, body: { error: appErr } };

  let recovered;
  try {
    const td = cowOrderTypedData(chainId, input.order);
    recovered = verifyTypedData(td.domain, COW_ORDER_TYPES, td.message, input.signature);
  } catch {
    return { status: 400, body: { error: 'BAD_SIGNATURE' } };
  }
  if (recovered.toLowerCase() !== input.from.toLowerCase()) {
    return { status: 400, body: { error: 'SIGNER_MISMATCH' } };
  }

  const base = cowOrderApiBase(chainId);
  const payload = {
    ...input.order,
    from: input.from,
    signature: input.signature,
    signingScheme: 'eip712',
    appData: input.appData,
    appDataHash: input.order.appData
  };
  const r = await upstream(`${base}/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (r.status >= 200 && r.status < 300 && isCowUid(r.body)) {
    return { status: 200, body: { uid: r.body, chainId, feePayoutAddress: PAYOUT_ADDRESSES.evm, feeBps: PLATFORM_FEE_BPS } };
  }
  return {
    status: r.status >= 400 ? r.status : 502,
    body: r.body && typeof r.body === 'object' ? r.body : { error: 'UPSTREAM_REJECTED' }
  };
}

/**
 * GET /api/orders/cow/:chainId/:uid — the order's current state.
 * @returns {Promise<{status:number, body:object}>}
 */
export async function relayCowStatus(chainId, uid) {
  const id = Number(chainId);
  if (!cowSupports(id)) return { status: 400, body: { error: 'UNSUPPORTED_CHAIN' } };
  if (!isCowUid(uid)) return { status: 400, body: { error: 'BAD_ORDER_UID' } };
  const r = await upstream(`${cowOrderApiBase(id)}/orders/${uid}`);
  if (r.status === 404) return { status: 200, body: { uid, state: 'not_found' } };
  if (r.status !== 200 || !r.body || typeof r.body !== 'object') {
    return { status: r.status === 502 ? 502 : 503, body: { error: 'UPSTREAM_UNAVAILABLE' } };
  }
  return {
    status: 200,
    body: {
      uid,
      chainId: id,
      state: normaliseCowStatus(r.body.status),
      rawStatus: String(r.body.status ?? ''),
      validTo: r.body.validTo ?? null,
      executedSellAmount: r.body.executedSellAmount ?? null,
      executedBuyAmount: r.body.executedBuyAmount ?? null
    }
  };
}

/**
 * DELETE /api/orders/cow/cancel — verify the owner's cancellation signature,
 * then ask the order book to cancel. The order book also checks the signature.
 */
export async function relayCowCancel(input) {
  if (!input || typeof input !== 'object') return { status: 400, body: { error: 'BAD_REQUEST' } };
  const chainId = Number(input.chainId);
  if (!cowSupports(chainId)) return { status: 400, body: { error: 'UNSUPPORTED_CHAIN' } };
  if (!isEvmAddress(input.from)) return { status: 400, body: { error: 'BAD_OWNER' } };
  if (!HEX_SIG.test(String(input.signature || ''))) return { status: 400, body: { error: 'BAD_SIGNATURE_FORMAT' } };
  const uids = Array.isArray(input.orderUids) ? input.orderUids : [];
  if (!uids.length || uids.length > 50 || !uids.every(isCowUid)) return { status: 400, body: { error: 'BAD_ORDER_UID' } };

  let recovered;
  try {
    const td = cowCancelTypedData(chainId, uids);
    recovered = verifyTypedData(td.domain, COW_CANCEL_TYPES, td.message, input.signature);
  } catch {
    return { status: 400, body: { error: 'BAD_SIGNATURE' } };
  }
  if (recovered.toLowerCase() !== input.from.toLowerCase()) {
    return { status: 400, body: { error: 'SIGNER_MISMATCH' } };
  }

  const r = await upstream(`${cowOrderApiBase(chainId)}/orders`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ orderUids: uids, signature: input.signature, signingScheme: 'eip712' })
  });
  if (r.status >= 200 && r.status < 300) return { status: 200, body: { cancelled: uids.length, chainId } };
  return {
    status: r.status >= 400 ? r.status : 502,
    body: r.body && typeof r.body === 'object' ? r.body : { error: 'UPSTREAM_REJECTED' }
  };
}

/**
 * The fill check the watcher calls every cycle for a keeper row.
 * Anything unreadable is 'unknown', never 'fulfilled': a flaky upstream must
 * not produce a false «filled» notification.
 */
export async function checkCowFill(chainId, uid) {
  const r = await relayCowStatus(chainId, uid);
  if (r.status !== 200) return 'unknown';
  return r.body.state === 'not_found' ? 'unknown' : r.body.state;
}

/** Re-exported so the route table can document the signed types without a second import. */
export const COW_TYPES = COW_ORDER_TYPES;
