import { memo } from 'react';
import { motion } from 'framer-motion';
import { fmtPct, fmtUsd, pctTone } from '../lib/format';
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
  deferSpark = false,
  /*
   * WHICH HORIZON THE PILL SHOWS — 1h, 24h or 7d.
   *
   * The feed has always carried all three (`normalizeCoin` maps
   * price_change_percentage_1h/24h/7d_in_currency) and this row printed one,
   * fixed: 24h. So a coin up 30% on the week and a coin up 30% in a day were
   * the same row, and the 1h move — the number a reader watching a dump
   * actually wants — was nowhere on the screen.
   *
   * `horizon` selects the field; the COLOUR AND ARROW come from that same
   * field through `pctTone`, so the pill can never point one way over a number
   * that moved the other. A horizon the row does not carry (the CoinLore
   * backup sends no 1h/7d) renders the same neutral «—» a missing 24h does,
   * never a green zero.
   */
  horizon = '24h',
  /*
   * ─── WHERE THE PRICE SITS IN ITS OWN DAY (2026-11-12) ──────────────────────
   * `high24h` and `low24h` have been on every row since the feed was written
   * (`normalizeCoin`) and the market list never read them — the only place the
   * pair appeared was the Bitcoin box in the Overview tab. So the list could
   * say "up 4%" while the coin was sitting at the very bottom of its range —
   * two screens that look identical (a green row) and mean opposite things: a
   * bounce off the low versus a stall under the high.
   *
   * The bar is deliberately tiny and deliberately NOT a second sparkline: one
   * line, one dot, no gradient, no gradient def, no animation. It answers a
   * single question («کجای بازه‌ی امروز؟») that no other element on the row can
   * answer, and it costs one `<span>` with a background and one 5px dot.
   *
   * Off by default: callers that draw one row (a hero, a search hit) have no
   * list rhythm to keep.
   */
  showRange = false
}) {
  /*
   * «همیشه سبز»: the same rule the Bitcoin box follows (lib/format.js
   * `pctTone`) — the ARROW and the COLOUR come from the value the row PRINTS,
   * so a +0.004% tick is a flat, grey, arrow-less «+0.00%» rather than a green
   * arrow pointing at a zero. A missing move gets no tone at all.
   */
  const moveOf = (row, h) => (h === '1h' ? row?.change1h : h === '7d' ? row?.change7d : row?.change24h);
  const move = moveOf(coin, horizon);
  const tone = pctTone(move, 2);
  const up = tone === 'down' ? false : tone === 'up';
  const flat = tone == null || tone === 'flat';
  /*
   * Position of the live price inside today's high/low, 0..1.
   *
   * Returns null rather than a guess when the bar would be meaningless: no
   * high/low (the CoinLore backup sends neither), a non-positive low, or a
   * high that is below the low (a feed glitch — drawing that would put the dot
   * outside its own track). A row with no range simply renders no bar, which
   * is the same honesty rule the pill follows for a missing move.
   */
  const rangePos = (() => {
    if (!showRange) return null;
    const low = Number(coin?.low24h);
    const high = Number(coin?.high24h);
    const price = Number(coin?.price);
    if (!Number.isFinite(low) || !Number.isFinite(high) || !Number.isFinite(price)) return null;
    if (low <= 0 || high <= low || price <= 0) return null;
    return Math.min(1, Math.max(0, (price - low) / (high - low)));
  })();
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
          {metric && (
            <span className="coin-row-metric">
              {typeof metric === 'object' ? <>{metric.text} <i>{metric.unit}</i></> : metric}
            </span>
          )}
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
        <div className={`coin-change-pill mono ${flat ? 'is-flat' : up ? 'is-up' : 'is-down'}`}>
          {/* «ایکون svg» — the typed triangle glyphs could not be recoloured by the accent
              token and arrived as platform text artwork on every OS. The arrow
              is drawn, inherits currentColor, and is 9px so it never pushes the
              number off its line in a 5-column row. A flat row draws no arrow:
              there is no direction to point at. */}
          {!flat && (up
            ? <GlyphTrendUp width={9} height={9} aria-hidden="true" />
            : <GlyphTrendDown width={9} height={9} aria-hidden="true" />)}
          {fmtPct(move, 2)}
        </div>
        {rangePos != null && (
          <span
            className="coin-row-range"
            data-testid="coin-row-range"
            data-pos={rangePos < 0.25 ? 'low' : rangePos > 0.75 ? 'high' : 'mid'}
            /* A bar is a picture of a number; the number is in the title, and
               a screen reader already has the price and the move. Not a
               second live region. */
            aria-hidden="true"
            title={`${fmtUsd(coin.low24h)} – ${fmtUsd(coin.high24h)}`}
          >
            <i style={{ insetInlineStart: `${(rangePos * 100).toFixed(1)}%` }} />
          </span>
        )}
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
/*
 * `metric` is either null, a {text, unit} value (what Market.jsx passes now) or
 * — for any caller that has not been converted — an arbitrary node, which is
 * compared by identity exactly as before. The object form is compared by its
 * two printed strings, so a poll that changes nothing keeps the memo; the old
 * identity test on a freshly-created JSX element could never succeed, and that
 * made every row on the «ارزش بازار» and «حجم» views re-render every 30 s.
 */
function sameMetric(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  return a.text === b.text && a.unit === b.unit;
}

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
  && sameMetric(prev.metric, next.metric)
  && prev.animate === next.animate
  && prev.logoPriority === next.logoPriority
  && prev.deferSpark === next.deferSpark
  && prev.coin?.id === next.coin?.id
  && prev.coin?.price === next.coin?.price
  && prev.horizon === next.horizon
  && prev.coin?.change1h === next.coin?.change1h
  && prev.coin?.change24h === next.coin?.change24h
  && prev.coin?.change7d === next.coin?.change7d
  && prev.coin?.symbol === next.coin?.symbol
  && prev.coin?.name === next.coin?.name
  && prev.coin?.image === next.coin?.image
  && sameSparkline(prev.coin?.sparkline, next.coin?.sparkline)
));
