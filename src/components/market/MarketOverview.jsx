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
 * THE MARKET VIEW — «نمای بازار» در سه سکشن، با یک زبان طراحی.
 * ---------------------------------------------------------------------------
 *   «باکس نمای بازار مدرن کن و بعدش یک فاصله کوچک بده و سه باکس مدرن برای
 *    ارزها، بازارها، میانگین تغییر — در یک خط و افقی و مدرن. یک فاصله کوچک و
 *    بعدش باکس بیت‌کوین را مدرن و شیشه‌ای کن.»
 *
 * The request is a SEQUENCE, so the markup is a sequence:
 *
 *   ۱  `.mx-deck`      — the market view: total cap, its move, the metric pods,
 *                        dominance and the 7-day shape. One surface.
 *   ۲  `.mx-trio`      — three equal boxes, side by side on ONE line at every
 *                        width: coins, markets, average change. They used to be
 *                        three pills wrapped inside the deck's footer, which is
 *                        why they read as footnotes instead of as readings.
 *   ۳  `.mx-btc-card`  — Bitcoin, alone, as its own glass card: identity, price,
 *                        the 24h range and the chart, centred.
 *
 * WHY THE THREE BOXES ARE A SIBLING AND NOT PART OF THE DECK
 * The page's rhythm is `--mx-gap` between blocks (14px, 12px on a phone). Three
 * boxes nested inside the deck would have had to re-derive that gap from their
 * own padding; as siblings they inherit the page rhythm exactly, which is what
 * «بعدش یک فاصله کوچک بده» asks for — small, equal, and the same everywhere.
 *
 * WHY THE BITCOIN CARD IS CENTRED
 * It is now one full-width column instead of the right half of a two-column
 * grid, so a left-aligned block inside it would leave a hole on the other side.
 * The head stays a row (identity on the reading edge, change on the far edge) —
 * reading order is unchanged — and the price, the range and the chart are
 * centred, which is where a single hero number belongs.
 *
 * Every mark is drawn SVG (see MarketGlyphs.jsx): a typed arrow cannot be
 * recoloured by an accent token and renders differently on every OS.
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

/**
 * ONE OF THE THREE BOXES — «ارزها · بازارها · میانگین تغییر».
 * Each box owns one accent, so the row reads as three instruments rather than
 * three copies of the same grey tile. The value is the loudest thing in the box
 * and the label sits under it; the mark is a 30px tile on the reading edge.
 */
function TrioBox({ tone, label, value, note, children, testId }) {
  return (
    <div className="mx-trio-box" data-tone={tone} data-testid={testId}>
      <span className="mx-trio-mark" aria-hidden="true">{children}</span>
      <span className="mx-trio-text">
        <span className="mx-trio-label">{label}</span>
        <strong className="mx-trio-value mono">{value}</strong>
        {note && <span className="mx-trio-note mono" data-tone={note.tone}>{note.text}</span>}
      </span>
    </div>
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
  const avg = finiteOrNull(liveAvgChange);
  const btcChange = finiteOrNull(bitcoin?.change24h);

  return (
    <section className="mx-overview" aria-label={t('marketIntel.overviewAria')} data-testid="market-overview">
      {/* ─── ۱ · THE DECK ─────────────────────────────────────────────────── */}
      <div className="mx-deck" data-testid="market-global-card">
        {/* The light field. Two soft blooms and a hairline sheen, painted as
            gradients — never a backdrop-filter, which is the one property this
            screen was measured to be paying for (see market-speed.test.mjs). */}
        <span className="mx-deck-veil" aria-hidden="true"><i /><i /></span>

        <header className="mx-deck-head">
          <span className="mx-deck-mark" aria-hidden="true"><GlyphDeck width={15} height={15} /></span>
          <span className="mx-deck-headings">
            <span className="mx-deck-eyebrow">{t('marketIntel.deckEyebrow')}</span>
            <span className="mx-deck-title">{t('marketIntel.deckLabel')}</span>
          </span>
          <span className="mx-deck-live">
            <i aria-hidden="true" />
            {t('marketIntel.deckLive')}
          </span>
        </header>

        <div className="mx-deck-main">
          <div className="mx-global-head">
            <span className="mx-kicker">{t('market.totalMcap')}</span>
            <div className="mx-global-value">
              {mcap == null && loading
                ? <span className="mx-skel-value" aria-hidden="true" />
                : <AnimatedNumber value={mcap ?? 0} format={() => (mcap == null ? '—' : fmtCompact(mcap))} flash={false} />}
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
        </div>
      </div>

      {/* ─── ۲ · THE TRIO — three boxes, one line, every width ───────────── */}
      <div className="mx-trio" data-testid="market-trio" role="group" aria-label={t('marketIntel.deckLabel')}>
        <TrioBox
          tone="cyan"
          label={t('marketIntel.statCoins')}
          value={global?.coins ? fmtNum(global.coins) : '—'}
          testId="market-trio-coins"
        >
          <GlyphGrid width={15} height={15} />
        </TrioBox>
        <TrioBox
          tone="violet"
          label={t('marketIntel.statMarkets')}
          value={global?.markets ? fmtNum(global.markets) : '—'}
          testId="market-trio-markets"
        >
          <GlyphGlobe width={15} height={15} />
        </TrioBox>
        <TrioBox
          tone={avg == null ? 'flat' : avg >= 0 ? 'up' : 'down'}
          label={t('marketIntel.statAvg')}
          value={avg == null ? '—' : fmtPct(avg)}
          testId="market-trio-avg"
        >
          <GlyphWave width={15} height={15} />
        </TrioBox>
      </div>

      {/* ─── ۳ · BITCOIN — its own glass card, centred ────────────────────── */}
      {bitcoin && (
        <div className="mx-btc-card" data-testid="market-btc-hero-card" data-dir={btcChange == null ? undefined : btcChange >= 0 ? 'up' : 'down'}>
          <span className="mx-btc-veil" aria-hidden="true" />
          <header className="mx-btc-head">
            <button type="button" className="mx-btc-identity" onClick={() => onOpenCoin?.(bitcoin.id)}>
              <span className="mx-btc-logo">
                <CoinLogo coin={bitcoin} px={38} preferVector />
              </span>
              <span className="mx-btc-id-text">
                <b>{bitcoin.name}</b>
                <small className="mono">{bitcoin.symbol} · {vs.toUpperCase()}</small>
              </span>
              <span className="mx-btc-go" aria-hidden="true"><GlyphChevron width={13} height={13} /></span>
            </button>
            <Change value={bitcoin.change24h} />
          </header>

          <div className="mx-btc-price">
            <AnimatedNumber value={btcPrice ?? 0} format={() => (btcPrice == null ? '—' : marketPrice(btcPrice, vs))} flash={false} />
          </div>

          {Array.isArray(bitcoin.sparkline) && bitcoin.sparkline.length > 1 && (
            <MarketSparkline
              points={bitcoin.sparkline}
              up={(bitcoin.change24h ?? 0) >= 0}
              height={74}
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
