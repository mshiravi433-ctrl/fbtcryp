/**
 * Honest, source-aware market insight derivation.
 *
 * This module deliberately only ranks fields the existing feeds actually
 * provide. A 24-hour price move is market performance, not company profit;
 * market-cap movement is not capital flow; venue open interest is not money
 * entering a country. Unsupported claims are represented as unavailable
 * states so the UI cannot accidentally turn a proxy into a live fact.
 */

const EVENT_TERMS = [
  'conference', 'summit', 'hackathon', 'expo', 'meetup', 'event',
  'halving', 'launch', 'listing', 'airdrop', 'fork', 'upgrade',
  'rate decision', 'interest rate', 'inflation', 'cpi', 'fomc',
  'central bank', 'regulation', 'sec ', 'election'
];

const textOf = (item) => `${item?.title ?? ''} ${item?.summary ?? ''}`.toLowerCase();
const hasFiniteMove = (item) => {
  // The ordinary Market screen deliberately has a deterministic offline
  // fallback. It is useful for navigation, but it is generated data and must
  // never appear in a card labelled as current market intelligence.
  if (item?.dataProvenance === 'offline') return false;
  const value = item?.change24h;
  // Number(null), Number(''), Number(false) and Number([]) are all zero. Those
  // values are not a reported percentage, so accept only numbers and numeric
  // strings before applying the finite check.
  if (typeof value !== 'number' && typeof value !== 'string') return false;
  return String(value).trim() !== '' && Number.isFinite(Number(value));
};

/*
 * CAPITAL CHANGE — the one market field that is a flow rather than a price.
 *
 * `mcapChange24h` is CoinGecko's `market_cap_change_24h`: how many dollars of
 * capitalisation an asset gained or lost in 24 hours. That is what «بیشترین
 * توکنی که سرمایه جذب کرده» actually means, and it is why this ranker exists
 * separately from the price rankers above — a token can be up 4% on a thin
 * book while its capitalisation fell, and only one of those is capital.
 *
 * Same discipline as `hasFiniteMove`: an offline/generated row is never
 * eligible, and an absent delta is never read as zero flow.
 */
const capitalChangeOf = (item) => {
  const raw = item?.mcapChange24h ?? item?.mcapChange ?? item?.market_cap_change_24h;
  if (typeof raw !== 'number' && typeof raw !== 'string') return null;
  if (String(raw).trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
};

const hasFiniteCapitalChange = (item) => (
  item?.dataProvenance !== 'offline' && capitalChangeOf(item) !== null
);

function rankByCapitalChange(rows = [], direction = 'desc') {
  const clean = (Array.isArray(rows) ? rows : [])
    .filter((row) => row?.name && row?.symbol && hasFiniteCapitalChange(row));
  if (!clean.length) return null;
  const sorted = [...clean].sort((a, b) =>
    direction === 'asc'
      ? capitalChangeOf(a) - capitalChangeOf(b)
      : capitalChangeOf(b) - capitalChangeOf(a)
  );
  const best = sorted[0];
  /* A «leader» that is actually negative is not an inflow. The card then says
     nothing was attracted in this window rather than promoting the smallest
     loser — the same rule the server-side ranker applies. */
  const value = capitalChangeOf(best);
  if (direction === 'desc' && !(value > 0)) return null;
  if (direction === 'asc' && !(value < 0)) return null;
  return { ...best, capitalChange24h: value };
}

/** The market-wide totals behind the two token cards: how much capital the
 *  ranked universe added and lost, so one token is never shown as "the market". */
function capitalTotals(rows = []) {
  const clean = (Array.isArray(rows) ? rows : []).filter(hasFiniteCapitalChange);
  if (!clean.length) return null;
  let inflow = 0;
  let outflow = 0;
  for (const row of clean) {
    const value = capitalChangeOf(row);
    if (value > 0) inflow += value;
    else if (value < 0) outflow += -value;
  }
  return { count: clean.length, inflowUsd: Math.round(inflow), outflowUsd: Math.round(outflow), netUsd: Math.round(inflow - outflow) };
}

function rankByMove(rows = [], direction = 'desc') {
  const clean = (Array.isArray(rows) ? rows : [])
    .filter((row) => row?.name && row?.symbol && hasFiniteMove(row));
  return [...clean].sort((a, b) =>
    direction === 'asc'
      ? Number(a.change24h) - Number(b.change24h)
      : Number(b.change24h) - Number(a.change24h)
  )[0] ?? null;
}

function isCompanyToken(row) {
  if (row?.assetKind) return row.assetKind === 'single';
  // Compatibility with responses cached before `assetKind` was added. These
  // are index tokens, not companies; every other curated equity row is a
  // single-company token.
  return !['SPYx', 'QQQx'].includes(String(row?.symbol ?? ''));
}

/** A genuine event-tagged story, or a headline containing a concrete event term. */
export function isEventStory(item) {
  if (!item?.title || item?.digest) return false;
  if (item.sourceCat === 'events' || item.cats?.includes?.('events')) return true;
  const text = textOf(item);
  return EVENT_TERMS.some((term) => text.includes(term));
}

function rankByVolume(rows = []) {
  const clean = (Array.isArray(rows) ? rows : [])
    .filter((row) => row?.name && row?.symbol && hasFiniteMove(row) && Number.isFinite(Number(row?.volume || row?.total_volume)) && Number(row?.volume || row?.total_volume) > 0);
  return [...clean].sort((a, b) => Number(b?.volume || b?.total_volume) - Number(a?.volume || a?.total_volume))[0] ?? null;
}

function rankByMarketCap(rows = []) {
  const clean = (Array.isArray(rows) ? rows : [])
    .filter((row) => row?.name && row?.symbol && hasFiniteMove(row) && Number.isFinite(Number(row?.mcap || row?.marketCap || row?.market_cap)) && Number(row?.mcap || row?.marketCap || row?.market_cap) > 0);
  return [...clean].sort((a, b) => Number(b?.mcap || b?.marketCap || b?.market_cap) - Number(a?.mcap || a?.marketCap || a?.market_cap))[0] ?? null;
}

function rankByVolatility(rows = []) {
  const clean = (Array.isArray(rows) ? rows : [])
    .filter((row) => row?.name && row?.symbol && hasFiniteMove(row) && Number.isFinite(Number(row?.high24h)) && Number.isFinite(Number(row?.low24h)) && Number(row?.low24h) > 0 && Number(row?.high24h) >= Number(row?.low24h));
  return [...clean].map((row) => ({
    ...row,
    spreadPct: ((Number(row.high24h) - Number(row.low24h)) / Number(row.low24h)) * 100
  })).sort((a, b) => b.spreadPct - a.spreadPct)[0] ?? null;
}

/**
 * Derive everything displayed by the Intelligence tab and header spotlight.
 * No values are generated here: returned rows retain their source fields.
 */
export function deriveMarketInsights(input = {}) {
  const { markets = [], equities = [], news = [], flows = null } = input ?? {};
  const equityRows = Array.isArray(equities) ? equities : [];
  const newsRows = Array.isArray(news) ? news : [];
  const cryptoLeader = rankByMove(markets, 'desc');
  const cryptoLaggard = rankByMove(markets, 'asc');
  const tokenizedLeader = rankByMove(equityRows, 'desc');
  const companyLeader = rankByMove(equityRows.filter(isCompanyToken), 'desc');

  const volumeLeader = rankByVolume(markets);
  const marketCapLeader = rankByMarketCap(markets);
  const volatilityLeader = rankByVolatility(markets);

  const eventStories = newsRows
    .filter(isEventStory)
    .sort((a, b) => Number(b?.at ?? 0) - Number(a?.at ?? 0))
    .slice(0, 4);

  /*
   * ─── THE THREE CARDS THAT USED TO BE PERMANENTLY EMPTY ────────────────────
   * `flows` is the payload of GET /api/insights/flows (see
   * server/capitalFlows.js): CoinGecko capital-flow ranking over 250 assets,
   * DefiLlama stablecoin supply deltas per chain, and SEC EDGAR reported net
   * income. Every section arrives with its own `status`, `source` and `at`,
   * and a dark section stays a named gap — the token rows already on screen
   * are used as a second, weaker ranking (60 assets instead of 250) only when
   * the server section did not answer.
   */
  const tokenFlows = flows?.tokenFlows?.status === 'OK' ? flows.tokenFlows : null;
  const chainFlows = flows?.chainFlows?.status === 'OK' ? flows.chainFlows : null;
  const profit = flows?.profitLeaders?.status === 'OK' ? flows.profitLeaders : null;

  const localInflow = rankByCapitalChange(markets, 'desc');
  const localOutflow = rankByCapitalChange(markets, 'asc');

  const capitalInflow = tokenFlows?.topInflow
    ? { ...tokenFlows.topInflow, source: tokenFlows.source, at: tokenFlows.at, scope: 'server' }
    : localInflow
      ? { ...localInflow, mcapChangeUsd: localInflow.capitalChange24h, source: 'markets:live', at: null, scope: 'local' }
      : null;
  const capitalOutflowToken = tokenFlows?.topOutflow
    ? { ...tokenFlows.topOutflow, source: tokenFlows.source, at: tokenFlows.at, scope: 'server' }
    : localOutflow
      ? { ...localOutflow, mcapChangeUsd: localOutflow.capitalChange24h, source: 'markets:live', at: null, scope: 'local' }
      : null;

  return {
    cryptoLeader,
    cryptoLaggard,
    tokenizedLeader,
    companyLeader,
    volumeLeader,
    marketCapLeader,
    volatilityLeader,
    eventStories,

    /* Real capital flows, each with the source that produced it. */
    capitalInflow,
    capitalOutflowToken,
    capitalTotals: tokenFlows?.totals ?? capitalTotals(markets),
    stablecoinNet: chainFlows
      ? {
        totalCirculatingUsd: chainFlows.totalCirculatingUsd,
        net24hUsd: chainFlows.net24hUsd,
        net7dUsd: chainFlows.net7dUsd,
        net24hPct: chainFlows.net24hPct,
        assets: chainFlows.assets,
        source: chainFlows.source,
        at: chainFlows.at
      }
      : null,
    chainInflow: chainFlows?.topInflowChain
      ? { ...chainFlows.topInflowChain, source: chainFlows.source, at: chainFlows.at }
      : null,
    chainOutflow: chainFlows?.topOutflowChain
      ? { ...chainFlows.topOutflowChain, source: chainFlows.source, at: chainFlows.at }
      : null,
    profitLeader: profit?.top ? { ...profit.top, source: profit.source, period: profit.period, at: flows?.at ?? null } : null,
    profitLeaders: profit?.leaders ?? [],
    profitPeriod: profit?.period ?? null,
    flowsAt: Number(flows?.at) || 0,
    flowsStale: flows?.stale === true,

    /* The named gaps stay in the contract: they are what a card shows when
       NONE of the real sources above answered, and they are the reason a
       price move is still never presented as a flow or as profit. */
    countryFlow: {
      available: Boolean(capitalInflow || chainFlows),
      reason: capitalInflow || chainFlows ? null : 'NO_VERIFIED_COUNTRY_FLOW_SOURCE'
    },
    capitalOutflow: {
      available: Boolean(capitalOutflowToken || chainFlows?.topOutflowChain),
      reason: capitalOutflowToken || chainFlows?.topOutflowChain ? null : 'NO_VERIFIED_FLOW_SOURCE'
    },
    companyProfit: {
      available: Boolean(profit?.top),
      reason: profit?.top ? null : 'NO_ACCOUNTING_PROFIT_SOURCE'
    }
  };
}

export function headerInsightItems(insights) {
  const out = [];
  if (insights?.cryptoLeader) {
    out.push({ kind: 'leader', item: insights.cryptoLeader, change24h: Number(insights.cryptoLeader.change24h) });
  }
  const leader = insights?.cryptoLeader;
  const laggard = insights?.cryptoLaggard;
  const sameCrypto = leader === laggard || (
    leader && laggard && (
      (leader.id != null && laggard.id != null && leader.id === laggard.id) ||
      (leader.symbol === laggard.symbol && leader.name === laggard.name)
    )
  );
  if (laggard && !sameCrypto) {
    out.push({ kind: 'laggard', item: laggard, change24h: Number(laggard.change24h) });
  }
  if (insights?.volumeLeader) {
    out.push({ kind: 'volume', item: insights.volumeLeader, change24h: Number(insights.volumeLeader.change24h) });
  }
  if (insights?.companyLeader) {
    out.push({ kind: 'company', item: insights.companyLeader, change24h: Number(insights.companyLeader.change24h) });
  }
  const event = insights?.eventStories?.[0];
  if (event) out.push({ kind: 'event', item: event, change24h: null });
  return out;
}
