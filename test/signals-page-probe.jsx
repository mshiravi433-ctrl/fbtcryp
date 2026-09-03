/**
 * SIGNALS PAGE — mounted with the market data it is actually built for.
 * ---------------------------------------------------------------------------
 * ─── THE BUG THIS EXISTS TO FIND ────────────────────────────────────────────
 * Reported: «صفحه سیگنال میزنه به مشکل خورد» — the Signals screen lands on the
 * "a problem occurred" card (RouteBoundary) instead of showing signals.
 *
 * The screen suite already mounts `<Signals />` and passes. It passes because
 * it mounts the page and asserts on the FIRST paint, before any poll has
 * resolved: with no coins there are no signal cards, and the card component is
 * never constructed. The whole intelligence centre — the part the screen
 * exists for — is skipped, exactly like `<CoinDetail />` with no id skipping
 * analyze()/VerdictPanel/CandleChart. See test/coindetail-probe.jsx for the
 * same gap one screen over.
 *
 * So this probe does the opposite: it serves real response shapes, waits for
 * the polls to land, and asserts that a CARD actually rendered. "Rendered
 * without an error" is worthless here unless something proves the code path
 * ran — a page that paints nothing also paints nothing wrong.
 *
 * ─── WHAT IT FOUND ──────────────────────────────────────────────────────────
 * `SignalCard` read `t` from its PROPS while every other component in the file
 * calls `useTranslation()` itself, and neither call site (the global list and
 * `SolanaSignalCard`) passed one. The first card therefore threw
 * `TypeError: t is not a function` during render — past <Suspense>, into
 * RouteBoundary, which is the reported screen. Both tabs, every language,
 * every asset: not intermittent at all once data arrives.
 *
 * ─── WHY THESE DATA SHAPES ──────────────────────────────────────────────────
 * The card path is reached from several directions and each one has its own
 * way of being thin or malformed, so each is a case:
 *
 *   • live markets + live pulse — the ordinary path, cards must render READY
 *   • pulse endpoint down — the page must fall back to computePulseLocal and
 *     still render cards (the pulse is an enhancement, never a dependency)
 *   • markets 429 / an error object / an HTML string — `usePoll` stores
 *     whatever resolves, so `coins` can be a non-array; the offline snapshot
 *     then supplies the rows and cards STILL render
 *   • empty markets — no cards, and the honest empty state instead
 *   • the Solana tab — a separate component (`SolanaSignalCard`) that computes
 *     its own signal and renders the SAME card, so it needs its own case
 *   • a flat / null-filled sparkline — analyze() and the evidence builder must
 *     not divide by zero on the way to the card
 *
 * Interactions are driven the way a user drives them (click the Why button,
 * click the alert bell, switch horizon) because a crash in a sheet or a modal
 * is invisible to a mount-only test.
 *
 * The network is stubbed at `fetch`, so every layer below (api.js → hooks →
 * page) runs its real code. Stubbing the hooks would skip exactly the parsing
 * and guarding that a data-shaped crash lives in.
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
import { CLASS, classKey } from '../src/lib/signalEngine.js';
/* Imported as modules, not read from disk: this file runs from Vite's bundle
   directory, where a relative `import.meta.url` path points nowhere. */
import LOCALE_EN from '../src/i18n/locales/en.json';
import LOCALE_FA from '../src/i18n/locales/fa.json';
import LOCALE_AR from '../src/i18n/locales/ar.json';

/* ── believable upstream rows. Overridden per case. ─────────────────────── */

/** A price series of n points shaped by f — the {t,p} shape getChart returns. */
const series = (n, f) =>
  Array.from({ length: n }, (_, i) => ({ t: Date.now() - (n - i) * 3600_000, p: f(i) }));

/** A 7-day sparkline, which is what the market row carries. */
const spark = (n, f) => Array.from({ length: n }, (_, i) => f(i));

const btc = {
  id: 'bitcoin',
  symbol: 'BTC',
  name: 'Bitcoin',
  image: null,
  rank: 1,
  price: 65_000,
  change1h: 0.4,
  change24h: 3.2,
  change7d: 8.6,
  mcap: 1.28e12,
  volume: 3.1e10,
  supply: 19_700_000,
  high24h: 66_100,
  low24h: 63_200,
  ath: 73_000,
  athChange: -11,
  sparkline: spark(60, (i) => 62_000 + Math.sin(i / 5) * 900 + i * 55),
  dataProvenance: 'live'
};

const eth = {
  ...btc,
  id: 'ethereum',
  symbol: 'ETH',
  name: 'Ethereum',
  rank: 2,
  price: 3_200,
  change24h: -2.4,
  change7d: -5.1,
  mcap: 3.8e11,
  volume: 1.4e10,
  sparkline: spark(60, (i) => 3_400 - Math.sin(i / 4) * 60 - i * 3)
};

/** A market-wide pulse in the server's own shape (fbt.signal-pulse.v1). */
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

const smartMoney = {
  dataStatus: 'live',
  metrics: {
    whaleActivity: { value: 4 },
    netFlow: { value: 1.2e8 },
    accumulation: { valueUsd: 3.4e8 },
    distribution: { valueUsd: 2.2e8 }
  },
  tokenActivity: [
    { symbol: 'BTC', netUsd: 8.1e7, signal: 'ACCUMULATION' },
    { symbol: 'ETH', netUsd: -2.2e7, signal: 'DISTRIBUTION' }
  ]
};

const radar = {
  schema: 'fbt.solana-radar.v1',
  at: Date.now(),
  dataStatus: 'live',
  limit: 10,
  tokens: [
    {
      address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
      symbol: 'BONK',
      name: 'Bonk',
      dex: 'raydium',
      ageHours: 900,
      liquidityUsd: 4.2e6,
      volumeH24: 1.1e7,
      buysH24: 900,
      sellsH24: 610,
      buyRatio: 0.6,
      fdv: 2.1e9,
      smartWallets: 4,
      opportunityScore: 68,
      riskScore: 41,
      riskLabel: 'MEDIUM',
      topHolderPct: 18,
      holderTrend: 'rising',
      whaleFlow: 'inflow',
      dexPressure: 'buy',
      flags: [],
      mintAuthority: null,
      freezeAuthority: null,
      lpLocked: null,
      honeypot: null,
      liquidityRemoval: null
    }
  ],
  coverage: { sources: ['dexscreener-pairs'], note: 'observed fields only' }
};

const whyAnswer = {
  schema: 'fbt.signal-why.v1',
  source: 'local',
  providers: [],
  technical: 'RSI is mid-range while MACD histogram is positive.',
  market: 'Turnover is healthy against the market cap.',
  onchain: 'On-chain data was unavailable for this asset.',
  sentiment: 'Market sentiment is mildly bullish.',
  conclusion: 'Measured evidence leans positive with moderate confidence.',
  agreement: 100,
  disagree: false,
  evidenceCount: 7
};

/* ── the cases ───────────────────────────────────────────────────────────── */

const CASES = [
  {
    name: 'live markets + live pulse (the ordinary path)',
    markets: [btc, eth],
    chart: series(60, (i) => 62_000 + Math.sin(i / 5) * 900 + i * 55),
    pulse: livePulse,
    expectCards: 1
  },
  {
    /*
     * The pulse endpoint is an ENHANCEMENT. When it 502s the page must fall
     * back to computePulseLocal and still render every card — a dead pulse
     * must never take the signal list with it.
     */
    name: 'pulse endpoint down → local pulse, cards still render',
    markets: [btc, eth],
    chart: series(60, (i) => 62_000 + i * 40),
    pulse: { status: 502, body: { error: 'SIGNAL_PULSE_UNAVAILABLE', detail: 'upstream' } },
    expectCards: 1
  },
  {
    /*
     * CoinGecko's public tier answers 429 with a JSON OBJECT, and usePoll
     * stores whatever resolves. getMarkets then falls back to the offline
     * snapshot — which carries sparklines — so cards render anyway. This is
     * the «بعضی اوقات» shape: the same screen works, then does not, then works.
     */
    name: 'a 429 object instead of the markets array',
    markets: { status: 429, body: { status: { error_code: 429, error_message: 'rate limited' } } },
    chart: series(60, (i) => 62_000 + i * 40),
    pulse: livePulse,
    expectCards: 'any'
  },
  {
    name: 'an HTML string from a captive portal instead of markets',
    markets: { status: 200, body: '<html><body>blocked by proxy</body></html>', html: true },
    chart: series(60, (i) => 62_000 + i * 40),
    pulse: livePulse,
    expectCards: 'any'
  },
  {
    /*
     * Our OWN API saying the upstream is down — the shape this page sees in a
     * sandbox or during a CoinGecko outage: /api/markets answers 502
     * {"error":"UPSTREAM_FAILED"}, getMarkets falls back to the bundled
     * snapshot and tags it `dataProvenance:'offline'`, and computePulseLocal
     * then reports `source:'offline'`. That is the path whose locale key was
     * missing, so the case asserts the copy as well as the survival.
     */
    name: 'our API 502s (upstream down) → offline snapshot, cards still render',
    markets: { status: 502, body: { error: 'UPSTREAM_FAILED', detail: 'fetch failed' } },
    chart: { status: 502, body: { error: 'UPSTREAM_FAILED', detail: 'fetch failed' } },
    global: { status: 502, body: { error: 'UPSTREAM_FAILED', detail: 'fetch failed' } },
    pulse: { status: 502, body: { error: 'SIGNAL_PULSE_UNAVAILABLE', detail: 'fetch failed' } },
    expectCards: 'any'
  },
  {
    /* Genuinely nothing to show: the honest empty state, not a crash. */
    name: 'empty markets → no cards, honest empty state',
    markets: [],
    chart: [],
    pulse: livePulse,
    expectCards: 0
  },
  {
    /*
     * A dead stablecoin: every point identical. Any (hi - lo) denominator is
     * zero and any percentile over a zero-width range is NaN, on the way into
     * the very same card component.
     */
    name: 'a perfectly flat sparkline (pegged or halted asset)',
    markets: [{ ...btc, sparkline: spark(60, () => 1), price: 1 }],
    chart: series(60, () => 1),
    pulse: livePulse,
    expectCards: 'any'
  },
  {
    /* CoinGecko emits nulls for gaps; Number(null) is 0 and 0 is finite. */
    name: 'a sparkline containing nulls',
    markets: [{ ...btc, sparkline: spark(60, (i) => (i % 6 === 0 ? null : 60_000 + i * 30)) }],
    chart: series(60, (i) => (i % 6 === 0 ? null : 60_000 + i * 30)),
    pulse: livePulse,
    expectCards: 'any'
  },
  {
    /* Market rows whose numbers arrived as strings from a proxy. */
    name: 'coin fields that are strings instead of numbers',
    markets: [{ ...btc, price: '65000', volume: 'N/A', change24h: '3.2', mcap: null }],
    chart: series(60, (i) => 62_000 + i * 40),
    pulse: livePulse,
    expectCards: 'any'
  }
];

/** The Solana tab: a different component, the same card at the bottom. */
const SOLANA_CASE = {
  name: 'the Solana tab (its own card component)',
  markets: [{ ...btc, id: 'solana', symbol: 'SOL', name: 'Solana', price: 148, change24h: 4.1, change7d: 9.2, sparkline: spark(60, (i) => 140 + Math.sin(i / 6) * 4 + i * 0.2) }],
  chart: series(60, (i) => 140 + Math.sin(i / 6) * 4 + i * 0.2),
  coin: { id: 'solana', symbol: 'SOL', name: 'Solana', price: 148, change24h: 4.1, change7d: 9.2, mcap: 6.8e10, volume: 3.1e9 },
  pulse: livePulse,
  radar,
  intel: { configured: false }
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

/** Build the stubbed fetch for one case. */
function stubFetch(c) {
  const res = (body, status = 200, html = false) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => (html ? 'text/html' : 'application/json') },
    json: async () => {
      if (html) throw new SyntaxError('Unexpected token < in JSON');
      return body;
    },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
  });

  /** A case entry may be a value, or {status, body, html} for a bad response. */
  const out = (v, fallbackBody) => {
    if (v && typeof v === 'object' && !Array.isArray(v) && 'status' in v) {
      return res(v.body ?? fallbackBody, v.status, v.html);
    }
    return res(v === undefined ? fallbackBody : v);
  };

  return async (url, opts = {}) => {
    const u = String(url);
    const method = String(opts?.method || 'GET').toUpperCase();

    if (u.includes('/signals/why')) return res(whyAnswer);
    if (u.includes('/signals/solana/radar')) return out(c.radar, { dataStatus: 'unavailable', tokens: [] });
    if (u.includes('/signals/pulse')) return out(c.pulse, livePulse);
    if (u.includes('/v1/smart-money/')) return out(c.smartMoney, smartMoney);
    if (u.includes('/perp/markets')) return res({ assets: [] });
    if (u.includes('/solana/intel/')) return out(c.intel, { configured: false });
    if (u.includes('/ai/status')) return res({ enabled: false, providers: [] });
    if (u.includes('/ai/brief') || u.includes('/ai/outlook')) return res({});
    if (method === 'POST') return res({ ok: true });

    if (u.includes('/chart/')) return out(c.chart, series(60, (i) => 100 + i));
    if (u.includes('/ohlc/')) return res([]);
    if (u.includes('/coin/')) return out(c.coin, c.markets?.[0] ?? btc);
    if (u.includes('/global')) {
      return out(c.global, { mcap: 2.3e12, volume: 9.1e10, mcapChange: 1.4, btcDominance: 55.8, ethDominance: 16.2, coins: 13_000, markets: 900 });
    }
    if (u.includes('/markets')) return out(c.markets, [btc, eth]);
    return res({});
  };
}

/**
 * Text that proves a translation function ran, not that a key was printed.
 * Returns the offending fragment so a failure names the missing key instead of
 * just saying "something is wrong" — an untranslated screen is a locale gap,
 * and which key is missing is the whole report.
 *
 * The pattern needs TWO dots. A single-dot pattern matches ordinary prose:
 * the page's own subtitle ends with "Signals. Only measured evidence…", and a
 * test that fails on its own product's copy teaches the next person to delete
 * the assertion. `namespace.group.key` is what i18next echoes back for a key
 * it could not resolve, and no sentence in any of the twelve locales looks
 * like that.
 */
const rawKeyIn = (s) => {
  const m = /\b[a-z][\w-]*\.[a-z][\w-]*\.[a-zA-Z][\w-]*\b/.exec(s || '');
  if (m) return m[0];
  const e = /\bis not a function\b|\bCannot read properties of\b/i.exec(s || '');
  return e ? e[0] : null;
};

async function settle(ms = 40) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

export async function run(container) {
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
    /* ── the data cases, one mount each ─────────────────────────────────── */
    for (const c of CASES) {
      globalThis.fetch = stubFetch(c);
      /* api.js memoizes per key for 30s; without this the previous case's
         response would be served and the case would prove nothing. */
      clearApiCache();
      const before = errors.length;
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
        /* Let every poll land and the cards render. This wait is the whole
           point of the file: the screen suite asserts before it. */
        await settle(60);
      } catch (e) {
        threw = e;
      }

      const cards = container.querySelectorAll('.sic-card');
      const text = (container.textContent || '').replace(/\s+/g, ' ');
      const boundaryFired = /crash\.(title|updateTitle|body)/.test(text);

      check(`${c.name}: page renders without throwing`, !threw);
      check(`${c.name}: no React error was logged`, errors.length === before);
      check(`${c.name}: the route boundary did not catch a crash`, !boundaryFired && reloads === 0);

      if (c.expectCards === 0) {
        check(`${c.name}: no card is invented when there is no data`, cards.length === 0);
      } else {
        /* The assertion that makes every other line above meaningful. */
        const wanted = typeof c.expectCards === 'number' ? c.expectCards : 1;
        check(
          `${c.name}: selected signal card rendered without duplicate token cards (${cards.length})`,
          typeof c.expectCards === 'number' ? cards.length === wanted : cards.length >= wanted
        );
        const raw = rawKeyIn(text);
        check(`${c.name}: card copy is translated, not a raw key${raw ? ` (found "${raw}")` : ''}`, !raw);
      }

      if (threw) errors.push(`${c.name}: ${threw.message}`);
      try {
        await act(async () => root.unmount());
      } catch {
        /* an unmount failure is not the thing under test */
      }
      container.innerHTML = '';
    }

    /* ── the Solana tab, reached by clicking the way a user does ────────── */
    {
      const c = SOLANA_CASE;
      globalThis.fetch = stubFetch(c);
      clearApiCache();
      const before = errors.length;
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
        await settle(60);
        const solTab = [...container.querySelectorAll('.sic-market-tabs button')][1];
        check('the Solana tab button exists', Boolean(solTab));
        if (solTab) {
          await act(async () => { solTab.click(); });
          await settle(60);
        }
      } catch (e) {
        threw = e;
      }
      const text = (container.textContent || '').replace(/\s+/g, ' ');
      check(`${c.name}: renders without throwing`, !threw);
      check(`${c.name}: no React error was logged`, errors.length === before);
      check(`${c.name}: the route boundary did not catch a crash`, !/crash\.(title|body)/.test(text));
      const rawSol = rawKeyIn(text);
      check(`${c.name}: its cards render translated copy${rawSol ? ` (found "${rawSol}")` : ''}`, !rawSol);
      if (threw) errors.push(`${c.name}: ${threw.message}`);
      try {
        await act(async () => root.unmount());
      } catch {
        /* an unmount failure is not the thing under test */
      }
      container.innerHTML = '';
    }

    /* ── every dynamic key the page can build resolves to real copy ─────────
       Two of these were broken and both were invisible to a source grep,
       because the key is assembled at render time from a value the ENGINE
       produces:

         · the card badge lowercased the CLASS constant, so STRONG_BUY asked
           for `signals.intel.class.strong_buy` and HIGH_RISK for `.high_risk`
           — keys in no locale. i18next echoes an unresolved key back, so the
           two loudest signals on the screen read as their own dictionary path.
         · `computeEarlySignals` can flag `momentumDecel` and `buildEvidence`
           can reason `holderSpread`, and neither had a translation, so the
           early-signal row and the evidence chip printed the raw key.
         · `computePulseLocal` reports `source:'offline'` when the market rows
           came from the bundled snapshot — exactly the state a rate-limited
           or dead upstream produces — and `signals.intel.source.offline` did
           not exist either.

       Each list below is the set a real code path emits (the source is named
       per group), not a guess: a guessed list produces a test that fails on
       keys nothing ever asks for and passes on the ones that are missing. */
    {
      const LOCALES = [['en', LOCALE_EN], ['fa', LOCALE_FA], ['ar', LOCALE_AR]];
      const at = (dict, key) => key.split('.').reduce((o, k) => (o == null ? o : o[k]), dict);

      /* CLASS_META is the mapping the page now uses; assert it too, so a new
         class added to the engine cannot ship without a label. */
      const groups = [
        ['signals.intel.class', Object.values(CLASS).map((c) => classKey(c).split('.').pop())],
        /* src/lib/signalEngine.js computeEarlySignals → EarlySection */
        ['signals.intel.early', ['momentumAccel', 'momentumDecel', 'holderGrowth', 'whaleInflow', 'whaleOutflow', 'dexBuy', 'dexSell', 'smartMoneyAccum', 'smartMoneyDistrib', 'volumeTurnover']],
        ['signals.intel.early.direction', ['earlyBullish', 'earlyBearish', 'earlyWatch']],
        /* src/lib/signalEngine.js buildEvidence → EvidenceChips */
        ['signals.intel.early', ['momentum24Up', 'momentum24Down', 'trend7dUp', 'trend7dDown', 'rsiOversold', 'rsiOverbought', 'rsiNeutral', 'macdUp', 'macdDown', 'maBullish', 'maBearish', 'aboveMa20', 'belowMa20', 'bollingerLow', 'bollingerHigh', 'bollingerMid', 'liquidityActive', 'liquidityThin', 'holderSpread', 'marketSentimentUp', 'marketSentimentDown']],
        /* server/signalEngine.js scoreSolanaToken → RadarSection */
        ['signals.intel.radar.flags', ['unknownOnchain', 'washTradingProxy', 'concentratedHolders', 'brandNew']],
        /* server computePulse (live / market-only / unavailable) and
           src/lib/signalEngine.js computePulseLocal (local / offline) */
        ['signals.intel.source', ['live', 'market-only', 'unavailable', 'local', 'offline']],
        ['signals.intel.status', ['live', 'offline', 'unavailable']],
        /* server/smartMoney getOverview */
        ['signals.intel.smartMoney', ['live', 'unavailable']],
        ['signals.intel.smartMoney.signal', ['ACCUMULATION', 'DISTRIBUTION']],
        /* src/lib/signalStore.js settleHistory → HistorySection */
        ['signals.intel.history.result', ['success', 'failed', 'flat', 'pending']],
        /* src/lib/signalEngine.js portfolioImpact → PortfolioCard */
        ['signals.intel.portfolio', ['high', 'medium', 'low', 'yes', 'no']],
        ['signals.intel.portfolio.notes', ['highExposure', 'highConcentration', 'existingPositionUp', 'noExistingPosition', 'balanced']],
        /* measured labels the card and the pulse render */
        ['signals.intel.riskLabel', ['low', 'medium', 'high']],
        ['signals.intel.momentumLabel', ['flat', 'moderate', 'strong']],
        ['signals.intel.volLabel', ['low', 'moderate', 'high']],
        ['signals.intel.liquidityLabel', ['strong', 'adequate', 'thin']],
        ['signals.intel.sentimentLabel', ['bullish', 'bearish', 'neutral']],
        ['signals.intel.horizonRisk', ['low', 'medium', 'high']],
        ['signals.intel.direction', ['up', 'down', 'flat']],
        ['signals.intel.why', ['technical', 'market', 'onchain', 'sentiment', 'conclusion']],
        /* src/lib/ai.js analyze() → IndicatorBar / Gauge */
        ['signals.ind', ['rsi', 'macd', 'bollinger', 'ma20', 'cross', 'momentum']],
        ['signals.label', ['strongBuy', 'buy', 'neutral', 'sell', 'strongSell']],
        /* src/lib/macro.js marketRegime() */
        ['signals.regime', ['riskOn', 'btcLed', 'rotationOut', 'riskOff']],
        /* server/solanaIntel.js → the on-chain row */
        ['signals.onchain.flow', ['inflow', 'outflow', 'mixed']],
        ['signals.onchain.trend', ['rising', 'falling']],
        ['signals.onchain.pressure', ['buy', 'sell', 'balanced']],
        /* src/lib/verdict.js layers, rendered in the detail lab */
        ['verdict.layerName', ['technical', 'historical', 'structural', 'macro', 'derivatives']]
      ];

      const missing = [];
      for (const [lang, dict] of LOCALES) {
        for (const [prefix, values] of groups) {
          for (const v of values) {
            const value = at(dict, `${prefix}.${v}`);
            if (typeof value !== 'string' || !value.trim()) missing.push(`${lang}:${prefix}.${v}`);
          }
        }
      }
      check(
        `every dynamic key the page builds resolves in ${LOCALES.map(([l]) => l).join('/')}`
          + ` (${groups.reduce((n, g) => n + g[1].length, 0) * LOCALES.length} lookups, ${missing.length} missing${missing.length ? ': ' + missing.slice(0, 6).join(', ') : ''})`,
        missing.length === 0
      );
      check(
        'Global and Solana signal tabs are genuinely localized in Persian',
        /[\u0600-\u06ff]/.test(LOCALE_FA.signals.allTab)
          && /[\u0600-\u06ff]/.test(LOCALE_FA.signals.solanaTab)
          && !/Global\s+Signals|Solana\s+Signals/i.test(`${LOCALE_FA.signals.allTab} ${LOCALE_FA.signals.solanaTab}`)
      );
      check(
        'removed performance and portfolio-AI copy is deleted from every locale',
        LOCALES.every(([, locale]) => !locale.signals.intel.performance && !locale.signals.intel.portfolio.consentTitle)
      );

      /* And the fallback: an unknown or null class must not throw. */
      check('an unknown classification falls back instead of throwing', classKey(null) === classKey('WATCH') && classKey('NOPE') === classKey('WATCH'));
    }

    /* ── the interactions behind the card: Why · alert · horizon ────────── */
    {
      const c = CASES[0];
      globalThis.fetch = stubFetch(c);
      clearApiCache();
      const before = errors.length;
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
        await settle(920);

        const card = container.querySelector('.sic-card');
        check('exactly one selected-token card is present', Boolean(card) && container.querySelectorAll('.sic-card').length === 1);
        const picker = container.querySelector('.sic-token-select-shell select');
        check('global signals default to Bitcoin', picker?.value === 'bitcoin');

        const pulseToggle = container.querySelector('.sic-pulse-toggle');
        check('AI market pulse starts collapsed', pulseToggle?.getAttribute('aria-expanded') === 'false' && !container.querySelector('#sic-pulse-content'));
        if (pulseToggle) {
          await act(async () => { pulseToggle.click(); });
          await settle(30);
        }
        check('AI market pulse expands in place', pulseToggle?.getAttribute('aria-expanded') === 'true' && Boolean(container.querySelector('#sic-pulse-content')));

        const hubToggle = container.querySelector('.sic-hub-toggle');
        check('supporting signal center starts collapsed', hubToggle?.getAttribute('aria-expanded') === 'false');
        if (hubToggle) {
          await act(async () => { hubToggle.click(); });
          await settle(30);
        }
        const verticalRail = container.querySelector('.sic-tab-rail[aria-orientation="vertical"]');
        check('expanded signal center has five vertical tabs', verticalRail?.querySelectorAll('[role="tab"]').length === 5);
        check('only one intelligence panel is shown at a time', container.querySelectorAll('.sic-hub-panel[role="tabpanel"]').length === 1);
        check('removed performance and portfolio-AI panels stay absent', !/AI SIGNAL PERFORMANCE|Portfolio-aware AI|عملکرد سیگنال هوش مصنوعی|هوش مصنوعی آگاه از پرتفوی/.test(container.textContent || ''));

        /* AI analysis is a sibling tab inside the one selected-token box. */
        const detailTabs = [...container.querySelectorAll('.sic-detail-tabs button')];
        check('signal breakdown and AI analysis are two compact detail tabs', detailTabs.length === 2);
        if (detailTabs[1]) {
          await act(async () => { detailTabs[1].click(); });
          await settle(30);
        }
        const horizonBtns = [...container.querySelectorAll('.sic-horizon-tabs button')];
        if (horizonBtns.length === 2) {
          await act(async () => { horizonBtns[1].click(); });
          await settle(30);
          await act(async () => { horizonBtns[0].click(); });
          await settle(30);
        }
        check('switching AI horizon does not throw', true);

        /* The alert bell opens AlertSheet; the star toggles the watchlist. */
        const cardBtns = card ? [...card.querySelectorAll('button')] : [];
        const alertBtn = cardBtns.find((b) => /alert|هشدار|تنبيه/i.test(`${b.textContent} ${b.getAttribute('aria-label') || ''}`));
        if (alertBtn) {
          await act(async () => { alertBtn.click(); });
          await settle(30);
          check('the alert sheet opens', Boolean(document.body.textContent.match(/alert|هشدار|تنبيه/i)));
          /* Close it again so the next step starts from a clean tree. */
          const back = [...document.body.querySelectorAll('button')].find((b) => /close|بستن|إغلاق|✕|×/i.test(`${b.textContent} ${b.getAttribute('aria-label') || ''}`));
          if (back) {
            await act(async () => { back.click(); });
            await settle(20);
          }
        }

        /* "Why this signal?" — the multi-AI explanation path end to end. */
        const whyBtn = cardBtns.find((b) => /why|چرا|لماذا/i.test(b.textContent));
        check('the Why button is wired on a READY card', Boolean(whyBtn));
        if (whyBtn) {
          await act(async () => { whyBtn.click(); });
          await settle(60);
          const body = (document.body.textContent || '').replace(/\s+/g, ' ');
          check('the Why panel opens and shows an explanation', /conclusion|technical|Measured|RSI|نتیجه/i.test(body));
        }
      } catch (e) {
        threw = e;
      }
      check('the interaction pass renders without throwing', !threw);
      check('the interaction pass logs no React error', errors.length === before);
      if (threw) errors.push(`interactions: ${threw.message}`);
      try {
        await act(async () => root.unmount());
      } catch {
        /* an unmount failure is not the thing under test */
      }
      container.innerHTML = '';
    }
  } finally {
    globalThis.fetch = realFetch;
    console.error = realError;
  }

  if (errors.length) {
    out.push([`no console errors (first: ${errors[0].slice(0, 160)})`, false]);
  } else {
    out.push(['no console errors', true]);
  }

  return out;
}

export default run;
