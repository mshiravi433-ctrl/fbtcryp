const SCHEMA = 'fbt.ai-swap-quote-review.v1';

export function formatRawTokenAmount(raw, decimals, locale = 'en') {
  try {
    if (raw === null || raw === undefined || !Number.isInteger(Number(decimals)) || Number(decimals) < 0 || Number(decimals) > 36) return '—';
    const places = Number(decimals);
    const value = BigInt(raw);
    const negative = value < 0n;
    const absolute = negative ? -value : value;
    const scale = 10n ** BigInt(places);
    const whole = absolute / scale;
    const fraction = places ? (absolute % scale).toString().padStart(places, '0').replace(/0+$/, '') : '';
    const wholeText = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(whole);
    if (!fraction) return `${negative ? '−' : ''}${wholeText}`;
    const decimal = new Intl.NumberFormat(locale, { useGrouping: false, minimumFractionDigits: 1, maximumFractionDigits: 1 })
      .formatToParts(1.1).find((part) => part.type === 'decimal')?.value || '.';
    const digitFormatter = new Intl.NumberFormat(locale, { useGrouping: false, maximumFractionDigits: 0 });
    const localizedFraction = [...fraction].map((digit) => digitFormatter.format(Number(digit))).join('');
    return `${negative ? '−' : ''}${wholeText}${decimal}${localizedFraction}`;
  } catch {
    return '—';
  }
}

export function formatReviewTokenAmount(review, kind, locale = 'en') {
  const isInput = kind === 'input';
  const raw = review?.[isInput ? 'amountInWei' : kind === 'fee' ? 'platformFeeWei' : kind === 'minimum' ? 'minOutWei' : 'amountOutWei'];
  const decimals = isInput || kind === 'fee' ? review?.fromDecimals : review?.toDecimals;
  if (raw !== null && raw !== undefined) return formatRawTokenAmount(raw, decimals, locale);
  const value = kind === 'input' ? review?.amountIn
    : kind === 'fee' ? review?.platformFee
      : kind === 'minimum' ? review?.minOut : review?.amountOut;
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat(locale, { maximumFractionDigits: Math.min(12, Math.max(0, Number(decimals) || 0)) }).format(n);
}

export function formatQuoteNumber(value, locale = 'en', maxDigits = 4) {
  const n = Number(value);
  return Number.isFinite(n) ? new Intl.NumberFormat(locale, { maximumFractionDigits: maxDigits }).format(n) : '—';
}

export function quoteReviewSummary(review, locale = 'en', translate = null) {
  const minimum = formatReviewTokenAmount(review, 'minimum', locale);
  const params = {
    minimum,
    to: review?.to || '',
    network: review?.networkName || (locale.startsWith('fa') ? 'شبکه نامشخص' : 'unknown network')
  };
  if (typeof translate === 'function') {
    const localized = translate('intentAIOS.quoteReview.summary', params);
    if (localized && localized !== 'intentAIOS.quoteReview.summary') return localized;
  }
  return locale.startsWith('fa')
    ? `نرخ زنده آمادهٔ بررسی است: حداقل ${params.minimum} ${params.to} روی شبکهٔ ${params.network}. محافظت MEV مستقلانه تأیید نشده؛ پیش از امضا نرخ دوباره بررسی می‌شود.`
    : `A live quote is ready to review: minimum ${params.minimum} ${params.to} on ${params.network}. MEV protection is not independently verified; the quote will be checked again before signing.`;
}

export function IntentSwapQuoteReview({ review, locale = 'en', onRefresh, refreshing = false, refreshDisabled = false, expired = false, t }) {
  if (!review || review.schema !== SCHEMA || typeof t !== 'function') return null;
  const rtl = ['fa', 'ar', 'ur'].includes(String(locale).slice(0, 2));
  const quotedAt = new Date(review.quotedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const expiresAt = new Date(review.expiresAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const feeAmount = review.platformFeeWei != null
    ? `${formatReviewTokenAmount(review, 'fee', locale)} ${review.from} · `
    : (review.platformFee != null ? `${formatQuoteNumber(review.platformFee, locale, 8)} ${review.from} · ` : '');
  const routeLabel = review.routeSource || review.solver || '—';

  return (
    <section className="iaos-quote-review" data-testid="intent-ai-quote-review" aria-label={t('intentAIOS.quoteReview.title')} dir={rtl ? 'rtl' : 'ltr'}>
      <div className="iaos-quote-review-head">
        <div className="iaos-quote-review-title">
          <span className={`iaos-quote-status${expired ? ' is-expired' : ''}`}>
            <i aria-hidden="true" />{t('intentAIOS.quoteReview.title')}
          </span>
          <span className="iaos-quote-timestamp">
            {t('intentAIOS.quoteReview.quotedAt', { time: quotedAt })}
          </span>
        </div>
        <button type="button" className="iaos-quote-refresh" onClick={onRefresh} disabled={refreshing || refreshDisabled} aria-busy={refreshing}>
          {refreshing ? t('intentAIOS.quoteReview.refreshing') : t('intentAIOS.quoteReview.refresh')}
        </button>
      </div>
      <div className="iaos-quote-expiry-line" data-expired={expired ? 'true' : 'false'}>
        {expired
          ? t('intentAIOS.quoteReview.expired')
          : t('intentAIOS.quoteReview.expiresAt', { time: expiresAt })}
      </div>
      <div className="iaos-quote-grid">
        <div className="iaos-quote-line"><span>{t('intentAIOS.quoteReview.from')}</span><strong>{formatReviewTokenAmount(review, 'input', locale)} {review.from}</strong></div>
        <div className="iaos-quote-line"><span>{t('intentAIOS.quoteReview.to')}</span><strong>{formatReviewTokenAmount(review, 'output', locale)} {review.to}</strong></div>
        <div className="iaos-quote-line iaos-quote-min"><span>{t('intentAIOS.quoteReview.minimum')}</span><strong>{formatReviewTokenAmount(review, 'minimum', locale)} {review.to}</strong></div>
        <div className="iaos-quote-line"><span>{t('intentAIOS.quoteReview.network')}</span><strong>{review.networkName || `Chain ${review.chainId}`}</strong></div>
        <div className="iaos-quote-line"><span>{t('intentAIOS.quoteReview.route')}</span><strong>
          {routeLabel}
          {review.solver && review.solver !== review.routeSource ? ` · ${review.solver}` : ''}
          {` · ${t('intentAIOS.quoteReview.sourcesCompared', { count: review.routesChecked || 1 })} · ${t('intentAIOS.quoteReview.hops', { count: review.hops || 1 })}`}
        </strong></div>
        <div className="iaos-quote-line"><span>{t('intentAIOS.quoteReview.platformFee')}</span><strong>
          {feeAmount}{formatQuoteNumber(Number(review.feeBps) / 100, locale, 3)}%
        </strong></div>
        <div className="iaos-quote-line"><span>{t('intentAIOS.quoteReview.slippage')}</span><strong>{formatQuoteNumber(review.slippage, locale, 3)}%</strong></div>
        <div className="iaos-quote-line"><span>{t('intentAIOS.quoteReview.gas')}</span><strong>{review.gasUsd != null ? `$${formatQuoteNumber(review.gasUsd, locale, 2)}` : t('intentAIOS.quoteReview.notReported')}</strong></div>
        <div className="iaos-quote-line"><span>{t('intentAIOS.quoteReview.priceImpact')}</span><strong>{review.priceImpactPct != null ? `${formatQuoteNumber(review.priceImpactPct, locale, 3)}%` : t('intentAIOS.quoteReview.notReported')}</strong></div>
        <div className="iaos-quote-line iaos-quote-mev"><span>{t('intentAIOS.quoteReview.mev')}</span><strong>{t('intentAIOS.quoteReview.mevUnknown')}</strong></div>
      </div>
      <details className="iaos-quote-addresses">
        <summary>{t('intentAIOS.quoteReview.tokenAddresses')}</summary>
        <div><span>{t('intentAIOS.quoteReview.inputToken')}</span><code title={review.fromAddress || ''}>{review.fromNative ? t('intentAIOS.quoteReview.nativeAsset') : review.fromAddress || '—'}</code></div>
        <div><span>{t('intentAIOS.quoteReview.outputToken')}</span><code title={review.toAddress || ''}>{review.toNative ? t('intentAIOS.quoteReview.nativeAsset') : review.toAddress || '—'}</code></div>
      </details>
      <p className="iaos-quote-warning">{t('intentAIOS.quoteReview.warning')}</p>
    </section>
  );
}

export default IntentSwapQuoteReview;
