/**
 * FBT Insurance OS — client.
 *
 * Thin wrapper over /api/insurance. The browser never talks to a provider
 * directly and never builds its own numbers: quotes, fees and eligibility are
 * server-computed. Amounts travel as strings (integer micro-units) to avoid
 * float money errors in the UI (§46).
 */
import { apiBase } from './apiBase.js';

const base = () => `${apiBase()}/insurance`;

async function json(res) {
  if (!res.ok) {
    let detail = null;
    try { detail = await res.json(); } catch { /* ignore */ }
    const err = new Error(detail?.error || `HTTP ${res.status}`);
    err.code = detail?.error || 'HTTP_ERROR';
    err.detail = detail?.detail || detail;
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function qs(obj) {
  const parts = Object.entries(obj || {}).filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

export const insuranceApi = {
  capabilities: async () => json(await fetch(`${base()}/capabilities`)),

  providers: async () => (await json(await fetch(`${base()}/providers`))).providers,
  providerHealth: async (id) => json(await fetch(`${base()}/providers/${id}/health`)),
  products: async (chainId) => (await json(await fetch(`${base()}/products${qs({ chainId })}`))).products,
  product: async (id, chainId) => (await json(await fetch(`${base()}/products/${encodeURIComponent(id)}${qs({ chainId })}`))).product,

  quote: async (body) => json(await fetch(`${base()}/quote`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })),
  eligibility: async (body) => (await json(await fetch(`${base()}/eligibility`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))).answers,
  quoteById: async (id) => json(await fetch(`${base()}/quotes/${encodeURIComponent(id)}`)),

  purchaseIntent: async (body) => json(await fetch(`${base()}/purchase-intent`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })),
  activate: async (body) => json(await fetch(`${base()}/transaction/activate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })),

  coverage: async (wallet) => json(await fetch(`${base()}/coverage${qs({ wallet })}`)),
  coverageById: async (id, wallet) => json(await fetch(`${base()}/coverage/${encodeURIComponent(id)}${qs({ wallet })}`)),
  renew: async (body) => json(await fetch(`${base()}/renew`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })),
  cancel: async (body) => json(await fetch(`${base()}/cancel`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })),

  createClaim: async (body) => json(await fetch(`${base()}/claim`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })),
  submitClaim: async (id, body) => json(await fetch(`${base()}/claim/${encodeURIComponent(id)}/submit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })),
  claims: async (wallet) => json(await fetch(`${base()}/claims${qs({ wallet })}`)),
  claimById: async (id, wallet) => json(await fetch(`${base()}/claims/${encodeURIComponent(id)}${qs({ wallet })}`)),

  risk: async (body) => json(await fetch(`${base()}/risk`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })),
  protectPortfolio: async (body) => json(await fetch(`${base()}/intent/protect-portfolio`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })),
  incidents: async () => (await json(await fetch(`${base()}/incidents`))).incidents,
  events: async (limit) => (await json(await fetch(`${base()}/events${qs({ limit })}`))).events,

  // admin (needs INSURANCE_ADMIN_KEY server-side)
  admin: {
    decide: async (claimId, body, token) => authPost(`${base()}/admin/claims/${encodeURIComponent(claimId)}/decide`, body, token),
    recordPayout: async (claimId, body, token) => authPost(`${base()}/admin/claims/${encodeURIComponent(claimId)}/record-payout`, body, token),
    registerIncident: async (body, token) => authPost(`${base()}/admin/incidents`, body, token),
    pause: async (paused, token) => authPost(`${base()}/admin/pause`, { paused }, token),
    providersEnable: async (id, enabled, token) => authPost(`${base()}/admin/providers/${encodeURIComponent(id)}/enable`, { enabled }, token),
    dashboard: async (token) => authGet(`${base()}/admin/dashboard`, token)
  }
};

function authHeaders(token) {
  const h = { 'content-type': 'application/json' };
  if (token) h.authorization = `Bearer ${token}`;
  return h;
}
async function authPost(url, body, token) { return json(await fetch(url, { method: 'POST', headers: authHeaders(token), body: JSON.stringify(body) })); }
async function authGet(url, token) { return json(await fetch(url, { headers: { authorization: token ? `Bearer ${token}` : '' } })); }

/** micro (base-6) -> display number/string. */
export function usd(micro) {
  if (micro === null || micro === undefined || micro === '') return '0';
  const s = String(micro);
  const neg = s.startsWith('-');
  const a = neg ? s.slice(1) : s;
  const padded = a.padStart(7, '0');
  const intPart = padded.slice(0, -6);
  let frac = padded.slice(-6).replace(/0+$/, '');
  return (neg ? '-' : '') + (frac ? `${intPart}.${frac}` : intPart);
}
export function microOrDollar(v) { return usd(v); }

/** localStorage-persisted demo/connected wallet helper. */
const KEY = 'fbt-insurance-wallet-v1';
export function getInsuranceWallet() {
  try { return localStorage.getItem(KEY) || ''; } catch { return ''; }
}
export function setInsuranceWallet(w) {
  try { localStorage.setItem(KEY, String(w).trim()); } catch { /* ignore */ }
}
