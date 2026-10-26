import { motion } from 'framer-motion';
import CoinLogo from '../CoinLogo';
import InfoBox from '../InfoBox';
import Sparkline from '../Sparkline';
import TopMovers from '../TopMovers';
import { riseIn, stagger } from '../PageTransition';
import { fmtCompact, fmtPct, fmtPrice } from '../../lib/format';
import StockStatMini from './StockStatMini';

const RWA_SORTS = ['mcap', 'gainers', 'volume'];

export default function RwaTokensPanel({
  t,
  rwaCoins,
  topRwa,
  rwaAvg,
  rwaMcap,
  onCoinSelect,
  rwaSort,
  setRwaSort,
  haptic,
  rwaLoading,
  rwaFeed,
  marketLoading,
  rwaError,
  visibleRwa,
  sortedRwa,
  RWA_ROWS,
  rwaShowAll,
  setRwaShowAll
}) {
  return (
    <>
      {/* The RWA highlight reel + stats — same treatment as the equities. */}
      {rwaCoins.length > 0 && (
        <motion.div variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 16 }}>
          <TopMovers
            title={t('stocks.topGainers')}
            subtitle={t('stocks.topGainersCoinsSub')}
            items={topRwa}
            logoKind="coin"
            onSelect={(it) => onCoinSelect(it.raw)}
            testId="stocks-top-rwa"
          />
          <div className="grid-3" style={{ marginTop: 4 }}>
            <StockStatMini label={t('stocks.stats.listed')} value={rwaCoins.length} />
            <StockStatMini
              label={t('stocks.stats.avgChange')}
              value={rwaAvg != null ? fmtPct(rwaAvg, 1) : '—'}
              tone={rwaAvg != null ? (rwaAvg >= 0 ? 'up' : 'down') : undefined}
            />
            <StockStatMini label={t('stocks.stats.mcap')} value={fmtCompact(rwaMcap)} />
          </div>
        </motion.div>
      )}

      <section style={{ marginTop: 16 }}>
        <p className="section-label">{t('stocks.rwaTokens')}</p>
        {rwaCoins.length > 0 && (
          <div className="tag-scroll" style={{ marginBottom: 4 }}>
            {RWA_SORTS.map((s) => (
              <button
                key={s}
                type="button"
                className={`tag ${rwaSort === s ? 'active' : ''}`}
                onClick={() => { haptic?.('select'); setRwaSort(s); }}
              >
                {t(`stocks.sort.${s}`)}
              </button>
            ))}
          </div>
        )}
        {rwaLoading || (rwaFeed === null && marketLoading) ? (
          <div className="stack" style={{ gap: 8, marginTop: 8 }}>
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="skel" style={{ height: 58 }} />
            ))}
          </div>
        ) : rwaError && !rwaFeed?.length ? (
          <div className="empty">
            <span className="empty-icon">🏛</span>
            {t('stocks.unavailable')}
          </div>
        ) : rwaCoins.length === 0 ? (
          <div className="empty">
            <span className="empty-icon">🏛</span>
            {t('stocks.noTokens')}
          </div>
        ) : (
          <motion.div className="stack" style={{ gap: 8, marginTop: 8 }} variants={stagger} initial="hidden" animate="show">
            {visibleRwa.map((c) => (
              <motion.div
                key={c.id}
                className="coin-row"
                variants={riseIn}
                onClick={() => onCoinSelect(c)}
              >
                <CoinLogo coin={c} />
                <div className="coin-meta">
                  <div className="coin-sym">{c.symbol}</div>
                  <div className="coin-name">{c.name} · {fmtCompact(c.mcap)}</div>
                </div>
                <Sparkline data={c.sparkline?.slice(-40) ?? []} up={c.change24h >= 0} width={54} height={24} />
                <div className="coin-right">
                  <div className="mono" style={{ fontSize: 12.5 }}>${fmtPrice(c.price)}</div>
                  <div className={`mono ${c.change24h >= 0 ? 'up' : 'down'}`} style={{ fontSize: 10.5 }}>
                    {fmtPct(c.change24h, 1)}
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
        {sortedRwa.length > RWA_ROWS && (
          <button
            type="button"
            className="btn btn-ghost"
            style={{ marginTop: 10 }}
            onClick={() => { haptic?.('select'); setRwaShowAll((v) => !v); }}
          >
            {rwaShowAll
              ? t('stocks.showLess')
              : t('stocks.showAllTokens', { count: sortedRwa.length })}
          </button>
        )}

        <p className="faint" style={{ marginTop: 9, lineHeight: 1.7 }}>{t('stocks.rwaNote')}</p>
      </section>

      <InfoBox title={t('stocks.kycTitle')} tone="info" id="stocks-kyc">
        <p>{t('stocks.kycNotice')}</p>
      </InfoBox>
    </>
  );
}
