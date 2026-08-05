/**
 * COIN DETAIL — mounted with REAL data shapes, not just an empty one.
 * ---------------------------------------------------------------------------
 * ─── THE BUG THIS EXISTS TO FIND ────────────────────────────────────────────
 * Reported: «بعضی اوقات در هر کویین پایین صفحه که نوشته دیدن نمودار میزنم روش
 * سایت کرش میکنه و میزنه مشکلی پیش اومده» — tapping "view chart" on a coin
 * SOMETIMES crashes into the "unexpected error" screen.
 *
 * "Sometimes" is the important word. The existing render test mounts
 * `<CoinDetail />` with NO id, which takes the not-found branch and exercises
 * almost nothing. Every heavy consumer of the price series — analyze(),
 * VerdictPanel, HistoryPanel, CandleChart — is skipped entirely.
 *
 * So the page could throw on a real coin and the suite would stay green. That
 * is the same gap that let the Docs ReferenceError ship: twenty-five screens
 * covered and the crash on one of the few that were not.
 *
 * ─── WHY THE DATA SHAPES BELOW, SPECIFICALLY ────────────────────────────────
 * A crash that happens on SOME coins is a crash driven by the DATA, not by the
 * route. These are the shapes a real CoinGecko response actually produces, and
 * each one has bitten a numeric routine somewhere before:
 *
 *   • a flat series (a dead stablecoin or a halted token) → every high equals
 *     every low, so any (hi - lo) denominator is zero
 *   • a two-point series (a coin listed yesterday on the 1-day range)
 *   • a single point
 *   • an EMPTY array, which `getChart`'s offline fallback can legitimately
 *     return when the bundled snapshot has no entry for that id
 *   • nulls inside the series — CoinGecko does emit them for gaps
 *   • a zero price, which is a real state for a delisted token and a division
 *     by zero everywhere it is used as a denominator
 *   • a coin object missing most fields, which is what the market-row
 *     fallback supplies before the detail fetch resolves
 *
 * The probe stubs the network so it is deterministic and offline: this must
 * fail because the CODE is wrong, never because a CDN was slow.
 */
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { HashRouter, Route, Routes } from 'react-router-dom';
import '../src/i18n/index.js';
import { TelegramProvider } from '../src/context/TelegramContext.jsx';
import { WalletProvider } from '../src/context/WalletContext.jsx';
import CoinDetail from '../src/pages/CoinDetail.jsx';
import RouteBoundary from '../src/components/RouteBoundary.jsx';

/* A believable market row. Overridden per case. */
const baseCoin = {
  id: 'bitcoin',
  symbol: 'BTC',
  name: 'Bitcoin',
  image: '',
  rank: 1,
  price: 65000,
  change1h: 0.2,
  change24h: 1.4,
  change7d: -2.1,
  volume: 2.4e10,
  mcap: 1.2e12,
  supply: 19_700_000,
  high24h: 66000,
  low24h: 64000,
  athChange: -12.5,
  sparkline: Array.from({ length: 40 }, (_, i) => 64000 + i)
};

/** A price series with n points, shaped by `f`. */
const series = (n, f) =>
  Array.from({ length: n }, (_, i) => ({ t: Date.now() - (n - i) * 86400000, p: f(i) }));

/** Candles derived from a price series. */
const candles = (n, f) =>
  Array.from({ length: n }, (_, i) => {
    const p = f(i);
    return { t: Date.now() - (n - i) * 86400000, o: p, h: p * 1.02, l: p * 0.98, c: p };
  });

const CASES = [
  {
    name: 'a normal 90-day series',
    chart: series(90, (i) => 60000 + Math.sin(i / 6) * 4000 + i * 20),
    ohlc: candles(90, (i) => 60000 + Math.sin(i / 6) * 4000 + i * 20)
  },
  {
    /*
     * FLAT. Every price identical, which a pegged or halted token really does
     * produce. Any routine computing (hi - lo) as a denominator divides by
     * zero here, and any percentile over a zero-width range is NaN.
     */
    name: 'a perfectly flat series (halted or pegged token)',
    chart: series(90, () => 1),
    ohlc: candles(90, () => 1)
  },
  {
    name: 'a two-point series (listed yesterday)',
    chart: series(2, (i) => 100 + i),
    ohlc: candles(2, (i) => 100 + i)
  },
  { name: 'a single point', chart: series(1, () => 100), ohlc: candles(1, () => 100) },
  {
    /*
     * EMPTY. Not hypothetical: `getChart`'s offline fallback returns whatever
     * the bundled snapshot holds, and for an unknown id that is nothing.
     */
    name: 'an empty series (offline fallback with no snapshot)',
    chart: [],
    ohlc: []
  },
  {
    /*
     * NULLS INSIDE THE SERIES. CoinGecko emits these for gaps. `Number(null)`
     * is 0 and 0 is finite, so a guard checking only `Number.isFinite` lets
     * them through and turns a gap into a genuine zero price — a trap this
     * project has hit before.
     */
    name: 'a series containing nulls',
    chart: series(60, (i) => (i % 7 === 0 ? null : 500 + i)),
    ohlc: candles(60, (i) => 500 + i)
  },
  {
    name: 'a series of zero prices (delisted token)',
    chart: series(60, () => 0),
    ohlc: candles(60, () => 0),
    coin: { ...baseCoin, price: 0, high24h: 0, low24h: 0, volume: 0 }
  },
  {
    /*
     * The market-row fallback: what `coin` is before the detail fetch lands.
     * Almost every optional field is absent.
     */
    name: 'a coin object missing most fields',
    chart: series(60, (i) => 10 + i),
    ohlc: candles(60, (i) => 10 + i),
    coin: { id: 'sparse', symbol: 'SPR', name: 'Sparse' }
  },
  {
    name: 'ohlc unavailable while the line series is fine',
    chart: series(90, (i) => 200 + i),
    ohlc: []
  },
  {
    /*
     * A tiny-value token. Real: plenty of coins trade at 1e-9. Exercises the
     * price formatter and any epsilon comparison written for dollars.
     */
    name: 'a sub-cent token (1e-9 prices)',
    chart: series(90, (i) => 1e-9 * (1 + i / 100)),
    ohlc: candles(90, (i) => 1e-9 * (1 + i / 100)),
    coin: { ...baseCoin, price: 1e-9, high24h: 1.1e-9, low24h: 0.9e-9 }
  },

  /*
   * ═════════════════════════════════════════════════════════════════════════
   * THE MALFORMED-RESPONSE CASES. This is where "sometimes" comes from.
   * ═════════════════════════════════════════════════════════════════════════
   * Everything above is a WELL-FORMED array holding awkward numbers. But the
   * upstream does not always return an array at all:
   *
   *   • CoinGecko's public tier answers 429 with a JSON OBJECT
   *     ({"status":{"error_code":429,...}}) once the shared rate limit is hit
   *   • our own API answers {"error":"UPSTREAM_FAILED"} on a bad gateway
   *   • a proxy or captive portal can return an HTML string
   *
   * `usePoll` stores whatever resolves, with no type check, so `series`
   * becomes an object and `series.map(...)` throws "series.map is not a
   * function" -- straight into the crash screen.
   *
   * It is intermittent precisely because it depends on a rate limit shared
   * across every visitor and every poll, which matches «بعضی اوقات» exactly:
   * the same coin works, then does not, then works again.
   */
  {
    name: 'a 429 rate-limit object instead of an array',
    chart: { status: { error_code: 429, error_message: 'rate limited' } },
    ohlc: { status: { error_code: 429 } }
  },
  {
    name: 'an error object from our own API',
    chart: { error: 'UPSTREAM_FAILED' },
    ohlc: { error: 'UPSTREAM_FAILED' }
  },
  { name: 'a null series', chart: null, ohlc: null },
  {
    name: 'an HTML string from a proxy',
    chart: '<html>blocked</html>',
    ohlc: '<html>blocked</html>'
  },
  {
    /*
     * Well-formed array, malformed ROWS -- a bare number where a {t,p} pair
     * belongs. `d.p` is then undefined for every row.
     */
    name: 'array rows that are not objects',
    chart: [1, 2, 3, 4, 5],
    ohlc: [1, 2, 3]
  },
  {
    name: 'coin fields that are strings instead of numbers',
    chart: series(60, (i) => 10 + i),
    ohlc: candles(60, (i) => 10 + i),
    coin: { ...baseCoin, price: '65000', volume: 'N/A', supply: null, change1h: 'x' }
  }
];

function Wrap({ children }) {
  return (
    <TelegramProvider>
      <WalletProvider>
        <HashRouter>{children}</HashRouter>
      </WalletProvider>
    </TelegramProvider>
  );
}

export async function run(container) {
  const out = [];
  const errors = [];

  const realError = console.error;
  console.error = (...a) => {
    const s = String(a[0] ?? '');
    if (s.includes('useLayoutEffect') || s.includes('act(') || s.includes('not wrapped')) return;
    if (s.includes('Not implemented')) return;
    /* React 18's own deprecation notice about ReactDOMTestUtils.act. It is
       advice to the test harness, not a fault in the page under test. */
    if (s.includes('ReactDOMTestUtils.act') || s.includes('is deprecated')) return;
    /* react-router's v7 future-flag notices, same reasoning. */
    if (s.includes('React Router Future Flag')) return;
    errors.push(s);
  };

  /*
   * Stub the network at `fetch`, so every layer below (api.js -> hooks ->
   * page) runs its real code. Stubbing the hooks instead would skip exactly
   * the parsing and guarding that a data-shaped crash lives in.
   */
  const realFetch = globalThis.fetch;
  let current = CASES[0];

  globalThis.fetch = async (url) => {
    const u = String(url);
    const json = (v) => ({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => v,
      text: async () => JSON.stringify(v)
    });
    if (u.includes('/ohlc/')) return json(current.ohlc);
    if (u.includes('/chart/')) return json(current.chart);
    if (u.includes('/coin/')) return json(current.coin ?? baseCoin);
    if (u.includes('/markets')) return json([current.coin ?? baseCoin]);
    if (u.includes('/global')) return json({ mcap: 2.3e12, mcapChange: -1.1, btcDominance: 56.2 });
    return json({});
  };

  try {
    for (const c of CASES) {
      current = c;
      /*
       * Both chart modes. The candle path is a completely separate component
       * and a separate fetch, and `sometimes` in the report is exactly the
       * shape of a bug that needs one specific toggle plus one specific
       * dataset.
       */
      for (const mode of ['line', 'candle']) {
        const before = errors.length;
        const root = createRoot(container);
        let threw = null;
        try {
          await act(async () => {
            root.render(
              <Wrap>
                <Routes>
                  <Route path="*" element={<CoinDetail />} />
                </Routes>
              </Wrap>
            );
          });

          if (mode === 'candle') {
            /* Click the candle toggle the way a user would. */
            const btns = [...container.querySelectorAll('.segmented button')];
            const candleBtn = btns[1];
            if (candleBtn) {
              await act(async () => {
                candleBtn.click();
              });
            }
          }

          /* Let the polled fetches settle and any second render run. */
          await act(async () => {
            await new Promise((r) => setTimeout(r, 20));
          });
        } catch (e) {
          threw = e;
        } finally {
          try {
            await act(async () => root.unmount());
          } catch {
            /* an unmount failure is not the thing under test */
          }
        }

        out.push([
          `CoinDetail survives ${c.name} [${mode}]`,
          !threw && errors.length === before
        ]);
        if (threw) errors.push(`${c.name} [${mode}]: ${threw.message}`);
      }
    }
  } finally {
    globalThis.fetch = realFetch;
    console.error = realError;
  }

  /* ======================================================================
   * THE ACTUAL CAUSE: A LAZY CHUNK THAT FAILS TO LOAD.
   * ======================================================================
   * Everything above proves the page survives bad DATA. It does. The crash
   * is upstream of the page: every route is `lazy()`, so opening /coin/:id
   * fetches `CoinDetail-<hash>.js` over the network, and a rejected dynamic
   * import throws during render — past <Suspense>, which only ever handles
   * PENDING — up to BootBoundary, which is the "unexpected error" screen.
   *
   * That fetch 404s whenever a deploy renames the chunks under a tab still
   * running the previous build. Hence "sometimes".
   *
   * These cases assert RouteBoundary catches it, keeps the app shell alive,
   * and recovers.
   */
  {
    const realError2 = console.error;
    console.error = () => {};
    /*
     * jsdom throws "Cannot redefine property" on window.location.reload, so it
     * cannot be spied on at all. RouteBoundary therefore takes the reload
     * action as a prop with a real default — production gets a genuine
     * reload, and here we count calls.
     */
    let reloads = 0;
    const countReload = () => {
      reloads += 1;
    };

    const Boom = ({ message }) => {
      const e = new Error(message);
      e.name = message.includes('chunk') ? 'ChunkLoadError' : 'TypeError';
      throw e;
    };

    const mountBoundary = async (message) => {
      const root = createRoot(container);
      await act(async () => {
        root.render(
          <Wrap>
            <RouteBoundary t={(k) => k} reload={countReload}>
              <Boom message={message} />
            </RouteBoundary>
          </Wrap>
        );
      });
      const text = container.textContent;
      /*
       * The reload is deliberately deferred ~120ms so the cache eviction can
       * start and so no re-mount can produce a reload storm. Wait past that
       * before asserting, or the test measures the delay rather than the
       * behaviour.
       */
      await act(async () => {
        await new Promise((r) => setTimeout(r, 200));
      });
      await act(async () => root.unmount());
      return text;
    };

    window.sessionStorage?.removeItem('fbt:chunk-reload');

    /*
     * A chunk failure must NOT surface an error screen on the first attempt —
     * it is about to reload, and alarming text for a self-healing problem is
     * worse than a spinner.
     */
    const first = await mountBoundary('Failed to fetch dynamically imported module');
    out.push([
      'a failed chunk load is caught, not thrown to the boot screen',
      !first.includes('crash.title')
    ]);
    out.push(['...and triggers exactly one reload', reloads === 1]);

    /*
     * The SECOND failure must stop reloading and explain itself. Without this
     * guard a genuinely broken page would reload forever and the user could
     * neither read the error nor navigate away.
     */
    const second = await mountBoundary('Failed to fetch dynamically imported module');
    out.push(['...and a second failure does NOT reload again', reloads === 1]);
    out.push([
      '...it explains that a new version shipped',
      second.includes('crash.updateTitle')
    ]);

    /*
     * A NON-chunk error is a real bug and must never trigger a reload — that
     * would hide it and loop the user through a screen they cannot read.
     */
    window.sessionStorage?.removeItem('fbt:chunk-reload');
    const before = reloads;
    const other = await mountBoundary('some genuine bug');
    out.push(['a real bug does not trigger a reload', reloads === before]);
    out.push(['...and shows the error text so it can be reported',
      other.includes('some genuine bug')]);
    out.push(['...with a way back to a working screen', other.includes('crash.goHome')]);

    console.error = realError2;
  }

  /* Surface the first few real errors so a failure is diagnosable. */
  for (const e of errors.slice(0, 6)) out.push([`(detail) ${String(e).slice(0, 160)}`, false]);

  return out;
}
