/**
 * SMART MONEY — client-side watchlist state.
 * ---------------------------------------------------------------------------
 * Tracked wallets live in localStorage (device-private) and are synced to the
 * server using the device's push identity, exactly like order watches. When no
 * push identity exists yet we still track locally and POST on demand, so
 * "Track Wallet" works the moment the user taps it.
 */

import { apiBase } from './apiBase';

const KEY = 'fbt-smart-money-watch-v1';

function read() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function write(rows) {
  try { localStorage.setItem(KEY, JSON.stringify(rows)); } catch { /* ignore */ }
}

/** Tracked rows: [{id, chain, address, target, label, types, condition}] */
export function getTracked() {
  return read();
}

const canonical = (chain, address) => chain === 'solana'
  ? String(address || '') : String(address || '').toLowerCase(); // base58 is case-sensitive

export function isTracked(chain, address, target = 'wallet') {
  const a = canonical(chain, address);
  return read().some((r) => r.target === target && String(r.chain) === String(chain) && canonical(chain, r.address) === a);
}

export function trackWallet({ chain, address, label = null, target = 'wallet', types = null, condition = null }) {
  const rows = read();
  const addr = canonical(chain, address);
  const existing = rows.findIndex((r) => String(r.chain) === String(chain) && r.address === addr && r.target === target);
  const next = {
    id: existing >= 0 ? rows[existing].id : `${chain}:${addr}${target === 'token' ? ':token' : ''}`,
    chain,
    address: addr,
    label,
    target,
    types: types || (target === 'token'
      ? ['CONSENSUS_BUY', 'CONSENSUS_SELL', 'NETFLOW_REVERSAL']
      : ['LARGE_BUY', 'LARGE_SELL', 'EXCHANGE_DEPOSIT', 'EXCHANGE_WITHDRAWAL', 'LIQUIDITY_MOVEMENT', 'ACCUMULATION', 'DISTRIBUTION']),
    condition,
    createdAt: existing >= 0 ? rows[existing].createdAt : Date.now()
  };
  if (existing >= 0) rows[existing] = next;
  else rows.push(next);
  write(rows);
  void syncTracked().catch(() => {});
  return rows;
}

export function untrackWallet(chain, address, target = 'wallet') {
  const addr = canonical(chain, address);
  const rows = read().filter((r) => !(String(r.chain) === String(chain) && r.address === addr && r.target === target));
  write(rows);
  void syncTracked().catch(() => {});
  return rows;
}

/* ── server sync (best effort, reuses push identity) ──────────────────── */

async function pushIdentity() {
  try {
    // The order-watch system stores the subscription endpoint under a known
    // key; reuse it so alerts reach the same device.
    const sub = JSON.parse(localStorage.getItem('fbt-push-subscription') || 'null');
    if (sub?.endpoint) return sub.endpoint;
    const fcm = localStorage.getItem('fbt-fcm-token');
    if (fcm) return `fcm:${fcm}`;
  } catch { /* ignore */ }
  return null;
}

export async function syncTracked() {
  const identity = await pushIdentity();
  if (!identity) return { synced: false, reason: 'NO_PUSH_IDENTITY' };
  const rows = read();
  const lang = (localStorage.getItem('fbt-lang') || 'en').slice(0, 2);
  const res = await fetch(`${apiBase()}/v1/smart-money/watchlist`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identity, rows, lang })
  });
  if (!res.ok) throw new Error(`SYNC_HTTP_${res.status}`);
  return { synced: true, count: rows.length };
}

export async function pullAlerts() {
  const identity = await pushIdentity();
  if (!identity) return { alerts: [] };
  const res = await fetch(`${apiBase()}/v1/smart-money/alerts?identity=${encodeURIComponent(identity)}`, {
    headers: { accept: 'application/json' }
  });
  if (!res.ok) throw new Error(`ALERTS_HTTP_${res.status}`);
  return res.json();
}
