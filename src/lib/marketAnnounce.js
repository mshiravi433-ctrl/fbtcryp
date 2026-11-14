/**
 * ─── SAYING WHAT THE TABLE IS SHOWING, IN WORDS A SCREEN READER CAN HEAR ──
 *
 * The market table has three kinds of state that change what a reader is
 * looking at, and none of them was ever announced:
 *
 *   1. WHICH SET — «همه» / «صعودی‌ها» / a sector. The chips are `aria-pressed`,
 *      so a screen reader can read each one's state, but nothing says what the
 *      LIST became after the press. A sighted reader sees the rows reorder; a
 *      reader who cannot see them sees no change at all.
 *   2. HOW MANY — the row count is `aria-live="polite"` on the heading, and it
 *      was announcing the TOTAL (`list.length`, up to 750) next to a list that
 *      RENDERS 60. «۷۵۰» over sixty rows is a false statement about the page.
 *   3. IN WHAT ORDER — a sort change reorders the table silently.
 *
 * This module is the vocabulary and the one function that turns those three
 * into a single sentence, because a live region that updates three times for
 * one tap ("60", "rank ascending", "all") is worse than one that updates once.
 *
 * ─── WHY IT IS A PURE MODULE ───────────────────────────────────────────────
 * Same reason as the rest of `lib/marketList.js`: a sentence is arithmetic over
 * state, and the interesting failures are all "the sentence disagreed with the
 * list" — which a render test reads as two passing assertions and a bug. Here
 * the whole mapping is a function, so a test can enumerate every combination
 * without a DOM, and the page keeps only the wiring.
 */

/**
 * A row count in words, with the honest distinction between "showing N of M"
 * and "showing all N". `shown === total` is the case where "of M" is noise.
 */
export function countPhrase(shown, total) {
  const s = Number.isFinite(shown) ? Math.max(0, Math.trunc(shown)) : 0;
  const t = Number.isFinite(total) ? Math.max(0, Math.trunc(total)) : s;
  if (s === 0) return { key: 'market.liveNone', values: {} };
  if (s >= t) return { key: 'market.liveCount', values: { count: s } };
  return { key: 'market.liveCountOf', values: { shown: s, total: t } };
}

/**
 * Which set the table is currently showing, as an i18n key.
 *
 * Order matters: a sector is a REPLACEMENT of the universe (see Market.jsx
 * `universe`), so it wins over any ordering vocabulary — a sector view sorted
 * by volume is still the sector, not «حجم». Favourites is a user-defined subset
 * and has the same claim, so it comes next. Only then is the order itself the
 * answer, and only for the four orderings that have a name; anything else
 * (mcap, price, 1h, 7d) is "all coins, in a different order", which is what
 * the sort phrase says separately.
 */
export function viewPhrase({ sector = null, onlyFavorites = false, sortKey = 'rank', sortDir = 'asc' } = {}) {
  if (sector) return { key: 'market.liveViewSector', values: { sector } };
  if (onlyFavorites) return { key: 'market.liveViewFavorites', values: {} };
  if (sortKey === 'change' && sortDir === 'desc') return { key: 'market.liveViewGainers', values: {} };
  if (sortKey === 'change' && sortDir === 'asc') return { key: 'market.liveViewLosers', values: {} };
  if (sortKey === 'volume' && sortDir === 'desc') return { key: 'market.liveViewVolume', values: {} };
  return { key: 'market.liveViewAll', values: {} };
}

/**
 * The order, as an i18n key plus the column it names.
 *
 * The direction is separate from the column on purpose: «رتبه — صعودی» and
 * «قیمت — نزولی» are the same two words in two orders, and translating the
 * pair as one string would double the keys for every column.
 */
export function orderPhrase({ sortKey = 'rank', sortDir = 'asc' } = {}) {
  return {
    key: sortDir === 'asc' ? 'market.liveOrderAsc' : 'market.liveOrderDesc',
    values: { column: `market.sort.${sortKey}` }
  };
}

/**
 * The complete sentence parts for one announcement, in reading order:
 * how many, which set, in what order.
 *
 * Returns an ARRAY of `{key, values}` rather than a joined string, so the page
 * can translate each part with the translation function it already has (and a
 * test can assert the parts without a translator). `joinMarketAnnouncement()`
 * is the one place that knows how to glue them, so every surface that
 * announces something on this screen produces the same shape.
 */
export function marketAnnouncement({ shown = 0, total = 0, sector = null, onlyFavorites = false, sortKey = 'rank', sortDir = 'asc' } = {}) {
  return [
    countPhrase(shown, total),
    viewPhrase({ sector, onlyFavorites, sortKey, sortDir }),
    orderPhrase({ sortKey, sortDir })
  ];
}

/** Glue translated parts into one spoken sentence, skipping empty ones. */
export function joinMarketAnnouncement(parts, translate) {
  return (parts ?? [])
    .map((part) => (part && typeof translate === 'function' ? translate(part.key, part.values) : ''))
    .filter((text) => typeof text === 'string' && text.trim().length > 0)
    .join(' · ');
}
