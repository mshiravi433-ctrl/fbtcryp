/**
 * Client helpers for ETF + Gold spot (Alpha Vantage via our backend).
 * ---------------------------------------------------------------------------
 * The browser never sees ALPHA_VANTAGE_API_KEY. All calls go to /api/etf and
 * /api/gold. No synthetic fallbacks — an empty or failed response stays empty.
 */

import { apiBase } from './apiBase.js';

const TIMEOUT = 15_000;

async function getJson(path, { timeout = TIMEOUT } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${apiBase()}${path}`, {
      signal: ctrl.signal,
      headers: { accept: 'application/json' }
    });
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { ok: res.ok && body?.ok !== false, status: res.status, body, stale: res.headers.get('x-data-stale') === '1' };
  } finally {
    clearTimeout(timer);
  }
}

/** Full phase-1 ETF universe (or one category). One request — never N polls. */
export async function fetchEtfList({ category = null } = {}) {
  const qs = category ? `?category=${encodeURIComponent(category)}` : '';
  const { ok, status, body, stale } = await getJson(`/etf${qs}`);
  if (!body) {
    return {
      ok: false,
      error: 'EMPTY_RESPONSE',
      status,
      rows: [],
      byCategory: { bitcoin: [], ethereum: [], gold: [] },
      meta: null
    };
  }
  return {
    ok: ok && body.ok !== false,
    status,
    error: body.error || null,
    message: body.message || body.messageEn || null,
    rows: Array.isArray(body.rows) ? body.rows : [],
    byCategory: body.byCategory || { bitcoin: [], ethereum: [], gold: [] },
    failed: body.failed || [],
    partial: body.partial === true,
    universe: body.universe || null,
    meta: body.meta || null,
    stale: stale || body.meta?.stale === true,
    readOnly: true,
    executes: false,
    provider: body.provider || body.meta?.provider || 'alpha-vantage'
  };
}

export async function fetchEtfQuote(symbol) {
  const sym = encodeURIComponent(String(symbol || '').toUpperCase());
  const { ok, status, body, stale } = await getJson(`/etf/${sym}`);
  if (!body) return { ok: false, error: 'EMPTY_RESPONSE', status, quote: null, meta: null };
  return {
    ok: ok && body.ok !== false,
    status,
    error: body.error || null,
    message: body.message || body.messageEn || null,
    quote: body.quote || null,
    meta: body.meta || null,
    stale: stale || body.meta?.stale === true,
    readOnly: true,
    executes: false
  };
}

export async function fetchEtfProfile(symbol) {
  const sym = encodeURIComponent(String(symbol || '').toUpperCase());
  const { ok, status, body, stale } = await getJson(`/etf/${sym}/profile`);
  if (!body) return { ok: false, error: 'EMPTY_RESPONSE', status, profile: null, meta: null };
  return {
    ok: ok && body.ok !== false,
    status,
    error: body.error || null,
    message: body.message || body.messageEn || null,
    profile: body.profile || null,
    meta: body.meta || null,
    stale: stale || body.meta?.stale === true,
    readOnly: true,
    executes: false
  };
}

export async function fetchGoldSpot() {
  const { ok, status, body, stale } = await getJson('/gold/spot');
  if (!body) return { ok: false, error: 'EMPTY_RESPONSE', status, spot: null, meta: null };
  return {
    ok: ok && body.ok !== false,
    status,
    error: body.error || null,
    message: body.message || body.messageEn || null,
    spot: body.spot || null,
    meta: body.meta || null,
    stale: stale || body.meta?.stale === true,
    readOnly: true,
    executes: false
  };
}

export async function fetchGoldHistory({ interval = 'daily' } = {}) {
  const iv = encodeURIComponent(interval || 'daily');
  const { ok, status, body, stale } = await getJson(`/gold/history?interval=${iv}`);
  if (!body) return { ok: false, error: 'EMPTY_RESPONSE', status, history: null, meta: null };
  return {
    ok: ok && body.ok !== false,
    status,
    error: body.error || null,
    message: body.message || body.messageEn || null,
    history: body.history || null,
    meta: body.meta || null,
    stale: stale || body.meta?.stale === true,
    readOnly: true,
    executes: false
  };
}

export async function fetchEtfGoldStatus() {
  const { ok, status, body } = await getJson('/etf/status');
  return { ok, status, ...(body || { configured: false, status: 'UNAVAILABLE' }) };
}

export const ETF_CATEGORIES = Object.freeze(['bitcoin', 'ethereum', 'gold']);
