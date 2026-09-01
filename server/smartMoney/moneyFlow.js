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
  bsAddressCounters,
  bsTokenTransfers
} from './dataSources.js';
import { detectAccumulation, detectDistribution, pctChange } from './engines.js';
import { FLOORS, TTL, WINDOWS, EARLY_TOKEN, FRESH } from './config.js';

const HEX20 = /^0x[a-f0-9]{40}$/;

function shortAddr(a) {
  if (!a) return '';
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/* ── enrich a whale event with our labels ─────────────────────────────── */

function labelEvent(e) {
  const chainId = e.chainId;
  const fromEx = exchangeFor(chainId, e.from?.address);
  const toEx = exchangeFor(chainId, e.to?.address);
  const fromRouter = routerFor(chainId, e.from?.address);
  const toRouter = routerFor(chainId, e.to?.address);

  let direction = 'transfer'; // transfer | cex_in | cex_out | dex_buy | dex_sell
  let exchange = null;
  let dex = null;
  if (toEx) { direction = 'cex_in'; exchange = toEx.exchange; }
  else if (fromEx) { direction = 'cex_out'; exchange = fromEx.exchange; }
  else if (toRouter) { direction = 'dex_buy'; dex = toRouter.dex; }
  else if (fromRouter) { direction = 'dex_sell'; dex = fromRouter.dex; }

  return {
    ...e,
    from: { ...e.from, label: fromEx?.label || e.from?.label || null, exchange: fromEx?.exchange || null },
    to: { ...e.to, label: toEx?.label || e.to?.label || null, exchange: toEx?.exchange || null },
    flow: direction,
    exchange,
    dex
  };
}

/** Pull the whale stream (cached upstream) and label it.
 *  The underlying fetch touches live price/RPC upstreams; when they are all
 *  unreachable we degrade to an empty stream (and flag it) rather than
 *  letting a price outage 502 the whole intelligence layer — a temporarily
 *  empty feed is honest; an error page is not. */
export async function labelledEvents({ minUsd = FLOORS.whaleUsd, since = 0 } = {}) {
  try {
    const { value } = await withCache(`sm:events:${minUsd}:${since}`, 45_000, () =>
      fetchWhales({ minUsd, since, limit: 200 })
    );
    const events = (value?.events || []).map(labelEvent);
    return { events, partial: value?.partial, pricedCount: value?.pricedCount, total: value?.total, sourceUp: true };
  } catch {
    return { events: [], partial: true, pricedCount: 0, total: 0, sourceUp: false };
  }
}

/* ════════════════════════ Exchange flow ═══════════════════════════════ */

function flowForWindow(events, ms) {
  const cutoff = Date.now() - ms;
  let inflow = 0;
  let outflow = 0;
  let count = 0;
  const byExchange = new Map();
  for (const e of events) {
    if (e.timestamp && e.timestamp < cutoff) continue;
    if (e.valueUsd == null) continue;
    const ex = e.exchange;
    if (!ex) continue;
    const row = byExchange.get(ex) || { exchange: ex, inflow: 0, outflow: 0 };
    if (e.flow === 'cex_in') { inflow += e.valueUsd; row.inflow += e.valueUsd; count += 1; }
    else if (e.flow === 'cex_out') { outflow += e.valueUsd; row.outflow += e.valueUsd; count += 1; }
    byExchange.set(ex, row);
  }
  return {
    inflowUsd: Math.round(inflow),
    outflowUsd: Math.round(outflow),
    netUsd: Math.round(outflow - inflow),
    events: count,
    byExchange: [...byExchange.values()].map((r) => ({
      exchange: r.exchange,
      inflowUsd: Math.round(r.inflow),
      outflowUsd: Math.round(r.outflow),
      netUsd: Math.round(r.outflow - r.inflow)
    })).sort((a, b) => Math.abs(b.netUsd) - Math.abs(a.netUsd))
  };
}

export async function exchangeFlows() {
  const { events } = await labelledEvents({});
  const windows = {
    '24h': flowForWindow(events, WINDOWS.H24),
    '7d': flowForWindow(events, WINDOWS.D7),
    '30d': flowForWindow(events, WINDOWS.D30)
  };
  return {
    schema: 'fbt.smart-money-flows.v1',
    dataStatus: events.length ? 'live' : 'unavailable',
    at: Date.now(),
    windows,
    exchanges: registryManifest().exchanges,
    note: 'Flows include only transfers to/from curated, labelled exchange addresses. Unlabelled counterparties are never counted.'
  };
}

/* ════════════════════════ Whale board ══════════════════════════════════ */

export async function whaleBoard({ minUsd = FLOORS.whaleUsd } = {}) {
  const since = Date.now() - WINDOWS.D7;
  const { events, partial } = await labelledEvents({ minUsd, since });

  const wallets = new Map(); // key chain:addr
  for (const e of events) {
    if (e.valueUsd == null) continue;
    for (const side of ['from', 'to']) {
      const addr = e[side]?.address;
      if (!addr || !HEX20.test(addr)) continue;
      const key = `${e.chainId}:${addr}`;
      const row = wallets.get(key) || {
        address: addr,
        short: shortAddr(addr),
        chainId: e.chainId,
        chainShort: e.chainShort,
        chainName: e.chainName,
        chainColor: e.chainColor,
        movedUsd: 0,
        buys: 0,
        sells: 0,
        deposits: 0,
        withdrawals: 0,
        explorer: `https://${explorerHost(e.chainId)}/address/${addr}`,
        lastAction: null,
        lastAt: 0
      };
      row.movedUsd += e.valueUsd;
      if (side === 'to' && e.flow === 'dex_buy') row.buys += e.valueUsd;
      if (side === 'from' && e.flow === 'dex_sell') row.sells += e.valueUsd;
      if (side === 'to' && e.flow === 'cex_in') row.deposits += 1;
      if (side === 'from' && e.flow === 'cex_out') row.withdrawals += 1;
      if ((e.timestamp || 0) > row.lastAt) {
        row.lastAt = e.timestamp || 0;
        row.lastAction = describeAction(e, side);
      }
      wallets.set(key, row);
    }
  }

  const list = [...wallets.values()]
    .map((w) => ({
      ...w,
      movedUsd: Math.round(w.movedUsd),
      netUsd: Math.round(w.buys - w.sells),
      // Risk band heuristic from observed behaviour; full score lives on the
      // wallet detail page (analyzeWallet). Exchange flows = lower risk.
      riskBand: w.deposits + w.withdrawals >= 2 ? 'LOW' : w.movedUsd > 50_000_000 ? 'MEDIUM' : 'MEDIUM'
    }))
    .sort((a, b) => b.movedUsd - a.movedUsd)
    .slice(0, 50);

  return {
    schema: 'fbt.smart-money-whales.v1',
    dataStatus: list.length ? 'live' : 'unavailable',
    at: Date.now(),
    partial: !!partial,
    wallets: list
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
  if (e.flow === 'cex_in' && side === 'to') return `Depositing to ${e.exchange || 'exchange'}`;
  if (e.flow === 'cex_out' && side === 'from') return `Withdrawing from ${e.exchange || 'exchange'}`;
  if (e.flow === 'dex_buy' && side === 'to') return `Accumulating ${e.token?.symbol}`;
  if (e.flow === 'dex_sell' && side === 'from') return `Selling ${e.token?.symbol}`;
  return side === 'to' ? `Received ${e.token?.symbol}` : `Sent ${e.token?.symbol}`;
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
 */
export async function liquidityEvents({ minUsd = FLOORS.liquidityEventUsd, windowBlocks = 20 } = {}) {
  const out = [];
  for (const chainId of EVM_CHAIN_ORDER) {
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
    if (!goodRpc) continue; // every endpoint for this chain failed
    for (const log of logs) {
      const pair = String(log.address || '').toLowerCase();
      // Confirm the pair belongs to a known factory by reading token0/token1.
      const token0 = await pairToken(goodRpc, pair, '0x0dfe1681');
      const token1 = await pairToken(goodRpc, pair, '0xd21220a7');
      if (!token0 || !token1) continue;
      const isMint = log.topics?.[0] === PAIR_TOPICS.Mint;
      const pairRes = await dexPairsForTokens([token0, token1]);
      const pool = (pairRes.pairs || []).find((p) => p.pairAddress === pair) || pairRes.pairs?.[0];
      const valueUsd = pool?.liquidityUsd ?? null;
      if (valueUsd != null && valueUsd < minUsd) continue;
      out.push({
        id: `${chainId}:${log.transactionHash}:${log.logIndex}`,
        chainId,
        chainShort: cfg.short,
        chainColor: cfg.color,
        kind: isMint ? 'LP_ADDED' : 'LP_REMOVED',
        pair,
        token0,
        token1,
        symbols: [pool?.baseToken?.symbol, pool?.quoteToken?.symbol].filter(Boolean).join(' / ') || `${shortAddr(token0)}/${shortAddr(token1)}`,
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
  }
  out.sort((a, b) => (b.liquidityUsd || 0) - (a.liquidityUsd || 0));
  return {
    schema: 'fbt.smart-money-liquidity.v1',
    dataStatus: out.length ? 'live' : 'unavailable',
    at: Date.now(),
    events: out.slice(0, 40)
  };
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
    const profiles = await dexTokenProfiles();
    // Keep the freshest profiles; enrich in batches.
    const fresh = profiles.slice(0, 40);
    const byChain = new Map();
    for (const p of fresh) {
      const list = byChain.get(p.chain) || [];
      list.push(p);
      byChain.set(p.chain, list);
    }
    const found = [];
    for (const [chain, rows] of byChain) {
      const addresses = rows.map((r) => r.tokenAddress).filter((a) => HEX20.test(a));
      if (!addresses.length) continue;
      // DexScreener token endpoint accepts cross-chain addresses; request them.
      const { pairs } = await dexPairsForTokens(addresses);
      for (const p of pairs) {
        if (!p.baseToken?.address) continue;
        const ageHrs = p.ageMs ? p.ageMs / 3_600_000 : null;
        const smartWallets = countSmartInterest(p); // holder-agnostic proxy
        const qualifies =
          ageHrs != null &&
          ageHrs <= EARLY_TOKEN.maxAgeHours &&
          (p.liquidityUsd || 0) >= EARLY_TOKEN.minLiquidityUsd &&
          (p.volume?.h24 || 0) >= EARLY_TOKEN.minVolumeH24Usd;
        if (!qualifies) continue;
        found.push({
          address: p.baseToken.address,
          symbol: p.baseToken.symbol,
          name: p.baseToken.name,
          chain,
          ageHours: ageHrs != null ? Math.round(ageHrs * 10) / 10 : null,
          liquidityUsd: Math.round(p.liquidityUsd || 0),
          volumeH24: Math.round(p.volume?.h24 || 0),
          buysH24: p.txns?.h24?.buys ?? null,
          sellsH24: p.txns?.h24?.sells ?? null,
          smartWallets,
          fdv: p.fdv ?? null,
          risk: earlyRisk(p, ageHrs),
          pairCreatedAt: p.pairCreatedAt,
          dex: p.dexId
        });
      }
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

export async function freshWallets({ minCapitalUsd = FRESH.minCapitalUsd } = {}) {
  const { value } = await withCache('sm:fresh-wallets', TTL.freshWallets, async () => {
    const since = Date.now() - WINDOWS.H24;
    const { events } = await labelledEvents({ minUsd: minCapitalUsd, since });
    const candidates = new Map();
    for (const e of events) {
      for (const side of ['from', 'to']) {
        const addr = e[side]?.address;
        if (!addr || !HEX20.test(addr)) continue;
        if (exchangeFor(e.chainId, addr) || routerFor(e.chainId, addr)) continue; // skip labelled CEX/DEX
        const key = `${e.chainId}:${addr}`;
        const r = candidates.get(key) || { address: addr, chainId: e.chainId, chainShort: e.chainShort, movedUsd: 0, seenAt: Infinity };
        r.movedUsd += e.valueUsd || 0;
        r.seenAt = Math.min(r.seenAt, e.timestamp || Infinity);
        candidates.set(key, r);
      }
    }
    // Verify freshness cheaply: tx count must be very low (new wallet).
    const checked = [];
    for (const c of candidates.values()) {
      if (c.movedUsd < minCapitalUsd) continue;
      // eslint-disable-next-line no-await-in-loop
      const counters = await bsAddressCounters(c.chainId, c.address);
      const txCount = counters.txCount ?? null;
      if (txCount != null && txCount > 50) continue; // not fresh
      checked.push({
        address: c.address,
        short: shortAddr(c.address),
        chainId: c.chainId,
        chainShort: c.chainShort,
        capitalUsd: Math.round(c.movedUsd),
        txCount,
        firstSeen: Number.isFinite(c.seenAt) ? c.seenAt : null,
        interesting: c.movedUsd >= FRESH.interestingMinUsd
      });
    }
    checked.sort((a, b) => b.capitalUsd - a.capitalUsd);
    const interesting = checked.filter((c) => c.interesting).length;
    const capital = checked.reduce((s, c) => s + c.capitalUsd, 0);
    return {
      schema: 'fbt.smart-money-fresh.v1',
      dataStatus: checked.length ? 'live' : 'unavailable',
      at: Date.now(),
      window: '24h',
      newWallets: checked.length,
      interestingWallets: interesting,
      capitalUsd: Math.round(capital),
      wallets: checked.slice(0, 30),
      note: 'Fresh = first activity <24h and very low tx count. A new wallet with large capital is worth watching — it is not evidence of anything by itself.'
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

export { pctChange };
