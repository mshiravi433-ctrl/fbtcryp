/**
 * FUZZ: mount the Signals page across many adversarial-but-realistic upstream
 * shapes and select tokens from the picker in each, looking for ANY throw that
 * reaches the route boundary. Exists to hunt the «با انتخاب توکن کرش میشه»
 * report when clean fixtures pass.
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

const series = (n, f) => Array.from({ length: n }, (_, i) => ({ t: Date.now() - (n - i) * 3600_000, p: f(i) }));
const spark = (n, f) => Array.from({ length: n }, (_, i) => f(i));

const base = {
  image: null, rank: 1, change1h: 0, change24h: 0, change7d: 0,
  mcap: 1e9, volume: 1e8, supply: 1e6, high24h: 1, low24h: 1, ath: 1, athChange: 0
};
const coin = (id, symbol, price, extra = {}) => ({
  ...base, id, symbol, name: symbol, price, sparkline: spark(60, (i) => price * (1 + Math.sin(i / 5) * 0.03)), ...extra
});

const livePulse = {
  schema: 'fbt.signal-pulse.v1', at: Date.now(), source: 'live',
  sentiment: { score: 50, label: 'neutral' }, risk: { score: 50, label: 'MEDIUM' },
  momentum: { score: 0, label: 'flat', direction: 'flat' }, volatility: { score: 20, label: 'low' },
  liquidity: { score: 50, label: 'ok', turnoverPct: 1 }, breadth: { up: 5, total: 10, avgChange: 0 },
  smartMoney: { dataStatus: 'live', whaleActivity: 1, netFlowUsd: 1, accumulationUsd: 1, distributionUsd: 1 }
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

function stubFetch(fix) {
  const res = (body, status = 200) => ({
    ok: status >= 200 && status < 300, status,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
  });
  return async (url, opts = {}) => {
    const u = String(url);
    const method = String(opts?.method || 'GET').toUpperCase();
    if (u.includes('/signals/why')) return res({ schema: 'fbt.signal-why.v1', source: 'local', conclusion: 'ok' });
    if (u.includes('/signals/solana/radar')) return res(fix.radar ?? { dataStatus: 'unavailable', tokens: [] });
    if (u.includes('/signals/pulse')) return res(fix.pulse ?? livePulse);
    if (u.includes('/v1/smart-money/token/')) return res(fix.smToken ?? { dataStatus: 'unavailable' });
    if (u.includes('/v1/smart-money/')) return res(fix.sm ?? { dataStatus: 'unavailable', tokenActivity: [] });
    if (u.includes('/perp/markets')) return res(fix.perp ?? { assets: [] });
    if (u.includes('/solana/intel/')) return res(fix.intel ?? { configured: false });
    if (u.includes('/ai/status')) return res({ enabled: false, providers: [] });
    if (u.includes('/ai/brief')) return res({});
    if (u.includes('/ai/outlook')) return res({});
    if (method === 'POST') return res({ ok: true });
    if (u.includes('/chart/')) return res(fix.chart ?? series(60, (i) => 100 + Math.sin(i / 4) * 4 + i * 0.2));
    if (u.includes('/ohlc/')) return res([]);
    if (u.includes('/coin/')) return res(fix.coinDetail ?? (fix.markets ?? [])[0] ?? coin('bitcoin', 'BTC', 65000));
    if (u.includes('/global')) return res(fix.global ?? { mcap: 2e12, volume: 9e10, mcapChange: 1, btcDominance: 55, ethDominance: 16, coins: 1000, markets: 90 });
    if (u.includes('/markets')) return res(fix.markets ?? [coin('bitcoin', 'BTC', 65000)]);
    return res({});
  };
}

async function settle(ms = 30) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
}

/* A zoo of shapes that really appear in the wild. */
const FIXES = [
  { name: 'tiny price (PEPE-like) + null changes', markets: [coin('bitcoin', 'BTC', 65000), coin('pepe', 'PEPE', 0.0000082, { change24h: null, change1h: null, change7d: null, high24h: null, low24h: null, mcap: null, volume: null })] },
  { name: 'string-typed numbers everywhere', markets: [coin('bitcoin', 'BTC', '65000', { change24h: '3.2', volume: 'N/A', mcap: '1200000000000', sparkline: spark(60, (i) => String(62000 + i * 5)) })] },
  { name: 'flat series (halted/pegged)', chart: series(60, () => 1), markets: [coin('usd-coin', 'USDC', 1, { sparkline: spark(60, () => 1) })] },
  { name: 'one-point series', chart: series(1, () => 100), markets: [coin('bitcoin', 'BTC', 65000, { sparkline: spark(1, () => 65000) })] },
  { name: 'empty series', chart: [], markets: [coin('bitcoin', 'BTC', 65000, { sparkline: [] })] },
  { name: 'all-null series', chart: series(60, () => null), markets: [coin('bitcoin', 'BTC', 65000, { sparkline: spark(60, () => null) })] },
  { name: 'descending series', chart: series(60, (i) => 1000 - i * 9), markets: [coin('bitcoin', 'BTC', 460, { sparkline: spark(60, (i) => 1000 - i * 9) })] },
  { name: 'zero price coin', markets: [coin('bitcoin', 'BTC', 0), coin('ethereum', 'ETH', 3200)] },
  { name: 'negative change, huge volume', markets: [coin('bitcoin', 'BTC', 65000, { change24h: -99.9, volume: 1e15, mcap: 1e18 })] },
  { name: 'solana tab with string intel', intel: { configured: true, topHolderPct: '42.5', whaleFlow: { direction: 'inflow' }, holderTrend: { change: 'rising' }, dexActivity: { pressure: 'buy' } } },
  { name: 'sm token with live holders', smToken: { dataStatus: 'live', liquidityUsd: '1234567', holders: { dataStatus: 'live', total: '88231', top10Share: '62.4', exchangeSupplyPct: '22.1' }, smartMoneyFlow: { netUsd: '-8123456', buyUsd: '100', sellUsd: '900' } } },
  { name: 'sm token with nulls', smToken: { dataStatus: 'live', liquidityUsd: null, holders: { dataStatus: 'live', total: null, top10Share: null, exchangeSupplyPct: null }, smartMoneyFlow: { netUsd: null, buyUsd: null, sellUsd: null } } },
  { name: 'perp market row matched', perp: { assets: [{ symbol: 'BTC', avgFundingApr: '12.4', openInterestUsd: '9800000000' }] } },
  { name: 'pulse with string numbers', pulse: { ...livePulse, sentiment: { score: '63', label: 'bullish' }, breadth: { up: '13', total: '20', avgChange: '1.8' } } },
  { name: 'sm overview with real-ish rows', sm: { dataStatus: 'live', metrics: {}, tokenActivity: [{ symbol: 'BTC', netUsd: '81000000', signal: 'ACCUMULATION' }, { symbol: null }, { netUsd: 'x' }] } },
  { name: 'global null everywhere', global: { mcap: null, volume: null, mcapChange: null, btcDominance: null, ethDominance: null, coins: null, markets: null } }
];

export async function run(container) {
  const out = [];
  const errors = [];
  const check = (name, ok) => out.push([name, Boolean(ok)]);
  const realError = console.error;
  console.error = (...a) => {
    const s = String(a[0] ?? '');
    if (/useLayoutEffect|act\(|not wrapped|Not implemented|ReactDOMTestUtils|is deprecated|Future Flag/.test(s)) return;
    errors.push(s);
  };
  const realFetch = globalThis.fetch;
  try {
    for (const fix of FIXES) {
      globalThis.fetch = stubFetch(fix);
      clearApiCache();
      const before = errors.length;
      let reloads = 0;
      const root = createRoot(container);
      let threw = null;
      try {
        await act(async () => {
          root.render(
            <Wrap>
              <RouteBoundary t={(k) => k} reload={() => { reloads += 1; }}>
                <Routes><Route path="*" element={<Signals />} /></Routes>
              </RouteBoundary>
            </Wrap>
          );
        });
        await settle(80);
        /* select the second option if present */
        const trigger = container.querySelector('[data-testid="signals-token-picker"] .modern-select-trigger');
        if (trigger) {
          await act(async () => { trigger.click(); });
          await settle(20);
          const options = [...document.querySelectorAll('.modern-select-option')];
          const target = options.find((o) => !o.classList.contains('is-selected'));
          if (target) {
            await act(async () => { target.click(); });
            await settle(1000);
          }
        }
        /* solana tab too */
        const solTab = [...container.querySelectorAll('.sic-market-tabs button')][1];
        if (solTab) {
          await act(async () => { solTab.click(); });
          await settle(1000);
        }
      } catch (e) { threw = e; }
      const text = (container.textContent || '').replace(/\s+/g, ' ');
      const crashed = /crash\.(title|body|stillBrokenTitle|stillBrokenBody)/.test(text) || reloads > 0;
      check(`${fix.name}: no crash (threw=${threw ? threw.message.slice(0, 60) : 'no'}, boundary=${crashed})`, !threw && !crashed);
      if (errors.length > before) check(`${fix.name}: console errors (${errors.length - before}) first=${String(errors[before]).slice(0, 100)}`, false);
      try { await act(async () => root.unmount()); } catch {}
      container.innerHTML = '';
    }
  } finally {
    globalThis.fetch = realFetch;
    console.error = realError;
  }
  return out;
}
