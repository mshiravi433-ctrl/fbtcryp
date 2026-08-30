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

/**
 * Compact rotation candidates. Brand slots are inserted by Header itself so
 * the data model stays independent of timing and animation.
 */
function rankByVolume(rows = []) {
  const clean = (Array.isArray(rows) ? rows : [])
    .filter((row) => row?.name && row?.symbol && hasFiniteMove(row) && Number.isFinite(Number(row?.volume)) && Number(row?.volume) > 0);
  return [...clean].sort((a, b) => Number(b.volume) - Number(a.volume))[0] ?? null;
}

function rankByMarketCap(rows = []) {
  const clean = (Array.isArray(rows) ? rows : [])
    .filter((row) => row?.name && row?.symbol && hasFiniteMove(row) && Number.isFinite(Number(row?.mcap)) && Number(row?.mcap) > 0);
  return [...clean].sort((a, b) => Number(b.mcap) - Number(a.mcap))[0] ?? null;
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
  const { markets = [], equities = [], news = [] } = input ?? {};
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

  return {
    cryptoLeader,
    cryptoLaggard,
    tokenizedLeader,
    companyLeader,
    volumeLeader,
    marketCapLeader,
    volatilityLeader,
    eventStories,

    // Explicitly unavailable rather than inferred from price, market cap,
    // token liquidity, or Avantis open interest. None of those is capital flow.
    countryFlow: { available: false, reason: 'NO_VERIFIED_COUNTRY_FLOW_SOURCE' },
    capitalOutflow: { available: false, reason: 'NO_VERIFIED_FLOW_SOURCE' },

    // The company token card is labelled as 24h market performance. Accounting
    // profitability remains unknown even when a company token has risen.
    companyProfit: { available: false, reason: 'NO_ACCOUNTING_PROFIT_SOURCE' }
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
