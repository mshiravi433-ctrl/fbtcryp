/**
 * MONEY FLOW / LIQUIDITY / WHALE BOARD / EARLY TOKENS / FRESH WALLETS
 * ---------------------------------------------------------------------------
 * This is the aggregate layer: it turns the raw whale-event stream (the same
 * one server/whales.js already builds from real RPC/explorer data) plus
 * DexScreener pairs into the Smart Money surface:
 *
 *   · money flows     — CEX inflow/outflow per window from LABELLLED exchange
 *                       addresses only (registry.js). Unknown = unknown.
 *   · whale board     — wallets moving the most value in-window, with chain,
 *                       portfolio hint, 24h change, recent action, risk band
 *   · top buyers/sellers — per-token large movers (DEX counterparties)
 *   · liquidity events — real V2-fork Mint/Burn logs + large router transfers
 *   · early tokens     — fresh pairs with growing liquidity/volume and smart
 *                       wallet interest, always shown WITH risk, never a buy
 *   · fresh wallets    — newly-seen addresses moving real capital
 *
 * All values derive from observed events. No labels are guessed. Coverage is
 * reported so the UI can say "based on N observed events".
 */

import { withCache } from '../cache.js';
import { fetchWhales } from '../whales.js';
import { EVM_CHAINS, EVM_CHAIN_ORDER } from '../chainsLite.js';
import {
  exchangeFor,
  routerFor,
  isFactory,
  PAIR_TOPICS,
  registryManifest
} from './registry.js';
import {
  dexPairsForTokens,
  dexTokenProfiles,
  dexTokenBoosts,
  bsAddressCounters,
  bsAddressTags,
  BLOCKSCOUT
} from './dataSources.js';
import { mergeEvents, readEvents, rememberTags } from './eventStore.js';
import { detectAccumulation, detectDistribution, pctChange } from './engines.js';
import { FLOORS, TTL, WINDOWS, WINDOW_KEYS, EARLY_TOKEN, FRESH, DEX_SLUGS } from './config.js';

const HEX20 = /^0x[a-f0-9]{40}$/;
const ZERO = '0x0000000000000000000000000000000000000000';

/* One RPC scan serves every consumer: it runs at the LOWEST floor any caller
   uses and callers filter by their own `minUsd` afterwards. Scanning three
   times at three floors used to triple the upstream load for the same logs. */
const SCAN_FLOOR = Math.min(FLOORS.bigTradeUsd, FRESH.minCapitalUsd, 100_000);
const SCAN_TTL_MS = 45_000;
const TAG_LOOKUP_TIMEOUT_MS = 5_000;
const TAGS_PER_CHAIN = 50;

function shortAddr(a) {
  if (!a) return '';
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/* ── enrich a whale event with our labels ─────────────────────────────── */

/** Curated registry first (confidence high/medium, our own sourcing); the
 *  explorer's public name-tag second (confidence medium, source
 *  'blockscout-tag'). Unknown stays unknown. */
function exchangeOf(chainId, party) {
  const curated = exchangeFor(chainId, party?.address);
  if (curated) return { exchange: curated.exchange, label: curated.label, confidence: curated.confidence, source: 'registry' };
  const tag = party?.tag;
  if (tag?.kind === 'exchange' && tag.exchange) {
    return { exchange: tag.exchange, label: tag.label || tag.exchange, confidence: 'medium', source: 'blockscout-tag' };
  }
  return null;
}

function routerOf(chainId, party) {
  const curated = routerFor(chainId, party?.address);
  if (curated) return { dex: curated.dex, label: curated.label || curated.dex };
  const tag = party?.tag;
  if (tag?.kind === 'dex') return { dex: tag.label || 'DEX', label: tag.label || 'DEX' };
  return null;
}

/* Our own curated labels from whales.js — issuers/contracts, never wallets. */
const NON_WALLET_LABEL = /treasury|circle|^zero$|contract|^mint$|^burn$/i;

/**
 * True when a party is not a wallet anybody should «follow»: the zero
 * address, an exchange, a DEX router, a token/issuer contract, a bridge or
 * an MEV bot. The whale board and the fresh-wallet feed skip these — the
 * Binance hot wallet and 0x000…000 used to top the whale board.
 */
export function isNonWallet(chainId, party) {
  const addr = party?.address;
  if (!addr || !HEX20.test(addr) || addr === ZERO) return true;
  if (exchangeFor(chainId, addr) || routerFor(chainId, addr) || isFactory(chainId, addr)) return true;
  if (party.label && !party.tag && NON_WALLET_LABEL.test(party.label)) return true;
  const kind = party.tag?.kind;
  return kind === 'zero' || kind === 'exchange' || kind === 'dex' || kind === 'contract' || kind === 'bridge' || kind === 'mev';
}

export function labelEvent(e) {
  const chainId = e.chainId;
  const fromEx = exchangeOf(chainId, e.from);
  const toEx = exchangeOf(chainId, e.to);
  const fromRouter = routerOf(chainId, e.from);
  const toRouter = routerOf(chainId, e.to);

  // transfer | cex_in | cex_out | cex_internal | dex_buy | dex_sell | mint | burn
  let direction = 'transfer';
  let exchange = null;
  let dex = null;
  const isMint = e.kind === 'mint' || e.from?.address === ZERO;
  const isBurn = e.kind === 'burn' || e.to?.address === ZERO;
  if (isMint) direction = 'mint';
  else if (isBurn) direction = 'burn';
  else if (toEx && fromEx) { direction = 'cex_internal'; exchange = toEx.exchange; }
  else if (toEx) { direction = 'cex_in'; exchange = toEx.exchange; }
  else if (fromEx) { direction = 'cex_out'; exchange = fromEx.exchange; }
  else if (toRouter) { direction = 'dex_sell'; dex = toRouter.dex; }   // wallet → router = selling the token
  else if (fromRouter) { direction = 'dex_buy'; dex = fromRouter.dex; } // router → wallet = buying the token

  const fromLabel = fromEx?.label || fromRouter?.label || e.from?.tag?.label || e.from?.label || null;
  const toLabel = toEx?.label || toRouter?.label || e.to?.tag?.label || e.to?.label || null;

  return {
    ...e,
    from: { ...e.from, label: fromLabel, exchange: fromEx?.exchange || null, kind: e.from?.tag?.kind || (fromEx ? 'exchange' : fromRouter ? 'dex' : null) },
    to: { ...e.to, label: toLabel, exchange: toEx?.exchange || null, kind: e.to?.tag?.kind || (toEx ? 'exchange' : toRouter ? 'dex' : null) },
    flow: direction,
    exchange,
    exchangeSource: (toEx || fromEx)?.source || null,
    dex
  };
}

/* ── the observed-event stream ────────────────────────────────────────── */

/**
 * Scan the chains once per SCAN_TTL (shared by every caller), merge the scan
 * into the observed-event buffer, learn explorer name-tags for the largest
 * unlabelled counterparties, and return the LABELLED buffer.
 *
 * Why a buffer: the keyless scan covers ~2-3 minutes of blocks. Without
 * accumulation, «24h / 7d / 30d» were three names for the same three
 * minutes and exchange flow was whatever landed in that slice.
 */
async function scanOnce() {
  return withCache(`sm:scan:${SCAN_FLOOR}`, SCAN_TTL_MS, async () => {
    const scan = await fetchWhales({ minUsd: SCAN_FLOOR, limit: 400 });
    const buffer = await mergeEvents(scan.events || []);
    await learnTags(buffer.events);
    return {
      scanAt: Date.now(),
      partial: !!scan.partial,
      pricesOutage: !!scan.pricesOutage,
      failedChains: scan.failedChains || [],
      scanned: (scan.events || []).length,
      scanPriced: scan.pricedCount ?? 0
    };
  }, { swr: true });
}

/** Explorer name-tags for the largest counterparties we have not labelled
 *  yet — one bulk request per chain, bounded, failure-tolerant. */
async function learnTags(events) {
  const perChain = new Map();
  for (const e of events) {
    if (e.valueUsd == null) continue;
    if (!BLOCKSCOUT[e.chainId]) continue;
    for (const side of ['from', 'to']) {
      const p = e[side];
      if (!p?.address || !HEX20.test(p.address) || p.tag) continue;
      if (exchangeFor(e.chainId, p.address) || routerFor(e.chainId, p.address)) continue;
      const list = perChain.get(e.chainId) || new Map();
      list.set(p.address, Math.max(list.get(p.address) || 0, e.valueUsd));
      perChain.set(e.chainId, list);
    }
  }
  await Promise.all([...perChain].map(async ([chainId, map]) => {
    const addrs = [...map].sort((a, b) => b[1] - a[1]).slice(0, TAGS_PER_CHAIN).map(([a]) => a);
    try {
      const tags = await bsAddressTags(chainId, addrs, { timeout: TAG_LOOKUP_TIMEOUT_MS });
      if (tags.size) await rememberTags(chainId, tags);
    } catch { /* enrichment only */ }
  }));
}

/** Longest a page render waits for a fresh scan before answering from the
 *  observed buffer. The scan keeps running and lands in the buffer for the
 *  next request — a bounded wait is what keeps a cold instance under the
 *  client's 30s patience instead of painting «اتصال برقرار نیست». */
const SCAN_WAIT_MS = Number(process.env.SM_SCAN_WAIT_MS || 14_000);

function waitAtMost(promise, ms) {
  let timer;
  const gate = new Promise((resolve) => { timer = setTimeout(() => resolve({ timedOut: true }), ms); });
  return Promise.race([promise.then((v) => ({ value: v })), gate]).finally(() => clearTimeout(timer));
}

export async function labelledEvents({ minUsd = FLOORS.whaleUsd, since = 0 } = {}) {
  let scan = null;
  let sourceUp = true;
  let scanPending = false;
  try {
    const raced = await waitAtMost(scanOnce(), SCAN_WAIT_MS);
    if (raced.timedOut) scanPending = true;
    else scan = raced.value?.value ?? null;
  } catch {
    sourceUp = false; // scan failed — serve what was observed before, flagged
  }
  let buffer;
  try {
    buffer = await readEvents();
  } catch {
    buffer = { events: [], observedSince: null, size: 0, durable: false };
  }
  const events = [];
  for (const raw of buffer.events) {
    if (since && raw.timestamp && raw.timestamp < since) continue;
    if (raw.valueUsd != null && raw.valueUsd < minUsd) continue;
    if (raw.valueUsd == null && minUsd > SCAN_FLOOR) continue; // unpriced rows only at the base floor
    events.push(labelEvent(raw));
  }
  const pricedCount = events.filter((e) => e.valueUsd != null).length;
  return {
    events,
    partial: sourceUp && !scanPending ? !!scan?.partial : true,
    pricedCount,
    total: events.length,
    sourceUp,
    scanPending,
    scanAt: scan?.scanAt ?? null,
    observedSince: buffer.observedSince,
    bufferSize: buffer.size,
    durable: buffer.durable
  };
}

/** How much of a window the buffer actually covers (0..1). */
export function windowCoverage(observedSince, windowMs, now = Date.now()) {
  if (!observedSince) return 0;
  return Math.max(0, Math.min(1, (now - observedSince) / windowMs));
}

/* ════════════════════════ Exchange flow ═══════════════════════════════ */

function flowForWindow(events, ms, observedSince) {
  const now = Date.now();
  const cutoff = now - ms;
  let inflow = 0;
  let outflow = 0;
  let count = 0;
  let total = 0;
  const byExchange = new Map();
  for (const e of events) {
    if (e.timestamp && e.timestamp < cutoff) continue;
    if (e.valueUsd == null) continue;
    total += 1;
    const ex = e.exchange;
    if (!ex || (e.flow !== 'cex_in' && e.flow !== 'cex_out')) continue;
    const row = byExchange.get(ex) || { exchange: ex, inflow: 0, outflow: 0, events: 0 };
    if (e.flow === 'cex_in') { inflow += e.valueUsd; row.inflow += e.valueUsd; }
    else { outflow += e.valueUsd; row.outflow += e.valueUsd; }
    row.events += 1;
    count += 1;
    byExchange.set(ex, row);
  }
  const coverage = windowCoverage(observedSince, ms, now);
  return {
    inflowUsd: Math.round(inflow),
    outflowUsd: Math.round(outflow),
    netUsd: Math.round(outflow - inflow),
    events: count,
    observedEvents: total,
    /* live = labelled exchange flow observed; quiet = events observed but
       none touched a labelled exchange; unavailable = nothing observed. */
    dataStatus: count ? 'live' : total ? 'quiet' : 'unavailable',
    coverage: Math.round(coverage * 100) / 100,
    byExchange: [...byExchange.values()].map((r) => ({
      exchange: r.exchange,
      inflowUsd: Math.round(r.inflow),
      outflowUsd: Math.round(r.outflow),
      netUsd: Math.round(r.outflow - r.inflow),
      events: r.events
    })).sort((a, b) => Math.abs(b.netUsd) - Math.abs(a.netUsd))
  };
}

export function flowWindows(events, observedSince) {
  const out = {};
  for (const [key, ms] of Object.entries(WINDOW_KEYS)) out[key] = flowForWindow(events, ms, observedSince);
  return out;
}

export async function exchangeFlows({ stream = null } = {}) {
  const { events, observedSince, sourceUp, bufferSize } = stream || await labelledEvents({ minUsd: SCAN_FLOOR });
  const windows = flowWindows(events, observedSince);
  const observedExchanges = [...new Set(events.map((e) => e.exchange).filter(Boolean))].sort();
  return {
    schema: 'fbt.smart-money-flows.v2',
    dataStatus: events.length ? (sourceUp ? 'live' : 'stale') : 'unavailable',
    at: Date.now(),
    observedSince,
    observedEvents: bufferSize,
    windows,
    exchanges: registryManifest().exchanges,
    observedExchanges,
    note: 'Flows count only transfers to/from labelled exchange wallets (curated registry + the block explorer\u2019s public name-tags). Unlabelled counterparties are never counted. Windows are built from transfers observed while the scanner was running, not a full chain history.'
  };
}

/* ════════════════════════ Whale board ══════════════════════════════════ */

function behaviourOf(w) {
  const acc = w.buys + w.withdrawnUsd;
  const dist = w.sells + w.depositedUsd;
  if (acc === 0 && dist === 0) return 'TRANSFER';
  if (acc > dist * 1.5) return 'ACCUMULATING';
  if (dist > acc * 1.5) return 'DISTRIBUTING';
  return 'ROTATING';
}

/* Risk from OBSERVED behaviour only. Repeated exchange deposits or heavy
   selling = distribution risk (HIGH); withdrawing from exchanges into
   self-custody with no selling = LOW; anything else MEDIUM. The old
   ternary returned the same band on both branches — every row was MEDIUM. */
function riskBandOf(w, behaviour) {
  if (w.scam) return 'HIGH';
  if (w.deposits >= 2 || behaviour === 'DISTRIBUTING') return 'HIGH';
  if (behaviour === 'ACCUMULATING' && w.deposits === 0) return 'LOW';
  return 'MEDIUM';
}

export async function whaleBoard({ minUsd = FLOORS.whaleUsd, windowMs = WINDOWS.D7, stream = null } = {}) {
  const since = Date.now() - windowMs;
  const source = stream || await labelledEvents({ minUsd, since });
  const { partial, observedSince, sourceUp } = source;
  const events = source.events.filter((e) => (!since || !e.timestamp || e.timestamp >= since) && (e.valueUsd == null || e.valueUsd >= minUsd));

  const wallets = new Map(); // key chain:addr
  for (const e of events) {
    if (e.valueUsd == null) continue;
    if (e.flow === 'mint' || e.flow === 'burn' || e.flow === 'cex_internal') continue;
    for (const side of ['from', 'to']) {
      const party = e[side];
      if (isNonWallet(e.chainId, party)) continue;
      const addr = party.address;
      const key = `${e.chainId}:${addr}`;
      const row = wallets.get(key) || {
        address: addr,
        short: shortAddr(addr),
        label: party.tag?.kind === 'entity' ? party.tag.label : null,
        scam: party.tag?.kind === 'scam',
        chainId: e.chainId,
        chainShort: e.chainShort,
        chainName: e.chainName,
        chainColor: e.chainColor,
        movedUsd: 0,
        receivedUsd: 0,
        sentUsd: 0,
        buys: 0,
        sells: 0,
        deposits: 0,
        withdrawals: 0,
        depositedUsd: 0,
        withdrawnUsd: 0,
        events: 0,
        tokens: new Set(),
        explorer: `https://${explorerHost(e.chainId)}/address/${addr}`,
        lastAction: null,
        lastAt: 0
      };
      row.movedUsd += e.valueUsd;
      row.events += 1;
      if (e.token?.symbol) row.tokens.add(e.token.symbol);
      if (side === 'to') row.receivedUsd += e.valueUsd; else row.sentUsd += e.valueUsd;
      if (side === 'to' && e.flow === 'dex_buy') row.buys += e.valueUsd;
      if (side === 'from' && e.flow === 'dex_sell') row.sells += e.valueUsd;
      if (side === 'from' && e.flow === 'cex_in') { row.deposits += 1; row.depositedUsd += e.valueUsd; }
      if (side === 'to' && e.flow === 'cex_out') { row.withdrawals += 1; row.withdrawnUsd += e.valueUsd; }
      if ((e.timestamp || 0) >= row.lastAt) {
        row.lastAt = e.timestamp || 0;
        row.lastAction = describeAction(e, side);
      }
      wallets.set(key, row);
    }
  }

  const list = [...wallets.values()]
    .map((w) => {
      const behaviour = behaviourOf(w);
      return {
        address: w.address,
        short: w.short,
        label: w.label,
        chainId: w.chainId,
        chainShort: w.chainShort,
        chainName: w.chainName,
        chainColor: w.chainColor,
        movedUsd: Math.round(w.movedUsd),
        receivedUsd: Math.round(w.receivedUsd),
        sentUsd: Math.round(w.sentUsd),
        // Net capital into the wallet over the window (received − sent).
        netUsd: Math.round(w.receivedUsd - w.sentUsd),
        buys: Math.round(w.buys),
        sells: Math.round(w.sells),
        deposits: w.deposits,
        withdrawals: w.withdrawals,
        events: w.events,
        tokens: [...w.tokens].slice(0, 6),
        explorer: w.explorer,
        lastAction: w.lastAction,
        lastAt: w.lastAt,
        behaviour,
        riskBand: riskBandOf(w, behaviour)
      };
    })
    .sort((a, b) => b.movedUsd - a.movedUsd)
    .slice(0, 50);

  return {
    schema: 'fbt.smart-money-whales.v2',
    dataStatus: list.length ? (sourceUp ? 'live' : 'stale') : 'unavailable',
    at: Date.now(),
    window: windowMs === WINDOWS.D7 ? '7d' : windowMs === WINDOWS.H24 ? '24h' : `${Math.round(windowMs / 3600_000)}h`,
    observedSince,
    coverage: { events: events.length, priced: events.filter((e) => e.valueUsd != null).length },
    partial: !!partial,
    wallets: list,
    note: 'Ranked by observed large-transfer volume. Exchanges, DEX routers, bridges, MEV bots, token contracts and the zero address are excluded; net = received − sent over the window.'
  };
}

function explorerHost(chainId) {
  return {
    1: 'etherscan.io', 56: 'bscscan.com', 137: 'polygonscan.com',
    42161: 'arbiscan.io', 8453: 'basescan.org', 10: 'optimistic.etherscan.io',
    43114: 'snowtrace.io'
  }[chainId] || 'etherscan.io';
}

function describeAction(e, side) {
  const sym = e.token?.symbol || 'tokens';
  if (e.flow === 'cex_in' && side === 'from') return `Deposited ${sym} to ${e.exchange || 'exchange'}`;
  if (e.flow === 'cex_out' && side === 'to') return `Withdrew ${sym} from ${e.exchange || 'exchange'}`;
  if (e.flow === 'dex_buy' && side === 'to') return `Bought ${sym}${e.dex ? ` on ${e.dex}` : ''}`;
  if (e.flow === 'dex_sell' && side === 'from') return `Sold ${sym}${e.dex ? ` on ${e.dex}` : ''}`;
  const other = side === 'to' ? e.from : e.to;
  const who = other?.label ? ` ${side === 'to' ? 'from' : 'to'} ${other.label}` : '';
  return side === 'to' ? `Received ${sym}${who}` : `Sent ${sym}${who}`;
}

/* ════════════════════════ Top buyers/sellers per token ═════════════════ */

export async function tokenFlow(tokenAddress, chainId, windowKey = '24h') {
  const ms = WINDOWS[windowKey] || WINDOWS.H24;
  const cutoff = Date.now() - ms;
  const { events } = await labelledEvents({ minUsd: FLOORS.bigTradeUsd, since: cutoff });
  const ta = String(tokenAddress || '').toLowerCase();

  const buyers = new Map();
  const sellers = new Map();
  for (const e of events) {
    if (e.chainId !== Number(chainId)) continue;
    const match = e.token?.address === ta || e.token?.coingeckoId === ta;
    if (!match && e.token?.symbol !== String(tokenAddress || '').toUpperCase()) continue;
    if (e.timestamp && e.timestamp < cutoff) continue;
    if (e.valueUsd == null) continue;
    if (e.flow === 'dex_buy' && e.to?.address) {
      const r = buyers.get(e.to.address) || { address: e.to.address, short: shortAddr(e.to.address), usd: 0, amount: 0 };
      r.usd += e.valueUsd; r.amount += e.amount || 0;
      buyers.set(e.to.address, r);
    }
    if (e.flow === 'dex_sell' && e.from?.address) {
      const r = sellers.get(e.from.address) || { address: e.from.address, short: shortAddr(e.from.address), usd: 0, amount: 0 };
      r.usd += e.valueUsd; r.amount += e.amount || 0;
      sellers.set(e.from.address, r);
    }
  }
  const top = (m) => [...m.values()].sort((a, b) => b.usd - a.usd).slice(0, 20)
    .map((r) => ({ ...r, usd: Math.round(r.usd) }));
  return {
    schema: 'fbt.smart-money-tokenflow.v1',
    window: windowKey,
    dataStatus: buyers.size + sellers.size ? 'live' : 'unavailable',
    buyers: top(buyers),
    sellers: top(sellers)
  };
}

/* ════════════════════════ Liquidity events ════════════════════════════ */

function hexBig(h) { try { return BigInt(h || '0x0'); } catch { return 0n; } }
function topicAddr(t) { return t && t.length >= 64 ? '0x' + t.slice(-40).toLowerCase() : null; }

async function rpcCall(url, method, params) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
    });
    if (!res.ok) throw new Error(`rpc ${res.status}`);
    const j = await res.json();
    if (j.error) throw new Error(j.error.message);
    return j.result;
  } finally { clearTimeout(timer); }
}

/**
 * Scan recent blocks for V2-fork Mint (LP added) / Burn (LP removed) logs
 * emitted by pairs of known factories. Pair tokens are read by eth_call so the
 * event can be named and valued. This is REAL liquidity movement, key-free.
 *
 * PERFORMANCE CONTRACT: the old version walked the 7 chains SEQUENTIALLY and
 * made a DexScreener request PER LOG — a cold call could take minutes, which
 * blew straight through the client's timeout and painted the whole Smart
 * Money page as «اتصال برقرار نیست». Now every chain scans in parallel under
 * its own deadline, logs are capped per chain, and each chain prices all its
 * pairs through ONE batched DexScreener request.
 */
export async function liquidityEvents({ minUsd = FLOORS.liquidityEventUsd, windowBlocks = 20 } = {}) {
  const perChain = await Promise.allSettled(
    EVM_CHAIN_ORDER.map((chainId) => deadline(
      scanChainLiquidity(chainId, { minUsd, windowBlocks }),
      12_000
    ))
  );
  const out = [];
  for (const r of perChain) {
    if (r.status === 'fulfilled' && Array.isArray(r.value)) out.push(...r.value);
  }
  out.sort((a, b) => (b.liquidityUsd || 0) - (a.liquidityUsd || 0));
  return {
    schema: 'fbt.smart-money-liquidity.v1',
    dataStatus: out.length ? 'live' : 'unavailable',
    at: Date.now(),
    events: out.slice(0, 40)
  };
}

/** Race a promise against a deadline; the timer never outlives the race. */
function deadline(promise, ms) {
  let timer;
  const gate = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('DEADLINE')), ms); });
  return Promise.race([promise, gate]).finally(() => clearTimeout(timer));
}

const MAX_LIQUIDITY_LOGS_PER_CHAIN = 10;

async function scanChainLiquidity(chainId, { minUsd, windowBlocks }) {
  const cfg = EVM_CHAINS[chainId];
  const rpcs = cfg?.rpc?.length ? cfg.rpc : [];
  /*
   * Same endpoint fallback as the whale scan (whales.js): one dead public
   * RPC used to cost the chain its ENTIRE liquidity feed. Walk the list;
   * an endpoint that answers (even with zero Mint/Burn logs in the window)
   * is a valid result and stops the walk. The per-pair eth_calls below run
   * on the endpoint that produced the logs.
   */
  let logs = null;
  let goodRpc = null;
  for (const rpc of rpcs) {
    try {
      const latestHex = await rpcCall(rpc, 'eth_blockNumber', []);
      const latest = Number(BigInt(latestHex));
      const from = Math.max(0, latest - windowBlocks);
      let got = null;
      try {
        got = await rpcCall(rpc, 'eth_getLogs', [{
          fromBlock: '0x' + from.toString(16),
          toBlock: '0x' + latest.toString(16),
          topics: [[PAIR_TOPICS.Mint, PAIR_TOPICS.Burn]]
        }]);
      } catch {
        got = await rpcCall(rpc, 'eth_getLogs', [{
          fromBlock: '0x' + Math.max(0, latest - 4).toString(16),
          toBlock: '0x' + latest.toString(16),
          topics: [[PAIR_TOPICS.Mint, PAIR_TOPICS.Burn]]
        }]);
      }
      if (!Array.isArray(got)) got = [];
      logs = got;
      goodRpc = rpc;
      break;
    } catch {
      logs = null;
      goodRpc = null; // this endpoint unreachable — try the next one
    }
  }
  if (!goodRpc) return []; // every endpoint for this chain failed

  // Cap the per-chain work: the largest events carry the signal; a page
  // render does not need every micro Mint/Burn in the window.
  const capped = logs.slice(0, MAX_LIQUIDITY_LOGS_PER_CHAIN);

  // Resolve token0/token1 for the UNIQUE pairs, in parallel.
  const pairAddrs = [...new Set(capped.map((l) => String(l.address || '').toLowerCase()).filter(Boolean))];
  const pairTokens = new Map(); // pair → {token0, token1}
  await Promise.all(pairAddrs.map(async (pair) => {
    const [token0, token1] = await Promise.all([
      pairToken(goodRpc, pair, '0x0dfe1681'),
      pairToken(goodRpc, pair, '0xd21220a7')
    ]);
    if (token0 && token1) pairTokens.set(pair, { token0, token1 });
  }));

  // ONE batched DexScreener request for every token this chain touched.
  const tokenSet = new Set();
  for (const { token0, token1 } of pairTokens.values()) { tokenSet.add(token0); tokenSet.add(token1); }
  const pairRes = tokenSet.size ? await dexPairsForTokens([...tokenSet]) : { pairs: [] };
  const poolByAddress = new Map();
  for (const p of pairRes.pairs || []) {
    if (p.pairAddress) poolByAddress.set(p.pairAddress, p);
  }

  const out = [];
  for (const log of capped) {
    const pair = String(log.address || '').toLowerCase();
    const toks = pairTokens.get(pair);
    if (!toks) continue;
    const isMint = log.topics?.[0] === PAIR_TOPICS.Mint;
    const pool = poolByAddress.get(pair)
      || (pairRes.pairs || []).find((p) => p.baseToken?.address === toks.token0 || p.baseToken?.address === toks.token1);
    const valueUsd = pool?.liquidityUsd ?? null;
    if (valueUsd != null && valueUsd < minUsd) continue;
    out.push({
      id: `${chainId}:${log.transactionHash}:${log.logIndex}`,
      chainId,
      chainShort: cfg.short,
      chainColor: cfg.color,
      kind: isMint ? 'LP_ADDED' : 'LP_REMOVED',
      pair,
      token0: toks.token0,
      token1: toks.token1,
      symbols: [pool?.baseToken?.symbol, pool?.quoteToken?.symbol].filter(Boolean).join(' / ') || `${shortAddr(toks.token0)}/${shortAddr(toks.token1)}`,
      dex: pool?.dexId || null,
      liquidityUsd: valueUsd != null ? Math.round(valueUsd) : null,
      impact: valueUsd == null ? 'UNKNOWN' : valueUsd > 2_000_000 ? 'HIGH' : valueUsd > 500_000 ? 'MEDIUM' : 'LOW',
      hash: log.transactionHash,
      blockNumber: Number(BigInt(log.blockNumber)),
      timestamp: Date.now(),
      explorerTx: `${cfg.explorer}/tx/${log.transactionHash}`,
      explorerPool: `${cfg.explorer}/address/${pair}`
    });
  }
  return out;
}

async function pairToken(rpc, pair, selector) {
  try {
    const data = await rpcCall(rpc, 'eth_call', [{ to: pair, data: selector }, 'latest']);
    const addr = topicAddr(data);
    return addr && HEX20.test(addr) ? addr : null;
  } catch { return null; }
}

/* ════════════════════════ Early tokens ════════════════════════════════ */

export async function earlyTokens({ limit = 12 } = {}) {
  const { value } = await withCache('sm:early-tokens', TTL.earlyTokens, async () => {
    /*
     * Two independent keyless seeds instead of one: the token-profiles feed
     * alone goes quiet for stretches, which used to blank the whole Early
     * Detection panel. Boosted tokens are ALSO freshly-listed real tokens on
     * DexScreener — both seeds are then verified against real pairs below,
     * so nothing unverified is ever shown.
     */
    const [profiles, boosts] = await Promise.all([
      dexTokenProfiles(),
      dexTokenBoosts().catch(() => [])
    ]);
    const seen = new Set();
    const seeds = [];
    for (const p of [...profiles, ...boosts]) {
      const key = `${p.chain}:${p.tokenAddress}`;
      if (seen.has(key)) continue;
      seen.add(key);
      seeds.push(p);
    }
    // Keep the freshest profiles; enrich in batches.
    const fresh = seeds.slice(0, 60);
    const byChain = new Map();
    for (const p of fresh) {
      const list = byChain.get(p.chain) || [];
      list.push(p);
      byChain.set(p.chain, list);
    }
    /*
     * One row per token. The token endpoint answers with EVERY pair of the
     * address on EVERY chain, and the old loop pushed one row per pair and
     * stamped each with the SEED's chain — the page showed the same token
     * three times, all labelled with a chain it was not trading on. Now the
     * chain comes from the pair itself, pairs of one token are merged
     * (liquidity/volume summed, age = oldest pair) and the deepest pair
     * names the DEX.
     */
    const byToken = new Map(); // `${chain}:${address}` → aggregate
    for (const [seedChain, rows] of byChain) {
      const addresses = rows.map((r) => r.tokenAddress).filter((a) => HEX20.test(a));
      if (!addresses.length) continue;
      // DexScreener token endpoint accepts cross-chain addresses; request them.
      const { pairs } = await dexPairsForTokens(addresses);
      for (const p of pairs) {
        if (!p.baseToken?.address) continue;
        const chain = p.chain || seedChain;
        const key = `${chain}:${p.baseToken.address}`;
        const agg = byToken.get(key) || {
          address: p.baseToken.address,
          symbol: p.baseToken.symbol,
          name: p.baseToken.name,
          chain,
          liquidityUsd: 0,
          volumeH24: 0,
          buysH24: 0,
          sellsH24: 0,
          fdv: null,
          pairCreatedAt: null,
          deepest: null,
          pairs: 0
        };
        agg.pairs += 1;
        agg.liquidityUsd += p.liquidityUsd || 0;
        agg.volumeH24 += p.volume?.h24 || 0;
        agg.buysH24 += p.txns?.h24?.buys || 0;
        agg.sellsH24 += p.txns?.h24?.sells || 0;
        if (p.pairCreatedAt && (!agg.pairCreatedAt || p.pairCreatedAt < agg.pairCreatedAt)) agg.pairCreatedAt = p.pairCreatedAt;
        if (!agg.deepest || (p.liquidityUsd || 0) > (agg.deepest.liquidityUsd || 0)) agg.deepest = p;
        byToken.set(key, agg);
      }
    }
    const found = [];
    for (const agg of byToken.values()) {
      const ageHrs = agg.pairCreatedAt ? (Date.now() - agg.pairCreatedAt) / 3_600_000 : null;
      const qualifies =
        ageHrs != null &&
        ageHrs >= 0 &&
        ageHrs <= EARLY_TOKEN.maxAgeHours &&
        agg.liquidityUsd >= EARLY_TOKEN.minLiquidityUsd &&
        agg.volumeH24 >= EARLY_TOKEN.minVolumeH24Usd;
      if (!qualifies) continue;
      const p = agg.deepest || {};
      found.push({
        address: agg.address,
        symbol: agg.symbol,
        name: agg.name,
        chain: agg.chain,
        chainId: Object.keys(DEX_SLUGS).find((k) => DEX_SLUGS[k] === agg.chain) ? Number(Object.keys(DEX_SLUGS).find((k) => DEX_SLUGS[k] === agg.chain)) || null : null,
        ageHours: Math.round(ageHrs * 10) / 10,
        liquidityUsd: Math.round(agg.liquidityUsd),
        volumeH24: Math.round(agg.volumeH24),
        buysH24: agg.buysH24 || null,
        sellsH24: agg.sellsH24 || null,
        pairs: agg.pairs,
        smartWallets: countSmartInterest(p), // holder-agnostic proxy (null unless observed)
        fdv: p.fdv ?? null,
        priceUsd: p.priceUsd ?? null,
        priceChangeH24: p.priceChange?.h24 ?? null,
        risk: earlyRisk({ liquidityUsd: agg.liquidityUsd }, ageHrs),
        pairCreatedAt: agg.pairCreatedAt,
        dex: p.dexId || null,
        url: p.url || null
      });
    }
    found.sort((a, b) => b.volumeH24 - a.volumeH24);
    return {
      schema: 'fbt.smart-money-early.v1',
      dataStatus: found.length ? 'live' : 'unavailable',
      at: Date.now(),
      tokens: found.slice(0, limit),
      note: 'Observed new-token activity only. Never a buy recommendation: young, low-liquidity tokens are HIGH risk by definition.'
    };
  });
  return value;
}

function countSmartInterest(pair) {
  // Without per-holder tagging on the pair feed we cannot fabricate a smart
  // wallet count. Report null unless the aggregate flow layer has observed
  // large DEX buys into this token (attached by the overview builder).
  return pair.smartWallets ?? null;
}

function earlyRisk(p, ageHrs) {
  let score = 0;
  if ((p.liquidityUsd || 0) < 100_000) score += 2;
  else if ((p.liquidityUsd || 0) < 500_000) score += 1;
  if ((ageHrs ?? 99) < 24) score += 2;
  else if ((ageHrs ?? 99) < 72) score += 1;
  return score >= 3 ? 'HIGH' : score >= 1 ? 'MEDIUM' : 'LOW';
}

/* ════════════════════════ Fresh wallets ═══════════════════════════════ */

export async function freshWallets({ minCapitalUsd = FRESH.minCapitalUsd, stream = null } = {}) {
  const { value } = await withCache('sm:fresh-wallets', TTL.freshWallets, async () => {
    const since = Date.now() - WINDOWS.H24;
    const source = stream || await labelledEvents({ minUsd: minCapitalUsd, since });
    const events = source.events.filter((e) => e.valueUsd != null && e.valueUsd >= minCapitalUsd && (!e.timestamp || e.timestamp >= since));
    const candidates = new Map();
    for (const e of events) {
      if (e.flow === 'mint' || e.flow === 'burn' || e.flow === 'cex_internal') continue;
      for (const side of ['from', 'to']) {
        const party = e[side];
        if (isNonWallet(e.chainId, party)) continue; // CEX / DEX / contracts / zero / MEV never count
        const addr = party.address;
        const key = `${e.chainId}:${addr}`;
        const r = candidates.get(key) || { address: addr, chainId: e.chainId, chainShort: e.chainShort, movedUsd: 0, receivedUsd: 0, seenAt: Infinity };
        r.movedUsd += e.valueUsd || 0;
        if (side === 'to') r.receivedUsd += e.valueUsd || 0;
        r.seenAt = Math.min(r.seenAt, e.timestamp || Infinity);
        candidates.set(key, r);
      }
    }
    /*
     * Freshness is VERIFIED against the explorer's counters, never assumed:
     * a wallet is fresh only when the indexer answered and its lifetime
     * activity is tiny. The old feed kept rows whose counters never loaded
     * (txCount null) and starred a 32-tx wallet as «interesting» purely for
     * moving money — that is a whale, not a fresh wallet.
     */
    const toCheck = [...candidates.values()]
      .filter((c) => c.movedUsd >= minCapitalUsd && BLOCKSCOUT[c.chainId])
      .sort((a, b) => b.movedUsd - a.movedUsd)
      .slice(0, 16);
    const counterRows = await Promise.all(
      toCheck.map((c) => bsAddressCounters(c.chainId, c.address).catch(() => ({ dataStatus: 'unavailable', txCount: null })))
    );
    const checked = [];
    let verified = 0;
    for (let i = 0; i < toCheck.length; i += 1) {
      const c = toCheck[i];
      const counters = counterRows[i] || {};
      if (counters.dataStatus !== 'live' || !Number.isFinite(counters.txCount)) continue; // unverifiable → not shown
      verified += 1;
      const activity = counters.txCount + (counters.tokenTransfersCount || 0);
      if (activity > FRESH.maxActivityCount) continue; // not fresh
      checked.push({
        address: c.address,
        short: shortAddr(c.address),
        chainId: c.chainId,
        chainShort: c.chainShort,
        capitalUsd: Math.round(c.movedUsd),
        receivedUsd: Math.round(c.receivedUsd),
        txCount: counters.txCount,
        tokenTransfersCount: counters.tokenTransfersCount ?? null,
        firstSeen: Number.isFinite(c.seenAt) ? c.seenAt : null,
        interesting: c.receivedUsd >= FRESH.interestingMinUsd
      });
    }
    checked.sort((a, b) => b.capitalUsd - a.capitalUsd);
    const interesting = checked.filter((c) => c.interesting).length;
    const capital = checked.reduce((s, c) => s + c.capitalUsd, 0);
    return {
      schema: 'fbt.smart-money-fresh.v2',
      /* live = verified fresh wallets found; quiet = candidates were checked
         and none is fresh (an honest empty, not an outage); unavailable =
         nothing could be verified. */
      dataStatus: checked.length ? 'live' : verified ? 'quiet' : 'unavailable',
      at: Date.now(),
      window: '24h',
      candidates: toCheck.length,
      verified,
      newWallets: checked.length,
      interestingWallets: interesting,
      capitalUsd: Math.round(capital),
      wallets: checked.slice(0, 30),
      note: `Fresh = the explorer reports at most ${FRESH.maxActivityCount} lifetime transactions + token transfers and the wallet just moved ≥ $${Math.round(minCapitalUsd / 1000)}K. A new wallet with large capital is worth watching — it is not evidence of anything by itself.`
    };
  });
  return value;
}

/* ════════════════════════ Per-token accumulation from flow ═════════════ */

/**
 * Attach flow-derived signals to a token intel object: net buying from
 * observed large DEX trades, smart-money flow (wallets with a high smart
 * score), and exchange outflow. Runs inside token detail/overview.
 */
export async function tokenSignals(tokenAddress, chainId, windowKey = '24h') {
  const flow = await tokenFlow(tokenAddress, chainId, windowKey);
  const buyUsd = flow.buyers.reduce((s, r) => s + r.usd, 0);
  const sellUsd = flow.sellers.reduce((s, r) => s + r.usd, 0);
  const net = buyUsd - sellUsd;
  const scale = Math.max(buyUsd, sellUsd, 1);

  const accum = detectAccumulation({
    netBuying: Math.max(0, net / scale),
    smartMoneyBuying: flow.buyers.length ? Math.min(1, flow.buyers.length / 10) : null,
    exchangeOutflow: null
  });
  const distrib = detectDistribution({
    netSelling: Math.max(0, -net / scale),
    smartMoneySelling: flow.sellers.length ? Math.min(1, flow.sellers.length / 10) : null,
    exchangeInflow: null
  });
  return {
    schema: 'fbt.smart-money-tokensignals.v1',
    window: windowKey,
    dataStatus: buyUsd + sellUsd ? 'live' : 'unavailable',
    buyUsd: Math.round(buyUsd),
    sellUsd: Math.round(sellUsd),
    netUsd: Math.round(net),
    smartWallets: new Set([...flow.buyers.map((b) => b.address), ...flow.sellers.map((s) => s.address)]).size,
    accumulation: accum,
    distribution: distrib,
    topBuyers: flow.buyers,
    topSellers: flow.sellers
  };
}

export { pctChange, SCAN_FLOOR };
