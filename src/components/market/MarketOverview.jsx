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

/* ─── THE HELIX ──────────────────────────────────────────────────────────
   Two sine strands, a half-period out of phase, drawn once as SVG geometry.
   The SVG is two loops wide and the stylesheet moves it by one loop, which is
   eight sine periods, so the repeat is seamless and the motion is a single
   translate. Phase lives in the path, not in per-frame maths. */
const HELIX_H = 70;
const HELIX_MID = HELIX_H / 2;
const HELIX_AMP = 22;
const HELIX_CYCLE = 100;
const HELIX_LOOP = 800;
function helixPath(sign) {
  const parts = [];
  for (let x = 0; x <= HELIX_LOOP * 2; x += 5) {
    const y = HELIX_MID + sign * HELIX_AMP * Math.sin((2 * Math.PI * x) / HELIX_CYCLE);
    parts.push(`${x === 0 ? 'M' : 'L'}${x} ${y.toFixed(2)}`);
  }
  return parts.join(' ');
}
const HELIX_A = helixPath(1);
const HELIX_B = helixPath(-1);

function HelixField() {
  return (
    <span className="mx-helix-field" aria-hidden="true">
      <svg className="mx-helix-scroll" viewBox={`0 0 ${HELIX_LOOP * 2} ${HELIX_H}`} preserveAspectRatio="none" focusable="false">
        <path className="mx-helix-strand" d={HELIX_A} />
        <path className="mx-helix-strand is-b" d={HELIX_B} />
      </svg>
    </span>
  );
}

/** Independent glass readings. Values and trend geometry come from the market
 * feed; decorative light never carries a simulated financial measurement. */

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

/**
 * «عدد و مقدار مدرن شود»
 * The hero figure is set as three typographic weights instead of one flat
 * string: a small currency mark, the digits at display size, the magnitude
 * (K/M/B/T) as a superscript. Nothing is rounded differently and nothing is
 * invented — this is the same `fmtCompact` output, only typeset.
 */
function CompactFigure({ text }) {
  const parts = /^([^\d]*)([\d.,]+)([KMBT])$/.exec(text);
  if (!parts) return text;
  const [, mark, digits, unit] = parts;
  return (
    <>
      {mark && <span className="mx-fig-mark">{mark}</span>}
      <span className="mx-fig-digits">{digits}</span>
      <span className="mx-fig-unit">{unit}</span>
    </>
  );
}

/**
 * The mark tile doubles as a gauge when the reading is a share of 100
 * (dominance). The arc is drawn with `pathLength="100"`, so the dash array is
 * the percentage itself — no normalising maths and no second source of truth.
 * A volume reading is not a share, so it gets the plain tile: the ring is a
 * measurement, not decoration.
 */
function Gauge({ ring, children }) {
  const share = finiteOrNull(ring);
  const pct = share == null ? null : Math.max(0, Math.min(100, share));
  return (
    <span className="mx-metric-gauge">
      {pct != null && (
        <svg className="mx-metric-ring" viewBox="0 0 44 44" aria-hidden="true" focusable="false">
          <circle className="mx-ring-track" cx="22" cy="22" r="19" />
          <circle
            className="mx-ring-arc"
            cx="22"
            cy="22"
            r="19"
            pathLength="100"
            strokeDasharray={`${pct} ${100 - pct}`}
          />
        </svg>
      )}
      <span className="mx-metric-icon" aria-hidden="true">{children}</span>
    </span>
  );
}

function Metric({ label, value, note, tone, ring, title, children }) {
  return (
    <div className="mx-metric" data-tone={tone} data-ring={ring != null ? 'true' : undefined} title={title}>
      <Gauge ring={ring}>{children}</Gauge>
      <span className="mx-metric-text">
        <span className="mx-metric-label">{label}</span>
        <strong className="mx-metric-value mono">{value}</strong>
        {note && <span className="mx-metric-note mono">{note}</span>}
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
  /* Turnover is volume ÷ market cap, both read from the feed: a real ratio, not
     a simulated "activity" score. Absent when either side is absent. */
  const turnover = mcap != null && volume != null && mcap > 0 ? (volume / mcap) * 100 : null;
  /* Tone and weight of the showcase's centre line. Derived from the same
     7-day change the trend is labelled with, never from a made-up pulse. */
  const trendPct = finiteOrNull(trend?.changePct);
  const trendDir = trendPct == null || trendPct >= 0 ? 'up' : 'down';
  const midStrength = trendPct == null ? 0.25 : Math.min(1, Math.max(0.25, Math.abs(trendPct) / 3));

  /* Bitcoin's 24h move in money as well as in percent. The previous price is
     recovered from the feed's own price and percentage (p / (1 + c)), so it is
     a consequence of two measured numbers, not a third source. */
  const btcVolume = positiveOrNull(bitcoin?.volume);
  const btcMcap = positiveOrNull(bitcoin?.mcap);
  const btcDir = btcChange == null ? undefined : btcChange >= 0 ? 'up' : 'down';
  const btcDelta = btcPrice != null && btcChange != null && 1 + btcChange / 100 > 0
    ? btcPrice - btcPrice / (1 + btcChange / 100)
    : null;
  const signedMoney = (value) => {
    if (value == null || value === 0) return '—';
    return `${value > 0 ? '+' : '-'}${marketPrice(Math.abs(value), vs)}`;
  };

  return (
    <section className="mx-overview" aria-label={t('marketIntel.overviewAria')} data-testid="market-overview">
      {/* ─── ۱ · THE DECK ─────────────────────────────────────────────────── */}
      <div className="mx-deck" data-testid="market-global-card">
        {/* «رنگ در کادر باشد و انیمیشنی حرکت کند» — a second rim painted in a
            different colour phase, cross-faded over the resting rim by opacity
            alone. Its interior replicates the deck's own background stack via
            --mx-deck-interior, so only the 1.5px frame differs while it fades.
            It is the FIRST light layer: veil blooms, matrix, comets and the
            breathing glow all paint above it and are never occluded. */}
        <span className="mx-deck-rim" aria-hidden="true" />
        {/* The light field. Two soft blooms and a hairline sheen, painted as
            gradients — never a backdrop-filter, which is the one property this
            screen was measured to be paying for (see market-speed.test.mjs). */}
        <span className="mx-deck-veil" aria-hidden="true"><i /><i /></span>
        {/* Drawn light, all of it decoration: a dot matrix, a pair of neon
            comets running the rim, and one hairline sheen along the top. */}
        <span className="mx-deck-matrix" aria-hidden="true" />
        <span className="mx-deck-orbit" aria-hidden="true"><i /><i /><i /><i /><i /><i /></span>
        <span className="mx-deck-sheen" aria-hidden="true" />
        {/* The glass answer to «شیشه‌ای شود»: one slow specular band crossing
            the card on a long cycle — transform + opacity, nothing else. */}
        <span className="mx-deck-gloss" aria-hidden="true" />

        <header className="mx-deck-head">
          <span className="mx-deck-mark" aria-hidden="true"><GlyphDeck width={15} height={15} /></span>
          <span className="mx-deck-headings">
            <span className="mx-deck-eyebrow">{t('marketIntel.deckEyebrow')}</span>
            <span className="mx-deck-title">{t('marketIntel.deckLabel')}</span>
          </span>
          <span className="mx-deck-live" data-unavailable={mcap == null || global?.offline ? 'true' : undefined}>
            <i aria-hidden="true" />
            {mcap != null && !global?.offline ? t('marketIntel.deckLive') : t('marketIntel.deckPending')}
          </span>
        </header>

        <div className="mx-deck-main">
          <div className="mx-global-head">
            <span className="mx-kicker">{t('market.totalMcap')}</span>
            <div className="mx-global-value">
              {mcap == null && loading
                ? <span className="mx-skel-value" aria-hidden="true" />
                : (
                  <AnimatedNumber
                    value={mcap ?? 0}
                    format={() => (mcap == null ? '—' : <CompactFigure text={fmtCompact(mcap)} />)}
                    flash={false}
                    className="mx-global-figure"
                  />
                )}
            </div>
            <Change value={global?.mcapChange} />
          </div>

          {trend && (
            <div className="mx-global-trend" data-testid="global-market-trend">
              <div className="mx-trend-plot" data-dir={trendDir} data-testid="market-trend-plot">
                <span className="mx-trend-halo" aria-hidden="true" />
                <MarketSparkline
                  points={trend.points}
                  up={trend.changePct >= 0}
                  height={70}
                  interactive
                  glow
                  liveDot
                  label={t('marketIntel.trendAria', { days: trend.days, coins: trend.coins })}
                  formatValue={fmtCompact}
                  formatTime={(x) => new Date(x).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  testId="global-market-trend-chart"
                  className="mx-trend-chart"
                />
                <span className="mx-trend-scan" aria-hidden="true" />
                {/* The centre line of the showcase. Its tone is the sign of the
                    move and its weight is the size of it (--mx-mid-strength),
                    so a flat day reads faint and a large move reads loud. */}
                <span
                  className="mx-trend-mid"
                  data-testid="market-trend-mid"
                  data-dir={trendDir}
                  aria-hidden="true"
                  style={{ '--mx-mid-strength': midStrength.toFixed(2) }}
                />
                {/* Two phase-shifted strands travelling the same centre line:
                    a double helix, drawn with transform only. */}
                <HelixField />
              </div>
              <details className="mx-trend-method">
                <summary>
                  <span>{t('marketIntel.trendLabel', { days: trend.days, coins: trend.coins })}</span>
                  <span className={`mono ${trend.changePct >= 0 ? 'mx-up' : 'mx-down'}`}>{fmtPct(trend.changePct)}</span>
                </summary>
                <p>{t('market.trendNote', { n: trend.coins })}</p>
              </details>
            </div>
          )}

          <div className="mx-global-metrics">
            <Metric
              label={t('market.volume24h')}
              value={volume == null ? '—' : fmtCompact(volume)}
              note={turnover == null ? null : t('market.turnover', { pct: `${turnover.toFixed(1)}%` })}
              title={turnover == null ? undefined : t('market.turnoverTitle')}
              tone="cyan"
            >
              <GlyphVolume width={14} height={14} />
            </Metric>
            <Metric
              label={t('market.btcDominance')}
              value={btcDom == null ? '—' : pct(btcDom)}
              ring={btcDom}
              tone="gold"
            >
              <GlyphBitcoin width={14} height={14} />
            </Metric>
            <Metric
              label={t('market.ethDominance')}
              value={ethDom == null ? '—' : pct(ethDom)}
              ring={ethDom}
              tone="violet"
            >
              <GlyphEthereum width={14} height={14} />
            </Metric>
          </div>

          {(btcDom != null || ethDom != null) && (
            <div className="mx-dominance-wrap">
              <div className="mx-dominance" role="img" aria-label={t('market.dominanceAria')}>
                {btcDom != null && <span className="is-btc" style={{ width: `${btcDom}%` }} />}
                {ethDom != null && <span className="is-eth" style={{ width: `${ethDom}%` }} />}
                {otherDom != null && <span className="is-other" style={{ width: `${otherDom}%` }} />}
                <span className="mx-dominance-shine" aria-hidden="true" />
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
        <div className="mx-btc-card" data-testid="market-btc-hero-card" data-dir={btcDir}>
          {/* The amber twin of the deck rim: one colour phase painted at rest,
              a second phase cross-faded over it by opacity alone. First light
              layer, so the veil bloom and the etched orbit stay above it. */}
          <span className="mx-btc-rim" aria-hidden="true" />
          <span className="mx-btc-veil" aria-hidden="true" />
          <span className="mx-btc-orbit" aria-hidden="true"><i /><GlyphBitcoin width={120} height={120} /></span>
          <span className="mx-btc-gloss" aria-hidden="true" />
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
          </header>

          <div className="mx-btc-price">
            <AnimatedNumber value={btcPrice ?? 0} format={() => (btcPrice == null ? '—' : marketPrice(btcPrice, vs))} flash={false} />
          </div>

          {/* The move, twice over: the percentage as a tone-coloured pill and
              the same move in money. Green when up, red when down. */}
          <div className="mx-btc-delta" data-testid="market-btc-delta" data-dir={btcDir}>
            <span className="mx-btc-pct mono">
              {btcChange != null && (btcChange >= 0 ? <GlyphTrendUp width={12} height={12} aria-hidden="true" /> : <GlyphTrendDown width={12} height={12} aria-hidden="true" />)}
              {fmtPct(btcChange, 2)}
            </span>
            <span className="mx-btc-abs mono" data-testid="market-btc-abs">{signedMoney(btcDelta)}</span>
            <span className="mx-btc-period">{t('marketIntel.btcPeriod')}</span>
          </div>

          {Array.isArray(bitcoin.sparkline) && bitcoin.sparkline.length > 1 && (
            <div className="mx-btc-plot" data-testid="market-btc-plot">
              <span className="mx-btc-halo" aria-hidden="true" />
              <MarketSparkline
                points={bitcoin.sparkline}
                up={(bitcoin.change24h ?? 0) >= 0}
                height={74}
                interactive
                glow
                liveDot
                label={t('marketIntel.btcChartAria')}
                formatValue={(v) => marketPrice(v, vs)}
                className="mx-btc-chart"
                testId="market-btc-chart"
              />
              <span className="mx-btc-scan" aria-hidden="true" />
            </div>
          )}

          <dl className="mx-btc-stats" data-testid="market-btc-stats">
            <div>
              <dt>{t('market.volume24h')}</dt>
              <dd className="mono">{btcVolume == null ? '—' : fmtCompact(btcVolume)}</dd>
            </div>
            <div>
              <dt>{t('marketIntel.btcMcap')}</dt>
              <dd className="mono">{btcMcap == null ? '—' : fmtCompact(btcMcap)}</dd>
            </div>
          </dl>

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
