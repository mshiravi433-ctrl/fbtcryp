/**
 * THE MARKET LIST'S ARITHMETIC — sorting, breadth, freshness.
 * ---------------------------------------------------------------------------
 * Pulled out of `pages/Market.jsx` for one reason: these three answers are the
 * only part of that screen whose correctness can be proven without a browser.
 * A render test can tell you a chip was clicked; it cannot tell you the list
 * was still complete after the click, that a coin with no volume did not jump
 * to the top of an ascending sort, or that the breadth bar's two halves add up
 * to the page. So the maths lives here, in plain functions, and the page keeps
 * only the wiring.
 *
 * ─── WHY THIS FILE EXISTS AT ALL: THE `slice(0, 25)` ────────────────────────
 * The chips on the market screen used to be implemented as
 *
 *     case 'gainers': return [...out].sort(byChange).slice(0, 25)
 *
 * `out` is the whole loaded page — up to 500 coins. So "صعودی‌ها" did not sort
 * the market, it REPLACED it with twenty-five rows, and every other coin on
 * the page became unreachable without clearing the chip. The same for
 * "نزولی‌ها" and "حجم". Three of the five chips were a different screen
 * pretending to be a filter.
 *
 * The rule now: a chip is a VIEW (which order, which subset), never a budget.
 * Ordering is `sortMarketRows`; the only subset is the explicit favourites
 * filter, because that one is defined by the user's own list.
 */

/** Sort keys the UI offers. Order is the order of the <select>. */
export const MARKET_SORTS = Object.freeze(['rank', 'mcap', 'change', 'volume', 'price']);

/** Default view: the market as it is usually read — rank 1, 2, 3 … */
export const DEFAULT_SORT = Object.freeze({ key: 'rank', dir: 'asc' });

/**
 * Coerce to a usable number, or `null`.
 *
 * Providers disagree about types (CoinGecko sends numbers, CoinLore sends
 * strings, a missing field is `null` or `''`), and `NaN` in a comparator makes
 * `Array.prototype.sort` produce an arbitrary order rather than an error. So a
 * value that cannot be used is `null` here and handled explicitly below.
 */
function num(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Sort a copy of the rows. Never mutates: the caller's array is usually the
 * polled feed, and sorting it in place would reorder `coins` itself — which
 * every other derived value on the page (the hero, the trend, the breadth) is
 * reading.
 *
 * @param {Array<object>} rows
 * @param {'rank'|'mcap'|'change'|'volume'|'price'} key
 * @param {'asc'|'desc'} dir
 */
export function sortMarketRows(rows, key = 'rank', dir = 'asc') {
  const list = Array.isArray(rows) ? rows : [];
  const order = dir === 'asc' ? 1 : -1;
  const read = sortReader(key);

  return list
    .map((row, index) => ({ row, index, value: read(row) }))
    .sort((a, b) => {
      /*
       * A MISSING VALUE IS NEVER A SMALL ONE.
       *
       * The naive `(a.value ?? 0) - (b.value ?? 0)` puts a coin whose feed
       * omitted its 24h volume at the BOTTOM of a descending sort and at the
       * TOP of an ascending one — so "کم‌ترین حجم" would open with a wall of
       * coins that have no volume figure at all. Both directions park unknown
       * values at the end, after the real ones, where they read as "no data"
       * instead of "smallest".
       */
      const aKnown = a.value != null;
      const bKnown = b.value != null;
      if (aKnown !== bKnown) return aKnown ? -1 : 1;
      if (aKnown && a.value !== b.value) return (a.value - b.value) * order;
      /*
       * Ties fall back to rank, then to feed order. Without the tie-break a
       * 60-row page of identical zero-change coins reshuffles itself on every
       * 30-second poll, which reads as the list "jumping" while being read.
       */
      const aRank = num(a.row?.rank);
      const bRank = num(b.row?.rank);
      if (aRank != null && bRank != null && aRank !== bRank) return aRank - bRank;
      return a.index - b.index;
    })
    .map((entry) => entry.row);
}

function sortReader(key) {
  switch (key) {
    case 'mcap':
      /* Market cap has a second spelling in this codebase (`marketCap`), and a
         row that came from the sector endpoint is not guaranteed to carry the
         same one as a row from the markets endpoint. Read both. */
      return (row) => num(row?.mcap) ?? num(row?.marketCap);
    case 'volume':
      return (row) => num(row?.volume) ?? num(row?.totalVolume);
    case 'price':
      return (row) => num(row?.price);
    case 'change':
      return (row) => num(row?.change24h) ?? num(row?.change24);
    case 'rank':
    default:
      /* Rank 0 / null means "no rank from the feed"; it must sort last, not
         first, so it is mapped to `null` (unknown) rather than to 0. */
      return (row) => {
        const r = num(row?.rank);
        return r != null && r > 0 ? r : null;
      };
  }
}

/**
 * Market breadth: how many of the coins ON THIS PAGE are up, down, unchanged.
 *
 * ─── WHAT THIS IS, AND WHAT IT IS NOT ───────────────────────────────────────
 * It is NOT a fear-and-greed index and it is not the whole market. It is a
 * count over the rows this screen already holds, which is why the caption
 * under the bar names that number ("out of N loaded here"). Deriving a
 * sentiment SCORE from it would be inventing a figure nobody measured; a count
 * is something the reader can verify by scrolling.
 *
 * Rows with no usable `change24h` are counted separately rather than being
 * folded into "unchanged" — "this feed did not say" and "this coin did not
 * move" are different facts, and only one of them is good news.
 */
export function marketBreadth(rows) {
  const list = Array.isArray(rows) ? rows : [];
  let up = 0;
  let down = 0;
  let flat = 0;
  let unknown = 0;
  let sum = 0;
  let counted = 0;

  for (const row of list) {
    const change = num(row?.change24h) ?? num(row?.change24);
    if (change == null) {
      unknown += 1;
      continue;
    }
    counted += 1;
    sum += change;
    if (change > 0) up += 1;
    else if (change < 0) down += 1;
    else flat += 1;
  }

  return {
    up,
    down,
    flat,
    unknown,
    counted,
    total: list.length,
    avgChange: counted ? sum / counted : 0,
    /* Shares are of the coins that REPORTED, not of the page: a bar whose two
       halves are scaled by a third number would not add up to itself. */
    upShare: counted ? up / counted : 0,
    downShare: counted ? down / counted : 0,
    flatShare: counted ? flat / counted : 0
  };
}

/**
 * How old the last successful poll is, in a shape the copy can use.
 *
 * Rounded to 5s: the page ticks this every 10 seconds, and a label that walks
 * 17 → 18 → 19 while the user watches reads as a stopwatch rather than as a
 * freshness hint.
 */
export function freshness(updatedAt, now = Date.now()) {
  const at = num(updatedAt);
  if (at == null || at <= 0) return null;
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  const rounded = Math.round(seconds / 5) * 5;
  return {
    seconds: rounded,
    minutes: Math.floor(rounded / 60),
    /* Past 90s the feed is behind its own 30s cadence — the number is still
       real, but the label stops pretending it is "live". */
    stale: seconds > 90
  };
}
