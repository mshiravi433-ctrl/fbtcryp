import { useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import { useWallet, shortAddress } from '../context/WalletContext';
import { useTelegram } from '../context/TelegramContext';
import { openUrl } from '../lib/browser';
import { IconChevronLeft, IconExternal, IconShield, IconSwap, IconQr } from '../components/Icons';
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
 * ─── WE DO EARN HERE NOW, AND THE SCREEN SAYS SO WHERE IT MATTERS ───────────
 * This comment used to read "we take nothing here". That was true when the
 * screen was only a directory of routes. It stopped being true when the fiat
 * panel went live: purchases made through it carry a partner commission on
 * our account.
 *
 * The disclosure moved with the fact. Rather than a policy banner at the
 * bottom of the page — which is read by nobody — the fiat panel itemises
 * ChangeNOW's own service-fee breakdown right beside the amount, before
 * anything is committed. That is the figure the user is actually charged, and
 * our cut is already inside it.
 *
 * The three routes below still earn us nothing and are still here, because a
 * user with no crypto and no card needs an answer more than we need a cut of
 * every screen.
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
  },

  /*
   * ═══════════════════════════════════════════════════════════════════════
   * ─── EXTERNAL DESKS, EACH ONE OPENED AND CHECKED ────────────────────────
   * ═══════════════════════════════════════════════════════════════════════
   * Asked for: «لینک سایت معتبر بزار تا بعد» — put a link to a real site
   * here until the partner comes back.
   *
   * The bar every candidate had to clear, and most failed:
   *
   *   1. NO IDENTITY VERIFICATION TO START. A link to a desk that demands a
   *      passport our users cannot supply is a dead button dressed as help.
   *   2. NON-CUSTODIAL OR REAL ESCROW. We are sending someone toward their
   *      own money; a custodial desk that can freeze it is a liability we
   *      would be lending our name to.
   *   3. THE SITE ANSWERED WHEN I OPENED IT. Not "is well reviewed" —
   *      actually loaded. freepd.com taught this lesson last week: a source
   *      everyone recommends can simply be gone.
   *
   * ─── AND WE EARN NOTHING FROM THESE, ON PURPOSE ─────────────────────────
   * No referral codes attached. Both run peer-to-peer marketplaces where the
   * counterparty is another person, and attaching a commission to a
   * recommendation on THAT page would quietly change what the
   * recommendation is for. The revenue comes from the swap they do here
   * afterwards, which is ours at 0.70%.
   */
  {
    id: 'bisq',
    /*
     * Verified by opening it: "Buy and sell bitcoin for fiat ... using
     * Bisq's peer-to-peer network and open-source desktop software. No
     * registration required." Funds sit in 2-of-2 multisig, every node is a
     * Tor hidden service, and the code is open.
     *
     * Listed FIRST because it is the only one on this screen that is
     * genuinely decentralised — there is no company that can decide our
     * users are the wrong nationality.
     *
     * Its one real cost is honest and stated in the copy: it is desktop
     * software, so a phone-only user cannot use it today.
     */
    url: 'https://bisq.network/',
    color: 'var(--rgb-5)',
    Icon: IconShield
  },
  {
    id: 'hodlhodl',
    /*
     * Verified by opening it: "Non-custodial Bitcoin trading solution, we
     * don't hold your funds", "Anonymous — No verification required",
     * multisig P2SH escrow, 100+ currencies, eight years running.
     *
     * Second because it needs an email address, which Bisq does not — but
     * it works in a mobile browser, which Bisq does not. Between them they
     * cover both kinds of user.
     */
    url: 'https://hodlhodl.com/',
    color: 'var(--rgb-3)',
    Icon: IconShield
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
        ─── THE CHANGENOW PANEL IS GONE, TEMPORARILY ────────────────────────
        Removed on the owner's instruction: «گفتند تا سپتامبر تعطیله برش
        دار» — the partner told him fiat is suspended until September.

        This is the right call and the reason is worth stating, because the
        panel was NOT visibly broken. `/api/fiat/status` still answered
        `{"enabled":true}` in production, so the form rendered, accepted an
        amount, and would only have failed at the moment somebody pressed the
        button with real money in hand. That is the worst place in the whole
        app to discover a partner is offline.

        Deleting the panel rather than flipping CHANGENOW_FIAT_ENABLED is
        deliberate: the env var lives in the Vercel dashboard, so the code
        would still be one accidental toggle away from re-exposing a dead
        integration. The server module, its routes and its tests all stay —
        nothing is thrown away, and re-enabling is a one-line revert.

        What replaces it is a directory of on-ramps that were each opened and
        checked, not a list copied from an article. See ROUTES.
      */}

      {/* ------------------------------ intro ------------------------------ */}
      <motion.section className="card card-rgb" variants={riseIn} initial="hidden" animate="show">
        <div className="sheen" />
        <p className="section-label" style={{ marginBottom: 8 }}>{t(`buy.${tab}.heading`)}</p>
        <p className="prose-sm">{t(`buy.${tab}.body`)}</p>

        {/*
          ─── THE OLD "WE TAKE NOTHING" NOTICE IS GONE, AND HAD TO GO ──────
          It read, verbatim: "we charge no fee on this page … no commission,
          no referral share." That stopped being true the moment the fiat
          panel above started earning a partner commission. Leaving it would
          have been the app's only outright false statement, on a money
          screen, which is the worst possible place for one.

          It is not replaced by a different banner. The fiat panel itemises
          ChangeNOW's own service fees inline, at the moment the amount is
          entered — a figure next to the number it applies to is read; a
          policy statement in a box below is not.
        */}
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
              <p className="prose-sm" style={{ marginTop: 8 }}>
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
              <p className="prose-sm">{t('buy.connectFirst')}</p>
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
    </PageTransition>
  );
}
