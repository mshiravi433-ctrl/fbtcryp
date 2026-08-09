import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import InfoBox from '../components/InfoBox';
import AdBanner from '../components/AdBanner';
import { useTelegram } from '../context/TelegramContext';
import { useWallet, shortAddress } from '../context/WalletContext';
import SendSheet from '../components/SendSheet';
import TapToPay from '../components/TapToPay';
import RestrictionsSheet from '../components/RestrictionsSheet';
import { IconChevronLeft, IconExternal, IconShield, IconSwap } from '../components/Icons';
import SegIndicator from '../components/SegIndicator';
import BoardPanel from '../components/BoardPanel';

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
 * ─── WHY THE PER-ROW "BLOCKS IRAN" PILL IS GONE ─────────────────────────────
 * Every row carried a red "Blocks Iran" badge and the section carried a red
 * OFAC warning above it. The owner's objection is a product point, not a
 * cosmetic one:
 *
 *     «ما از همه جهان مشتری داریم نه فقط ایران»
 *
 * A user in Ankara or Dubai opened a screen built to help them trade and was
 * met with three red badges about a sanctions regime that does not apply to
 * them. That trains everyone — including the person the warning was written
 * for — to scroll past red.
 *
 * The facts are unchanged and are NOT deleted: all three publish Iran as a
 * fully blocked jurisdiction, and somebody who deposits and is then frozen is
 * materially worse off than somebody who never signed up. It all moved into
 * RestrictionsSheet, one tap away, as a per-country table where a Turkish
 * user reads "TRY works" and an Iranian user still reads the warning.
 *
 * `fiat` stays per-desk because it is the useful, non-alarming fact: which
 * currencies each desk actually settles.
 */
const DESKS = [
  { id: 'binance', url: 'https://p2p.binance.com', color: '#f0b90b', fiat: 'USD, EUR, TRY, AED' },
  { id: 'okx', url: 'https://www.okx.com/p2p-markets', color: '#00e5ff', fiat: 'USD, EUR, TRY' },
  { id: 'bybit', url: 'https://www.bybit.com/fiat/trade/otc', color: '#ffb300', fiat: 'USD, EUR, TRY' }
];

const SCAMS = ['reversal', 'thirdParty', 'offPlatform', 'overpay'];

export default function P2P() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic, tg } = useTelegram();
  const wallet = useWallet();

  const [tab, setTab] = useState('otc');
  const [sendOpen, setSendOpen] = useState(false);
  const [restrictOpen, setRestrictOpen] = useState(false);

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

      <p className="prose-sm">{t('p2p.subtitle')}</p>

      {/*
        A THIRD TAB, ADDED WITHOUT DISTURBING THE OTHER TWO.

        `board` is appended rather than inserted so the default tab stays
        'otc' and anybody who knows this screen finds it unchanged. The board
        is the new revenue surface (see components/BoardPanel.jsx); the two
        existing tabs are untouched.
      */}
      <div className="segmented">
        {['otc', 'fiat', 'board'].map((k) => (
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
                <p className="prose-sm">{t('p2p.connectFirst')}</p>
                <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={() => navigate('/wallet')}>
                  {t('wallet.connect')}
                </button>
              </>
            )}
            <p className="notice" style={{ marginTop: 11 }}>{t('p2p.otcNotice')}</p>
          </motion.section>

          {/*
            TAP TO PAY — the in-person half of peer-to-peer.

            The desks above are for meeting a stranger over the internet. This
            is for the person standing in front of you, which is how most P2P
            in Iran actually happens and which nothing in this app served.

            The tap exchanges an ADDRESS, never a signature: see
            lib/tapToPay.js for why phone-to-phone NFC transfers are not a
            thing we chose not to build (Android removed the API in 14) and
            why proximity must never be able to move money on its own.
          */}
          {/*
            Folded into a collapsible box, as asked. It is a secondary route —
            most P2P here is still the desks above — and an always-open panel
            with a QR code in it pushed the primary content off the screen.
          */}
          <motion.div variants={riseIn} initial="hidden" animate="show">
            <InfoBox title={t('tap.title')} tone="info" id="tap-to-pay">
              <TapToPay onAddress={() => setSendOpen(true)} />
            </InfoBox>
          </motion.div>

          <AdBanner slot="swap" />

          <SendSheet open={sendOpen} onClose={() => setSendOpen(false)} />
        </>
      ) : tab === 'board' ? (
        /*
          The classifieds board. A component rather than inline JSX because
          this file is already long, and because the board owns real state
          (fetching, a form, a payment flow) that has no business being
          interleaved with the two link-out tabs.
        */
        <BoardPanel />
      ) : (
        <>
          <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
            <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
              <span style={{ color: 'var(--rgb-5)', flexShrink: 0 }}>
                <IconShield width={20} height={20} />
              </span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 4 }}>{t('p2p.honestTitle')}</div>
                <p className="prose-sm">{t('p2p.honestBody')}</p>
              </div>
            </div>
          </motion.section>

          <section>
            <div className="row-between" style={{ gap: 10 }}>
              <p className="section-label" style={{ flex: 1 }}>{t('p2p.desks')}</p>
              {/*
                ─── ELIGIBILITY, ONE TAP AWAY AND NOT SHOUTED ──────────────
                This link replaces three red "Blocks Iran" badges and a red
                OFAC banner. Same facts, better placement: a user in Turkey
                or the UAE is not warned about a rule that does not apply to
                them, and a user in Iran still gets the full explanation the
                moment they look for it.

                Neutral styling on purpose. Red is reserved for the things
                that will cost this particular user money — an irreversible
                transfer, a wrong network — and spending it on a rule most
                readers are unaffected by is what makes red stop working.
              */}
              <button
                className="btn btn-ghost btn-sm"
                style={{ flexShrink: 0 }}
                onClick={() => {
                  haptic?.('light');
                  setRestrictOpen(true);
                }}
              >
                {t('restrict.open')}
              </button>
            </div>
            <motion.div className="stack" style={{ gap: 9, marginTop: 8 }} variants={stagger} initial="hidden" animate="show">
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
                    </span>
                  </span>
                  <IconExternal width={16} height={16} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
                </motion.button>
              ))}
            </motion.div>
          </section>

          {/*
            ─── THE PART THAT WAS MISSING: HOW TO ACTUALLY DO IT ───────────────
            Asked to write the cash-buying section better. Reading it back, the
            screen explained why we do not run a desk, listed three desks, and
            then listed four ways to be defrauded — but never once told someone
            HOW to complete a purchase. It was all context and warning with no
            instruction, which is why it read as discouraging rather than
            useful.

            The OTC tab already has a numbered `p2p.step.*` list for sending to
            a person. The fiat side had no equivalent. This is it, and the order
            is the order the actions actually happen in, so it can be followed
            with the desk open in another tab.
          */}
          <section>
            <p className="section-label">{t('p2p.howTitle')}</p>
            <p className="prose-sm" style={{ marginTop: 4 }}>{t('p2p.howIntro')}</p>
            <motion.ol className="p2p-steps" variants={stagger} initial="hidden" animate="show">
              {['b1', 'b2', 'b3', 'b4', 'b5', 'b6'].map((k) => (
                <motion.li key={k} variants={riseIn}>{t(`p2p.buyStep.${k}`)}</motion.li>
              ))}
            </motion.ol>
          </section>

          {/*
            ─── EVERY WARNING, IN ONE BOX THAT OPENS ───────────────────────────
            Asked for directly. This tab previously rendered SIX separate
            warning surfaces: four always-expanded red-numbered scam cards, the
            liability notice, and the restrictions link. On a phone that is a
            column of alarm the user scrolls past to reach the desk buttons.

            That is the exact mechanism InfoBox was built for and documented
            against: when every block is a warning, none of them is. The
            content is unchanged and nothing is deleted — the four scams keep
            their numbers and their full text, one tap away, under a title that
            states what is inside.

            `defaultOpen` is false on purpose. A collapsed box with an
            informative title is read; an expanded wall is skipped. The single
            thing that could cost money on THIS tap — the liability notice —
            stays as its own box below rather than being buried in with the
            educational content.
          */}
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

          {/*
            ─── PHYSICAL CASH, WHICH THE SCREEN NEVER ADDRESSED ────────────────
            "Buy with cash" listed three online desks and stopped. But handing
            somebody banknotes in person is how a large share of real P2P
            happens here, and it is the case with NO escrow, no arbitration and
            no reversal — the most dangerous one, and the one we said nothing
            about.

            It is not discouraged into silence, because saying nothing does not
            stop anybody; it just means they do it without the two rules that
            matter (meet somewhere with cameras, and verify on-chain yourself
            rather than trusting a screenshot).
          */}
          <InfoBox title={t('p2p.cashTitle')} tone="warn" id="p2p-cash">
            <p>{t('p2p.cashBody')}</p>
          </InfoBox>

          <InfoBox title={t('p2p.noticeTitle')} tone="danger" id="p2p-notice">
            <p>{t('p2p.notice')}</p>
          </InfoBox>

          {/*
            Rendered here, inside the tab that links out. Mounting it at the
            page root would keep a portal alive on the OTC tab where nothing
            can open it.
          */}
          <RestrictionsSheet open={restrictOpen} onClose={() => setRestrictOpen(false)} />
        </>
      )}
    </PageTransition>
  );
}
