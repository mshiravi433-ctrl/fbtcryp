/**
 * SMART MONEY — ORCHESTRATOR / PUBLIC FACADE
 * ---------------------------------------------------------------------------
 * FBT's On-Chain Intelligence Layer. The routes in server/app.js call these
 * functions only; everything is cached and aggregate-first so a page render
 * never re-reads blockchain history (performance contract: dashboard < 1.5s
 * cached, lookups < 2s, alerts < 10s).
 *
 * Architecture (data → insight):
 *   Data ingestion (whales.js RPC/explorer, DexScreener, Blockscout, Solscan)
 *     → normalize & label (registry.js)
 *     → wallet intelligence / token intelligence
 *     → flow engine → detection engines (accumulation/distribution/risk)
 *     → risk & reputation scores → alerts → AI explanation
 *
 * Nothing here executes trades. It observes, scores and notifies.
 */
import { withCache } from '../cache.js';
import { TTL, WINDOWS, FLOORS } from './config.js';
import { labelledEvents, whaleBoard, exchangeFlows, earlyTokens, freshWallets, liquidityEvents, tokenSignals, windowCoverage, isNonWallet, SCAN_FLOOR } from './moneyFlow.js';
import { analyzeWallet } from './walletIntel.js';
import { analyzeToken } from './tokenIntel.js';
import { registryManifest } from './registry.js';
import { detectAccumulation, detectDistribution, pctChange } from './engines.js';
import {
  readWatchlist, putWatchlist, deleteWatch, readAlerts, runAlertCycle, markAlertsRead
} from './watchlist.js';

const compactUsd = (n) => {
  if (n == null) return null;
  const abs = Math.abs(n);
  if (abs >= 1e9) return { text: `${(n / 1e9).toFixed(2)}B`, value: n };
  if (abs >= 1e6) return { text: `${(n / 1e6).toFixed(1)}M`, value: n };
  if (abs >= 1e3) return { text: `${(n / 1e3).toFixed(0)}K`, value: n };
  return { text: String(Math.round(n)), value: n };
};

/* ════════════════════════ Overview ════════════════════════════════════ */

/**
 * Smart Money overview: activity metrics, per-token accumulation ranking,
 * exchange net flow, early detection feed, recent whale alerts.
 *
 * `window` is the headline comparison window; we always compute 24h/7d/30d
 * flow windows and let the client switch without a refetch.
 */
export async function getOverview({ window: winKey = '24h' } = {}) {
  const { value } = await withCache(`sm:overview:${winKey}`, TTL.overview, () => buildOverview(winKey), { swr: true });
  return value;
}

/** Resolve `p` or fall back to null at the deadline — a slow sub-feed must
 *  never hold the whole overview past the client's patience. */
function within(p, ms) {
  let timer;
  const gate = new Promise((resolve) => { timer = setTimeout(() => resolve(null), ms); });
  return Promise.race([p, gate]).finally(() => clearTimeout(timer));
}

async function buildOverview(winKey) {
  const winMs = WINDOWS[winKey] || WINDOWS.H24;
  const now = Date.now();
  const cutoff = now - winMs;
  const prevCutoff = now - winMs * 2;

  /* ONE stream read feeds every aggregate below (flows, whale board, fresh
     wallets all used to re-read and re-filter it independently). */
  const stream = await labelledEvents({ minUsd: SCAN_FLOOR });
  const { events, partial, observedSince, sourceUp, scanPending, bufferSize } = stream;
  const whaleEvents = events.filter((e) => e.valueUsd != null && e.valueUsd >= FLOORS.whaleUsd);
  const inWin = whaleEvents.filter((e) => (e.timestamp || 0) >= cutoff);
  const prevWin = whaleEvents.filter((e) => (e.timestamp || 0) >= prevCutoff && (e.timestamp || 0) < cutoff);

  /* A «previous window» comparison is only honest when the buffer actually
     reaches back that far; otherwise changePct is null and the UI shows no
     arrow rather than «+100%» against an empty past. */
  const coverageNow = windowCoverage(observedSince, winMs, now);
  const havePrev = windowCoverage(observedSince, winMs * 2, now) >= 0.95;
  const pct = (a, b) => (havePrev ? pctChange(a, b) : null);

  // Aggregate activity metrics
  const whaleActivity = inWin.length;
  const whaleActivityPrev = prevWin.length;
  const isAcc = (e) => e.flow === 'dex_buy' || e.flow === 'cex_out';
  const isDist = (e) => e.flow === 'dex_sell' || e.flow === 'cex_in';
  const sum = (rows, pred) => rows.filter(pred).reduce((s, e) => s + e.valueUsd, 0);
  const accumulationNow = sum(inWin, isAcc);
  const accumulationPrev = sum(prevWin, isAcc);
  const distributionNow = sum(inWin, isDist);
  const distributionPrev = sum(prevWin, isDist);
  const labelledNow = inWin.filter((e) => isAcc(e) || isDist(e)).length;

  const flows = await exchangeFlows({ stream });
  const flowWin = flows.windows[winKey] || flows.windows['24h'];

  // Per-token accumulation ranking — LABELLED flow only. Plain wallet-to-
  // wallet transfers say nothing about buying or selling, so a token whose
  // whole window is unlabelled transfers is reported NEUTRAL, never
  // «ACCUMULATION» on 0/0 as before.
  const byToken = new Map();
  for (const e of inWin) {
    if (!e.token?.symbol) continue;
    if (e.flow === 'mint' || e.flow === 'burn' || e.flow === 'cex_internal') continue;
    const key = `${e.chainId}:${e.token.address || e.token.symbol}`;
    const r = byToken.get(key) || {
      symbol: e.token.symbol,
      name: e.token.name,
      chainShort: e.chainShort,
      chainId: e.chainId,
      address: e.token.address || null,
      coingeckoId: e.token.coingeckoId || null,
      buy: 0, sell: 0, cexIn: 0, cexOut: 0, transfer: 0, events: 0, labelled: 0, wallets: new Set()
    };
    r.events += 1;
    if (e.flow === 'dex_buy') { r.buy += e.valueUsd; r.labelled += 1; }
    else if (e.flow === 'dex_sell') { r.sell += e.valueUsd; r.labelled += 1; }
    else if (e.flow === 'cex_in') { r.cexIn += e.valueUsd; r.labelled += 1; }
    else if (e.flow === 'cex_out') { r.cexOut += e.valueUsd; r.labelled += 1; }
    else r.transfer += e.valueUsd;
    for (const side of ['from', 'to']) if (e[side]?.address && !isNonWallet(e.chainId, e[side])) r.wallets.add(e[side].address);
    byToken.set(key, r);
  }
  const tokenActivity = [...byToken.values()].map((r) => {
    const net = r.buy + r.cexOut - r.sell - r.cexIn;
    const scale = Math.max(r.buy + r.cexOut, r.sell + r.cexIn, 1);
    const accum = detectAccumulation({
      netBuying: r.labelled ? Math.max(0, net) / scale : null,
      exchangeOutflow: r.cexOut > 0 ? Math.min(1, r.cexOut / scale) : null,
      smartMoneyBuying: r.labelled >= 3 ? Math.min(1, r.labelled / 10) : null
    });
    const distrib = detectDistribution({
      netSelling: r.labelled ? Math.max(0, -net) / scale : null,
      exchangeInflow: r.cexIn > 0 ? Math.min(1, r.cexIn / scale) : null
    });
    let signal = 'NEUTRAL';
    if (r.labelled) {
      if (accum.detected && !distrib.detected) signal = 'ACCUMULATION';
      else if (distrib.detected && !accum.detected) signal = 'DISTRIBUTION';
      else if (net > 0) signal = 'ACCUMULATION';
      else if (net < 0) signal = 'DISTRIBUTION';
    }
    return {
      symbol: r.symbol,
      name: r.name,
      chainShort: r.chainShort,
      chainId: r.chainId,
      address: r.address,
      coingeckoId: r.coingeckoId,
      buy: Math.round(r.buy), sell: Math.round(r.sell),
      cexIn: Math.round(r.cexIn), cexOut: Math.round(r.cexOut),
      transferUsd: Math.round(r.transfer),
      totalUsd: Math.round(r.buy + r.sell + r.cexIn + r.cexOut + r.transfer),
      netUsd: Math.round(net),
      events: r.events,
      labelledEvents: r.labelled,
      wallets: r.wallets.size,
      accumulation: r.labelled ? accum.confidence : null,
      distribution: r.labelled ? distrib.confidence : null,
      signal
    };
  }).sort((a, b) => (Math.abs(b.netUsd) - Math.abs(a.netUsd)) || (b.totalUsd - a.totalUsd)).slice(0, 10);

  const [early, fresh, liquidity, whales] = await Promise.all([
    within(earlyTokens({ limit: 8 }).catch(() => null), 10_000),
    within(freshWallets({ stream }).catch(() => null), 10_000),
    within(liquidityEvents({ windowBlocks: 8 }).catch(() => null), 12_000),
    within(whaleBoard({ stream, windowMs: Math.max(winMs, WINDOWS.H24) }).catch(() => null), 12_000)
  ]);

  /*
   * `dataStatus` drives the page-level «اتصال برقرار نیست» banner, so it must
   * mean "EVERYTHING is dark", not "the whale stream is momentarily quiet".
   * The whale-stream-specific state travels separately as `streamStatus`
   * so the metric tiles can show honest em-dashes while the live sections
   * keep rendering:
   *   live  — a scan answered and the buffer has events
   *   stale — the scan failed/timed out but earlier observations exist
   *   unavailable — nothing observed at all
   */
  const anyLive =
    events.length > 0 ||
    (early?.tokens?.length || 0) > 0 ||
    (liquidity?.events?.length || 0) > 0 ||
    (whales?.wallets?.length || 0) > 0 ||
    (fresh?.wallets?.length || 0) > 0;
  const streamStatus = events.length ? (sourceUp && !scanPending ? 'live' : 'stale') : 'unavailable';

  return {
    schema: 'fbt.smart-money-overview.v2',
    at: now,
    window: winKey,
    dataStatus: anyLive ? 'live' : 'unavailable',
    streamStatus,
    partial: !!partial,
    coverage: {
      events: whaleEvents.length,
      inWindow: inWin.length,
      labelledInWindow: labelledNow,
      priced: whaleEvents.filter((e) => e.valueUsd != null).length,
      observedEvents: bufferSize,
      observedSince,
      windowCoverage: Math.round(coverageNow * 100) / 100,
      comparable: havePrev,
      note: 'Metrics derive from large on-chain transfers observed while the scanner was running (not a full chain history). Unlabelled counterparties are never counted as exchange or DEX flow.'
    },
    metrics: {
      whaleActivity: { value: whaleActivity, changePct: pct(whaleActivity, whaleActivityPrev) },
      accumulation: { valueUsd: Math.round(accumulationNow), changePct: pct(accumulationNow, accumulationPrev), events: inWin.filter(isAcc).length },
      distribution: { valueUsd: Math.round(distributionNow), changePct: pct(distributionNow, distributionPrev), events: inWin.filter(isDist).length },
      exchangeInflow: compactUsd(flowWin.inflowUsd),
      exchangeOutflow: compactUsd(flowWin.outflowUsd),
      netFlow: compactUsd(flowWin.netUsd),
      flowStatus: flowWin.dataStatus,
      flowEvents: flowWin.events
    },
    flows,
    tokenActivity,
    earlyTokens: early,
    freshWallets: fresh,
    liquidityEvents: liquidity,
    whales: whales?.wallets?.slice(0, 10) || []
  };
}

/* ════════════════════════ Pass-through API ════════════════════════════ */

export {
  analyzeWallet,
  analyzeToken,
  tokenSignals,
  whaleBoard,
  exchangeFlows,
  earlyTokens,
  freshWallets,
  liquidityEvents,
  readWatchlist,
  putWatchlist,
  deleteWatch,
  readAlerts,
  markAlertsRead,
  runAlertCycle,
  registryManifest
};

/** Exchanges registry (transparent sourcing for the UI). */
export async function getExchanges() {
  return { schema: 'fbt.smart-money-exchanges.v1', at: Date.now(), ...registryManifest() };
}

/** Liquidity feed (cached a touch longer than overview). */
export function getLiquidityEvents(opts) {
  return withCache('sm:liquidity', TTL.liquidity, () => liquidityEvents(opts), { swr: true });
}
