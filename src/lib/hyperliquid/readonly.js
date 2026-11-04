/**
 * HYPERLIQUID — READ-ONLY ACCOUNT VIEW (phase 0)
 * ---------------------------------------------------------------------------
 * This module reads a wallet's public account state from Hyperliquid mainnet.
 * It never signs, never sends an /exchange request, and never holds a key.
 * The only input is a public 0x address.
 *
 * Why this is the first thing built: it is the only piece that can run
 * against real mainnet data with zero money at risk, and every later phase
 * (planning, caps, order placement) needs the same account snapshot to decide
 * anything. Reconciliation starts here.
 *
 * Pure parts (request bodies, parsing, validation) take no network and no
 * clock. `fetchHyperliquidInfo` is the only function that does I/O, and the
 * fetch implementation is injectable so tests never touch the network.
 */

export const HL_INFO_URL = 'https://api.hyperliquid.xyz/info';
export const HL_READONLY_SCHEMA = 'fbt.hyperliquid-readonly.v1';

export const HL_INFO_TYPES = Object.freeze(['clearinghouseState', 'openOrders', 'userFills', 'allMids']);

export const HL_ERRORS = Object.freeze({
  BAD_ADDRESS: 'HL_BAD_ADDRESS',
  BAD_TYPE: 'HL_BAD_TYPE',
  TIMEOUT: 'HL_TIMEOUT',
  RATE_LIMITED: 'HL_RATE_LIMITED',
  HTTP_ERROR: 'HL_HTTP_ERROR',
  NETWORK: 'HL_NETWORK',
  BAD_RESPONSE: 'HL_BAD_RESPONSE'
});

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** A public EVM address only. Anything else is rejected before any request. */
export function isValidHlAddress(value) {
  return typeof value === 'string' && ADDRESS_RE.test(value);
}

/**
 * The POST body for an info request. `allMids` takes no user; every other
 * type here is per-account.
 */
export function buildInfoRequest(type, user = null) {
  if (!HL_INFO_TYPES.includes(type)) return { ok: false, code: HL_ERRORS.BAD_TYPE };
  if (type === 'allMids') return { ok: true, body: { type } };
  if (!isValidHlAddress(user)) return { ok: false, code: HL_ERRORS.BAD_ADDRESS };
  return { ok: true, body: { type, user } };
}

const num = (v) => {
  // Number(null) and Number('') are 0, which would turn a missing field into
  // an apparently empty account. Only real numeric input counts.
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Turns a raw clearinghouseState response into the small set of numbers the
 * app shows and the caps check reads. Unknown or missing fields become null,
 * never zero, so a parser gap cannot look like an empty account.
 */
export function parseAccountSummary(raw) {
  if (!raw || typeof raw !== 'object' || !raw.marginSummary) {
    return { ok: false, code: HL_ERRORS.BAD_RESPONSE };
  }
  const ms = raw.marginSummary;
  const positions = (Array.isArray(raw.assetPositions) ? raw.assetPositions : [])
    .map((entry) => entry?.position)
    .filter((p) => p && typeof p.coin === 'string')
    .map((p) => ({
      coin: p.coin,
      size: num(p.szi),
      entryPx: num(p.entryPx),
      unrealizedPnl: num(p.unrealizedPnl),
      liquidationPx: num(p.liquidationPx),
      leverage: num(p.leverage?.value)
    }));
  return {
    ok: true,
    schema: HL_READONLY_SCHEMA,
    accountValueUsd: num(ms.accountValue),
    marginUsedUsd: num(ms.totalMarginUsed),
    notionalPositionUsd: num(ms.totalNtlPos),
    withdrawableUsd: num(raw.withdrawable),
    positions
  };
}

/**
 * Calls /info once. The caller supplies `fetchImpl` (defaults to global fetch)
 * and a timeout. Returns a result object; it never throws to the UI.
 */
export async function fetchHyperliquidInfo(type, user = null, {
  fetchImpl = globalThis.fetch,
  timeoutMs = 8000,
  url = HL_INFO_URL
} = {}) {
  const req = buildInfoRequest(type, user);
  if (!req.ok) return req;
  if (typeof fetchImpl !== 'function') return { ok: false, code: HL_ERRORS.NETWORK };

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req.body),
      signal: controller?.signal
    });
    if (res.status === 429) return { ok: false, code: HL_ERRORS.RATE_LIMITED };
    if (!res.ok) return { ok: false, code: HL_ERRORS.HTTP_ERROR, status: res.status };
    const data = await res.json();
    return { ok: true, data };
  } catch (cause) {
    if (cause?.name === 'AbortError') return { ok: false, code: HL_ERRORS.TIMEOUT };
    return { ok: false, code: HL_ERRORS.NETWORK };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** One call: fetch the account and return the parsed summary. */
export async function readAccountSummary(user, options = {}) {
  const res = await fetchHyperliquidInfo('clearinghouseState', user, options);
  if (!res.ok) return res;
  return parseAccountSummary(res.data);
}
