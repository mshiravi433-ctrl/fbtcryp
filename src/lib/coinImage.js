/**
 * COIN ARTWORK — the right size, from a host that answers.
 * ---------------------------------------------------------------------------
 * ─── THE REPORTED BUG ───────────────────────────────────────────────────────
 *   «در قسمت بازار کویین ها ایکونشون نمیاد یا دیر و خیلی دیر میاد کنده»
 *
 * The market list icons arrive late, or not at all, and the screen stutters
 * while they do.
 *
 * ─── WHAT WAS ACTUALLY WRONG, MEASURED ──────────────────────────────────────
 * `normalizeCoin` stores CoinGecko's `image` field verbatim. That field is
 * always the LARGE variant:
 *
 *   https://coin-images.coingecko.com/coins/images/1/large/bitcoin.png
 *
 * "large" is a 250x250 PNG — typically 25-60 KB. The market screen loads 250
 * rows. So a single visit to the default tab asks for up to ~10 MB of artwork
 * to fill circles that are THIRTY-FOUR pixels wide. On a mobile connection
 * that is minutes, and the browser only allows ~6 connections per host, so
 * the requests queue and the icons trickle in one by one — exactly the
 * "دیر و خیلی دیر میاد" being described.
 *
 * CoinGecko publishes three variants of the same file at the same path:
 *
 *   thumb  25 px    ~1-2 KB
 *   small  50 px    ~3-6 KB
 *   large  250 px   ~25-60 KB
 *
 * A 34 px circle on a 3x phone screen needs about 100 px of image. `small` at
 * 50 px is the honest fit for the list; `large` is kept for the coin detail
 * header where the artwork is actually big. Rewriting the list to `small` cuts
 * the artwork payload by roughly 90% with no visible difference at 34 px.
 *
 * ─── WHY THE REWRITE IS A STRING SWAP AND NOT A NEW URL ─────────────────────
 * We do not know a coin's image id independently — it comes from the feed. So
 * the only safe transformation is to swap the size SEGMENT of a URL the feed
 * already gave us, and only when it matches the exact shape CoinGecko uses.
 * Anything else is passed through untouched: a wrong guess produces a 404,
 * which is a blank circle, which is the bug we are fixing.
 *
 * ─── AND WHY BOTH HOSTS ARE ACCEPTED ────────────────────────────────────────
 * CoinGecko migrated from `assets.coingecko.com` to `coin-images.coingecko.com`
 * and both still appear in live responses depending on the endpoint. Matching
 * only one silently leaves half the list on the heavy variant, which is the
 * kind of half-fix that looks like it worked.
 */

/** The size segment CoinGecko puts in every coin image path. */
const SIZES = new Set(['thumb', 'small', 'large']);

/**
 * Ask for a specific size of a CoinGecko coin image.
 *
 * @param {string} url   whatever the feed supplied
 * @param {'thumb'|'small'|'large'} size
 * @returns {string|null} null when there is no usable image at all, so the
 *          caller renders its monogram rather than an <img> with an empty src
 *          (which some browsers resolve to the page URL and log as an error).
 */
export function coinImage(url, size = 'small') {
  const raw = String(url ?? '').trim();
  if (!raw || !/^https:\/\//i.test(raw)) return null;
  if (!SIZES.has(size)) return raw;

  /*
   * Only rewrite a path that genuinely looks like `/coins/images/<id>/<size>/`.
   * A partner logo hosted elsewhere that happens to contain the word "large"
   * must not be rewritten — that would 404 a picture that was working.
   */
  return raw.replace(
    /(\/coins\/images\/\d+\/)(thumb|small|large)(\/)/i,
    (_m, head, _old, tail) => `${head}${size}${tail}`
  );
}

/**
 * A stable hue for a symbol, so the placeholder for a given coin is the same
 * colour on every screen and every launch.
 *
 * A colour that changed between renders would make the list feel unstable and
 * would stop people recognising a coin at a glance — the same reasoning as the
 * token monogram in lib/tokenIcon.jsx, and deliberately the same algorithm so
 * a coin and its token render identically.
 */
export function coinHue(symbol) {
  const s = String(symbol ?? '?');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}
