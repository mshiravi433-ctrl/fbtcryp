import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { fmtCompact, fmtPct, fmtPrice } from '../lib/format';
import { liquidityVerdict } from '../lib/solanaAssets';
import { IconSwap } from './Icons';

/**
 * One tokenized equity row.
 *
 * ─── WHY LIQUIDITY IS ON THE ROW AND NOT IN A TOOLTIP ───────────────────────
 * These markets are thin and the thinness is uneven in a way the price does
 * not show. Measured from the live feed on the day this was built:
 *
 *   SPYx  $2.8m      NVDAx $2.0m      TSLAx $924k      AAPLx $80k
 *
 * A $2,000 order is nothing against SPYx and is 2.5% of the entire AAPLx book.
 * Same screen, same-looking buttons, thirty-five times the price impact. A
 * user cannot infer that from a $309 share price, so it is printed on the row.
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

  return (
    <motion.div className="eq-row" variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}>
      <div className="row-between" style={{ gap: 10, alignItems: 'flex-start' }}>
        <div className="row" style={{ gap: 10, minWidth: 0 }}>
          <div className="coin-logo">
            {asset.icon ? <img src={asset.icon} alt="" /> : asset.symbol.slice(0, 3)}
          </div>
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
        <span className="pill pill-neutral">
          {t(asset.kind === 'index' ? 'stocks.kindIndex' : 'stocks.kindSingle')}
        </span>
        <span className={`pill ${asset.liquidity < 150_000 ? 'pill-down' : 'pill-neutral'}`}>
          {t('stocks.depth')} {fmtCompact(asset.liquidity)}
        </span>
      </div>

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
