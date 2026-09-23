import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { fmtPct, fmtPrice, fmtUsd } from '../lib/format';
import { feePercentString, FEE_BPS } from '../lib/feeBps';
import { canonicalizeRwa, rwaCounterSymbol } from '../lib/rwaTokens';
import TokenIcon from '../lib/tokenIcon';
import { IconSwap } from './Icons';

/**
 * One tradeable RWA.
 *
 * The buy control names the asset you pay WITH (USDT / USDG), stays on one
 * line, and shares the row with Details via `.btn-row` — `.btn` is width 100%,
 * so a bare flex:1 neighbour collapses and wraps the label.
 */
export default function RwaRow({ token: raw, amountUsd = 1000, onBuy, onSelect }) {
  const { t } = useTranslation();
  const token = canonicalizeRwa(raw);
  if (!token) return null;

  const up = (token.change24h ?? 0) >= 0;
  const feePct = feePercentString(token.feeBps || FEE_BPS);
  const feeDecimal = (token.feeBps || FEE_BPS) / 10000;
  const price = Number(token.price);
  const pay = rwaCounterSymbol(token);
  const units = Number.isFinite(price) && price > 0 && amountUsd > 0
    ? (Number(amountUsd) * (1 - feeDecimal)) / price
    : null;
  const chainLabel = t(`stocks.rwaChain.${token.chainId}`, { defaultValue: token.chainName || '—' });

  return (
    <motion.article
      className="rwa-card"
      variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}
      onClick={() => onSelect?.(token)}
    >
      <div className="rwa-card-head">
        <span className="rwa-logo" aria-hidden="true">
          <TokenIcon token={token} chainId={token.chainId} size={40} />
        </span>
        <div className="rwa-card-id">
          <div className="rwa-card-name">{token.name}</div>
          <div className="rwa-card-sym mono">
            <span>{token.symbol}</span>
            <span className="faint">·</span>
            <span className="faint">{chainLabel}</span>
          </div>
        </div>
        <div className="rwa-card-px">
          <div className="mono eq-price">
            {Number.isFinite(price) ? `$${fmtPrice(price)}` : '—'}
          </div>
          <div className={`mono ${up ? 'up' : 'down'}`}>
            {token.change24h != null && Number.isFinite(Number(token.change24h))
              ? fmtPct(token.change24h, 1)
              : '—'}
          </div>
        </div>
      </div>

      <div className="rwa-chips">
        <span className="pill pill-neutral">{t(`stocks.rwaCategory.${token.category}`, token.category)}</span>
        <span className="pill pill-neutral">{chainLabel}</span>
        <span className="pill pill-up mono">{feePct}% {t('stocks.rwaFeeChip')}</span>
      </div>

      {token.backing && <p className="rwa-card-backing">{token.backing}</p>}

      {units != null && (
        <div className="rwa-calc">
          <span className="rwa-calc-label">{t('stocks.wouldGet', { amount: fmtUsd(amountUsd) })}</span>
          <span className="mono rwa-calc-num">
            {units < 0.01 ? units.toFixed(4) : units.toFixed(2)}
            <span className="faint"> {token.symbol}</span>
          </span>
        </div>
      )}

      <div className="btn-row rwa-actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={(e) => {
            e.stopPropagation();
            onBuy?.(token, amountUsd);
          }}
        >
          <IconSwap width={15} height={15} />
          <span>{t('stocks.rwaBuyWith', { sym: pay })}</span>
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-row-minor"
          onClick={(e) => {
            e.stopPropagation();
            onSelect?.(token);
          }}
        >
          {t('stocks.rwaDetailsCta')}
        </button>
      </div>
    </motion.article>
  );
}
