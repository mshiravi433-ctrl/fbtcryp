/**
 * Browser client for the isolated Iranian USDT-buy boundary.
 *
 * It never knows a Wallex credential, never chooses an asset/network, and
 * never creates a rate, payment URL, receipt, or transaction hash. The only
 * browser-held capabilities are short-lived order / wallet-binding tokens in
 * sessionStorage; closing the session intentionally makes them unavailable.
 */
import { apiBase } from './apiBase.js';
import { telegramAuthBodyFields, telegramAuthHeaders } from './telegramSession.js';

function iranBuyRoot() {
  return `${apiBase()}/iran/buy`;
}
const BINDING_KEY = 'fbt:iran-buy:wallet-binding:v1';
const ORDERS_KEY = 'fbt:iran-buy:orders:v1';

function requestId(prefix = 'irb') {
  const entropy = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${entropy.replace(/[^A-Za-z0-9._:-]/g, '')}`.slice(0, 120);
}

function errorFor(payload, status) {
  const error = new Error(payload?.error || `HTTP_${status}`);
  error.code = payload?.error || 'REQUEST_FAILED';
  error.meta = payload || {};
  return error;
}

async function request(path, { method = 'GET', body, headers = {}, authenticated = false, timeout = 30_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const authHeaders = authenticated ? telegramAuthHeaders() : {};
    if (authenticated && !authHeaders) throw Object.assign(new Error('AUTH_REQUIRED'), { code: 'AUTH_REQUIRED' });
    const authBody = authenticated && method !== 'GET' ? telegramAuthBodyFields() : null;
    const payloadBody = body == null ? body : { ...body, ...(authBody || {}) };
    const response = await fetch(`${iranBuyRoot()}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        ...(payloadBody ? { 'content-type': 'application/json' } : {}),
        ...(authHeaders || {}),
        ...headers
      },
      ...(payloadBody ? { body: JSON.stringify(payloadBody) } : {})
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw errorFor(payload, response.status);
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function readSession(key) {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(key) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

function writeSession(key, value) {
  try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* private browsing: fail closed on later access */ }
}

function normalizedAddress(value) {
  return String(value || '').toLowerCase();
}

function currentBinding({ address, chainId, networkId }) {
  const binding = readSession(BINDING_KEY);
  if (!binding?.walletBindingToken || !binding?.expiresAt || Date.parse(binding.expiresAt) <= Date.now()) return null;
  if (normalizedAddress(binding.address) !== normalizedAddress(address)
    || Number(binding.chainId) !== Number(chainId)
    || String(binding.network) !== String(networkId)) return null;
  return binding;
}

function saveBinding(binding) {
  writeSession(BINDING_KEY, binding);
}

function orderSessions() {
  return readSession(ORDERS_KEY);
}

function saveOrderAccess(orderId, orderAccessToken) {
  if (!orderId || !orderAccessToken) return;
  const entries = orderSessions();
  entries[orderId] = { orderAccessToken, savedAt: Date.now() };
  const newest = Object.entries(entries)
    .sort((a, b) => Number(b[1]?.savedAt || 0) - Number(a[1]?.savedAt || 0))
    .slice(0, 12);
  writeSession(ORDERS_KEY, Object.fromEntries(newest));
}

export function storedIranBuyOrderAccessToken(orderId) {
  return orderSessions()?.[orderId]?.orderAccessToken || null;
}

export function getIranBuyCapability() {
  return request('/config');
}

/**
 * Bind exactly the active EVM account to the server. Signing this message does
 * not send a transaction or approve token spending; it prevents a page script
 * from substituting an arbitrary withdrawal destination behind the wallet UI.
 */
export async function ensureIranBuyWalletBinding({ wallet, capability }) {
  const address = wallet?.address;
  const chainId = Number(wallet?.chainId);
  const network = capability?.network;
  if (!address || !wallet?.isConnected || !network || network.walletFamily !== 'EVM'
    || chainId !== Number(network.chainId)) {
    throw Object.assign(new Error('WALLET_NETWORK_INCOMPATIBLE'), { code: 'WALLET_NETWORK_INCOMPATIBLE' });
  }
  const existing = currentBinding({ address, chainId, networkId: network.id });
  if (existing) return existing.walletBindingToken;
  const signer = wallet.getSigner?.();
  if (!signer?.signMessage) throw Object.assign(new Error('WALLET_SIGNER_UNAVAILABLE'), { code: 'WALLET_SIGNER_UNAVAILABLE' });
  const challenge = await request('/wallet-challenge', {
    method: 'POST', authenticated: true, body: { address, chainId }
  });
  let signature;
  try { signature = await signer.signMessage(challenge.message); }
  catch (cause) {
    const error = Object.assign(new Error('WALLET_SIGNATURE_REJECTED'), { code: 'WALLET_SIGNATURE_REJECTED' });
    error.cause = cause;
    throw error;
  }
  const verified = await request('/wallet-verify', {
    method: 'POST', authenticated: true, body: { challengeId: challenge.challengeId, signature }
  });
  const binding = {
    walletBindingToken: verified.walletBindingToken,
    address: verified.address,
    chainId: verified.chainId,
    network: verified.network,
    expiresAt: verified.expiresAt
  };
  saveBinding(binding);
  return binding.walletBindingToken;
}

export function createIranBuyPreview({ amountToman, walletBindingToken }) {
  return request('/usdt/preview', {
    method: 'POST', authenticated: true, body: { amountToman: String(amountToman || ''), walletBindingToken }, timeout: 35_000
  });
}

export async function createIranBuyOrder({ preview, walletBindingToken, idempotencyKey = requestId('iran-order') } = {}) {
  const payload = await request('/usdt', {
    method: 'POST',
    authenticated: true,
    headers: { 'idempotency-key': idempotencyKey },
    body: {
      previewId: preview?.previewId,
      previewAccessToken: preview?.accessToken,
      walletBindingToken,
      idempotencyKey
    },
    timeout: 35_000
  });
  saveOrderAccess(payload?.order?.orderId, payload?.orderAccessToken);
  return payload;
}

export function getIranBuyOrder(orderId) {
  const orderAccessToken = storedIranBuyOrderAccessToken(orderId);
  if (!orderAccessToken) return Promise.reject(Object.assign(new Error('ORDER_ACCESS_UNAVAILABLE'), { code: 'ORDER_ACCESS_UNAVAILABLE' }));
  return request(`/orders/${encodeURIComponent(orderId)}`, {
    authenticated: true,
    headers: { 'x-iran-buy-order-token': orderAccessToken },
    timeout: 35_000
  });
}

export function getIranBuyOrderAudit(orderId) {
  const orderAccessToken = storedIranBuyOrderAccessToken(orderId);
  if (!orderAccessToken) return Promise.reject(Object.assign(new Error('ORDER_ACCESS_UNAVAILABLE'), { code: 'ORDER_ACCESS_UNAVAILABLE' }));
  return request(`/orders/${encodeURIComponent(orderId)}/audit`, {
    authenticated: true,
    headers: { 'x-iran-buy-order-token': orderAccessToken }
  });
}

export async function authorizeIranBuySettlement({ order, wallet }) {
  const orderAccessToken = storedIranBuyOrderAccessToken(order?.orderId);
  if (!orderAccessToken) throw Object.assign(new Error('ORDER_ACCESS_UNAVAILABLE'), { code: 'ORDER_ACCESS_UNAVAILABLE' });
  if (!wallet?.isConnected || normalizedAddress(wallet.address) !== normalizedAddress(order.destinationAddress)
    || Number(wallet.chainId) !== Number(order.chainId)) {
    throw Object.assign(new Error('WALLET_DESTINATION_CHANGED'), { code: 'WALLET_DESTINATION_CHANGED' });
  }
  const signer = wallet.getSigner?.();
  if (!signer?.signMessage) throw Object.assign(new Error('WALLET_SIGNER_UNAVAILABLE'), { code: 'WALLET_SIGNER_UNAVAILABLE' });
  const challenge = await request(`/orders/${encodeURIComponent(order.orderId)}/settlement-challenge`, {
    method: 'POST', authenticated: true, headers: { 'x-iran-buy-order-token': orderAccessToken }
  });
  let signature;
  try { signature = await signer.signMessage(challenge.message); }
  catch (cause) {
    const error = Object.assign(new Error('WALLET_SIGNATURE_REJECTED'), { code: 'WALLET_SIGNATURE_REJECTED' });
    error.cause = cause;
    throw error;
  }
  return request(`/orders/${encodeURIComponent(order.orderId)}/settlement-authorize`, {
    method: 'POST',
    authenticated: true,
    headers: { 'x-iran-buy-order-token': orderAccessToken },
    body: { challengeId: challenge.challengeId, signature },
    timeout: 45_000
  });
}

export function cancelIranBuyOrder(orderId) {
  const orderAccessToken = storedIranBuyOrderAccessToken(orderId);
  if (!orderAccessToken) return Promise.reject(Object.assign(new Error('ORDER_ACCESS_UNAVAILABLE'), { code: 'ORDER_ACCESS_UNAVAILABLE' }));
  return request(`/orders/${encodeURIComponent(orderId)}/cancel`, {
    method: 'POST', authenticated: true, headers: { 'x-iran-buy-order-token': orderAccessToken }
  });
}

export const __iranBuyClient = Object.freeze({ requestId, normalizedAddress, currentBinding });
