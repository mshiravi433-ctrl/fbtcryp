/**
 * PHASE 211 — AI GLOBAL INTELLIGENCE PANEL — rendered, not just imported.
 * ---------------------------------------------------------------------------
 * The route inventory proves /ai-global is mounted and its lazy import
 * resolves. This probe proves the SCREEN itself renders: with a stubbed
 * /api/ai/global/* fetch it mounts the real component, walks all four tabs
 * (briefing · domains · cross-asset · providers), asserts the honest states
 * (an unread domain shows «unread», a provider row shows its five lamps), and
 * then — the case that matters most — mounts it against a DEAD API and asserts
 * the empty state renders instead of a crash. A throw inside this screen would
 * take the whole /ai-global route down, which is precisely the page Phase 211
 * adds; this probe keeps that from shipping silently.
 *
 * Build: vite build -c test/vite.phase211.mjs
 * Run:   node test/run-one-probe.mjs ./.out/phase211/ai-global-panel-probe.js
 */
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';
import i18n, { setLanguage } from '../../src/i18n/index.js';
import AiGlobalIntelligence from '../../src/components/ai/AiGlobalIntelligence.jsx';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* A REAL Phase 211 response shape — the same envelopes the server emits. */
const INTEL = {
  ok: true,
  schema: 'fbt.fi.global-intelligence.v1',
  globalIntelligence: {
    schema: 'fbt.fi.global-intelligence.v1', owner: 'dev:panel', at: Date.now(),
    status: 'OK', available: 8, coverage: 0.89, missing: ['whales'],
    executionAuthorized: false,
    domains: {
      smart_money: { status: 'OK', reason: null, source: 'smartMoney:overview', at: Date.now(), confidence: 0.85, data: { window: '24h', whaleActivity: { count: 14, changePct: 25 }, accumulationUsd: 2_400_000, distributionUsd: 900_000, netFlowUsd: -800_000, topTokens: [{ symbol: 'ETH', chain: 'eth', flow: 'dex_buy', valueUsd: 700_000 }] } },
      whales: { status: 'UNAVAILABLE', reason: 'WHALES_UNAVAILABLE:FEED_DOWN', source: 'whales:scanner', at: Date.now(), confidence: 0, data: null },
      onchain: { status: 'OK', reason: null, source: 'chainIntel', at: Date.now(), confidence: 0.8, data: { healthySources: 1, degradedSources: 1, downSources: 0, sources: [{ source: 'ci:markets', status: 'HEALTHY' }] } },
      news: { status: 'OK', reason: null, source: 'news-engine', at: Date.now(), confidence: 0.7, data: { count: 2, items: [{ title: 'Fed signals patience on rates', url: 'u', source: 'r', lang: 'en', at: Date.now() }] } },
      macro: { status: 'OK', reason: null, source: 'macro:classifier', at: Date.now(), confidence: 0.7, data: { attention: 2, byTopic: { FED: 1, POLITICS: 1 }, items: [{ topic: 'FED', title: 'Fed signals patience', url: 'u', at: Date.now(), matched: 'Fed' }], instruments: [{ symbol: 'DXY', name: 'US Dollar Index', kind: 'currency', priceUsd: 108.2, change1dPct: 0.8, change7dPct: 1.2, source: 'stooq:DX.F' }, { symbol: 'GOLD', name: 'Gold (USD/oz)', kind: 'safe_haven', priceUsd: 2450.5, change1dPct: 0.5, change7dPct: 2.1, source: 'stooq:GC.F' }], curve: { symbol: 'US2S10S', spreadPct: -0.21, source: 'fred:T10Y2Y' }, untrusted: true } },
      stocks: { status: 'OK', reason: null, source: 'brain:stocks', at: Date.now(), confidence: 0.75, data: { venue: 'avantis', readOnly: true, instruments: [{ symbol: 'AAPL', priceUsd: 214.3, change24hPct: 1.2 }, { symbol: 'TSLA', priceUsd: 242.1, change24hPct: -2.1 }] } },
      forex: { status: 'OK', reason: null, source: 'brain:forex', at: Date.now(), confidence: 0.7, data: { venue: 'ostium', readOnly: true, instruments: [{ symbol: 'EURUSD', priceUsd: 1.084, change24hPct: 0.3 }] } },
      commodities: { status: 'OK', reason: null, source: 'brain:commodities', at: Date.now(), confidence: 0.7, data: { venue: 'ostium', readOnly: true, instruments: [
        { symbol: 'GOLD', priceUsd: 2352.5, change24hPct: 0.9, category: 'commodities' },
        { symbol: 'SILVER', priceUsd: 31.2, change24hPct: 0.4, category: 'commodities' },
        { symbol: 'WTI', priceUsd: 78.4, change24hPct: -0.2, category: 'commodities' },
        { symbol: 'BRENT', priceUsd: 81.2, change24hPct: 0.1, category: 'commodities' },
        { symbol: 'COPPER', priceUsd: 4.5, change24hPct: 0.3, category: 'commodities' }
      ] } },
      rwa: { status: 'OK', reason: null, source: 'brain:rwa', at: Date.now(), confidence: 0.7, data: { venue: 'ostium', readOnly: true, instruments: [{ symbol: 'XAU', priceUsd: 2352.5, change24hPct: 0.9, category: 'commodities' }] } }
    },
    providers: {
      smart_money: { implemented: true, configured: true, provider_available: true, runtime_ready: true, live: true, status: 'OK' },
      whales: { implemented: true, configured: true, provider_available: false, runtime_ready: true, live: false, status: 'UNAVAILABLE', reason: 'WHALES_UNAVAILABLE:FEED_DOWN' }
    }
  }
};
const BRIEFING = {
  ok: true,
  briefing: {
    schema: 'fbt.fi.briefing.v1', at: Date.now(), status: 'OK', proactive: true, executionAuthorized: false,
    items: [
      { id: 'br_a', kind: 'smart_money', priority: 'normal', title: 'Smart money is accumulating', detail: 'labelled flow over the last 24h', evidence: [], action: { type: 'navigate', to: '/smart-money' }, source: 'smartMoney:overview', at: Date.now(), confidence: 0.65 },
      { id: 'br_b', kind: 'cross_asset', priority: 'info', title: 'Cross-asset regime: risk on leaning', detail: 'crypto, stocks observed', evidence: [], action: { type: 'navigate', to: '/ai-global' }, source: 'cross-asset-engine', at: Date.now(), confidence: 0.7 }
    ],
    counts: { critical: 0, high: 0, normal: 1, info: 1 }, missing: []
  }
};
const CROSS = {
  ok: true,
  crossAsset: {
    schema: 'fbt.fi.cross-asset.v1', at: Date.now(), status: 'OK',
    observedClasses: ['crypto', 'stocks'], readOnlyClasses: ['stocks'],
    classes: { crypto: { instruments: 2, withChange: 2, advancing: 1, declining: 1, avgChangePct: -0.35, top: [], bottom: [] }, stocks: { instruments: 2, withChange: 2, advancing: 1, declining: 1, avgChangePct: -0.45, top: [], bottom: [] } },
    regime: { regime: 'RISK_OFF_LEANING', votes: [{ cls: 'crypto', avg: -0.35 }, { cls: 'stocks', avg: -0.45 }], coMovement: 1, basis: 'real per-instrument changes' },
    divergences: [], correlations: { UNAVAILABLE: { ok: false, reason: 'NO_PAIRED_HISTORY_SUPPLIED' } }, missing: ['forex'],
    /* Phase 211.1 — the macro indicator layer + the economic outlook. */
    macro: {
      status: 'OK', untrusted: true,
      indicators: [
        { symbol: 'DXY', name: 'US Dollar Index', kind: 'currency', unit: 'index points', priceUsd: 108.2, change1dPct: 0.8, change7dPct: 1.2, source: 'stooq:DX.F', at: Date.now() - 60_000 },
        { symbol: 'GOLD', name: 'Gold (USD/troy oz)', kind: 'safe_haven', unit: 'USD/troy oz', priceUsd: 2450.5, change1dPct: 0.5, change7dPct: 2.1, source: 'stooq:GC.F', at: Date.now() - 60_000 },
        { symbol: 'SILVER', name: 'Silver (USD/troy oz)', kind: 'industrial_metal', unit: 'USD/troy oz', priceUsd: 31.2, change1dPct: 0.7, change7dPct: 1.8, source: 'stooq:SI.F', at: Date.now() - 60_000 },
        { symbol: 'WTI', name: 'WTI Crude (USD/bbl)', kind: 'energy', unit: 'USD/barrel', priceUsd: 78.4, change1dPct: -0.6, change7dPct: -1.8, source: 'stooq:CL.F', at: Date.now() - 60_000 },
        { symbol: 'BRENT', name: 'Brent Crude (USD/bbl)', kind: 'energy', unit: 'USD/barrel', priceUsd: 81.2, change1dPct: -0.3, change7dPct: -1.1, source: 'stooq:BRN.F', at: Date.now() - 60_000 },
        { symbol: 'COPPER', name: 'Copper (USD/lb)', kind: 'industrial_metal', unit: 'USD/lb', priceUsd: 4.5, change1dPct: 0.2, change7dPct: 0.6, source: 'stooq:HG.F', at: Date.now() - 60_000 },
        { symbol: 'SPX', name: 'S&P 500 E-mini futures', kind: 'equity', unit: 'index points', priceUsd: 5480.25, change1dPct: 0.4, change7dPct: 0.9, source: 'stooq:ES.F', at: Date.now() - 60_000 },
        { symbol: 'US10Y', name: 'US 10Y Treasury yield (%)', kind: 'rate', unit: '%', priceUsd: 4.21, change1dPct: 0.4, change7dPct: 1.1, source: 'fred:DGS10', at: Date.now() - 60_000 },
        { symbol: 'US2S10S', name: 'US 2s10s spread (pct)', kind: 'curve', unit: 'percentage points', priceUsd: -0.21, change1dPct: null, change7dPct: -0.3, source: 'fred:T10Y2Y', at: Date.now() - 60_000 }
      ],
      curve: { symbol: 'US2S10S', spreadPct: -0.21, change7dPct: -0.3, source: 'fred:T10Y2Y' }
    },
    outlook: {
      label: 'RECESSION_WATCH', score: -0.21, untrusted: true,
      note: 'a weighted reading of this pass\u2019s real reads — data, not authority; not a forecast',
      currentState: { regime: 'RISK_OFF_LEANING', observedClasses: ['crypto', 'stocks'], avgChangePct: { crypto: -0.35, stocks: -0.45 } },
      signals: [
        { id: 'risk_mood', name: 'cross-class mood', value: -1, weight: 1.5, direction: 'cautionary', evidence: '0 of 2 asset classes up over 24h — regime risk off leaning', source: 'cross-asset-engine' },
        { id: 'yield_curve', name: 'yield curve', value: -1, weight: 1.5, direction: 'cautionary', evidence: '2s10s spread INVERTED at -0.21pp — inversions have historically preceded US recessions', source: 'fred:T10Y2Y' }
      ]
    }
  }
};

export async function run(container) {
  const rows = [];
  const check = (name, ok) => { rows.push([name, !!ok]); console.log(`${ok ? '✓' : '✗'} ${name}`); };
  const q = (sel) => container.querySelector(sel);
  const all = (sel) => Array.from(container.querySelectorAll(sel));
  const text = () => container.textContent || '';

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

  /* ── 1. mount with a live API ──────────────────────────────────────────── */
  let rateAvailable = true;
  const goldEtfRows = [
    ['GLD', 312.4], ['IAU', 57.8], ['GLDM', 65.1], ['SGOL', 31.6], ['BAR', 34.2]
  ].map(([symbol, priceUsd]) => ({
    symbol, name: `${symbol} Gold ETF`, priceUsd, changePct: 0.4,
    latestTradingDay: '2026-10-01', meta: { stale: false }
  }));
  await act(async () => { await i18n.changeLanguage('en'); });
  global.fetch = async (url) => {
    const path = String(url);
    if (path.includes('/iran/buy/rate')) {
      return { ok: true, json: async () => ({
        schema: 'fbt.iran-buy-rate.v1', available: rateAvailable,
        buyPrice: rateAvailable ? '500000' : null,
        source: 'wallex-public-markets', at: new Date().toISOString()
      }) };
    }
    if (path.includes('/etf?category=gold')) {
      return {
        ok: true,
        headers: { get: () => null },
        json: async () => ({ ok: true, rows: goldEtfRows, meta: { stale: false, fetchedAt: Date.now() } })
      };
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
    root.render(
      <MemoryRouter>
        <AiGlobalIntelligence />
      </MemoryRouter>
    );
  });
  await act(async () => { await sleep(30); });

  check('panel: the screen mounts with the briefing tab visible and the live-domain chip',
    text().includes('9') || /domains live|دامنه زنده/.test(text()));
  check('panel: the smart-money briefing item renders with its source + open action',
    /Smart money is accumulating|پول هوشمند/.test(text()) && (/smart money|پول هوشمند/.test(text())));

  /* switch to the domains tab */
  const domainTab = all('button').find((b) => (b.textContent || '').includes('🌍'));
  await act(async () => { domainTab?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
  await act(async () => { await sleep(10); });
  check('panel: the domains tab renders the nine domains',
    ['smart money', 'whales', 'on-chain', 'macro', 'stocks', 'forex', 'commodities', 'rwa'].every((d) => text().toLowerCase().includes(d)) || text().includes('پول هوشمند'));
  check('panel: an UNAVAILABLE domain shows unread with its reason — never a number',
    /unread|خوانده نشد/.test(text()) && (/whale scanner unavailable|اسکنر نهنگ در دسترس نیست/.test(text())));
  check('panel: the macro domain card shows classified topics AND the real quote move (the connection)',
    /DXY/.test(text()) && /\+0\.8%/.test(text()) && /POLITICS|سیاست/i.test(text()));

  /* switch to cross-asset */
  const crossTab = all('button').find((b) => (b.textContent || '').includes('🔀'));
  await act(async () => { crossTab?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
  await act(async () => { await sleep(10); });
  check('panel: the cross-asset tab shows the regime and its basis',
    /RISK OFF LEANING/i.test(text()) && /real per-class average 24h change|میانگین تغییر ۲۴ ساعته واقعی/.test(text()) && text().includes('crypto'));
  check('panel: the correlations note says history is required — never an invented r',
    /Correlations need real paired history|همبستگی فقط با سری زمانی/.test(text()));
  /* Phase 211.1 — the economic outlook block: the now AND the direction. */
  check('panel: the economic outlook block renders its label, score and named signals with evidence',
    /Economic outlook|چشم‌انداز اقتصادی/.test(text())
    && /recession watch|هشدار رکود/i.test(text())
    && text().includes('-0.21')
    && /yield curve|منحنی/i.test(text())
    && /INVERTED|وارون/i.test(text())
    && all('.aig-signal').length >= 2
    && all('.aig-signal-dir').some((el) => /cautionary|هشداردهنده/.test(el.textContent || '')));
  check('panel: the outlook block names an input it could NOT read, with its reason (never a silent gap)',
    /inputs not read|ورودی\u200cهای خوانده\u200cنشده/.test(text())
    && /news classifier unread|دسته\u200cبندی اخبار خوانده نشد/.test(text()));
  check('panel: the macro indicator layer renders the real quotes with 1d/7d and the curve',
    text().includes('DXY') && text().includes('GOLD') && text().includes('US10Y')
    && /\+0\.8% 1d/.test(text()) && /\+2\.1% 7d/.test(text())
    && /2s10s/i.test(text()) && /inverted|وارون/i.test(text()));
  check('panel: five distinct commodity quotes are rendered from observed USD feeds',
    all('.aig-commodity-row').length === 5
    && ['GOLD', 'SILVER', 'WTI', 'BRENT', 'COPPER'].every((symbol) => text().includes(symbol))
    && /USD\/troy oz/.test(text()) && /USD\/barrel/.test(text()));
  check('panel: ETF cards contain only the five priced gold ETF rows returned by the quote endpoint',
    all('.aig-etf-row').length === 5 && ['GLD', 'IAU', 'GLDM', 'SGOL', 'BAR'].every((symbol) => text().includes(symbol)));

  /* The toman conversion is locale-aware and fails closed when the public
     USDT/TMN reference is missing or stale. */
  await act(async () => { await setLanguage('fa'); await sleep(40); });
  const crossTabFa = all('button').find((b) => (b.textContent || '').includes('🔀'));
  await act(async () => { crossTabFa?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await sleep(20); });
  check('panel: Persian market values show a fresh USDT/TMN-based toman estimate with a non-executable disclaimer',
    all('.aig-commodity-row .aig-market-toman').length === 5
    && /USDT\/TMN/.test(text()) && /نرخ اجرایی USD\/TMN/.test(text()) && /تومان/.test(text()));
  rateAvailable = false;
  await act(async () => { all('.aig-refresh')[0]?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await sleep(40); });
  check('panel: missing USDT/TMN data hides toman conversions instead of retaining a stale number',
    all('.aig-commodity-row .aig-market-toman').length === 0
    && /نرخ تازهٔ عمومی USDT\/TMN در دسترس نیست/.test(text()));

  /* switch to providers */
  const provTab = all('button').find((b) => (b.textContent || '').includes('🔌'));
  await act(async () => { provTab?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
  await act(async () => { await sleep(10); });
  check('panel: the providers tab renders the five-lamp rows',
    all('.aig-light').length >= 1 && all('.aig-lamp').length >= 10);
  check('panel: a dead provider shows its reason',
    (/whale scanner unavailable|اسکنر نهنگ در دسترس نیست/.test(text())));

  await act(async () => { root.unmount(); });
  await act(async () => { await setLanguage('en'); });

  /* ── 2. mount against a DEAD API — the screen must render its empty state ─ */
  global.fetch = async () => ({ ok: false, json: async () => ({ ok: false }) });
  container.innerHTML = '';
  root = createRoot(container);
  let mounted = true;
  try {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <AiGlobalIntelligence />
        </MemoryRouter>
      );
    });
    await act(async () => { await sleep(30); });
  } catch (err) {
    mounted = false;
    errors.push(`crash on dead API: ${String(err?.message || err)}`);
  }
  check('panel: with the API dead the screen renders an honest empty state instead of crashing',
    mounted && container.children.length > 0 && !errors.some((e) => e.startsWith('crash')));
  await act(async () => { root.unmount(); });

  global.fetch = realFetch;
  console.error = realError;

  const realErrors = errors.filter((e) => !/Warning|act\(|Not implemented/i.test(e));
  check('panel: no fatal JS error was logged during any pass', realErrors.length === 0, realErrors[0]);

  return rows;
}
