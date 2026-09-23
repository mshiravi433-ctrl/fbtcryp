import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { fmtPct, fmtPrice, fmtUsd } from '../lib/format';
import { feePercentString, FEE_BPS } from '../lib/feeBps';
import CoinLogo from './CoinLogo';
import { IconSwap } from './Icons';

/**
 * RwaRow — Displays one tradeable Real-World Asset (RWA) token with live pricing,
 * category badges, underlying backing details, calculated token yield/quantity for
 * the selected amount, and direct non-custodial swap actions with our 0.70% platform fee.
 */
export default function RwaRow({ token, amountUsd = 1000, onBuy, onSelect }) {
  const { t } = useTranslation();
  const up = (token.change24h ?? 0) >= 0;
  const feePct = feePercentString(token.feeBps || FEE_BPS);
  const feeDecimal = (token.feeBps || FEE_BPS) / 10000;

  const price = Number(token.price);
  const units = Number.isFinite(price) && price > 0 && amountUsd > 0
    ? (Number(amountUsd) * (1 - feeDecimal)) / price
    : null;

  return (
    <motion.div
      className="eq-row"
      variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}
      style={{ cursor: 'pointer' }}
      onClick={() => onSelect?.(token)}
    >
      <div className="row-between" style={{ gap: 10, alignItems: 'flex-start' }}>
        <div className="row" style={{ gap: 10, minWidth: 0 }}>
          <CoinLogo
            coin={token.coingeckoId ? { id: token.coingeckoId, symbol: token.symbol } : undefined}
            ticker={token.symbol}
            px={36}
          />
          <div style={{ minWidth: 0 }}>
            <div className="eq-name" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span>{token.name}</span>
            </div>
            <div className="set-row-sub mono" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>{token.symbol}</span>
              <span className="faint">·</span>
              <span className="faint">{token.chainName}</span>
            </div>
          </div>
        </div>
        <div style={{ textAlign: 'end', flexShrink: 0 }}>
          <div className="mono eq-price">
            {token.price != null && Number.isFinite(Number(token.price))
              ? `$${fmtPrice(token.price)}`
              : '—'}
          </div>
          <div className={`mono ${up ? 'up' : 'down'}`} style={{ fontSize: 11 }}>
            {token.change24h != null && Number.isFinite(Number(token.change24h))
              ? fmtPct(token.change24h, 1)
              : '—'}
          </div>
        </div>
      </div>

      <div className="row" style={{ gap: 6, marginTop: 9, flexWrap: 'wrap' }}>
        <span className="pill pill-neutral">
          {t(`stocks.rwaCategory.${token.category}`, token.category)}
        </span>
        <span className="pill pill-neutral">
          {token.chainName}
        </span>
        {token.backing && (
          <span className="pill pill-neutral faint" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {token.backing}
          </span>
        )}
        <span className="pill pill-success mono" style={{ fontSize: 10.5 }}>
          {feePct}% {t('swap.platformFeeLabel', 'کارمزد FBT')}
        </span>
      </div>

      {token.description && (
        <p className="faint" style={{ fontSize: 11.4, margin: '8px 0 0', lineHeight: 1.6 }}>
          {token.description}
        </p>
      )}

      {/* Calculated token units for the user-selected amount */}
      {units != null && (
        <div className="farm-calc" style={{ marginTop: 9 }}>
          <span className="faint">{t('stocks.wouldGet', { amount: fmtUsd(amountUsd) })}</span>
          <span className="mono farm-calc-num">
            {units < 0.01 ? units.toFixed(4) : units.toFixed(2)}
            <span className="faint"> {token.symbol}</span>
          </span>
        </div>
      )}

      <div className="row" style={{ gap: 8, marginTop: 11 }}>
        <button
          type="button"
          className="btn btn-ghost eq-buy"
          style={{ flex: 1 }}
          onClick={(e) => {
            e.stopPropagation();
            onBuy?.(token, amountUsd);
          }}
        >
          <IconSwap width={15} height={15} />
          <span>{t('stocks.buyWith', { sym: token.symbol })}</span>
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ padding: '0 12px', fontSize: 12 }}
          onClick={(e) => {
            e.stopPropagation();
            onSelect?.(token);
          }}
        >
          {t('stocks.rwaDetailsCta', 'مشخصات')}
        </button>
      </div>
    </motion.div>
  );
}
