import './IntentLendingReview.css';

const STATUS = Object.freeze({
  live: { en: 'LIVE', fa: 'زنده', tone: 'live' },
  partial: { en: 'PARTIAL', fa: 'ناقص', tone: 'partial' },
  stale: { en: 'STALE', fa: 'کهنه', tone: 'stale' },
  empty: { en: 'NO DATA', fa: 'بدون داده', tone: 'unavailable' },
  unavailable: { en: 'UNAVAILABLE', fa: 'در دسترس نیست', tone: 'unavailable' },
  catalog: { en: 'REGISTRY', fa: 'فهرست پشتیبانی', tone: 'catalog' }
});

function number(value, locale, digits = 2) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '—';
  return parsed.toLocaleString(locale, { maximumFractionDigits: digits });
}

function usd(value, locale) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '—';
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(parsed);
}

function statusMeta(value, fa) {
  const status = STATUS[String(value || 'unavailable').toLowerCase()] || STATUS.unavailable;
  return { text: fa ? status.fa : status.en, tone: status.tone };
}

function StatusPill({ value, fa }) {
  const meta = statusMeta(value, fa);
  return <span className={`ialr-status ialr-status-${meta.tone}`}>{meta.text}</span>;
}

export function LendingMarketsCard({ data = {}, locale = 'fa' }) {
  const fa = String(locale).startsWith('fa');
  const markets = Array.isArray(data.markets) ? data.markets : [];
  const supported = Array.isArray(data.supportedMarkets) ? data.supportedMarkets : [];
  const rows = markets.filter((row) => row && (row.symbol || row.id));
  const fetchedAt = Number(data.fetchedAt);
  return (
    <section className="ialr-market-card" data-testid="intent-ai-lending-markets">
      <header className="ialr-market-header">
        <div>
          <strong>{fa ? 'نرخ‌های وام و تأمین نقدینگی' : 'Lending & supply rates'}</strong>
          <span>{fa ? 'خواندن مستقیم از reserveهای Aave' : 'Direct Aave reserve reads'}</span>
        </div>
        <StatusPill value={data.status} fa={fa} />
      </header>
      {rows.length ? (
        <div className="ialr-market-list">
          {rows.map((row, index) => {
            const supplyStatus = row.rateStatus || row.dataStatus;
            const borrowStatus = row.borrowRateStatus || 'unavailable';
            const priceStatus = row.priceStatus || 'unavailable';
            const supplyFresh = ['live', 'partial', 'stale'].includes(String(supplyStatus).toLowerCase());
            const borrowFresh = ['live', 'partial', 'stale'].includes(String(borrowStatus).toLowerCase());
            return (
              <div className="ialr-market-row" key={`${row.chainId || row.chain}:${row.symbol}:${row.reserveAddress || index}`}>
                <div className="ialr-market-identity">
                  <strong>{row.symbol || '—'}</strong>
                  <span>{row.protocol || 'Aave V3'} · {row.chainName || row.chain || row.chainId || '—'}</span>
                </div>
                <div className="ialr-rate-cell">
                  <small>{fa ? 'تأمین' : 'Supply'}</small>
                  <span>{supplyFresh && row.supplyApyPct != null ? `${number(row.supplyApyPct, locale, 3)}%` : '—'}</span>
                  <StatusPill value={supplyStatus} fa={fa} />
                </div>
                <div className="ialr-rate-cell">
                  <small>{fa ? 'وام‌گیری' : 'Borrow'}</small>
                  <span>{borrowFresh && row.borrowApyPct != null ? `${number(row.borrowApyPct, locale, 3)}%` : '—'}</span>
                  <StatusPill value={borrowStatus} fa={fa} />
                </div>
                <div className="ialr-market-meta">
                  <span>{fa ? 'قیمت' : 'Oracle price'}: {priceStatus === 'live' ? usd(row.priceUsd, locale) : '—'}</span>
                  {row.utilizationPct != null ? <span>{fa ? 'استفاده' : 'Utilization'}: {number(row.utilizationPct, locale, 1)}%</span> : null}
                  {row.fetchedAt ? <span>{fa ? 'خوانده‌شده' : 'Read'}: {new Date(row.fetchedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</span> : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="ialr-empty">{fa ? 'نرخ زنده‌ای برای این شبکه دریافت نشد.' : 'No live reserve rates were returned for this network.'}</p>
      )}
      {supported.length ? (
        <div className="ialr-registry">
          <div><span>{fa ? 'رجیستری دارایی‌های پشتیبانی‌شده' : 'Supported-asset registry'}</span><StatusPill value="catalog" fa={fa} /></div>
          <p>{supported.map((row) => row.symbol).filter(Boolean).join(' · ')}</p>
          <small>{fa ? 'این فهرست به‌تنهایی نرخ یا نقدینگی زنده را اثبات نمی‌کند.' : 'This list alone does not prove a live rate or available liquidity.'}</small>
        </div>
      ) : null}
      <footer className="ialr-market-footnote">
        {fa ? 'نرخ‌ها متغیرند و تضمین سود نیستند. خواندن reserve به‌تنهایی تضمین اجرای تراکنش نیست.' : 'Rates vary and are not guaranteed returns. A reserve read does not guarantee execution.'}
        {Number.isFinite(fetchedAt) && fetchedAt > 0 ? <time dateTime={new Date(fetchedAt).toISOString()} /> : null}
      </footer>
    </section>
  );
}

export function LendingActionReviewCard({ review = {}, locale = 'fa' }) {
  const fa = String(locale).startsWith('fa');
  const borrow = review.side === 'borrow';
  const readTime = Number(review.fetchedAt);
  return (
    <section className="ialr-review" data-testid="intent-ai-lending-review">
      <div className="ialr-review-title">
        <span className="ialr-review-icon">{borrow ? '↗' : '↓'}</span>
        <div>
          <strong>{borrow ? (fa ? 'بررسی وام‌گیری' : 'Borrow review') : (fa ? 'بررسی تأمین نقدینگی' : 'Supply review')}</strong>
          <span>{review.protocol || 'Aave V3'} · {review.chainName || review.chainId}</span>
        </div>
        <StatusPill value={review.rateStatus} fa={fa} />
      </div>
      <div className="ialr-review-amount">
        <strong>{number(review.amount, locale, Number.isInteger(Number(review.decimals)) ? Math.min(Number(review.decimals), 8) : 6)} {review.symbol}</strong>
        <span>≈ {usd(review.amountUsd, locale)}</span>
      </div>
      <div className="ialr-review-grid">
        <div><small>{fa ? 'قیمت Oracle' : 'Oracle price'}</small><strong>{usd(review.priceUsd, locale)}</strong></div>
        <div><small>{borrow ? (fa ? 'هزینهٔ سالانهٔ متغیر' : 'Variable annual borrow rate') : (fa ? 'نرخ سالانهٔ متغیر' : 'Variable annual supply rate')}</small><strong>{number(review.ratePct, locale, 3)}% APY</strong></div>
        {borrow ? (
          <>
            <div><small>{fa ? 'ظرفیت وامِ خوانده‌شده' : 'Observed borrow capacity'}</small><strong>{usd(review.availableBorrowsUsd, locale)}</strong></div>
            <div><small>{fa ? 'Health Factor برآوردی پس از وام' : 'Projected health factor'}</small><strong className={Number(review.projectedHealthFactor) < 1.5 ? 'ialr-risk-text' : ''}>{number(review.projectedHealthFactor, locale, 2)}</strong></div>
          </>
        ) : (
          <div className="ialr-review-wide"><small>{fa ? 'موجودی فعلی کیف پول' : 'Current wallet balance'}</small><strong>{number(review.walletBalance, locale, 8)} {review.symbol}</strong></div>
        )}
      </div>
      <div className="ialr-review-warning">
        {borrow
          ? (fa ? 'وام نرخ متغیر و ریسک لیکوییدیشن دارد. Health Factor تقریبی است؛ وضعیت pool و اوراکل پیش از اجرا دوباره بررسی می‌شود.' : 'Borrowing has variable rates and liquidation risk. Health factor is an estimate; pool and oracle state will be rechecked before execution.')
          : (fa ? 'نرخ تأمین نقدینگی متغیر است و برداشت به نقدینگی pool وابسته است. مبلغ، موجودی و reserve پیش از اجرا دوباره بررسی می‌شوند.' : 'Supply rates vary and withdrawal depends on pool liquidity. Amount, balance, and reserve state will be rechecked before execution.')}
      </div>
      <div className="ialr-review-foot">
        <span>{fa ? 'پیش‌نمایش، نه ارسال' : 'Review only — not submitted'}</span>
        {Number.isFinite(readTime) && readTime > 0 ? <time>{new Date(readTime).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })}</time> : null}
      </div>
    </section>
  );
}

export default LendingActionReviewCard;
