/**
 * Wallex client — the device side of the Iranians-only buy/sell tab.
 * ---------------------------------------------------------------------------
 * The user's Wallex API key lives in THIS device's localStorage and travels
 * only to OUR proxy (`/api/wallex/*`), which forwards it to api.wallex.ir and
 * never stores or echoes it. Nothing else ever sees it. Keys are created in
 * Wallex's own panel (wallex.ir → مدیریت API), expire after at most 90 days,
 * and Wallex's own error message is surfaced verbatim when that happens.
 */

import { apiBase } from './apiBase.js';

const API = apiBase();
export const WALLEX_KEY_STORAGE = 'fbt.wallex.apiKey';

export function readWallexKey() {
  try {
    return String(localStorage.getItem(WALLEX_KEY_STORAGE) || '').trim();
  } catch {
    return '';
  }
}

export function writeWallexKey(key) {
  try {
    localStorage.setItem(WALLEX_KEY_STORAGE, String(key || '').trim());
  } catch { /* storage blocked — the key simply is not persisted */ }
}

export function clearWallexKey() {
  try {
    localStorage.removeItem(WALLEX_KEY_STORAGE);
  } catch { /* noop */ }
}

function headers() {
  const key = readWallexKey();
  return key ? { 'x-wallex-key': key, accept: 'application/json' } : { accept: 'application/json' };
}

async function request(path, { method = 'GET', body, query } = {}) {
  const url = new URL(`${API}${path}`, window.location.origin);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString().replace(window.location.origin, ''), {
    method,
    headers: { ...headers(), ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(payload.message || payload.error || `WALLEX_HTTP_${res.status}`);
    error.code = payload.error || `WALLEX_HTTP_${res.status}`;
    error.message = payload.message || error.message;
    throw error;
  }
  return payload;
}

/* Public market data (no key needed). */
export const wallexMarkets = () => request('/api/wallex/v1/markets');
export const wallexOtcMarkets = () => request('/api/wallex/v1/otc/markets');
export const wallexDepth = (symbol) => request('/api/wallex/v1/depth', { query: { symbol } });

/* Private account endpoints (user key). */
export const wallexBalances = () => request('/api/wallex/v1/account/balances');
export const wallexOpenOrders = (symbol) => request('/api/wallex/v1/account/openOrders', { query: symbol ? { symbol } : {} });
export const wallexTrades = (symbol) => request('/api/wallex/v1/account/trades', { query: symbol ? { symbol } : {} });
export const wallexOtcPrice = (symbol, side) => request('/api/wallex/v1/account/otc/price', { query: { symbol, side } });

export const wallexPlaceOrder = (body) => request('/api/wallex/v1/account/orders', { method: 'POST', body });
export const wallexPlaceOtcOrder = (body) => request('/api/wallex/v1/account/otc/orders', { method: 'POST', body });
export const wallexCancelOrder = (clientOrderId) => request('/api/wallex/v1/account/orders', { method: 'DELETE', query: { clientOrderId } });

/** Same normalization as the server's — client-side, for instant re-sorts. */
export function normalizeWallexMarkets(symbolsMap) {
  if (!symbolsMap || typeof symbolsMap !== 'object' || Array.isArray(symbolsMap)) return [];
  const rows = Object.values(symbolsMap)
    .filter((m) => m && typeof m === 'object' && typeof m.symbol === 'string')
    .map((m) => ({
      symbol: m.symbol,
      baseAsset: String(m.baseAsset || ''),
      quoteAsset: String(m.quoteAsset || ''),
      faName: String(m.faName || ''),
      lastPrice: Number(m.stats?.lastPrice ?? 0),
      change24h: Number(m.stats?.['24h_ch'] ?? 0),
      bidPrice: Number(m.stats?.bidPrice ?? 0),
      askPrice: Number(m.stats?.askPrice ?? 0),
      quoteVolume24h: Number(m.stats?.['24h_quoteVolume'] ?? 0),
      high24h: Number(m.stats?.['24h_highPrice'] ?? 0),
      low24h: Number(m.stats?.['24h_lowPrice'] ?? 0),
      minQty: Number(m.minQty ?? 0),
      minNotional: Number(m.minNotional ?? 0),
      tickSize: Number(m.tickSize ?? 2),
      stepSize: Number(m.stepSize ?? 6)
    }));
  const rank = (m) => (m.quoteAsset === 'TMN' ? 0 : m.quoteAsset === 'USDT' ? 1 : 2);
  return rows.sort((a, b) => rank(a) - rank(b) || b.quoteVolume24h - a.quoteVolume24h);
}

/** Balances shape: { BTC: { asset, faName, value, lockedValue }, … }. */
export function normalizeWallexBalances(result) {
  const map = result?.balances && typeof result.balances === 'object' ? result.balances : {};
  return Object.values(map)
    .map((row) => ({
      asset: String(row?.asset || ''),
      faName: String(row?.faName || ''),
      value: Number(row?.value ?? 0),
      lockedValue: Number(row?.lockedValue ?? 0)
    }))
    .filter((row) => row.asset && (row.value > 0 || row.lockedValue > 0))
    .sort((a, b) => b.value - a.value);
}

export function formatWallexPrice(value, tickSize = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: Math.max(0, Math.min(8, tickSize)) });
}
