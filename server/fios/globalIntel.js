/**
 * FBT FINANCIAL INTELLIGENCE OS — Global Intelligence Engine (Phase 211).
 * ---------------------------------------------------------------------------
 * Phase 210 gave the OS a financial brain over the OWNER's world: wallet,
 * portfolio, goals, risk, market. Phase 211 widens the lens to the GLOBAL
 * world the owner's money actually lives in — the nine intelligence domains:
 *
 *   smart_money  whale-flow-labelled accumulation/distribution (smartMoney)
 *   whales       large on-chain transfer events (whales scanner)
 *   onchain      chain-intel source health + real activity ring
 *   news         the merged news feed (state store first, feed fallback)
 *   macro        real headlines CLASSIFIED by macro topic (incl. POLITICS and
 *                CURRENCIES — the impact of politics on the economy) PLUS the
 *                real macro quotes (dollar, gold, crude, S&P, 10y yield,
 *                2s10s curve) — never invented, either input alone keeps it
 *                alive
 *   stocks       synthetic equity exposure (Avantis, read THROUGH the brain)
 *   forex        FX instruments (Ostium, read THROUGH the brain)
 *   commodities  metals/energy (Ostium, read THROUGH the brain)
 *   rwa          tokenised real-world assets (Ostium, read THROUGH the brain)
 *
 * ─── WHERE THE DATA COMES FROM, AND WHY THERE IS NO SECOND GATEWAY ────────
 * The four global-market domains are NOT dialed directly. The engine asks the
 * CENTRAL BRAIN (`brain.directToolCall(module, 'read')`) — the same one
 * execution goes through — because the brain already owns the guarded
 * Avantis/Ostium sources with their health ledger and stale-with-flag
 * discipline. The FI holds no second HTTP client for those feeds.
 * smart-money/whales/chain-intel/news are not brain modules; for those the
 * engine uses the SAME lazy-import provider seam the research engine (§11)
 * established, with the same rules: a provider that cannot even be imported
 * is UNAVAILABLE, not a crash; a provider that returns nothing is UNAVAILABLE
 * with its reason; nothing is ever filled in from imagination.
 *
 * ─── HONESTY CONTRACT (inherited from §11/§49) ────────────────────────────
 * Every domain result carries { status, reason, source, at, confidence, data }.
 * `macro` is a CLASSIFIER over real news items — each macro item keeps the
 * original headline, url and timestamp and the classification names its
 * evidence (the matched keyword), so "Fed signals patience" is a real headline
 * tagged FED, never a generated sentence. Everything external stays data, not
 * authority: no domain result may become an instruction.
 *
 * This module reads; it never writes to a venue, never signs, never holds a
 * key (§50 — the invariant Phase 210 asserted, kept here).
 */
import { randomUUID } from 'node:crypto';
import { round } from '../../src/lib/central/schema.js';

export const GLOBAL_INTEL_SCHEMA = 'fbt.fi.global-intelligence.v1';

/** The nine Phase 211 intelligence domains. */
export const GLOBAL_DOMAINS = Object.freeze([
  'smart_money', 'whales', 'onchain', 'news', 'macro', 'stocks', 'forex', 'commodities', 'rwa'
]);

/** Domains served by the central brain's own guarded sources. */
export const BRAIN_READ_DOMAINS = Object.freeze({
  stocks: 'stocks',
  forex: 'forex',
  commodities: 'commodities',
  rwa: 'rwa'
});

/** Macro topics: keyword → topic. A topic is a LABEL on a real headline,
 *  never a generated event. The first topic that matches wins (order matters,
 *  counts must stay honest), so the broad politics/currency topics sit LAST —
 *  a headline that is Fed news stays Fed news.
 *  Phase 211.1 widened the lens: POLITICS and CURRENCIES are first-class
 *  topics, because the impact of politics ON the economy is exactly what the
 *  owner asked this domain to show (sanctions, tariffs, elections, fiscal
 *  packages, the dollar) — and the GROWTH/FED/INFLATION/GEOPOLITICS patterns
 *  gained the words real desks actually use (pmi, slowdown, easing, hawkish,
 *  energy prices, ceasefire…). */
export const MACRO_TOPICS = Object.freeze({
  FED: /\b(fed|fomc|powell|federal reserve|interest rate|rate hike|rate cut|rate decision|central bank|monetary policy|federal funds|easing|tightening|hawkish|dovish)\b/i,
  RATES: /\b(yields?|treasury|treasuries|bond market|basis points|bps)\b/i,
  INFLATION: /\b(cpi|inflation|deflation|ppi|core inflation|energy prices|oil prices|gas prices|deflator)\b/i,
  GROWTH: /\b(gdp|recession|growth|soft landing|hard landing|unemployment|payrolls|nfp|jobless|pmi|imf|oecd|world bank|slowdown|stagflation|labor market|expansion)\b/i,
  ECB: /\b(ecb|lagarde|euro area|bank of england|boe|bank of japan|boj)\b/i,
  GEOPOLITICS: /\b(geopolit|sanction|tariff|war|conflict|election|trade tension|opec|ceasefire|blockade|export ban|nato|missile|escalat\w*)\b/i,
  CRYPTO_POLICY: /\b(crypto regulation|etf|sec|cftc|stablecoin law|mica)\b/i,
  POLITICS: /\b(election|elections|parliament|congress|senate|president|minister|ministry|chancellor|sanctions?|tariffs?|trade deal|trade war|diplomat\w*|legislation|government|governments|fiscal|stimulus|bailout|debt ceiling|impeach\w*|coup|protests?|unrest|shutdown|coalition)\b/i,
  CURRENCIES: /\b(dollar|dollars|euro|yen|pound|sterling|dxy|forex|foreign exchange|currencies|currency|devaluation)\b/i
});

const TIMEOUT_MS = 8000;
/** In-memory snapshot TTL: the briefing and the panel may poll, the upstream
 *  feeds must not be hammered. Providers keep their own caches too — this is
 *  the FI-side budget. */
const SNAPSHOT_TTL_MS = 60_000;
/** How many days a news item may be old before it stops being briefing fuel. */
const NEWS_FRESH_MS = 48 * 3600_000;

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const str = (v, max = 160) => (v === null || v === undefined ? null : String(v).slice(0, max));

function withTimeout(promise, ms = TIMEOUT_MS, label = 'provider') {
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label}_TIMEOUT`)), ms).unref?.())
  ]);
}

/** Lazy provider loading — same discipline as the research engine: a module
 *  that cannot be imported is UNAVAILABLE, never a crash. */
async function load(name) {
  try {
    switch (name) {
      case 'smartMoney': return await import('../smartMoney/index.js');
      case 'whales': return await import('../whales.js');
      case 'chainIntel': return await import('../chainIntel.js');
      case 'news': return await import('../news.js');
      case 'macroData': return await import('../macroData.js');
      default: return null;
    }
  } catch (err) {
    return { __importError: String(err?.message || err).slice(0, 120) };
  }
}

/* ═════════════════════════════════════════════════════════════════════════ */
/* Normalizers — pure, exported so the probe can drive them directly.        */
/* Each returns the canonical domain envelope; each is total (never throws). */
/* ═════════════════════════════════════════════════════════════════════════ */

const okDomain = (data, source, confidence, extra = {}) => ({
  status: 'OK', reason: null, source, at: extra.at ?? Date.now(), confidence, data, ...(extra.partial ? { partial: true } : {})
});
const unavailableDomain = (reason, source, extra = {}) => ({
  status: 'UNAVAILABLE', reason: String(reason || 'UNAVAILABLE').slice(0, 160), source, at: Date.now(), confidence: 0, data: null, ...extra
});

/** smart_money: the labelled flow overview. A stream that never came up is
 *  UNAVAILABLE; a partial stream is PARTIAL with its coverage note. */
export function normalizeSmartMoney(overview, at = Date.now()) {
  if (!overview || typeof overview !== 'object') return unavailableDomain('NO_SMART_MONEY_DATA', 'smartMoney:overview');
  const metrics = overview.metrics || {};
  const live = overview.dataStatus === 'live';
  if (!live && !overview.partial && metrics.whaleActivity?.value == null) {
    return unavailableDomain('SMART_MONEY_STREAM_DOWN', 'smartMoney:overview');
  }
  const tokenRows = Array.isArray(overview.tokenActivity) ? overview.tokenActivity : [];
  return okDomain({
    window: str(overview.window, 8) || '24h',
    dataStatus: str(overview.dataStatus, 16) || 'stale',
    whaleActivity: { count: num(metrics.whaleActivity?.value), changePct: num(metrics.whaleActivity?.changePct) },
    accumulationUsd: num(metrics.accumulation?.valueUsd),
    distributionUsd: num(metrics.distribution?.valueUsd),
    exchangeInflowUsd: num(metrics.exchangeInflow),
    exchangeOutflowUsd: num(metrics.exchangeOutflow),
    netFlowUsd: num(metrics.netFlow),
    topTokens: tokenRows.slice(0, 6).map((t) => ({
      symbol: str(t.symbol, 24), chain: str(t.chainShort, 16),
      flow: str(t.flow || t.direction, 16), valueUsd: num(t.valueUsd ?? t.value)
    })).filter((t) => t.symbol),
    coverage: overview.coverage && typeof overview.coverage === 'object' ? {
      events: num(overview.coverage.events), windowCoverage: num(overview.coverage.windowCoverage), comparable: overview.coverage.comparable === true
    } : null
  }, 'smartMoney:overview', live ? 0.85 : 0.55, { at, partial: overview.partial === true || !live });
}

/** whales: raw transfer events → bounded, priced events only. */
export function normalizeWhales(out, at = Date.now()) {
  if (!out || typeof out !== 'object') return unavailableDomain('NO_WHALE_DATA', 'whales:scanner');
  const events = Array.isArray(out.events) ? out.events : [];
  if (!events.length) {
    /* Keep the failure anatomy on the envelope: an empty window with failed
       chains (or a dead price service) is an outage to investigate, while an
       empty window with none is genuinely quiet water. */
    return unavailableDomain(out.reason || (out.pricesOutage ? 'WHALE_PRICE_OUTAGE' : 'NO_WHALE_EVENTS'), 'whales:scanner', {
      failedChains: Array.isArray(out.failedChains) ? out.failedChains.slice(0, 8) : [],
      pricesOutage: out.pricesOutage === true
    });
  }
  const stale = out.stale === true;
  return okDomain({
    count: events.length,
    stale,
    failedChains: Array.isArray(out.failedChains) ? out.failedChains.slice(0, 8) : [],
    events: events.slice(0, 12).map((e) => ({
      symbol: str(e.token?.symbol || e.symbol, 24),
      chain: str(e.chainShort || e.chain, 16),
      valueUsd: num(e.valueUsd),
      flow: str(e.flow, 24) || 'transfer',
      from: str(e.from, 20), to: str(e.to, 20),
      at: num(e.timestamp) || num(e.at)
    })).filter((e) => e.symbol && e.valueUsd !== null),
    note: 'large on-chain transfers observed while the scanner ran — not full chain history'
  }, 'whales:scanner', stale ? 0.6 : out.pricesOutage ? 0.5 : 0.75, { at, partial: stale || (Array.isArray(out.failedChains) && out.failedChains.length > 0) });
}

/** onchain: chain-intel health ledger + the real activity ring. */
export function normalizeOnchain(intel, activity, at = Date.now()) {
  const healthRows = intel && typeof intel === 'object' && !Array.isArray(intel)
    ? Object.entries(intel).map(([source, v]) => ({ source, status: str(v?.status, 16), failures: num(v?.consecutiveFailures), lastOkAt: num(v?.lastOkAt) }))
    : [];
  const events = activity && typeof activity === 'object' && Array.isArray(activity.events)
    ? activity.events.slice(0, 12).map((e) => ({ at: e.at, type: str(e.type, 40), detail: str(e.detail, 200), source: str(e.source, 40) }))
    : [];
  if (!healthRows.length && !events.length) return unavailableDomain('NO_CHAIN_INTEL_SAMPLES', 'chainIntel');
  return okDomain({
    sources: healthRows.slice(0, 20),
    healthySources: healthRows.filter((r) => r.status === 'HEALTHY').length,
    degradedSources: healthRows.filter((r) => r.status === 'DEGRADED').length,
    downSources: healthRows.filter((r) => r.status === 'DOWN').length,
    activity: events,
    scope: 'process'
  }, 'chainIntel', healthRows.length ? 0.8 : 0.5, { at });
}

/** news: bounded list, newest first. Items keep their own language/source. */
export function normalizeNews(news, at = Date.now()) {
  const items = news && typeof news === 'object' && Array.isArray(news.items) ? news.items : (Array.isArray(news) ? news : []);
  if (!items.length) return unavailableDomain('NO_NEWS_ITEMS', 'news-engine');
  return okDomain({
    count: items.length,
    items: items.slice(0, 20).map((n) => ({
      title: str(n.title, 220), url: str(n.url, 300), source: str(n.source || n.sourceId, 40),
      lang: str(n.lang, 8) || 'en', at: num(n.at) || num(n.publishedAt) || at, symbols: Array.isArray(n.symbols) ? n.symbols.slice(0, 6) : []
    })).filter((n) => n.title)
  }, 'news-engine', 0.7, { at });
}

/** macro: REAL headlines classified by topic PLUS the real macro quotes
 *  (dollar index, gold, crude, equity index, 10y yield, 2s10s spread —
 *  Phase 211.1). The classification names its evidence (the matched keyword)
 *  and the item keeps its original url/time; the quotes keep their own source
 *  and observation time — so this is a label on data plus a read of data,
 *  never generated text (§49).
 *
 *  Either input alone keeps the domain alive: a quiet news day is covered by
 *  the quotes, a quote outage by the headlines — the global→macro connection
 *  no longer depends on a single upstream. */
export function normalizeMacro(newsDomain, macroQuotes = null, at = Date.now()) {
  const newsRead = Boolean(newsDomain && newsDomain.status === 'OK' && Array.isArray(newsDomain.data?.items));
  const fresh = newsRead ? newsDomain.data.items.filter((n) => !n.at || at - n.at < NEWS_FRESH_MS) : [];
  const classified = [];
  for (const item of fresh) {
    const text = `${item.title || ''}`;
    for (const [topic, re] of Object.entries(MACRO_TOPICS)) {
      const m = re.exec(text);
      if (m) {
        classified.push({ topic, title: item.title, url: item.url, source: item.source, at: item.at, matched: str(m[0], 40), lang: item.lang });
        break; /* one topic per headline keeps the counts honest */
      }
    }
  }
  /* The quotes become the domain's instruments — the same shape the brain
     classes expose, so the cross-asset engine can read them without a
     special case. `change24hPct` is the real 1-day change of the quote. */
  const rawQuotes = Array.isArray(macroQuotes?.items) ? macroQuotes.items : [];
  const quotes = rawQuotes
    .map((q) => ({
      symbol: str(q.symbol, 12),
      name: str(q.name, 60),
      kind: str(q.kind, 16),
      priceUsd: num(q.priceUsd),
      change24hPct: num(q.change1dPct),
      change1dPct: num(q.change1dPct),
      change7dPct: num(q.change7dPct),
      source: str(q.source, 40)
    }))
    .filter((q) => q.symbol && q.priceUsd !== null);
  if (!classified.length && !quotes.length) {
    return unavailableDomain(
      newsRead ? 'NO_MACRO_HEADLINES_IN_WINDOW_AND_NO_QUOTES' : 'MACRO_NEEDS_NEWS_AND_QUOTES',
      'macro:classifier'
    );
  }
  const byTopic = {};
  for (const c of classified) byTopic[c.topic] = (byTopic[c.topic] || 0) + 1;
  const curve = quotes.find((q) => q.kind === 'curve') || null;
  return okDomain({
    items: classified.slice(0, 14),
    byTopic,
    attention: classified.length,
    quotes,
    instruments: quotes,
    /* The 2s10s spread — the classic cycle gauge: its LEVEL (priceUsd) is
       the spread in percentage points, null when the curve instrument was
       not among what a source returned. */
    curve: curve ? { symbol: curve.symbol, spreadPct: curve.priceUsd, change7dPct: curve.change7dPct, source: curve.source } : null,
    sources: { news: newsRead ? 'news-engine' : null, quotes: str(macroQuotes?.source, 40) || null },
    untrusted: true
  }, 'macro:classifier', classified.length && quotes.length ? 0.7 : 0.6, { at, partial: !classified.length || !quotes.length });
}

/** stocks: the brain's Avantis read (or a provider-shaped fixture). */
export function normalizeStocks(out, at = Date.now()) {
  if (!out || typeof out !== 'object') return unavailableDomain('NO_EQUITIES_READ', 'brain:stocks');
  const instruments = Array.isArray(out.instruments) ? out.instruments : (Array.isArray(out.rows) ? out.rows : []);
  if (!instruments.length) return unavailableDomain(out.reason || 'NO_EQUITY_INSTRUMENTS', 'brain:stocks');
  return okDomain({
    venue: str(out.venue, 24) || 'avantis',
    readOnly: out.readOnly !== false,
    stale: out.stale === true,
    marketOpen: instruments.some((r) => r.marketOpen === true),
    instruments: instruments.slice(0, 15).map((r) => ({
      symbol: str(r.symbol, 12), name: str(r.name, 80),
      priceUsd: num(r.priceUsd ?? r.price), change24hPct: num(r.change24hPct ?? r.change24h),
      marketOpen: r.marketOpen === true ? true : (r.marketOpen === false ? false : null)
    })).filter((r) => r.symbol)
  }, str(out.source, 40) || 'brain:stocks', out.stale ? 0.5 : 0.75, { at, partial: out.stale === true });
}

/** forex / commodities / rwa: the brain's Ostium read, bucketed. The 24h
 *  change is KEPT — cross-asset breadth needs it, and dropping it here would
 *  silently shrink the analysis to crypto + stocks. */
export function normalizeRwaClass(out, category, at = Date.now()) {
  if (!out || typeof out !== 'object') return unavailableDomain(`NO_${String(category).toUpperCase()}_READ`, `brain:${category}`);
  const rows = Array.isArray(out.rows) ? out.rows : (Array.isArray(out.instruments) ? out.instruments : []);
  const filtered = rows
    .map((r) => ({
      symbol: str(r.symbol, 20),
      priceUsd: num(r.priceUsd ?? r.price),
      change24hPct: num(r.change24hPct ?? r.change24h),
      category: str(r.category, 20) || category
    }))
    .filter((r) => r.symbol && r.priceUsd !== null)
    .filter((r) => category === 'rwa' ? true : r.category === category);
  if (!filtered.length) return unavailableDomain(out.reason || `NO_${String(category).toUpperCase()}_INSTRUMENTS`, `brain:${category}`);
  return okDomain({
    venue: str(out.venue, 24) || 'ostium',
    readOnly: out.readOnly !== false,
    stale: out.stale === true,
    instruments: filtered.slice(0, 15)
  }, str(out.source, 40) || `brain:${category}`, out.stale ? 0.5 : 0.7, { at, partial: out.stale === true });
}

/* ═════════════════════════════════════════════════════════════════════════ */
/* The engine                                                                 */
/* ═════════════════════════════════════════════════════════════════════════ */

/**
 * @param {object} p
 * @param {object} p.collections   FI persistence (global_intelligence rows)
 * @param {object} [p.evidence]    evidence store (briefing links, additive)
 * @param {object} [p.observability]
 * @param {object} [p.brain]       the central brain (directToolCall) — the
 *                                 ONLY path to the global market feeds
 * @param {object} [p.providers]   test seam: { smartMoney, whales, chainIntel,
 *                                 news } as async functions
 */
export function createGlobalIntelEngine({
  collections = null, evidence = null, observability = null, brain = null,
  providers = {}, log = () => {}, now = () => Date.now()
} = {}) {
  const P = { load, ...providers };
  const cache = new Map(); // owner → { snapshot, at, inFlight }

  async function callLazy(name, fn, label, args = []) {
    if (typeof P[name] === 'function') {
      return { ok: true, value: await P[name](...args), source: label };
    }
    const mod = await P.load(name);
    if (mod?.__importError) return { ok: false, reason: `PROVIDER_IMPORT_FAILED:${mod.__importError}` };
    const impl = mod?.[fn];
    if (typeof impl !== 'function') return { ok: false, reason: 'PROVIDER_FUNCTION_MISSING' };
    return { ok: true, value: await impl(...args), source: label };
  }

  /** One provider call with the FI's timeout discipline: the result is the
   *  provider's VALUE; a failure is a thrown reason the caller turns into an
   *  honest UNAVAILABLE. Injected test providers take the same path. */
  async function callProvider(name, fn, label, args = []) {
    const out = await withTimeout(callLazy(name, fn, label, args), TIMEOUT_MS, label);
    if (!out.ok) throw new Error(out.reason);
    return out.value;
  }

  /** The brain read for a global-market domain. `sections` may pre-seed it
   *  (a provider-shaped fixture or a future brain write-back); the brain is
   *  asked otherwise. No direct provider dialing happens here.
   *  Phase 211.2 fix: the OWNER travels with the call. Before this, the read
   *  ran under the anon registry and its `markets` write-back landed in an
   *  anon state store nobody reads — the owner's own crypto domain stayed
   *  «unread» forever even though the brain had just read the market. */
  async function brainRead(domain, sections, owner = null) {
    const seeded = sections?.[domain]?.data ?? sections?.[domain] ?? null;
    if (seeded && typeof seeded === 'object' && (seeded.instruments || seeded.rows)) {
      return { ok: true, value: seeded, source: `state:${domain}` };
    }
    if (!brain || typeof brain.directToolCall !== 'function') {
      return { ok: false, reason: 'BRAIN_NOT_WIRED' };
    }
    try {
      const out = await withTimeout(brain.directToolCall({ owner, module: BRAIN_READ_DOMAINS[domain], operation: 'read', input: {} }), TIMEOUT_MS, 'brain-read');
      if (!out?.ok || out?.status === 'UNAVAILABLE' || out?.data == null) {
        return { ok: false, reason: out?.reason || out?.status || 'BRAIN_READ_REFUSED' };
      }
      return { ok: true, value: out.data, source: `brain:${BRAIN_READ_DOMAINS[domain]}` };
    } catch (err) {
      return { ok: false, reason: String(err?.message || err).slice(0, 120) };
    }
  }

  /** The macro quotes for this pass. A quote outage is NOT an error for the
   *  snapshot — it is one missing input to the macro domain (the headlines
   *  still classify), so the failure is swallowed here and named by the
   *  domain itself. */
  async function readMacroQuotes() {
    try {
      return await callProvider('macroData', 'fetchMacroQuotes', 'macroData');
    } catch (err) {
      log(`global-intel:macro-quotes:${String(err?.message || err).slice(0, 80)}`);
      return null;
    }
  }

  async function readDomain(domain, sections, at, owner = null) {
    switch (domain) {
      case 'smart_money': {
        try {
          return normalizeSmartMoney(await callProvider('smartMoney', 'getOverview', 'smartMoney:overview'), at);
        } catch (err) {
          const reason = String(err?.message || err).slice(0, 120);
          return unavailableDomain(reason.startsWith('PROVIDER') || reason.includes('TIMEOUT') ? reason : `SMART_MONEY_UNAVAILABLE:${reason}`, 'smartMoney:overview');
        }
      }
      case 'whales': {
        try {
          /* cachedWhales reads opts.vs — an explicit (empty-but-present) opts
             object, not a bare call. The $100k floor matches the /api/news/whales
             default: the scanner only sees a few minutes of chain time, and at
             $250k the window is empty far too often to be a useful domain. */
          const raw = await callProvider('whales', 'cachedWhales', 'whales:scanner', [{ minUsd: 100_000, limit: 40 }]);
          /* cachedWhales returns the CACHE envelope { value, cached, stale } —
             the events live in `value` (see server/app.js, which unwraps it).
             Passing the envelope straight to the normalizer reads zero events
             and every snapshot reports NO_WHALE_EVENTS on a healthy scanner. */
          const out = Array.isArray(raw?.value?.events) ? { ...raw.value, stale: raw.value.stale === true || raw.stale === true } : raw;
          return normalizeWhales(out, at);
        } catch (err) {
          const reason = String(err?.message || err).slice(0, 120);
          return unavailableDomain(reason.includes('TIMEOUT') || reason.startsWith('PROVIDER') ? reason : `WHALES_UNAVAILABLE:${reason}`, 'whales:scanner');
        }
      }
      case 'onchain': {
        try {
          const mod = await P.load('chainIntel');
          if (mod?.__importError) return unavailableDomain(`PROVIDER_IMPORT_FAILED:${mod.__importError}`, 'chainIntel');
          const health = typeof P.chainIntel === 'function' ? await P.chainIntel() : (typeof mod?.healthSnapshot === 'function' ? mod.healthSnapshot() : null);
          const activity = typeof mod?.intelActivity === 'function' ? mod.intelActivity({ limit: 20 }) : null;
          return normalizeOnchain(health, activity, at);
        } catch (err) {
          return unavailableDomain(`CHAIN_INTEL_UNAVAILABLE:${String(err?.message || err).slice(0, 100)}`, 'chainIntel');
        }
      }
      case 'news': {
        /* Prefer the section the brain already read for this owner; the feed
           is the fallback, so a polling briefing does not re-fetch RSS. */
        const sectionData = sections?.news?.data ?? sections?.news ?? null;
        const fromSection = sectionData && typeof sectionData === 'object' && Array.isArray(sectionData.items) && sectionData.items.length
          ? normalizeNews(sectionData, at)
          : null;
        if (fromSection?.status === 'OK') return fromSection;
        try {
          return normalizeNews(await callProvider('news', 'fetchNews', 'news-engine'), at);
        } catch (err) {
          return fromSection || unavailableDomain(`NEWS_UNAVAILABLE:${String(err?.message || err).slice(0, 100)}`, 'news-engine');
        }
      }
      case 'macro':
        /* macro is classified from the news domain INSIDE the same snapshot
           pass — it is passed in by snapshotFor, never read alone. */
        return unavailableDomain('MACRO_IS_DERIVED', 'macro:classifier');
      case 'stocks': {
        const out = await brainRead('stocks', sections, owner);
        return out.ok ? normalizeStocks(out.value, at) : unavailableDomain(out.reason, 'brain:stocks');
      }
      case 'forex':
      case 'commodities':
      case 'rwa': {
        const out = await brainRead(domain, sections, owner);
        return out.ok ? normalizeRwaClass(out.value, domain, at) : unavailableDomain(out.reason, `brain:${domain}`);
      }
      default:
        return unavailableDomain('UNKNOWN_DOMAIN', 'global-intel');
    }
  }

  /**
   * The full snapshot for one owner. Domains run concurrently, each failure is
   * its own honest UNAVAILABLE, and `macro` is derived from the news result of
   * THIS pass (so a news outage is a macro outage, not a stale classification).
   */
  async function snapshotFor(owner, { sections = null, refresh = false } = {}) {
    const at = now();
    const hit = cache.get(owner);
    if (!refresh && hit && at - hit.at < SNAPSHOT_TTL_MS) {
      return { ...hit.snapshot, cached: true };
    }
    if (hit?.inFlight) return hit.inFlight;

    const run = (async () => {
      const started = now();
      const readDomains = GLOBAL_DOMAINS.filter((d) => d !== 'macro');
      const [results, macroQuotes] = await Promise.all([
        Promise.all(readDomains
          .map((d) => readDomain(d, sections, at, owner).catch((err) => unavailableDomain(`DOMAIN_ERROR:${String(err?.message || err).slice(0, 100)}`, 'global-intel')))),
        readMacroQuotes()
      ]);
      const domains = {};
      const missing = [];
      readDomains.forEach((domain, i) => {
        domains[domain] = results[i] || unavailableDomain('DOMAIN_NOT_RUN', 'global-intel');
        if (domains[domain].status !== 'OK') missing.push(domain);
      });
      /* macro is classified from THIS pass's news result AND the real macro
         quotes of the same pass — a news outage no longer takes the macro
         domain down (the quotes still read), and a quote outage leaves the
         headlines. Never a stale classification. */
      domains.macro = normalizeMacro(domains.news, macroQuotes, at);
      if (domains.macro.status !== 'OK') missing.push('macro');

      const available = GLOBAL_DOMAINS.filter((d) => domains[d]?.status === 'OK').length;
      const snapshot = {
        schema: GLOBAL_INTEL_SCHEMA,
        owner,
        at,
        status: available === 0 ? 'UNAVAILABLE' : available < 4 ? 'PARTIAL' : 'OK',
        domains,
        coverage: round(available / GLOBAL_DOMAINS.length, 2),
        available,
        missing,
        providers: providersHealth({ domains }),
        durable: collections ? collections.durable() : null
      };
      snapshot.id = `gi_${randomUUID().replace(/-/g, '').slice(0, 18)}`;
      /* §50 restated for the global layer: a snapshot is DATA. */
      snapshot.executionAuthorized = false;

      /* Persist the latest snapshot (id 'latest') + capped history — additive
         rows in the Phase 211 collection, never over another engine's data.
         `id: 'latest'` goes AFTER the spread — the snapshot's own id must not
         clobber the pinned lookup key. */
      if (collections) {
        try {
          await collections.put('global_intelligence', owner, { ...snapshot, id: 'latest', snapshotId: snapshot.id }, { idKey: 'id' });
        } catch (err) {
          log(`global-intel:persist-failed:${String(err?.message || err).slice(0, 100)}`);
        }
      }
      if (observability) observability.emit({ type: 'global-intel.snapshot', owner, payload: { id: snapshot.id, available, missing: missing.slice(0, 9) } });
      log(`global-intel:${owner}: ${available}/9 domains in ${now() - started}ms`);
      return snapshot;
    })();

    cache.set(owner, { at, inFlight: run });
    const snapshot = await run;
    cache.set(owner, { at: now(), snapshot });
    return snapshot;
  }

  /** One domain, on demand (macro is derived from a fresh news read). */
  async function domainFor(owner, domain, { sections = null, refresh = false } = {}) {
    if (!GLOBAL_DOMAINS.includes(domain)) {
      return { ok: false, code: 'UNKNOWN_DOMAIN', allowed: GLOBAL_DOMAINS };
    }
    if (domain === 'macro') {
      const [news, quotes] = await Promise.all([
        readDomain('news', sections, now()),
        readMacroQuotes()
      ]);
      return { ok: true, domain: 'macro', result: normalizeMacro(news, quotes, now()) };
    }
    const snapshot = await snapshotFor(owner, { sections, refresh });
    return { ok: true, domain, result: snapshot.domains[domain] };
  }

  /** The last persisted snapshot (durable when the store is) — what the panel
   *  shows before the first refresh of a cold process. */
  async function lastSnapshot(owner) {
    if (!collections) return null;
    try {
      const out = await collections.get('global_intelligence', owner, 'latest');
      return out.ok ? out.row : null;
    } catch { return null; }
  }

  return { snapshotFor, domainFor, lastSnapshot, providersHealth, readDomain, normalize: { smartMoney: normalizeSmartMoney, whales: normalizeWhales, onchain: normalizeOnchain, news: normalizeNews, macro: normalizeMacro, stocks: normalizeStocks, rwaClass: normalizeRwaClass } };
}

/** The five readiness lights Phase 211 reports per provider, in the same
 *  spirit as Phase 210's subsystem lights: implemented · configured ·
 *  provider_available · runtime_ready · live. `live` needs a REAL result in
 *  this process — never a promise. */
export function providersHealth({ domains = null } = {}) {
  const rows = {};
  for (const domain of GLOBAL_DOMAINS) {
    const row = domains?.[domain] || null;
    rows[domain] = {
      implemented: true,
      configured: true,
      provider_available: row ? row.status !== 'UNAVAILABLE' : null,
      runtime_ready: Boolean(row),
      live: row?.status === 'OK' || row?.status === 'PARTIAL' || false,
      source: row?.source || (domain === 'macro' ? 'macro:classifier' : null),
      status: row?.status || 'NOT_RUN',
      reason: row?.reason || null
    };
  }
  return rows;
}

export default createGlobalIntelEngine;
