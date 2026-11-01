import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import CoinLogo from '../CoinLogo.jsx';
import MarketSparkline from './MarketSparkline.jsx';
import { GlyphFlame, GlyphTrendDown, GlyphTrendUp } from './MarketGlyphs.jsx';
import { fmtCompact, fmtPct } from '../../lib/format.js';
import { finiteOrNull, marketPrice, positiveOrNull } from '../../lib/marketPresentation.js';

/**
 * «داغ‌ترین کوین‌ها» — a ranked board, minimally drawn.
 * ---------------------------------------------------------------------------
 * Every number is joined from the live market rows; nothing here is a name
 * list. What changed in this pass is the frame:
 *
 *   · the rank is a chip that carries the card's own accent, so place 1/2/3
 *     read as a podium without a single extra word;
 *   · the accent is per-place (gold, aqua, violet) and drives the hairline, the
 *     chip and the hover border from ONE custom property, so a card can never
 *     disagree with itself;
 *   · the flame in the head is drawn SVG in the card's hue — the typed fire
 *     emoji arrived as platform artwork and could not be recoloured;
 *   · the change chip carries a drawn arrow, not a typed diagonal one;
 *   · a missing move prints no chip at all, rather than a made-up 0%.
 */
function HotCoins({ coins = [], onOpen, vs = 'usd' }) {
  const { t } = useTranslation();
  if (!coins.length) return null;
  return (
    <section className="mx-hot" aria-labelledby="market-trending-title" data-testid="market-hot-coins">
      <div className="mx-section-head">
        <span className="mx-hot-flame" aria-hidden="true"><GlyphFlame width={14} height={14} /></span>
        <h2 id="market-trending-title">{t('marketIntel.hotTitle')}</h2>
        <span className="mx-section-note">{t('market.trendingBasis')}</span>
      </div>
      <div className="mx-hot-rail">
        {coins.map((coin, index) => {
          const change = finiteOrNull(coin.change24h);
          const volume = positiveOrNull(coin.volume);
          const place = Number(coin.place) || 0;
          /* No measured move means the sparkline keeps the neutral (up) tone and no
             arrow or percentage is printed: an absent number is not a 0%. */
          const up = change == null || change >= 0;
          const Arrow = up ? GlyphTrendUp : GlyphTrendDown;
          return (
            <button
              key={coin.id}
              type="button"
              className="mx-hot-card"
              data-place={place >= 1 && place <= 3 ? place : 'n'}
              data-dir={change == null ? undefined : up ? 'up' : 'down'}
              onClick={() => onOpen?.(coin.id)}
              aria-label={`${coin.name} (${coin.symbol}) — ${marketPrice(coin.price, vs)}${change == null ? '' : `, ${fmtPct(change)}`}`}
            >
              <span className="mx-hot-sheen" aria-hidden="true" />
              <span className="mx-hot-head">
                {/* The rail sits under the deck: its first cards are on screen
                    at first paint, so they ask for their artwork at high
                    priority instead of queueing behind the route's own CSS. */}
                <CoinLogo coin={coin} px={22} priority={index < 4} />
                <span className="mx-hot-id">
                  <b>{coin.symbol}</b>
                  <small>{coin.name}</small>
                </span>
                <span className="mx-hot-rank mono">{String(place).padStart(2, '0')}</span>
              </span>
              <span className="mx-hot-price-row">
                <span className="mx-hot-price mono">{marketPrice(coin.price, vs)}</span>
                {change != null && (
                  <span className="mx-change mono" data-dir={up ? 'up' : 'down'}>
                    <Arrow width={10} height={10} />
                    {fmtPct(change, 1)}
                  </span>
                )}
              </span>
              <span className="mx-hot-chart">
                {coin.sparkline && (
                  <MarketSparkline points={coin.sparkline} up={up} height={32} />
                )}
              </span>
              {volume != null && (
                <span className="mx-hot-volume">
                  {t('market.volume24h')} <b className="mono">{fmtCompact(volume)}</b>
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

export default memo(HotCoins);
