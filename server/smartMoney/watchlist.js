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

import { createHash } from 'node:crypto';
import { storeGet, storeSet } from '../store.js';
import { ALERTS } from './config.js';
import { getVerifiedIntelligence } from './intelligence.js';
import { labelledEvents } from './moneyFlow.js';
import { exchangeFor } from './registry.js';
import { verifiedToken } from '../../src/lib/smartMoneyEvidence.js';

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
    const normalAddress = chain === 'solana' ? address : address.toLowerCase();
    const id = String(r.id || `${chain}:${normalAddress}`).slice(0, 80);
    const target = r.target === 'token' ? 'token' : 'wallet';
    const old = all.find((w) => w.identity === identity && w.id === id
      && w.chain === chain && w.address === normalAddress && w.target === target);
    clean.push({
      id,
      identity,
      lang,
      target,
      chain,
      address: normalAddress,
      label: String(r.label || '').slice(0, 64) || null,
      types: cleanTypes(r.types ?? (target === 'token'
        ? ['CONSENSUS_BUY', 'CONSENSUS_SELL', 'NETFLOW_REVERSAL'] : null)),
      condition: r.condition && typeof r.condition === 'object'
        ? { signal: String(r.condition.signal || 'ACCUMULATION').toUpperCase() === 'DISTRIBUTION' ? 'DISTRIBUTION' : 'ACCUMULATION',
          confidence: Math.max(50, Math.min(99, Number(r.condition.confidence) || 75)),
          minWallets: Math.max(3, Math.min(25, Number(r.condition.minWallets) || 3)),
          fromUsd: Number(r.condition.fromUsd) > 0 ? Number(r.condition.fromUsd) : null,
          toUsd: Number(r.condition.toUsd) < 0 ? Number(r.condition.toUsd) : null }
        : null,
      // Never trust a client-supplied cursor or creation time: the device may
      // re-sync a local row on every visit, but it must not reset alert dedupe.
      lastSeenEventId: old?.lastSeenEventId || null,
      lastConsensusAt: old?.lastConsensusAt || null,
      lastConsensusNetUsd: old?.lastConsensusNetUsd ?? null,
      createdAt: old?.createdAt || Date.now()
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
  if (String(event.chainId) !== String(watch.chain)) return null;
  const involves = watch.target === 'token'
    ? event.token?.address === addr
    : event.from?.address === addr || event.to?.address === addr;
  if (!involves) return null;
  const isIncoming = event.to?.address === addr;
  switch (event.flow) {
    case 'cex_in':
      if (!watch.types.includes('EXCHANGE_DEPOSIT')) return null;
      return { type: 'EXCHANGE_DEPOSIT', title: 'Exchange deposit', body: `${event.exchange || 'Exchange'} deposit of ${fmt(event)}` };
    case 'cex_out':
      if (!watch.types.includes('EXCHANGE_WITHDRAWAL')) return null;
      return { type: 'EXCHANGE_WITHDRAWAL', title: 'Exchange withdrawal', body: `${event.exchange || 'Exchange'} withdrawal of ${fmt(event)}` };
    case 'dex_buy':
      if (!watch.types.includes('LARGE_BUY')) return null;
      return { type: 'LARGE_BUY', title: 'Router transfer (buy proxy)', body: `Possible buy: ${fmt(event)}. This single transfer is NOT a confirmed swap.` };
    case 'dex_sell':
      if (!watch.types.includes('LARGE_SELL')) return null;
      return { type: 'LARGE_SELL', title: 'Router transfer (sell proxy)', body: `Possible sell: ${fmt(event)}. This single transfer is NOT a confirmed swap.` };
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
export async function runAlertCycle(deliver, { now = Date.now(), events: injectedEvents = null, intelligence: injectedIntel = null } = {}) {
  const watches = await readWatchlist();
  if (!watches.length) return { checked: 0, fired: 0, delivered: 0 };
  const since = now - 24 * 3600_000;
  const verifiedTypes = new Set(['CONSENSUS_BUY', 'CONSENSUS_SELL', 'NETFLOW_REVERSAL', 'ACCUMULATION', 'DISTRIBUTION']);
  const needsVerified = watches.some((w) => w.target === 'token' && w.types?.some((t) => verifiedTypes.has(t)));
  const needsLegacy = watches.some((w) => w.types?.some((t) => !verifiedTypes.has(t)));
  // Tests may inject receipts; production reads the existing shared scanner.
  const recent = needsLegacy ? (injectedEvents ?? (await labelledEvents({ since })).events)
    .filter((e) => (e.timestamp || 0) >= since) : [];
  let intel = injectedIntel;
  if (needsVerified && !intel) {
    try { intel = await getVerifiedIntelligence({ window: '30m', now }); }
    catch { intel = { dataStatus: 'unavailable', consensus: [] }; }
  }
  const existing = await storeGet(ALERT_KEY, []);
  const alertLog = Array.isArray(existing) ? existing : [];
  const seenKeys = new Set(alertLog.map((a) => a.dedupKey));
  const updates = new Map();
  let fired = 0; let delivered = 0;

  async function emit(watch, match, dedupEvent, evidence = null, e = null) {
    // Watch ids are device-local ("1", "pos1", …). Include a hash of the
    // push identity or one subscriber's event suppresses another's alert.
    const scope = createHash('sha256').update(watch.identity).digest('hex').slice(0, 20);
    const dedupKey = `${scope}:${watch.id}:${dedupEvent}:${match.type}`;
    if (seenKeys.has(dedupKey)) return;
    const lastOfType = alertLog.find((a) => a.identity === watch.identity && a.watchId === watch.id && a.type === match.type);
    if (lastOfType && now - lastOfType.at < ALERTS.cooldownMs) return;
    seenKeys.add(dedupKey);
    fired++;
    const alert = {
      id: `sm:${scope}:${watch.id}:${dedupEvent}`.slice(0, 140), dedupKey,
      watchId: watch.id, identity: watch.identity, type: match.type,
      title: match.title, message: watch.label ? `${watch.label}: ${match.body}` : match.body,
      chain: watch.chain, address: watch.address, target: watch.target,
      txHash: e?.hash || null, explorerTx: e?.explorerTx || null,
      valueUsd: e?.valueUsd ?? evidence?.netFlowUsd ?? null,
      token: e?.token?.symbol || evidence?.symbol || null,
      evidence, at: now, read: false, delivered: false
    };
    alertLog.push(alert);
    try {
      const ok = await deliver(watch.identity, watch.lang, {
        tag: 'smart-money', title: `◈ ${match.title}`, body: alert.message,
        url: `/#/smart-money/${watch.target === 'token' ? 'token' : 'wallet'}/${watch.chain}/${watch.address}`,
        type: 'SMART_MONEY', alert
      });
      alert.delivered = Boolean(ok);
      if (ok) delivered++;
    } catch { alert.delivered = false; }
  }

  for (const watch of watches) {
    let newestId = watch.lastSeenEventId;
    for (const e of recent) {
      const match = alertForEvent(watch, e);
      if (!match) continue;
      await emit(watch, match, e.id, { classification: 'router-transfer-proxy',
        note: 'A transfer is not a verified trade. Check the transaction receipt.' }, e);
      newestId = e.id;
    }
    const patch = {};
    if (newestId !== watch.lastSeenEventId) patch.lastSeenEventId = newestId;

    if (watch.target === 'token' && needsVerified && watch.chain !== 'solana') {
      const fact = verifiedToken(intel, watch.chain, watch.address, { now, window: '30m' });
      // An empty, stale or under-quorum index is UNKNOWN, not zero net flow.
      // Never move a reversal baseline or emit a consensus alert from silence.
      if (fact && fact.lastAt >= now - 30 * 60_000
        && fact.lastAt > (watch.lastConsensusAt || 0)) {
        const minimum = watch.condition?.minWallets || 3;
        const confidence = watch.condition?.confidence || 75;
        const strongBuy = fact.signal === 'ACCUMULATION' && fact.independentBuyers >= minimum
          && fact.confidence != null && fact.confidence >= confidence;
        const strongSell = fact.signal === 'DISTRIBUTION' && fact.independentSellers >= minimum
          && fact.confidence != null && fact.confidence >= confidence;
        const evidence = {
          classification: 'verified-paired-swaps', chain: watch.chain, token: watch.address,
          window: '30m', buyers: fact.buyers, sellers: fact.sellers,
          independentBuyers: fact.independentBuyers, independentSellers: fact.independentSellers,
          netFlowUsd: fact.netFlowUsd, confidence: fact.confidence,
          sampledSwaps: fact.swaps, indexedAt: intel.indexedAt,
          note: 'Observed evidence strength, not probability of price movement.'
        };
        if (strongBuy && (watch.types.includes('CONSENSUS_BUY') || watch.types.includes('ACCUMULATION'))) {
          await emit(watch, { type: 'CONSENSUS_BUY', title: 'Verified accumulation',
            body: `${fact.independentBuyers} independent qualified groups bought ${fact.symbol} in the observed 30m · net $${Math.round(fact.netFlowUsd).toLocaleString('en-US')} · evidence ${fact.confidence}/100.` }, `consensus:${fact.lastAt}:buy`, evidence);
        }
        if (strongSell && (watch.types.includes('CONSENSUS_SELL') || watch.types.includes('DISTRIBUTION'))) {
          await emit(watch, { type: 'CONSENSUS_SELL', title: 'Verified distribution',
            body: `${fact.independentSellers} independent qualified groups sold ${fact.symbol} in the observed 30m · net $${Math.round(fact.netFlowUsd).toLocaleString('en-US')} · evidence ${fact.confidence}/100.` }, `consensus:${fact.lastAt}:sell`, evidence);
        }
        if (strongSell && watch.types.includes('NETFLOW_REVERSAL')
          && watch.condition?.fromUsd > 0 && watch.condition?.toUsd < 0
          && watch.lastConsensusNetUsd >= watch.condition.fromUsd
          && fact.netFlowUsd <= watch.condition.toUsd) {
          await emit(watch, { type: 'NETFLOW_REVERSAL', title: 'Verified flow reversal',
            body: `${fact.symbol} net flow changed from $${Math.round(watch.lastConsensusNetUsd).toLocaleString('en-US')} to $${Math.round(fact.netFlowUsd).toLocaleString('en-US')} in separate observed samples.` },
          `reversal:${fact.lastAt}`, { ...evidence, priorNetFlowUsd: watch.lastConsensusNetUsd });
        }
        patch.lastConsensusAt = fact.lastAt;
        patch.lastConsensusNetUsd = fact.netFlowUsd;
      }
    }
    if (Object.keys(patch).length) updates.set(`${watch.identity}:${watch.id}`, patch);
  }

  const nextWatches = watches.map((w) => ({ ...w, ...(updates.get(`${w.identity}:${w.id}`) || {}) }));
  await writeWatchlist(nextWatches);
  await storeSet(ALERT_KEY, alertLog.sort((a, b) => b.at - a.at).slice(0, 500));
  return { checked: watches.length, fired, delivered,
    verifiedStatus: needsVerified ? (intel?.dataStatus || 'unavailable') : 'not-requested' };
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
