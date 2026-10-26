import { motion } from 'framer-motion';
import { fmtPct, fmtUsd } from '../lib/format';
import Sparkline from './Sparkline';
import CoinLogo from './CoinLogo';
import { IconStar } from './Icons';
import { riseIn } from './PageTransition';

/**
 * ONE COIN, ONE ROW — the market list's only row component.
 * ---------------------------------------------------------------------------
 * ─── WHY THE ROW IS NO LONGER ITSELF THE BUTTON ─────────────────────────────
 * This used to be a `<motion.div onClick=…>` holding logo, name, sparkline and
 * price. A div with a click handler is invisible to a keyboard and to a screen
 * reader: the market list — the app's busiest screen, 60 rows of it — could not
 * be walked with Tab at all, and a row announced nothing about what it was.
 *
 * The obvious fix (role="button" on the div) works right up until the row
 * needs a second control of its own, which it now does: the star. A button
 * inside a role="button" is announced as one ambiguous control by most screen
 * readers, and the inner one's Enter key bubbles to the outer handler.
 *
 * So the row is a CONTAINER with two real buttons inside it:
 *
 *     [ open → coin page .............................. ] [ ☆ ]
 *
 * The left one carries the whole row's content and is the navigation target;
 * the star is a sibling, so it can be reached, activated and announced on its
 * own. `.coin-row` keeps its padding and background, so every other screen
 * that styles a `.coin-row` div is unaffected.
 *
 * ─── THE SECOND LINE UNDER THE NAME ─────────────────────────────────────────
 * Reported, and it is why the list once looked like noise: every row printed
 * `23.80B market.low24h: — market.high24h:` — a volume followed by raw i18n
 * keys, in 250 places. The lesson was not "no second line", it was "a second
 * line must be something the reader asked for". So `metric` is a slot the page
 * fills ONLY when the current sort makes that number worth reading (sorting by
 * volume shows volume, sorting by cap shows cap) — and it is passed as a
 * finished node, already translated, never a key.
 *
 * @param {object}   coin        a row from the market feed
 * @param {function} [onClick]   open the coin
 * @param {boolean}  [showSpark] draw the 24h sparkline
 * @param {number}   [rank]      the number shown at the start of the row
 * @param {React.ReactNode} [metric] small secondary figure under the name
 * @param {boolean}  [starred]   is this coin in the user's favourites
 * @param {function} [onStar]    when present, the star button is rendered
 * @param {string}   [starLabel] translated aria-label for the star
 */
export default function CoinRow({
  coin,
  onClick,
  showSpark = true,
  rank,
  metric = null,
  starred = false,
  onStar,
  starLabel = ''
}) {
  const up = coin.change24h >= 0;
  const open = () => onClick?.(coin);

  return (
    <motion.div
      className={`coin-row${onStar ? ' coin-row--starrable' : ''}`}
      variants={riseIn}
      whileTap={{ scale: 0.985 }}
      data-coin-id={coin.id}
    >
      <button
        type="button"
        className="coin-row-open"
        onClick={open}
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

        {showSpark && (
          <span className="coin-row-spark" aria-hidden="true">
            <Sparkline data={coin.sparkline?.slice(-40) ?? []} up={up} width={58} height={26} />
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

      {onStar && (
        <button
          type="button"
          className={`coin-row-star${starred ? ' is-on' : ''}`}
          onClick={(event) => {
            /* The star is a sibling of the navigation button, not a child, so
               there is no parent handler to swallow — but the row it sits in
               also sits inside the list's stagger container, and stopping the
               propagation here keeps a future row-level handler from ever
               toggling a favourite by accident. */
            event.stopPropagation();
            onStar(coin);
          }}
          aria-pressed={starred}
          aria-label={starLabel}
          data-testid={`market-star-${coin.id}`}
        >
          <IconStar />
        </button>
      )}
    </motion.div>
  );
}
