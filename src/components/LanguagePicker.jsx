import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { LANGUAGES, setLanguage } from '../i18n';
import { useTelegram } from '../context/TelegramContext';

/**
 * Language grid, reused by the Welcome screen, the onboarding language step,
 * the guide header and Settings.
 *
 * Each tile shows the endonym — the name of the language in that language —
 * because "Persian" is unreadable to someone who only reads Persian, which is
 * precisely the person the picker exists for. The English name sits underneath
 * as a secondary line for anyone scanning a list they can't read.
 *
 * `variant="compact"` renders an inline chip row for headers where a full grid
 * would dominate the screen.
 */
export default function LanguagePicker({ variant = 'grid', onPick, showCoverage = true }) {
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
    <div className="lang-grid">
      {LANGUAGES.map((l, i) => {
        const active = i18n.language === l.code;
        return (
          <motion.button
            key={l.code}
            className={`lang-card ${active ? 'active' : ''}`}
            initial={{ opacity: 0, y: 14, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: Math.min(i * 0.035, 0.4), type: 'spring', stiffness: 380, damping: 26 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => pick(l.code)}
            lang={l.code}
            dir={l.dir}
            aria-pressed={active}
          >
            <span className="lang-flag" aria-hidden="true">{l.flag}</span>
            <span className="lang-endonym">{l.endonym}</span>
            <span className="lang-name">{l.name}</span>
            {showCoverage && (
              <span className={`lang-badge ${l.complete ? 'full' : 'partial'}`}>
                {l.complete ? t('welcome.full') : t('welcome.partial')}
              </span>
            )}
          </motion.button>
        );
      })}
    </div>
  );
}
