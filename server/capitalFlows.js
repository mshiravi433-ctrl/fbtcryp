/**
 * FBT — CAPITAL FLOWS & REPORTED PROFIT (the news-intelligence fill-in).
 * ---------------------------------------------------------------------------
 * «برای اطلاعات ناکافی در صفحه اخبار … اگر نبود، مثلا آنجا که نوشته ورود سرمایه
 * به کشور را بجایش بیشترین توکنی که سرمایه جذب کرده عوض کن، یا هر داده‌ای که
 * می‌توانی از یک API رایگان بگیری.»
 *
 * Three cards on the News → هوشمندی tab (and two on News → هوش جهانی) were
 * permanently empty BY DESIGN: no connected source could prove country-level
 * capital flow, accounting profit, or money leaving the market, so the panel
 * said «no verified source» instead of inventing a proxy. That was the right
 * call at the time. It is no longer the whole truth, because three free,
 * keyless, public sources DO answer three honest versions of those questions:
 *
 *   1. CoinGecko `/coins/markets` returns `market_cap_change_24h` — the USD
 *      change of each asset's market capitalisation over 24h. The token whose
 *      capitalisation grew the most is, literally, «the token that attracted
 *      the most capital». That is the replacement the user asked for, and it
 *      is a measured number rather than a proxy dressed up as one.
 *
 *   2. DefiLlama `stablecoins.llama.fi/stablecoins` returns, per stablecoin
 *      and per chain, `circulating` against `circulatingPrevDay` and
 *      `circulatingPrevWeek`. Stablecoin supply IS money entering or leaving
 *      crypto: tokens are minted when fiat arrives and burned when it leaves.
 *      Summing the deltas gives real 24h/7d net flows per chain — the
 *      «biggest / smallest outflow» card, with a source anyone can open.
 *
 *   3. SEC EDGAR's XBRL «frames» API returns every `NetIncomeLoss` fact
 *      American public filers reported for one quarter — audited accounting
 *      numbers, keyless, official. That is the «verified accounting source»
 *      the سودده‌ترین شرکت card was waiting for.
 *
 * ─── THE HONESTY RULES THIS MODULE KEEPS (inherited from the whole repo) ────
 *   · every section carries `status`, `source` and `at`; a dead upstream is an
 *     UNAVAILABLE section with a reason code, never a zero and never a guess
 *   · nothing here is derived from price alone: a market-cap delta is labelled
 *     as a market-cap delta, a stablecoin delta as stablecoin supply, a
 *     reported net income as a reported net income for a named period
 *   · a quarter frame mixes 3-month and 6-month durations, which would rank a
 *     half-year against a quarter; `rankProfitLeaders` keeps only durations
 *     that are actually a quarter (80–100 days) so the comparison is fair
 *   · read-only: this module never signs, never writes, never executes
 *
 * Alpha Vantage is deliberately NOT used here. Its free tier is 25 requests
 * per DAY, which the ETF/gold panels already spend; these three sources are
 * keyless and unlimited enough to poll every 15 minutes.
 */

import { memoryStore, withCache } from './cache.js';

export const FLOW_SCHEMA = 'fbt.capital-flows.v1';

/* ── upstreams (all keyless; CoinGecko honours the same env keys as providers.js) */
const CG_BASE = process.env.COINGECKO_BASE || 'https://api.coingecko.com/api/v3';
const CG_PRO_BASE = 'https://pro-api.coingecko.com/api/v3';
const CG_KEY = process.env.COINGECKO_API_KEY || '';
const CG_IS_PRO = process.env.COINGECKO_PLAN === 'pro';
const CG_PER_PAGE = Math.min(250, Number(process.env.CAPITAL_FLOWS_COIN_PAGE_SIZE || 250));

const LLAMA_STABLE_BASE = process.env.DEFILLAMA_STABLECOINS_BASE || 'https://stablecoins.llama.fi';
const SEC_BASE = process.env.SEC_EDGAR_BASE || 'https://data.sec.gov';
/* SEC asks every bulk client to name itself; a bare fetch UA gets 403. */
const SEC_UA = process.env.SEC_EDGAR_USER_AGENT
  || 'fbt-swap-app/1.0 (read-only market intelligence; https://github.com/mshiravi433-ctrl/fbtcryp)';

const TIMEOUT_MS = Number(process.env.CAPITAL_FLOWS_TIMEOUT_MS || 12_000);

export const FLOW_TTL = Object.freeze({
  /** Token + stablecoin flows move intraday; 15 minutes is plenty and cheap. */
  flowsMs: 15 * 60_000,
  /** Reported earnings change quarterly — six hours is already generous. */
  profitMs: 6 * 3600_000,
  /** How long a last-good answer may be served as stale after upstream fails. */
  staleGraceMs: 7 * 24 * 3600_000
});

/** A chain smaller than this cannot top a flow ranking without being noise. */
const MIN_CHAIN_USD = Number(process.env.CAPITAL_FLOWS_MIN_CHAIN_USD || 1_000_000);
const LIST_LIMIT = 5;

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const round = (v, digits = 2) => {
  const n = num(v);
  if (n === null) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};
const DAY_MS = 86_400_000;

/* ── transport ─────────────────────────────────────────────────────────────── */

async function fetchJson(url, { headers = {}, timeout = TIMEOUT_MS } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: 'application/json', 'user-agent': 'fbt-swap-app/1.0', ...headers }
    });
    if (!res.ok) {
      const err = new Error(`UPSTREAM_HTTP_${res.status}`);
      err.code = res.status === 429 ? 'RATE_LIMITED' : res.status >= 500 ? 'UPSTREAM_HTTP_5XX' : 'UPSTREAM_HTTP_4XX';
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } catch (err) {
    if (err?.code) throw err;
    if (err?.name === 'AbortError') {
      const t = new Error('UPSTREAM_TIMEOUT');
      t.code = 'RPC_TIMEOUT';
      throw t;
    }
    const t = new Error('UPSTREAM_UNREACHABLE');
    t.code = 'NETWORK_UNAVAILABLE';
    t.detail = String(err?.message || err).slice(0, 160);
    throw t;
  } finally {
    clearTimeout(timer);
  }
}

function cgUrl(path, params = {}) {
  const base = CG_IS_PRO ? CG_PRO_BASE : CG_BASE;
  const qs = new URLSearchParams(params);
  if (CG_KEY) qs.set(CG_IS_PRO ? 'x_cg_pro_api_key' : 'x_cg_demo_api_key', CG_KEY);
  return `${base}${path}?${qs.toString()}`;
}

/* ══════════════════════════════════════════════════════════════════════════
   1 · TOKEN CAPITAL FLOWS — CoinGecko market-cap deltas
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Pure ranking over `/coins/markets` rows.
 *
 * `market_cap_change_24h` is the USD change of circulating market
 * capitalisation over the last 24 hours. Positive = capital was added to the
 * asset's valuation, negative = capital left it. Rows without a finite delta
 * are dropped rather than treated as zero.
 */
export function rankTokenCapitalFlows(rows = [], { at = Date.now(), limit = LIST_LIMIT } = {}) {
  const clean = (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      id: String(row?.id || '').slice(0, 64),
      symbol: String(row?.symbol || '').toUpperCase().slice(0, 16),
      name: String(row?.name || '').slice(0, 64),
      image: row?.image || null,
      rank: num(row?.market_cap_rank),
      priceUsd: num(row?.current_price),
      mcapUsd: num(row?.market_cap),
      mcapChangeUsd: num(row?.market_cap_change_24h),
      mcapChangePct: num(row?.market_cap_change_percentage_24h),
      change24hPct: num(row?.price_change_percentage_24h ?? row?.price_change_percentage_24h_in_currency),
      change7dPct: num(row?.price_change_percentage_7d_in_currency ?? row?.price_change_percentage_7d),
      volumeUsd: num(row?.total_volume),
      updatedAt: row?.last_updated || null
    }))
    .filter((row) => row.id && row.symbol && row.mcapChangeUsd !== null && row.mcapUsd !== null);

  if (!clean.length) return null;

  const desc = [...clean].sort((a, b) => b.mcapChangeUsd - a.mcapChangeUsd);
  /* An «inflow leader» that lost value is not an inflow leader: the card says
     «nothing attracted capital in this window» instead of borrowing the
     smallest loser. Same for the outflow side. */
  const topInflow = desc[0]?.mcapChangeUsd > 0 ? desc[0] : null;
  const topOutflow = desc[desc.length - 1]?.mcapChangeUsd < 0 ? desc[desc.length - 1] : null;

  let inflowUsd = 0;
  let outflowUsd = 0;
  for (const row of clean) {
    if (row.mcapChangeUsd > 0) inflowUsd += row.mcapChangeUsd;
    else if (row.mcapChangeUsd < 0) outflowUsd += -row.mcapChangeUsd;
  }

  return {
    status: 'OK',
    source: 'coingecko:/coins/markets',
    metric: 'market_cap_change_24h',
    at,
    count: clean.length,
    topInflow,
    topOutflow,
    inflows: desc.filter((r) => r.mcapChangeUsd > 0).slice(0, limit),
    outflows: desc.filter((r) => r.mcapChangeUsd < 0).slice(-limit).reverse(),
    totals: {
      inflowUsd: Math.round(inflowUsd),
      outflowUsd: Math.round(outflowUsd),
      netUsd: Math.round(inflowUsd - outflowUsd)
    }
  };
}

export async function fetchTokenCapitalFlows() {
  const raw = await fetchJson(cgUrl('/coins/markets', {
    vs_currency: 'usd',
    order: 'market_cap_desc',
    per_page: String(CG_PER_PAGE),
    page: '1',
    sparkline: 'false',
    price_change_percentage: '24h,7d'
  }));
  if (!Array.isArray(raw)) {
    const err = new Error('SHAPE_UNUSABLE');
    err.code = 'COINGECKO_SHAPE_UNUSABLE';
    throw err;
  }
  const ranked = rankTokenCapitalFlows(raw, { at: Date.now() });
  if (!ranked) {
    const err = new Error('NO_ROWS_WITH_CAPITAL_CHANGE');
    err.code = 'NO_CAPITAL_FLOW_ROWS';
    throw err;
  }
  return ranked;
}

/* ══════════════════════════════════════════════════════════════════════════
   2 · STABLECOIN FLOWS — DefiLlama supply deltas (money in / out of crypto)
   ══════════════════════════════════════════════════════════════════════════ */

/* Only the USD-pegged leg is summed: a EUR-pegged asset's `peggedEUR` is a
   different unit, and adding it to a dollar total would be a fabricated
   number rather than a conversion. */
const usdOf = (block) => num(block?.peggedUSD);

/**
 * Pure aggregation over `stablecoins.llama.fi/stablecoins`.
 *
 * Each pegged asset carries `circulating` / `circulatingPrevDay` /
 * `circulatingPrevWeek` globally and again per chain (`chainCirculating`).
 * The difference IS the flow: supply is minted when capital arrives and
 * burned when it leaves, so a chain whose stablecoin supply fell by $40M in
 * 24h really did see $40M of dollar-pegged capital leave.
 */
export function rankStablecoinFlows(payload = {}, { at = Date.now(), minChainUsd = MIN_CHAIN_USD, limit = LIST_LIMIT } = {}) {
  const assets = Array.isArray(payload?.peggedAssets) ? payload.peggedAssets : [];
  if (!assets.length) return null;

  const chains = new Map();
  const rows = [];
  let totalUsd = 0;
  let totalPrevDay = 0;
  let totalPrevWeek = 0;
  let usable = 0;

  for (const asset of assets) {
    const current = usdOf(asset?.circulating);
    const prevDay = usdOf(asset?.circulatingPrevDay);
    const prevWeek = usdOf(asset?.circulatingPrevWeek);
    const symbol = String(asset?.symbol || '').slice(0, 16);
    if (!symbol || current === null) continue;
    usable += 1;
    totalUsd += current;
    totalPrevDay += prevDay ?? current;
    totalPrevWeek += prevWeek ?? current;
    rows.push({
      symbol,
      name: String(asset?.name || symbol).slice(0, 48),
      pegType: String(asset?.pegType || '').slice(0, 16) || null,
      pegMechanism: String(asset?.pegMechanism || '').slice(0, 24) || null,
      circulatingUsd: Math.round(current),
      net24hUsd: prevDay === null ? null : Math.round(current - prevDay),
      net7dUsd: prevWeek === null ? null : Math.round(current - prevWeek)
    });

    const perChain = asset?.chainCirculating && typeof asset.chainCirculating === 'object'
      ? asset.chainCirculating
      : {};
    for (const [chain, block] of Object.entries(perChain)) {
      const cNow = usdOf(block?.current);
      const cDay = usdOf(block?.circulatingPrevDay);
      const cWeek = usdOf(block?.circulatingPrevWeek);
      if (cNow === null && cDay === null) continue;
      const key = String(chain).slice(0, 40);
      const prev = chains.get(key) || { chain: key, currentUsd: 0, prevDayUsd: 0, prevWeekUsd: 0, assets: 0 };
      prev.currentUsd += cNow ?? 0;
      prev.prevDayUsd += cDay ?? (cNow ?? 0);
      prev.prevWeekUsd += cWeek ?? (cNow ?? 0);
      prev.assets += 1;
      chains.set(key, prev);
    }
  }

  if (!usable) return null;

  const chainRows = [...chains.values()]
    .filter((c) => Math.max(c.currentUsd, c.prevDayUsd) >= minChainUsd)
    .map((c) => ({
      chain: c.chain,
      currentUsd: Math.round(c.currentUsd),
      net24hUsd: Math.round(c.currentUsd - c.prevDayUsd),
      net7dUsd: Math.round(c.currentUsd - c.prevWeekUsd),
      net24hPct: c.prevDayUsd > 0 ? round(((c.currentUsd - c.prevDayUsd) / c.prevDayUsd) * 100, 3) : null,
      assets: c.assets
    }));

  if (!chainRows.length) return null;

  const byFlow = [...chainRows].sort((a, b) => b.net24hUsd - a.net24hUsd);
  const topInflowChain = byFlow[0]?.net24hUsd > 0 ? byFlow[0] : null;
  const topOutflowChain = byFlow[byFlow.length - 1]?.net24hUsd < 0 ? byFlow[byFlow.length - 1] : null;

  return {
    status: 'OK',
    source: 'defillama:stablecoins.llama.fi/stablecoins',
    metric: 'circulating_supply_delta',
    at,
    assets: usable,
    chains: chainRows.length,
    totalCirculatingUsd: Math.round(totalUsd),
    net24hUsd: Math.round(totalUsd - totalPrevDay),
    net7dUsd: Math.round(totalUsd - totalPrevWeek),
    net24hPct: totalPrevDay > 0 ? round(((totalUsd - totalPrevDay) / totalPrevDay) * 100, 4) : null,
    topInflowChain,
    topOutflowChain,
    chainInflows: byFlow.filter((c) => c.net24hUsd > 0).slice(0, limit),
    chainOutflows: byFlow.filter((c) => c.net24hUsd < 0).slice(-limit).reverse(),
    topAssets: [...rows].sort((a, b) => Math.abs(b.net24hUsd ?? 0) - Math.abs(a.net24hUsd ?? 0)).slice(0, limit)
  };
}

export async function fetchStablecoinFlows() {
  /* includePrices=false keeps the payload a third smaller: this read only
     needs supply, and DefiLlama's own price for a stablecoin is not what any
     card here claims to show. */
  const payload = await fetchJson(`${LLAMA_STABLE_BASE}/stablecoins?includePrices=false`, {
    timeout: Math.max(TIMEOUT_MS, 20_000)
  });
  const ranked = rankStablecoinFlows(payload, { at: Date.now() });
  if (!ranked) {
    const err = new Error('NO_STABLECOIN_SUPPLY_ROWS');
    err.code = 'FLOW_SHAPE_UNUSABLE';
    throw err;
  }
  return ranked;
}

/* ══════════════════════════════════════════════════════════════════════════
   3 · REPORTED PROFIT — SEC EDGAR XBRL frames (audited accounting numbers)
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The quarterly frame labels worth trying, newest first.
 *
 * A quarter's filings keep arriving for ~45 days after it ends, so the newest
 * frame that is genuinely populated lags the calendar. The caller walks this
 * list and stops at the first frame with enough facts — the period it used is
 * always reported next to the number.
 */
export function latestReportedQuarters(now = new Date(), count = 5) {
  const d = now instanceof Date && Number.isFinite(now.getTime()) ? now : new Date();
  const out = [];
  let year = d.getUTCFullYear();
  /* The quarter in progress has no complete filings at all. */
  let quarter = Math.floor(d.getUTCMonth() / 3) + 1;
  for (let i = 0; i < count + 2 && out.length < count; i += 1) {
    quarter -= 1;
    if (quarter === 0) { quarter = 4; year -= 1; }
    out.push(`CY${year}Q${quarter}`);
  }
  return out;
}

const QUARTER_MIN_DAYS = 80;
const QUARTER_MAX_DAYS = 100;

/** One EDGAR filing index page, so a reader can open the number's source. */
export function secFilingUrl(cik, accn) {
  const c = num(cik);
  const a = String(accn || '').replace(/-/g, '');
  if (c === null || !a) return null;
  return `https://www.sec.gov/Archives/edgar/data/${Math.trunc(c)}/${a}-index.htm`;
}

/**
 * Pure ranking over an EDGAR frames response.
 *
 * `frames` mixes reporting periods: a company whose fiscal half ended inside
 * the quarter reports a 6-month NetIncomeLoss against the same frame as a
 * neighbour's 3-month one. Ranking those together would crown whoever has the
 * longest duration, so only real quarters (80–100 days) are eligible by
 * default, and the duration that made each row eligible is returned with it.
 */
export function rankProfitLeaders(frames = {}, { limit = LIST_LIMIT, quarterOnly = true, minFacts = 40 } = {}) {
  const data = Array.isArray(frames?.data) ? frames.data : [];
  if (data.length < minFacts) return null;

  const byCik = new Map();
  let skippedDuration = 0;
  for (const row of data) {
    const val = num(row?.val);
    const cik = num(row?.cik);
    if (val === null || cik === null) continue;
    const start = Date.parse(row?.start || '');
    const end = Date.parse(row?.end || '');
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const days = Math.round((end - start) / DAY_MS);
    if (quarterOnly && (days < QUARTER_MIN_DAYS || days > QUARTER_MAX_DAYS)) { skippedDuration += 1; continue; }
    /* Amendments and restatements land in the same frame; the latest filing
       for a CIK is the one a reader would find on EDGAR today. */
    const prev = byCik.get(cik);
    if (prev && String(prev.accn || '') >= String(row?.accn || '')) continue;
    byCik.set(cik, {
      cik: Math.trunc(cik),
      name: String(row?.entityName || '').slice(0, 80),
      loc: String(row?.loc || '').slice(0, 12) || null,
      netIncomeUsd: val,
      periodStart: String(row?.start || '').slice(0, 10),
      periodEnd: String(row?.end || '').slice(0, 10),
      periodDays: days,
      accn: String(row?.accn || '').slice(0, 24),
      url: secFilingUrl(cik, row?.accn)
    });
  }

  const ranked = [...byCik.values()].sort((a, b) => b.netIncomeUsd - a.netIncomeUsd);
  const profitable = ranked.filter((r) => r.netIncomeUsd > 0);
  if (!profitable.length) return null;

  return {
    status: 'OK',
    source: 'sec-edgar:xbrl-frames/NetIncomeLoss',
    metric: 'reported_net_income',
    period: String(frames?.ccp || '').slice(0, 12),
    taxonomy: String(frames?.taxonomy || 'us-gaap').slice(0, 16),
    tag: String(frames?.tag || 'NetIncomeLoss').slice(0, 32),
    label: String(frames?.label || 'Net Income (Loss) Attributable to Parent').slice(0, 96),
    uom: String(frames?.uom || 'USD').slice(0, 8),
    facts: data.length,
    companies: profitable.length,
    skippedDuration,
    quarterOnly: quarterOnly === true,
    top: profitable[0],
    leaders: profitable.slice(0, limit),
    weakest: ranked[ranked.length - 1] && ranked[ranked.length - 1].netIncomeUsd < 0
      ? ranked[ranked.length - 1]
      : null
  };
}

/** The newest quarterly frame that actually carries a ranking. */
export async function fetchProfitLeaders({ periods = latestReportedQuarters(), quarterOnly = true } = {}) {
  const tried = [];
  let lastError = null;
  for (const period of periods) {
    try {
      const frames = await fetchJson(
        `${SEC_BASE}/api/xbrl/frames/us-gaap/NetIncomeLoss/USD/${encodeURIComponent(period)}.json`,
        { headers: { 'user-agent': SEC_UA }, timeout: Math.max(TIMEOUT_MS, 20_000) }
      );
      const ranked = rankProfitLeaders(frames, { quarterOnly });
      if (ranked) return { ...ranked, tried };
      tried.push({ period, facts: Array.isArray(frames?.data) ? frames.data.length : 0 });
    } catch (err) {
      lastError = err;
      tried.push({ period, code: err?.code || 'FAILED' });
      /* A 404/403 on one period is worth walking past; a rate limit is not. */
      if (err?.code === 'RATE_LIMITED') break;
    }
  }
  const err = new Error('NO_USABLE_PROFIT_FRAME');
  err.code = lastError?.code === 'RATE_LIMITED' ? 'RATE_LIMITED' : 'NO_REPORTED_PROFIT_FRAME';
  err.detail = JSON.stringify(tried).slice(0, 160);
  throw err;
}

/* ══════════════════════════════════════════════════════════════════════════
   THE ASSEMBLED ANSWER
   ══════════════════════════════════════════════════════════════════════════ */

const unavailable = (code, detail = null) => ({
  status: 'UNAVAILABLE',
  reason: String(code || 'SOURCE_UNAVAILABLE').slice(0, 48),
  detail: detail ? String(detail).slice(0, 160) : null
});

async function readSection(name, reader) {
  try {
    const value = await reader();
    return { name, value };
  } catch (err) {
    return { name, value: unavailable(err?.code || 'SOURCE_UNAVAILABLE', err?.detail || err?.message) };
  }
}

/**
 * One payload for every flow/profit card in the app.
 *
 * Sections fail INDEPENDENTLY: a CoinGecko 429 must not blank the SEC card,
 * and an EDGAR outage must not blank the stablecoin flows. `ok` is true when
 * at least one section answered — the panel renders what arrived and names
 * what did not.
 */
export async function buildCapitalFlows() {
  const [tokens, chains, profit] = await Promise.all([
    readSection('tokenFlows', () => withCache('capital-flows:tokens:v1', FLOW_TTL.flowsMs, fetchTokenCapitalFlows, { swr: true })),
    readSection('chainFlows', () => withCache('capital-flows:stable:v1', FLOW_TTL.flowsMs, fetchStablecoinFlows, { swr: true })),
    readSection('profitLeaders', () => withCache('capital-flows:profit:v1', FLOW_TTL.profitMs, fetchProfitLeaders, { swr: true }))
  ]);

  const sections = {
    tokenFlows: tokens.value?.value ?? tokens.value,
    chainFlows: chains.value?.value ?? chains.value,
    profitLeaders: profit.value?.value ?? profit.value
  };
  const stale = [tokens, chains, profit].some((s) => s.value?.stale === true);
  const live = Object.values(sections).filter((s) => s?.status === 'OK').length;

  return {
    ok: live > 0,
    schema: FLOW_SCHEMA,
    at: Date.now(),
    liveSections: live,
    stale: stale === true,
    cached: [tokens, chains, profit].some((s) => s.value?.cached === true),
    readOnly: true,
    executes: false,
    ...sections
  };
}

/** Route-facing wrapper: never throws, always answers with a schema. */
export async function getCapitalFlows() {
  try {
    const { value } = await withCache('capital-flows:payload:v1', 60_000, buildCapitalFlows, { swr: true });
    return value;
  } catch (err) {
    return {
      ok: false,
      schema: FLOW_SCHEMA,
      at: Date.now(),
      error: String(err?.code || err?.message || 'CAPITAL_FLOWS_UNAVAILABLE').slice(0, 64),
      readOnly: true,
      executes: false
    };
  }
}

/** Test-only: drop every cached flow section so a probe can drive a fresh
 *  upstream failure instead of reading the previous test's success. */
export function _resetCapitalFlowsForTests() {
  for (const key of [...memoryStore.keys()]) {
    if (String(key).startsWith('capital-flows:')) memoryStore.delete(key);
  }
}

export function capitalFlowsConfigured() {
  return {
    coingecko: true,
    defillama: true,
    secEdgar: true,
    coinPageSize: CG_PER_PAGE,
    minChainUsd: MIN_CHAIN_USD,
    ttl: FLOW_TTL
  };
}

export default getCapitalFlows;
