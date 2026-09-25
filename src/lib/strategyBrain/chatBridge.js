/**
 * FBT STRATEGY BRAIN — CHAT BRIDGE (the browser half).
 * ---------------------------------------------------------------------------
 * Layer 2 needs twenty-one readers; the app already owns every one of them.
 * This file is the binding — and the reason it exists as its own module is
 * that every import below is a BROWSER import (Vite env, extensionless
 * specifiers, wallet context). The engine and the runtime stay pure Node so a
 * probe can pin them, and only this file touches the app.
 *
 * ─── HOST BUDGET, AGAIN, BECAUSE IT IS THE CONSTRAINT ──────────────────────
 * A strategy turn is expensive if it is careless: twenty-one domains could be
 * twenty-one upstream calls. It is not, because:
 *
 *   · the wallet, the portfolio, the risk read and the platform fee come from
 *     what this turn ALREADY has in memory — zero requests;
 *   · Ostium answers stocks + forex + commodities in ONE call, and the three
 *     domain readers share a single memoised promise for it;
 *   · DefiLlama's yield feed answers lending + farming + liquidity in ONE
 *     call, likewise shared;
 *   · everything else goes through `src/lib/api`, which caches for five
 *     minutes, so a second strategy turn in the same session is nearly free;
 *   · layer 2 caps concurrency at 4 and times each domain out at 6 s.
 *
 * Worst case for a cold session: ~13 requests. A warm session: ~2.
 *
 * A domain this file cannot source is simply not bound — layer 2 reports it as
 * `skipped` and the plan names it in `gaps`. Nothing here returns a fake row.
 */

import { parseGoalSpec } from './goalSpec.js';
import { num, r2 } from './numeric.js';
import { createEcosystemReader, DOMAIN_IDS } from './ecosystemState.js';
import { buildPortfolioStrategy, RISK_PROFILES } from './strategyEngine.js';
import { localizeStrategy } from './strategyLocales.js';
import { createStrategyRuntime } from './strategyRuntime.js';
import { FEE_BPS } from '../feeBps.js';
import { SPECULATION_ENABLED } from '../features.js';
import {
  COMPOUND_BASE_SUPPLY_OPEN_TO_PUBLIC, MORPHO_BASE_SUPPLY_OPEN_TO_PUBLIC,
  LIDO_STAKE_OPEN_TO_PUBLIC
} from '../farmRolloutMode.js';
import { liveMarketRows } from './liveMarketRows.js';
import { TOKENS } from '../chains.js';


/** One memoised promise per upstream call, shared by every domain that needs it. */
const shared = new Map();
function once(key, factory) {
  const cached = shared.get(key);
  if (cached && Date.now() - cached.at < 45_000) return cached.promise;
  shared.delete(key);
  if (!shared.has(key)) {
    const promise = Promise.resolve()
      .then(factory)
      .catch((err) => { shared.delete(key); throw err; });
    shared.set(key, { promise, at: Date.now() });
  }
  return shared.get(key).promise;
}

/** Drop the shared promises so the next turn re-reads (used after a revision). */
export function resetSharedReads() { shared.clear(); }

const LENDING_PROJECTS = /aave|compound|morpho|spark|venus|fluid|kamino|marginfi|benqi|radiant|silo|moonwell|list|kinza|dolomite/i;

/** DefiLlama pool → the shape the engine normalises. */
function poolRow(pool = {}) {
  // Lido's feed quotes stETH, but the in-app staking panel takes ETH as the
  // deposit asset. Never prefill a stETH supply into an ETH-only form.
  const symbol = pool.venue === 'lido' ? 'ETH' : String(pool.symbol || '').toUpperCase();
  const isLp = symbol.includes('-');
  const project = String(pool.project || '');
  const family = pool.venue === 'lido' ? 'staking'
    : (LENDING_PROJECTS.test(project) ? 'lending' : (isLp ? 'lp' : 'farm'));
  return {
    id: String(pool.pool || pool.id || `${project}:${symbol}`),
    symbol,
    project,
    venue: pool.venue || project,
    family,
    apy: num(pool.apy ?? pool.apyBase),
    apyBase: num(pool.apyBase),
    tvlUsd: num(pool.tvlUsd),
    chain: pool.chain,
    chainId: num(pool.chainId) ?? ({ base: 8453, arbitrum: 42161, ethereum: 1 }[String(pool.chain || '').toLowerCase()] ?? null),
    risk: pool.risk || (symbol === 'STETH' ? 'medium' : (num(pool.apy) > 40 ? 'high' : (num(pool.apy) > 15 ? 'medium' : 'low'))),
    poolMeta: pool.poolMeta || null,
    stablecoin: /USD/i.test(symbol) ? true : undefined
  };
}

/**
 * Build the reader map for this turn.
 *
 * @param {object} opts
 * @param {object} [opts.context]   the OS context object for this turn
 * @param {object} [opts.results]   what the turn's tools already returned
 * @param {object} [opts.wallet]    the app wallet snapshot
 * @param {object} [opts.portfolio] the app portfolio snapshot
 */
export function createChatEcosystemReaders({ context = {}, results = {}, wallet = null, portfolio = null } = {}) {
  const pf = portfolio || context.portfolio || results.portfolio || null;
  const walletState = wallet || context.walletState || context.wallet || results.wallet || null;

  const holdings = Array.isArray(pf?.holdings) ? pf.holdings : [];

  const readers = {
    /* ── zero-request reads: this turn already has them ─────────────────── */
    wallet: async () => !walletState?.connected && !walletState?.isConnected ? null : ({
      connected: true,
      address: walletState?.address || null,
      chainId: num(walletState?.chainId),
      balances: Array.isArray(walletState?.balances) ? walletState.balances : (context.balances || [])
    }),
    portfolio: async () => {
      if (!pf || (pf.totalValueUsd == null && pf.totalUsd == null && !holdings.length)) return null;
      const total = num(pf.totalValueUsd ?? pf.totalUsd) ?? holdings.reduce((acc, h) => acc + (num(h.valueUsd) || 0), 0);
      return { totalValueUsd: total || null, holdings, chainId: num(pf.chainId ?? walletState?.chainId) };
    },
    fees: async () => ({ feeBps: FEE_BPS, feePct: FEE_BPS / 100, source: 'src/lib/feeBps' }),
    /* Concentration is arithmetic on the portfolio the app already read. */
    risk: async () => {
      const priced = holdings.filter((h) => num(h.valueUsd) != null);
      if (!priced.length) return null;
      const total = priced.reduce((acc, h) => acc + num(h.valueUsd), 0);
      const sorted = priced.slice().sort((a, b) => num(b.valueUsd) - num(a.valueUsd));
      const top = num(sorted[0]?.valueUsd) || 0;
      const concentrationPct = total > 0 ? (top / total) * 100 : null;
      return {
        concentrationPct: r2(concentrationPct),
        topHolding: sorted[0]?.symbol || null,
        holdingsCount: priced.length,
        volatilityPct: num(pf.volatilityPct),
        alerts: concentrationPct != null && concentrationPct > 60
          ? [{ code: 'CONCENTRATION', detail: `${sorted[0]?.symbol} is ${r2(concentrationPct)}% of the portfolio` }]
          : [],
        source: 'portfolio'
      };
    },

    /* ── one request each, cached by src/lib/api for five minutes ────────── */
    crypto: async () => {
      const { getMarkets } = await import('../api');
      // getMarkets serves a bundled offline snapshot when both providers fail.
      // Only explicitly live rows are usable as strategy opportunities.
      return liveMarketRows(await getMarkets({ perPage: 40 }), {
        registry: TOKENS, preferredChainId: walletState?.chainId
      });
    },
    rwa: async () => {
      const { getCategory } = await import('../api');
      // getCategory has NO offline rows: its empty fallback stays empty.
      return liveMarketRows(await getCategory('rwa', { perPage: 25 }), {
        family: 'rwa', limit: 25,
        registry: TOKENS, preferredChainId: walletState?.chainId
      });
    },
    macro: async () => {
      const [{ getGlobal, getOhlc, lastFetchFailed }, { marketRegime }] = await Promise.all([
        import('../api'), import('../macro.js')
      ]);
      const [globalRaw, ohlc] = await Promise.all([
        getGlobal().catch(() => null),
        getOhlc('bitcoin', 30).catch(() => null)
      ]);
      // getGlobal can return bundled offline figures. Never label those live.
      if (!globalRaw || globalRaw.dataProvenance !== 'live' || lastFetchFailed('global')) return null;
      // getGlobal already normalises both the backend and CoinLore into
      // mcapChange/btcDominance. Re-normalising it as raw CoinLore zeroed every
      // macro signal even with a valid live response.
      const global = globalRaw;
      const series = Array.isArray(ohlc) ? ohlc.map((p) => (Array.isArray(p) ? p[1] : num(p?.close))).filter((v) => num(v) != null) : [];
      const regime = marketRegime({ global, btcSeries: series }) || null;
      return {
        regime: regime?.regime || null,
        certain: Boolean(regime?.certain),
        marketCapChange24hPct: num(global?.mcapChange),
        btcDominancePct: num(global?.btcDominance),
        values: regime?.values || null,
        btcSamples: series.length
      };
    },

    /* ── one shared Ostium call answers three domains ────────────────────── */
    ...(SPECULATION_ENABLED ? ostiumReaders() : {}),

    /* ── one shared yield call answers three domains ─────────────────────── */
    ...yieldReaders(),

    /* ── derivatives ─────────────────────────────────────────────────────── */
    /*
     * Gated on the same flag App.jsx gates the Perp/Dydx/Ostium routes with,
     * and for the same reason: in a store build those venues do not exist in
     * the app at all, so the brain must not read them and must not even carry
     * their code. An ungated dynamic import emits a `perp-*.js` chunk into the
     * store bundle, which is precisely what test/run.mjs greps the built
     * output for. With the flag off the readers are absent, the ecosystem
     * read reports those domains as skipped, and the plan says so.
     */
    ...(SPECULATION_ENABLED ? {
    futures: async () => {
      const { getPerpMarkets } = await import('../perp.js');
      const data = await getPerpMarkets();
      return (Array.isArray(data?.assets) ? data.assets : []).slice(0, 30).map((a) => ({
        id: String(a.symbol || a.asset || a.id), symbol: String(a.symbol || a.asset || '').replace('-USD', '').toUpperCase(),
        family: 'derivatives', venue: a.venue || 'perp', leverage: num(a.maxLeverage) || 1,
        fundingAprPct: num(a.fundingAprPct ?? a.fundingApr ?? a.fundingRateAnnualized),
        price: num(a.oraclePrice ?? a.price ?? a.markPrice),
        volumeUsd: num(a.volume24hUsd ?? a.volumeUsd), risk: 'high'
      }));
    },
    dydx: async () => {
      const { getDydxMarkets } = await import('../dydx.js');
      const data = await getDydxMarkets();
      return (Array.isArray(data?.markets) ? data.markets : []).slice(0, 30).map((m) => ({
        id: m.ticker, symbol: String(m.ticker || '').split('-')[0].toUpperCase(), family: 'derivatives',
        venue: 'dYdX', fundingAprPct: num(m.fundingAprPct ?? m.nextFundingRateAnnualized),
        price: num(m.oraclePrice), volumeUsd: num(m.volume24h ?? m.volume24hUsd),
        leverage: 1, risk: 'high'
      }));
    }
    } : {}),

    /* ── intelligence ────────────────────────────────────────────────────── */
    smartMoney: async () => {
      const { smartMoneyContext } = await import('../smartMoneyAI.js');
      const ctx = await smartMoneyContext({ window: '24h' });
      const flows = ctx?.overview?.flows?.windows?.['24h'] || {};
      if (ctx?.ok === false || (!ctx?.dataPoints?.length && num(flows.netUsd) == null)) return null;
      return {
        netFlowUsd: num(flows.netUsd),
        inflowUsd: num(flows.inflowUsd),
        outflowUsd: num(flows.outflowUsd),
        whaleEvents: num(ctx?.overview?.metrics?.whaleActivity?.value),
        tokens: (Array.isArray(ctx?.overview?.tokenActivity) ? ctx.overview.tokenActivity : []).slice(0, 5).map((t) => ({ symbol: t.symbol, netUsd: num(t.netUsd) })),
        dataPoints: (ctx?.dataPoints || []).slice(0, 6)
      };
    },
    whales: async () => {
      const { fetchWhales } = await import('../whales.js');
      const data = await fetchWhales({ limit: 25 });
      const events = Array.isArray(data?.events) ? data.events : (Array.isArray(data) ? data : []);
      if (!events.length) return null;
      const inflow = events.reduce((acc, e) => acc + (/exchange|deposit/i.test(String(e.to || e.direction)) ? (num(e.amountUsd) || 0) : 0), 0);
      const outflow = events.reduce((acc, e) => acc + (/withdraw|out/i.test(String(e.direction || '')) ? (num(e.amountUsd) || 0) : 0), 0);
      return { eventCount: events.length, exchangeInflowUsd: inflow, exchangeOutflowUsd: outflow, events: events.slice(0, 10) };
    },
    news: async () => {
      const { getNews } = await import('../news.js');
      const data = await getNews({ coins: ['bitcoin', 'ethereum'] });
      const items = Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : []);
      if (!items.length) return null;
      return { count: items.length, sentimentScore: num(data?.sentiment ?? data?.sentimentScore), tone: data?.tone || null, items: items.slice(0, 5) };
    }
  };

  /* Correlation is only worth three OHLC reads when there are at least two
     priced assets to compare; otherwise it is not bound at all. */
  const priced = holdings.filter((h) => num(h.valueUsd) != null);
  if (priced.length >= 2) {
    readers.correlation = async () => {
      const { getOhlc } = await import('../api');
      const targets = priced.slice(0, 3).map((h) => h.coinId || h.id).filter(Boolean).slice(0, 3);
      if (targets.length < 2) return null;
      const series = await Promise.all(targets.map((id) => getOhlc(id, 30).catch(() => null)));
      const returns = series.map((s) => (Array.isArray(s) ? s.map((p) => (Array.isArray(p) ? p[1] : num(p?.close))) : []).filter((v) => num(v) != null));
      const pairs = [];
      for (let i = 0; i < returns.length; i += 1) {
        for (let j = i + 1; j < returns.length; j += 1) {
          const corr = pearson(returns[i], returns[j]);
          if (corr != null) pairs.push({ a: String(targets[i]).toUpperCase(), b: String(targets[j]).toUpperCase(), corr: r2(corr) });
        }
      }
      return pairs.length ? { pairs } : null;
    };
  }

  return readers;
}

/** Ostium pairs, split into the three global-market domains by category. */
function ostiumReaders() {
  const pairs = () => once('ostium', async () => {
    const { getOstiumMarkets } = await import('../ostium.js');
    const data = await getOstiumMarkets();
    return Array.isArray(data?.pairs) ? data.pairs : [];
  });
  const pick = (test) => async () => {
    const all = await pairs();
    return all.filter((p) => p.isMarketOpen === true && num(p.mid) > 0
      && test(String(p.category || ''))).slice(0, 25).map((p) => ({
      id: p.pairId, symbol: p.from, family: null, venue: 'Ostium',
      price: num(p.mid), openFeeBps: num(p.openFeeBps), leverage: 1,
      marketOpen: true, chainId: 42161, risk: 'medium'
    }));
  };
  return {
    stocks: pick((c) => /stock|equit|etf|index/i.test(c)),
    forex: pick((c) => /forex|fx/i.test(c)),
    commodities: pick((c) => /commod|metal|gold|oil/i.test(c))
  };
}

/** The DefiLlama feed, split into lending / farming / liquidity. */
function yieldReaders() {
  const pools = () => once('yields', async () => {
    const { getYields } = await import('../yields.js');
    const data = await getYields();
    // Only the five pinned venues have in-app deposit adapters. The rest of
    // the discovery feed has rates, not an executable position here.
    if (data?.freshness !== 'FRESH') return [];
    // Aave's public /loan screen can supply on Base/Arbitrum with an on-chain
    // reserve check. The other three use the Farm in-app panels: only show an
    // executable position when that very adapter is public in THIS build.
    const available = new Set([
      'aave-base', 'aave-arbitrum',
      ...(COMPOUND_BASE_SUPPLY_OPEN_TO_PUBLIC ? ['compound-base'] : []),
      ...(MORPHO_BASE_SUPPLY_OPEN_TO_PUBLIC ? ['morpho-base'] : []),
      ...(LIDO_STAKE_OPEN_TO_PUBLIC ? ['lido'] : [])
    ]);
    return (Array.isArray(data?.venues) ? data.venues : [])
      .filter((p) => p.pinned === true && p.freshness === 'FRESH' && available.has(p.venue))
      .map(poolRow);
  });
  const pick = (family) => async () => {
    const all = await pools();
    // Staking has no separate layer-2 domain: it shares the farming read,
    // while keeping its own family in the opportunity universe. Without this
    // Lido was fetched but silently discarded before ranking.
    const rows = all.filter((p) => (p.family === family || (family === 'farm' && p.family === 'staking'))
      && num(p.apy) != null);
    rows.sort((a, b) => num(b.apy) - num(a.apy));
    return rows.slice(0, 40);
  };
  return { lending: pick('lending'), farming: pick('farm'), liquidity: pick('lp') };
}

/** Pearson correlation over two equal-length series; null when it cannot be. */
export function pearson(a = [], b = []) {
  const n = Math.min(a.length, b.length);
  if (n < 8) return null;
  const x = a.slice(-n).map(Number);
  const y = b.slice(-n).map(Number);
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let num_ = 0; let dx = 0; let dy = 0;
  for (let i = 0; i < n; i += 1) {
    const a1 = x[i] - mx; const b1 = y[i] - my;
    num_ += a1 * b1; dx += a1 * a1; dy += b1 * b1;
  }
  if (!(dx > 0) || !(dy > 0)) return null;
  return num_ / Math.sqrt(dx * dy);
}

/**
 * One call for the chat: a sentence + what this turn already read → a
 * Portfolio Strategy object (or an honest refusal that names what is missing).
 */
export async function buildStrategyFromChat({
  text = '', entities = {}, context = {}, results = {}, wallet = null, portfolio = null,
  only = null, budget = {}, now = Date.now()
} = {}) {
  const readers = createChatEcosystemReaders({ context, results, wallet, portfolio });
  const pf = portfolio || context.portfolio || results.portfolio || null;
  const walletState = wallet || context.walletState || context.wallet || null;

  const spec = parseGoalSpec({ text, entities, portfolio: pf, wallet: walletState, balances: context.balances });
  if (!spec.ok) {
    return { ok: false, code: 'GOAL_INCOMPLETE', missing: spec.missing, spec, detail: `missing: ${spec.missing.join(', ')}` };
  }

  const reader = createEcosystemReader({ readers, ...budget });
  const state = await reader.read({ only: only || Object.keys(readers).filter((id) => DOMAIN_IDS.includes(id)) });
  const strategy = buildPortfolioStrategy({ goal: spec, state, now });
  return { ok: strategy.ok, spec, state, strategy, code: strategy.code || null };
}

/** Create the runtime that drives the plan's stages and revisions. */
export function createChatStrategyRuntime({ strategy, spec, context = {}, results = {}, wallet = null, portfolio = null, onEvent = null, hydrate = null } = {}) {
  const reader = createEcosystemReader({ readers: createChatEcosystemReaders({ context, results, wallet, portfolio }) });
  return createStrategyRuntime({
    strategy,
    goal: spec,
    /* A revision MUST be a fresh read — never this turn's cache. */
    readEcosystem: async () => {
      resetSharedReads();
      // The domain cache is not the only cache: getMarkets/getCategory/getGlobal
      // also memoise for up to five minutes. A manual rebuild must at least
      // try the providers again instead of silently re-scoring the old rows.
      const { clearApiCache } = await import('../api');
      clearApiCache();
      return reader.read({ force: true });
    },
    onEvent,
    /* Stage truth restored from strategyStore: a plan resumed after a reload
       continues on the stage it actually reached instead of restarting. */
    hydrate
  });
}

export { RISK_PROFILES, buildPortfolioStrategy, createStrategyRuntime };
