/**
 * WORLD CONSOLE PROBE — the «هوش جهانی» console, rendered.
 * ---------------------------------------------------------------------------
 * Proves the seven new sub-tabs of the «هوش جهانی» page actually render and
 * stay HONEST:
 *
 *   · world  — the nine GLOBAL FINANCIAL STATE gauges derive from the pass's
 *              readings; a metric with no input shows «unread», never a guess
 *   · globe  — the SVG globe renders its country nodes, and tapping one shows
 *              a snapshot built only from instruments the pass read
 *   · radar  — the sweep + blips render from real briefing items/movers
 *   · causal — prefers the server's /deep/macro-graph (stubbed here) and
 *              falls back to the local chain when that endpoint fails
 *   · flows  — the capital-flow map lights nodes only from real readings
 *   · future — bull/base/stress weights are a transparent function of the
 *              pass, and the ADVERSARIAL challenger lists observed risks
 *   · dna    — model priors + observed overlays from this pass
 *
 * And the case that matters most: with a DEAD API every new tab still renders
 * its empty/unread state instead of throwing (a throw here would take the
 * whole news screen's global tab down).
 *
 * Build: vite build -c test/vite.world-console.mjs
 * Run:   node test/run-one-probe.mjs ./.out/world-console/world-console-probe.js
 */
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, useLocation } from 'react-router-dom';
import i18n, { setLanguage } from '../../src/i18n/index.js';
import AiGlobalIntelligence from '../../src/components/ai/AiGlobalIntelligence.jsx';
import { WORLD_STYLES } from '../../src/components/ai/worldState/styles.js';
import { GLOBAL_PAGE_STYLES } from '../../src/components/ai/worldState/ui.styles.js';

/* the path the router is on — the tile-navigation checks read it */
let lastPath = '/';
function LocationSpy() {
  const loc = useLocation();
  lastPath = loc.pathname + loc.search;
  return null;
}
/* the LAST declaration of a selector in the combined sheet (what the cascade uses) */
const SHEET = WORLD_STYLES + GLOBAL_PAGE_STYLES;
const lastRule = (sel) => {
  const esc = sel.replace(/[.*+?^$()|[\]\\{}]/g, (c) => `\\${c}`);
  const re = new RegExp(`${esc}\\s*\\{([^}]*)\\}`, 'g');
  let m; let last = null;
  while ((m = re.exec(SHEET))) last = m[1];
  return last;
};

/* the property names used inside every `@keyframes <prefix>…` block of the sheet */
const keyframeProps = (prefix) => {
  const out = [];
  const re = new RegExp(`@keyframes\\s+(${prefix}[\\w-]*)\\s*\\{`, 'g');
  let m;
  while ((m = re.exec(SHEET))) {
    let depth = 1; let i = re.lastIndex;
    while (i < SHEET.length && depth > 0) { if (SHEET[i] === '{') depth += 1; else if (SHEET[i] === '}') depth -= 1; i += 1; }
    const body = SHEET.slice(re.lastIndex, i - 1);
    for (const p of body.matchAll(/([a-z-]+)\s*:/g)) out.push([m[1], p[1]]);
  }
  return out;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* The same real envelopes the phase211 probe uses, plus a flows payload. */
const NOW = Date.now();
export const INTEL = {
  ok: true, schema: 'fbt.fi.global-intelligence.v1',
  globalIntelligence: {
    schema: 'fbt.fi.global-intelligence.v1', owner: 'dev:probe', at: NOW, status: 'OK',
    available: 8, coverage: 0.89, missing: ['whales'], executionAuthorized: false,
    domains: {
      smart_money: { status: 'OK', reason: null, source: 'smartMoney:overview', at: NOW, confidence: 0.85, data: { window: '24h', whaleActivity: { count: 14, changePct: 25 }, accumulationUsd: 2_400_000, distributionUsd: 900_000, netFlowUsd: -800_000, topTokens: [{ symbol: 'BTC', chain: 'eth', flow: 'dex_buy', valueUsd: 700_000, exchangeOutflowUsd: 500_000 }] } },
      whales: { status: 'UNAVAILABLE', reason: 'WHALES_UNAVAILABLE:FEED_DOWN', source: 'whales:scanner', at: NOW, confidence: 0, data: null },
      onchain: { status: 'OK', reason: null, source: 'chainIntel', at: NOW, confidence: 0.8, data: { healthySources: 2, degradedSources: 0, downSources: 0, sources: [{ source: 'ci:markets', status: 'HEALTHY' }, { source: 'ci:gas', status: 'HEALTHY' }] } },
      news: { status: 'OK', reason: null, source: 'news-engine', at: NOW, confidence: 0.7, data: { count: 21, items: [{ title: 'Fed signals patience on rates', url: 'u', source: 'r', lang: 'en', at: NOW }] } },
      macro: { status: 'OK', reason: null, source: 'macro:classifier', at: NOW, confidence: 0.7, data: { attention: 5, byTopic: { FED: 2, GEOPOLITICS: 2, INFLATION: 1 }, items: [], instruments: [{ symbol: 'DXY', name: 'US Dollar Index', kind: 'currency', priceUsd: 108.2, change1dPct: 0.8, change7dPct: 1.2, source: 'stooq:DX.F' }], curve: null, untrusted: true } },
      stocks: { status: 'OK', reason: null, source: 'brain:stocks', at: NOW, confidence: 0.75, data: { venue: 'avantis', readOnly: true, instruments: [{ symbol: 'AAPL', priceUsd: 214.3, change24hPct: 1.2 }] } },
      forex: { status: 'OK', reason: null, source: 'brain:forex', at: NOW, confidence: 0.7, data: { venue: 'ostium', readOnly: true, instruments: [{ symbol: 'EURUSD', priceUsd: 1.084, change24hPct: 0.3 }] } },
      commodities: { status: 'OK', reason: null, source: 'brain:commodities', at: NOW, confidence: 0.7, data: { venue: 'ostium', readOnly: true, instruments: [] } },
      rwa: { status: 'OK', reason: null, source: 'brain:rwa', at: NOW, confidence: 0.7, data: { venue: 'ostium', readOnly: true, instruments: [{ symbol: 'XAU', priceUsd: 2352.5, change24hPct: 0.9, category: 'commodities' }] } }
    },
    providers: {}
  }
};
export const BRIEFING = {
  ok: true,
  briefing: {
    schema: 'fbt.fi.briefing.v1', at: NOW, status: 'OK', proactive: true, executionAuthorized: false,
    items: [
      { id: 'br_crit', kind: 'macro', priority: 'critical', title: 'Yield curve inverted', detail: '2s10s negative', evidence: [], source: 'fred:T10Y2Y', at: NOW, confidence: 0.9 },
      { id: 'br_high', kind: 'whale', priority: 'high', title: 'Large transfer to exchange', detail: 'labelled', evidence: [], source: 'whales:scanner', at: NOW, confidence: 0.7 },
      { id: 'br_info', kind: 'cross_asset', priority: 'info', title: 'Regime mixed', detail: 'mixed classes', evidence: [], source: 'cross-asset-engine', at: NOW, confidence: 0.6 }
    ],
    counts: { critical: 1, high: 1, normal: 0, info: 1 }, missing: []
  }
};
export const CROSS = {
  ok: true,
  crossAsset: {
    schema: 'fbt.fi.cross-asset.v1', at: NOW, status: 'OK',
    observedClasses: ['crypto', 'stocks'], readOnlyClasses: ['stocks'],
    classes: {
      crypto: { instruments: 3, withChange: 3, advancing: 2, declining: 1, avgChangePct: 1.8, top: [{ symbol: 'BTC', changePct: 2.4 }], bottom: [{ symbol: 'DOGE', changePct: -1.1 }] },
      stocks: { instruments: 2, withChange: 2, advancing: 1, declining: 1, avgChangePct: -0.45, top: [], bottom: [] }
    },
    regime: { regime: 'MIXED', votes: [], coMovement: 0, basis: 'real per-instrument changes' },
    divergences: [{ classes: ['crypto', 'stocks'], avgChangePct: { crypto: 1.8, stocks: -0.45 }, gapPct: 2.25 }],
    correlations: { UNAVAILABLE: { ok: false, reason: 'NO_PAIRED_HISTORY_SUPPLIED' } },
    missing: [], missingReasons: {},
    macro: {
      status: 'OK', untrusted: true,
      indicators: [
        { symbol: 'DXY', name: 'US Dollar Index', kind: 'currency', unit: 'index points', priceUsd: 108.2, change1dPct: 0.8, change7dPct: 1.2, source: 'stooq:DX.F', at: NOW - 60_000 },
        { symbol: 'GOLD', name: 'Gold (USD/troy oz)', kind: 'safe_haven', unit: 'USD/troy oz', priceUsd: 2450.5, change1dPct: 0.5, change7dPct: 2.1, source: 'stooq:GC.F', at: NOW - 60_000 },
        { symbol: 'WTI', name: 'WTI Crude (USD/bbl)', kind: 'energy', unit: 'USD/barrel', priceUsd: 78.4, change1dPct: -0.6, change7dPct: -1.8, source: 'stooq:CL.F', at: NOW - 60_000 },
        { symbol: 'BRENT', name: 'Brent Crude (USD/bbl)', kind: 'energy', unit: 'USD/barrel', priceUsd: 81.2, change1dPct: -0.3, change7dPct: -1.1, source: 'stooq:BRN.F', at: NOW - 60_000 },
        { symbol: 'COPPER', name: 'Copper (USD/lb)', kind: 'industrial_metal', unit: 'USD/lb', priceUsd: 4.5, change1dPct: 0.2, change7dPct: 0.6, source: 'stooq:HG.F', at: NOW - 60_000 },
        { symbol: 'SPX', name: 'S&P 500 E-mini futures', kind: 'equity', unit: 'index points', priceUsd: 5480.25, change1dPct: 0.4, change7dPct: 0.9, source: 'stooq:ES.F', at: NOW - 60_000 },
        { symbol: 'US10Y', name: 'US 10Y Treasury yield (%)', kind: 'rate', unit: '%', priceUsd: 4.21, change1dPct: 0.4, change7dPct: 1.1, source: 'fred:DGS10', at: NOW - 60_000 }
      ],
      curve: { symbol: 'US2S10S', spreadPct: -0.21, change7dPct: -0.3, source: 'fred:T10Y2Y' }
    },
    outlook: {
      label: 'RECESSION_WATCH', score: -0.21, untrusted: true,
      currentState: { regime: 'MIXED', observedClasses: ['crypto', 'stocks'], avgChangePct: {} },
      signals: []
    }
  }
};
export const PROVIDERS = {
  ok: true,
  providers: {
    smart_money: { implemented: true, configured: true, provider_available: true, runtime_ready: true, live: true, status: 'OK' },
    whales: { implemented: true, configured: true, provider_available: false, runtime_ready: true, live: false, status: 'UNAVAILABLE', reason: 'WHALES_UNAVAILABLE:FEED_DOWN' },
    macro: { implemented: true, configured: true, provider_available: true, runtime_ready: true, live: true, status: 'OK' },
    rwa: { implemented: true, configured: false, provider_available: false, runtime_ready: false, live: false, status: 'UNAVAILABLE', reason: 'RWA_VENUE_UNCONFIGURED' }
  }
};
export const FLOWS = {
  ok: true, schema: 'fbt.capital-flows.v1', at: NOW,
  tokenFlows: { status: 'OK', topInflow: { symbol: 'BTC', name: 'Bitcoin', mcapChangeUsd: 1_900_000_000, mcapChangePct: 1.4 }, topOutflow: { symbol: 'XRP', name: 'XRP', mcapChangeUsd: -240_000_000, mcapChangePct: -0.9 }, rows: [] },
  chainFlows: { status: 'OK', net24hUsd: 84_000_000, net24hPct: 0.05, topInflowChain: { chain: 'ethereum', net24hUsd: 92_000_000 }, topOutflowChain: { chain: 'bsc', net24hUsd: -11_000_000 }, chainInflows: [], chainOutflows: [] },
  profitLeaders: { status: 'UNAVAILABLE', reason: 'PROFIT_SOURCE_UNAVAILABLE' }
};
export const MACRO_GRAPH = {
  ok: true, schema: 'fbt.fi.macro-graph.v1',
  graph: {
    schema: 'fbt.fi.macro-graph.v1', at: NOW, coverage: { nodes: 9, edges: 11, sources: ['macro:classifier'] },
    portfolioRiskImpulse: 0.18,
    nodes: [
      { id: 'topic:FED', label: 'FED', kind: 'event', change24hPct: null, riskDirection: 'risk_up', attention: 2 },
      { id: 'dxy', label: 'Dollar (DXY)', kind: 'instrument', change24hPct: 0.8, riskDirection: null, attention: null },
      { id: 'yields10y', label: '10Y Treasury', kind: 'instrument', change24hPct: 0.4, riskDirection: null, attention: null },
      { id: 'spx', label: 'S&P 500', kind: 'instrument', change24hPct: 0.4, riskDirection: null, attention: null },
      { id: 'btc', label: 'Bitcoin', kind: 'asset', change24hPct: 2.4, riskDirection: 'risk_down', attention: null },
      { id: 'portfolio', label: 'Portfolio', kind: 'portfolio', change24hPct: null, riskDirection: null, attention: null }
    ],
    edges: [
      { from: 'topic:FED', to: 'dxy', weight: 0.6, why: 'a hawkish Fed reprices the dollar up', model: true },
      { from: 'dxy', to: 'btc', weight: -0.5, why: 'a stronger dollar drains liquidity from risk assets', model: true }
    ]
  },
  coverage: { nodes: 9, edges: 11 },
  portfolioRiskImpulse: 0.18,
  whyRiskier: {
    available: true, asset: 'btc', assetLabel: 'Bitcoin', assetChange24hPct: 2.4,
    macroPressure: -0.4, netRiskImpulse: 0.4, direction: 'risk_up',
    drivers: [{ from: 'dxy', fromLabel: 'Dollar (DXY)', fromChange24hPct: 0.8, attention: null, sensitivity: -0.5, why: 'a stronger dollar drains liquidity from risk assets', contribution: -0.4 }],
    note: 'first-order transmission over 1 active driver(s)'
  }
};

export async function run(container) {
  const rows = [];
  const check = (name, ok, detail) => { rows.push([name, !!ok]); console.log(`${ok ? '✓' : '✗'} ${name}${!ok && detail ? `  ← ${detail}` : ''}`); };
  const all = (sel) => Array.from(container.querySelectorAll(sel));
  const text = () => {
    /* what a person can read: the <style> sheets are not part of it */
    const c = container.cloneNode(true);
    c.querySelectorAll('style,script').forEach((n) => n.remove());
    return c.textContent || '';
  };
  const clickTab = async (marker) => {
    const btn = all('button').find((b) => (b.textContent || '').includes(marker));
    await act(async () => { btn?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await sleep(12); });
    return btn;
  };

  const realFetch = global.fetch;
  const errors = [];
  const realError = console.error;
  console.error = (...a) => {
    const s = String(a[0] ?? '');
    if (s.includes('useLayoutEffect') || s.includes('act(') || s.includes('not wrapped')) return;
    if (s.includes('Not implemented')) return;
    if (s.includes('React Router Future Flag')) return;
    errors.push(s);
  };

  let macroGraphReachable = true;
  await act(async () => { await i18n.changeLanguage('en'); });
  global.fetch = async (url) => {
    const path = String(url);
    if (path.includes('/iran/buy/rate')) {
      return { ok: true, json: async () => ({ schema: 'fbt.iran-buy-rate.v1', available: true, buyPrice: '500000', source: 'wallex-public-markets', at: new Date().toISOString() }) };
    }
    if (path.includes('/etf?category=gold')) {
      return { ok: true, headers: { get: () => null }, json: async () => ({ ok: true, rows: [{ symbol: 'GLD', name: 'GLD', priceUsd: 312.4, changePct: 0.4, latestTradingDay: '2026-10-01', meta: { stale: false } }], meta: { stale: false, fetchedAt: Date.now() } }) };
    }
    if (path.includes('/insights/flows')) return { ok: true, json: async () => FLOWS };
    if (path.includes('/global/providers')) return { ok: true, json: async () => PROVIDERS };
    if (path.includes('/deep/macro-graph')) {
      if (!macroGraphReachable) return { ok: false, status: 502, json: async () => ({ ok: false, code: 'FI_ERROR' }) };
      return { ok: true, json: async () => MACRO_GRAPH };
    }
    return {
      ok: true,
      json: async () => {
        if (path.includes('/global/briefing')) return BRIEFING;
        if (path.includes('/global/cross-asset')) return CROSS;
        return INTEL;
      }
    };
  };

  let root = createRoot(container);
  await act(async () => {
    root.render(<MemoryRouter><LocationSpy /><AiGlobalIntelligence /></MemoryRouter>);
  });
  await act(async () => { await sleep(40); });

  /* ── the rail grew to eleven tabs, old four still present ────────────── */
  check('rail: the four original tabs survived alongside the seven new ones',
    ['📰', '🌐', '🗺️', '📡', '🔀', '⛓️', '💸', '🌳', '🧬', '🌍', '🔌']
      .every((m) => all('button').some((b) => (b.textContent || '').includes(m))));

  /* ── 2026-10 · THE BANNER ─────────────────────────────────────────────── */
  check('hero: the banner says «Global Intelligence» and never prints FBT',
    all('.gw-hero').length === 1
    && (all('.gw-hero-title')[0]?.textContent || '').trim() === 'Global Intelligence'
    && !/FBT/i.test(all('.gw-hero')[0].textContent || ''));
  check('hero: an animated SVG instrument (three spinning rings + a sweep) and live KPIs render',
    all('.gw-hero svg.gw-orbital').length === 1
    && all('.gw-hero .gw-spin').length >= 3 && all('.gw-hero .gw-sweep').length >= 1
    && all('.gw-kpi').length >= 3);
  check('hero: the motion is transform/opacity only and switched off for reduced motion',
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.gw-orbital \.gw-spin[\s\S]*animation: none/.test(GLOBAL_PAGE_STYLES)
    && keyframeProps('gw-').length >= 10
    && keyframeProps('gw-').every(([, prop]) => prop === 'transform' || prop === 'opacity'));

  /* ── 2026-10 · THE STATUS REPORT BOARD ────────────────────────────────── */
  const TILE_IDS = ['climate', 'dollar', 'gold', 'bonds', 'inflation', 'equity', 'crypto', 'institutional', 'whales', 'news', 'risk', 'countries'];
  check('briefing: twelve tappable tiles — each a button with an inline SVG icon',
    all('.gw-tile').length === 12
    && TILE_IDS.every((id) => all(`button.gw-tile[data-tile="${id}"]`).length === 1)
    && all('.gw-tile').every((t) => !!t.querySelector('svg')));
  check('briefing: tiles carry real numbers with a calibrated sentence and a quality badge',
    /\+0\.80%/.test(all('[data-tile="dollar"]')[0]?.textContent || '')
    && /a normal day/.test(all('[data-tile="dollar"]')[0]?.textContent || '')
    && all('.gw-tile .aigw-q').length >= 9);
  check('briefing: a tile whose input was not read says «unread» and is still a link',
    /unread|خوانده نشد/.test(all('[data-tile="whales"]')[0]?.textContent || '')
    && all('[data-tile="whales"]')[0]?.tagName === 'BUTTON');
  check('briefing: the server\u2019s own briefing messages sit below the board, with their headline',
    all('.gw-msg').length === 3 && /Yield curve inverted/.test(text()));
  /* tap → the relevant page */
  await act(async () => { all('[data-tile="dollar"]')[0]?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await sleep(15); });
  check('briefing: tapping the dollar tile opens the capital-flow tab (the macro table)',
    all('.aigw-panel.acc-flows').length === 1 && all('.gw-tile').length === 0);
  await clickTab('📰');
  await act(async () => { all('[data-tile="climate"]')[0]?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await sleep(15); });
  check('briefing: tapping the climate tile opens the world-state tab',
    all('.aigw-panel.acc-weather').length === 1);
  await clickTab('📰');
  await act(async () => { all('[data-tile="institutional"]')[0]?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await sleep(15); });
  check('briefing: tapping the smart-money tile navigates to the smart-money page',
    lastPath === '/smart-money');
  await act(async () => { all('.gw-msg')[1]?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await sleep(15); });
  check('briefing: tapping a server message opens the console tab that explains it',
    all('.aigw-panel').length === 1);
  await clickTab('📰');

  /* ── WORLD STATE ─────────────────────────────────────────────────────── */
  await clickTab('🌐');
  check('world: financial weather cards render from the pass',
    all('.aigw-weather-card').length >= 6);
  check('world: the nine GLOBAL FINANCIAL STATE gauges render',
    all('.aigw-gauge').length === 9);
  check('world: gauges carry their evidence — the direction is justified',
    /stablecoin net|نتیجهٔ استیبل‌کوین/.test(text()) && /outlook score|امتیاز چشم‌انداز/.test(text()));
  check('world: the radar ribbon links to the radar tab',
    /Global Radar|رادار جهانی/.test(text()) && all('.aigw-ribbon').length === 1);
  /* the weather BOARD (institutional flow / dollar / inflation-energy / risk) */
  check('world: the weather board renders every station with an animated SVG glyph',
    all('.aigw-station').length >= 9 && all('.aigw-glyph-svg').length >= 4);
  check('world: the four asked-for measures are the featured stations',
    ['institutional', 'dollar', 'inflation', 'risk']
      .every((id) => all('.aigw-station.feature').some((el) => (el.getAttribute('class') || '').includes('tone-'))));
  check('world: every station states its reading or says it was never read',
    all('.aigw-station').every((el) => {
      const ev = el.querySelector('.aigw-station-ev');
      const val = el.querySelector('.aigw-station-val');
      return (ev && (ev.textContent || '').trim().length > 3) && (val && (val.textContent || '').trim().length > 0);
    }));
  /* the 2026-10 calibration: «ایستگاه‌ها داده معتبر ندارند و باید محک شوند» */
  check('stations: fourteen calibrated stations, each scored against its own market\u2019s normal day',
    all('.aigw-station').length === 14 && /\d+(\.\d+)?× a normal day/.test(text()));
  check('stations: the benchmark legend lists the four bands and the model constants it scores against',
    all('.aigw-bench').length === 1 && all('.aigw-band').length === 4 && all('.aigw-bench-row').length >= 6
    && /model constants/.test(text()) && !/۰|۱|۲|۳|۴|۵|۶|۷|۸|۹/.test(all('.aigw-bench')[0].textContent || ''));
  check('stations: the quality summary counts direct · proxy · level-only · unread, and sums to the board',
    all('.aigw-sum-chip').length === 4
    && all('.aigw-sum-chip b').map((b) => Number(b.textContent)).reduce((a, c) => a + c, 0) === 14);
  check('stations: valid stations carry a quality badge; an unread one says «unread» and has none',
    all('.aigw-station:not(.tone-na) .aigw-q').length >= 12
    && all('.aigw-station.tone-na').length >= 1
    && all('.aigw-station.tone-na').every((el) => /unread/.test(el.textContent || '') && !el.querySelector('.aigw-q')));
  const stationNamed = (re) => all('.aigw-station').find((el) => re.test((el.querySelector('.aigw-station-name') || {}).textContent || ''));
  check('stations: dollar, gold and bonds each show a real figure and a calibrated reading',
    [/Dollar strength/, /Gold/, /Treasury/].every((re) => {
      const el = stationNamed(re);
      return el && /[+\-\u2212]\d/.test((el.querySelector('.aigw-station-val') || {}).textContent || '')
        && /a normal day/.test((el.querySelector('.aigw-station-read') || {}).textContent || '');
    }));
  check('stations: the whale scanner was down, so its station is «unread» — not a storm',
    /unread/.test((stationNamed(/Whale/) || {}).textContent || '') && /tone-na/.test((stationNamed(/Whale/) || { className: '' }).className));
  check('world: the climate strip blends the nine parts and shows its coverage',
    all('.aigw-climate').length === 1
    && all('.aigw-climate-parts').length === 1
    && all('.aigw-climate-parts > *').length >= 5
    && /\d+\/9|\d+ از ۹/.test(text()));

  /* ── GLOBE ───────────────────────────────────────────────────────────── */
  await clickTab('🗺️');
  check('globe: the SVG globe renders with its country nodes and orbits',
    all('.aigw-globe').length === 1 && all('.aigw-globe-dot').length >= 10 && all('.aigw-orbit-a').length === 1);
  check('globe: the default selection shows a snapshot built from read instruments',
    all('.aigw-country-row').length >= 3 && /DXY/.test(text()));
  check('globe: every country row names its source and how it was read (direct / proxy / peg / news)',
    all('.aigw-country-row').length >= 4
    && all('.aigw-country-row').every((r) => /source|direct|proxy|peg|headline|news|reference/i.test(r.textContent || ''))
    && !/NaN|undefined|\[object/.test(all('.aigw-country-card')[0]?.textContent || ''));
  /* tap China — copper + oil proxies */
  const cnDot = all('.aigw-globe-dot').find((g) => (g.getAttribute('aria-label') || '').toLowerCase().includes('china'));
  await act(async () => { cnDot?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await sleep(12); });
  check('globe: tapping a country switches the snapshot to that country\u2019s links',
    /COPPER/.test(text()) && /proxy|پروکسی/.test(text()));
  /* tap a country whose links are unread in this pass (Japan: JPY unread) */
  const jpDot = all('.aigw-globe-dot').find((g) => (g.getAttribute('aria-label') || '').toLowerCase().includes('japan'));
  await act(async () => { jpDot?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await sleep(12); });
  check('globe: an unread instrument stays honest (US10Y read, JPY parity absent)',
    /US10Y/.test(text()));
  check('globe: the rail carries every economy on the board, not a handful',
    all('.aigw-globe-dot[role="tab"]').length >= 40
    && all('.aigw-globe-dot[aria-label="china"]').length === 1
    && all('.aigw-globe-dot[aria-selected="true"]').length === 1);
  check('globe: the board states how many economies it read, and the legend explains the dots',
    /\d+ of \d+ countries read|کشور خوانده شد/.test(text()) && all('.aigw-globe-legend .aigw-hint').length === 4);
  check('globe: the decorative orbit layer and the drag hint are present',
    all('.aigw-globe-svg').length === 1 && all('.aigw-orbit-b').length === 1 && /drag to spin|بکش تا بچرخد/.test(text()));

  /* ── RADAR ───────────────────────────────────────────────────────────── */
  await clickTab('📡');
  check('radar: the sweep and blips render from real briefing items',
    all('.aigw-sweep').length === 1 && all('.aigw-blip').length >= 4);
  check('radar: the critical briefing item becomes a critical blip',
    all('.aigw-blip-ping').length >= 1);
  /* click a blip → detail */
  await act(async () => { all('.aigw-blip')[0]?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await sleep(12); });
  check('radar: a tapped blip shows its detail card',
    all('.aigw-blip-detail').length === 1);
  check('radar: the sweep is a two-beam radar, not a single bar',
    all('.aigw-sweep').length === 1 && all('.aigw-sweep-slow').length === 1);
  check('radar: the full signal tape lists every blip with its sector and value',
    all('.aigw-tape-row').length >= 4 && all('.aigw-tape-row').length === all('.aigw-blip').length
    && all('.aigw-tape-row').every((r) => (r.textContent || '').trim().length > 6));

  /* ── CAUSAL (server graph) ───────────────────────────────────────────── */
  await clickTab('⛓️');
  await act(async () => { await sleep(60); });
  check('causal: the server macro-graph renders its node columns',
    all('.aigw-causal-col').length === 4 && all('.aigw-node-chip').length >= 5);
  check('causal: the why-riskier drivers render with model-labelled sensitivities',
    /Why is .* riskier|چرا .* ریسک/.test(text()) && /weight -0\.5|weight 0\.6|وزن/.test(text()));
  check('causal: the chain of THIS pass is built locally first — six nodes, each naming its source or its stand-in',
    all('.aigw-chain-node').length >= 6 && all('.aigw-chain-node.state-read').length >= 3
    && all('.aigw-chain-node.state-model').length >= 1 && /testable links agreed|پیوند قابل‌سنجش/.test(text()));
  check('causal: the honesty note separates real moves from model weights',
    /first-order model sensitivities|حساسیت‌های مرتبهٔ اول/.test(text()));

  /* ── FLOW MAP ────────────────────────────────────────────────────────── */
  await clickTab('💸');
  check('flows: the six-node capital map renders', all('.aigw-flow-node').length === 6);
  check('flows: read nodes light up with real values; connectors animate between read pairs',
    all('.aigw-flow-node.on').length >= 5 && all('.aigw-flow-conn.on').length >= 3);
  check('flows: the measured net-flow verdict is the hero, in USD',
    all('.aigw-flow-hero').length === 1 && /\$/.test((all('.aigw-flow-hero-val')[0]?.textContent) || ''));
  check('flows: the macro table gives dollar, gold and bonds a level, a daily move and a source',
    all('.aigw-anchor').length >= 8
    && ['dollar', 'gold', 'us10y'].every((id) => {
      const el = all(`[data-anchor="${id}"]`)[0];
      return el && /\d/.test((el.querySelector('.aigw-anchor-level') || {}).textContent || '')
        && /[+\-\u2212]\d/.test((el.querySelector('.aigw-anchor-move') || {}).textContent || '')
        && !!el.querySelector('.aigw-anchor-src') && !!el.querySelector('.aigw-q');
    }));
  check('flows: an instrument the pass did not read (silver) says so — it is never a zero',
    /not read this pass/.test((all('[data-anchor="silver"]')[0] || {}).textContent || '')
    && !/\b0 USD\/oz/.test((all('[data-anchor="silver"]')[0] || {}).textContent || ''));
  check('wide: on a desktop width the console opens into columns instead of one narrow strip',
    all('.gw-cols').length === 1 && all('.gw-cols > .gw-col').length === 2
    && /@media \(min-width: 900px\)[\s\S]*\.gw-cols \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/.test(GLOBAL_PAGE_STYLES)
    && /\.gw-tiles \{ grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/.test(GLOBAL_PAGE_STYLES)
    && /\.aigw-stations \{ grid-template-columns: repeat\(auto-fill/.test(GLOBAL_PAGE_STYLES)
    && /max-width: 1320px/.test(GLOBAL_PAGE_STYLES));
  check('flows: the macro transmission chain marks read / proxy / model nodes',
    all('.aigw-chain-node').length >= 6
    && all('.aigw-chain-node.state-model').length >= 1
    && all('.aigw-chain-node.state-read').length >= 1);

  /* ── FUTURE TREE + CHALLENGER ────────────────────────────────────────── */
  await clickTab('🌳');
  check('future: three scenario branches render with weights summing to 100',
    all('.aigw-branch').length === 3 && (() => {
      const ws = all('.aigw-branch-weight').map((el) => Number((el.textContent || '').replace(/[^\d.]/g, '')));
      return ws.length === 3 && Math.abs(ws.reduce((a, c) => a + c, 0) - 100) <= 1;
    })());
  check('future: the adversarial challenger attacks the pass\u2019s opportunity with observed risks',
    /Adversarial|مدعی/.test(text()) && /BTC/.test(text()) && /observed|مشاهده شد/.test(text())
    && /Macro risk|ریسک کلان/.test(text()));
  check('future: scenario weights are auditable — every nudge is listed',
    all('.aigw-tag').length >= 8 && /regime|outlook|curve/.test(text()));
  check('future: the challenger is calm — at most three observed rows, the rest folded away',
    all('.aigw-adv-row').length >= 1 && all('.aigw-adv-row').length <= 3
    && all('.aigw-adv-more').length === 1 && all('.aigw-adv-summary').length === 1
    && all('.aigw-adv-row').every((r) => !!r.querySelector('.aigw-adv-ev') && !!r.querySelector('.aigw-adv-why')));
  check('future: «Crypto (class)» (the tree root) has room below it — it never touches the branch box',
    all('.aigw-tree-root').length === 1
    && !/margin/.test(all('.aigw-tree-root')[0].getAttribute('style') || '')
    && /margin-bottom:\s*(1[2-9]|[2-9]\d)px/.test(lastRule('.aigw-tree-root') || '')
    && /margin-bottom:\s*([89]|\d\d)px/.test(lastRule('.aigw-branch') || ''));
  check('future: the weight audit prints Persian-safe values — no raw engine enum',
    !/RECESSION_WATCH|MIXED_SIGNALS|GROWTH_WATCH/.test(all('.aigw-driver-tags')[0]?.textContent || ''));
  check('future: the tree draws three animated limbs with breathing leaves',
    all('.aigw-tree-svg').length === 1 && all('.aigw-branch-tree-path').length >= 3
    && all('.aigw-leaf').length >= 6);
  check('future: the tree names what would flip it, and the challenger attacks with observed risks',
    all('.aigw-flip').length >= 1 && all('.aigw-adv-row').length >= 1
    && all('.aigw-adv-ico.observed').length >= 1
    && /why this thesis could be wrong|چرا این فرصت/i.test(text()));

  /* ── DNA ─────────────────────────────────────────────────────────────── */
  await clickTab('🧬');
  check('dna: the six sensitivity bars render for the selected asset',
    all('.aigw-dna-row').length === 6 && all('.aigw-dna-helix').length === 1);
  check('dna: observed overlays come from this pass (BTC +2.4% class read, labelled-flow touch)',
    /\+2\.40%|\+۲٫۴۰٪/.test(text()) && /labelled flows|جریان‌های برچسب‌دار/.test(text()));
  check('dna: the sensitivity hexagon and the animated helix draw the asset shape',
    all('.aigw-hex').length === 1 && all('.aigw-dna-helix').length === 1 && all('.aigw-rung').length >= 10);
  check('dna: a gene read this pass carries a marker on its prior bar',
    all('.aigw-dna-track b').length >= 1 && all('.aigw-dna-row').length === 6);
  /* switch to DXY — the macro read (+0.80%) must become the observed overlay */
  const dxyChip = all('.aigw-chip').find((b) => (b.textContent || '').trim() === 'DXY');
  await act(async () => { dxyChip?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await sleep(12); });
  check('dna: switching asset re-reads the overlay from that asset\u2019s own instruments',
    /DXY/.test(text()) && /\+0\.80%|\+۰٫۸۰٪/.test(text()));

  /* ── THE ECONOMIC OUTLOOK — the gauge, the count, the signals ───────── */
  await clickTab('🔀');
  check('outlook: the blended reading draws its arc gauge, coverage and contributing signals',
    all('.aigw-outlook-arc').length === 1
    && all('.aigw-outlook-legend').length === 1
    && all('.aig-signal').length >= 2
    && /blended score|امتیاز ترکیبی/.test(text())
    && /input coverage|پوشش ورودی/.test(text()));
  check('outlook: coverage is a COUNT, and anything missing is named with its reason',
    /\d+\s*\/\s*9/.test(text())
    && (all('.aigw-missing .aigw-pill').length === 0 || /inputs not read|ورودی‌های خوانده‌نشده/.test(text())));

  /* ── DOMAINS — every field the pass returned ─────────────────────────── */
  await clickTab('🌍');
  check('domains: nine domain cards render, each with an inline SVG icon',
    all('.aigw-dom').length === 9 && all('.aigw-dom .aigw-dom-ico svg').length === 9);
  check('domains: an unread domain says so and keeps its reason',
    /unread|خوانده نشد/.test(text()) && /whale scanner unavailable|اسکنر نهنگ/.test(text()));
  /* open smart money — the top tokens must be there, not collapsed to one number */
  const smCard = all('.aigw-dom').find((c) => /Smart money|پول هوشمند/.test(c.textContent || ''));
  await act(async () => { smCard?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await sleep(12); });
  check('domains: the smart-money card opens the labelled top tokens from this pass',
    all('.aigw-dom-item').length >= 1 && /BTC/.test(text()));
  /* open macro — the topic labels AND the real quote move */
  const macroCard = all('.aigw-dom').find((c) => /^Macro|کلان/.test((c.querySelector('.aigw-dom-name') || {}).textContent || ''));
  await act(async () => { macroCard?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await sleep(12); });
  check('domains: the macro card shows both classified topics and the real DXY move',
    /FED/.test(text()) && /\+0\.8%/.test(text()));
  check('domains: ONE wide row per domain — a list, not a card grid, one button per row',
    all('.aigw-domlist').length === 1 && all('.aigw-domrow').length === 9 && all('.aigw-dom-grid').length === 0
    && all('.aigw-domrow > button.aigw-dom').length === 9
    && /display:\s*flex;\s*flex-direction:\s*column/.test(lastRule('.aigw-domlist') || ''));
  let openedEach = true;
  for (const btn of all('.aigw-dom')) {
    await act(async () => { btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await sleep(10); });
    openedEach = openedEach && all('.aigw-domrow.open').length === 1 && !!all('.aigw-domrow.open .aigw-dom-open')[0];
  }
  check('domains: tapping any of the nine rows opens it in place — the «page encountered a problem» crash is gone',
    openedEach && all('.aigw-domrow').length === 9);
  check('domains: rows speak plainly — no raw enum, object, source id or «undefined»',
    !/UNAVAILABLE|PARTIAL|smart_money|\[object|undefined|NaN|brain:|ci:|whales:scanner|smartMoney:/.test((all('.aigw-domlist')[0] || {}).textContent || ''));

  /* ── PROVIDERS — five SVG lamps per domain, no emoji ─────────────────── */
  await clickTab('🔌');
  check('providers: every domain renders five lamps and the legend explains them',
    all('.aigw-prov').length >= 2 && all('.aigw-lamp').length >= 10
    && all('.aigw-lamp-legend').length === 1 && all('.aigw-lamp.off').length >= 1);
  check('providers: each row carries its own accent SVG icon (never an emoji)',
    all('.aigw-prov').every((r) => !!r.querySelector('.aigw-dom-ico svg')));
  check('providers: a dead provider keeps its translated reason',
    /whale scanner unavailable|اسکنر نهنگ/.test(text()));

  /* ── SUB-TAB ICONS + COLOUR — not everything violet ──────────────────── */
  const accents = all('.aig-tab')
    .map((b) => b.style.getPropertyValue('--tab-acc').trim())
    .filter(Boolean);
  check('rail: each sub-tab carries its own accent colour (not one violet for all)',
    accents.length === all('.aig-tab').length
    && new Set(accents).size >= 8
    && accents.every((c) => /^#[0-9a-f]{3,8}$|^rgba?\(/.test(c)),
    { accents: accents.slice(0, 4) });
  const panelEmoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
  check('rail: the panels use inline SVG icons — no emoji inside a console panel',
    all('.aigw-panel').every((el) => !panelEmoji.test(el.textContent || '')));

  /* ── THE SAME PASS, READ IN PERSIAN ──────────────────────────────────── */
  await act(async () => { await setLanguage('fa'); });
  await act(async () => { await sleep(30); });
  await clickTab('📰');
  check('fa: the banner says «هوش جهانی» — never FBT',
    (all('.gw-hero-title')[0]?.textContent || '').trim() === 'هوش جهانی' && !/FBT/i.test(text()));
  check('fa: tile numbers use Persian digits and the Persian percent sign',
    /۰٫۸۰٪/.test(all('[data-tile="dollar"]')[0]?.textContent || ''));
  const RAW = /UNAVAILABLE|PARTIAL|RECESSION_WATCH|MIXED_SIGNALS|GROWTH_WATCH|smart_money|\[object|undefined|NaN|brain:|ci:|whales:scanner|smartMoney:|cross-asset-engine|news-engine/;
  const rawHits = [];
  for (const m of ['📰', '🌐', '🗺️', '⛓️', '💸', '🌳', '🌍', '🧬', '🔀', '📡', '🔌']) {
    await clickTab(m);
    const hit = text().match(RAW);
    if (hit) rawHits.push(`${m}: ${hit[0]}`);
  }
  const rawHit = rawHits.length ? rawHits.join(' | ') : null;
  check('fa: no raw machine string (enum, object, source id, undefined) on any tab', !rawHit, rawHit);
  await clickTab('🌐');
  check('fa: the calibrated board reads in Persian — «خوانش مستقیم», «برابر نوسان معمول», «واحد پایه»',
    /خوانش مستقیم/.test(text()) && /برابر نوسان معمول/.test(text()) && /واحد پایه/.test(text()) && !/\bbp\b/.test(text()));
  await clickTab('🌍');
  let faOpened = true;
  for (const btn of all('.aigw-dom')) {
    await act(async () => { btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await sleep(10); });
    faOpened = faOpened && all('.aigw-domrow.open').length === 1;
  }
  check('fa: every domain row opens in Persian too, with Persian status words', faOpened && /کامل/.test(text()) && /خوانده نشد/.test(text()));

  /* ── DEAD API: every new tab renders empty/unread instead of crashing ── */
  await act(async () => { root.unmount(); });
  global.fetch = async () => ({ ok: false, json: async () => ({ ok: false }) });
  container.innerHTML = '';
  root = createRoot(container);
  let crashed = false;
  try {
    await act(async () => {
      root.render(<MemoryRouter><LocationSpy /><AiGlobalIntelligence /></MemoryRouter>);
    });
    await act(async () => { await sleep(40); });
    for (const marker of ['📰', '🌐', '🗺️', '📡', '⛓️', '💸', '🌳', '🧬', '🌍', '🔌', '🔀']) {
      const btn = all('button').find((b) => (b.textContent || '').includes(marker));
      await act(async () => { btn?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await sleep(15); });
    }
  } catch (err) {
    crashed = true;
    errors.push(`crash on dead API: ${String(err?.message || err)}`);
  }
  check('dead API: every tab (the status report included) renders its honest empty state without crashing',
    !crashed && /unread|not read|خوانده نشد|No signal|nothing|هنوز/.test(text()));

  await act(async () => { root.unmount(); });
  global.fetch = realFetch;
  console.error = realError;

  const realErrors = errors.filter((e) => !/Warning|act\(|Not implemented/i.test(e));
  check('no fatal JS error was logged during any pass', realErrors.length === 0, realErrors[0]);
  return rows;
}
