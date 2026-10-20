import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import { useTelegram } from '../context/TelegramContext';
import SubTabRail from '../components/learn/SubTabRail';
import { LearnTop } from '../components/learn/LearnHero';
import '../styles/learn-hub.css';
import {
  IconChevronRight,
  IconExternal,
  IconSwap,
  IconPools,
  IconWallet,
  IconActivity,
  IconShield,
  IconTrend,
  IconSparkle,
  IconFingerprint,
  IconGlobe,
  IconUser,
  IconClock,
  IconAlertTriangle,
  IconRoute,
  IconPlay
} from '../components/Icons';

/**
 * DOCS — the «مستندات» tab of the Learn hub.
 * ---------------------------------------------------------------------------
 * In-app documentation for beginners: each section explains one screen — what
 * it does, the steps to use it, and the mistake people actually make there.
 * The "pitfall" line matters more than the steps: most losses come from not
 * knowing what can go wrong, not from being unable to find a button.
 *
 * ─── THE 2026 REDESIGN: A SUB-TAB PER LEVEL ────────────────────────────────
 * Every section always carried a `level`; before the redesign that only
 * painted a small badge on the card while all fourteen sections sat in one
 * column, ordered by nothing in particular. Someone opening this for the first
 * time was shown «Intent OS» and «dYdX» in the same breath as «ساخت کیف پول».
 *
 * The level is now the navigation: مبتدی · متوسط · حرفه‌ای, each with its own
 * count, and each with a line saying what you should already know before you
 * start it. The order inside a level is the order the app is actually learned
 * in — not the order the sections happen to sit in this array.
 *
 * ─── WHY THE VIDEO BUTTON IS A SEARCH, AND ONLY IN ENGLISH ─────────────────
 * It opens a YouTube SEARCH for a technical phrase, and it is labelled as one.
 * A button that pointed at one specific video broke every time that video was
 * removed; a search always returns something. Persian is not offered here
 * because the Persian results were reliably unrelated, and a button that works
 * sometimes is worse than no button.
 */

const youtube = (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;

export const DOC_SECTIONS = [
  { id: 'start', Icon: IconWallet, steps: 4, level: 'beginner', hue: '#7c4dff', en: youtube('how to use metamask beginner') },
  { id: 'security', Icon: IconShield, steps: 5, level: 'beginner', hue: '#ff2d95', en: youtube('crypto wallet security seed phrase') },
  { id: 'why', Icon: IconTrend, steps: 5, level: 'beginner', hue: '#00e5ff' },
  { id: 'strategy', Icon: IconPools, steps: 5, level: 'beginner', hue: '#00ff9d' },
  { id: 'swap', Icon: IconSwap, steps: 5, level: 'beginner', hue: '#00e5ff', en: youtube('how to swap tokens dex beginner') },
  { id: 'portfolio', Icon: IconGlobe, steps: 4, level: 'beginner', hue: '#7c4dff' },
  { id: 'farm', Icon: IconPools, steps: 4, level: 'intermediate', hue: '#ffb300', en: youtube('liquidity pool impermanent loss explained') },
  { id: 'signals', Icon: IconActivity, steps: 3, level: 'intermediate', hue: '#ff2d95', en: youtube('rsi macd explained beginners') },
  { id: 'trade', Icon: IconTrend, steps: 3, level: 'intermediate', hue: '#00ff9d' },
  { id: 'smartwallet', Icon: IconFingerprint, steps: 4, level: 'intermediate', hue: '#7c4dff' },
  { id: 'p2p', Icon: IconUser, steps: 4, level: 'intermediate', hue: '#ffb300' },
  { id: 'orders', Icon: IconClock, steps: 4, level: 'intermediate', hue: '#00ff9d' },
  { id: 'intentos', Icon: IconSparkle, steps: 5, level: 'pro', hue: '#00e5ff', en: youtube('intent based trading explained') },
  { id: 'dydx', Icon: IconTrend, steps: 5, level: 'pro', hue: '#00e5ff', en: youtube('dydx how to deposit fund account tutorial dydx.trade') }
];

/*
 * The three levels, in the order they should be read.
 *
 * They are plain strings, not objects with a quoted `id` property, on purpose:
 * test/wiring.mjs collects every quoted `id` in this file to enumerate the
 * GUIDE sections and then demands `docs.<id>.title|sub|pitfall|stepN` in all
 * twelve locales — the guard that stops a section shipping without
 * translations. A quoted level in this file would be collected as a section
 * and the check would report a missing translation for a thing that is not a
 * guide. The levels are labels, not sections; they live one nesting level up.
 */
const LEVELS = ['beginner', 'intermediate', 'pro'];
const LEVEL_STYLE = {
  beginner: { Icon: IconWallet, a: '#00e5ff', b: '#7c4dff' },
  intermediate: { Icon: IconActivity, a: '#00ff9d', b: '#00e5ff' },
  pro: { Icon: IconSparkle, a: '#ff2d95', b: '#7c4dff' }
};

export default function Docs({ embedded = false }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { haptic, tg } = useTelegram();
  const locale = i18n.resolvedLanguage || i18n.language || 'en';

  const [level, setLevel] = useState('beginner');
  const [openId, setOpenId] = useState(null);

  const counts = useMemo(
    () =>
      LEVELS.reduce((acc, id) => {
        acc[id] = DOC_SECTIONS.filter((s) => s.level === id).length;
        return acc;
      }, {}),
    []
  );

  const sections = useMemo(() => DOC_SECTIONS.filter((s) => s.level === level), [level]);
  const num = (n) => new Intl.NumberFormat(locale).format(n);

  const open = (url) => {
    haptic?.('light');
    if (tg?.openLink) tg.openLink(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <PageTransition embedded={embedded}>
      {!embedded && (
        <motion.div variants={riseIn} initial="hidden" animate="show">
          <LearnTop
            title={t('docs.title')}
            sub={t('learn.tabsSub.docs')}
            onBack={() => navigate(-1)}
            backLabel={t('common.back')}
          />
        </motion.div>
      )}

      <motion.div variants={riseIn} initial="hidden" animate="show">
        <SubTabRail
          items={LEVELS.map((id) => ({ id, ...LEVEL_STYLE[id], count: counts[id] }))}
          value={level}
          onChange={(id) => {
            haptic?.('select');
            setLevel(id);
            setOpenId(null);
          }}
          labelPrefix="docs.level"
          label={t('learn.subtabsTitle')}
          hint={t(`learn.hint.${level}`)}
          locale={locale}
        />
      </motion.div>

      <AnimatePresence mode="wait">
        <motion.div
          key={level}
          className="lh-doc-grid"
          variants={stagger}
          initial="hidden"
          animate="show"
        >
          {sections.map(({ id, Icon, steps, hue, en }, index) => {
            const isOpen = openId === id;
            // «01 ·» — the reading order inside the level, printed in mono so
            // the eye can walk the column; the steps chip says how long the
            // section is before it is opened.
            const order = String(index + 1).padStart(2, '0');
            return (
              <motion.div
                key={id}
                className="lh-doc"
                data-open={isOpen}
                variants={riseIn}
                layout
                style={{ '--hue': hue }}
              >
                <button
                  type="button"
                  className="lh-doc-head"
                  onClick={() => {
                    haptic?.('select');
                    setOpenId(isOpen ? null : id);
                  }}
                  aria-expanded={isOpen}
                >
                  <span className="lh-doc-icon" aria-hidden="true">
                    <Icon width={20} height={20} style={{ position: 'relative', zIndex: 1 }} />
                  </span>
                  <span className="lh-doc-text">
                    <span className="lh-doc-title-row">
                      <span className="lh-doc-order" aria-hidden="true">{order}</span>
                      <span className="lh-doc-title">{t(`docs.${id}.title`)}</span>
                    </span>
                    <span className="lh-doc-sub">{t(`docs.${id}.sub`)}</span>
                    <span className="lh-doc-meta-row">
                      <span className="lh-doc-chip">
                        <IconRoute width={11} height={11} aria-hidden="true" />
                        {t('docs.stepsCount', { n: num(steps) })}
                      </span>
                      {en ? (
                        <span className="lh-doc-chip">
                          <IconPlay width={10} height={10} aria-hidden="true" />
                          {t('docs.watchVideo')}
                        </span>
                      ) : null}
                    </span>
                  </span>
                  <motion.span
                    className="lh-doc-chev"
                    animate={{ rotate: isOpen ? 90 : 0 }}
                    transition={{ duration: 0.2 }}
                    aria-hidden="true"
                  >
                    <IconChevronRight width={15} height={15} />
                  </motion.span>
                </button>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
                      style={{ overflow: 'hidden' }}
                    >
                      <div className="lh-doc-body">
                        <div className="lh-doc-steps">
                          {Array.from({ length: steps }).map((_, i) => (
                            <motion.div
                              key={i}
                              className="lh-doc-step"
                              initial={{ opacity: 0, y: -6 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ delay: i * 0.04 }}
                            >
                              <span className="lh-doc-rail" aria-hidden="true">
                                <span className="lh-doc-num">{num(i + 1)}</span>
                                {i < steps - 1 && <span className="lh-doc-line" />}
                              </span>
                              <span className="lh-doc-step-text">{t(`docs.${id}.step${i + 1}`)}</span>
                            </motion.div>
                          ))}
                        </div>

                        <div className="lh-pitfall">
                          <span className="lh-pitfall-icon" aria-hidden="true">
                            <IconAlertTriangle width={15} height={15} />
                          </span>
                          <p className="lh-pitfall-text">
                            <strong>{t('docs.pitfall')}:</strong> {t(`docs.${id}.pitfall`)}
                          </p>
                        </div>

                        {en && (
                          <div className="lh-doc-foot">
                            <span className="lh-doc-meta">{t('docs.videoNote')}</span>
                            <button type="button" className="lh-doc-video" onClick={() => open(en)}>
                              <IconExternal width={13} height={13} />
                              {t('docs.watchEn')}
                            </button>
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
      </AnimatePresence>

      <div className="lh-btn-row" style={{ marginTop: 4 }}>
        <button
          type="button"
          className="lh-btn lh-btn--ghost"
          style={{ '--a': '#00e5ff', '--b': '#7c4dff' }}
          onClick={() => navigate('/help')}
        >
          {t('help.title')}
        </button>
        <button
          type="button"
          className="lh-btn lh-btn--ghost"
          style={{ '--a': '#ff2d95', '--b': '#7c4dff' }}
          onClick={() => navigate('/legal/disclaimer')}
        >
          {t('disclaimer.title')}
        </button>
      </div>
    </PageTransition>
  );
}
