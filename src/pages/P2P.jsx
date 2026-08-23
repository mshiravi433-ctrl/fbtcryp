import { useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn } from '../components/PageTransition';
import InfoBox from '../components/InfoBox';
import AdBanner from '../components/AdBanner';
import { useTelegram } from '../context/TelegramContext';
import { useWallet, shortAddress } from '../context/WalletContext';
import SendSheet from '../components/SendSheet';
import TapToPay from '../components/TapToPay';
import P2PMarket from '../components/P2PMarket';
import { IconChevronLeft, IconShield, IconSwap } from '../components/Icons';
import SegIndicator from '../components/SegIndicator';
import BoardPanel from '../components/BoardPanel';

/**
 * Peer-to-peer trading.
 *
 * ─── THE LINK DIRECTORY IS GONE; THE MARKET IS THE FIRST TAB ──────────────
 * This page used to route out to three competitor desks — all of which also
 * refuse a large share of our users outright, so the buttons were dead for
 * the very people they were meant to help, and the survivors were handed to
 * a rival at the moment of highest intent. The owner is right on both
 * counts: «ارجاع کلا قشنگ نیست» and we are an exchange ourselves.
 *
 * The market tab is the replacement: live offers from a desk that requires
 * no identity check to start, escrowed by multisig ON THE DESK'S SITE. Same
 * honesty boundary as before — we still do not run an escrow, still cannot
 * reverse a fiat dispute — but everything up to the contract (discovery,
 * comparison, the amount arithmetic) now happens inside the app instead of
 * after a bounce.
 *
 * ─── WHY THE ELIGIBILITY SHEET LEFT WITH THE DIRECTORY ────────────────────
 * RestrictionsSheet existed to answer "which of the three desks may freeze
 * me" — a question created by the directory itself. With the directory gone
 * the question is gone: the remaining desk asks for no identity check to
 * trade at all. The sheet itself is NOT deleted: FiatPanel still renders it
 * (its card-rail content stays accurate for the partner's return), and the
 * screens probe still mounts it. Removing it here is cutting a lookup whose
 * premises no longer exist on this page, not deleting safety information.
 *
 * ─── THE ONE RULE THIS PAGE SHARES WITH /BUY ──────────────────────────────
 * The market is fiat<->BTC only. It must never grow a crypto-to-crypto
 * quote, a "better price than swap" comparison, or a link out of our own
 * swap — the desk pays a referral of ~0.03% of volume against the swap's
 * 0.70%, so a diverted swapper is a ~25x revenue loss wearing the costume of
 * user choice. test/wiring.mjs asserts the boundary; components/P2PMarket
 * documents the funnel.
 */

const SCAMS = ['reversal', 'thirdParty', 'offPlatform', 'overpay'];

export default function P2P() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic } = useTelegram();
  const wallet = useWallet();

  /* market first: it is the tab that earns, and the tab that answers the
     question most openers of this page arrive with. OTC and the board are
     untouched beyond position. */
  const [tab, setTab] = useState('market');
  const [sendOpen, setSendOpen] = useState(false);

  return (
    <PageTransition>
      <motion.div className="row" style={{ gap: 10 }} variants={riseIn} initial="hidden" animate="show">
        <button className="icon-btn" onClick={() => navigate(-1)} aria-label={t('common.back')}>
          <IconChevronLeft width={18} height={18} />
        </button>
        <h1 className="h1" style={{ fontSize: 19 }}>{t('p2p.title')}</h1>
      </motion.div>

      <p className="prose-sm">{t('p2p.subtitle')}</p>

      <div className="segmented">
        {['market', 'otc', 'board'].map((k) => (
          <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)} style={{ isolation: 'isolate' }}>
            {tab === k && <SegIndicator id="p2ptab" />}
            {t(`p2p.tab.${k}`)}
          </button>
        ))}
      </div>

      {tab === 'market' ? (
        <>
          {/* Why the escrow step is somebody else's — stated once, plainly,
              instead of pretending we run a desk. */}
          <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
            <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
              <span style={{ color: 'var(--rgb-5)', flexShrink: 0 }}>
                <IconShield width={20} height={20} />
              </span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 4 }}>{t('p2p.escrowTitle')}</div>
                <p className="prose-sm">{t('p2p.escrowBody')}</p>
              </div>
            </div>
          </motion.section>

          {/* The live market itself — the same component /buy mounts. */}
          <P2PMarket />

          {/* Every scam pattern, kept — the market changed, the fraud didn't. */}
          <InfoBox title={t('p2p.scamsTitle')} tone="warn" id="p2p-scams">
            <p style={{ marginBottom: 10 }}>{t('p2p.scamsIntro')}</p>
            <div className="stack" style={{ gap: 10 }}>
              {SCAMS.map((k, i) => (
                <div key={k} className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
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
                    <p className="prose-sm" style={{ marginTop: 3 }}>{t(`p2p.scam.${k}.body`)}</p>
                  </div>
                </div>
              ))}
            </div>
          </InfoBox>

          {/* Physical cash: no escrow at all, still how a lot of real P2P
              happens — the two rules that matter, not silence. */}
          <InfoBox title={t('p2p.cashTitle')} tone="warn" id="p2p-cash">
            <p>{t('p2p.cashBody')}</p>
          </InfoBox>

          <InfoBox title={t('p2p.noticeTitle')} tone="danger" id="p2p-notice">
            <p>{t('p2p.notice')}</p>
          </InfoBox>
        </>
      ) : tab === 'board' ? (
        /*
          The classifieds board. A component rather than inline JSX because
          this file is already long, and because the board owns real state
          (fetching, a form, a payment flow) that has no business being
          interleaved with the market tab.
        */
        <BoardPanel />
      ) : (
        <>
          <motion.section className="card card-rgb edge-mint" variants={riseIn} initial="hidden" animate="show">
            <div className="aurora" />
            <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
              <span style={{ color: 'var(--rgb-4)', flexShrink: 0 }}>
                <IconSwap width={20} height={20} />
              </span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 4 }}>{t('p2p.otcTitle')}</div>
                <p className="prose-sm">{t('p2p.otcBody')}</p>
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
                <p className="prose-sm">{t('p2p.connectFirst')}</p>
                <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={() => navigate('/wallet')}>
                  {t('wallet.connect')}
                </button>
              </>
            )}
            <p className="notice" style={{ marginTop: 11 }}>{t('p2p.otcNotice')}</p>
          </motion.section>

          {/*
            TAP TO PAY — the in-person half of peer-to-peer. Folded into a
            collapsible box, as before: a secondary route whose always-open
            QR panel pushed the primary content off the screen.
          */}
          <motion.div variants={riseIn} initial="hidden" animate="show">
            <InfoBox title={t('tap.title')} tone="info" id="tap-to-pay">
              <TapToPay onAddress={() => setSendOpen(true)} />
            </InfoBox>
          </motion.div>

          <AdBanner slot="swap" />

          <SendSheet open={sendOpen} onClose={() => setSendOpen(false)} />
        </>
      )}
    </PageTransition>
  );
}
