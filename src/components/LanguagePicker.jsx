import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { LANGUAGES } from '../i18n';
import { IconCheck } from './Icons';

/**
 * Language grid, used on the welcome screen and in the guide header.
 *
 * Languages with partial coverage are labelled rather than hidden. Someone who
 * picks Turkish and then sees English risk warnings should know why — silently
 * mixing languages looks broken; saying "core translated, rest in English" is
 * honest and sets the right expectation.
 */
export default function LanguagePicker({ compact = false, onPick }) {
  const { t, i18n } = useTranslation();
  const current = i18n.language;

  const choose = (code) => {
    i18n.changeLanguage(code);
    onPick?.(code);
  };

  return (
    <div className={compact ? 'lang-grid lang-grid-compact' : 'lang-grid'}>
      {LANGUAGES.map((l) => {
        const active = current === l.code;
        return (
          <motion.button
            key={l.code}
            className="lang-tile"
            data-active={active}
            whileTap={{ scale: 0.96 }}
            onClick={() => choose(l.code)}
            aria-pressed={active}
          >
            <span className="lang-flag">{l.flag}</span>
            <span className="lang-text">
              <span className="lang-name">{l.name}</span>
              {!compact && (
                <span className="lang-sub">
                  {l.english}
                  {!l.complete && ` · ${t('lang.partial')}`}
                </span>
              )}
            </span>
            {active && (
              <span className="lang-check">
                <IconCheck width={14} height={14} />
              </span>
            )}
          </motion.button>
        );
      })}
    </div>
  );
}
