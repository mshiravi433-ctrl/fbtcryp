import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useTelegram } from '../context/TelegramContext';
import { useSettingsStore } from '../store/useSettingsStore';
import { FEE_BPS } from '../lib/chains';
import LanguagePicker from '../components/LanguagePicker';
import LaunchProgress from '../components/LaunchProgress';
import {
  IconSwap,
  IconTrend,
  IconWallet,
  IconShield,
  IconCheck,
  IconChevronRight,
  IconChevronLeft,
  IconInfo,
  IconLock
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
    problems: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'],
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

  /**
   * Finish and leave.
   *
   * `markGuideRead()` alone unmounts this component instantly, which reads as
   * a flicker rather than a transition. We play a short confirmation state
   * first, then persist — so the screen visibly dissolves instead of blinking
   * out from under the finger that just tapped it.
   */
  const [leaving, setLeaving] = useState(false);

  const finish = () => {
    if (!allSeen || leaving) return;
    haptic?.('success');
    setLeaving(true);
    setTimeout(() => {
      markGuideRead();
      onDone?.();
    }, 620);
  };

  return (
    <motion.div
      className="guide-stage"
      animate={leaving ? { opacity: 0, scale: 1.03, filter: 'blur(8px)' } : { opacity: 1, scale: 1, filter: 'blur(0px)' }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* Confirmation beat before the screen disappears for good. */}
      <AnimatePresence>
        {leaving && (
          <motion.div
            className="guide-leave-veil"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 5,
              display: 'grid',
              placeItems: 'center',
              background: 'rgba(0,0,0,.72)',
              backdropFilter: 'blur(6px)',
              textAlign: 'center',
              padding: 24
            }}
          >
            <div>
              <motion.div
                initial={{ scale: 0.5, rotate: -20 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 300, damping: 16 }}
                style={{
                  width: 66,
                  height: 66,
                  margin: '0 auto 14px',
                  borderRadius: 22,
                  display: 'grid',
                  placeItems: 'center',
                  color: '#000',
                  background: 'linear-gradient(140deg, var(--rgb-4), var(--rgb-1))'
                }}
              >
                <IconCheck width={32} height={32} strokeWidth={2.4} />
              </motion.div>
              <div style={{ fontWeight: 800, fontSize: 15 }}>{t('guide.closing')}</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ------------------------------ header ------------------------------ */}
      <div className="guide-head">
        <div className="guide-head-top">
          <div>
            <div className="guide-kicker mono">{t('guide.step', { n: i18n.language === 'fa' ? toFa(index + 1) : index + 1 })}</div>
            <h1 className="guide-title">{t('guide.title')}</h1>
            <LaunchProgress step={7 + index} total={10} />
          </div>
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

        {/* Language switch lives IN the guide, not only in a header the
            reader may not be able to read. The guide is the one screen a
            first-time user cannot skip, so it must be readable first. */}
        <div className="guide-lang">
          <span className="guide-lang-label">{t('guide.language')}</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <LanguagePicker variant="compact" />
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
            initial={{ opacity: 0, x: 26 * (i18n.dir() === 'rtl' ? -1 : 1) }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -26 * (i18n.dir() === 'rtl' ? -1 : 1) }}
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
          {index > 0 && (
            <motion.button className="btn btn-ghost guide-back" whileTap={{ scale: 0.96 }} onClick={() => go(index - 1)}>
              <IconChevronLeft width={16} height={16} />
              <span>{t('guide.back')}</span>
            </motion.button>
          )}

          {isLast ? (
            <motion.button
              className="btn btn-primary guide-cta"
              whileTap={{ scale: allSeen ? 0.97 : 1 }}
              onClick={finish}
              disabled={!allSeen}
            >
              <IconCheck width={17} height={17} />
              <span>{t('guide.done')}</span>
            </motion.button>
          ) : (
            <motion.button className="btn btn-primary guide-cta" whileTap={{ scale: 0.97 }} onClick={() => go(index + 1)}>
              <span>{t('guide.next')}</span>
              <IconChevronRight width={17} height={17} />
            </motion.button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

/** Persian-Indic digits, used only when the UI language is Persian. */
function toFa(n) {
  return String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
}
