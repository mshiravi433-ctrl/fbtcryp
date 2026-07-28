import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useTelegram } from '../context/TelegramContext';
import LanguagePicker from '../components/LanguagePicker';
import Sheet from '../components/Sheet';
import { useSettingsStore } from '../store/useSettingsStore';
import { FEE_BPS } from '../lib/chains';
import {
  IconSwap,
  IconTrend,
  IconWallet,
  IconShield,
  IconCheck,
  IconChevronRight,
  IconChevronLeft,
  IconInfo,
  IconLock,
  IconGlobe
} from '../components/Icons';

/**
 * FIRST-LAUNCH GUIDE
 * ---------------------------------------------------------------------------
 * Four sections the user must page through before the app unlocks:
 *   1. Swap        — what a swap is, both fees, slippage, why swaps fail
 *   2. Predict     — signals are ranges not promises; points have no value
 *   3. Wallet      — the three connect paths and the mobile failures we see
 *   4. Security    — recovery phrase, app lock, scams
 *
 * LAYOUT NOTE (this is why it is built the way it is):
 * The onboarding screens broke on small phones because the animated wrapper
 * both scrolled and was transformed. Framer Motion writes `transform` on the
 * animating element, which creates a containing block and makes a nested
 * `position: fixed` child or a `100dvh` height resolve against the wrong box —
 * content ended up half off-screen.
 *
 * Here the layers are separated and never mixed:
 *   .guide-stage   fixed, full screen, flex column   — never animated
 *   .guide-scroll  the ONLY scrolling element        — never transformed
 *   motion.div     animated content inside the scroll box, no height of its own
 * Header, progress rail and the footer button live outside the scroll box so
 * they can't scroll away, and the footer respects the safe-area inset so it
 * clears the gesture bar.
 */

const SECTIONS = [
  {
    key: 'swap',
    Icon: IconSwap,
    hues: ['#00e5ff', '#7c4dff'],
    steps: ['s1', 's2', 's3', 's4', 's5'],
    notes: [
      { key: 'fee', tone: 'warn' },
      { key: 'slip', tone: 'info' },
      { key: 'fail', tone: 'info' }
    ]
  },
  {
    key: 'predict',
    Icon: IconTrend,
    hues: ['#7c4dff', '#ff2d95'],
    steps: ['s1', 's2', 's3', 's4'],
    notes: []
  },
  {
    key: 'wallet',
    Icon: IconWallet,
    hues: ['#00ff9d', '#00e5ff'],
    steps: ['m1', 'm2', 'm3'],
    problems: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'],
    notes: []
  },
  {
    key: 'security',
    Icon: IconShield,
    hues: ['#ff2d95', '#ffb300'],
    steps: ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'],
    notes: [],
    danger: true
  }
];

function Step({ section, id, index, danger }) {
  const { t } = useTranslation();
  return (
    <motion.div
      className="guide-step"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.05, 0.3), duration: 0.35 }}
    >
      <span className="guide-step-num mono" data-danger={danger ? 'true' : 'false'}>
        {String(index + 1).padStart(2, '0')}
      </span>
      <div style={{ minWidth: 0 }}>
        <div className="guide-step-title">{t(`guide.${section}.${id}title`)}</div>
        <p className="guide-step-body">{t(`guide.${section}.${id}body`)}</p>
      </div>
    </motion.div>
  );
}

export default function Guide({ onDone }) {
  const { t, i18n } = useTranslation();
  const { haptic } = useTelegram();
  const markGuideRead = useSettingsStore((s) => s.markGuideRead);

  const [index, setIndex] = useState(0);
  const [langOpen, setLangOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  // Every section must actually be opened before the finish button unlocks —
  // otherwise "I read the guide" is a lie the user tells themselves in one tap.
  const [seen, setSeen] = useState(() => new Set([0]));
  const scrollRef = useRef(null);

  const section = SECTIONS[index];
  const isLast = index === SECTIONS.length - 1;
  const allSeen = seen.size === SECTIONS.length;

  // Reset scroll on every section change; leaving it mid-page makes the next
  // section look like it starts halfway through.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Element.scrollTo is missing on some older Android WebViews; assigning
    // scrollTop works everywhere and can't throw.
    if (typeof el.scrollTo === 'function') el.scrollTo({ top: 0, behavior: 'auto' });
    else el.scrollTop = 0;
  }, [index]);

  // Read from the same constant the swap engine charges from, so the guide
  // can never quote a rate the app doesn't actually take.
  const feePercent = useMemo(() => {
    const v = String(FEE_BPS / 100);
    return i18n.language === 'fa' ? toFa(v) : v;
  }, [i18n.language]);

  const go = (next) => {
    if (next < 0 || next >= SECTIONS.length) return;
    haptic?.('light');
    setIndex(next);
    setSeen((prev) => new Set(prev).add(next));
  };

  // AnimatePresence needs the import; kept next to its only other use.

  const finish = () => {
    if (!allSeen) return;
    haptic?.('success');
    // Play the exit animation before unmounting; flipping the store first
    // makes App swap the tree instantly and the guide just blinks away.
    setLeaving(true);
    setTimeout(() => {
      markGuideRead();
      onDone?.();
    }, 420);
  };

  return (
    <motion.div
      className="guide-stage"
      animate={leaving ? { opacity: 0, scale: 0.96, filter: 'blur(6px)' } : { opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* ------------------------------ header ------------------------------ */}
      <div className="guide-head">
        <div className="guide-head-top">
          <div>
            <div className="guide-kicker mono">{t('guide.step', { n: i18n.language === 'fa' ? toFa(index + 1) : index + 1 })}</div>
            <h1 className="guide-title">{t('guide.title')}</h1>
          </div>
          <div className="row" style={{ gap: 8 }}>
            {/* Language is offered here as well as on welcome: someone who
                realises mid-guide that they'd rather read it in another
                language shouldn't have to reinstall to change it. */}
            <button className="guide-lang-btn" onClick={() => setLangOpen(true)} aria-label={t('lang.title')}>
              <IconGlobe width={15} height={15} />
              <span>{(i18n.language || 'fa').toUpperCase()}</span>
            </button>

            <motion.div
              className="guide-badge"
              style={{ background: `linear-gradient(140deg, ${section.hues[0]}, ${section.hues[1]})` }}
              key={section.key}
              initial={{ scale: 0.6, rotate: -12, opacity: 0 }}
              animate={{ scale: 1, rotate: 0, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 260, damping: 18 }}
            >
              <section.Icon width={22} height={22} />
            </motion.div>
          </div>
        </div>

        <div className="guide-rail">
          {SECTIONS.map((s, i) => (
            <button
              key={s.key}
              className="guide-rail-item"
              data-state={i === index ? 'active' : seen.has(i) ? 'seen' : 'todo'}
              onClick={() => go(i)}
              aria-label={t(`guide.${s.key}.title`)}
            >
              <span className="guide-rail-fill" />
            </button>
          ))}
        </div>
      </div>

      {/* --------------------- the ONLY scrolling element -------------------- */}
      <div className="guide-scroll" ref={scrollRef}>
        <AnimatePresence mode="wait">
          <motion.div
            key={section.key}
            initial={{ opacity: 0, x: 26 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -26 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            <h2 className="guide-sec-title">{t(`guide.${section.key}.title`)}</h2>
            <p className="guide-lead">{t(`guide.${section.key}.lead`)}</p>

            <div className="guide-steps">
              {section.steps.map((id, i) => (
                <Step key={id} section={section.key} id={id} index={i} danger={section.danger} />
              ))}
            </div>

            {section.problems && (
              <>
                <div className="guide-divider">
                  <span>{t('guide.wallet.title')}</span>
                </div>
                <div className="guide-steps">
                  {section.problems.map((id, i) => (
                    <div className="guide-problem" key={id}>
                      <div className="guide-problem-title">
                        <span className="guide-problem-dot" />
                        {t(`guide.wallet.${id}title`)}
                      </div>
                      <p className="guide-step-body">{t(`guide.wallet.${id}body`)}</p>
                    </div>
                  ))}
                </div>
              </>
            )}

            {section.notes?.map((n) => (
              <div key={n.key} className={`guide-note guide-note-${n.tone}`}>
                <span className="guide-note-icon">
                  {n.tone === 'warn' ? <IconLock width={16} height={16} /> : <IconInfo width={16} height={16} />}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div className="guide-note-title">{t(`guide.${section.key}.${n.key}Title`)}</div>
                  <p className="guide-step-body" style={{ marginTop: 3 }}>
                    {t(`guide.${section.key}.${n.key}Body`, { fee: feePercent })}
                  </p>
                </div>
              </div>
            ))}

            {isLast && <p className="guide-reopen">{t('guide.reopen')}</p>}

            {/* Breathing room so the last line is never hidden by the footer. */}
            <div style={{ height: 12 }} />
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ------------------------------ footer ------------------------------ */}
      <div className="guide-foot">
        {!allSeen && isLast && <p className="guide-hint">{t('guide.doneHint')}</p>}

        <div className="guide-foot-row">
          {/* Both buttons are flex:1 with a fixed height, so Back and Next are
              always exactly the same size. Previously Back was auto-width and
              Next was flex:1, which made Back balloon on the last step and
              looked especially wrong in Persian where the labels are longer.
              AnimatePresence keeps Back from popping in and out abruptly. */}
          <AnimatePresence initial={false} mode="popLayout">
            {index > 0 && (
              <motion.button
                key="back"
                layout
                className="btn btn-ghost guide-btn"
                initial={{ opacity: 0, scale: 0.9, width: 0 }}
                animate={{ opacity: 1, scale: 1, width: 'auto' }}
                exit={{ opacity: 0, scale: 0.9, width: 0 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                whileTap={{ scale: 0.96 }}
                onClick={() => go(index - 1)}
              >
                <IconChevronLeft width={16} height={16} />
                <span>{t('guide.back')}</span>
              </motion.button>
            )}
          </AnimatePresence>

          {isLast ? (
            <motion.button
              layout
              className="btn btn-primary guide-btn"
              whileTap={{ scale: allSeen ? 0.97 : 1 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              onClick={finish}
              disabled={!allSeen}
            >
              <IconCheck width={17} height={17} />
              <span>{t('guide.done')}</span>
            </motion.button>
          ) : (
            <motion.button
              layout
              className="btn btn-primary guide-btn"
              whileTap={{ scale: 0.97 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              onClick={() => go(index + 1)}
            >
              <span>{t('guide.next')}</span>
              <IconChevronRight width={17} height={17} />
            </motion.button>
          )}
        </div>

        <Sheet open={langOpen} onClose={() => setLangOpen(false)} title={t('lang.title')}>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>{t('lang.subtitle')}</p>
          <LanguagePicker onPick={() => setLangOpen(false)} />
        </Sheet>

      </div>
    </motion.div>
  );
}

/** Persian-Indic digits, used only when the UI language is Persian. */
function toFa(n) {
  return String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
}
