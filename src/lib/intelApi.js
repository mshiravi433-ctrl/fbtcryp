/**
 * INTEL API — the browser half of Explore + Security Center.
 *
 * One small, honest fetch layer for the two upgraded pages. Rules:
 *   · GET only. There is no `post` export on purpose — these pages cannot
 *     mutate anything through the API. The only state-changing action anywhere
 *     in Explore/Security is the wallet-signed revoke on the Approvals tab,
 *     which is built in lib/securityRevoke.js through the SAME approve plumbing
 *     the swap flow already uses, and never through this file.
 *   · Never imports the intent layer (enforced by test/explore-security-probe).
 *   · Errors surface as { code, retryable } so the UI can pick localized copy
 *     ("Data temporarily unavailable" vs "this address doesn't exist") —
 *     two different truths that must not share a message.
 *   · Every response carries meta.updatedAt / meta.freshness so "Updated
 *     N seconds ago" is rendered from the server's actual clock, not a guess.
 */

import { apiBase } from './apiBase.js';

const BASE = apiBase();

export class IntelApiError extends Error {
  constructor(code, { retryable = false, status = 0 } = {}) {
    super(code);
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

async function get(path, params = {}, { timeout = 15000, signal } = {}) {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  const url = `${BASE}/v1/${path}${qs ? `?${qs}` : ''}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  if (signal) signal.addEventListener?.('abort', () => ctrl.abort(), { once: true });
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    let body = null;
    try { body = await res.json(); } catch { /* not json — treat as failure */ }
    if (!res.ok) {
      const code = body?.error?.code || (res.status === 429 ? 'RATE_LIMITED' : `HTTP_${res.status}`);
      throw new IntelApiError(code, { retryable: body?.error?.retryable ?? res.status >= 500, status: res.status });
    }
    return body;
  } catch (err) {
    if (err instanceof IntelApiError) throw err;
    if (err?.name === 'AbortError') throw new IntelApiError('TIMEOUT', { retryable: true });
    throw new IntelApiError('NETWORK_UNREACHABLE', { retryable: true });
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------------------------- Explore -------------------------------- */

export const exploreApi = {
  search: (q, opts = {}) => get('explore/search', { q, ...opts }, { timeout: 20000 }),
  networks: (opts = {}) => get('explore/networks', {}, opts),
  wallet: (address, params = {}) => get(`explore/wallet/${encodeURIComponent(address)}`, params, { timeout: 30000 }),
  scan: (address) => get(`explore/wallet/${encodeURIComponent(address)}`, { scope: 'scan' }, { timeout: 45000 }),
  tx: (hash, params = {}) => get(`explore/transactions/${encodeURIComponent(hash)}`, params, { timeout: 25000 }),
  contract: (address, params = {}) => get(`explore/contracts/${encodeURIComponent(address)}`, params, { timeout: 25000 }),
  token: (address, params = {}) => get(`explore/tokens/${encodeURIComponent(address)}`, params, { timeout: 25000 }),
  registryTokens: (opts = {}) => get('explore/tokens', {}, opts),
  protocols: (params = {}) => get('explore/protocols', params, { timeout: 25000 }),
  protocol: (id) => get(`explore/protocols/${encodeURIComponent(id)}`, {}, { timeout: 20000 }),
  trending: (opts = {}) => get('explore/trending', {}, opts)
};

/* --------------------------------- Security -------------------------------- */

export const securityApi = {
  overview: (opts = {}) => get('security/overview', {}, opts),
  score: (params = {}) => get('security/score', params, { timeout: 30000 }),
  contract: (address, params = {}) => get(`security/contract/${encodeURIComponent(address)}`, params, { timeout: 30000 }),
  token: (address, params = {}) => get(`security/token/${encodeURIComponent(address)}`, params, { timeout: 30000 }),
  protocol: (id) => get(`security/protocol/${encodeURIComponent(id)}`, {}, { timeout: 25000 }),
  approvals: (wallet, params = {}) => get(`security/approvals/${encodeURIComponent(wallet)}`, params, { timeout: 30000 }),
  alerts: (params = {}) => get('security/alerts', params, { timeout: 25000 }),
  incidents: (params = {}) => get('security/incidents', params, { timeout: 20000 }),
  activity: (params = {}) => get('security/activity', params, { timeout: 10000 })
};

/* --------------------------------------------------------------------------- */
/* Shared helpers                                                              */
/* --------------------------------------------------------------------------- */

/** Humanize an error code into a translation KEY (never shown raw). */
export function intelErrorCode(err) {
  if (!err) return 'common';
  if (err.code === 'DATA_TEMPORARILY_UNAVAILABLE' || err.code === 'NETWORK_UNREACHABLE' || err.code === 'TIMEOUT' || err.code === 'RATE_LIMITED') return 'unavailable';
  if (err.code === 'DATA_SOURCE_UNAVAILABLE') return 'providerDown';
  if (err.code === 'UNSUPPORTED_CHAIN' || err.code === 'BAD_ADDRESS' || err.code === 'BAD_HASH') return 'badInput';
  return 'common';
}

/** "Updated 14 seconds ago" — computed from the server's own timestamps. */
export function freshnessLabel(meta, t) {
  if (!meta?.updatedAt) return t('intel.noData');
  const at = Date.parse(meta.updatedAt);
  if (!Number.isFinite(at)) return t('intel.noData');
  const secs = Math.max(0, Math.round((Date.now() - at) / 1000));
  const age = secs < 60
    ? t('intel.secondsAgo', { n: secs })
    : secs < 3600
      ? t('intel.minutesAgo', { n: Math.round(secs / 60) })
      : t('intel.hoursAgo', { n: Math.round(secs / 3600) });
  const stale = meta.freshness === 'STALE' ? ` · ${t('intel.stale')}` : '';
  return `${t('intel.updated')} ${age}${stale}`;
}

export function sourceLabel(source, t) {
  switch (source) {
    case 'blockchain-rpc': return t('intel.src.rpc');
    case 'defillama': return t('intel.src.defillama');
    case 'defillama:hacks': return t('intel.src.hacks');
    case 'registry+coingecko':
    case 'mixed:registry+coingecko': return t('intel.src.registryPrice');
    case 'mixed:rpc+goplus+coingecko':
    case 'mixed:rpc+registry+feeds':
    case 'mixed:rpc+goplus+explorer':
    case 'mixed:goplus+rpc':
    case 'mixed:goplus+registry+rpc':
    case 'mixed:defillama+incidents': return t('intel.src.mixed');
    case 'explorer-api': return t('intel.src.explorer');
    case 'goplus': return t('intel.src.scanner');
    case 'observed-health': return t('intel.src.health');
    default: return t('intel.src.generic');
  }
}
