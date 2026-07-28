import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import Sparkline from '../components/Sparkline';
import AnimatedNumber from '../components/AnimatedNumber';
import { useMarkets } from '../hooks/useMarket';
import { fmtPct, fmtPrice } from '../lib/format';
import { useTelegram } from '../context/TelegramContext';
import { IconExternal, IconShield } from '../components/Icons';

/**
 * Perpetual futures.
 *
 * DELIBERATELY A LAUNCHPAD, NOT AN IMPLEMENTATION.
 *
 * PancakeSwap does not build its own perp engine — it white-labels one. Their
 * perpetual product runs on ApolloX / APX Finance infrastructure, because a
 * perp DEX needs an on-chain matching engine, an oracle feed, a liquidation
 * keeper network, an insurance fund and a market-maker relationship. That is a
 * multi-team, multi-audit product, not a screen.
 *
 * Shipping a fake perp UI here would be worse than shipping none: users would
 * enter leveraged positions believing they were real. So this screen shows
 * live index prices and routes to established venues, and says plainly that
 * FBT is not the counterparty.
 */

const VENUES = [
  {
    id: 'apx',
    url: 'https://www.apollox.finance/en/futures/v2/BTCUSD',
    pairs: '200+',
    leverage: '100x',
    color: 'var(--rgb-1)'
  },
  {
    id: 'gmx',
    url: 'https://app.gmx.io/#/trade',
    pairs: '20+',
    leverage: '50x',
    color: 'var(--rgb-2)'
  },
  {
    id: 'dydx',
    url: 'https://dydx.trade',
    pairs: '100+',
    leverage: '20x',
    color: 'var(--rgb-3)'
  }
];

const PERP_SYMBOLS = ['bitcoin', 'ethereum', 'binancecoin', 'solana', 'ripple', 'dogecoin'];

export default function Perp() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic, tg } = useTelegram();
  const { data: coins, loading } = useMarkets(60);

  const [selected, setSelected] = useState('bitcoin');

  const perpCoins = useMemo(
    () => (coins ?? []).filter((c) => PERP_SYMBOLS.includes(c.id)),
    [coins]
  );
  const coin = perpCoins.find((c) => c.id === selected) ?? perpCoins[0];

  const openVenue = (url) => {
    haptic?.('light');
    if (tg?.openLink) tg.openLink(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <PageTransition>
      <motion.div variants={riseIn} initial="hidden" animate="show">
        <h1 className="h1">{t('perp.title')}</h1>
        <p className="muted">{t('perp.subtitle')}</p>
      </motion.div>

      <p className="notice notice-danger">{t('perp.riskNotice')}</p>

      {/* ---------- live index price ---------- */}
      <div className="tag-scroll">
        {perpCoins.map((c) => (
          <button
            key={c.id}
            className={`tag ${selected === c.id ? 'active' : ''}`}
            onClick={() => setSelected(c.id)}
          >
            {c.symbol}-PERP
          </button>
        ))}
      </div>

      {loading ? (
        <div className="skel" style={{ height: 150 }} />
      ) : coin ? (
        <motion.section className="card card-rgb" variants={riseIn} initial="hidden" animate="show">
          <div className="sheen" />
          <div className="row-between">
            <div>
              <div className="faint">{coin.symbol}-PERP · {t('perp.indexPrice')}</div>
              <div className="stat-value">
                <AnimatedNumber value={coin.price} format={(v) => `$${fmtPrice(v)}`} />
              </div>
              <span className={`pill ${coin.change24h >= 0 ? 'pill-up' : 'pill-down'}`} style={{ marginTop: 5 }}>
                {fmtPct(coin.change24h)}
              </span>
            </div>
            <div style={{ textAlign: 'end' }}>
              <div className="faint">{t('coin.high24h')}</div>
              <div className="mono" style={{ fontSize: 12 }}>${fmtPrice(coin.high24h)}</div>
              <div className="faint" style={{ marginTop: 4 }}>{t('coin.low24h')}</div>
              <div className="mono" style={{ fontSize: 12 }}>${fmtPrice(coin.low24h)}</div>
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            <Sparkline data={coin.sparkline ?? []} up={coin.change24h >= 0} width={440} height={56} strokeWidth={2} />
          </div>
          <p className="faint" style={{ marginTop: 8 }}>{t('perp.indexNote')}</p>
        </motion.section>
      ) : null}

      {/* ---------- why we don't run the engine ---------- */}
      <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
        <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
          <span style={{ color: 'var(--rgb-1)', flexShrink: 0 }}>
            <IconShield width={20} height={20} />
          </span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 4 }}>{t('perp.honestTitle')}</div>
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>{t('perp.honestBody')}</p>
          </div>
        </div>
      </motion.section>

      {/* ---------- venues ---------- */}
      <section>
        <p className="section-label">{t('perp.venues')}</p>
        <motion.div className="stack" style={{ gap: 9, marginTop: 8 }} variants={stagger} initial="hidden" animate="show">
          {VENUES.map((v) => (
            <motion.button
              key={v.id}
              className="wallet-option"
              variants={riseIn}
              whileTap={{ scale: 0.985 }}
              onClick={() => openVenue(v.url)}
            >
              <span className="wallet-badge" style={{ color: v.color }}>
                {t(`perp.venue.${v.id}.short`)}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 700, fontSize: 13.5 }}>
                  {t(`perp.venue.${v.id}.name`)}
                </span>
                <span className="set-row-sub">{t(`perp.venue.${v.id}.desc`)}</span>
                <span className="row" style={{ gap: 5, marginTop: 5 }}>
                  <span className="pill pill-neutral">{v.pairs} {t('perp.pairs')}</span>
                  <span className="pill pill-rgb">{t('perp.upTo')} {v.leverage}</span>
                </span>
              </span>
              <IconExternal width={17} height={17} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
            </motion.button>
          ))}
        </motion.div>
      </section>

      <p className="notice">{t('perp.thirdPartyNotice')}</p>

      <motion.button
        className="card card-rgb"
        variants={riseIn}
        initial="hidden"
        animate="show"
        whileTap={{ scale: 0.985 }}
        onClick={() => navigate('/predict')}
        style={{ textAlign: 'start', cursor: 'pointer' }}
      >
        <div className="sheen" />
        <div className="row-between">
          <div>
            <div style={{ fontWeight: 700 }}>{t('perp.tryPredict')}</div>
            <div className="faint">{t('perp.tryPredictSub')}</div>
          </div>
          <span style={{ fontSize: 20 }}>›</span>
        </div>
      </motion.button>
    </PageTransition>
  );
}
