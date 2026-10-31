import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import CoinLogo from '../CoinLogo.jsx';
import MarketSparkline from './MarketSparkline.jsx';
import { fmtCompact, fmtPct } from '../../lib/format.js';
import { finiteOrNull, marketPrice, positiveOrNull } from '../../lib/marketPresentation.js';

/** Trending discovery rail. Every number is joined from the live market rows. */
function HotCoins({ coins = [], onOpen, vs = 'usd' }) {
  const { t } = useTranslation();
  if (!coins.length) return null;
  return (
    <section className="mx-hot" aria-labelledby="market-trending-title" data-testid="market-hot-coins">
      <div className="mx-section-head">
        <h2 id="market-trending-title">{t('marketIntel.hotTitle')}</h2>
        <span>{t('market.trendingBasis')}</span>
      </div>
      <div className="mx-hot-rail">
        {coins.map((coin) => {
          const change = finiteOrNull(coin.change24h);
          const volume = positiveOrNull(coin.volume);
          return (
            <button
              key={coin.id}
              type="button"
              className="mx-hot-card"
              data-dir={change == null ? undefined : change >= 0 ? 'up' : 'down'}
              onClick={() => onOpen?.(coin.id)}
              aria-label={`${coin.name} (${coin.symbol}) — ${marketPrice(coin.price, vs)}${change == null ? '' : `, ${fmtPct(change)}`}`}
            >
              <span className="mx-hot-head">
                <CoinLogo coin={coin} px={30} />
                <span className="mx-hot-id">
                  <b>{coin.symbol}</b>
                  <small>{coin.name}</small>
                </span>
                <span className="mx-hot-rank mono">{String(coin.place).padStart(2, '0')}</span>
              </span>
              <span className="mx-hot-price-row">
                <span className="mx-hot-price mono">{marketPrice(coin.price, vs)}</span>
                {change != null && (
                  <span className="mx-change mono" data-dir={change >= 0 ? 'up' : 'down'}>{fmtPct(change, 1)}</span>
                )}
              </span>
              <span className="mx-hot-chart">
                {coin.sparkline && (
                  <MarketSparkline points={coin.sparkline} up={(change ?? 0) >= 0} height={34} />
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
