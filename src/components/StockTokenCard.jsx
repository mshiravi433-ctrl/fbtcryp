import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { fmtPct, fmtPrice } from '../lib/format';
import TokenIcon from '../lib/tokenIcon';
import { IconSwap } from './Icons';
import '../styles/stock-tokens.css';

// fmtPrice rounds everything above $1,000 to a whole dollar. A token/share
// quote can carry cents there too, so preserve up to two here; keep the shared
// formatter for small and sub-cent prices. The exact raw quote is also in the
// title, never substituted with the chart's last sampled value.
const largeQuote = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const quoteText = (price) => price >= 1000 ? largeQuote.format(price) : fmtPrice(price);

/** A real, static line from the token's sampled seven-day market history.
 * Its direction is the SERIES direction, not the unrelated 24h quote change. */
function TokenTrend({ points }) {
  const { line, area } = useMemo(() => {
    const lo = Math.min(...points);
    const hi = Math.max(...points);
    const range = hi - lo;
    const coords = points.map((p, i) => {
      const x = (i * 100) / (points.length - 1);
      const y = range ? 29 - ((p - lo) / range) * 26 : 16;
      return `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ');
    return { line: coords, area: `${coords} L100,34 L0,34 Z` };
  }, [points]);

  return (
    <svg className="stk-trend" viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden="true">
      <path className="stk-trend-guide" d="M0,34 H100" />
      <path className="stk-trend-area" d={area} />
      <path className="stk-trend-line" d={line} />
    </svg>
  );
}

/** One address, one price source and (only when real) one token history.
 * The whole card is ONE semantic button: the visual Buy CTA is not a nested
 * button. Keyboard and pointer activation both hand off the exact contract. */
export default function StockTokenCard({ token, market, reference, chart, loading = false, chartLoading = false, onBuy }) {
  const { t } = useTranslation();
  const usable = (p) => p && Number.isFinite(Number(p.price)) && Number(p.price) > 0 ? p : null;
  const shown = usable(market) ?? (usable(reference) ? { ...reference, kind: 'reference' } : null);
  const marketShown = Boolean(usable(market));
  const change = shown?.change24h;
  const direction = Number.isFinite(change) ? (change > 0 ? 'up' : change < 0 ? 'down' : 'flat') : 'flat';
  const realChart = marketShown && Array.isArray(chart) && chart.length >= 3 &&
    chart.every((p) => typeof p === 'number' && Number.isFinite(p) && p > 0) ? chart : null;
  const chartDirection = realChart ? (realChart.at(-1) >= realChart[0] ? 'up' : 'down') : 'flat';
  const addr = `${token.address.slice(0, 6)}…${token.address.slice(-4)}`;

  return (
    <button
      type="button"
      className={`stk-card is-${direction}${shown?.kind === 'reference' ? ' is-reference' : ''}`}
      data-testid="stk-card"
      onClick={() => onBuy(token)}
    >
      <span className="stk-top">
        <TokenIcon token={token} chainId={token.chainId} size={30} />
        <span className="stk-id">
          <span className="stk-sym mono" dir="ltr" title={token.symbol}>{token.symbol}</span>
          <span className="stk-name" dir="ltr" title={token.name}>{token.name}</span>
        </span>
      </span>

      <span className="stk-quote-label">{shown?.kind === 'reference' ? t('stocks.rhReferencePrice') : t('stocks.rhTokenPrice')}</span>
      <span className="stk-value">
        {shown ? (
          <span className="stk-price mono" dir="ltr" title={`$${shown.price}`}>${quoteText(Number(shown.price))}</span>
        ) : loading ? (
          <span className="stk-skel" aria-label={t('stocks.rhPricesLoading')} />
        ) : (
          <span className="stk-price stk-noprice mono">—</span>
        )}
        {Number.isFinite(change) && (
          <span className={`stk-chip mono ${direction}`} dir="ltr">
            {fmtPct(change, 1)}
          </span>
        )}
      </span>

      <span className={`stk-chart-slot chart-${chartDirection}`}>
        {realChart ? (
          <>
            <TokenTrend points={realChart} />
            <span className="stk-chart-caption">{t('stocks.rhChartWindow')}</span>
          </>
        ) : loading || (chartLoading && marketShown) ? (
          <span className="stk-chart-wait">{t('stocks.rhChartLoading')}</span>
        ) : (
          <span className="stk-chart-empty">{t('stocks.rhChartUnavailable')}</span>
        )}
      </span>

      <span className="stk-meta">
        <span className="stk-addr mono" dir="ltr" title={token.address}>{addr}</span>
        {shown?.kind === 'reference' && (
          <>
            <span className="stk-tag stk-tag-ref">{t('stocks.rhRefTag')}</span>
            {reference?.marketOpen === false && <span className="stk-tag">{t('stocks.ref.closed')}</span>}
          </>
        )}
      </span>

      <span className="stk-buy">
        <IconSwap width={14} height={14} />
        <span>{t('stocks.rhBuy')}</span>
      </span>
    </button>
  );
}
