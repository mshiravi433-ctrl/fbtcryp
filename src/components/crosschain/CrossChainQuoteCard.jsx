import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fmtUsd } from '../../lib/format';
import { fromBaseUnits, quoteSecondsLeft } from '../../services/cross-chain';

/**
 * THE QUOTE, ITEMISED.
 * ---------------------------------------------------------------------------
 * Rendered identically on the Intent OS cross-chain desk and the bridge page,
 * from the same normalised object, because the previous state of the world was
 * a single number labelled «نرخ پل» that came from a hard-coded literal.
 *
 * ─── WHY EVERY LINE IS SEPARATE ─────────────────────────────────────────────
 * A cross-chain transfer carries several distinct costs: the bridge's own fee,
 * the protocol/integrator fee (ours included), and chain gas. "You receive X"
 * alone is technically honest and still hides the thing people complain about
 * afterwards — that it cost more than they expected. Each part is named, and
 * the ones that must be paid IN NATIVE COIN on top are called out separately,
 * because that is a different requirement from a fee deducted on the way.
 *
 * ─── THE COUNTDOWN IS NOT DECORATION ────────────────────────────────────────
 * A rate with no expiry is a lie with a long fuse. The quote carries
 * `expiresAt`; this component shows the remaining seconds and the parent
 * re-quotes when it hits zero.
 */
export default function CrossChainQuoteCard({ quote, expired = false, refreshing = false, compact = false }) {
  const { t } = useTranslation();
  const [, setTick] = useState(0);

  /* One re-render a second, only while a quote is on screen. */
  useEffect(() => {
    if (!quote?.expiresAt) return undefined;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [quote?.expiresAt]);

  if (!quote) return null;

  const decimals = quote.toTokenDetail?.decimals ?? null;
  const receive = decimals != null ? fromBaseUnits(quote.toAmount, decimals) : null;
  const receiveMin = decimals != null && quote.toAmountMin ? fromBaseUnits(quote.toAmountMin, decimals) : null;
  const symbol = quote.toTokenDetail?.symbol ?? '';
  const seconds = quoteSecondsLeft(quote);

  const round = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n === 0) return null;
    return n;
  };

  return (
    <div className={`xcc-quote${compact ? ' xcc-quote-compact' : ''}`}>
      <div className="xcc-quote-head">
        <span className="xcc-quote-label">{t('crossChain.youReceive', { defaultValue: 'You receive' })}</span>
        <strong className="xcc-quote-out" dir="ltr">
          ≈ {receive != null ? Number(receive).toLocaleString(undefined, { maximumFractionDigits: 8 }) : '—'} {symbol}
        </strong>
      </div>

      {quote.toAmountUsd > 0 && (
        <div className="xcc-row">
          <span>{t('crossChain.value', { defaultValue: 'Value' })}</span>
          <span className="mono">{fmtUsd(quote.toAmountUsd)}</span>
        </div>
      )}

      {receiveMin != null && (
        <div className="xcc-row">
          <span>{t('crossChain.minimumReceived', { defaultValue: 'Minimum received' })}</span>
          <span className="mono" dir="ltr">{Number(receiveMin).toLocaleString(undefined, { maximumFractionDigits: 8 })} {symbol}</span>
        </div>
      )}

      {round(quote.gasCostUsd) != null && (
        <div className="xcc-row">
          <span>{t('crossChain.networkFee', { defaultValue: 'Network fee (gas)' })}</span>
          <span className="mono">{fmtUsd(quote.gasCostUsd)}</span>
        </div>
      )}

      {round(quote.bridgeFeeUsd) != null && (
        <div className="xcc-row">
          <span>{t('crossChain.bridgeFee', { defaultValue: 'Bridge / route fee' })}</span>
          <span className="mono">{fmtUsd(quote.bridgeFeeUsd)}</span>
        </div>
      )}

      {round(quote.protocolFeeUsd) != null && (
        <div className="xcc-row">
          <span>{t('crossChain.protocolFee', { defaultValue: 'Protocol fee' })}</span>
          <span className="mono">{fmtUsd(quote.protocolFeeUsd)}</span>
        </div>
      )}

      {/* Our own cut, named. A fee the user cannot see is a fee they will feel
          tricked by later — and this number is read out of the provider's fee
          split, not repeated from our configuration. */}
      {round(quote.integratorFeeUsd) != null && (
        <div className="xcc-row">
          <span>{t('crossChain.fbtFee', { defaultValue: 'FBT fee (included above)' })}</span>
          <span className="mono">{fmtUsd(quote.integratorFeeUsd)}</span>
        </div>
      )}

      {round(quote.payableFeeUsd) != null && (
        <div className="xcc-row xcc-row-warn">
          <span>{t('crossChain.payableFee', { defaultValue: 'Payable on top (native coin)' })}</span>
          <span className="mono">{fmtUsd(quote.payableFeeUsd)}</span>
        </div>
      )}

      {quote.slippage != null && (
        <div className="xcc-row">
          <span>{t('crossChain.slippage', { defaultValue: 'Slippage' })}</span>
          <span className="mono">{(Number(quote.slippage) * 100).toFixed(2)}%</span>
        </div>
      )}

      {quote.estimatedTime != null && (
        <div className="xcc-row">
          <span>{t('crossChain.estimatedTime', { defaultValue: 'Estimated time' })}</span>
          <span className="mono">~{quote.estimatedTime < 90 ? `${quote.estimatedTime}s` : `${Math.round(quote.estimatedTime / 60)}m`}</span>
        </div>
      )}

      <div className="xcc-row">
        <span>{t('crossChain.route', { defaultValue: 'Route' })}</span>
        <span className="mono" dir="ltr">
          {(quote.provider || 'lifi').toUpperCase()} · {quote.toolName || quote.tool || '—'}
        </span>
      </div>

      {/* The honest state of the number on screen. */}
      <div className={`xcc-quote-age${expired ? ' expired' : ''}`}>
        {refreshing
          ? t('crossChain.refreshing', { defaultValue: 'Refreshing rate…' })
          : expired || seconds <= 0
            ? t('crossChain.expiredNotice', { defaultValue: 'The previous rate expired. Fetching a new rate…' })
            : t('crossChain.validFor', { defaultValue: 'Rate valid for {{seconds}}s', seconds })}
      </div>

      {quote.indicative && (
        <p className="xcc-note">
          {t('crossChain.indicativeNote', {
            defaultValue: 'Indicative rate — connect a wallet to get an executable quote for your address.'
          })}
        </p>
      )}
    </div>
  );
}
