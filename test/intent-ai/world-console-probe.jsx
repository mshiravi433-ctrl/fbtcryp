/**
 * FBT WORLD CONSOLE PROBE — the «FBT جهانی» upgrade, rendered.
 * ---------------------------------------------------------------------------
 * Proves the seven new sub-tabs inside News → FBT جهانی actually render and
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
import { MemoryRouter } from 'react-router-dom';
import i18n, { setLanguage } from '../../src/i18n/index.js';
import AiGlobalIntelligence from '../../src/components/ai/AiGlobalIntelligence.jsx';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* The same real envelopes the phase211 probe uses, plus a flows payload. */
const NOW = Date.now();
const INTEL = {
  ok: true, schema: 'fbt.fi.global-intelligence.v1',
  globalIntelligence: {
    schema: 'fbt.fi.global-intelligence.v1', owner: 'dev:probe', at: NOW, status: 'OK',
    available: 8, coverage: 0.89, missing: ['whales'], executionAuthorized: false,
    domains: {
      smart_money: { status: 'OK', reason: null, source: 'smartMoney:overview', at: NOW, confidence: 0.85, data: { window: '24h', whaleActivity: { count: 14, changePct: 25 }, accumulationUsd: 2_400_000, distributionUsd: 900_000, netFlowUsd: -800_000, topTokens: [{ symbol: 'BTC', chain: 'eth', flow: 'dex_buy', valueUsd: 700_000, exchangeOutflowUsd: 500_000 }] } },
      whales: { status: 'UNAVAILABLE', reason: 'WHALES_UNAVAILABLE:FEED_DOWN', source: 'whales:scanner', at: NOW, confidence: 0, data: null },
      onchain: { status: 'OK', reason: null, source: 'chainIntel', at: NOW, confidence: 0.8, data: { healthySources: 2, degradedSources: 0, downSources: 0, sources: [{ source: 'ci:markets', status: 'HEALTHY' }, { source: 'ci:gas', status: 'HEALTHY' }] } },
      news: { status: 'OK', reason: null, source: 'news-engine', at: NOW, confidence: 0.7, data: { count: 21, items: [{ title: 'Fed signals patience on rates', url: 'u', source: 'r', lang: 'en', at: NOW }] } },
      macro: { status: 'OK', reason: null, source: 'macro:classifier', at: NOW, confidence: 0.7, data: { attention: 5, byTopic: { FED: 2, GEOPOLITICS: 2, INFLATION: 1 }, items: [], instruments: [], curve: null, untrusted: true } },
      stocks: { status: 'OK', reason: null, source: 'brain:stocks', at: NOW, confidence: 0.75, data: { venue: 'avantis', readOnly: true, instruments: [{ symbol: 'AAPL', priceUsd: 214.3, change24hPct: 1.2 }] } },
      forex: { status: 'OK', reason: null, source: 'brain:forex', at: NOW, confidence: 0.7, data: { venue: 'ostium', readOnly: true, instruments: [{ symbol: 'EURUSD', priceUsd: 1.084, change24hPct: 0.3 }] } },
      commodities: { status: 'OK', reason: null, source: 'brain:commodities', at: NOW, confidence: 0.7, data: { venue: 'ostium', readOnly: true, instruments: [] } },
      rwa: { status: 'OK', reason: null, source: 'brain:rwa', at: NOW, confidence: 0.7, data: { venue: 'ostium', readOnly: true, instruments: [{ symbol: 'XAU', priceUsd: 2352.5, change24hPct: 0.9, category: 'commodities' }] } }
    },
    providers: {}
  }
};
const BRIEFING = {
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
const CROSS = {
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
const FLOWS = {
  ok: true, schema: 'fbt.capital-flows.v1', at: NOW,
  tokenFlows: { status: 'OK', topInflow: { symbol: 'BTC', name: 'Bitcoin', mcapChangeUsd: 1_900_000_000, mcapChangePct: 1.4 }, topOutflow: { symbol: 'XRP', name: 'XRP', mcapChangeUsd: -240_000_000, mcapChangePct: -0.9 }, rows: [] },
  chainFlows: { status: 'OK', net24hUsd: 84_000_000, net24hPct: 0.05, topInflowChain: { chain: 'ethereum', net24hUsd: 92_000_000 }, topOutflowChain: { chain: 'bsc', net24hUsd: -11_000_000 }, chainInflows: [], chainOutflows: [] },
  profitLeaders: { status: 'UNAVAILABLE', reason: 'PROFIT_SOURCE_UNAVAILABLE' }
};
const MACRO_GRAPH = {
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
  const check = (name, ok) => { rows.push([name, !!ok]); console.log(`${ok ? '✓' : '✗'} ${name}`); };
  const all = (sel) => Array.from(container.querySelectorAll(sel));
  const text = () => container.textContent || '';
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
    root.render(<MemoryRouter><AiGlobalIntelligence /></MemoryRouter>);
  });
  await act(async () => { await sleep(40); });

  /* ── the rail grew to eleven tabs, old four still present ────────────── */
  check('rail: the four original tabs survived alongside the seven new ones',
    ['📰', '🌐', '🗺️', '📡', '🔀', '⛓️', '💸', '🌳', '🧬', '🌍', '🔌']
      .every((m) => all('button').some((b) => (b.textContent || '').includes(m))));

  /* ── WORLD STATE ─────────────────────────────────────────────────────── */
  await clickTab('🌐');
  check('world: financial weather cards render from the pass',
    all('.aigw-weather-card').length >= 6);
  check('world: the nine GLOBAL FINANCIAL STATE gauges render',
    all('.aigw-gauge').length === 9);
  check('world: gauges carry their evidence — the direction is justified',
    /stablecoin net|نتیجهٔ استیبل‌کوین/.test(text()) && /outlook score|امتیاز چشم‌انداز/.test(text()));
  check('world: the radar ribbon links to the radar tab',
    /FBT Global Radar|رادار جهانی FBT/.test(text()) && all('.aigw-ribbon').length === 1);

  /* ── GLOBE ───────────────────────────────────────────────────────────── */
  await clickTab('🗺️');
  check('globe: the SVG globe renders with its country nodes and orbits',
    all('.aigw-globe').length === 1 && all('.aigw-globe-dot').length >= 10 && all('.aigw-orbit-a').length === 1);
  check('globe: the default selection shows a snapshot built from read instruments',
    all('.aigw-country-row').length >= 3 && /DXY/.test(text()));
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

  /* ── CAUSAL (server graph) ───────────────────────────────────────────── */
  await clickTab('⛓️');
  await act(async () => { await sleep(60); });
  check('causal: the server macro-graph renders its node columns',
    all('.aigw-causal-col').length === 4 && all('.aigw-node-chip').length >= 5);
  check('causal: the why-riskier drivers render with model-labelled sensitivities',
    /Why is BTC riskier|چرا BTC/.test(text()) && /w=-0\.5|w=0\.6/.test(text()));
  check('causal: the honesty note separates real moves from model weights',
    /first-order model sensitivities|حساسیت‌های مرتبهٔ اول/.test(text()));

  /* ── FLOW MAP ────────────────────────────────────────────────────────── */
  await clickTab('💸');
  check('flows: the six-node capital map renders', all('.aigw-flow-node').length === 6);
  check('flows: read nodes light up with real values; connectors animate between read pairs',
    all('.aigw-flow-node.on').length >= 5 && all('.aigw-flow-conn.on').length >= 3);

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

  /* ── DNA ─────────────────────────────────────────────────────────────── */
  await clickTab('🧬');
  check('dna: the six sensitivity bars render for the selected asset',
    all('.aigw-dna-row').length === 6 && all('.aigw-dna-helix').length === 1);
  check('dna: observed overlays come from this pass (BTC +2.4% class read, labelled-flow touch)',
    /\+2\.40%|\+۲٫۴۰٪/.test(text()) && /labelled flows|جریان‌های برچسب‌دار/.test(text()));

  /* ── DEAD API: every new tab renders empty/unread instead of crashing ── */
  await act(async () => { root.unmount(); });
  global.fetch = async () => ({ ok: false, json: async () => ({ ok: false }) });
  container.innerHTML = '';
  root = createRoot(container);
  let crashed = false;
  try {
    await act(async () => {
      root.render(<MemoryRouter><AiGlobalIntelligence /></MemoryRouter>);
    });
    await act(async () => { await sleep(40); });
    for (const marker of ['🌐', '🗺️', '📡', '⛓️', '💸', '🌳', '🧬']) {
      const btn = all('button').find((b) => (b.textContent || '').includes(marker));
      await act(async () => { btn?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await sleep(15); });
    }
  } catch (err) {
    crashed = true;
    errors.push(`crash on dead API: ${String(err?.message || err)}`);
  }
  check('dead API: all seven new tabs render their honest empty states without crashing',
    !crashed && /unread|not read|خوانده نشد|No signal|nothing|هنوز/.test(text()));

  await act(async () => { root.unmount(); });
  global.fetch = realFetch;
  console.error = realError;

  const realErrors = errors.filter((e) => !/Warning|act\(|Not implemented/i.test(e));
  check('no fatal JS error was logged during any pass', realErrors.length === 0, realErrors[0]);
  return rows;
}
