import { memo } from 'react';
import { motion } from 'framer-motion';
import { fmtPct, fmtUsd } from '../lib/format';
import Sparkline from './Sparkline';
import CoinLogo from './CoinLogo';
import { useNearViewport } from '../hooks/useRowWindow';
import { GlyphTrendDown, GlyphTrendUp } from './market/MarketGlyphs.jsx';

/**
 * A keyboard-accessible market row with a dedicated, full-row navigation target.
 *
 * ─── `deferSpark` — THE SPARK LINE IS DRAWN WHEN THE ROW IS SEEN ────────────
 *   «صفحه بازار خیلی کند هست … گاهی چشمک میزنه»
 *
 * The number a reader acts on (price, 24h move, name, rank) is text and costs
 * nothing. The SHAPE beside it is an SVG with a gradient def per row, and a
 * sixty-row list therefore paints sixty of them in the same commit — which is
 * invisible for the rows on screen and pure waste for the fifty below it,
 * where they are also the tiles most likely to be evicted and re-painted while
 * the reader scrolls.
 *
 * `deferSpark` withholds ONLY that decoration until the row has been near the
 * viewport (see hooks/useRowWindow.js). The row itself, every digit in it and
 * its tap target are always rendered and always in the DOM, so this changes
 * nothing about the reading or about find-in-page — the 52px column simply
 * stays empty for another screen's worth of scroll.
 *
 * Callers that draw one row (a hero, a search hit) leave it off; the market
 * list turns it on.
 */
function CoinRow({
  coin,
  onClick,
  showSpark = true,
  rank,
  metric = null,
  animate = true,
  logoPriority = false,
  deferSpark = false
}) {
  const up = coin.change24h >= 0;
  const [rowRef, near] = useNearViewport({ eager: !deferSpark, rootMargin: '400px' });

  const content = (
    <button
      type="button"
      className="coin-row-open"
      onClick={() => onClick?.(coin)}
      aria-label={`${coin.name} (${coin.symbol})`}
    >
      {rank != null && <span className="coin-row-rank mono">{rank}</span>}
      <CoinLogo coin={coin} priority={logoPriority} />

      <div className="coin-meta">
        <div className="coin-sym">{coin.symbol}</div>
        <div className="coin-name">
          <span className="coin-name-text">{coin.name}</span>
          {metric && <span className="coin-row-metric">{metric}</span>}
        </div>
      </div>

      {showSpark && (
        <span className="coin-row-spark" aria-hidden="true" data-spark={near ? 'on' : 'off'}>
          {near && <Sparkline
            data={coin.sparkline?.slice(-40) ?? []}
            up={up}
            width={52}
            height={24}
            strokeWidth={1.5}
            glow={false}
            animate={animate}
          />}
        </span>
      )}

      <div className="coin-right">
        <div className="coin-price mono">{fmtUsd(coin.price)}</div>
        <div className={`coin-change-pill mono ${up ? 'is-up' : 'is-down'}`}>
          {/* «ایکون svg» — the typed triangle glyphs could not be recoloured by the accent
              token and arrived as platform text artwork on every OS. The arrow
              is drawn, inherits currentColor, and is 9px so it never pushes the
              number off its line in a 5-column row. */}
          {up
            ? <GlyphTrendUp width={9} height={9} aria-hidden="true" />
            : <GlyphTrendDown width={9} height={9} aria-hidden="true" />}
          {fmtPct(coin.change24h, 2)}
        </div>
      </div>
    </button>
  );

  if (!animate) {
    return (
      <div className="coin-row" data-coin-id={coin.id} ref={rowRef}>
        {content}
      </div>
    );
  }

  return (
    <motion.div
      className="coin-row"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      whileTap={{ scale: 0.985 }}
      data-coin-id={coin.id}
      ref={rowRef}
    >
      {content}
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
  && prev.logoPriority === next.logoPriority
  && prev.deferSpark === next.deferSpark
  && prev.coin?.id === next.coin?.id
  && prev.coin?.price === next.coin?.price
  && prev.coin?.change24h === next.coin?.change24h
  && prev.coin?.symbol === next.coin?.symbol
  && prev.coin?.name === next.coin?.name
  && prev.coin?.image === next.coin?.image
  && sameSparkline(prev.coin?.sparkline, next.coin?.sparkline)
));
