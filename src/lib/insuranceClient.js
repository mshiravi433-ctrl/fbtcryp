/**
 * FBT Insurance OS — client.
 *
 * Thin wrapper over /api/insurance. The browser never talks to a provider
 * directly and never builds its own numbers: quotes, fees and eligibility are
 * server-computed. Amounts travel as strings (integer micro-units) to avoid
 * float money errors in the UI (§46).
 *
 * Every response uses the standard envelope:
 *   { ok, requestId, timestamp, version, data, warnings, errors, source, freshness }
 * The helpers below unwrap `data` and surface `warnings`/`freshness` so the UI
 * can always show Source + Freshness (§12 data transparency).
 */
import { apiBase } from './apiBase.js';

const base = () => `${apiBase()}/insurance`;

async function json(res) {
  if (!res.ok) {
    let detail = null;
    try { detail = await res.json(); } catch { /* ignore */ }
    const err = new Error(detail?.errors?.[0]?.detail || detail?.errors?.[0]?.code || `HTTP ${res.status}`);
    err.code = detail?.errors?.[0]?.code || detail?.error || 'HTTP_ERROR';
    err.warnings = detail?.warnings || [];
    err.data = detail?.data || null;
    err.status = res.status;
    throw err;
  }
  const body = await res.json();
  // Envelope passthrough: keep meta, unwrap data.
  return { ...body, data: body.data ?? body, warnings: body.warnings || [], freshness: body.freshness || null, source: body.source || null };
}

function qs(obj) {
  const parts = Object.entries(obj || {}).filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

const post = (path, body) => fetch(`${base()}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }).then(json);

export const insuranceApi = {
  capabilities: () => fetch(`${base()}/capabilities`).then(json),

  providers: async () => (await fetch(`${base()}/providers`).then(json)).data.providers,
  providerHealth: async (id) => (await fetch(`${base()}/providers/${encodeURIComponent(id)}/health`).then(json)).data.health,
  providerHealthAll: async () => (await fetch(`${base()}/provider-health`).then(json)).data,
  products: async (chainId) => (await fetch(`${base()}/products${qs({ chainId })}`).then(json)).data.products,
  product: async (id, chainId) => (await fetch(`${base()}/products/${encodeURIComponent(id)}${qs({ chainId })}`).then(json)).data.product,

  quote: (body) => post('/quote', body),
  compare: (body) => post('/compare', body),
  recommend: (body) => post('/recommend', body),
  eligibility: async (body) => (await post('/eligibility', body)).data.answers,
  quoteById: (id) => fetch(`${base()}/quotes/${encodeURIComponent(id)}`).then(json),

  purchaseIntent: (body) => post('/purchase-intent', body),
  activate: (body) => post('/transaction/activate', body),
  verifyTx: (body) => post('/transaction/verify', body),

  coverage: async (wallet) => (await fetch(`${base()}/coverage${qs({ wallet })}`).then(json)).data,
  coverageById: async (id, wallet) => (await fetch(`${base()}/coverage/${encodeURIComponent(id)}${qs({ wallet })}`).then(json)).data,
  renew: (body) => post('/renew', body),
  cancel: (body) => post('/cancel', body),

  createClaim: (body) => post('/claim', body),
  submitClaim: (id, body) => post(`/claim/${encodeURIComponent(id)}/submit`, body),
  claims: async (wallet) => (await fetch(`${base()}/claims${qs({ wallet })}`).then(json)).data,
  claimById: async (id, wallet) => (await fetch(`${base()}/claims/${encodeURIComponent(id)}${qs({ wallet })}`).then(json)).data,

  risk: (body) => post('/risk', body),
  coverageGap: (wallet, exposures) => fetch(`${base()}/coverage-gap${qs({ wallet, exposuresJson: exposures ? JSON.stringify(exposures) : undefined })}`).then(json),
  protectPortfolio: (body) => post('/intent/protect-portfolio', body),
  incidents: async () => (await fetch(`${base()}/incidents`).then(json)).data.incidents,
  events: async (limit) => (await fetch(`${base()}/events${qs({ limit })}`).then(json)).data.events,

  // Verified Vault Coverage Registry (OpenCover reference registry)
  vaults: async (chainId) => (await fetch(`${base()}/vaults${qs({ chainId })}`).then(json)).data,
  pool: async () => (await fetch(`${base()}/pool`).then(json)).data,
  poolSolvency: async () => (await fetch(`${base()}/pool/solvency`).then(json)).data

  // NOTE: no admin client. Insurance admin operations are server-side only,
  // key-gated, and are not exposed to the user UI in production.
};

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

/** localStorage-persisted connected/view-only wallet helper. */
const KEY = 'fbt-insurance-wallet-v1';
export function getInsuranceWallet() {
  try { return localStorage.getItem(KEY) || ''; } catch { return ''; }
}
export function setInsuranceWallet(w) {
  try { localStorage.setItem(KEY, String(w).trim()); } catch { /* ignore */ }
}
