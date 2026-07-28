import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import LanguagePicker from '../components/LanguagePicker';
import UsernameField from '../components/UsernameField';
import { IconChevronRight } from '../components/Icons';
import { AnimatedLanguages, useStill } from '../components/AnimatedIcon';

/**
 * WELCOME — the very first screen, shown once, before onboarding.
 *
 * Two things, in this order: pick a language, then pick a display name.
 * Language comes first for the obvious reason — the name field's own label is
 * unreadable until the language is right.
 *
 * Putting language before onboarding at all is deliberate. The old flow opened
 * straight into a Persian carousel, so a Turkish or Indonesian user's first
 * experience was a wall of text they could not read, with the language switch
 * buried behind a header they also could not read.
 *
 * Layout notes that matter on real phones:
 *   • The stage is fixed and never animated; only the inner list scrolls.
 *     Animating a scroll container makes Framer Motion write a `transform`,
 *     which becomes the containing block for fixed/dvh children and pushes
 *     them off screen — the exact bug the onboarding footer used to have.
 *   • The footer sits outside the scroll area and respects the safe-area
 *     inset, so Continue clears the gesture bar.
 */
export default function Welcome({ onDone }) {
  const { t } = useTranslation();
  const still = useStill();

  return (
    <div className="welcome-stage">
      <div className="welcome-head">
        <motion.div
          className="welcome-badge"
          initial={{ scale: 0.6, rotate: -12, opacity: 0 }}
          animate={{ scale: 1, rotate: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 18 }}
        >
          <AnimatedLanguages active still={still} width={26} height={26} />
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
        <LanguagePicker />

        {/* Optional, and labelled as such. Nobody should feel gated behind a
            form field before they have seen the product. */}
        <motion.div
          className="welcome-name"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.42, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        >
          <UsernameField />
        </motion.div>
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
