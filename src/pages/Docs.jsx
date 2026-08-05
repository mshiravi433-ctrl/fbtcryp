import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import RadioPanel from '../components/RadioPanel';
import { useTelegram } from '../context/TelegramContext';
import {
  IconChevronLeft, IconChevronRight, IconExternal, IconSwap,
  IconPools, IconWallet, IconActivity, IconShield, IconTrend
} from '../components/Icons';

/**
 * In-app documentation for beginners.
 *
 * Each section explains one screen: what it does, the steps to use it, and the
 * mistake people actually make there. The "pitfall" line matters more than the
 * steps — most losses come from not knowing what can go wrong, not from being
 * unable to find a button.
 *
 * YouTube links point at well-known educational channels rather than anything
 * we produced, and are labelled as third-party so nobody assumes we vetted
 * every word.
 */
/*
 * ─── TWO VIDEO SOURCES, AND WHY ─────────────────────────────────────────────
 * Every tutorial link used to be a YOUTUBE SEARCH. Two problems with that,
 * and the first one is fatal for most of our users:
 *
 *   1. YouTube is blocked in Iran. A tutorial button that opens a page which
 *      never loads is worse than no button — the user concludes the app is
 *      broken, not that their network is.
 *
 *   2. A search URL is not a tutorial. It hands someone a results page and
 *      hopes the top hit is good, in a category full of referral-farming
 *      channels. We cannot vet a search result that has not happened yet.
 *
 * So each section now carries BOTH: an Aparat search (Iran's own video
 * platform, reachable without a VPN, and Persian-language) and the YouTube
 * one for everyone else. The UI offers whichever is likely to work, labelled
 * by language so nobody taps into a video they cannot understand.
 *
 * Still searches rather than fixed video IDs, and that is deliberate: a
 * pinned video can be deleted, monetised or edited into something we would
 * not endorse, and we would never know. A search stays useful.
 */
const youtube = (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;

const SECTIONS = [
  { id: 'why', Icon: IconTrend, steps: 5 },
  { id: 'strategy', Icon: IconPools, steps: 5 },
  {
    id: 'start',
    Icon: IconWallet,
    steps: 4,
    en: youtube('how to use metamask beginner')
  },
  {
    id: 'swap',
    Icon: IconSwap,
    steps: 5,
    en: youtube('how to swap tokens dex beginner')
  },
  {
    id: 'farm',
    Icon: IconPools,
    steps: 4,
    en: youtube('liquidity pool impermanent loss explained')
  },
  {
    id: 'signals',
    Icon: IconActivity,
    steps: 3,
    en: youtube('rsi macd explained beginners')
  },
  { id: 'trade', Icon: IconTrend, steps: 3 },
  {
    id: 'security',
    Icon: IconShield,
    steps: 5,
    en: youtube('crypto wallet security seed phrase')
  }
];

export default function Docs({ embedded = false }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic, tg } = useTelegram();
  const [openId, setOpenId] = useState('start');

  const open = (url) => {
    haptic?.('light');
    if (tg?.openLink) tg.openLink(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <PageTransition embedded={embedded}>
      {/* Suppressed when hosted in a tabbed page — the shell already draws a
          back button and a title, and two of each is clutter. */}
      {!embedded && (
        <motion.div className="row" style={{ gap: 10 }} variants={riseIn} initial="hidden" animate="show">
          <button className="icon-btn" onClick={() => navigate(-1)} aria-label={t('common.back')}>
            <IconChevronLeft width={18} height={18} />
          </button>
          <h1 className="h1" style={{ fontSize: 19 }}>{t('docs.title')}</h1>
        </motion.div>
      )}

      <p className="prose-sm">{t('docs.intro')}</p>

      <motion.div className="stack" style={{ gap: 10 }} variants={stagger} initial="hidden" animate="show">
        {SECTIONS.map(({ id, Icon, steps, en }) => {
          const isOpen = openId === id;
          return (
            <motion.div key={id} className={`card ${isOpen ? 'card-rgb' : ''}`} variants={riseIn} layout>
              <button
                onClick={() => {
                  haptic?.('select');
                  setOpenId(isOpen ? null : id);
                }}
                style={{ background: 'none', border: 'none', width: '100%', padding: 0, cursor: 'pointer', textAlign: 'start' }}
              >
                <div className="row-between">
                  <div className="row" style={{ gap: 11 }}>
                    <span className="wallet-badge" style={{ width: 36, height: 36 }}>
                      <Icon width={18} height={18} />
                    </span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13.5 }}>{t(`docs.${id}.title`)}</div>
                      <div className="faint">{t(`docs.${id}.sub`)}</div>
                    </div>
                  </div>
                  <motion.span animate={{ rotate: isOpen ? 90 : 0 }} style={{ color: 'var(--text-3)' }}>
                    <IconChevronRight width={17} height={17} />
                  </motion.span>
                </div>
              </button>

              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                    style={{ overflow: 'hidden' }}
                  >
                    <div style={{ paddingTop: 13 }}>
                      {Array.from({ length: steps }).map((_, i) => (
                        <motion.div
                          key={i}
                          className="row"
                          style={{ gap: 10, alignItems: 'flex-start', marginBottom: 9 }}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.05 }}
                        >
                          <span
                            className="mono"
                            style={{
                              minWidth: 21, height: 21, borderRadius: 7, display: 'grid', placeItems: 'center',
                              fontSize: 10, fontWeight: 700, flexShrink: 0,
                              background: 'linear-gradient(135deg,var(--rgb-1),var(--rgb-2))', color: '#000'
                            }}
                          >
                            {i + 1}
                          </span>
                          <span className="prose-sm">{t(`docs.${id}.step${i + 1}`)}</span>
                        </motion.div>
                      ))}

                      <p className="notice notice-danger" style={{ marginTop: 10 }}>
                        <strong>{t('docs.pitfall')}:</strong> {t(`docs.${id}.pitfall`)}
                      </p>

                      {/*
                        ─── THIS LINE CRASHED THE PAGE ────────────────────
                        It read `{(fa || en) && (`. When the Persian video
                        button was removed I deleted `fa` from the map
                        destructuring but left this reference behind, so the
                        component threw a ReferenceError on render and the
                        whole Docs screen went blank. Reported as «در مستندات
                        وقتی میریم صفحه کرش میزنه».

                        The build did not catch it: `fa` is a valid free
                        identifier at parse time and only fails when the line
                        actually runs. Wiring check #59 now renders this
                        screen so a dead reference cannot ship again.
                      */}
                      {en && (
                        <div className="doc-videos">
                          {/*
                            Persian first. Most of this app's users are in
                            Iran, where YouTube does not load at all — putting
                            the reachable option second would mean most people
                            tap the broken one first.
                          */}
                          {/*
                            ─── THE PERSIAN VIDEO BUTTON IS GONE ────────────
                            Reported: «فیلم های فارسی حذف بشه نمیارع» — the
                            Persian videos do not come up.

                            That was accurate, and the cause was structural
                            rather than a bad link. This never pointed at a
                            specific video; it ran an Aparat SEARCH for a
                            phrase like «آموزش نصب کیف پول متامسک». Whether
                            anything relevant came back depended on Aparat's
                            index that day, so the button promised a lesson
                            and often delivered an empty or irrelevant page.

                            A button that works sometimes is worse than no
                            button: the user blames the app and stops trusting
                            the other links too. The written guide above is
                            ours, always loads, and is complete — so the
                            honest move is to let it stand alone rather than
                            decorate it with a coin-flip.

                            English is kept because a YouTube search for a
                            technical phrase does reliably return results —
                            though it is now labelled as a search, not a video.
                          */}
                          {en && (
                            <button className="doc-video" onClick={() => open(en)}>
                              <IconExternal width={13} height={13} />
                              {t('docs.watchEn')}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </motion.div>

      <p className="prose-sm" style={{ marginTop: 10 }}>{t('docs.videoNote')}</p>

      {/*
        ─── LISTEN, RATHER THAN WATCH ──────────────────────────────────────
        Asked for as "internet TV or radio related to our work" on the
        education page. What is here is radio, and the missing half is a
        decision rather than an omission:

        A video embed means YouTube, and youtube.com does not resolve on most
        Iranian networks. The largest element on the learning page would be a
        grey box for the audience this app is built for — the same dead-button
        failure the written guides above replaced when they stopped being
        Aparat searches that returned nothing.

        Podcast audio is plain MP3 over HTTPS from reachable CDNs. It needs no
        embed, no SDK and no third-party script, it survives a slow
        connection, and it keeps playing with the screen off — which is how
        somebody actually learns while commuting.

        The same component as the news screen, so there is one place to fix
        if a feed moves. Placed AFTER the written guides: this is what you put
        on when you have finished reading, not instead of reading.
      */}
      <RadioPanel />

      {/*
        The disclaimer belongs in the docs, not only buried in Settings: it is
        the page to hand to an exchange listing reviewer or a store, and it
        states the copyright position now that the repository is public.
      */}
      <div className="row" style={{ gap: 8 }}>
        <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => navigate('/help')}>{t('help.title')}</button>
        <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => navigate('/legal/disclaimer')}>{t('disclaimer.title')}</button>
      </div>
    </PageTransition>
  );
}
