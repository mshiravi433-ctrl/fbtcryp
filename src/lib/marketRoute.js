/**
 * Is this pathname one where the market list is ALREADY being polled?
 *
 * WHY THIS EXISTS: the header renders on every route and polls the market list
 * for its one-minute spotlight (Header.jsx). The market page polls the same
 * endpoint for its own 250 rows. `getMarkets` memoises per row count, so the
 * header's 60-row request and the page's 250-row request were two independent
 * network calls — the header re-fetching, every three minutes, a list that was
 * on screen two feet below it.
 *
 * On the routes below the header asks for the page's own size instead, which
 * makes its `usePoll` a cache read: `markets:usd:1:250` is already warm.
 *
 * ─── WHY THE LIST IS WRITTEN OUT INSTEAD OF INFERRED ───────────────────────
 * App.jsx mounts `<Market />` at `/` (line 511) AND as the `*` catch-all
 * (line 613). Unknown paths therefore render the market too — but guessing at
 * them here would be a bad trade: a wrong guess in the other direction (a path
 * NOT in this list that does mount Market) costs a duplicate request, while a
 * wrong guess the other way would under-fetch a 250-row list somewhere that
 * needs it. `/` and `/market` are the two URLs anyone actually lands on, and
 * they are the two this function answers `true` for.
 *
 * Kept as a pure function, not an inline regex in Header.jsx, so the test can
 * assert the exact set without mounting the app.
 */
export const MARKET_ROUTE_PATHS = Object.freeze(['/', '/market']);

/**
 * The row count the market page itself polls (`MARKET_PAGE_SIZE` in
 * pages/Market.jsx — 250, CoinGecko's documented per-call maximum).
 *
 * It is duplicated here as a NUMBER rather than imported, on purpose: importing
 * Market.jsx from Header.jsx would pull the whole page module into the header's
 * chunk graph and undo the lazy route split. `test/market-header-poll.test.mjs`
 * reads both files and fails if these two numbers ever disagree, which is the
 * property that actually matters — the header's request must hit the SAME memo
 * key the page fills, and the memo key contains the row count.
 */
export const MARKET_PAGE_ROWS = 250;

export function isMarketRoute(pathname) {
  if (typeof pathname !== 'string' || pathname === '') return false;
  /* Trailing slash: '/market/' is the same screen as '/market'. The root is
     the one path where stripping the slash would leave an empty string, so it
     is checked before the strip rather than after. */
  if (pathname === '/') return true;
  const clean = pathname.replace(/\/+$/, '');
  return MARKET_ROUTE_PATHS.includes(clean);
}
