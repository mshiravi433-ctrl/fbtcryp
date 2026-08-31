/**
 * SMART MONEY — WATCHLIST + ALERT ENGINE
 * ---------------------------------------------------------------------------
 * A user follows wallets (and optionally tokens) and picks which event types
 * alert them. The server periodically re-reads observed on-chain activity for
 * every tracked target, fires one alert per new matching event (deduplicated,
 * cooldown'd), and delivers it through the EXISTING push/FCM transport — no
 * second notification system is built.
 *
 * Privacy model, identical to server/watch.js:
 *   Stored:    a push identity (web-push endpoint or fcm: token), chain,
 *              address, chosen event types, per-row dedupe cursor, lang.
 *   NOT stored: the user's own wallet, balances, keys or anything that can
 *              authorise a transaction. Tracking never executes anything.
 */

import { storeGet, storeSet } from '../store.js';
import { ALERTS } from './config.js';
import { labelledEvents } from './moneyFlow.js';
import { exchangeFor } from './registry.js';

const WATCH_KEY = 'smart-money:watchlist:v1';
const ALERT_KEY = 'smart-money:alerts:v1';

const isId = (v) => typeof v === 'string' && v.length >= 10 && v.length <= 600; // endpoint or fcm token
const EVM = /^0x[a-fA-F0-9]{40}$/;
const SOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function validTarget(chain, address) {
  const a = String(address || '').trim();
  if (chain === 'solana') return SOL.test(a);
  return EVM.test(a) && [1, 56, 137, 42161, 8453, 10, 43114].includes(Number(chain));
}

function cleanTypes(types) {
  const list = Array.isArray(types) ? types : ['LARGE_BUY', 'LARGE_SELL', 'EXCHANGE_DEPOSIT', 'EXCHANGE_WITHDRAWAL', 'LIQUIDITY_MOVEMENT', 'ACCUMULATION', 'DISTRIBUTION'];
  return [...new Set(list.filter((t) => ALERTS.types.includes(t)))].slice(0, ALERTS.types.length);
}

export async function readWatchlist() {
  const rows = await storeGet(WATCH_KEY, []);
  return Array.isArray(rows) ? rows : [];
}

async function writeWatchlist(rows) {
  await storeSet(WATCH_KEY, rows);
}

/**
 * Replace the watch rows for one device identity.
 * Rows: [{id, chain, address, label?, types[], target:'wallet'|'token',
 *         condition?:{signal,confidence}}]
 */
export async function putWatchlist(identity, rows, lang = 'en') {
  if (!isId(identity)) throw new Error('BAD_IDENTITY');
  const all = await readWatchlist();
  const others = all.filter((r) => r.identity !== identity);
  const clean = [];
  for (const r of Array.isArray(rows) ? rows.slice(0, ALERTS.maxPerIdentity) : []) {
    const chain = r.chain === 'solana' ? 'solana' : Number(r.chain);
    const address = String(r.address || '').trim();
    if (!validTarget(chain, address)) continue;
    clean.push({
      id: String(r.id || `${chain}:${address}`).slice(0, 80),
      identity,
      lang,
      target: r.target === 'token' ? 'token' : 'wallet',
      chain,
      address: address.toLowerCase(),
      label: String(r.label || '').slice(0, 64) || null,
      types: cleanTypes(r.types),
      condition: r.condition && typeof r.condition === 'object'
        ? { signal: String(r.condition.signal || 'ACCUMULATION').toUpperCase(), confidence: Math.max(50, Math.min(99, Number(r.condition.confidence) || 75)) }
        : null,
      lastSeenEventId: r.lastSeenEventId || null,
      createdAt: r.createdAt || Date.now()
    });
  }
  await writeWatchlist([...others, ...clean]);
  return { ok: true, count: clean.length };
}

export async function deleteWatch(identity, id) {
  if (!isId(identity)) throw new Error('BAD_IDENTITY');
  const all = await readWatchlist();
  const next = all.filter((r) => !(r.identity === identity && r.id === id));
  await writeWatchlist(next);
  return { ok: true };
}

export async function readAlerts(identity, { limit = 50 } = {}) {
  const all = await storeGet(ALERT_KEY, []);
  const rows = Array.isArray(all) ? all : [];
  return rows
    .filter((a) => !identity || a.identity === identity)
    .sort((a, b) => b.at - a.at)
    .slice(0, limit);
}

/* ── event → alert mapping ────────────────────────────────────────────── */

function alertForEvent(watch, event) {
  const addr = watch.address;
  const involves = event.from?.address === addr || event.to?.address === addr ||
    (watch.target === 'token' && (event.token?.address === addr || event.token?.symbol === watch.label));
  if (!involves) return null;
  const isIncoming = event.to?.address === addr || event.to?.address?.endsWith?.(addr.slice(-8));
  switch (event.flow) {
    case 'cex_in':
      if (!watch.types.includes('EXCHANGE_DEPOSIT')) return null;
      return { type: 'EXCHANGE_DEPOSIT', title: 'Exchange deposit', body: `${event.exchange || 'Exchange'} deposit of ${fmt(event)}` };
    case 'cex_out':
      if (!watch.types.includes('EXCHANGE_WITHDRAWAL')) return null;
      return { type: 'EXCHANGE_WITHDRAWAL', title: 'Exchange withdrawal', body: `${event.exchange || 'Exchange'} withdrawal of ${fmt(event)}` };
    case 'dex_buy':
      if (!watch.types.includes('LARGE_BUY')) return null;
      return { type: 'LARGE_BUY', title: 'Large buy', body: `Bought ${fmt(event)}` };
    case 'dex_sell':
      if (!watch.types.includes('LARGE_SELL')) return null;
      return { type: 'LARGE_SELL', title: 'Large sell', body: `Sold ${fmt(event)}` };
    default:
      if (watch.types.includes('TRANSFER')) {
        return { type: 'TRANSFER', title: 'Whale movement', body: `${isIncoming ? 'Received' : 'Sent'} ${fmt(event)}` };
      }
      return null;
  }
}

function fmt(e) {
  const sym = e.token?.symbol || 'tokens';
  const usd = e.valueUsd != null ? `$${compactUsd(e.valueUsd)}` : '';
  return `${usd ? usd + ' ' : ''}${sym}`.trim();
}

function compactUsd(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return String(Math.round(n));
}

/**
 * One evaluation cycle. Pulls the labelled event stream (cached/shared with
 * the board), matches every watch row, persists new alerts, and calls
 * `deliver(identity, lang, payload)` for each (the caller wires push/FCM).
 *
 * Pure evaluator: returns {checked, fired, delivered}. Delivery failures are
 * reported, never silenced into a false success.
 */
export async function runAlertCycle(deliver, { now = Date.now(), events: injectedEvents = null } = {}) {
  const watches = await readWatchlist();
  if (!watches.length) return { checked: 0, fired: 0, delivered: 0 };

  const since = now - 24 * 3600_000;
  // `events` may be injected by tests to prove matching/delivery deterministically;
  // production pulls the real labelled stream.
  const { events } = injectedEvents
    ? { events: injectedEvents }
    : await labelledEvents({ since });
  const recent = events.filter((e) => (e.timestamp || 0) >= since);

  const existing = await storeGet(ALERT_KEY, []);
  const alertLog = Array.isArray(existing) ? existing : [];
  const seenKeys = new Set(alertLog.map((a) => a.dedupKey));

  let fired = 0;
  let delivered = 0;
  const updates = new Map();

  for (const watch of watches) {
    let newestId = watch.lastSeenEventId;
    for (const e of recent) {
      const match = alertForEvent(watch, e);
      if (!match) continue;
      const dedupKey = `${watch.id}:${e.id}:${match.type}`;
      if (seenKeys.has(dedupKey)) continue;
      // cooldown per watch+type
      const lastOfType = alertLog.find((a) => a.watchId === watch.id && a.type === match.type);
      if (lastOfType && now - lastOfType.at < ALERTS.cooldownMs) continue;

      fired += 1;
      seenKeys.add(dedupKey);
      const alert = {
        id: `sm:${watch.id}:${e.id}`.slice(0, 100),
        dedupKey,
        watchId: watch.id,
        identity: watch.identity,
        type: match.type,
        title: match.title,
        message: watch.label ? `${watch.label}: ${match.body}` : match.body,
        chain: watch.chain,
        address: watch.address,
        txHash: e.hash || null,
        explorerTx: e.explorerTx || null,
        valueUsd: e.valueUsd ?? null,
        token: e.token?.symbol || null,
        at: now,
        read: false
      };
      alertLog.push(alert);

      let ok = false;
      try {
        ok = await deliver(watch.identity, watch.lang, {
          tag: 'smart-money',
          title: `🐋 Whale Alert — ${match.title}`,
          body: alert.message,
          url: `/#/smart-money/wallet/${watch.chain}/${watch.address}`,
          type: 'SMART_MONEY',
          alert
        });
      } catch {
        ok = false;
      }
      if (ok) delivered += 1;
      newestId = e.id;
    }
    if (newestId !== watch.lastSeenEventId) updates.set(watch.id, newestId);
  }

  // persist cursors + alerts (cap log size)
  const nextWatches = watches.map((w) => updates.has(w.id) ? { ...w, lastSeenEventId: updates.get(w.id) } : w);
  await writeWatchlist(nextWatches);
  await storeSet(ALERT_KEY, alertLog.sort((a, b) => b.at - a.at).slice(0, 500));

  return { checked: watches.length, fired, delivered };
}

/** Mark alerts read for an identity. */
export async function markAlertsRead(identity) {
  const all = await storeGet(ALERT_KEY, []);
  const rows = Array.isArray(all) ? all : [];
  let changed = false;
  for (const a of rows) {
    if ((!identity || a.identity === identity) && !a.read) { a.read = true; changed = true; }
  }
  if (changed) await storeSet(ALERT_KEY, rows);
  return { ok: true, changed };
}

export { exchangeFor };
