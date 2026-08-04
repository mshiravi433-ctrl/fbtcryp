import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { fmtCompact, fmtPct, fmtPrice, fmtUsd } from '../lib/format';
import { liquidityVerdict } from '../lib/solanaAssets';
import TokenIcon from '../lib/tokenIcon';
import { IconSwap } from './Icons';

/**
 * One tokenized equity row.
 *
 * ─── WHY LIQUIDITY IS ON THE ROW AND NOT IN A TOOLTIP ───────────────────────
 * These markets are thin and the thinness is uneven in a way the price does
 * not show. Measured from the live feed:
 *
 *   SPYx  $2.8m      NVDAx $2.0m      TSLAx $931k      AAPLx $80k
 *
 * A $2,000 order is nothing against SPYx and is 2.5% of the entire AAPLx book.
 * Same screen, same-looking buttons, thirty-five times the price impact. A
 * user cannot infer that from a $310 share price, so it is printed on the row.
 *
 * ─── WHY THE SIZE GATE REFUSES INSTEAD OF WARNING ───────────────────────────
 * Above 2% of pool depth the price impact exceeds our own 0.7% fee several
 * times over. Quoting anyway and letting someone discover it in the
 * confirmation screen is the behaviour of a venue that does not care. The
 * button disables and names the largest size that would work, so the user gets
 * a number rather than only a refusal.
 */
export default function EquityRow({ asset, amountUsd, onBuy }) {
  const { t } = useTranslation();

  const verdict = liquidityVerdict(asset.liquidity, amountUsd);
  const up = (asset.change24h ?? 0) >= 0;

  /*
   * WHAT THE CHOSEN AMOUNT ACTUALLY BUYS.
   *
   * The amount selector above the list used to feed ONLY the depth gate, so
   * picking $100 / $1,000 / $10,000 silently changed whether the button was
   * enabled and displayed no number at all. The owner reported it as "it
   * doesn't say how much" — correctly: a control that changes nothing visible
   * reads as broken.
   *
   * Unlike the Farm rows there is no yield to project here. A share is not an
   * income product, and inventing an expected return for Apple stock would be
   * a forecast — the one thing this codebase refuses to emit. So the honest
   * answer to "what do I get for $1,000" is the QUANTITY, which is a fact.
   */
  const price = Number(asset.usdPrice);
  const units = Number.isFinite(price) && price > 0 ? Number(amountUsd) / price : null;

  return (
    <motion.div className="eq-row" variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}>
      <div className="row-between" style={{ gap: 10, alignItems: 'flex-start' }}>
        <div className="row" style={{ gap: 10, minWidth: 0 }}>
          {/*
            TokenIcon, not a bare <img>.
            A raw tag with no onError leaves an empty circle when the issuer's
            CDN fails, which reads as broken rather than as a placeholder —
            the exact bug documented at the top of lib/tokenIcon.jsx. That
            component walks its candidate list and always ends on a readable
            monogram.
          */}
          <TokenIcon token={asset} size={34} />
          <div style={{ minWidth: 0 }}>
            <div className="eq-name">{asset.name}</div>
            <div className="set-row-sub mono">{asset.symbol}</div>
          </div>
        </div>
        <div style={{ textAlign: 'end', flexShrink: 0 }}>
          <div className="mono eq-price">${fmtPrice(asset.usdPrice)}</div>
          <div className={`mono ${up ? 'up' : 'down'}`} style={{ fontSize: 11 }}>
            {fmtPct(asset.change24h ?? 0, 1)}
          </div>
        </div>
      </div>

      <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        {/*
          An index tracker is a materially different risk from a single
          company, and labelling it is the cheapest useful thing on this row.
        */}
        {/* Gold is neither an index nor a company, and mislabelling it as
            "single company" would be plainly wrong. */}
        <span className="pill pill-neutral">
          {t(
            asset.unit
              ? 'stocks.kindCommodity'
              : asset.kind === 'index'
                ? 'stocks.kindIndex'
                : 'stocks.kindSingle'
          )}
        </span>
        <span className={`pill ${asset.liquidity < 150_000 ? 'pill-down' : 'pill-neutral'}`}>
          {t('stocks.depth')} {fmtCompact(asset.liquidity)}
        </span>
      </div>

      {/*
        The answer to the amount selector.

        Rendered even when the depth gate refuses the order, because "you would
        get 3.2 shares, but not at this size" is more informative than the
        number disappearing — and its disappearing is what made the selector
        look dead in the first place.
      */}
      {units != null && (
        <div className="farm-calc">
          <span className="faint">{t('stocks.wouldGet', { amount: fmtUsd(amountUsd) })}</span>
          <span className="mono farm-calc-num">
            {units < 0.01 ? units.toFixed(4) : units.toFixed(2)}
            <span className="faint"> {asset.symbol}</span>
          </span>
        </div>
      )}

      {/*
        SpaceX is private: no exchange listing, no public quote to check this
        price against. That is simultaneously the reason it is interesting —
        this access does not exist through any broker — and a real extra risk,
        so it is stated on the row rather than smoothed over.
      */}
      {asset.privateCompany && <p className="eq-toobig">{t('stocks.privateCompany')}</p>}

      {/* Only rendered when the chosen size is actually a problem. */}
      {!verdict.ok && verdict.reason === 'tooBig' && (
        <p className="eq-toobig">
          {t('stocks.tooBig', {
            pct: (verdict.share * 100).toFixed(1),
            max: fmtCompact(verdict.maxUsd)
          })}
        </p>
      )}

      <button
        className="btn btn-ghost eq-buy"
        disabled={!verdict.ok}
        onClick={() => onBuy(asset)}
      >
        <IconSwap width={15} height={15} />
        {t('stocks.buyWith', { sym: asset.symbol })}
      </button>
    </motion.div>
  );
}
