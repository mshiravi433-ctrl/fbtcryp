import { memo } from 'react';
import { motion } from 'framer-motion';
import { fmtPct, fmtUsd } from '../lib/format';
import Sparkline from './Sparkline';
import CoinLogo from './CoinLogo';

/** A keyboard-accessible market row with a dedicated, full-row navigation target. */
function CoinRow({ coin, onClick, showSpark = true, rank, metric = null, animate = true }) {
  const up = coin.change24h >= 0;

  return (
    /*
      ─── A ROW ANIMATES ITSELF, NOT ON A 2.4-SECOND QUEUE ───────────────────
      «وقتی اسکرول می‌کنی پایین … صفحه سیاهه و لود نمی‌شه»

      These rows used to inherit `riseIn` from the list container's
      `staggerChildren: 0.04`. Sixty rows meant the last one only STARTED
      2.4 seconds after the first — and every one of them sat at `opacity: 0`
      until its turn. Scrolling during that window showed a page of empty
      (black) space that "never loaded", because it had not been allowed to.

      A list is not a hero section: there is nothing to choreograph. Each row
      now fades in on its own over 0.22s the moment it mounts, so whatever is
      on screen is visible immediately, and rows added by «نمایش بیشتر» appear
      at once instead of queueing behind the ones above them. Still
      transform/opacity only, so it stays on the compositor.
    */
    <motion.div
      className="coin-row"
      /* `animate={false}` is the long-list case: the row is painted at rest on
         its first frame. Sixty entrance animations on a 250-row list are not a
         choreography, they are sixty compositor layers starting at the same
         time — and the previous pass proved rows that wait at opacity 0 read as
         "the page is black". */
      initial={animate ? { opacity: 0, y: 8 } : false}
      animate={animate ? { opacity: 1, y: 0 } : undefined}
      transition={animate ? { duration: 0.22, ease: [0.22, 1, 0.36, 1] } : undefined}
      whileTap={{ scale: 0.985 }}
      data-coin-id={coin.id}
    >
      <button
        type="button"
        className="coin-row-open"
        onClick={() => onClick?.(coin)}
        aria-label={`${coin.name} (${coin.symbol})`}
      >
        {rank != null && <span className="coin-row-rank mono">{rank}</span>}
        <CoinLogo coin={coin} />

        <div className="coin-meta">
          <div className="coin-sym">{coin.symbol}</div>
          <div className="coin-name">
            <span className="coin-name-text">{coin.name}</span>
            {metric && <span className="coin-row-metric">{metric}</span>}
          </div>
        </div>

        {/*
          THE SPARK IS CLIPPED TO ITS OWN COLUMN.
          Reported: «در باکس توکن گاهی نمودار میره داخل اسم توکن».
          Two separate causes, both fixed here:
            1. this SVG was drawn at width 58 inside a 52px column, so it
               overhung by 6px in an RTL row — straight into the token name;
            2. the path carried a `drop-shadow`, and a shadow painted outside
               the box is not clipped by the column, so even the extra 4px of
               glow bled over the text.
          The width now matches the column exactly and the glow is off for list
          rows (it is decoration at 24px tall, and sixty blurred shadows are
          also sixty expensive raster layers while scrolling).
        */}
        {showSpark && (
          <span className="coin-row-spark" aria-hidden="true">
            <Sparkline
              data={coin.sparkline?.slice(-40) ?? []}
              up={up}
              width={52}
              height={24}
              strokeWidth={1.5}
              glow={false}
              animate={animate}
            />
          </span>
        )}

        <div className="coin-right">
          <div className="coin-price mono">{fmtUsd(coin.price)}</div>
          <div className={`coin-change-pill mono ${up ? 'is-up' : 'is-down'}`}>
            <span aria-hidden="true">{up ? '▲' : '▼'}</span>
            {fmtPct(coin.change24h, 2)}
          </div>
        </div>
      </button>
    </motion.div>
  );
}

/*
 * MEMOISED ON THE FIELDS THE ROW PRINTS.
 *
 * The list re-renders every 30 seconds with a fresh array of coin objects, and
 * each object is rebuilt by the visual merge whether or not its price moved.
 * Comparing object identity would therefore memoise nothing at all; comparing
 * the id and the displayed numbers collapses the poll into "60 rows reconcile,
 * 4 repaint". The click handler is deliberately NOT part of the comparison —
 * it is a new closure on every parent render, which would defeat the whole
 * thing.
 */
function sameSparkline(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  const n = a.length;
  /* The shape is drawn from every point, so length + both ends is the cheap
     honest test: a 7-day series that changed in the middle but not at either
     end cannot happen with a rolling price window. */
  return n < 2 || (a[0] === b[0] && a[n - 1] === b[n - 1]);
}

export default memo(CoinRow, (prev, next) => (
  prev.showSpark === next.showSpark
  && prev.rank === next.rank
  && prev.metric === next.metric
  && prev.animate === next.animate
  && prev.coin?.id === next.coin?.id
  && prev.coin?.price === next.coin?.price
  && prev.coin?.change24h === next.coin?.change24h
  && prev.coin?.symbol === next.coin?.symbol
  && prev.coin?.name === next.coin?.name
  && prev.coin?.image === next.coin?.image
  && sameSparkline(prev.coin?.sparkline, next.coin?.sparkline)
));
