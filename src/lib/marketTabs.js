/**
 * «بازار» — TWO TABS, AND WHAT EACH ONE HOLDS.
 * ---------------------------------------------------------------------------
 * Requested: «در صفحه بازار دو تب کن — تب اول مرور: باکس ارزش کل، باکس
 * بیت‌کوین، همراه با پول هوشمند بنر و باکس استوری‌ها. تب دوم بنام توکن: باکس
 * داغ‌ترین‌ها، باکس جستجو و توکن‌ها.»
 *
 * ─── WHY THE MODEL LIVES HERE AND NOT IN THE PAGE ──────────────────────────
 * The set of tabs is read by three different things that must never disagree:
 *
 *   1. the tab strip (label, order, which panel each one owns);
 *   2. the page, which decides which panels are MOUNTED;
 *   3. the regression pins (test/market-tabs.test.jsx), which assert that a
 *      panel cannot be shown under the tab that does not own it.
 *
 * A copy of the list in each place is how «مرور» ends up showing the token
 * list again after somebody reorders a JSX block. One array, imported.
 *
 * ─── WHAT A TAB DOES *NOT* DO ──────────────────────────────────────────────
 * A tab is a way of reading the same page, not a second page:
 *
 *   · it adds no data. Both panels read the SAME feed the screen already
 *     polls (`useMarkets`, `useGlobalStats`, `useTrending`), so switching tabs
 *     costs no request at all — the numbers a reader saw on «مرور» are the
 *     numbers that open on «توکن»;
 *   · it deletes no feature. Every box that existed on this screen before the
 *     split still exists, in one tab or the other;
 *   · it does not reset the reader's work. A search typed on «توکن», a sort,
 *     a starred-only view and a chosen sector all survive a trip to «مرور»
 *     and back, because they live in the page's state and the tab only decides
 *     what is painted.
 *
 * The one thing a tab DOES decide is mounting: a panel under a tab nobody has
 * opened is not rendered at all, which is why «توکن» costs one list of rows on
 * first open and not two.
 */

/**
 * The two tabs, in reading order.
 *
 * `id` is the state value and the `data-tab` attribute; `label` is the i18n key
 * (never a literal, this screen is translated into twelve languages); `glyph`
 * names the drawn mark in components/market/MarketGlyphs.jsx —
 * `MarketPaneGlyph` keeps the mapping, so this file stays free of JSX.
 */
export const MARKET_TABS = [
  { id: 'overview', label: 'market.tabs.overview', glyph: 'overview' },
  { id: 'tokens', label: 'market.tabs.tokens', glyph: 'tokens' }
];

/** The tab a reader lands on. Readings first: that is the order asked for. */
export const DEFAULT_MARKET_TAB = 'overview';

/** Every valid tab id, for the pin that says a panel belongs to one of them. */
export const MARKET_TAB_IDS = MARKET_TABS.map((tab) => tab.id);

/**
 * The boxes each tab owns, named by the test id of the box itself.
 *
 * This is documentation AND a contract: the pin in test/market-tabs.test.jsx
 * walks it and fails when a box is painted under a tab that does not list it,
 * or when a box that used to be on this screen stops being painted anywhere.
 * Keeping the list next to the tab model is what makes that possible.
 */
export const MARKET_TAB_CONTENT = {
  /* Readings and the two surfaces that lead somewhere else. */
  overview: [
    'market-overview',            // باکس ارزش کل + سه باکس + باکس بیت‌کوین
    'market-stories-rail',        // باکس استوری‌ها
    'market-smart-money-banner'   // بنر پول هوشمند
  ],
  /* Discovery: what is hot, then every token with its own search field. */
  tokens: [
    'market-hot-coins',           // باکس داغ‌ترین‌ها
    'market-lens',                // نبض بازار / ویترین
    'market-search-wrap',         // باکس جستجو
    'market-list-rows',           // توکن‌ها
    'market-sector-rail'          // دسته‌ها
  ]
};

/** Is this a tab this screen knows how to open? */
export function isMarketTab(id) {
  return MARKET_TAB_IDS.includes(id);
}

/**
 * The tab a `?tab=` value asks for, or the default.
 *
 * The URL is the one piece of tab state worth persisting: a link that opens
 * «توکن» is what support sends someone who says «لیست توکن‌ها را پیدا نمی‌کنم»,
 * and a reload must land where the reader was. Anything unrecognised falls
 * back to the default rather than to a blank screen — a stale bookmark from a
 * third tab that no longer exists must still open the market.
 */
export function marketTabFromParam(value) {
  const clean = String(value ?? '').trim().toLowerCase();
  return isMarketTab(clean) ? clean : DEFAULT_MARKET_TAB;
}

/**
 * The next tab for a keyboard event on the strip, honouring reading direction.
 *
 * `rtl` is passed in rather than read from `document` so this stays a pure
 * function: ArrowRight must mean «the next tab» in Farsi and «right» in
 * English, and a test can pin both without a DOM.
 *
 * Returns `null` for a key the strip does not own, so the caller can leave
 * every other key (Tab, Space, Enter) to the browser.
 */
export function nextMarketTab(current, key, rtl = false) {
  const index = MARKET_TAB_IDS.indexOf(current);
  if (index < 0) return null;
  const step = rtl ? -1 : 1;
  switch (key) {
    case 'ArrowRight':
      return MARKET_TAB_IDS[(index + step + MARKET_TAB_IDS.length) % MARKET_TAB_IDS.length];
    case 'ArrowLeft':
      return MARKET_TAB_IDS[(index - step + MARKET_TAB_IDS.length) % MARKET_TAB_IDS.length];
    case 'Home':
      return MARKET_TAB_IDS[0];
    case 'End':
      return MARKET_TAB_IDS[MARKET_TAB_IDS.length - 1];
    default:
      return null;
  }
}
