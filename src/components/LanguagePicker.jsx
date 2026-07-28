import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { LANGUAGES, setLanguage } from '../i18n';
import { coverageFor, isComplete } from '../i18n/languages';
import { useTelegram } from '../context/TelegramContext';
import { IconCheck } from './Icons';

/**
 * Language chooser.
 *
 * WHY A LIST AND NOT A GRID
 * The first version was a two-column grid of cards. On a phone that gives each
 * language a ~150px box, which truncates "Bahasa Indonesia" and turns picking
 * a language into a game of hitting a small square — with two adjacent
 * mis-tap targets on either side. A single-column list gives every row the
 * full width, a 56px touch target (comfortably above the 44px minimum), and
 * room for the endonym, the English name and the coverage badge to sit side by
 * side without any of them being clipped.
 *
 * Each row shows the endonym first — the language's name *in* that language —
 * because "Persian" is unreadable to the person who only reads Persian, who is
 * exactly who this screen exists for.
 *
 * `variant="compact"` is the inline chip row used in the guide header, where a
 * full list would push the content off screen.
 */
export default function LanguagePicker({ variant = 'list', onPick, showCoverage = true }) {
  const { t, i18n } = useTranslation();
  const { haptic } = useTelegram();

  const pick = (code) => {
    haptic?.('select');
    setLanguage(code);
    onPick?.(code);
  };

  if (variant === 'compact') {
    return (
      <div className="tag-scroll" role="group" aria-label={t('common.language')}>
        {LANGUAGES.map((l) => (
          <motion.button
            key={l.code}
            className={`tag ${i18n.language === l.code ? 'active' : ''}`}
            whileTap={{ scale: 0.93 }}
            onClick={() => pick(l.code)}
            lang={l.code}
            dir={l.dir}
          >
            <span style={{ marginInlineEnd: 5 }}>{l.flag}</span>
            {l.endonym}
          </motion.button>
        ))}
      </div>
    );
  }

  return (
    <div className="lang-list" role="radiogroup" aria-label={t('common.language')}>
      {LANGUAGES.map((l, i) => {
        const active = i18n.language === l.code;
        return (
          <motion.button
            key={l.code}
            type="button"
            className={`lang-row ${active ? 'active' : ''}`}
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: Math.min(i * 0.028, 0.34), duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            whileTap={{ scale: 0.985 }}
            onClick={() => pick(l.code)}
            role="radio"
            aria-checked={active}
          >
            <span className="lang-flag" aria-hidden="true">{l.flag}</span>

            {/* The names are set in their own language and direction so an RTL
                endonym renders correctly even while the app is in an LTR
                language, and vice versa. */}
            <span className="lang-names">
              <span className="lang-endonym" lang={l.code} dir={l.dir}>{l.endonym}</span>
              <span className="lang-name">{l.name}</span>
            </span>

            {/* Show the measured figure, not a hand-set flag. A user who sees
                "38%" and then meets English is not surprised; one who was told
                "fully translated" is misled. */}
            {showCoverage && !isComplete(l.code) && (
              <span className="lang-badge partial">{coverageFor(l.code)}%</span>
            )}

            <motion.span
              className="lang-check"
              initial={false}
              animate={active ? { scale: 1, opacity: 1 } : { scale: 0.4, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 520, damping: 24 }}
              aria-hidden="true"
            >
              <IconCheck width={14} height={14} strokeWidth={2.6} />
            </motion.span>
          </motion.button>
        );
      })}
    </div>
  );
}
