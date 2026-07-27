import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTelegram } from '../context/TelegramContext';
import { IconChevronRight, IconShield, IconSwap, IconTrend } from '../components/Icons';

/**
 * Three-screen welcome shown once on first launch.
 * Deliberately states the non-custodial trade-off on slide 3 rather than
 * burying it — someone whose first experience is "you alone hold the keys"
 * is far less likely to lose funds later.
 */

const SLIDES = [
  { key: 'trade', Icon: IconTrend, hues: ['#00e5ff', '#7c4dff'] },
  { key: 'swap', Icon: IconSwap, hues: ['#7c4dff', '#ff2d95'] },
  { key: 'custody', Icon: IconShield, hues: ['#00ff9d', '#00e5ff'] }
];

function Art({ Icon, hues, index }) {
  return (
    <div className="onb-art">
      {[0, 1, 2, 3].map((i) => (
        <motion.div
          key={`${index}-${i}`}
          className="onb-ring"
          style={{ width: 110 + i * 62, height: 110 + i * 62 }}
          initial={{ opacity: 0, scale: 0.75 }}
          animate={{ opacity: 0.5 - i * 0.1, scale: 1, rotate: i % 2 ? 8 : -8 }}
          transition={{ delay: i * 0.07, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        />
      ))}

      <motion.div
        key={`glow-${index}`}
        style={{
          position: 'absolute',
          width: 230,
          height: 230,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${hues[0]}55, transparent 68%)`,
          filter: 'blur(38px)'
        }}
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: 1, scale: [1, 1.12, 1] }}
        transition={{ scale: { duration: 4.5, repeat: Infinity }, opacity: { duration: 0.6 } }}
      />

      <motion.div
        key={`icon-${index}`}
        initial={{ scale: 0.4, opacity: 0, y: 18 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 220, damping: 18 }}
        style={{
          position: 'relative',
          width: 92,
          height: 92,
          borderRadius: 28,
          display: 'grid',
          placeItems: 'center',
          background: `linear-gradient(140deg, ${hues[0]}, ${hues[1]})`,
          boxShadow: `0 18px 50px -18px ${hues[0]}`,
          color: '#000'
        }}
      >
        <Icon width={44} height={44} strokeWidth={1.6} />
      </motion.div>
    </div>
  );
}

export default function Onboarding({ onDone }) {
  const { t } = useTranslation();
  const { haptic } = useTelegram();
  const complete = useSettingsStore((s) => s.completeOnboarding);
  const [index, setIndex] = useState(0);

  const slide = SLIDES[index];
  const isLast = index === SLIDES.length - 1;

  const finish = () => {
    complete();
    onDone?.();
  };

  const next = () => {
    haptic?.('light');
    if (isLast) finish();
    else setIndex((i) => i + 1);
  };

  return (
    <div className="onb-stage">
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 18px 0' }}>
        {!isLast && (
          <button
            onClick={finish}
            style={{ background: 'none', border: 'none', color: 'var(--text-3)', fontSize: 13, cursor: 'pointer', padding: 8 }}
          >
            {t('onboarding.skip')}
          </button>
        )}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={index}
          style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -40 }}
          transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
        >
          <Art Icon={slide.Icon} hues={slide.hues} index={index} />

          <div style={{ padding: '0 26px', textAlign: 'center' }}>
            <motion.h1
              className="h1"
              style={{ fontSize: 25, marginBottom: 10 }}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.12 }}
            >
              {t(`onboarding.${slide.key}.title`)}
            </motion.h1>
            <motion.p
              className="muted"
              style={{ fontSize: 13.5, lineHeight: 1.75 }}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              {t(`onboarding.${slide.key}.body`)}
            </motion.p>
          </div>
        </motion.div>
      </AnimatePresence>

      <div className="onb-dots">
        {SLIDES.map((s, i) => (
          <div key={s.key} className="onb-dot" data-active={i === index} />
        ))}
      </div>

      <div style={{ padding: '0 20px' }}>
        <motion.button className="btn btn-primary" whileTap={{ scale: 0.97 }} onClick={next}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, justifyContent: 'center' }}>
            {isLast ? t('onboarding.start') : t('onboarding.next')}
            {!isLast && <IconChevronRight width={17} height={17} />}
          </span>
        </motion.button>
      </div>
    </div>
  );
}
