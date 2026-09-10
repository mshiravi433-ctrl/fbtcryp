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
import { createStrategyRuntime } from './strategyRuntime.js';
import { FEE_BPS } from '../feeBps.js';


/** One memoised promise per upstream call, shared by every domain that needs it. */
const shared = new Map();
function once(key, factory) {
  if (!shared.has(key)) {
    const promise = Promise.resolve()
      .then(factory)
      .catch((err) => { shared.delete(key); throw err; });
    shared.set(key, promise);
  }
  return shared.get(key);
}

/** Drop the shared promises so the next turn re-reads (used after a revision). */
export function resetSharedReads() { shared.clear(); }

const LENDING_PROJECTS = /aave|compound|morpho|spark|venus|fluid|kamino|marginfi|benqi|radiant|silo|moonwell|list|kinza|dolomite/i;

/** DefiLlama pool → the shape the engine normalises. */
function poolRow(pool = {}) {
  const symbol = String(pool.symbol || '').toUpperCase();
  const isLp = symbol.includes('-');
  const project = String(pool.project || '');
  const family = LENDING_PROJECTS.test(project) ? 'lending' : (isLp ? 'lp' : 'farm');
  return {
    id: String(pool.pool || `${project}:${symbol}`),
    symbol,
    project,
    family,
    apy: num(pool.apy ?? pool.apyBase),
    apyBase: num(pool.apyBase),
    tvlUsd: num(pool.tvlUsd),
    chain: pool.chain,
    chainId: num(pool.chainId),
    risk: pool.risk || (num(pool.apy) > 40 ? 'high' : (num(pool.apy) > 15 ? 'medium' : 'low')),
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
    wallet: async () => ({
      connected: Boolean(walletState?.connected || walletState?.isConnected),
      address: walletState?.address || null,
      chainId: num(walletState?.chainId),
      balances: Array.isArray(walletState?.balances) ? walletState.balances : (context.balances || [])
    }),
    portfolio: async () => {
      if (!pf) return { totalValueUsd: null, holdings: [], reason: 'NO_PORTFOLIO_SNAPSHOT' };
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
      const rows = await getMarkets({ perPage: 40 });
      return Array.isArray(rows) ? rows.slice(0, 40).map((c) => ({
        id: c.id, symbol: String(c.symbol || '').toUpperCase(), family: 'crypto',
        price: num(c.current_price), apy: null,
        forwardReturnPct: null,
        volatilityPct: Math.abs(num(c.price_change_percentage_24h) || 0),
        marketCap: num(c.market_cap), tvlUsd: num(c.total_volume),
        risk: ['BTC', 'ETH'].includes(String(c.symbol || '').toUpperCase()) ? 'medium' : 'high'
      })) : null;
    },
    rwa: async () => {
      const { getCategory } = await import('../api');
      const rows = await getCategory('rwa', { perPage: 25 });
      return Array.isArray(rows) ? rows.slice(0, 25).map((c) => ({
        id: c.id, symbol: String(c.symbol || '').toUpperCase(), family: 'rwa',
        price: num(c.current_price),
        volatilityPct: Math.abs(num(c.price_change_percentage_24h) || 0),
        tvlUsd: num(c.market_cap), risk: 'medium'
      })) : null;
    },
    macro: async () => {
      const [{ getGlobal, getOhlc, normalizeGlobal }, { marketRegime }] = await Promise.all([
        import('../api'), import('../macro.js')
      ]);
      const [globalRaw, ohlc] = await Promise.all([
        getGlobal().catch(() => null),
        getOhlc('bitcoin', 30).catch(() => null)
      ]);
      const global = normalizeGlobal(globalRaw || {});
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
    ...ostiumReaders(),

    /* ── one shared yield call answers three domains ─────────────────────── */
    ...yieldReaders(),

    /* ── derivatives ─────────────────────────────────────────────────────── */
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
    },

    /* ── intelligence ────────────────────────────────────────────────────── */
    smartMoney: async () => {
      const { smartMoneyContext } = await import('../smartMoneyAI.js');
      const ctx = await smartMoneyContext({ window: '24h' });
      const flows = ctx?.overview?.flows?.windows?.['24h'] || {};
      return {
        netFlowUsd: num(flows.netUsd),
        inflowUsd: num(flows.inflowUsd),
        outflowUsd: num(flows.outflowUsd),
        whaleEvents: num(ctx?.overview?.metrics?.whaleActivity?.value),
        tokens: (ctx?.overview?.tokenActivity || []).slice(0, 5).map((t) => ({ symbol: t.symbol, netUsd: num(t.netUsd) })),
        dataPoints: (ctx?.dataPoints || []).slice(0, 6)
      };
    },
    whales: async () => {
      const { fetchWhales } = await import('../whales.js');
      const data = await fetchWhales({ limit: 25 });
      const events = Array.isArray(data?.events) ? data.events : (Array.isArray(data) ? data : []);
      const inflow = events.reduce((acc, e) => acc + (/exchange|deposit/i.test(String(e.to || e.direction)) ? (num(e.amountUsd) || 0) : 0), 0);
      const outflow = events.reduce((acc, e) => acc + (/withdraw|out/i.test(String(e.direction || '')) ? (num(e.amountUsd) || 0) : 0), 0);
      return { eventCount: events.length, exchangeInflowUsd: inflow, exchangeOutflowUsd: outflow, events: events.slice(0, 10) };
    },
    news: async () => {
      const { getNews } = await import('../news.js');
      const data = await getNews({ coins: ['bitcoin', 'ethereum'] });
      const items = Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : []);
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
    return all.filter((p) => test(String(p.category || ''))).slice(0, 25).map((p) => ({
      id: p.pairId, symbol: p.from, family: null, venue: 'Ostium',
      price: num(p.mid), openFeeBps: num(p.openFeeBps), leverage: 1,
      marketOpen: Boolean(p.isMarketOpen), risk: 'medium'
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
    return (Array.isArray(data?.pools) ? data.pools : []).map(poolRow);
  });
  const pick = (family) => async () => {
    const all = await pools();
    const rows = all.filter((p) => p.family === family && num(p.apy) != null);
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
    readEcosystem: async () => { resetSharedReads(); return reader.read({ force: true }); },
    onEvent,
    /* Stage truth restored from strategyStore: a plan resumed after a reload
       continues on the stage it actually reached instead of restarting. */
    hydrate
  });
}

export { RISK_PROFILES, buildPortfolioStrategy, createStrategyRuntime };
