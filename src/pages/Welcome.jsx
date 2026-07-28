import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import LanguagePicker from '../components/LanguagePicker';
import { IconChevronRight, IconLanguages } from '../components/Icons';

/**
 * WELCOME — the very first screen, shown once, before onboarding.
 *
 * It does exactly one thing: pick a language. Putting it first is deliberate.
 * The old flow opened straight into a Persian onboarding carousel, which means
 * a Turkish or Indonesian user's first experience of the app was a wall of
 * text they could not read, with the language switch buried behind three taps
 * in a header they also could not read.
 *
 * Layout notes that matter on real phones:
 *   • The stage is fixed and never animated; only the inner list scrolls.
 *     Animating a scroll container makes Framer Motion write a `transform`,
 *     which creates a containing block and pushes fixed/dvh children off
 *     screen — the exact bug the onboarding footer used to have.
 *   • The footer sits outside the scroll area and respects the safe-area
 *     inset, so the Continue button clears the gesture bar.
 */
export default function Welcome({ onDone }) {
  const { t } = useTranslation();

  return (
    <div className="welcome-stage">
      <div className="welcome-head">
        <motion.div
          className="welcome-badge"
          initial={{ scale: 0.6, rotate: -12, opacity: 0 }}
          animate={{ scale: 1, rotate: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 18 }}
        >
          <IconLanguages width={26} height={26} />
        </motion.div>
        <motion.h1
          className="h1"
          style={{ fontSize: 22, marginTop: 14, textAlign: 'center' }}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          {t('welcome.title')}
        </motion.h1>
        <motion.p
          className="muted"
          style={{ textAlign: 'center', fontSize: 13, lineHeight: 1.8, marginTop: 6 }}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.16 }}
        >
          {t('welcome.subtitle')}
        </motion.p>
      </div>

      <div className="welcome-scroll">
        <LanguagePicker onPick={() => {}} />
      </div>

      <div className="welcome-foot">
        <motion.button className="btn btn-primary onb-btn" whileTap={{ scale: 0.97 }} onClick={onDone}>
          <span>{t('welcome.continue')}</span>
          <IconChevronRight width={17} height={17} />
        </motion.button>
      </div>
    </div>
  );
}
