import { useEffect, useState } from 'react';
import { coinHue, coinImage, tickerLogo } from '../lib/coinImage';
import { symbolSvg } from './AssetIcon';

/**
 * ONE COIN AVATAR, USED EVERYWHERE.
 * ---------------------------------------------------------------------------
 * ─── WHY A COMPONENT AND NOT `{coin.image && <img …>}` ──────────────────────
 * That expression was copy-pasted into eleven places (Market twice, CoinRow,
 * CoinDetail, Trade twice, Signals twice, Stocks, Predict, Discover). Every
 * copy had a different subset of the attributes that make an image cheap, and
 * NONE of them handled an image that fails to load — so a dead URL left an
 * empty circle with no letters in it, which reads as broken rather than as
 * missing.
 *
 * Centralising it is what makes the size rewrite in lib/coinImage.js actually
 * reach the screen. A fix applied in ten of eleven places is not a fix; it is
 * a bug that now happens less often and is therefore harder to find.
 *
 * ─── THE ATTRIBUTES ARE THE FEATURE ─────────────────────────────────────────
 *   width/height  reserve the box before the bytes arrive, so the row does not
 *                 reflow when each icon lands. Two hundred and fifty reflows
 *                 is the "کنده" — the stutter — in the report.
 *   loading=lazy  a 250-row list only fetches what is near the viewport.
 *   fetchPriority a decorative avatar must never compete with the price data
 *                 the user is actually waiting for. Same connection pool.
 *   decoding      keeps image decode off the main thread so scrolling stays
 *                 smooth while icons arrive.
 *   referrerPolicy the image host does not need to learn which coins our
 *                 users browse.
 *
 * ─── THE FALLBACK IS A MONOGRAM, NOT A HIDDEN IMAGE ─────────────────────────
 * `onError` sets state instead of `display:none`. Hiding leaves a blank
 * circle; the monogram at least identifies the coin, and it is generated from
 * the symbol so it costs no request at all.
 */
export default function CoinLogo({
  coin,
  ticker,
  size = 'small',
  px,
  className = 'coin-logo',
  style
}) {
  /*
   * A coin image when the feed supplies one; otherwise a REAL company logo
   * derived from a US-equity ticker (the Stocks reference table). No image
   * at all → the monogram below, and `ticker` also feeds that monogram so a
   * failed logo still identifies the company.
   */
  const src = coinImage(coin?.image, size) ?? (ticker ? tickerLogo(ticker) : null);
  const [failed, setFailed] = useState(false);

  /*
   * Reset when the coin changes. Without this, a row recycled by the list
   * (React reuses the DOM node when only the key's position moves) keeps the
   * previous coin's failure and shows letters for an image that would load
   * perfectly well.
   */
  useEffect(() => setFailed(false), [src]);

  const symbol = String(coin?.symbol ?? ticker ?? '?').slice(0, 3);

  /* The box is sized by CSS unless the caller pins it (Ticker, tag chips). */
  const box = px ? { width: px, height: px, ...style } : style;

  /*
   * TIER 2 — the vendored brand artwork in lib/assetIconData.js.
   *
   * When the feed supplies no `image` (CoinLore tickers, the offline
   * snapshot), the monogram used to be the only answer — and the market
   * screen filled with grey letters where the logos used to be. `symbolSvg`
   * already holds exact brand marks (BTC, ETH, USDT, SOL, … 125 symbols) as
   * inline SVG: no request, no CDN, no wrong-coin risk beyond what the feed's
   * own symbol claims, same trust level as AssetIcon's curated lists. The
   * monogram remains the last resort, never an empty box.
   */
  if (!src || failed) {
    const svg = symbolSvg(coin?.symbol ?? ticker);
    if (svg) {
      /* The vendored tiles carry only a viewBox; pin width/height so the SVG
         fills the avatar box instead of falling back to intrinsic sizing. */
      const filled = /^<svg(?![^>]*\swidth=)/.test(svg)
        ? svg.replace('<svg ', '<svg width="100%" height="100%" ')
        : svg;
      return (
        <span
          className={className}
          style={{ ...box, display: 'block', background: 'none', padding: 0 }}
          /* Vendored strings only — never user or API input. */
          dangerouslySetInnerHTML={{ __html: filled }}
          aria-hidden="true"
        />
      );
    }
    const hue = coinHue(coin?.symbol);
    return (
      <span
        className={className}
        style={{
          ...box,
          /* Faint, not saturated: a placeholder must not out-shout the real
             icons sitting next to it in the same list. */
          background: `linear-gradient(140deg, hsl(${hue} 60% 30%), hsl(${(hue + 40) % 360} 60% 22%))`,
          color: '#fff'
        }}
      >
        {symbol}
      </span>
    );
  }

  return (
    <span className={className} style={box}>
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        fetchpriority="low"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    </span>
  );
}
