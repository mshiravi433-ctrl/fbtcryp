import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isMarketRoute, MARKET_ROUTE_PATHS, MARKET_PAGE_ROWS } from '../src/lib/marketRoute.js';

/*
 * THE HEADER'S DUPLICATE MARKET POLL.
 *
 * Header.jsx renders on every route and polls the market list for its
 * one-minute spotlight. pages/Market.jsx polls the same list for its own rows.
 * `lib/api.js getMarkets` memoises under `markets:${vs}:${page}:${perPage}` —
 * the ROW COUNT IS PART OF THE KEY. So the header's `perPage: 60` and the
 * page's `perPage: 250` were never the same cache entry, and on `/market` the
 * header re-fetched a list that was already on screen, on a timer, forever.
 *
 * These tests pin the three things that keep the fix from silently unravelling:
 *   1. the route predicate (a typo here quietly restores the duplicate),
 *   2. that the header and the page agree on the row count, and
 *   3. that the header actually asks for it on those routes.
 */

test('isMarketRoute knows exactly the two URLs that mount <Market />', () => {
  /* App.jsx:511 `<Route path="/" element={<Market />} />` and
     App.jsx:613 `<Route path="*" element={<Market />} />`. */
  assert.deepEqual([...MARKET_ROUTE_PATHS], ['/', '/market']);
  assert.equal(isMarketRoute('/'), true);
  assert.equal(isMarketRoute('/market'), true);
  /* Trailing slash is the same screen. */
  assert.equal(isMarketRoute('/market/'), true);
  /* Everything else has no copy of this list to share. */
  for (const p of ['/coin/bitcoin', '/signals', '/smart-money', '/settings',
    '/marketplace', '/premium', '/insurance/marketplace', '/signal']) {
    assert.equal(isMarketRoute(p), false, `${p} must NOT be treated as the market route`);
  }
  /* Garbage in, false out — never a thrown error on a render path. */
  assert.equal(isMarketRoute(undefined), false);
  assert.equal(isMarketRoute(null), false);
  assert.equal(isMarketRoute(''), false);
});

test('the header and the market page ask for the SAME number of rows', () => {
  /* Two files, one number. If they drift, the memo keys drift, and the
     duplicate request comes back without anyone editing a URL. */
  const page = readFileSync('src/pages/Market.jsx', 'utf8');
  assert.match(page, /MARKET_PAGE_SIZE\s*=\s*MARKET_PAGE_ROWS/,
    'pages/Market.jsx must take its page size from lib/marketRoute.js, not its own literal');
  assert.match(page, /useMarkets\(MARKET_PAGE_SIZE\)/,
    'the page must poll with that constant');
  assert.equal(MARKET_PAGE_ROWS, 250,
    '250 is CoinGecko’s documented per-call maximum; the server clamps to it');

  const header = readFileSync('src/components/Header.jsx', 'utf8');
  assert.match(header, /onMarketRoute \? MARKET_PAGE_ROWS : 60/,
    'Header.jsx must use the shared constant on the market route');
});

test('the header decides the route from react-router, not the global location', () => {
  const header = readFileSync('src/components/Header.jsx', 'utf8');
  /* The global `location` does not update on a client-side navigation, so a
     regex over it would read the route the user ARRIVED on, forever. */
  assert.match(header, /import \{[^}]*useLocation[^}]*\} from 'react-router-dom'/);
  assert.match(header, /isMarketRoute\(useLocation\(\)\.pathname\)/);
  assert.equal(/[^.\w]location\.pathname/.test(header), false,
    'Header must not read the global location.pathname');
});

test('the header poll still costs nothing extra when the page is open', () => {
  /*
   * The shape of the fix, asserted on the API layer rather than on a render:
   * `getMarkets` keys its memo on the row count, so identical `perPage` is
   * exactly what makes the second call a cache read. If someone ever changes
   * that key, this test is the one that says so.
   */
  const api = readFileSync('src/lib/api.js', 'utf8');
  assert.match(api, /resilient\(`markets:\$\{vs\}:\$\{page\}:\$\{perPage\}`/,
    'the markets memo key must include perPage — this test and the header fix both depend on it');
});

test('the header keeps its three-minute cadence — the fix removes a request, not freshness', () => {
  const header = readFileSync('src/components/Header.jsx', 'utf8');
  assert.match(header, /3 \* 60 \* 1000/,
    'the header poll interval must stay three minutes');
});
