import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import AnimatedNumber from '../AnimatedNumber.jsx';
import CoinLogo from '../CoinLogo.jsx';
import MarketSparkline from './MarketSparkline.jsx';
import {
  GlyphBitcoin,
  GlyphChevron,
  GlyphDeck,
  GlyphEthereum,
  GlyphGlobe,
  GlyphGrid,
  GlyphTrendDown,
  GlyphTrendUp,
  GlyphVolume,
  GlyphWave
} from './MarketGlyphs.jsx';
import { fmtCompact, fmtNum, fmtPct } from '../../lib/format.js';
import { finiteOrNull, marketPrice, positiveOrNull } from '../../lib/marketPresentation.js';

/**
 * ONE BOX, TWO READINGS — «ارزش کل و بیت کویین داخل باکس واحد».
 * ---------------------------------------------------------------------------
 * The screen used to stack two separate glass cards (total market cap, then
 * Bitcoin) with their own borders, radii and shadows, so the first thing a
 * reader saw was a seam down the middle of the most important number in the
 * app. Both readings now live inside a single surface — one border, one radius,
 * one light field — and are separated by a hairline that becomes a vertical
 * rule on wide screens.
 *
 * The two halves keep their own test ids (`market-global-card`,
 * `market-btc-hero-card`) because they are two claims about two different
 * things; what changed is the frame around them, not the readings.
 *
 * Every mark is drawn SVG (see MarketGlyphs.jsx): a typed diagonal arrow cannot be recoloured
 * by an accent token and renders differently on every OS.
 */

function Change({ value }) {
  const n = finiteOrNull(value);
  if (n == null) return null;
  const up = n >= 0;
  const Arrow = up ? GlyphTrendUp : GlyphTrendDown;
  return (
    <span className="mx-change mono" data-dir={up ? 'up' : 'down'}>
      <Arrow width={11} height={11} />
      {fmtPct(n)}
    </span>
  );
}

function Metric({ label, value, title, tone, children }) {
  return (
    <div className="mx-metric" data-tone={tone} title={title}>
      <span className="mx-metric-icon" aria-hidden="true">{children}</span>
      <span className="mx-metric-text">
        <span className="mx-metric-label">{label}</span>
        <strong className="mono">{value}</strong>
      </span>
    </div>
  );
}

function FootStat({ label, value, children }) {
  return (
    <span className="mx-foot-stat">
      <span className="mx-foot-icon" aria-hidden="true">{children}</span>
      {label}
      <b className="mono">{value}</b>
    </span>
  );
}

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
  const pct = (n) => (n == null ? null : `${n.toFixed(1)}%`);

  return (
    <section className="mx-overview" aria-label={t('marketIntel.overviewAria')} data-testid="market-overview">
      {/* The light field. Two soft blooms and a hairline sheen, painted as
          gradients — never a backdrop-filter, which is the one property this
          screen was measured to be paying for (see market-speed.test.mjs). */}
      <span className="mx-deck-veil" aria-hidden="true"><i /><i /></span>

      <header className="mx-deck-head">
        <span className="mx-deck-mark" aria-hidden="true"><GlyphDeck width={15} height={15} /></span>
        <span className="mx-deck-title">{t('marketIntel.deckLabel')}</span>
        <span className="mx-deck-live">
          <i aria-hidden="true" />
          {t('marketIntel.deckLive')}
        </span>
      </header>

      <div className="mx-deck-grid">
        <div className="mx-global" data-testid="market-global-card">
          <div className="mx-global-head">
            <div className="mx-global-head-text">
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
            <Metric label={t('market.volume24h')} value={volume == null ? '—' : fmtCompact(volume)} tone="cyan">
              <GlyphVolume width={14} height={14} />
            </Metric>
            <Metric label={t('market.btcDominance')} value={btcDom == null ? '—' : pct(btcDom)} tone="gold">
              <GlyphBitcoin width={14} height={14} />
            </Metric>
            <Metric label={t('market.ethDominance')} value={ethDom == null ? '—' : pct(ethDom)} tone="violet">
              <GlyphEthereum width={14} height={14} />
            </Metric>
          </div>

          {(btcDom != null || ethDom != null) && (
            <div className="mx-dominance-wrap">
              <div className="mx-dominance" role="img" aria-label={t('market.dominanceAria')}>
                {btcDom != null && <span className="is-btc" style={{ width: `${btcDom}%` }} />}
                {ethDom != null && <span className="is-eth" style={{ width: `${ethDom}%` }} />}
                {otherDom != null && <span className="is-other" style={{ width: `${otherDom}%` }} />}
              </div>
              <div className="mx-dominance-legend mono">
                {btcDom != null && <span data-tone="btc"><i aria-hidden="true" />BTC<b>{pct(btcDom)}</b></span>}
                {ethDom != null && <span data-tone="eth"><i aria-hidden="true" />ETH<b>{pct(ethDom)}</b></span>}
                {otherDom != null && (
                  <span data-tone="other"><i aria-hidden="true" />{t('market.dominanceOthers')}<b>{pct(otherDom)}</b></span>
                )}
              </div>
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
            <FootStat label={t('market.coins')} value={global?.coins ? fmtNum(global.coins) : '—'}>
              <GlyphGrid width={12} height={12} />
            </FootStat>
            <FootStat label={t('market.markets')} value={global?.markets ? fmtNum(global.markets) : '—'}>
              <GlyphGlobe width={12} height={12} />
            </FootStat>
            <FootStat label={t('market.avgChange')} value={liveAvgChange == null ? '—' : fmtPct(liveAvgChange)}>
              <GlyphWave width={12} height={12} />
            </FootStat>
          </div>
        </div>

        {bitcoin && (
          <div className="mx-btc" data-testid="market-btc-hero-card">
            <div className="mx-btc-head">
              <button type="button" className="mx-btc-identity" onClick={() => onOpenCoin?.(bitcoin.id)}>
                <span className="mx-btc-logo">
                  <CoinLogo coin={bitcoin} px={40} preferVector />
                </span>
                <span className="mx-btc-id-text">
                  <b>{bitcoin.name}</b>
                  <small className="mono">{bitcoin.symbol} · {vs.toUpperCase()}</small>
                </span>
                <span className="mx-btc-go" aria-hidden="true"><GlyphChevron width={13} height={13} /></span>
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
      </div>
    </section>
  );
}

export default memo(MarketOverview);
