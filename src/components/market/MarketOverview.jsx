import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import AnimatedNumber from '../AnimatedNumber.jsx';
import CoinLogo from '../CoinLogo.jsx';
import MarketSparkline from './MarketSparkline.jsx';
import { fmtCompact, fmtNum, fmtPct } from '../../lib/format.js';
import { finiteOrNull, marketPrice, positiveOrNull } from '../../lib/marketPresentation.js';

function Change({ value }) {
  const n = finiteOrNull(value);
  if (n == null) return null;
  return (
    <span className="mx-change mono" data-dir={n >= 0 ? 'up' : 'down'}>
      <span aria-hidden="true">{n >= 0 ? '↗' : '↘'}</span>
      {fmtPct(n)}
    </span>
  );
}

function Metric({ label, value, title }) {
  return (
    <div className="mx-metric" title={title}>
      <span className="mx-metric-label">{label}</span>
      <strong className="mono">{value}</strong>
    </div>
  );
}

/**
 * One intelligence panel, two readings: the whole market and Bitcoin.
 * Missing provider fields render as dashes or are omitted; dominance bars are
 * never clamped to invented minimum widths.
 */
function MarketOverview({ global, bitcoin, trend, liveAvgChange, loading, vs = 'usd', onOpenCoin }) {
  const { t } = useTranslation();
  const mcap = positiveOrNull(global?.mcap);
  const volume = positiveOrNull(global?.volume);
  const btcDom = positiveOrNull(global?.btcDominance);
  const ethDom = positiveOrNull(global?.ethDominance);
  const otherDom = btcDom != null || ethDom != null
    ? Math.max(0, 100 - (btcDom ?? 0) - (ethDom ?? 0))
    : null;
  const btcPrice = positiveOrNull(bitcoin?.price);
  const low = positiveOrNull(bitcoin?.low24h);
  const high = positiveOrNull(bitcoin?.high24h);
  const rangePosition = low != null && high != null && high > low && btcPrice != null
    ? Math.min(100, Math.max(0, ((btcPrice - low) / (high - low)) * 100))
    : null;

  return (
    <section className="mx-overview" aria-label={t('marketIntel.overviewAria')} data-testid="market-overview">
      <div className="mx-global" data-testid="market-global-card">
        <div className="mx-global-head">
          <div>
            <span className="mx-kicker">{t('market.totalMcap')}</span>
            <div className="mx-global-value">
              {mcap == null && loading
                ? <span className="mx-skel-value" aria-hidden="true" />
                : <AnimatedNumber value={mcap ?? 0} format={(v) => (mcap == null ? '—' : fmtCompact(v))} flash={false} />}
            </div>
          </div>
          <Change value={global?.mcapChange} />
        </div>

        <div className="mx-global-metrics">
          <Metric label={t('market.volume24h')} value={volume == null ? '—' : fmtCompact(volume)} />
          <Metric label={t('market.btcDominance')} value={btcDom == null ? '—' : `${btcDom.toFixed(1)}%`} />
          <Metric label={t('market.ethDominance')} value={ethDom == null ? '—' : `${ethDom.toFixed(1)}%`} />
        </div>

        {(btcDom != null || ethDom != null) && (
          <div className="mx-dominance" role="img" aria-label={t('market.dominanceAria')}>
            {btcDom != null && <span className="is-btc" style={{ width: `${btcDom}%` }} />}
            {ethDom != null && <span className="is-eth" style={{ width: `${ethDom}%` }} />}
            {otherDom != null && <span className="is-other" style={{ width: `${otherDom}%` }} />}
          </div>
        )}

        {trend && (
          <div className="mx-global-trend" data-testid="global-market-trend">
            <MarketSparkline
              points={trend.points}
              up={trend.changePct >= 0}
              height={56}
              interactive
              label={t('marketIntel.trendAria', { days: trend.days, coins: trend.coins })}
              formatValue={fmtCompact}
              formatTime={(x) => new Date(x).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              testId="global-market-trend-chart"
            />
            <details className="mx-trend-method">
              <summary>
                <span>{t('marketIntel.trendLabel', { days: trend.days, coins: trend.coins })}</span>
                <span className={`mono ${trend.changePct >= 0 ? 'mx-up' : 'mx-down'}`}>{fmtPct(trend.changePct)}</span>
              </summary>
              <p>{t('market.trendNote', { n: trend.coins })}</p>
            </details>
          </div>
        )}

        <div className="mx-global-foot">
          <span>{t('market.coins')} <b className="mono">{global?.coins ? fmtNum(global.coins) : '—'}</b></span>
          <span>{t('market.markets')} <b className="mono">{global?.markets ? fmtNum(global.markets) : '—'}</b></span>
          <span>{t('market.avgChange')} <b className="mono">{liveAvgChange == null ? '—' : fmtPct(liveAvgChange)}</b></span>
        </div>
      </div>

      {bitcoin && (
        <div className="mx-btc" data-testid="market-btc-hero-card">
          <div className="mx-btc-head">
            <button type="button" className="mx-btc-identity" onClick={() => onOpenCoin?.(bitcoin.id)}>
              <CoinLogo coin={bitcoin} px={34} />
              <span>
                <b>{bitcoin.name}</b>
                <small className="mono">{bitcoin.symbol} / {vs.toUpperCase()}</small>
              </span>
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3l5 5-5 5" /></svg>
            </button>
            <Change value={bitcoin.change24h} />
          </div>
          <div className="mx-btc-price">
            <AnimatedNumber value={btcPrice ?? 0} format={(v) => (btcPrice == null ? '—' : marketPrice(v, vs))} flash={false} />
          </div>
          {Array.isArray(bitcoin.sparkline) && bitcoin.sparkline.length > 1 && (
            <MarketSparkline
              points={bitcoin.sparkline}
              up={(bitcoin.change24h ?? 0) >= 0}
              height={58}
              interactive
              label={t('marketIntel.btcChartAria')}
              formatValue={(v) => marketPrice(v, vs)}
              className="mx-btc-chart"
              testId="market-btc-chart"
            />
          )}
          {rangePosition != null && (
            <div className="mx-btc-range" data-testid="market-hero-range">
              <div className="mx-btc-range-track">
                <span style={{ insetInlineStart: `${rangePosition}%` }} />
              </div>
              <div className="mx-btc-range-scale mono">
                <span>{marketPrice(low, vs)}</span>
                <span>{t('market.range24h')}</span>
                <span>{marketPrice(high, vs)}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export default memo(MarketOverview);
