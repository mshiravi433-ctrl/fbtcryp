import { useEffect, useState } from 'react';
import { coinHue, coinImage } from '../lib/coinImage';

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
  size = 'small',
  px,
  className = 'coin-logo',
  style
}) {
  const src = coinImage(coin?.image, size);
  const [failed, setFailed] = useState(false);

  /*
   * Reset when the coin changes. Without this, a row recycled by the list
   * (React reuses the DOM node when only the key's position moves) keeps the
   * previous coin's failure and shows letters for an image that would load
   * perfectly well.
   */
  useEffect(() => setFailed(false), [src]);

  const symbol = String(coin?.symbol ?? '?').slice(0, 3);

  /* The box is sized by CSS unless the caller pins it (Ticker, tag chips). */
  const box = px ? { width: px, height: px, ...style } : style;

  if (!src || failed) {
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
