import { motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

/**
 * SPLASH — the first thing anyone sees.
 *
 * ─── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * The old first-run flow asked for a language twice: once on Welcome, then
 * again as step 0 of Onboarding. Two consecutive screens asking the same
 * question reads as a bug, and it is the worst possible first impression —
 * before the user has seen anything the product does, they have already been
 * made to repeat themselves.
 *
 * So the duplicate is gone and this takes its place: one branded moment, then
 * straight into the app. Language and name stay together on Welcome, which is
 * where they belong — the name field's own label is unreadable until the
 * language is right.
 *
 * ─── ANIMATION BUDGET ───────────────────────────────────────────────────────
 * Everything here is a one-shot entrance. There is exactly one looping
 * element, the slow ring rotation, and it stops mattering the moment the user
 * taps Start because the whole screen unmounts.
 *
 * That restraint is deliberate. The Ecosystem screen shipped with nine
 * permanent `repeat: Infinity` blur pulses and felt broken on a mid-range
 * phone — the compositor never got to rest. A splash is on screen for seconds,
 * so it can afford a little more, but the same rule applies: no stacked
 * backdrop filters, and nothing that keeps running once it is off screen.
 *
 * `useReducedMotion` is honoured because a spinning, pulsing first screen is a
 * genuine accessibility problem for people with vestibular disorders — and it
 * is the one screen nobody can skip.
 */
export default function Splash({ onStart }) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();

  // With reduced motion the mark simply appears; nothing rotates or breathes.
  const ringSpin = reduce
    ? {}
    : { rotate: 360, transition: { duration: 18, repeat: Infinity, ease: 'linear' } };

  return (
    <div className="splash">
      {/* Soft colour wash. Static gradients, not animated blurs. */}
      <div className="splash-glow" aria-hidden="true" />

      <div className="splash-center">
        <motion.div
          className="splash-mark"
          initial={reduce ? { opacity: 0 } : { scale: 0.72, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 200, damping: 16 }}
        >
          {/* Orbiting ring — the only looping element on the screen. */}
          <motion.span className="splash-ring" animate={ringSpin} aria-hidden="true" />

          <svg viewBox="0 0 24 24" width="46" height="46" fill="none" aria-hidden="true">
            <defs>
              <linearGradient id="splashGrad" x1="0" y1="0" x2="24" y2="24">
                <stop offset="0%" stopColor="#00e5ff" />
                <stop offset="55%" stopColor="#7c4dff" />
                <stop offset="100%" stopColor="#ff2d95" />
              </linearGradient>
            </defs>
            <motion.circle
              cx="12" cy="12" r="9"
              stroke="url(#splashGrad)" strokeWidth="1.8"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 1, ease: 'easeOut' }}
            />
            <motion.path
              d="M9 9h5.2a2.4 2.4 0 0 1 0 4.8H9V9zm0 4.8h5.6a2.4 2.4 0 0 1 0 4.8H9v-4.8z"
              stroke="url(#splashGrad)" strokeWidth="1.7"
              strokeLinecap="round" strokeLinejoin="round"
              transform="translate(0 -3)"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.35, ease: 'easeOut' }}
            />
          </svg>
        </motion.div>

        <motion.h1
          className="splash-name"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          FBT&nbsp;Swap
        </motion.h1>

        <motion.p
          className="splash-tag"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.58, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          {t('splash.tagline')}
        </motion.p>
      </div>

      <motion.div
        className="splash-foot"
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.75, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        <motion.button
          type="button"
          className="btn btn-primary splash-btn"
          whileTap={{ scale: 0.97 }}
          onClick={onStart}
          autoFocus
        >
          {t('splash.start')}
        </motion.button>
      </motion.div>
    </div>
  );
}
