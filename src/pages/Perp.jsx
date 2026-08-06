import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import InfoBox from '../components/InfoBox';
import Sparkline from '../components/Sparkline';
import AnimatedNumber from '../components/AnimatedNumber';
import { useMarkets } from '../hooks/useMarket';
import { fmtPct, fmtPrice } from '../lib/format';
import { useTelegram } from '../context/TelegramContext';
import FundingPanel from '../components/FundingPanel';
import { IconExternal, IconShield } from '../components/Icons';
import { anyVenueEarns, withReferral } from '../lib/venueReferral';

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
    /*
     * The only venue here with a permissionless referral AND non-crypto
     * markets — forex, metals, commodities, indices, equities. See
     * lib/venueReferral.js for why the other three earn nothing.
     */
    id: 'avantis',
    url: 'https://www.avantisfi.com/trade',
    pairs: '60+',
    leverage: '500x',
    color: 'var(--rgb-4)'
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

  /*
   * ─── THESE LINKS USED TO EARN NOTHING ───────────────────────────────────
   * We find the user, explain perpetuals honestly, compare funding across
   * venues, and then hand them to GMX for free.
   *
   * GMX is the one venue on this page with a permissionless affiliate
   * programme: their docs state plainly that anyone can create a Tier 1 code,
   * with no volume requirement — unlike dYdX ($10k of personal volume) and
   * Hyperliquid ($10k, or 100 USDC for a builder code), neither of which we
   * can meet. Registering costs one Arbitrum transaction, about $0.02.
   *
   * `withReferral` returns the URL UNCHANGED until a code is configured, so
   * this is safe to ship before the owner registers anything: today it is the
   * same plain link it always was.
   *
   * And the referred trader gets 5% off their fees, so the link is better for
   * them than the bare one — but they are told either way, below.
   */
  const openVenue = (venueId, url) => {
    haptic?.('light');
    const target = withReferral(venueId, url);
    if (tg?.openLink) tg.openLink(target);
    else window.open(target, '_blank', 'noopener,noreferrer');
  };

  return (
    <PageTransition>
      <motion.div variants={riseIn} initial="hidden" animate="show">
        <h1 className="h1">{t('perp.title')}</h1>
        <p className="muted">{t('perp.subtitle')}</p>
      </motion.div>

      {/*
        ─── THE RISK NOTICE STAYS VISIBLE; THE EXPLAINER FOLDS ───────────────
        Two different jobs, so two different treatments.

        `perp.riskNotice` is what leverage will do to this user's money, and
        it stays a plain inline `.notice`. Anything describing what the button
        is about to do must never be one tap away.

        "How futures work" is education — asked for explicitly («فیوچرز چطور
        کار میکند در صفحه فیوجرز») — and it belongs in a box the reader opens
        when they want it. Printed inline it would push the actual market data
        below the fold to teach something most visitors already know.
      */}
      <p className="notice notice-danger">{t('perp.riskNotice')}</p>

      <InfoBox title={t('perp.how.title')} tone="info" id="perp-how">
        <p>{t('perp.how.p1')}</p>
        <p>{t('perp.how.p2')}</p>
        <p>{t('perp.how.p3')}</p>
        <p>{t('perp.how.p4')}</p>
      </InfoBox>

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

      {/*
        ─── THE COST OF HOLDING, BEFORE ANYTHING ELSE ──────────────────────
        Placed directly under the price and ABOVE the explanation, the venue
        list and the risk essay, because it is the only thing on this screen
        that a trader cannot get elsewhere in one glance: the same position
        costs several percent a year more at one venue than another, and no
        interface lines them up.

        Above the venue buttons on purpose. A cost comparison shown after the
        user has already tapped through to a venue is a receipt, not a choice.
      */}
      <FundingPanel />

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

      {/*
        ─── HOW PERPETUALS ACTUALLY WORK ──────────────────────────────────
        Requested: «فیوچرز را خیلی بهتر و بیشتر بنویس».

        The page was honest about what we do NOT run, but it taught nothing.
        Someone arriving here does not know what funding is, what liquidation
        price means, or why 100x is a way to lose everything on a 1% move —
        and they are about to be sent to a venue where all three apply with
        real money.

        Explaining it BEFORE the venue list is deliberate. After the list is
        after the decision.
      */}
      <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
        <p className="section-label" style={{ marginBottom: 10 }}>{t('perp.learnTitle')}</p>
        <div className="stack" style={{ gap: 12 }}>
          {['what', 'funding', 'liquidation', 'leverage', 'costs'].map((k) => (
            <div key={k}>
              <div style={{ fontWeight: 700, fontSize: 12.8, marginBottom: 3 }}>
                {t(`perp.learn.${k}.q`)}
              </div>
              <p className="muted" style={{ fontSize: 12.2, lineHeight: 1.8, margin: 0 }}>
                {t(`perp.learn.${k}.a`)}
              </p>
            </div>
          ))}
        </div>

        {/*
          The liquidation table. An abstract warning about leverage does not
          land; a column showing that 50x liquidates on a 2% move does.
        */}
        <p className="section-label" style={{ margin: '14px 0 8px' }}>{t('perp.liqTitle')}</p>
        <table className="perp-liq">
          <thead>
            <tr>
              <th>{t('perp.liqLeverage')}</th>
              <th>{t('perp.liqMove')}</th>
            </tr>
          </thead>
          <tbody>
            {[2, 5, 10, 25, 50, 100].map((x) => (
              <tr key={x}>
                <td className="mono">{x}×</td>
                {/* 100/x, the actual arithmetic — not a rounded illustration. */}
                <td className="mono" style={{ color: x >= 25 ? 'var(--down)' : 'var(--text-2)' }}>
                  {(100 / x).toFixed(x >= 50 ? 1 : 0)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="faint" style={{ fontSize: 11, marginTop: 8, lineHeight: 1.7 }}>
          {t('perp.liqNote')}
        </p>
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
              onClick={() => openVenue(v.id, v.url)}
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

      {/*
        ─── THE NOTICE HAS TO TRACK REALITY ──────────────────────────────────
        `perp.thirdPartyNotice` says we "earn nothing from them". That is true
        today and stops being true the moment a GMX code is registered.
        Leaving it would turn an honesty notice into a false statement — the
        exact failure already caught twice on this project (the FAQ that
        denied bridging, and the landing page quoting a Solana fee).
        The same flag that decides whether to ATTACH a referral code decides
        which sentence is shown, so they cannot disagree.
      */}
      <InfoBox title={t('perp.venuesTitle')} tone="warn" id="perp-venues">
        <p>
          {anyVenueEarns(VENUES.map((v) => v.id))
            ? t('perp.thirdPartyNoticeEarning')
            : t('perp.thirdPartyNotice')}
        </p>
      </InfoBox>

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
