/**
 * SMART MONEY — frontend API client.
 * ---------------------------------------------------------------------------
 * Talks to the FBT On-Chain Intelligence Layer (/api/v1/smart-money/*).
 * Abort-aware, timed, retried once on network failure only, and — exactly
 * like src/lib/whales.js — it NEVER falls back to invented data. When the
 * server says a metric is unavailable the UI renders the honest empty state.
 */

import { apiBase } from './apiBase.js';

const smBase = () => `${apiBase()}/v1/smart-money`;
/*
 * 30s, not 12s: a COLD serverless instance building the overview for the
 * first time legitimately needs 10-20s (seven chains + prices + DexScreener).
 * With 12s the client aborted exactly when the server was about to answer,
 * the user saw «اتصال برقرار نیست», pressed retry, hit another cold cache,
 * and aborted again — an infinite "no connection" loop over a working API.
 */
const TIMEOUT_MS = 30_000;

export const EVM_ADDR = /^0x[a-fA-F0-9]{40}$/;
export const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const EVM_TX = /^0x[a-fA-F0-9]{64}$/;

async function getJson(path, { signal, timeout = TIMEOUT_MS } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  if (signal) {
    if (signal.aborted) { clearTimeout(timer); throw new Error('ABORTED'); }
    signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  }
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch(`${smBase()}${path}`, { signal: ctrl.signal, headers: { accept: 'application/json' } });
      if (res.status === 429) {
        const err = new Error('RATE_LIMITED'); err.status = 429; throw err;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const err = new Error(`HTTP ${res.status} ${text.slice(0, 80)}`);
        err.status = res.status;
        if (res.status < 500) throw err;
        lastErr = err;
        continue;
      }
      clearTimeout(timer);
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (err?.name === 'AbortError') break;
      if (err?.status === 429) break;
      if (attempt === 0) await new Promise((r) => setTimeout(r, 600));
    }
  }
  clearTimeout(timer);
  throw lastErr || new Error('SMART_MONEY_FAILED');
}

async function send(method, path, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(`${smBase()}${path}`, {
      method,
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(j.error || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return j;
  } finally {
    clearTimeout(timer);
  }
}

/* ── read endpoints ───────────────────────────────────────────────────── */

export const fetchOverview = (window = '24h', signal) => getJson(`/overview?window=${window}`, { signal });
export const fetchWhales = (minUsd = 250_000, signal) => getJson(`/whales?minUsd=${minUsd}`, { signal });
export const fetchFlows = (signal) => getJson('/flows', { signal });
export const fetchLiquidity = (minUsd = 200_000, signal) => getJson(`/liquidity?minUsd=${minUsd}`, { signal });
export const fetchExchanges = (signal) => getJson('/exchanges', { signal });
export const fetchEarlyTokens = (limit = 12, signal) => getJson(`/early-tokens?limit=${limit}`, { signal });
export const fetchFreshWallets = (signal) => getJson('/fresh-wallets', { signal });

export function fetchWallet(chain, address, signal) {
  const c = chain === 'solana' ? 'solana' : chain;
  return getJson(`/wallet/${c}/${encodeURIComponent(address)}`, { signal, timeout: 30_000 });
}

export function fetchToken(chainId, address, window = '24h', signal) {
  return getJson(`/token/${chainId}/${encodeURIComponent(address)}?window=${window}`, { signal, timeout: 30_000 });
}

export const fetchAlerts = (identity, signal) =>
  identity ? getJson(`/alerts?identity=${encodeURIComponent(identity)}`, { signal, timeout: 8000 }) : Promise.resolve({ alerts: [] });

/* ── watchlist ───────────────────────────────────────────────────────── */

export const saveWatchlist = (identity, rows, lang = 'en') =>
  send('POST', '/watchlist', { identity, rows, lang });
export const fetchWatchlist = (identity) =>
  identity ? getJson(`/watchlist?identity=${encodeURIComponent(identity)}`, { timeout: 8000 }) : Promise.resolve({ rows: [] });
export const deleteWatch = (identity, id) =>
  send('DELETE', `/watchlist/${encodeURIComponent(id)}?identity=${encodeURIComponent(identity)}`);
export const markAlertsRead = (identity) => send('POST', '/alerts/read', { identity });

/* ── helpers ──────────────────────────────────────────────────────────── */

export function classifyQuery(q) {
  const s = String(q || '').trim();
  if (EVM_TX.test(s)) return { kind: 'tx', chain: 'evm', address: s.toLowerCase() };
  if (EVM_ADDR.test(s)) return { kind: 'address', chain: 'evm', address: s.toLowerCase() };
  if (SOL_ADDR.test(s)) return { kind: 'address', chain: 'solana', address: s };
  if (/^[a-zA-Z0-9._$-]{2,12}$/.test(s)) return { kind: 'symbol', query: s.toUpperCase() };
  return { kind: 'text', query: s };
}

export const fmtUsd = (n, digits = 1) => {
  if (n == null || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(digits)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${Math.round(abs)}`;
};

export const fmtPct = (n) => (n == null ? '—' : `${n > 0 ? '+' : ''}${n}%`);

export function shortAddr(a, chain) {
  if (!a) return '';
  if (chain === 'solana') return `${a.slice(0, 4)}…${a.slice(-4)}`;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function timeAgo(ts) {
  if (!ts) return '';
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/**
 * DexScreener chain SLUG → our numeric EVM chain id.
 * The early-token feed reports `chain` as a slug ('ethereum', 'bsc', 'base'…)
 * while every intelligence route takes the NUMERIC id. The Analyze button
 * used to hardcode chain 1 for all of them, so a Base or BSC token opened an
 * Ethereum token page whose data could never match — the "link to the data"
 * simply pointed at the wrong chain.
 */
export const DEX_CHAIN_IDS = Object.freeze({
  ethereum: 1,
  bsc: 56,
  polygon: 137,
  arbitrum: 42161,
  base: 8453,
  optimism: 10,
  avalanche: 43114,
  linea: 59144,
  sonic: 146
});

/** Numeric chain id for a DexScreener slug, or null when we cannot serve an
 *  on-chain intel page for it (e.g. solana tokens from the early feed). */
export function chainIdForSlug(slug) {
  return DEX_CHAIN_IDS[String(slug || '').toLowerCase()] ?? null;
}

/** Default EVM chain for an address lookup (Ethereum mainnet). */
export const DEFAULT_CHAIN = 1;
export const CHAIN_OPTIONS = [
  { id: 1, short: 'ETH', name: 'Ethereum' },
  { id: 56, short: 'BSC', name: 'BNB Chain' },
  { id: 137, short: 'POL', name: 'Polygon' },
  { id: 42161, short: 'ARB', name: 'Arbitrum' },
  { id: 8453, short: 'BASE', name: 'Base' },
  { id: 10, short: 'OP', name: 'Optimism' },
  { id: 43114, short: 'AVAX', name: 'Avalanche' },
  { id: 'solana', short: 'SOL', name: 'Solana' }
];
