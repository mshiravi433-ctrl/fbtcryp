#!/usr/bin/env node
/**
 * Capital flows + macro desk top-up probe.
 * ---------------------------------------------------------------------------
 * Covers the two data desks behind the News → هوشمندی / FBT جهانی cards that
 * used to answer «در این دور خوانده نشد.»:
 *
 *   A. server/capitalFlows.js — pure ranking honesty (a leader must be a real
 *      gain/loss, never the smallest loser; half-year filings never outrank
 *      quarters; noise-floor filtering), the three-upstream payload, per-source
 *      failure isolation, and the read-only contract.
 *   B. server/macroData.js    — keyless FRED CSV parsing, Alpha Vantage daily
 *      budget + rate-limit close, and the top-up merge that fills the yield
 *      curve / index cards without ever overwriting a primary read.
 *
 * No real network: fetch is mocked. Run: node test/capital-flows-probe.mjs
 */

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
/* Alpha Vantage spaces calls by ≥1.1s in production; the probe must not spend
   four seconds per test just proving the budget works. Read at module load. */
process.env.ALPHA_VANTAGE_MIN_SPACING_MS = '0';
process.env.MACRO_TOPUP_DEADLINE_MS = '20000';
delete process.env.ALPHA_VANTAGE_API_KEY;
delete process.env.FRED_API_KEY;

const rows = [];
const t = (name, ok, detail = '') => rows.push([name, Boolean(ok), ok ? '' : String(detail).slice(0, 240)]);

const originalFetch = globalThis.fetch;
const seen = [];
function mockFetch(handler) {
  seen.length = 0;
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    seen.push(u);
    return handler(u, opts);
  };
}
function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
}
function csvResponse(text, status = 200) {
  return new Response(text, { status, headers: { 'content-type': 'text/csv' } });
}
function failResponse(status = 503, body = 'upstream down') {
  return new Response(body, { status, headers: { 'content-type': 'text/plain' } });
}

const {
  rankTokenCapitalFlows,
  rankStablecoinFlows,
  latestReportedQuarters,
  rankProfitLeaders,
  secFilingUrl,
  buildCapitalFlows,
  capitalFlowsConfigured,
  _resetCapitalFlowsForTests
} = await import('../server/capitalFlows.js');

const {
  parseFredCsv,
  parseAvDaily,
  parseAvTreasury,
  avBudgetLeft,
  alphaVantageMacroConfigured,
  fetchMacroQuotes,
  _resetMacroDataForTests
} = await import('../server/macroData.js');

/** fetchMacroQuotes THROWS when no desk produced ≥3 instruments (the engine
 *  turns that into the macro domain's honest UNAVAILABLE) and otherwise returns
 *  `{items, at, source, tried, note}` — so the probe needs one wrapper to assert
 *  both halves of that contract. */
async function readMacro() {
  try {
    const value = await fetchMacroQuotes();
    const items = value?.items || [];
    return { ok: true, ...value, items, bySymbol: new Map(items.map((q) => [q.symbol, q])) };
  } catch (error) {
    return { ok: false, reason: String(error?.message || error), items: [], bySymbol: new Map() };
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   A1 · token capital flows (CoinGecko market-cap deltas)
   ══════════════════════════════════════════════════════════════════════════ */

const cgRows = [
  {
    id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', image: 'btc.png', market_cap_rank: 1,
    market_cap: 1.7e12, market_cap_change_24h: 25.1e9, market_cap_change_percentage_24h: 1.49,
    current_price: 84770, price_change_percentage_24h: 1.49, total_volume: 3.3e10,
    last_updated: '2026-10-01T23:46:30Z'
  },
  {
    id: 'ethereum', symbol: 'eth', name: 'Ethereum', image: 'eth.png', market_cap_rank: 2,
    market_cap: 4.9e11, market_cap_change_24h: 2.1e9, market_cap_change_percentage_24h: 0.43,
    current_price: 4006, price_change_percentage_24h: 0.43, total_volume: 2e10,
    last_updated: '2026-10-01T23:40:00Z'
  },
  {
    /* the biggest PRICE mover in the window, but only a small capital mover */
    id: 'pepe', symbol: 'pepe', name: 'Pepe', image: 'pepe.png', market_cap_rank: 31,
    market_cap: 2.2e9, market_cap_change_24h: 9.4e7, market_cap_change_percentage_24h: 4.4,
    current_price: 0.0000052, price_change_percentage_24h: 4.4, total_volume: 9e8,
    last_updated: '2026-10-01T23:44:00Z'
  },
  {
    id: 'dogecoin', symbol: 'doge', name: 'Dogecoin', image: 'doge.png', market_cap_rank: 9,
    market_cap: 2e10, market_cap_change_24h: -4.2e8, market_cap_change_percentage_24h: -2.1,
    current_price: 0.13, price_change_percentage_24h: -2.1, total_volume: 1e9,
    last_updated: '2026-10-01T23:41:00Z'
  },
  { id: 'broken', symbol: 'brk', name: 'Broken', market_cap: 10, market_cap_change_24h: null, market_cap_rank: 90 },
  { id: 'zero', symbol: 'zro', name: 'Zero', market_cap: 10, market_cap_change_24h: 0, current_price: 1, market_cap_rank: 99 }
];

const ranked = rankTokenCapitalFlows(cgRows);
t('the capital-flow leader is the biggest market-cap GAIN, not the biggest price move',
  ranked?.topInflow?.id === 'bitcoin' && ranked.topInflow.mcapChangeUsd === Math.round(25.1e9),
  ranked?.topInflow?.id);
t('the outflow leader is the biggest market-cap LOSS', ranked?.topOutflow?.id === 'dogecoin', ranked?.topOutflow?.id);
t('a row without a finite market-cap delta is dropped, never read as zero flow',
  ranked.count === 5 && !ranked.inflows.some((r) => r.id === 'broken') && !ranked.outflows.some((r) => r.id === 'broken'),
  ranked.count);
t('a flat row is counted but leads nothing',
  !ranked.inflows.some((r) => r.id === 'zero') && !ranked.outflows.some((r) => r.id === 'zero'));
t('inflows and outflows are ranked separately, worst/best first',
  ranked.inflows.map((r) => r.id).join(',') === 'bitcoin,ethereum,pepe'
  && ranked.outflows.map((r) => r.id).join(',') === 'dogecoin',
  ranked.inflows.map((r) => r.id).join(','));
t('totals separate capital in from capital out',
  ranked.totals.inflowUsd === Math.round(25.1e9 + 2.1e9 + 9.4e7)
  && ranked.totals.outflowUsd === Math.round(4.2e8)
  && ranked.totals.netUsd === ranked.totals.inflowUsd - ranked.totals.outflowUsd,
  JSON.stringify(ranked.totals));
t('every ranked row keeps the numbers the card prints (price, volume, rank, image)',
  ranked.inflows.every((r) => r.priceUsd != null && r.volumeUsd != null && r.rank != null)
  && typeof ranked.topInflow.image === 'string');

const allDown = rankTokenCapitalFlows([
  { id: 'a', symbol: 'A', name: 'A', market_cap: 10, market_cap_change_24h: -5, current_price: 1, market_cap_rank: 1 },
  { id: 'b', symbol: 'B', name: 'B', market_cap: 10, market_cap_change_24h: -1, current_price: 1, market_cap_rank: 2 }
]);
t('an all-negative window has NO inflow leader rather than the smallest loser',
  allDown.topInflow === null && allDown.topOutflow.id === 'a', JSON.stringify(allDown.topInflow));
t('an all-positive window has NO outflow leader',
  rankTokenCapitalFlows([{ id: 'c', symbol: 'C', name: 'C', market_cap: 10, market_cap_change_24h: 7, current_price: 1, market_cap_rank: 1 }]).topOutflow === null);
t('an empty or unusable feed ranks nothing instead of inventing a leader',
  rankTokenCapitalFlows([]) === null && rankTokenCapitalFlows(null) === null
  && rankTokenCapitalFlows([{ id: 'x', symbol: 'X', name: 'X', market_cap: 5, current_price: 1, market_cap_rank: 1 }]) === null);

/* ══════════════════════════════════════════════════════════════════════════
   A2 · stablecoin supply flows (DefiLlama) — real money in and out
   ══════════════════════════════════════════════════════════════════════════ */

const llama = {
  peggedAssets: [
    {
      id: '1', symbol: 'USDT', name: 'Tether', pegType: 'peggedUSD', pegMechanism: 'fiat-backed',
      circulating: { peggedUSD: 184e9 }, circulatingPrevDay: { peggedUSD: 183e9 }, circulatingPrevWeek: { peggedUSD: 182e9 },
      chainCirculating: {
        Ethereum: { current: { peggedUSD: 74e9 }, circulatingPrevDay: { peggedUSD: 73e9 }, circulatingPrevWeek: { peggedUSD: 72e9 } },
        Tron: { current: { peggedUSD: 92e9 }, circulatingPrevDay: { peggedUSD: 93e9 }, circulatingPrevWeek: { peggedUSD: 92e9 } },
        Dust: { current: { peggedUSD: 10 }, circulatingPrevDay: { peggedUSD: 900000 }, circulatingPrevWeek: { peggedUSD: 10 } }
      }
    },
    {
      id: '2', symbol: 'USDC', name: 'USD Coin', pegType: 'peggedUSD', pegMechanism: 'fiat-backed',
      circulating: { peggedUSD: 40e9 }, circulatingPrevDay: { peggedUSD: 39e9 }, circulatingPrevWeek: { peggedUSD: 41e9 },
      chainCirculating: {
        Ethereum: { current: { peggedUSD: 20e9 }, circulatingPrevDay: { peggedUSD: 19.5e9 }, circulatingPrevWeek: { peggedUSD: 20e9 } },
        Solana: { current: { peggedUSD: 8e9 }, circulatingPrevDay: { peggedUSD: 8.6e9 }, circulatingPrevWeek: { peggedUSD: 8e9 } }
      }
    },
    /* a non-USD peg contributes nothing to the USD totals */
    { id: '3', symbol: 'EURS', name: 'Euro stable', pegType: 'peggedEUR', circulating: { peggedEUR: 1e8 }, chainCirculating: {} }
  ]
};

const flows = rankStablecoinFlows(llama);
t('total stablecoin supply counts the USD leg only',
  flows?.assets === 2 && flows.totalCirculatingUsd === Math.round(224e9), JSON.stringify(flows && { a: flows.assets, t: flows.totalCirculatingUsd }));
t('the 24h net flow is current supply minus yesterday, not a price delta',
  flows.net24hUsd === Math.round(2e9) && flows.net7dUsd === Math.round(1e9), `${flows.net24hUsd}/${flows.net7dUsd}`);
t('Ethereum is the biggest chain inflow, summed across assets',
  flows.topInflowChain.chain === 'Ethereum' && flows.topInflowChain.net24hUsd === Math.round(1.5e9),
  JSON.stringify(flows.topInflowChain));
t('the biggest chain outflow is the worst 24h loss',
  flows.topOutflowChain.chain === 'Tron' && flows.topOutflowChain.net24hUsd === Math.round(-1e9),
  JSON.stringify(flows.topOutflowChain));
t('chain lists are ranked worst-first so [0] and [-1] are never the same row',
  flows.chainOutflows.map((c) => c.chain).join(',') === 'Tron,Solana'
  && flows.chainOutflows[0] !== flows.chainOutflows[flows.chainOutflows.length - 1],
  flows.chainOutflows.map((c) => c.chain).join(','));
t('a chain under the noise floor cannot top a flow ranking',
  !flows.chainOutflows.some((c) => c.chain === 'Dust') && !flows.chainInflows.some((c) => c.chain === 'Dust'));
t('the net flow percentage is rounded to a printable precision',
  Math.abs(flows.topInflowChain.net24hPct - 1.622) < 1e-9, flows.topInflowChain.net24hPct);
t('an empty stablecoin feed refuses instead of reporting zero flow',
  rankStablecoinFlows({ peggedAssets: [] }) === null && rankStablecoinFlows(null) === null);

/* ══════════════════════════════════════════════════════════════════════════
   A3 · reported corporate profit (SEC EDGAR XBRL frames)
   ══════════════════════════════════════════════════════════════════════════ */

t('the quarter in progress is never requested',
  latestReportedQuarters(new Date('2026-10-01T12:00:00Z'))[0] === 'CY2026Q3',
  latestReportedQuarters(new Date('2026-10-01T12:00:00Z'))[0]);
t('quarters walk backwards across a year boundary',
  latestReportedQuarters(new Date('2026-10-01T12:00:00Z')).slice(0, 5).join(',') === 'CY2026Q3,CY2026Q2,CY2026Q1,CY2025Q4,CY2025Q3');
t('January asks for the year that just ended first',
  latestReportedQuarters(new Date('2026-01-15T12:00:00Z'))[0] === 'CY2025Q4');
t('a missing clock falls back to the current date without throwing',
  Array.isArray(latestReportedQuarters()) && latestReportedQuarters().length === 5);

const frames = {
  taxonomy: 'us-gaap', tag: 'NetIncomeLoss', ccp: 'CY2026Q2', uom: 'USD',
  label: 'Net Income (Loss) Attributable to Parent', pts: 5,
  data: [
    { accn: '0001-26-000001', cik: 2488, entityName: 'ADVANCED MICRO DEVICES, INC', loc: 'US-CA', start: '2026-03-29', end: '2026-06-27', val: 2.297e9 },
    { accn: '0001-26-000002', cik: 4962, entityName: 'AMERICAN EXPRESS COMPANY', loc: 'US-NY', start: '2026-04-01', end: '2026-06-30', val: 3.11e9 },
    { accn: '0001-26-000003', cik: 10048, entityName: 'HALF YEAR HOLDINGS', loc: 'US-TX', start: '2026-01-01', end: '2026-06-30', val: 99e9 },
    { accn: '0001-26-000004', cik: 2969, entityName: 'AIR PRODUCTS AND CHEMICALS, INC.', loc: 'US-PA', start: '2026-04-01', end: '2026-06-30', val: -1.44e9 },
    { accn: '0001-26-000005', cik: 2488, entityName: 'ADVANCED MICRO DEVICES, INC', loc: 'US-CA', start: '2026-03-29', end: '2026-06-27', val: 2.5e9 }
  ]
};

const profit = rankProfitLeaders(frames, { minFacts: 4 });
t('a half-year filing never outranks a quarter, and the skip is counted',
  profit?.top?.name === 'AMERICAN EXPRESS COMPANY' && profit.skippedDuration === 1,
  `${profit?.top?.name}/${profit?.skippedDuration}`);
t('one company appears once, with its latest accession number',
  profit.companies === 2 && profit.leaders.find((r) => r.cik === 2488)?.netIncomeUsd === Math.round(2.5e9),
  JSON.stringify(profit.leaders.map((r) => [r.cik, r.netIncomeUsd])));
t('the weakest reported company is named, not just the winner',
  profit.weakest?.name === 'AIR PRODUCTS AND CHEMICALS, INC.' && profit.weakest.netIncomeUsd === Math.round(-1.44e9));
t('every number carries the filing it came from',
  /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/4962\/000126000002-index\.htm$/.test(profit.top.url),
  profit.top.url);
t('the reported period and tag travel with the ranking',
  profit.period === 'CY2026Q2' && profit.tag === 'NetIncomeLoss' && profit.facts === 5);
t('a frame with too few facts is refused rather than ranked',
  rankProfitLeaders({ data: [{ accn: 'a', cik: 1, entityName: 'X', start: '2026-04-01', end: '2026-06-30', val: 5 }] }) === null
  && rankProfitLeaders(null) === null);
t('a filing URL without an accession is refused instead of guessed',
  secFilingUrl(4962, '') === null && secFilingUrl(null, '0001-26-1') === null);

/* ══════════════════════════════════════════════════════════════════════════
   A4 · the assembled payload — three sources, isolated failures
   ══════════════════════════════════════════════════════════════════════════ */

/* EDGAR frames only become a ranked answer with enough facts behind them, so
   the payload test needs a realistic frame, not the five-row teaching fixture. */
const bulkData = [];
for (let i = 0; i < 60; i += 1) {
  bulkData.push({
    accn: `0001-26-${String(100000 + i)}`, cik: 20000 + i, entityName: `GENERATED HOLDINGS ${i}`,
    loc: 'US-DE', start: '2026-04-01', end: '2026-06-30', val: 1e8 + i * 1e6
  });
}
bulkData.push({ accn: '0001-26-000002', cik: 4962, entityName: 'AMERICAN EXPRESS COMPANY', loc: 'US-NY', start: '2026-04-01', end: '2026-06-30', val: 3.11e9 });
bulkData.push({ accn: '0001-26-000003', cik: 10048, entityName: 'HALF YEAR HOLDINGS', loc: 'US-TX', start: '2026-01-01', end: '2026-06-30', val: 99e9 });
bulkData.push({ accn: '0001-26-000004', cik: 2969, entityName: 'AIR PRODUCTS AND CHEMICALS, INC.', loc: 'US-PA', start: '2026-04-01', end: '2026-06-30', val: -1.44e9 });
const bulkFrames = { taxonomy: 'us-gaap', tag: 'NetIncomeLoss', ccp: 'CY2026Q2', uom: 'USD', label: 'Net Income (Loss) Attributable to Parent', pts: bulkData.length, data: bulkData };

/* The quarter that just ended is usually NOT published yet on day one of the
   next quarter, so the reader must walk past it — that walk is part of the
   contract and is asserted against the periods the code itself computes. */
const periods = latestReportedQuarters();

t('the flow read needs no secret at all',
  capitalFlowsConfigured().coingecko === true && capitalFlowsConfigured().defillama === true
  && capitalFlowsConfigured().secEdgar === true, JSON.stringify(capitalFlowsConfigured()));

function flowsHandler(u, { cg = 200, llamaStatus = 200, sec = 200 } = {}) {
  if (u.includes('api.coingecko.com')) return cg === 200 ? jsonResponse(cgRows) : failResponse(cg);
  if (u.includes('stablecoins.llama.fi')) return llamaStatus === 200 ? jsonResponse(llama) : failResponse(llamaStatus);
  if (u.includes('data.sec.gov')) {
    if (sec !== 200) return failResponse(sec);
    /* newest quarter not published yet → 404 → walk to the previous one */
    return u.includes(`/${periods[0]}.json`) ? failResponse(404, 'no frame yet') : jsonResponse(bulkFrames);
  }
  return failResponse(404, 'unexpected upstream');
}

mockFetch((u) => flowsHandler(u));
_resetCapitalFlowsForTests();
const full = await buildCapitalFlows();
t('all three sources live → ok with three live sections',
  full.ok === true && full.liveSections === 3 && full.schema === 'fbt.capital-flows.v1', `${full.ok}/${full.liveSections}`);
t('the payload is explicitly read-only and executes nothing',
  full.readOnly === true && full.executes === false && full.cached === false);
t('each section names the source that produced it',
  full.tokenFlows.source === 'coingecko:/coins/markets'
  && /defillama:/.test(full.chainFlows.source)
  && /sec-edgar:.*NetIncomeLoss/.test(full.profitLeaders.source),
  [full.tokenFlows.source, full.chainFlows.source, full.profitLeaders.source].join(' | '));
t('CoinGecko is asked for the ranked market-cap page the delta field arrives on',
  seen.some((u) => u.includes('vs_currency=usd') && u.includes('order=market_cap_desc') && u.includes('per_page=250')),
  seen.find((u) => u.includes('coingecko')));
t('the ranked rows carry the 24h market-cap delta the card prints',
  Number.isFinite(full.tokenFlows.topInflow?.mcapChangeUsd) && Number.isFinite(full.tokenFlows.topInflow?.mcapChangePct)
  && Array.isArray(full.tokenFlows.inflows) && full.tokenFlows.inflows.length > 0,
  JSON.stringify(full.tokenFlows.topInflow));
const secUrls = seen.filter((u) => u.includes('data.sec.gov'));
t('SEC is walked past an unpublished quarter to the newest complete frame',
  secUrls.length === 2 && secUrls[0].includes(`/${periods[0]}.json`) && secUrls[1].includes(`/${periods[1]}.json`)
  && full.profitLeaders.period === bulkFrames.ccp, secUrls.join(' | '));
t('the profit card ranks the real winner, skipping the half-year filing',
  full.profitLeaders.top?.name === 'AMERICAN EXPRESS COMPANY'
  && !full.profitLeaders.leaders.some((r) => r.name === 'HALF YEAR HOLDINGS'), full.profitLeaders.top?.name);
t('a stale section is never silently served as fresh', full.stale === false);
t('no secret and no upstream URL can leak into the payload',
  !JSON.stringify(full).includes('apikey') && !JSON.stringify(full).includes('https://api.coingecko.com'));

mockFetch((u) => flowsHandler(u, { cg: 429 }));
_resetCapitalFlowsForTests();
const partial = await buildCapitalFlows();
t('one dark source is isolated: CoinGecko 429 → UNAVAILABLE/RATE_LIMITED',
  partial.tokenFlows.status === 'UNAVAILABLE' && partial.tokenFlows.reason === 'RATE_LIMITED',
  `${partial.tokenFlows.status}/${partial.tokenFlows.reason}`);
t('the other two sections still answer, so the payload stays ok',
  partial.ok === true && partial.liveSections === 2
  && partial.chainFlows.status === 'OK' && partial.profitLeaders.status === 'OK', partial.liveSections);
t('a dark section carries no rows at all, not zeroed rows',
  !Array.isArray(partial.tokenFlows.inflows) && partial.tokenFlows.topInflow === undefined);

mockFetch((u) => flowsHandler(u, { cg: 503, llamaStatus: 503, sec: 503 }));
_resetCapitalFlowsForTests();
const dark = await buildCapitalFlows();
t('every source dark → ok:false and no invented numbers',
  dark.ok === false && dark.liveSections === 0
  && [dark.tokenFlows, dark.chainFlows, dark.profitLeaders].every((s) => s.status === 'UNAVAILABLE' && typeof s.reason === 'string' && s.reason.length > 0),
  JSON.stringify({ ok: dark.ok, reasons: [dark.tokenFlows.reason, dark.chainFlows.reason, dark.profitLeaders.reason] }));
t('an upstream error detail stays a bounded code, never a body or a URL',
  [dark.tokenFlows, dark.chainFlows, dark.profitLeaders].every((s) => s.detail === null || (s.detail.length <= 160
    && !s.detail.includes('http') && !s.detail.includes('<'))),
  JSON.stringify([dark.tokenFlows.detail, dark.chainFlows.detail, dark.profitLeaders.detail]));
t('a 5xx upstream is reported as a 5xx class, a 429 as RATE_LIMITED',
  dark.tokenFlows.reason === 'UPSTREAM_HTTP_5XX'
  && partial.tokenFlows.reason === 'RATE_LIMITED', `${dark.tokenFlows.reason}/${partial.tokenFlows.reason}`);

mockFetch(() => { throw new Error('socket hang up'); });
_resetCapitalFlowsForTests();
const offline = await buildCapitalFlows();
t('a network throw is caught per section, not thrown at the caller',
  offline.ok === false && offline.tokenFlows.status === 'UNAVAILABLE'
  && offline.tokenFlows.reason === 'NETWORK_UNAVAILABLE'
  && String(offline.tokenFlows.detail || '').includes('socket hang up'), offline.tokenFlows.reason);

/* ══════════════════════════════════════════════════════════════════════════
   B1 · parsers
   ══════════════════════════════════════════════════════════════════════════ */

const fredCsv = [
  'observation_date,T10Y2Y',
  '2026-09-29,0.44',
  '2026-09-30,.',          // FRED prints a bare dot for a holiday
  '2026-10-01,',           // and an empty cell when the day is not published
  '2026-10-01,0.46'        // a duplicate date keeps the newest non-empty value
].join('\n');
const fred = parseFredCsv(fredCsv);
t('fredgraph.csv skips holidays and empty cells', fred.length === 2, fred.length);
t('fredgraph.csv returns ascending {ts, price} points',
  fred[0].price === 0.44 && fred.at(-1).price === 0.46 && fred[0].ts < fred.at(-1).ts);
t('a non-CSV fredgraph error page parses to nothing', parseFredCsv('<html>rate limited</html>').length === 0);

const avDaily = parseAvDaily({
  'Meta Data': { '3. Last Refreshed': '2026-10-01 16:00:00' },
  'Time Series (Daily)': {
    '2026-10-01': { '4. close': '672.3500', '5. volume': '48213000' },
    '2026-09-30': { '4. close': '668.1100' },
    '2026-09-24': { '4. close': '655.0000' }
  }
});
t('an Alpha Vantage daily series is sorted into an ascending close-history',
  avDaily.length === 3 && avDaily.at(-1).price === 672.35 && avDaily[0].price === 655
  && avDaily[0].ts < avDaily.at(-1).ts, JSON.stringify(avDaily));
t('an Alpha Vantage rate-limit blob parses to nothing',
  parseAvDaily({ Information: 'Thank you for using Alpha Vantage! ... 25 requests per day ...' }).length === 0);

const avTreasury = parseAvTreasury({ data: [
  { date: '2026-10-01', value: '4.12' },
  { date: '2026-09-30', value: 'N/A' },
  { date: '2026-09-29', value: '4.08' }
] });
t('TREASURY_YIELD drops N/A days and sorts ascending',
  avTreasury.length === 2 && avTreasury[0].price === 4.08 && avTreasury.at(-1).price === 4.12);
t('a missing TREASURY_YIELD body parses to nothing', parseAvTreasury({ data: null }).length === 0);

/* ══════════════════════════════════════════════════════════════════════════
   B2 · the top-up merge — a keyless desk fills what the primary could not
   ══════════════════════════════════════════════════════════════════════════ */

/* stooq's daily export is `Date,Open,High,Low,Close,Volume` — the close is
   column 4, and a 7-day change needs an observation at least 7 days back. */
const stooqCsv = [
  'Date,Open,High,Low,Close,Volume',
  '2026-10-01,100.50,101.80,100.20,101.00,1200000',
  '2026-09-30,99.80,100.60,99.50,100.00,1100000',
  '2026-09-23,97.50,98.40,97.10,98.00,1000000'
].join('\n');
const fredSeries = (v0, v1) => `observation_date,X\n2026-09-30,${v0}\n2026-10-01,${v1}\n`;

function macroHandler(u, { stooq = true, yahoo = false, fred = true } = {}) {
  if (u.includes('stooq.com')) return stooq ? csvResponse(stooqCsv) : failResponse(404, 'page does not exist');
  if (u.includes('query1.finance.yahoo.com')) return yahoo ? jsonResponse({}) : failResponse(429);
  if (u.includes('fredgraph.csv')) {
    if (!fred) return failResponse(503);
    const id = new URL(u).searchParams.get('id');
    const map = { DGS10: [4.08, 4.12], DGS2: [3.62, 3.66], DGS30: [4.60, 4.66], T10Y2Y: [0.40, 0.46], DCOILWTICO: [60.1, 61.4], DCOILBRENTEU: [63.9, 65.2], GOLDPMGBD228NLBM: [3845.5, 3888.1] };
    const pair = map[id] || [1, 1];
    return csvResponse(fredSeries(pair[0], pair[1]));
  }
  if (u.includes('api.stlouisfed.org')) return jsonResponse({});
  if (u.includes('alphavantage.co')) return jsonResponse({ Note: 'Thank you for using Alpha Vantage!' });
  return failResponse(404, 'unexpected ' + u);
}

mockFetch((u) => macroHandler(u));
_resetMacroDataForTests();
const topped = await readMacro();
const bySymbol = topped.bySymbol;
t('a keyless primary desk (stooq) still answers', topped.ok && topped.items.length >= 3, topped.reason);
t('stooq keeps every symbol it read — the top-up never overwrites a primary',
  bySymbol.get('DXY')?.source === 'stooq:DX.F' && bySymbol.get('GOLD')?.source === 'stooq:GC.F'
  && bySymbol.get('SPX')?.source === 'stooq:ES.F');
t('the treasury ladder is topped up from keyless FRED CSV',
  bySymbol.get('US10Y')?.source === 'fredcsv:DGS10' && bySymbol.get('US2Y')?.source === 'fredcsv:DGS2'
  && bySymbol.get('US30Y')?.source === 'fredcsv:DGS30',
  [bySymbol.get('US10Y')?.source, bySymbol.get('US2Y')?.source, bySymbol.get('US30Y')?.source].join('/'));
t('the yield-curve spread is rebuilt from the topped-up pair',
  bySymbol.get('US2S10S')?.kind === 'curve' && Math.abs(bySymbol.get('US2S10S').priceUsd - 0.46) < 1e-9,
  bySymbol.get('US2S10S')?.priceUsd);
t('the envelope names the mix of desks it used', topped.source === 'macroData:stooq+topup', topped.source);
t('no Alpha Vantage request is made while the keyless desks answer',
  !seen.some((u) => u.includes('alphavantage.co')), seen.filter((u) => u.includes('alphavantage.co')).join(','));
t('yahoo is asked only for symbols stooq could not read',
  seen.filter((u) => u.includes('query1.finance.yahoo.com')).every((u) => /%5ETNX|SPY|QQQ/.test(u)),
  seen.filter((u) => u.includes('query1.finance.yahoo.com')).join(','));
t('a topped-up treasury carries a change and an observation time',
  Number.isFinite(bySymbol.get('US10Y')?.change1dPct) && Number.isFinite(bySymbol.get('US10Y')?.at));
t('every instrument still carries its own desk, never the envelope source',
  topped.items.every((q) => typeof q.source === 'string' && q.source.length > 0 && !q.source.startsWith('macroData:')));

mockFetch((u) => macroHandler(u, { stooq: false, yahoo: false }));
_resetMacroDataForTests();
const fredOnly = await readMacro();
t('with stooq and yahoo dark, keyless FRED CSV alone is a valid primary',
  fredOnly.ok && fredOnly.source === 'macroData:fredcsv', `${fredOnly.ok}/${fredOnly.source}/${fredOnly.reason}`);
t('the FRED-only pass reads the seven series it owns and no equity',
  fredOnly.items.length === 7 && fredOnly.bySymbol.get('US2S10S')?.kind === 'curve'
  && !fredOnly.items.some((q) => q.kind === 'equity'), fredOnly.items.length);

mockFetch((u) => macroHandler(u, { stooq: false, yahoo: false, fred: false }));
_resetMacroDataForTests();
const nothing = await readMacro();
t('every desk dark → NO_MACRO_DATA_SOURCE, never a fabricated quote',
  !nothing.ok && nothing.reason === 'NO_MACRO_DATA_SOURCE' && nothing.items.length === 0, nothing.reason);

/* ══════════════════════════════════════════════════════════════════════════
   B3 · Alpha Vantage as the LAST desk, inside a hard daily budget
   ══════════════════════════════════════════════════════════════════════════ */

process.env.ALPHA_VANTAGE_API_KEY = 'probe-av-key';
const avQuotes = {
  SPY: { 'Time Series (Daily)': { '2026-10-01': { '4. close': '672.35' }, '2026-09-30': { '4. close': '668.11' }, '2026-09-23': { '4. close': '655.00' } }, 'Meta Data': { '3. Last Refreshed': '2026-10-01 16:00:00' } },
  QQQ: { 'Time Series (Daily)': { '2026-10-01': { '4. close': '612.10' }, '2026-09-30': { '4. close': '608.00' }, '2026-09-23': { '4. close': '599.50' } }, 'Meta Data': { '3. Last Refreshed': '2026-10-01 16:00:00' } }
};
function avHandler(u) {
  if (u.includes('alphavantage.co')) {
    const query = new URL(u).searchParams;
    if (query.get('function') === 'TREASURY_YIELD') {
      const map = { '2year': [3.62, 3.66], '10year': [4.08, 4.12], '30year': [4.60, 4.66] };
      const pair = map[query.get('maturity')] || [1, 1];
      return jsonResponse({ data: [{ date: '2026-09-30', value: String(pair[0]) }, { date: '2026-10-01', value: String(pair[1]) }] });
    }
    const series = avQuotes[query.get('symbol')];
    return series ? jsonResponse(series) : jsonResponse({ Note: 'Thank you for using Alpha Vantage! Our API call frequency is limited.' });
  }
  return macroHandler(u, { stooq: false, yahoo: false, fred: false });
}

t('the macro desk still has budget at the start of a UTC day', avBudgetLeft() > 0, avBudgetLeft());

mockFetch((u) => avHandler(u));
_resetMacroDataForTests();
const avPrimary = await readMacro();
const avSymbols = avPrimary.items.map((q) => q.symbol);
t('with every keyless desk dark, Alpha Vantage becomes the primary',
  avPrimary.ok && avPrimary.source === 'macroData:av', `${avPrimary.ok}/${avPrimary.source}/${avPrimary.reason}`);
t('one pass stays inside the per-pass cap, protecting the 25/day key',
  seen.filter((u) => u.includes('alphavantage.co')).length === 4 && !avSymbols.includes('QQQ'),
  `${avSymbols.join(',')} / ${seen.filter((u) => u.includes('alphavantage.co')).length}`);
t('Alpha Vantage reads the index ETF and the treasury ladder',
  avSymbols.includes('SPY') && avSymbols.includes('US10Y') && avSymbols.includes('US2Y') && avSymbols.includes('US30Y'),
  avSymbols.join(','));
t('an ETF read is labelled as an ETF, never relabelled as the index it tracks',
  (avPrimary.bySymbol.get('SPY')?.name || '').toLowerCase().includes('etf')
  && avPrimary.bySymbol.get('SPY')?.kind === 'equity'
  && avPrimary.bySymbol.get('SPY')?.unit === 'USD/share',
  avPrimary.bySymbol.get('SPY')?.name);
t('the yield-curve card is derived from the treasury pair',
  avPrimary.bySymbol.get('US2S10S') == null && avPrimary.bySymbol.get('US10Y')?.priceUsd === 4.12
  && avPrimary.bySymbol.get('US2Y')?.priceUsd === 3.66);
t('the daily budget was spent, not bypassed', avBudgetLeft() === 2, avBudgetLeft());

seen.length = 0;
const cached = await readMacro();
t('an accepted pass is cached, so the next read costs no requests at all',
  cached.ok && seen.filter((u) => u.includes('alphavantage.co')).length === 0
  && cached.items.length === avPrimary.items.length,
  seen.filter((u) => u.includes('alphavantage.co')).length);

/* A rate-limit blob closes the budget for the day: the desk must not keep
   burning requests it will never get an answer from. */
mockFetch((u) => (u.includes('alphavantage.co')
  ? jsonResponse({ Information: 'Thank you for using Alpha Vantage! This is a premium endpoint... 25 requests per day...' })
  : macroHandler(u, { stooq: false, yahoo: false, fred: false })));
_resetMacroDataForTests();
const limited = await readMacro();
t('a rate-limit Information blob closes the budget for the day', avBudgetLeft() === 0, avBudgetLeft());
t('with no desk and no budget, the read fails honestly',
  !limited.ok && limited.reason === 'NO_MACRO_DATA_SOURCE', limited.reason);

mockFetch((u) => avHandler(u));
const exhausted = await readMacro();
t('an exhausted budget makes zero further requests and still fails honestly',
  !exhausted.ok && exhausted.reason === 'NO_MACRO_DATA_SOURCE'
  && seen.filter((u) => u.includes('alphavantage.co')).length === 0,
  `${exhausted.reason}/${seen.filter((u) => u.includes('alphavantage.co')).length}`);
t('a key too short to be real is treated as unconfigured',
  (process.env.ALPHA_VANTAGE_API_KEY = 'short', alphaVantageMacroConfigured() === false));

/* ══════════════════════════════════════════════════════════════════════════
   cleanup + report
   ══════════════════════════════════════════════════════════════════════════ */

globalThis.fetch = originalFetch;
_resetCapitalFlowsForTests();
_resetMacroDataForTests();
delete process.env.ALPHA_VANTAGE_API_KEY;
delete process.env.ALPHA_VANTAGE_MIN_SPACING_MS;
delete process.env.MACRO_TOPUP_DEADLINE_MS;

const failed = rows.filter((r) => !r[1]);
for (const [name, ok, detail] of rows) {
  console.log(`${ok ? 'ok' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}
console.log(`\n${rows.length - failed.length}/${rows.length} passed`);
if (failed.length) process.exit(1);
