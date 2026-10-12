import { useTranslation } from 'react-i18next';
import { fmtPct, fmtPrice } from '../lib/format';
import TokenIcon from '../lib/tokenIcon';
import { IconSwap } from './Icons';
import { feePercentString } from '../lib/feeBps';
import '../styles/stock-tokens.css';

/**
 * ONE TOKENIZED STOCK, AS A CARD.
 *
 * ─── WHY THE BOARD IS CARDS AND NOT ROWS ANY MORE ───────────────────────────
 * «باکسهایش را با قیمت و مدرنتر کن، فاصله و اندازهاش را درست کن». The old
 * board was 18 near-identical list rows: a ticker, a company name, a tiny «—»
 * where a price should be, and a Buy button jammed against the right edge. Two
 * things were wrong with it and only one of them was cosmetic:
 *
 *   1. IT HAD NO PRICE. The rail's only quote was the company's SHARE price
 *      matched by ticker against a ~40-name feed, so most of the ~200 contracts
 *      printed «—». The card now shows the TOKEN's own market price
 *      (lib/stockPrices.js), and falls back to the share reference — labelled
 *      «مرجع», because it is a different number about a different thing — and
 *      to «—» when there is neither. Three states, all of them honest.
 *   2. THE ROWS WERE TOO WIDE FOR WHAT THEY HELD. A full-width row for a ticker
 *      and a price wastes the only axis a price board wants: columns. A grid of
 *      cards puts two on a phone screen and six on a desktop, which is what
 *      makes 200 contracts scannable instead of a scroll.
 *
 * ─── THE VISUAL RULES, AND WHY EACH ONE IS THERE ────────────────────────────
 *   · The 2px top accent is GREEN or RED with the 24h move, and neutral when we
 *     have no price at all. Direction is readable before any number is.
 *   · The accent is a static gradient, not an animation: this board can paint
 *     24 cards at once and a moving border on each of them is main-thread work
 *     for a decoration (the same argument the .card-rgb steps(90) comment makes).
 *   · The price is monospace and the largest thing on the card — it is the
 *     reason the card exists. The ticker and the company name are ranked below
 *     it, and the contract address sits under both, quiet but always present:
 *     the address is the identity, and the symbol is not.
 *   · A reference price is NEVER shown as if it were the token's price. It
 *     carries the «مرجع» tag, plus «بسته» when the share market is closed — a
 *     stale share quote with no label is how a screen lies without a single
 *     false sentence on it.
 */
export default function StockTokenCard({ token, market, reference, loading = false, onBuy }) {
  const { t } = useTranslation();

  /*
   * The market price wins when we have one; the share reference is the fallback
   * and is tagged. `reference` arrives only for tokens with no market price —
   * the page decides that, so this component never has to know which source
   * answered first.
   *
   * BOTH are validated here rather than trusted, because 0 is the shape a
   * missing number takes on the way in and `fmtPrice(0)` renders a perfectly
   * plausible "$0". lib/stockPrices.js refuses a zero price and
   * `referencePriceFor` returns null for one, so this is the third lock on the
   * same door — the card is the only thing that prints, so it is the last place
   * that has to refuse.
   */
  const usable = (p) => (p && Number.isFinite(Number(p.price)) && Number(p.price) > 0 ? p : null);
  const shown = usable(market) ?? (usable(reference) ? { ...reference, kind: 'reference' } : null);
  const change = shown?.change24h;
  const up = Number.isFinite(change) ? change >= 0 : null;
  const addr = `${token.address.slice(0, 6)}…${token.address.slice(-4)}`;

  return (
    <div
      className={`stk-card ${up === true ? 'is-up' : up === false ? 'is-down' : 'is-flat'} ${loading ? 'is-loading' : ''}`}
      data-testid="stk-card"
      role="button"
      tabIndex={0}
      onClick={() => onBuy(token)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onBuy(token);
        }
      }}
    >
      <div className="stk-top">
        <TokenIcon token={token} chainId={token.chainId} size={30} />
        <div className="stk-id">
          <div className="stk-sym">{token.symbol}</div>
          <div className="stk-name" dir="ltr" title={token.name}>{token.name}</div>
        </div>
      </div>

      <div className="stk-value">
        {shown ? (
          <span className="stk-price mono">${fmtPrice(shown.price)}</span>
        ) : loading ? (
          /* A skeleton, not a dash: while the prices are in flight a «—» reads
             as "this token has no market", which is a different and wrong
             statement. */
          <span className="stk-skel" aria-hidden="true" />
        ) : (
          <span className="stk-price stk-noprice mono">—</span>
        )}
        {Number.isFinite(change) && (
          <span className={`stk-chip mono ${up ? 'up' : 'down'}`}>
            {fmtPct(change, 1)}
          </span>
        )}
      </div>

      <div className="stk-meta">
        <span className="stk-addr mono">{addr}</span>
        {shown?.kind === 'reference' && (
          <>
            <span className="stk-tag stk-tag-ref">{t('stocks.rhRefTag')}</span>
            {reference?.marketOpen === false && (
              <span className="stk-tag">{t('stocks.ref.closed')}</span>
            )}
          </>
        )}
      </div>

      <button
        type="button"
        className="btn btn-primary stk-buy"
        aria-label={t('stocks.rwaQuickBuy', { sym: token.symbol, pay: 'USDG', fee: feePercentString() })}
        onClick={(e) => { e.stopPropagation(); onBuy(token); }}
      >
        <IconSwap width={13} height={13} />
        <span>{t('stocks.rhBuy')}</span>
      </button>
    </div>
  );
}
