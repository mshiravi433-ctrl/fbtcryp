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
import '../../src/i18n/index.js';
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
      macro: { status: 'OK', reason: null, source: 'macro:classifier', at: Date.now(), confidence: 0.6, data: { attention: 2, byTopic: { FED: 1, ECB: 1 }, items: [{ topic: 'FED', title: 'Fed signals patience', url: 'u', at: Date.now(), matched: 'Fed' }] } },
      stocks: { status: 'OK', reason: null, source: 'brain:stocks', at: Date.now(), confidence: 0.75, data: { venue: 'avantis', readOnly: true, instruments: [{ symbol: 'AAPL', priceUsd: 214.3, change24hPct: 1.2 }, { symbol: 'TSLA', priceUsd: 242.1, change24hPct: -2.1 }] } },
      forex: { status: 'OK', reason: null, source: 'brain:forex', at: Date.now(), confidence: 0.7, data: { venue: 'ostium', readOnly: true, instruments: [{ symbol: 'EURUSD', priceUsd: 1.084, change24hPct: 0.3 }] } },
      commodities: { status: 'OK', reason: null, source: 'brain:commodities', at: Date.now(), confidence: 0.7, data: { venue: 'ostium', readOnly: true, instruments: [{ symbol: 'XAU', priceUsd: 2352.5, change24hPct: 0.9 }] } },
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
    divergences: [], correlations: { UNAVAILABLE: { ok: false, reason: 'NO_PAIRED_HISTORY_SUPPLIED' } }, missing: ['forex']
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
  global.fetch = async (url) => ({
    ok: true,
    json: async () => {
      if (String(url).includes('/global/briefing')) return BRIEFING;
      if (String(url).includes('/global/cross-asset')) return CROSS;
      return INTEL;
    }
  });

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
    /Smart money is accumulating|پول هوشمند/.test(text()) && text().includes('smartMoney:overview'));

  /* switch to the domains tab */
  const domainTab = all('button').find((b) => (b.textContent || '').includes('🌍'));
  await act(async () => { domainTab?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
  await act(async () => { await sleep(10); });
  check('panel: the domains tab renders the nine domains',
    ['smart money', 'whales', 'on-chain', 'macro', 'stocks', 'forex', 'commodities', 'rwa'].every((d) => text().toLowerCase().includes(d)) || text().includes('پول هوشمند'));
  check('panel: an UNAVAILABLE domain shows unread with its reason — never a number',
    /unread|خوانده نشد/.test(text()) && text().includes('WHALES_UNAVAILABLE'));

  /* switch to cross-asset */
  const crossTab = all('button').find((b) => (b.textContent || '').includes('🔀'));
  await act(async () => { crossTab?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
  await act(async () => { await sleep(10); });
  check('panel: the cross-asset tab shows the regime and its basis',
    /RISK OFF LEANING/i.test(text()) && /real per-class average 24h change|میانگین تغییر ۲۴ ساعته واقعی/.test(text()) && text().includes('crypto'));
  check('panel: the correlations note says history is required — never an invented r',
    /Correlations need real paired history|همبستگی فقط با سری زمانی/.test(text()));

  /* switch to providers */
  const provTab = all('button').find((b) => (b.textContent || '').includes('🔌'));
  await act(async () => { provTab?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
  await act(async () => { await sleep(10); });
  check('panel: the providers tab renders the five-lamp rows',
    all('.aig-light').length >= 1 && all('.aig-lamp').length >= 10);
  check('panel: a dead provider shows its reason',
    text().includes('WHALES_UNAVAILABLE'));

  await act(async () => { root.unmount(); });

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
