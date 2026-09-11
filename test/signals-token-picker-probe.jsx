/**
 * SIGNALS PAGE — the token picker, driven the way a user drives it.
 * ---------------------------------------------------------------------------
 * ─── THE BUG THIS EXISTS TO FIND ────────────────────────────────────────────
 * Reported: «سیگنال با انتخاب توکن هم اصلی و هم سولنا کرش میشه اپ و سایت و
 * میگه مشکلی پیش اومده» — picking a token from the picker (on BOTH the global
 * tab and the Solana tab) takes the whole screen to the «مشکلی پیش اومده»
 * crash card.
 *
 * The screen suite in signals-page-probe.jsx mounts the page and clicks the
 * Solana tab, the horizon switch, the alert sheet and the Why modal — but it
 * never opens the token picker and chooses a DIFFERENT asset, which is exactly
 * the interaction that crashed: the selection flows through ModernSelect →
 * selectToken() → a new activeId → new chart/coin/intel fetches → a rebuilt
 * signal card, and any throw along that chain lands in RouteBoundary.
 *
 * So this probe does precisely that, on both tabs, against the real response
 * shapes (live markets, dead pulse, string-typed numbers): open the picker,
 * click another option, wait for the re-analysis, assert the page survived and
 * the new asset's card actually rendered.
 */
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { HashRouter, Route, Routes } from 'react-router-dom';
import '../src/i18n/index.js';
import { TelegramProvider } from '../src/context/TelegramContext.jsx';
import { WalletProvider } from '../src/context/WalletContext.jsx';
import Signals from '../src/pages/Signals.jsx';
import RouteBoundary from '../src/components/RouteBoundary.jsx';
import { clearApiCache } from '../src/lib/api.js';
import signalsIntelCss from '../src/styles/signals-intel.css?raw';

const series = (n, f) =>
  Array.from({ length: n }, (_, i) => ({ t: Date.now() - (n - i) * 3600_000, p: f(i) }));
const spark = (n, f) => Array.from({ length: n }, (_, i) => f(i));

const mk = (id, symbol, name, price, f) => ({
  id,
  symbol,
  name,
  image: null,
  rank: 1,
  price,
  change1h: 0.4,
  change24h: 3.2,
  change7d: 8.6,
  mcap: 1.28e12,
  volume: 3.1e10,
  supply: 19_700_000,
  high24h: price * 1.02,
  low24h: price * 0.98,
  ath: price * 1.1,
  athChange: -9,
  sparkline: spark(60, f),
  dataProvenance: 'live'
});

const btc = mk('bitcoin', 'BTC', 'Bitcoin', 65_000, (i) => 62_000 + Math.sin(i / 5) * 900 + i * 55);
const eth = mk('ethereum', 'ETH', 'Ethereum', 3_200, (i) => 3_400 - Math.sin(i / 4) * 60 - i * 3);
const bnb = mk('binancecoin', 'BNB', 'BNB', 585, (i) => 570 + Math.cos(i / 5) * 6 + i * 0.2);
const sol = mk('solana', 'SOL', 'Solana', 148, (i) => 140 + Math.sin(i / 6) * 4 + i * 0.2);
const jup = mk('jupiter-exchange-solana', 'JUP', 'Jupiter', 0.92, (i) => 0.88 + Math.sin(i / 5) * 0.02 + i * 0.0006);
const bonk = mk('bonk', 'BONK', 'Bonk', 0.000021, (i) => 0.00002 * (1 + Math.sin(i / 4) * 0.08));

const livePulse = {
  schema: 'fbt.signal-pulse.v1',
  at: Date.now(),
  source: 'live',
  dataProvenance: { global: 'coingecko', markets: 'coingecko', smartMoney: 'live' },
  sentiment: { score: 63, label: 'bullish' },
  risk: { score: 44, label: 'MEDIUM' },
  aiConfidence: 78,
  momentum: { score: 21, label: 'moderate', direction: 'up' },
  volatility: { score: 38, label: 'moderate' },
  liquidity: { score: 71, label: 'strong', turnoverPct: 8.9 },
  breadth: { up: 13, total: 20, avgChange: 1.8 },
  smartMoney: {
    dataStatus: 'live',
    whaleActivity: 4,
    netFlowUsd: 1.2e8,
    accumulationUsd: 3.4e8,
    distributionUsd: 2.2e8
  },
  lastUpdate: Date.now()
};

/* A per-coin chart, so a selection change visibly changes the drawn series. */
const chartFor = (id) => {
  if (id === 'ethereum') return series(60, (i) => 3_400 - Math.sin(i / 4) * 60 - i * 3);
  if (id === 'binancecoin') return series(60, (i) => 570 + Math.cos(i / 5) * 6 + i * 0.2);
  if (id === 'solana') return series(60, (i) => 140 + Math.sin(i / 6) * 4 + i * 0.2);
  if (id === 'jupiter-exchange-solana') return series(60, (i) => 0.88 + Math.sin(i / 5) * 0.02 + i * 0.0006);
  if (id === 'bonk') return series(60, (i) => 0.00002 * (1 + Math.sin(i / 4) * 0.08));
  return series(60, (i) => 62_000 + Math.sin(i / 5) * 900 + i * 55);
};

function Wrap({ children }) {
  return (
    <TelegramProvider>
      <WalletProvider>
        <HashRouter>{children}</HashRouter>
      </WalletProvider>
    </TelegramProvider>
  );
}

function stubFetch() {
  const res = (body, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
  });

  const coins = [btc, eth, bnb, sol, jup, bonk];

  return async (url, opts = {}) => {
    const u = String(url);
    const method = String(opts?.method || 'GET').toUpperCase();

    if (u.includes('/signals/why')) return res({ schema: 'fbt.signal-why.v1', source: 'local', providers: [], conclusion: 'ok' });
    if (u.includes('/signals/solana/radar')) return res({ dataStatus: 'unavailable', tokens: [] });
    if (u.includes('/signals/pulse')) return res(livePulse);
    if (u.includes('/v1/smart-money/')) return res({ dataStatus: 'live', metrics: {}, tokenActivity: [] });
    if (u.includes('/perp/markets')) return res({ assets: [] });
    if (u.includes('/solana/intel/')) return res({ configured: false });
    if (u.includes('/ai/status')) return res({ enabled: false, providers: [] });
    if (u.includes('/ai/brief')) return res({});
    if (u.includes('/ai/outlook')) return res({});
    if (method === 'POST') return res({ ok: true });

    const chartMatch = /\/chart\/([^/?#]+)/.exec(u);
    if (chartMatch) return res(chartFor(decodeURIComponent(chartMatch[1])));
    if (u.includes('/ohlc/')) return res([]);
    const coinMatch = /\/coin\/([^/?#]+)/.exec(u);
    if (coinMatch) {
      const found = coins.find((c) => c.id === decodeURIComponent(coinMatch[1]));
      return res(found ?? btc);
    }
    if (u.includes('/global')) {
      return res({ mcap: 2.3e12, volume: 9.1e10, mcapChange: 1.4, btcDominance: 55.8, ethDominance: 16.2, coins: 13_000, markets: 900 });
    }
    if (u.includes('/markets')) return res(coins);
    return res({});
  };
}

async function settle(ms = 40) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

/** Live mode talks to a real server over the network, so every wait grows. */
let LIVE_MULT = 1;
const dwell = (ms) => ms * LIVE_MULT;

/** The crash card renders `crash.*` keys; their presence IS the bug. */
const crashed = (text) => /crash\.(title|body|stillBrokenTitle|stillBrokenBody)/.test(text);

async function pickOption(container, check, label, symbol) {
  /* Open the picker the way a user does — tap the trigger. */
  const trigger = container.querySelector('[data-testid="signals-token-picker"] .modern-select-trigger');
  check(`${label}: the picker trigger exists`, Boolean(trigger));
  if (!trigger) return false;
  await act(async () => { trigger.click(); });
  await settle(dwell(40));

  /* The sheet renders into the same document; find the option by symbol. */
  const options = [...document.querySelectorAll('.modern-select-option')];
  const target = options.find((o) => o.textContent?.includes(symbol));
  check(`${label}: the ${symbol} option is listed (${options.length} options)`, Boolean(target));
  if (!target) {
    /* Close the sheet again so the next step starts clean. */
    const backdrop = document.querySelector('.sheet-backdrop, [class*="backdrop"]');
    if (backdrop) await act(async () => { backdrop.click(); });
    await settle(dwell(40));
    return false;
  }

  /* THE interaction under test: choose a different token. */
  await act(async () => { target.click(); });
  /* Let the new chart/coin fetches land, the scan animation run out and the
     card rebuild — this is where the reported crash used to fire. */
  await settle(dwell(1400));
  return true;
}

/* `live:true` skips the fetch stub and runs against whatever fetch resolves —
   the real dev server API — so the probe can be pointed at genuine upstream
   shapes without touching the deterministic default. */
export async function run(container, { live = false } = {}) {
  LIVE_MULT = live ? 8 : 1;
  const out = [];
  const errors = [];
  const check = (name, ok) => out.push([name, Boolean(ok)]);

  const realError = console.error;
  console.error = (...a) => {
    const s = String(a[0] ?? '');
    if (s.includes('useLayoutEffect') || s.includes('act(') || s.includes('not wrapped')) return;
    if (s.includes('Not implemented')) return;
    if (s.includes('ReactDOMTestUtils.act') || s.includes('is deprecated')) return;
    if (s.includes('React Router Future Flag')) return;
    errors.push(s);
  };

  const realFetch = globalThis.fetch;
  let reloads = 0;

  try {
    if (!live) globalThis.fetch = stubFetch();
    clearApiCache();
    const root = createRoot(container);
    let threw = null;

    try {
      await act(async () => {
        root.render(
          <Wrap>
            <RouteBoundary t={(k) => k} reload={() => { reloads += 1; }}>
              <Routes>
                <Route path="*" element={<Signals />} />
              </Routes>
            </RouteBoundary>
          </Wrap>
        );
      });
      await settle(dwell(120));

      const text0 = (container.textContent || '').replace(/\s+/g, ' ');
      check('initial paint: no crash', !crashed(text0) && reloads === 0);
      check('initial paint: selected card rendered', container.querySelectorAll('.sic-card').length === 1);

      /* ── 1. the global tab: pick ETH ──────────────────────────────────── */
      const beforeEth = errors.length;
      if (await pickOption(container, check, 'global tab → ETH', 'ETH')) {
        const text = (container.textContent || '').replace(/\s+/g, ' ');
        const pickerText = container.querySelector('[data-testid="signals-token-picker"]')?.textContent || '';
        check('global tab → ETH: no crash after selecting the token', !crashed(text) && reloads === 0);
        check('global tab → ETH: no React error was logged', errors.length === beforeEth);
        check('global tab → ETH: the picker now shows ETH', pickerText.includes('ETH'));
        check('global tab → ETH: the focus card survived the selection', container.querySelectorAll('.sic-card').length === 1);
        check('global tab → ETH: the trend chart box is present', Boolean(container.querySelector('.sic-trend-chart')));

        /* ── the chart-box header: one tiny direction mark, nothing else ──
           Reported: two oversized icons around the price trend — the old 📈
           line-chart glyph before the title and a stretched arrow after it.
           The glyph must be GONE, the arrow must be the only svg in the
           header, and it must carry its tiny pinned size (not the 100% x 82px
           the generic `.sic-trend-chart svg` rule once forced on it). */
        const trendBox = container.querySelector('.sic-trend-chart');
        const headSvgs = trendBox ? [...trendBox.querySelectorAll('.sic-trend-head svg')] : [];
        check('trend chart: the line-chart glyph is removed', !trendBox || !trendBox.querySelector('.sic-trend-icon'));
        check('trend chart: exactly one icon in the header (the direction arrow)', headSvgs.length === 1);
        const arrow = trendBox?.querySelector('.sic-trend-arrow');
        check('trend chart: the arrow is tiny (<= 9px)', Boolean(arrow) && Number(arrow.getAttribute('width')) <= 9 && Number(arrow.getAttribute('height')) <= 9);
        check('trend chart: the plot svg is scoped by its own class', Boolean(trendBox?.querySelector('svg.sic-trend-plot')));
      }

      /* ── 2. the global tab again: pick BNB (a second switch) ──────────── */
      const beforeBnb = errors.length;
      if (await pickOption(container, check, 'global tab → BNB', 'BNB')) {
        const text = (container.textContent || '').replace(/\s+/g, ' ');
        const pickerText = container.querySelector('[data-testid="signals-token-picker"]')?.textContent || '';
        check('global tab → BNB: no crash after selecting the token', !crashed(text) && reloads === 0);
        check('global tab → BNB: no React error was logged', errors.length === beforeBnb);
        check('global tab → BNB: the picker now shows BNB', pickerText.includes('BNB'));
        check('global tab → BNB: the focus card survived the selection', container.querySelectorAll('.sic-card').length === 1);
      }

      /* ── 3. the Solana tab: switch to a different Solana asset ────────── */
      const solTab = [...container.querySelectorAll('.sic-market-tabs button')][1];
      check('the Solana tab button exists', Boolean(solTab));
      if (solTab) {
        await act(async () => { solTab.click(); });
        await settle(dwell(1400));
        const beforeSol = errors.length;
        if (await pickOption(container, check, 'solana tab → BONK', 'BONK')) {
          const text = (container.textContent || '').replace(/\s+/g, ' ');
          const pickerText = container.querySelector('[data-testid="signals-token-picker"]')?.textContent || '';
          check('solana tab → BONK: no crash after selecting the token', !crashed(text) && reloads === 0);
          check('solana tab → BONK: no React error was logged', errors.length === beforeSol);
          check('solana tab → BONK: the picker now shows BONK', pickerText.includes('BONK'));
          check('solana tab → BONK: the focus card survived the selection', container.querySelectorAll('.sic-card').length === 1);
        }
        /* and back to SOL, the other direction */
        const beforeBack = errors.length;
        if (await pickOption(container, check, 'solana tab → SOL', 'SOL')) {
          const text = (container.textContent || '').replace(/\s+/g, ' ');
          check('solana tab → SOL: no crash after switching back', !crashed(text) && reloads === 0);
          check('solana tab → SOL: no React error was logged', errors.length === beforeBack);
        }
      }

      /* ── 4. the same flow with CORRUPTED local state already on deck ────
         A real browser is not a clean jsdom: the user's phone carries history,
         watchlist and alert rows written by older builds. A malformed row
         must never ride along into a render throw when the token changes. */
      const allTab = [...container.querySelectorAll('.sic-market-tabs button')][0];
      if (allTab) {
        await act(async () => { allTab.click(); });
        await settle(dwell(120));
      }
      window.localStorage.setItem('fbt-signal-history-v1', '{"broken":[');
      window.localStorage.setItem('fbt-signal-watch-v1', '{"ids": [null, 42, {"id": "bitcoin"}]}');
      window.localStorage.setItem('fbt-signal-alerts-v1', '[{"active": true}, {"symbol": null, "kind": 7}]');
      const beforeCorrupt = errors.length;
      if (await pickOption(container, check, 'corrupted local state → ETH', 'ETH')) {
        const text = (container.textContent || '').replace(/\s+/g, ' ');
        check('corrupted local state: selecting a token still does not crash', !crashed(text) && reloads === 0);
        check('corrupted local state: no React error was logged', errors.length === beforeCorrupt);
        check('corrupted local state: the focus card still renders', container.querySelectorAll('.sic-card').length === 1);
      }
      window.localStorage.removeItem('fbt-signal-history-v1');
      window.localStorage.removeItem('fbt-signal-watch-v1');
      window.localStorage.removeItem('fbt-signal-alerts-v1');

      check('the whole picker pass logged no console errors', errors.length === 0);
      if (errors.length) out.push(['first console error: ' + String(errors[0]).slice(0, 160), false]);

      /* ── the CSS contract behind the oversized-icons bug ──────────────────
         `.sic-trend-chart svg` once matched the small header marks too and
         stretched them to a 100% x 82px box. The rule must stay scoped to the
         plot element, and the arrow must have its own pinned tiny box. */
      const unscoped = /\.sic-trend-chart\s+svg\s*\{[^}]*width\s*:\s*100%/.test(signalsIntelCss);
      check('CSS: no unscoped `.sic-trend-chart svg` full-width rule remains', !unscoped);
      check('CSS: the full-width rule is scoped to .sic-trend-plot', /\.sic-trend-chart\s+\.sic-trend-plot\s*\{[^}]*width\s*:\s*100%/.test(signalsIntelCss));
      check('CSS: the direction arrow has a pinned small box', /\.sic-trend-arrow\s*\{[^}]*width\s*:\s*8px/.test(signalsIntelCss));
    } catch (e) {
      threw = e;
    }

    check('the picker pass renders without throwing', !threw);
    if (threw) out.push(['threw: ' + String(threw && threw.message).slice(0, 200), false]);

    try {
      await act(async () => root.unmount());
    } catch {
      /* an unmount failure is not the thing under test */
    }
    container.innerHTML = '';
  } finally {
    globalThis.fetch = realFetch;
    console.error = realError;
  }

  return out;
}
