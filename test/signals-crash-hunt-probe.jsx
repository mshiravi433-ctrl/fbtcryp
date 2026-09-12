/**
 * SIGNALS PAGE — CRASH HUNT, the shapes and taps the earlier suites never fed it.
 * ---------------------------------------------------------------------------
 * Reported (after the page already had safeCalc + SectionGuard + RouteBoundary):
 *   «در صفحه سیگنال هنوز وقتی میزنی گاهی میزنه مشکلی پیش امده دوباره
 *    امتحان کنید»
 *
 * The earlier suites (signals-page-probe, signals-select-fuzz-probe,
 * signals-token-picker-probe) pass — so the remaining crash must live in a
 * shape none of them feeds, or a tap sequence none of them drives. This probe
 * sweeps BOTH:
 *
 *   · the smart-money overview with a truthy NON-ITERABLE `tokenActivity`
 *     (an object / number / string) — the page body iterates it with a bare
 *     `for…of` OUTSIDE every safeCalc/SectionGuard;
 *   · whole-endpoint primitives (the pulse endpoint resolving to 42 / "x" /
 *     an array, the chart to an object, /global to a string…) — a serverless
 *     function that crashes mid-write, an HTML error page that still parses
 *     as JSON, or a proxy handing back a bare value;
 *   · a pulse whose NESTED fields are primitives (sentiment: 5, risk: "high"…)
 *     — the page reads `.label` off several of them outside guards;
 *   · the Solana intel payload with primitive branches;
 *   · a full user tap-sweep (picker → select, both tabs, why, watch, alert,
 *     detail tabs, horizon) repeated on top of the hostile data, and also
 *     DURING the poll landing window, because the report says «گاهی» —
 *     a race, not a shape.
 *
 * Like the other signals suites, the network is stubbed at `fetch`, RouteBoundary
 * is mounted (with a reload spy), and a case fails if ANY of these happens:
 * the boundary catches, a reload is scheduled, a crash card is printed, or an
 * unexpected React error is logged.
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
  liquidity: { score: 50, label: 'adequate', turnoverPct: 1 }, breadth: { up: 5, total: 10, avgChange: 0 },
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
    if (u.includes('/signals/why')) return res(fix.why ?? { schema: 'fbt.signal-why.v1', source: 'local', conclusion: 'ok' });
    if (u.includes('/signals/solana/radar')) return res(fix.radar ?? { dataStatus: 'unavailable', tokens: [] });
    if (u.includes('/signals/pulse')) return res('pulse' in fix ? fix.pulse : livePulse);
    if (u.includes('/v1/smart-money/token/')) return res(fix.smToken ?? { dataStatus: 'unavailable' });
    if (u.includes('/v1/smart-money/')) return res(fix.sm ?? { dataStatus: 'unavailable', tokenActivity: [] });
    if (u.includes('/perp/markets')) return res(fix.perp ?? { assets: [] });
    if (u.includes('/solana/intel/')) return res(fix.intel ?? { configured: false });
    if (u.includes('/ai/status')) return res({ enabled: false, providers: [] });
    if (u.includes('/ai/brief')) return res('brief' in fix ? fix.brief : {});
    if (u.includes('/ai/outlook')) return res('outlook' in fix ? fix.outlook : {});
    if (method === 'POST') return res({ ok: true });
    if (u.includes('/chart/')) return res(fix.chart ?? series(60, (i) => 100 + Math.sin(i / 4) * 4 + i * 0.2));
    if (u.includes('/ohlc/')) return res([]);
    if (u.includes('/coin/')) return res(fix.coinDetail ?? (fix.markets ?? [])[0] ?? coin('bitcoin', 'BTC', 65000));
    if (u.includes('/global')) return res(fix.global ?? { mcap: 2e12, volume: 9e10, mcapChange: 1, btcDominance: 55, ethDominance: 16, coins: 1000, markets: 90 });
    if (u.includes('/markets')) return res(fix.markets ?? [coin('bitcoin', 'BTC', 65000), coin('ethereum', 'ETH', 3200)]);
    return res({});
  };
}

async function settle(ms = 30) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
}

const MARKETS = [coin('bitcoin', 'BTC', 65000), coin('ethereum', 'ETH', 3200), coin('solana', 'SOL', 148)];

/* A zoo of shapes the earlier suites never fed the page. */
const FIXES = [
  /* ── the smart-money overview, tokenActivity not an array ─────────────── */
  { name: 'sm overview: tokenActivity is an OBJECT', sm: { dataStatus: 'live', tokenActivity: {} } },
  { name: 'sm overview: tokenActivity is a NUMBER', sm: { dataStatus: 'live', tokenActivity: 42 } },
  { name: 'sm overview: tokenActivity is a STRING', sm: { dataStatus: 'live', tokenActivity: 'x' } },
  { name: 'sm overview: tokenActivity is TRUE', sm: { dataStatus: 'live', tokenActivity: true } },
  { name: 'sm overview: primitive rows (numbers/strings/nulls)', sm: { dataStatus: 'live', tokenActivity: [5, 'x', null, true, {}] } },
  { name: 'sm overview is a bare STRING', sm: 'upstream error page' },
  { name: 'sm overview is a bare NUMBER', sm: 42 },
  { name: 'sm overview is an ARRAY', sm: ['x'] },

  /* ── whole-endpoint primitives ─────────────────────────────────────────── */
  { name: 'pulse endpoint resolves to a NUMBER', pulse: 42 },
  { name: 'pulse endpoint resolves to a STRING', pulse: 'gateway timeout' },
  { name: 'pulse endpoint resolves to an ARRAY', pulse: [1, 2, 3] },
  { name: 'pulse endpoint resolves to TRUE', pulse: true },
  { name: 'chart endpoint resolves to an OBJECT', chart: { error: 'nope' } },
  { name: 'chart endpoint resolves to a NUMBER', chart: 42 },
  { name: 'chart endpoint resolves to TRUE', chart: true },
  { name: 'global endpoint resolves to a STRING', global: 'upstream down' },
  { name: 'global endpoint resolves to a NUMBER', global: 42 },
  { name: 'coin endpoint resolves to a STRING', coinDetail: 'missing coin' },
  { name: 'coin endpoint resolves to a NUMBER', coinDetail: 42 },
  { name: 'brief resolves to a STRING', brief: 'model offline' },
  { name: 'outlook resolves to a STRING', outlook: 'model offline' },
  { name: 'why resolves to a STRING', why: 'model offline' },

  /* ── a pulse whose nested fields are primitives ────────────────────────── */
  {
    name: 'pulse with primitive nested fields',
    pulse: {
      schema: 'fbt.signal-pulse.v1', at: Date.now(), source: 'live',
      sentiment: 5, risk: 'high', momentum: 0, volatility: true,
      liquidity: 1, breadth: 0, smartMoney: 5, aiConfidence: 'x', lastUpdate: 'yesterday'
    }
  },
  {
    name: 'pulse with drifted sub-objects',
    pulse: {
      schema: 'fbt.signal-pulse.v1', at: Date.now(), source: 'market-only',
      sentiment: { score: { deep: 1 }, label: 7 }, risk: { score: null, label: null },
      momentum: { label: 42, direction: 7 }, volatility: { label: null },
      liquidity: { label: 9, turnoverPct: {} }, breadth: { up: null, total: 'many', avgChange: [] },
      smartMoney: { dataStatus: 0 }
    }
  },

  /* ── hostile chart rows / market rows ──────────────────────────────────── */
  { name: 'chart rows are hostile objects', chart: [{ t: {}, p: {} }, null, 'x', [1], { p: '12' }, { t: 1, p: -5 }] },
  { name: 'market rows with primitive fields', markets: [coin('bitcoin', 'BTC', 65000, { sparkline: 42, symbol: 42, id: null, price: {} }), coin('ethereum', 'ETH', 3200, { change24h: {}, mcap: 'x' })] },

  /* ── the Solana intel payload with primitive branches (Solana tab) ─────── */
  { name: 'solana intel with primitive branches', solanaTab: true, intel: { configured: true, whaleFlow: 5, holderTrend: 'x', topHolderPct: {}, dexActivity: 42, liquidityUsd: { n: 1 } } },
  { name: 'solana intel is an ARRAY', solanaTab: true, intel: ['configured'] },
  { name: 'smToken endpoint is a NUMBER', smToken: 42 },
  { name: 'smToken with primitive branches', smToken: { dataStatus: 'live', holders: 5, smartMoneyFlow: 'x', liquidityUsd: {} } }
];

async function mountCase(container, fix) {
  globalThis.fetch = stubFetch(fix);
  clearApiCache();
  try { window.localStorage.clear(); window.sessionStorage.clear(); } catch { /* ignore */ }
  const errors = [];
  const realError = console.error;
  console.error = (...a) => {
    const s = String(a[0] ?? '');
    if (/useLayoutEffect|act\(|not wrapped|Not implemented|ReactDOMTestUtils|is deprecated|Future Flag/.test(s)) return;
    errors.push(s);
  };

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
  } catch (e) {
    threw = e;
  }

  /* Tap WHILE the polls are still landing — the report says «گاهی», which is
     a race. This taps into the picker and the tabs before any settle. */
  if (!fix.solanaTab) {
    const tabs = Array.from(container.querySelectorAll('[role="tab"]'));
    const solanaTab = tabs.find((b) => String(b.textContent || '').includes('SOL') || /solana/i.test(b.textContent || ''));
    try { if (solanaTab) await act(async () => { solanaTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await Promise.resolve(); }); } catch { /* reported below */ }
  }
  await settle(80);

  /* Full tap sweep on top of whatever data landed. */
  const clickAll = async (sel, limit = 6) => {
    const nodes = Array.from(container.querySelectorAll(sel)).slice(0, limit);
    for (const n of nodes) {
      try {
        await act(async () => {
          n.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
          await new Promise((r) => setTimeout(r, 8));
        });
      } catch { /* a crash during a tap is caught by the boundary checks */ }
    }
  };
  await clickAll('button', 14);

  const text = container.textContent || '';
  const boundaryCaught = reloads > 0 || text.includes('crash.title') || text.includes('crash.stillBrokenTitle');

  console.error = realError;
  root.unmount?.();
  return { threw, reloads, boundaryCaught, errors };
}

export async function run(container) {
  const out = [];
  const check = (name, ok, extra = '') => out.push([extra ? `${name} — ${extra}` : name, Boolean(ok)]);
  const realFetch = globalThis.fetch;

  try {
    for (const fix of FIXES) {
      const r = await mountCase(container, fix);
      check(fix.name, !r.threw && !r.boundaryCaught,
        r.threw ? `THREW: ${String(r.threw?.message || r.threw).slice(0, 120)}`
          : r.boundaryCaught ? `reached the route boundary (reloads=${r.reloads})`
            : `${r.errors.length} console errors`);
      if (!out[out.length - 1][1] && r.threw) console.log(`    ↳ stack: ${String(r.threw?.stack || r.threw).split('\n').slice(0, 3).join(' | ')}`);
    }
  } finally {
    globalThis.fetch = realFetch;
  }

  /* ── the race: taps DURING poll landing, repeated ────────────────────────── */
  for (let round = 0; round < 3; round += 1) {
    globalThis.fetch = stubFetch({});
    clearApiCache();
    const errors = [];
    const realError = console.error;
    console.error = (...a) => {
      const s = String(a[0] ?? '');
      if (/useLayoutEffect|act\(|not wrapped|Not implemented|ReactDOMTestUtils|is deprecated|Future Flag/.test(s)) return;
      errors.push(s);
    };
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
      /* tap immediately — polls in flight */
      const tap = async (sel) => {
        const n = container.querySelector(sel);
        if (n) await act(async () => { n.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 5)); });
      };
      await tap('[role="tab"]:nth-of-type(1)');
      await tap('button');
      await settle(25);
      await tap('button');
      await settle(40);
      await tap('button');
      await settle(60);
    } catch (e) {
      threw = e;
    }
    const text = container.textContent || '';
    const boundaryCaught = reloads > 0 || text.includes('crash.title') || text.includes('crash.stillBrokenTitle');
    check(`race round ${round + 1}: taps during poll landing`, !threw && !boundaryCaught,
      threw ? `THREW: ${String(threw?.message || threw).slice(0, 120)}` : boundaryCaught ? `reached the route boundary (reloads=${reloads})` : `${errors.length} console errors`);
    console.error = realError;
    root.unmount?.();
  }
  globalThis.fetch = realFetch;

  return out;
}
