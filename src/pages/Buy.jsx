import { useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn } from '../components/PageTransition';
import P2PMarket from '../components/P2PMarket';
import { useWallet, shortAddress } from '../context/WalletContext';
import { useTelegram } from '../context/TelegramContext';
import { IconChevronLeft, IconShield } from '../components/Icons';
import ExternalWalletPurchase from '../components/ExternalWalletPurchase';
import SegIndicator from '../components/SegIndicator';
import '../styles/lab-modern.css';

/**
 * BUY & SELL — a live market now, no longer a directory of links.
 * ---------------------------------------------------------------------------
 * ─── WHAT THIS PAGE USED TO BE, AND WHY THAT EARNED NOTHING ───────────────
 * It was a hand-off: cards that opened other people's marketplaces and sent
 * the user away at the exact moment they were ready to spend. The revenue on
 * that design was zero — worse than zero, really, because it paid for user
 * acquisition and then gave the user to a competitor. The owner's verdict
 * settled the direction: «ارجاع کلا قشنگ نیست»، «ما خودمون صرافی هستیم».
 *
 * ─── WHAT IT IS NOW ────────────────────────────────────────────────────────
 * A working market inside the app: live buy and sell offers for bitcoin
 * against local money (component/P2PMarket over server/hodlhodl.js), ranked
 * by effective price, with the escrow contract itself completed on the
 * desk's own site — because multisig escrow without KYC is exactly the one
 * step that cannot honestly happen here. The desk invoices the fee; our
 * referral lowers the user's fee and pays us a share of theirs. The history
 * of why we do not run our own escrow is on the P2P page and is unchanged.
 *
 * ─── THE ONE RULE AROUND HERE ─────────────────────────────────────────────
 * Nothing on this page may ever route around our own swap. The funnel that
 * makes this page a business is fiat -> BTC (referral on the desk's fee,
 * ~0.03% of volume) followed by BTC -> anything (our swap at 0.70% of
 * volume). The internal swap CTA sits at the END of the P2PMarket flow for
 * exactly that reason. Diverting a swapper toward the desk would trade the
 * 0.70% for a ~0.03% referral — roughly 25x worse — so the wiring suite
 * hard-fails if this market ever touches the swap path.
 *
 * The sections below the market (the user's own address, the safety
 * warnings) survived the rewrite on purpose: they were the good part.
 */

/** Things that actually go wrong, in the order they cost people money. */
const WARNINGS = ['network', 'reversal', 'escrow', 'rate'];

export default function Buy() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic } = useTelegram();
  const wallet = useWallet();

  /* Controlled side: the page keeps its address card in sync with the tab
     the market is showing (coins arrive -> buy only). */
  const [tab, setTab] = useState('buy');
  const [walletTab, setWalletTab] = useState('internal');

  return (
    <PageTransition>
      <div className="row" style={{ gap: 10, marginBottom: 4 }}>
        <button className="icon-btn" onClick={() => navigate(-1)} aria-label={t('common.back')}>
          <IconChevronLeft width={18} height={18} />
        </button>
        <h1 className="h1" style={{ margin: 0 }}>{t('buy.title')}</h1>
      </div>

      <div className="segmented" role="tablist" aria-label={t('buy.walletTabsLabel')}>
        {['internal', 'external'].map((key) => (
          <button key={key} role="tab" aria-selected={walletTab === key} className={walletTab === key ? 'active' : ''} onClick={() => setWalletTab(key)}>
            {walletTab === key && <SegIndicator id="buy-wallet-tab" />}
            {t(`buy.walletTabs.${key}`)}
          </button>
        ))}
      </div>

      {walletTab === 'external' ? <ExternalWalletPurchase /> : <>
        {/* ------------------------------ intro ------------------------------ */}
        <motion.section className="lab-hero" variants={riseIn} initial="hidden" animate="show" style={{ padding: 18 }}>
          <div className="lab-aurora" aria-hidden="true" />
          <p className="section-label" style={{ marginBottom: 8, position: 'relative' }}>{t('buy.intro.heading')}</p>
          <p className="prose-sm" style={{ position: 'relative' }}>{t('buy.intro.body')}</p>
        </motion.section>

        {/* The current P2P market remains intact under the internal wallet tab. */}
        <P2PMarket side={tab} onSideChange={setTab} />

      {/* --------------------------- your address --------------------------- */}
      {/*
        Where in-app coins land — shown on the buy tab because it is the one
        detail a user must get right and cannot undo. Distinct from the BTC
        release address above: the app's wallet is not a Bitcoin wallet, and
        the market's address field says so explicitly.
      */}
      {tab === 'buy' && (
        <motion.section className="lab-card" variants={riseIn} initial="hidden" animate="show" style={{ padding: 15 }}>
          <p className="section-label" style={{ marginBottom: 8 }}>{t('buy.yourAddress')}</p>
          {wallet.address ? (
            <>
              <div className="mono" style={{ fontSize: 12.5, wordBreak: 'break-all' }}>
                {wallet.address}
              </div>
              <p className="prose-sm" style={{ marginTop: 8 }}>
                {t('buy.addressHint', { chain: wallet.chain?.name ?? 'BNB Smart Chain' })}
              </p>
              <button
                className="btn btn-ghost btn-sm"
                style={{ width: '100%', marginTop: 10 }}
                onClick={() => {
                  haptic?.('light');
                  navigate('/wallet');
                }}
              >
                {t('buy.openWallet')} — {shortAddress(wallet.address)}
              </button>
            </>
          ) : (
            <>
              <p className="prose-sm">{t('buy.connectFirst')}</p>
              <button
                className="btn btn-primary"
                style={{ marginTop: 10 }}
                onClick={() => {
                  haptic?.('light');
                  navigate('/wallet');
                }}
              >
                {t('wallet.connect')}
              </button>
            </>
          )}
        </motion.section>
      )}

      {/* ------------------------------ safety ------------------------------ */}
      <motion.section className="lab-card" variants={riseIn} initial="hidden" animate="show" style={{ padding: 15 }}>
        <div className="row" style={{ gap: 8, marginBottom: 10 }}>
          <span style={{ color: 'var(--rgb-5)' }}><IconShield width={17} height={17} /></span>
          <p className="section-label" style={{ margin: 0 }}>{t('buy.safetyTitle')}</p>
        </div>
        {/*
          `.prose-list` rather than four `.muted` list items. At 12.4px with
          no gap between them the four warnings ran together and read as one
          paragraph, which meant the user saw one warning instead of four.
        */}
        <ul className="prose-list">
          {WARNINGS.map((w) => (
            <li key={w}>{t(`buy.warn.${w}`)}</li>
          ))}
        </ul>
          <p className="notice notice-danger" style={{ marginTop: 12 }}>{t('buy.notAdvice')}</p>
        </motion.section>
      </>}
    </PageTransition>
  );
}
