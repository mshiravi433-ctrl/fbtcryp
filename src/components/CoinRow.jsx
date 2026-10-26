import { motion } from 'framer-motion';
import { fmtPct, fmtUsd } from '../lib/format';
import Sparkline from './Sparkline';
import CoinLogo from './CoinLogo';

/** A keyboard-accessible market row with a dedicated, full-row navigation target. */
export default function CoinRow({ coin, onClick, showSpark = true, rank, metric = null }) {
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
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
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
            <Sparkline data={coin.sparkline?.slice(-40) ?? []} up={up} width={52} height={24} strokeWidth={1.5} glow={false} />
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
