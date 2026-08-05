import { useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import { useWallet, shortAddress } from '../context/WalletContext';
import { useTelegram } from '../context/TelegramContext';
import { openUrl } from '../lib/browser';
import { IconChevronLeft, IconExternal, IconShield, IconSwap, IconQr } from '../components/Icons';
import FiatPanel from '../components/FiatPanel';
import SegIndicator from '../components/SegIndicator';

/**
 * BUY & SELL — getting fiat in and out.
 *
 * ─── WHY THIS SCREEN LOOKS LIKE A DIRECTORY, NOT A CHECKOUT ─────────────────
 * A version of this existed once as a card-payment on-ramp (MoonPay, Transak,
 * Ramp) and was removed a release later, correctly: all three refuse Iranian
 * users, so the screen was a row of buttons that could only ever fail. Worse,
 * OFAC designated Nobitex, Wallex, Bitpin and Ramzinex in June 2026 with
 * SECONDARY sanctions, so wiring straight into the obvious domestic
 * alternatives is not a workaround either.
 *
 * But removing the screen entirely created a different problem, and the owner
 * named it exactly: the app looks unfinished. Someone holding no crypto opens
 * a crypto app, finds no way to obtain any, and concludes it is a half-built
 * demo — when in fact every other part works.
 *
 * So the screen is back, doing the one honest thing available: explaining the
 * routes that actually work and handing off to the places that run them. That
 * is the same shape as the P2P screen, for the same reason — we do not hold
 * funds, we do not run an escrow, and pretending otherwise would be the one
 * unrecoverable mistake on a money screen.
 *
 * ─── WE TAKE NOTHING HERE ───────────────────────────────────────────────────
 * No fee, no referral, no commission. Not modesty: we are not part of the
 * transaction at all. Saying so plainly matters because a fee we do not charge
 * is the kind of thing users assume is hidden somewhere, and that suspicion
 * costs more than the fee would have earned. Our 0.70% is on swaps, disclosed
 * on the swap screen, and nowhere else.
 */

/**
 * Routes that genuinely work, ordered by how well they work for our users.
 *
 * Deliberately NOT a list of card-payment on-ramps. Every mainstream provider
 * blocks the region, so listing them would recreate the dead buttons this
 * screen was deleted for.
 *
 * ─── AND NOT A LINK TO ANOTHER EXCHANGE, EITHER ─────────────────────────────
 * This used to send people to p2p.binance.com. Removed on the owner's
 * instruction, and he is right on the principle: «ما خودمون صرافی هستیم».
 *
 * We are an exchange. Putting a competitor's front door on our own buy screen
 * hands over the one thing that is genuinely scarce — a user who already
 * arrived, already trusts us, and is ready to spend money. Binance also bars
 * Iran outright, so the link was sending most of our users somewhere they
 * would be refused, which made it worse than useless.
 *
 * The internal P2P screen stays: it lists desks that run real escrow, and it
 * keeps the user inside our app where the swap afterwards is ours at 0.70%.
 */
const ROUTES = [
  {
    id: 'p2p',
    /* Internal: the P2P screen already routes to desks that run real escrow. */
    to: '/p2p',
    color: 'var(--rgb-4)',
    Icon: IconSwap
  },
  {
    id: 'receive',
    /* The simplest and safest: somebody sends you crypto directly. */
    to: '/wallet',
    color: 'var(--rgb-1)',
    Icon: IconQr
  },
  {
    id: 'swap',
    /* Already holding something? Then no fiat step is needed at all. */
    to: '/swap',
    color: 'var(--rgb-2)',
    Icon: IconSwap
  }
];

/** Things that actually go wrong, in the order they cost people money. */
const WARNINGS = ['network', 'reversal', 'escrow', 'rate'];

export default function Buy() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic } = useTelegram();
  const wallet = useWallet();

  const [tab, setTab] = useState('buy');

  const go = (route) => {
    haptic?.('light');
    if (route.to) return navigate(route.to);
    /*
     * External links open through openUrl(), which uses a Custom Tab where the
     * real domain stays visible. A payment page rendered inside a WebView we
     * control is indistinguishable from a phishing page, and this is the one
     * screen where that distinction is the whole point.
     */
    return openUrl(route.url);
  };

  return (
    <PageTransition>
      <div className="row" style={{ gap: 10, marginBottom: 4 }}>
        <button className="icon-btn" onClick={() => navigate(-1)} aria-label={t('common.back')}>
          <IconChevronLeft width={18} height={18} />
        </button>
        <h1 className="h1" style={{ margin: 0 }}>{t('buy.title')}</h1>
      </div>

      {/* ---------------------------- buy / sell ---------------------------- */}
      <div className="segmented" style={{ marginTop: 12 }}>
        {['buy', 'sell'].map((k) => (
          <button
            key={k}
            className={tab === k ? 'active' : ''}
            onClick={() => {
              haptic?.('select');
              setTab(k);
            }}
            style={{ isolation: 'isolate' }}
          >
            {/*
              THE MISSING PILL. `.segmented button.active` only sets the text
              colour to black — the coloured background behind it comes from
              SegIndicator, which this screen never rendered. So the active tab
              was black text on a dark panel: invisible in dark theme, and
              barely there in light. Every other segmented control in the app
              has this; copying the markup without it was the bug.
            */}
            {tab === k && <SegIndicator id="buytab" />}
            {t(`buy.tab.${k}`)}
          </button>
        ))}
      </div>

      {/*
        ─── BUYING WITH MONEY, WHERE IT BELONGS ────────────────────────────
        On the buy/sell screen, keyed to the tab the user already chose. The
        crypto-to-crypto swap deliberately does NOT appear here: that is our
        own product at 0.70%, and routing it to a partner would hand over a
        customer we already have. `server/fiat.js` makes a crypto-to-crypto
        pair impossible to even request.
      */}
      <FiatPanel mode={tab} />

      {/* ------------------------------ intro ------------------------------ */}
      <motion.section className="card card-rgb" variants={riseIn} initial="hidden" animate="show">
        <div className="sheen" />
        <p className="section-label" style={{ marginBottom: 8 }}>{t(`buy.${tab}.heading`)}</p>
        <p className="muted" style={{ fontSize: 12.6, lineHeight: 1.85 }}>{t(`buy.${tab}.body`)}</p>

        {/*
          The fee statement. Stated on both tabs because the question "what do
          they take" is asked on both, and an unanswered version of it is
          assumed to have a bad answer.
        */}
        <p className="notice" style={{ marginTop: 12 }}>{t('buy.noFee')}</p>
      </motion.section>

      {/* ------------------------------ routes ------------------------------ */}
      <motion.section variants={stagger} initial="hidden" animate="show">
        <p className="section-label" style={{ marginBottom: 8 }}>{t(`buy.${tab}.routesTitle`)}</p>

        <div className="stack" style={{ gap: 9 }}>
          {ROUTES.map((r) => (
            <motion.button
              key={r.id}
              className="set-row"
              variants={riseIn}
              onClick={() => go(r)}
              style={{ width: '100%', textAlign: 'start', cursor: 'pointer' }}
            >
              <span className="set-row-icon" style={{ color: r.color }}>
                <r.Icon width={18} height={18} />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 700, fontSize: 13 }}>
                  {t(`buy.route.${r.id}.name`)}
                </span>
                <span className="set-row-sub">{t(`buy.route.${r.id}.${tab}`)}</span>
              </span>
              {r.url && <IconExternal width={15} height={15} className="faint" />}
            </motion.button>
          ))}
        </div>
      </motion.section>

      {/* --------------------------- your address --------------------------- */}
      {/*
        Where the coins land. Shown because it is the single detail a user must
        get right and cannot undo — and because someone about to buy needs it
        in front of them, not three screens away.
      */}
      {tab === 'buy' && (
        <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
          <p className="section-label" style={{ marginBottom: 8 }}>{t('buy.yourAddress')}</p>
          {wallet.address ? (
            <>
              <div className="mono" style={{ fontSize: 12.5, wordBreak: 'break-all' }}>
                {wallet.address}
              </div>
              <p className="faint" style={{ fontSize: 11.5, marginTop: 8, lineHeight: 1.75 }}>
                {t('buy.addressHint', { chain: wallet.chain?.name ?? 'BNB Smart Chain' })}
              </p>
              <button
                className="btn btn-ghost btn-sm"
                style={{ width: '100%', marginTop: 10 }}
                onClick={() => navigate('/wallet')}
              >
                {t('buy.openWallet')} — {shortAddress(wallet.address)}
              </button>
            </>
          ) : (
            <>
              <p className="muted" style={{ fontSize: 12.4 }}>{t('buy.connectFirst')}</p>
              <button
                className="btn btn-primary"
                style={{ marginTop: 10 }}
                onClick={() => navigate('/wallet')}
              >
                {t('wallet.connect')}
              </button>
            </>
          )}
        </motion.section>
      )}

      {/* ------------------------------ safety ------------------------------ */}
      <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
        <div className="row" style={{ gap: 8, marginBottom: 10 }}>
          <span style={{ color: 'var(--rgb-5)' }}><IconShield width={17} height={17} /></span>
          <p className="section-label" style={{ margin: 0 }}>{t('buy.safetyTitle')}</p>
        </div>
        <ul className="stack" style={{ gap: 9, margin: 0, paddingInlineStart: 18 }}>
          {WARNINGS.map((w) => (
            <li key={w} style={{ fontSize: 12.4, lineHeight: 1.8 }} className="muted">
              {t(`buy.warn.${w}`)}
            </li>
          ))}
        </ul>
        <p className="notice notice-danger" style={{ marginTop: 12 }}>{t('buy.notAdvice')}</p>
      </motion.section>
    </PageTransition>
  );
}
