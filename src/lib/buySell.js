/**
 * Browser client for the hosted-checkout Buy / Sell gateway.
 *
 * This module never creates prices, status, balances, addresses, transaction
 * hashes, or checkout URLs. Those all come from the server/provider, and any
 * order access capability stays in sessionStorage so it survives a return from
 * a hosted checkout without becoming a query parameter.
 */
import { apiBase } from './apiBase.js';

const ROOT = `${apiBase()}/v1/buy-sell`;
const SESSION_KEY = 'fbt:buy-sell:orders:v1';

function makeRequestId(prefix = 'bs') {
  const entropy = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${entropy.replace(/[^A-Za-z0-9._:-]/g, '')}`.slice(0, 120);
}

async function request(path, { method = 'GET', body, headers = {}, timeout = 20_000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const response = await fetch(`${ROOT}${path}`, {
      method,
      signal: ctrl.signal,
      headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload?.error || `HTTP_${response.status}`);
      error.code = payload?.error || 'REQUEST_FAILED';
      error.meta = payload;
      throw error;
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function sessionOrders() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(SESSION_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

function saveSessionOrder(orderId, accessToken) {
  if (!orderId || !accessToken) return;
  try {
    const current = sessionOrders();
    current[orderId] = { accessToken, savedAt: Date.now() };
    const entries = Object.entries(current).sort((a, b) => b[1].savedAt - a[1].savedAt).slice(0, 20);
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* Private browsing can reject session storage. The order still exists,
       but it is intentionally not recoverable without its access capability. */
  }
}

export function storedOrderAccessToken(orderId) {
  return sessionOrders()?.[orderId]?.accessToken || null;
}

export function getBuySellProviders() { return request('/providers'); }
export function getBuySellAssets(side = 'BUY') { return request(`/assets?${new URLSearchParams({ side })}`); }
export function getBuySellNetworks(asset, side = 'BUY') { return request(`/networks?${new URLSearchParams({ asset, side })}`); }
export function checkBuySellEligibility(input) { return request('/eligibility', { method: 'POST', body: input }); }
export function getBuySellQuote(input) { return request('/quote', { method: 'POST', body: input, timeout: 30_000 }); }

export async function createBuySellOrder({ quote, walletAddress }) {
  const requestId = makeRequestId('order');
  const payload = await request('/order', {
    method: 'POST',
    headers: { 'idempotency-key': requestId },
    body: { quoteId: quote.quoteId, quoteAccessToken: quote.accessToken, walletAddress, requestId },
    timeout: 30_000
  });
  saveSessionOrder(payload.order?.orderId, payload.orderAccessToken);
  return payload;
}

export async function createBuySellCheckout(orderId, { confirmed = true } = {}) {
  const accessToken = storedOrderAccessToken(orderId);
  if (!accessToken) {
    const error = new Error('ORDER_ACCESS_UNAVAILABLE');
    error.code = 'ORDER_ACCESS_UNAVAILABLE';
    throw error;
  }
  return request('/checkout', {
    method: 'POST',
    headers: { 'idempotency-key': makeRequestId('checkout'), 'x-buy-sell-order-token': accessToken },
    body: { orderId, confirmed },
    timeout: 65_000
  });
}

export function getBuySellOrder(orderId, { verify = false } = {}) {
  const accessToken = storedOrderAccessToken(orderId);
  if (!accessToken) {
    const error = new Error('ORDER_ACCESS_UNAVAILABLE');
    error.code = 'ORDER_ACCESS_UNAVAILABLE';
    return Promise.reject(error);
  }
  return request(`/order/${encodeURIComponent(orderId)}${verify ? '/status' : ''}`, {
    headers: { 'x-buy-sell-order-token': accessToken }
  });
}

export function getBuySellOrderAudit(orderId) {
  const accessToken = storedOrderAccessToken(orderId);
  if (!accessToken) {
    const error = new Error('ORDER_ACCESS_UNAVAILABLE');
    error.code = 'ORDER_ACCESS_UNAVAILABLE';
    return Promise.reject(error);
  }
  return request(`/order/${encodeURIComponent(orderId)}/audit`, {
    headers: { 'x-buy-sell-order-token': accessToken }
  });
}

export function verifyBuySellOrder(orderId) {
  const accessToken = storedOrderAccessToken(orderId);
  if (!accessToken) {
    const error = new Error('ORDER_ACCESS_UNAVAILABLE');
    error.code = 'ORDER_ACCESS_UNAVAILABLE';
    return Promise.reject(error);
  }
  return request(`/order/${encodeURIComponent(orderId)}/verify`, {
    method: 'POST',
    headers: { 'x-buy-sell-order-token': accessToken }
  });
}

/* Intent OS imports this same service rather than a duplicate pathway. It may
   inspect capabilities, request a live quote, or poll a prepared order; it
   cannot create a checkout without the UI's explicit confirmation step. */
export const buySellService = Object.freeze({
  getCapabilities: getBuySellProviders,
  getQuote: getBuySellQuote,
  getOrderStatus: (orderId) => getBuySellOrder(orderId, { verify: true }),
  createCheckout: async () => ({ ok: false, error: 'USER_CONFIRMATION_REQUIRED', route: '/buy' })
});

export function cancelBuySellOrder(orderId) {
  const accessToken = storedOrderAccessToken(orderId);
  if (!accessToken) {
    const error = new Error('ORDER_ACCESS_UNAVAILABLE');
    error.code = 'ORDER_ACCESS_UNAVAILABLE';
    return Promise.reject(error);
  }
  return request(`/order/${encodeURIComponent(orderId)}/cancel`, {
    method: 'POST',
    headers: { 'x-buy-sell-order-token': accessToken }
  });
}
