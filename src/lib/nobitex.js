/**
 * Nobitex integration — IRT (تومان) market data + optional user-key trading.
 *
 * ─── DESIGN CONSTRAINT ────────────────────────────────────────────────────
 * Nobitex is a CENTRALIZED, custodial exchange. That is fundamentally at odds
 * with the rest of this app being non-custodial, so the integration is built
 * to keep the operator (you) completely out of the trust path:
 *
 *   • PUBLIC data (prices in IRT, order book, OHLC) needs no key at all and is
 *     proxied through our backend for caching.
 *   • TRADING is bring-your-own-key: each user pastes THEIR OWN Nobitex token,
 *     which is AES-GCM encrypted with their password on THEIR device. It is
 *     never sent to our server, never logged, and never leaves the browser
 *     except in a direct request to nobitex.ir.
 *   • WITHDRAWAL endpoints are deliberately NOT implemented. Even with a valid
 *     token this code cannot move funds off the exchange. Tell users to create
 *     their key WITHOUT withdrawal permission.
 *
 * If you ever centralize these keys on your server, you become a custodian and
 * inherit the full regulatory burden (and the liability when you get breached).
 * Don't.
 *
 * SANCTIONS/COMPLIANCE: Nobitex is an Iranian exchange. Depending on where you
 * and your users are located, routing orders through it may raise sanctions
 * issues. Get legal advice before shipping this to a general audience.
 * ──────────────────────────────────────────────────────────────────────────
 */

import { encryptSecret, decryptSecret } from './localWallet';

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE) || '/api';
const NOBITEX_DIRECT = 'https://api.nobitex.ir';
const TOKEN_KEY = 'nexus-nobitex-token-v1';

/* --------------------------- public market data --------------------------- */

async function fetchJson(url, opts = {}, timeout = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * IRT market stats. Goes through our backend (cached, and it sidesteps CORS /
 * geo-blocking); falls back to a direct call.
 */
export async function getIrtMarkets() {
  try {
    return normalizeStats(await fetchJson(`${API_BASE}/nobitex/stats`));
  } catch {
    const raw = await fetchJson(`${NOBITEX_DIRECT}/market/stats`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ srcCurrency: 'btc,eth,usdt,bnb,ada,doge,xrp,ltc,trx', dstCurrency: 'rls' })
    });
    return normalizeStats(raw);
  }
}

/** Nobitex quotes in RIALS; Iranians think in TOMANS (= rial / 10). */
export const rialToToman = (v) => Number(v || 0) / 10;

export function normalizeStats(raw) {
  const stats = raw?.stats ?? {};
  const out = [];
  for (const [pair, s] of Object.entries(stats)) {
    const [src, dst] = pair.split('-');
    if (dst !== 'rls') continue;
    out.push({
      symbol: src.toUpperCase(),
      pair,
      latest: rialToToman(s.latest),
      dayHigh: rialToToman(s.dayHigh),
      dayLow: rialToToman(s.dayLow),
      dayOpen: rialToToman(s.dayOpen),
      dayClose: rialToToman(s.dayClose),
      dayChange: Number(s.dayChange) || 0,
      volumeSrc: Number(s.volumeSrc) || 0,
      bestSell: rialToToman(s.bestSell),
      bestBuy: rialToToman(s.bestBuy),
      isClosed: Boolean(s.isClosed)
    });
  }
  return out.sort((a, b) => b.volumeSrc - a.volumeSrc);
}

/** USDT/IRT rate — the reference price Iranian users actually care about. */
export async function getUsdtIrtRate() {
  const markets = await getIrtMarkets();
  return markets.find((m) => m.symbol === 'USDT')?.latest ?? null;
}

export async function getOrderBook(symbol = 'BTCIRT') {
  try {
    return await fetchJson(`${API_BASE}/nobitex/orderbook/${symbol}`);
  } catch {
    return fetchJson(`${NOBITEX_DIRECT}/v2/orderbook/${symbol}`);
  }
}

/* ------------------------- user token (encrypted) ------------------------- */

export function hasNobitexToken() {
  return Boolean(localStorage.getItem(TOKEN_KEY));
}

/** Encrypt the user's own API token under their password and store locally. */
export async function saveNobitexToken(token, password) {
  const blob = await encryptSecret(token.trim(), password);
  localStorage.setItem(TOKEN_KEY, JSON.stringify({ ...blob, savedAt: Date.now() }));
}

export async function readNobitexToken(password) {
  const raw = localStorage.getItem(TOKEN_KEY);
  if (!raw) throw new Error('NO_TOKEN');
  try {
    return await decryptSecret(JSON.parse(raw), password);
  } catch {
    throw new Error('BAD_PASSWORD');
  }
}

export function clearNobitexToken() {
  localStorage.removeItem(TOKEN_KEY);
}

/* --------------------------- authenticated calls -------------------------- */

/**
 * Direct browser -> Nobitex call. The token never touches our backend.
 * Note: this depends on Nobitex sending permissive CORS headers; if they don't,
 * the call fails and the UI says so rather than silently proxying the secret.
 */
async function authed(path, token, { method = 'GET', body } = {}) {
  return fetchJson(`${NOBITEX_DIRECT}${path}`, {
    method,
    headers: {
      Authorization: `Token ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
}

export async function getNobitexProfile(token) {
  return authed('/users/profile', token);
}

export async function getNobitexBalances(token) {
  const raw = await authed('/users/wallets/list', token);
  return (raw?.wallets ?? [])
    .map((w) => ({
      currency: (w.currency || '').toUpperCase(),
      balance: Number(w.balance) || 0,
      blocked: Number(w.blocked) || 0,
      available: (Number(w.balance) || 0) - (Number(w.blocked) || 0),
      rialValue: rialToToman(w.rialBalance)
    }))
    .filter((w) => w.balance > 0);
}

export async function getNobitexOrders(token, { status = 'open' } = {}) {
  const raw = await authed(`/market/orders/list?status=${status}`, token);
  return raw?.orders ?? [];
}

/**
 * Place a spot order using the user's own key.
 *
 * `execution: 'limit' | 'market'`. Amounts are in the source currency.
 * There is intentionally no withdrawal counterpart to this function.
 */
export async function placeNobitexOrder(token, { type, srcCurrency, dstCurrency = 'rls', amount, price, execution = 'limit' }) {
  if (!['buy', 'sell'].includes(type)) throw new Error('BAD_TYPE');
  const body = {
    type,
    srcCurrency: srcCurrency.toLowerCase(),
    dstCurrency: dstCurrency.toLowerCase(),
    amount: String(amount),
    execution
  };
  if (execution === 'limit') {
    if (!price) throw new Error('PRICE_REQUIRED');
    body.price = String(price); // Nobitex expects rials
  }
  return authed('/market/orders/add', token, { method: 'POST', body });
}

export async function cancelNobitexOrder(token, orderId) {
  return authed('/market/orders/update-status', token, {
    method: 'POST',
    body: { order: orderId, status: 'canceled' }
  });
}

/**
 * Explicitly unimplemented. Kept as a named export so anyone grepping for
 * "withdraw" finds this comment instead of adding it casually.
 */
export function withdraw() {
  throw new Error(
    'Withdrawals are intentionally not implemented. Users should move funds ' +
      'from the official Nobitex app, and should issue API keys without ' +
      'withdrawal permission.'
  );
}
