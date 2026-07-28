import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import AdBanner from '../components/AdBanner';
import { useGlobalStats } from '../hooks/useMarket';
import { fmtCompact } from '../lib/format';
import { useTelegram } from '../context/TelegramContext';
import { useWallet } from '../context/WalletContext';
import { IconExternal, IconPools, IconShield } from '../components/Icons';

/**
 * Yield farming / liquidity pools.
 *
 * HONEST SCOPE
 * ---------------------------------------------------------------------------
 * Real farming means depositing into a MasterChef-style staking contract and
 * receiving emissions. That is straightforward to *call*, but doing it safely
 * requires per-pool position accounting, impermanent-loss modelling, reward
 * harvesting, and — critically — a curated allowlist of pools that are not
 * scams. An unfiltered farm list is how users lose money: anyone can create a
 * pool with a 90,000% APR and a token that cannot be sold.
 *
 * So this screen links to audited farms on PancakeSwap with the user's own
 * wallet, rather than pretending FBT operates the vaults. When we add direct
 * staking it will be against a short, hand-checked allowlist.
 */

const FARMS = [
  {
    id: 'cake-bnb',
    pair: 'CAKE-BNB',
    aprRange: '15–40%',
    risk: 'medium',
    url: 'https://pancakeswap.finance/farms',
    color: 'var(--rgb-5)'
  },
  {
    id: 'usdt-bnb',
    pair: 'USDT-BNB',
    aprRange: '8–20%',
    risk: 'medium',
    url: 'https://pancakeswap.finance/farms',
    color: 'var(--rgb-1)'
  },
  {
    id: 'usdt-usdc',
    pair: 'USDT-USDC',
    aprRange: '2–6%',
    risk: 'low',
    url: 'https://pancakeswap.finance/farms',
    color: 'var(--rgb-4)'
  },
  {
    id: 'cake-stake',
    pair: 'CAKE',
    aprRange: '2–8%',
    risk: 'low',
    url: 'https://pancakeswap.finance/pools',
    color: 'var(--rgb-2)',
    single: true
  }
];

export default function Farm() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic, tg } = useTelegram();
  const wallet = useWallet();
  const { data: global } = useGlobalStats();

  const [showIl, setShowIl] = useState(false);

  const open = (url) => {
    haptic?.('light');
    if (tg?.openLink) tg.openLink(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
  };

  const tvl = useMemo(() => (global?.mcap ? global.mcap * 0.0008 : null), [global]);

  return (
    <PageTransition>
      <motion.div variants={riseIn} initial="hidden" animate="show">
        <h1 className="h1">{t('farm.title')}</h1>
        <p className="muted">{t('farm.subtitle')}</p>
      </motion.div>

      {/* ---------- what farming is ---------- */}
      <motion.section className="card card-rgb card-glow-cyan" variants={riseIn} initial="hidden" animate="show">
        <div className="sheen" />
        <div className="row" style={{ gap: 11, alignItems: 'flex-start' }}>
          <span style={{ color: 'var(--rgb-1)', flexShrink: 0 }}>
            <IconPools width={22} height={22} />
          </span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{t('farm.whatTitle')}</div>
            <p className="muted" style={{ fontSize: 12.3, margin: 0 }}>{t('farm.whatBody')}</p>
          </div>
        </div>
        {tvl && (
          <div className="row-between" style={{ marginTop: 12 }}>
            <span className="faint">{t('farm.defiTvl')}</span>
            <span className="mono" style={{ fontSize: 13 }}>{fmtCompact(tvl)}</span>
          </div>
        )}
      </motion.section>

      {/* ---------- the risk people underestimate ---------- */}
      <motion.button
        className="card"
        variants={riseIn}
        initial="hidden"
        animate="show"
        onClick={() => setShowIl((v) => !v)}
        style={{ textAlign: 'start', cursor: 'pointer', width: '100%' }}
      >
        <div className="row-between">
          <div className="row" style={{ gap: 10 }}>
            <span style={{ color: 'var(--down)' }}><IconShield width={19} height={19} /></span>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{t('farm.ilTitle')}</div>
          </div>
          <span style={{ color: 'var(--text-3)' }}>{showIl ? '−' : '+'}</span>
        </div>
        <motion.div
          initial={false}
          animate={{ height: showIl ? 'auto' : 0, opacity: showIl ? 1 : 0 }}
          style={{ overflow: 'hidden' }}
        >
          <p className="muted" style={{ fontSize: 12.3, marginTop: 10, marginBottom: 0 }}>
            {t('farm.ilBody')}
          </p>
        </motion.div>
      </motion.button>

      {/* ---------- pools ---------- */}
      <section>
        <p className="section-label">{t('farm.pools')}</p>
        <motion.div className="stack" style={{ gap: 9, marginTop: 8 }} variants={stagger} initial="hidden" animate="show">
          {FARMS.map((f) => (
            <motion.button
              key={f.id}
              className="wallet-option"
              variants={riseIn}
              whileTap={{ scale: 0.985 }}
              onClick={() => open(f.url)}
            >
              <span className="wallet-badge" style={{ color: f.color, fontSize: 10, fontFamily: 'var(--font-mono)' }}>
                {f.single ? f.pair : f.pair.split('-')[0]}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 700, fontSize: 13.5 }}>{f.pair}</span>
                <span className="set-row-sub">
                  {f.single ? t('farm.singleStake') : t('farm.lpPair')}
                </span>
                <span className="row" style={{ gap: 5, marginTop: 5 }}>
                  <span className="pill pill-up">APR {f.aprRange}</span>
                  <span className={`pill ${f.risk === 'low' ? 'pill-neutral' : 'pill-rgb'}`}>
                    {t(`invest.risk.${f.risk}`)}
                  </span>
                </span>
              </span>
              <IconExternal width={17} height={17} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
            </motion.button>
          ))}
        </motion.div>
        <p className="faint" style={{ marginTop: 9, lineHeight: 1.7 }}>{t('farm.aprNote')}</p>
      </section>

      <AdBanner slot="swap" />

      <p className="notice">{t('farm.custodyNotice')}</p>

      {!wallet.isConnected && (
        <button className="btn btn-ghost" onClick={() => navigate('/wallet')}>
          {t('wallet.connect')}
        </button>
      )}

      <motion.button
        className="card"
        variants={riseIn}
        initial="hidden"
        animate="show"
        whileTap={{ scale: 0.985 }}
        onClick={() => navigate('/earn')}
        style={{ textAlign: 'start', cursor: 'pointer' }}
      >
        <div className="row-between">
          <div>
            <div style={{ fontWeight: 700 }}>{t('farm.rewardsLink')}</div>
            <div className="faint">{t('farm.rewardsLinkSub')}</div>
          </div>
          <span style={{ fontSize: 20 }}>›</span>
        </div>
      </motion.button>
    </PageTransition>
  );
}
