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
import { labelledEvents, whaleBoard, exchangeFlows, earlyTokens, freshWallets, liquidityEvents, tokenSignals } from './moneyFlow.js';
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
  const { value } = await withCache(`sm:overview:${winKey}`, TTL.overview, () => buildOverview(winKey));
  return value;
}

async function buildOverview(winKey) {
  const winMs = WINDOWS[winKey] || WINDOWS.H24;
  const cutoff = Date.now() - winMs;
  const prevCutoff = Date.now() - winMs * 2;

  const { events, partial, pricedCount } = await labelledEvents({ minUsd: FLOORS.whaleUsd });
  const inWin = events.filter((e) => (e.timestamp || 0) >= cutoff && e.valueUsd != null);
  const prevWin = events.filter((e) => (e.timestamp || 0) >= prevCutoff && (e.timestamp || 0) < cutoff && e.valueUsd != null);

  // Aggregate activity metrics
  const whaleActivity = inWin.length;
  const whaleActivityPrev = prevWin.length;
  const accumulationNow = inWin.filter((e) => e.flow === 'dex_buy' || e.flow === 'cex_out').reduce((s, e) => s + e.valueUsd, 0);
  const accumulationPrev = prevWin.filter((e) => e.flow === 'dex_buy' || e.flow === 'cex_out').reduce((s, e) => s + e.valueUsd, 0);
  const distributionNow = inWin.filter((e) => e.flow === 'dex_sell' || e.flow === 'cex_in').reduce((s, e) => s + e.valueUsd, 0);
  const distributionPrev = prevWin.filter((e) => e.flow === 'dex_sell' || e.flow === 'cex_in').reduce((s, e) => s + e.valueUsd, 0);

  const flows = await exchangeFlows();
  const netFlow24 = flows.windows['24h'].netUsd;

  // Per-token accumulation ranking
  const byToken = new Map();
  for (const e of inWin) {
    if (!e.token?.symbol || e.valueUsd == null) continue;
    const key = `${e.chainId}:${e.token.address || e.token.symbol}`;
    const r = byToken.get(key) || {
      symbol: e.token.symbol,
      name: e.token.name,
      chainShort: e.chainShort,
      chainId: e.chainId,
      address: e.token.address || null,
      coingeckoId: e.token.coingeckoId || null,
      buy: 0, sell: 0, cexIn: 0, cexOut: 0, events: 0
    };
    r.events += 1;
    if (e.flow === 'dex_buy') r.buy += e.valueUsd;
    if (e.flow === 'dex_sell') r.sell += e.valueUsd;
    if (e.flow === 'cex_in') r.cexIn += e.valueUsd;
    if (e.flow === 'cex_out') r.cexOut += e.valueUsd;
    byToken.set(key, r);
  }
  const tokenActivity = [...byToken.values()].map((r) => {
    const net = r.buy + r.cexOut - r.sell - r.cexIn;
    const scale = Math.max(r.buy + r.cexOut, r.sell + r.cexIn, 1);
    const accum = detectAccumulation({
      netBuying: Math.max(0, net) / scale,
      exchangeOutflow: r.cexOut > 0 ? Math.min(1, r.cexOut / scale) : null,
      smartMoneyBuying: r.events >= 3 ? Math.min(1, r.events / 10) : null
    });
    const distrib = detectDistribution({
      netSelling: Math.max(0, -net) / scale,
      exchangeInflow: r.cexIn > 0 ? Math.min(1, r.cexIn / scale) : null
    });
    return {
      ...r,
      buy: Math.round(r.buy), sell: Math.round(r.sell),
      cexIn: Math.round(r.cexIn), cexOut: Math.round(r.cexOut),
      netUsd: Math.round(net),
      accumulation: accum.confidence,
      distribution: distrib.confidence,
      signal: accum.detected ? 'ACCUMULATION' : distrib.detected ? 'DISTRIBUTION' : net >= 0 ? 'ACCUMULATION' : 'DISTRIBUTION'
    };
  }).sort((a, b) => Math.abs(b.netUsd) - Math.abs(a.netUsd)).slice(0, 10);

  const [early, fresh, liquidity, whales] = await Promise.all([
    earlyTokens({ limit: 8 }).catch(() => null),
    freshWallets().catch(() => null),
    liquidityEvents({ windowBlocks: 8 }).catch(() => null),
    whaleBoard().catch(() => null)
  ]);

  return {
    schema: 'fbt.smart-money-overview.v1',
    at: Date.now(),
    window: winKey,
    dataStatus: events.length ? 'live' : 'unavailable',
    partial: !!partial,
    coverage: {
      events: events.length,
      priced: pricedCount ?? inWin.length,
      note: 'Metrics derive from observed large on-chain transfers across supported chains. Unlabelled counterparties are not counted as exchange flow.'
    },
    metrics: {
      whaleActivity: { value: whaleActivity, changePct: pctChange(whaleActivity, whaleActivityPrev) },
      accumulation: { valueUsd: Math.round(accumulationNow), changePct: pctChange(accumulationNow, accumulationPrev) },
      distribution: { valueUsd: Math.round(distributionNow), changePct: pctChange(distributionNow, distributionPrev) },
      exchangeInflow: compactUsd(flows.windows[winKey].inflowUsd),
      exchangeOutflow: compactUsd(flows.windows[winKey].outflowUsd),
      netFlow: compactUsd(netFlow24)
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
  return withCache('sm:liquidity', TTL.liquidity, () => liquidityEvents(opts));
}
