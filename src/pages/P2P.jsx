import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import AdBanner from '../components/AdBanner';
import { useTelegram } from '../context/TelegramContext';
import { useWallet, shortAddress } from '../context/WalletContext';
import SendSheet from '../components/SendSheet';
import { IconChevronLeft, IconExternal, IconShield, IconSwap } from '../components/Icons';
import SegIndicator from '../components/SegIndicator';

/**
 * Peer-to-peer trading.
 *
 * ─── WHY THIS ROUTES OUT RATHER THAN MATCHING ORDERS ──────────────────────
 * A real P2P desk is not a UI problem. It needs an escrow that holds crypto
 * while fiat moves, a dispute process with human arbitrators, KYC on both
 * sides, and sanctions screening. Operating one makes you a money services
 * business in essentially every jurisdiction — the exact licensing burden this
 * app has avoided by staying non-custodial.
 *
 * Building a fake version would be worse than useless: users would send real
 * fiat to strangers believing an escrow protected them, and there'd be nothing
 * behind it when a counterparty vanished.
 *
 * So this screen does two honest things:
 *   1. Explains how P2P works and where the fraud happens.
 *   2. Routes to established desks that already run escrow and dispute teams.
 *
 * The on-chain OTC option below IS real and trustless — a direct wallet-to-
 * wallet transfer, which is genuinely peer-to-peer without needing escrow
 * because there's no fiat leg.
 */

/*
 * `blocksIran` is verified from each exchange's own published country list,
 * not assumed: all three name Iran under OFAC sanctions. Marked per-desk
 * rather than as one blanket sentence so the flag stays honest if one of them
 * ever changes policy.
 */
const DESKS = [
  { id: 'binance', url: 'https://p2p.binance.com', color: '#f0b90b', fiat: 'IRR, USD, EUR', blocksIran: true },
  { id: 'okx', url: 'https://www.okx.com/p2p-markets', color: '#00e5ff', fiat: 'USD, EUR', blocksIran: true },
  { id: 'bybit', url: 'https://www.bybit.com/fiat/trade/otc', color: '#ffb300', fiat: 'USD, EUR', blocksIran: true }
];

const SCAMS = ['reversal', 'thirdParty', 'offPlatform', 'overpay'];

export default function P2P() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic, tg } = useTelegram();
  const wallet = useWallet();

  const [tab, setTab] = useState('otc');
  const [sendOpen, setSendOpen] = useState(false);

  const open = (url) => {
    haptic?.('light');
    if (tg?.openLink) tg.openLink(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <PageTransition>
      <motion.div className="row" style={{ gap: 10 }} variants={riseIn} initial="hidden" animate="show">
        <button className="icon-btn" onClick={() => navigate(-1)} aria-label={t('common.back')}>
          <IconChevronLeft width={18} height={18} />
        </button>
        <h1 className="h1" style={{ fontSize: 19 }}>{t('p2p.title')}</h1>
      </motion.div>

      <p className="muted">{t('p2p.subtitle')}</p>

      <div className="segmented">
        {['otc', 'fiat'].map((k) => (
          <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)} style={{ isolation: 'isolate' }}>
            {tab === k && <SegIndicator id="p2ptab" />}
            {t(`p2p.tab.${k}`)}
          </button>
        ))}
      </div>

      {tab === 'otc' ? (
        <>
          <motion.section className="card card-rgb edge-mint" variants={riseIn} initial="hidden" animate="show">
            <div className="aurora" />
            <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
              <span style={{ color: 'var(--rgb-4)', flexShrink: 0 }}>
                <IconSwap width={20} height={20} />
              </span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 4 }}>{t('p2p.otcTitle')}</div>
                <p className="muted" style={{ fontSize: 12.2, margin: 0 }}>{t('p2p.otcBody')}</p>
              </div>
            </div>
          </motion.section>

          <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
            <p className="section-label" style={{ marginBottom: 10 }}>{t('p2p.sendDirect')}</p>
            {wallet.isConnected ? (
              <>
                <div className="row-between" style={{ marginBottom: 11 }}>
                  <span className="faint">{t('p2p.yourAddress')}</span>
                  <span className="mono" style={{ fontSize: 12 }}>{shortAddress(wallet.address)}</span>
                </div>
                {/*
                  This used to navigate to `/wallet?action=send`, but Wallet.jsx
                  never read that query parameter and no send form existed — the
                  button changed the URL and did nothing else. It now opens the
                  real transfer sheet.
                */}
                <button className="btn btn-primary" onClick={() => setSendOpen(true)}>
                  {t('p2p.openSend')}
                </button>

                <ol className="p2p-steps">
                  {['s1', 's2', 's3', 's4', 's5'].map((k) => (
                    <li key={k}>{t(`p2p.step.${k}`)}</li>
                  ))}
                </ol>
              </>
            ) : (
              <>
                <p className="muted" style={{ fontSize: 12.3 }}>{t('p2p.connectFirst')}</p>
                <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={() => navigate('/wallet')}>
                  {t('wallet.connect')}
                </button>
              </>
            )}
            <p className="notice" style={{ marginTop: 11 }}>{t('p2p.otcNotice')}</p>
          </motion.section>

          <AdBanner slot="swap" />

          <SendSheet open={sendOpen} onClose={() => setSendOpen(false)} />
        </>
      ) : (
        <>
          <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
            <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
              <span style={{ color: 'var(--rgb-5)', flexShrink: 0 }}>
                <IconShield width={20} height={20} />
              </span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 4 }}>{t('p2p.honestTitle')}</div>
                <p className="muted" style={{ fontSize: 12.2, margin: 0 }}>{t('p2p.honestBody')}</p>
              </div>
            </div>
          </motion.section>

          <section>
            <p className="section-label">{t('p2p.desks')}</p>
            <motion.div className="stack" style={{ gap: 9, marginTop: 8 }} variants={stagger} initial="hidden" animate="show">
              {/*
                ─── THESE DESKS BAR IRAN, AND THE USER MUST BE TOLD ────────
                Binance, OKX and Bybit all list Iran as fully blocked under
                OFAC. The desks stay because converting rial to crypto is the
                one thing this app genuinely does not do, so removing them
                would leave a real need with no answer at all.

                But sending somebody to sign up somewhere they will be
                refused — or worse, have an account frozen after depositing —
                is not help. The warning goes ON each row, not in a footnote,
                because that is where the decision is made.
              */}
              <p className="notice notice-danger" style={{ marginBottom: 10 }}>{t('p2p.deskWarning')}</p>

              {DESKS.map((d) => (
                <motion.button
                  key={d.id}
                  className="wallet-option"
                  variants={riseIn}
                  whileTap={{ scale: 0.985 }}
                  onClick={() => open(d.url)}
                >
                  <span className="wallet-badge" style={{ color: d.color, fontSize: 10, fontFamily: 'var(--font-mono)' }}>
                    {t(`p2p.desk.${d.id}.short`)}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 700, fontSize: 13 }}>{t(`p2p.desk.${d.id}.name`)}</span>
                    <span className="set-row-sub">{t(`p2p.desk.${d.id}.desc`)}</span>
                    <span className="row" style={{ gap: 5, marginTop: 5, flexWrap: 'wrap' }}>
                      <span className="pill pill-neutral">{d.fiat}</span>
                      {d.blocksIran && <span className="pill pill-down">{t('p2p.blocksIran')}</span>}
                    </span>
                  </span>
                  <IconExternal width={16} height={16} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
                </motion.button>
              ))}
            </motion.div>
          </section>

          <section>
            <p className="section-label">{t('p2p.scamsTitle')}</p>
            <motion.div className="stack" style={{ gap: 8, marginTop: 8 }} variants={stagger} initial="hidden" animate="show">
              {SCAMS.map((k, i) => (
                <motion.div key={k} className="card card-tight" variants={riseIn}>
                  <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                    <span
                      className="mono"
                      style={{
                        minWidth: 20, height: 20, borderRadius: 6, display: 'grid', placeItems: 'center',
                        fontSize: 10, fontWeight: 700, flexShrink: 0,
                        background: 'rgba(255,59,107,.16)', color: 'var(--down)'
                      }}
                    >
                      {i + 1}
                    </span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 12.6 }}>{t(`p2p.scam.${k}.title`)}</div>
                      <p className="muted" style={{ fontSize: 11.8, margin: '3px 0 0' }}>{t(`p2p.scam.${k}.body`)}</p>
                    </div>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          </section>

          <p className="notice notice-danger">{t('p2p.notice')}</p>
        </>
      )}
    </PageTransition>
  );
}
