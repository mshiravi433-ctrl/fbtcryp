/**
 * FBT INTENT AI — PHASES 101–110: MULTI-VENUE DATA BRIDGE
 * ---------------------------------------------------------------------------
 * One read-only bridge that turns the four existing venue feeds — Avantis
 * equities (stocks), the dYdX indexer (global perp markets), the CoinGecko
 * derivatives table (perpetual futures with known funding intervals) and the
 * safety-filtered DefiLlama pools (yield farming) — into the feed contract
 * `src/lib/intent-ai/multiVenuePlanner.js` consumes.
 *
 * Rules carried over from the individual feeds:
 *   · nothing here invents a number; a failed feed is an EMPTY class with a
 *     reason, and the planner reports it as such
 *   · funding is annualised only where the settlement interval is known
 *   · APY comes only from pools that passed the existing safety filter
 *   · equities rows carry the venue's own leverage cap, never a local guess
 */

import { fetchDydxMarkets } from './dydx.js';
import { fetchPerpMarkets } from './perp.js';
import { fetchYields } from './yields.js';
import { fetchAvantisEquities } from './avantis.js';
import {
  planForProfitTarget,
  trackTargetProgress,
  suggestVenueSwitch,
  normalizeVenueRows,
  venueClassHealth,
  MULTI_VENUE_SCHEMA,
  PROFIT_PLAN_SCHEMA
} from '../src/lib/intent-ai/multiVenuePlanner.js';
import { localizePlan, localizeProgress, outputLocaleSupport } from '../src/lib/intent-ai/outputLocales.js';

const FEED_TIMEOUT_MS = 12_000;

function withDeadline(promise, ms) {
  let timer = null;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve({ __timedOut: true }), ms);
      if (timer.unref) timer.unref();
    })
  ]);
}

/* ── per-feed adapters: upstream shape → planner feed contract ─────────── */

async function dydxFeed() {
  try {
    const data = await withDeadline(fetchDydxMarkets(), FEED_TIMEOUT_MS);
    if (data?.__timedOut || !data?.markets) return { rows: [], reason: data?.__timedOut ? 'TIMEOUT' : 'NO_MARKETS' };
    const rows = [];
    for (const market of Object.values(data.markets)) {
      if (!market || !market.ticker) continue;
      const fundingPpm = Number(market.nextFundingRate);
      rows.push({
        id: `dydx-${market.ticker}`,
        label: market.ticker,
        priceUsd: Number(market.oraclePrice) || null,
        fundingRatePct: Number.isFinite(fundingPpm) ? fundingPpm / 1e4 : null, // ppm → %
        fundingIntervalHours: 1,
        openInterestUsd: Number(market.openInterest) || null,
        volume24hUsd: Number(market.volume24H) || null,
        venue: 'dydx',
        riskTier: null,
        stablecoin: false,
        observedAt: Date.now()
      });
    }
    return { rows, reason: null };
  } catch (e) {
    return { rows: [], reason: String(e?.message || 'FAILED').slice(0, 80) };
  }
}

async function futuresFeed() {
  try {
    const data = await withDeadline(fetchPerpMarkets(), FEED_TIMEOUT_MS);
    if (data?.__timedOut) return { rows: [], reason: 'TIMEOUT' };
    const rows = [];
    for (const asset of data?.assets || []) {
      for (const t of asset.venues || []) {
        rows.push({
          id: `${t.venue}-${t.symbol}`,
          label: t.pair || t.symbol,
          priceUsd: t.price,
          fundingRatePct: t.fundingPct,
          fundingIntervalHours: t.intervalHours,
          fundingAprPct: t.fundingApr,
          openInterestUsd: t.openInterestUsd,
          volume24hUsd: t.volume24hUsd,
          venue: t.venue,
          riskTier: null,
          stablecoin: false,
          observedAt: Date.now()
        });
      }
    }
    return { rows, reason: null };
  } catch (e) {
    return { rows: [], reason: String(e?.message || 'FAILED').slice(0, 80) };
  }
}

async function farmFeed() {
  try {
    const data = await withDeadline(fetchYields(), FEED_TIMEOUT_MS);
    if (data?.__timedOut) return { rows: [], reason: 'TIMEOUT' };
    const rows = (data?.pools || []).map((p) => ({
      id: p.id,
      label: `${p.project} · ${p.symbol}`,
      apyPct: p.apy,
      tvlUsd: p.tvlUsd,
      riskTier: p.risk,
      venue: p.chain,
      stablecoin: p.stablecoin === true,
      observedAt: data?.at || Date.now()
    }));
    return { rows, reason: null, considered: data?.considered, passed: data?.passed };
  } catch (e) {
    return { rows: [], reason: String(e?.message || 'FAILED').slice(0, 80) };
  }
}

async function stocksFeed() {
  try {
    const data = await withDeadline(fetchAvantisEquities(), FEED_TIMEOUT_MS);
    if (data?.__timedOut) return { rows: [], reason: 'TIMEOUT' };
    const rows = (data?.rows || []).map((r) => ({
      id: r.id,
      label: r.symbol,
      priceUsd: Number(r.price) || null,
      openInterestUsd: Number(r.openInterest) || null,
      venue: 'avantis',
      leverageCap: Number.isFinite(Number(r.maxLeverage)) ? Number(r.maxLeverage) : null,
      marketOpen: r.marketOpen === true,
      riskTier: null,
      stablecoin: false,
      observedAt: data?.at || Date.now()
    }));
    return { rows, reason: null };
  } catch (e) {
    return { rows: [], reason: String(e?.message || 'FAILED').slice(0, 80) };
  }
}

/* ── the unified collection ─────────────────────────────────────────────── */

export async function collectVenueFeeds({ now = Date.now() } = {}) {
  const [dydx, futures, farm, stocks] = await Promise.all([
    dydxFeed(), futuresFeed(), farmFeed(), stocksFeed()
  ]);
  const feeds = {
    spot: [],
    stocks: stocks.rows,
    'dydx-global': dydx.rows,
    futures: futures.rows,
    'yield-farm': farm.rows
  };
  const reasons = {
    stocks: stocks.reason,
    'dydx-global': dydx.reason,
    futures: futures.reason,
    'yield-farm': farm.reason
  };
  return {
    schema: MULTI_VENUE_SCHEMA,
    generatedAt: new Date(now).toISOString(),
    feeds,
    health: Object.fromEntries(
      Object.entries(feeds).map(([klass, rows]) => [klass, venueClassHealth(rows, { now })])
    ),
    reasons,
    sources: {
      stocks: 'avantis-equities',
      'dydx-global': 'dydx-indexer',
      futures: 'coingecko-derivatives',
      'yield-farm': 'defillama-yields'
    },
    secretsExposed: false
  };
}

export async function buildProfitPlan({ target, horizonDays, capitalUsd, riskProfile, lang = 'en' }) {
  const feeds = await collectVenueFeeds();
  const plan = planForProfitTarget({ target, horizonDays, capitalUsd, riskProfile, feeds: feeds.feeds });
  return {
    plan,
    summary: localizePlan(plan, lang),
    locale: outputLocaleSupport(lang),
    venues: {
      health: feeds.health,
      reasons: feeds.reasons,
      sources: feeds.sources
    }
  };
}

export async function buildTargetProgress({ plan, portfolioUsd }) {
  const progress = trackTargetProgress({ plan, portfolioUsd });
  const suggestion = progress.ok ? suggestVenueSwitch({
    plan,
    fromClass: 'yield-farm',
    currentYieldPct: plan?.allocations?.find((a) => a.klass === 'yield-farm')?.expectedYieldPct ?? null
  }) : null;
  return { progress, suggestion };
}

export { localizePlan, localizeProgress, outputLocaleSupport, normalizeVenueRows, PROFIT_PLAN_SCHEMA, MULTI_VENUE_SCHEMA };
