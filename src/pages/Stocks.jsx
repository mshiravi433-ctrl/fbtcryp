import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import Sparkline from '../components/Sparkline';
import { useMarkets } from '../hooks/useMarket';
import { fmtCompact, fmtPct, fmtPrice } from '../lib/format';
import { useTelegram } from '../context/TelegramContext';
import { IconExternal, IconShield } from '../components/Icons';

/**
 * Tokenized stocks (RWA — real world assets).
 *
 * WHY THIS ROUTES OUT INSTEAD OF TRADING IN-APP
 * ---------------------------------------------------------------------------
 * A token representing Apple stock is a security. Issuing or brokering one
 * requires a licensed issuer holding the actual shares in custody, a prospectus
 * in most jurisdictions, and a broker-dealer licence to distribute. PancakeSwap
 * does not offer these either.
 *
 * What we can honestly do is surface the RWA/tokenization sector — the tokens
 * of the protocols building this infrastructure are ordinary crypto assets and
 * trade like any other — and point users to the licensed issuers for actual
 * equity exposure.
 */

/** Protocols building tokenized real-world assets. These are normal tokens. */
const RWA_IDS = ['ondo-finance', 'chainlink', 'maker', 'polymesh', 'centrifuge', 'pendle'];

const ISSUERS = [
  { id: 'backed', url: 'https://backed.fi', color: 'var(--rgb-1)' },
  { id: 'ondo', url: 'https://ondo.finance', color: 'var(--rgb-2)' },
  { id: 'swarm', url: 'https://swarm.com', color: 'var(--rgb-3)' }
];

export default function Stocks() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic, tg } = useTelegram();
  const { data: coins, loading } = useMarkets(100);
  const [tab, setTab] = useState('rwa');

  const rwaCoins = useMemo(
    () => (coins ?? []).filter((c) => RWA_IDS.includes(c.id)),
    [coins]
  );

  const open = (url) => {
    haptic?.('light');
    if (tg?.openLink) tg.openLink(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <PageTransition>
      <motion.div variants={riseIn} initial="hidden" animate="show">
        <h1 className="h1">{t('stocks.title')}</h1>
        <p className="muted">{t('stocks.subtitle')}</p>
      </motion.div>

      <div className="segmented">
        {['rwa', 'equity'].map((k) => (
          <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)} style={{ isolation: 'isolate' }}>
            {tab === k && <motion.span layoutId="stk" className="seg-indicator" />}
            {t(`stocks.tab.${k}`)}
          </button>
        ))}
      </div>

      {tab === 'rwa' ? (
        <>
          <motion.section className="card card-rgb card-glow-cyan" variants={riseIn} initial="hidden" animate="show">
            <div className="sheen" />
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 5 }}>{t('stocks.rwaTitle')}</div>
            <p className="muted" style={{ fontSize: 12.3, margin: 0 }}>{t('stocks.rwaBody')}</p>
          </motion.section>

          <section>
            <p className="section-label">{t('stocks.rwaTokens')}</p>
            {loading ? (
              <div className="stack" style={{ gap: 8, marginTop: 8 }}>
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="skel" style={{ height: 58 }} />
                ))}
              </div>
            ) : rwaCoins.length === 0 ? (
              <div className="empty">
                <span className="empty-icon">🏛</span>
                {t('stocks.noTokens')}
              </div>
            ) : (
              <motion.div className="stack" style={{ gap: 8, marginTop: 8 }} variants={stagger} initial="hidden" animate="show">
                {rwaCoins.map((c) => (
                  <motion.div
                    key={c.id}
                    className="coin-row"
                    variants={riseIn}
                    onClick={() => navigate(`/coin/${c.id}`)}
                  >
                    <div className="coin-logo">{c.image ? <img src={c.image} alt="" /> : c.symbol.slice(0, 3)}</div>
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
            <p className="faint" style={{ marginTop: 9, lineHeight: 1.7 }}>{t('stocks.rwaNote')}</p>
          </section>
        </>
      ) : (
        <>
          <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
            <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
              <span style={{ color: 'var(--rgb-5)', flexShrink: 0 }}><IconShield width={20} height={20} /></span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 4 }}>{t('stocks.honestTitle')}</div>
                <p className="muted" style={{ fontSize: 12.2, margin: 0 }}>{t('stocks.honestBody')}</p>
              </div>
            </div>
          </motion.section>

          <section>
            <p className="section-label">{t('stocks.issuers')}</p>
            <motion.div className="stack" style={{ gap: 9, marginTop: 8 }} variants={stagger} initial="hidden" animate="show">
              {ISSUERS.map((iss) => (
                <motion.button
                  key={iss.id}
                  className="wallet-option"
                  variants={riseIn}
                  whileTap={{ scale: 0.985 }}
                  onClick={() => open(iss.url)}
                >
                  <span className="wallet-badge" style={{ color: iss.color, fontSize: 11, fontFamily: 'var(--font-mono)' }}>
                    {t(`stocks.issuer.${iss.id}.short`)}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 700, fontSize: 13.5 }}>
                      {t(`stocks.issuer.${iss.id}.name`)}
                    </span>
                    <span className="set-row-sub">{t(`stocks.issuer.${iss.id}.desc`)}</span>
                  </span>
                  <IconExternal width={17} height={17} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
                </motion.button>
              ))}
            </motion.div>
          </section>

          <p className="notice">{t('stocks.kycNotice')}</p>
        </>
      )}

      <p className="notice notice-danger">{t('stocks.riskNotice')}</p>
    </PageTransition>
  );
}
