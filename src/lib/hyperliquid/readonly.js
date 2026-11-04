/**
 * Hyperliquid read-only account access.
 *
 * Network lives at the edge (fetch). Parsing/normalisation is pure so it can
 * be unit-tested without a network. No keys are ever sent here — only the
 * public wallet/agent address.
 *
 * Error codes (surfaced to the UI as distinct states):
 *   HL_RATE_LIMITED, HL_TIMEOUT, HL_BAD_ADDRESS, HL_NETWORK, HL_BAD_SHAPE,
 *   HL_UNKNOWN
 */

export const HYPERLIQUID_INFO_URL = 'https://api.hyperliquid.xyz/info';
export const HL_ERRORS = Object.freeze({
  RATE_LIMITED: 'HL_RATE_LIMITED',
  TIMEOUT: 'HL_TIMEOUT',
  BAD_ADDRESS: 'HL_BAD_ADDRESS',
  NETWORK: 'HL_NETWORK',
  BAD_SHAPE: 'HL_BAD_SHAPE',
  UNKNOWN: 'HL_UNKNOWN'
});

export const isHyperliquidAddress = (value) =>
  /^0x[a-fA-F0-9]{40}$/.test(String(value || '').trim());

const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const safe = (v, fallback = null) => (v == null ? fallback : v);

/**
 * Pure: turn a raw clearinghouseState response into a normalised account.
 * Returns { ok: true, account } or { ok: false, code, error }.
 * Missing fields become null ("unknown"), never 0.
 */
export function parseClearinghouseState(raw, { address } = {}) {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, code: HL_ERRORS.BAD_SHAPE, error: HL_ERRORS.BAD_SHAPE };
  }
  const ms = raw.marginSummary || raw.crossMarginSummary || null;
  const accountValue = ms ? toNum(ms.accountValue) : null;
  const totalMarginUsed = ms ? toNum(ms.totalMarginUsed) : null;
  const totalNtlPos = ms ? toNum(ms.totalNtlPos) : null;
  const totalRawUsd = ms ? toNum(ms.totalRawUsd) : null;

  const positions = Array.isArray(raw.assetPositions)
    ? raw.assetPositions.map((ap) => {
        const p = (ap && ap.position) || ap || {};
        return {
          coin: p.coin ?? null,
          side: toNum(p.szi) == null ? null : (Number(p.szi) >= 0 ? 'long' : 'short'),
          size: toNum(p.szi),
          entryPrice: toNum(p.entryPx),
          positionValue: toNum(p.positionValue),
          unrealizedPnl: toNum(p.unrealizedPnl),
          returnOnEquity: toNum(p.returnOnEquity),
          liquidationPrice: toNum(p.liquidationPx),
          marginUsed: toNum(p.marginUsed),
          maxLeverage: toNum(p.maxLeverage),
          leverage: toNum(p.leverage?.value ?? p.leverage),
          unknown: p.coin == null
        };
      })
    : [];

  const withdrawable = toNum(raw.withdrawable);
  const maintenanceMargin = toNum(raw.crossMaintenanceMarginUsed);

  // liquidation distance: min over positions of |mark - liq| / mark
  let minLiqDistancePct = null;
  for (const pos of positions) {
    if (pos.liquidationPrice != null && pos.entryPrice != null && pos.entryPrice !== 0) {
      const d = Math.abs(pos.liquidationPrice - (pos.positionValue && pos.size ? Math.abs(pos.positionValue / pos.size) : pos.entryPrice)) /
        Math.max(Math.abs(pos.liquidationPrice), 1);
      if (minLiqDistancePct === null || d < minLiqDistancePct) minLiqDistancePct = d;
    }
  }

  const account = {
    address: address || null,
    accountValue,
    totalMarginUsed,
    totalNtlPos,
    totalRawUsd,
    withdrawable,
    maintenanceMargin,
    positions,
    minLiqDistancePct,
    // unknown fields stay null
    marginSummary: ms || null
  };
  return { ok: true, account };
}

export function normalizeHyperliquidAccount(raw, opts) {
  return parseClearinghouseState(raw, opts);
}

export function parseAccount(raw, opts) {
  return parseClearinghouseState(raw, opts);
}

/**
 * Async read. Accepts an optional fetchImpl for testing. Returns
 * { ok, account?, code?, error?, live }.
 */
export async function getHyperliquidAccount({ address, fetchImpl, timeout = 12000, signal } = {}) {
  if (!isHyperliquidAddress(address)) {
    return { ok: false, live: false, code: HL_ERRORS.BAD_ADDRESS, error: HL_ERRORS.BAD_ADDRESS };
  }
  const f = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  if (!f) {
    return { ok: false, live: false, code: HL_ERRORS.NETWORK, error: HL_ERRORS.NETWORK };
  }
  const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeout) : null;
  try {
    const res = await f(HYPERLIQUID_INFO_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ type: 'clearinghouseState', user: address }),
      signal: signal || (ctrl ? ctrl.signal : undefined)
    });
    if (res && res.status === 429) {
      return { ok: false, live: false, code: HL_ERRORS.RATE_LIMITED, error: HL_ERRORS.RATE_LIMITED };
    }
    if (!res || !res.ok) {
      const code = res && res.status === 408 ? HL_ERRORS.TIMEOUT : HL_ERRORS.NETWORK;
      return { ok: false, live: false, code, error: code };
    }
    let data;
    try { data = await res.json(); } catch { data = null; }
    const parsed = parseClearinghouseState(data, { address });
    if (!parsed.ok) return { ...parsed, live: false };
    return { ok: true, live: true, account: parsed.account, code: null, error: null };
  } catch (e) {
    const msg = String(e?.name || e?.message || e);
    const code = /abort/i.test(msg) ? HL_ERRORS.TIMEOUT : HL_ERRORS.NETWORK;
    return { ok: false, live: false, code, error: code };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function readHyperliquidAccount(opts) {
  return getHyperliquidAccount(opts);
}
export async function fetchHyperliquidAccount(opts) {
  return getHyperliquidAccount(opts);
}
export async function getAccount(opts) {
  return getHyperliquidAccount(opts);
}
export async function readAccount(opts) {
  return getHyperliquidAccount(opts);
}

// expose error code strings
export const HL_RATE_LIMITED = HL_ERRORS.RATE_LIMITED;
export const HL_TIMEOUT = HL_ERRORS.TIMEOUT;
export const HL_BAD_ADDRESS = HL_ERRORS.BAD_ADDRESS;
export const HL_NETWORK = HL_ERRORS.NETWORK;
export const HL_BAD_SHAPE = HL_ERRORS.BAD_SHAPE;
