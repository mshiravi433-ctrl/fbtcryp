import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTelegram } from '../context/TelegramContext';
import { IconCheck, IconUser } from './Icons';

/**
 * Display-name input, shared by the welcome screen and Settings.
 *
 * WHAT THIS IS AND IS NOT
 * It is a *display name*: the label shown next to your score on the
 * leaderboard. It is not an account, there is no password, nothing is
 * reserved, and two people may pick the same one. Being explicit about that
 * matters — in a wallet app, anything that looks like "register a username"
 * invites people to assume it protects or identifies their funds, and it does
 * neither. Identity here is a wallet address; this is a nickname.
 *
 * Validation is deliberately narrow rather than clever. The value is rendered
 * inside other users' clients, so control characters, angle brackets, quotes
 * and backslashes are rejected outright instead of escaped-and-hoped-for. RTL
 * override characters are stripped too: they let a name visually reverse the
 * text around it, which is a real spoofing trick, not a theoretical one.
 */

const MAX = 20;
const MIN = 2;

/** Characters that let a string visually rearrange the text around it. */
// eslint-disable-next-line no-misleading-character-class
const BIDI_TRICKS = /[\u202A-\u202E\u2066-\u2069\u200E\u200F]/g;

export function sanitizeUsername(raw) {
  return String(raw ?? '')
    .replace(BIDI_TRICKS, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>"'`\\]/g, '')
    .replace(/\s+/g, ' ')
    .trimStart()
    .slice(0, MAX);
}

export function usernameError(value) {
  const v = value.trim();
  if (!v) return null; // empty is allowed — a name is optional
  if (v.length < MIN) return 'tooShort';
  return null;
}

export default function UsernameField({ autoFocus = false, onValid }) {
  const { t } = useTranslation();
  const { user } = useTelegram();
  const stored = useSettingsStore((s) => s.username);
  const setUsername = useSettingsStore((s) => s.setUsername);

  const [value, setValue] = useState(stored ?? '');
  const [touched, setTouched] = useState(false);

  // Prefill from Telegram once, and only when the user has not set their own.
  // Overwriting a chosen name on every mount would be maddening.
  useEffect(() => {
    if (!stored && user?.first_name) {
      const suggested = sanitizeUsername(user.first_name);
      if (suggested.length >= MIN) {
        setValue(suggested);
        setUsername(suggested);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const error = useMemo(() => (touched ? usernameError(value) : null), [value, touched]);
  const saved = value.trim().length >= MIN && !error && value === stored;

  const commit = (next) => {
    const clean = sanitizeUsername(next);
    setValue(clean);
    // Persist as they type: there is no submit button on the welcome screen,
    // and losing a half-typed name to a navigation would be worse than saving
    // an intermediate value that they are about to finish typing anyway.
    if (!usernameError(clean)) {
      setUsername(clean.trim());
      onValid?.(clean.trim());
    }
  };

  return (
    <div className="username-field">
      <label className="field-label" htmlFor="fbt-username">
        {t('profile.usernameLabel')}
      </label>

      <div className={`username-input ${error ? 'has-error' : ''}`}>
        <span className="username-icon" aria-hidden="true">
          <IconUser width={17} height={17} />
        </span>

        <input
          id="fbt-username"
          type="text"
          value={value}
          autoFocus={autoFocus}
          autoComplete="nickname"
          maxLength={MAX}
          spellCheck={false}
          placeholder={t('profile.usernamePlaceholder')}
          onChange={(e) => commit(e.target.value)}
          onBlur={() => setTouched(true)}
        />

        <motion.span
          className="username-check"
          initial={false}
          animate={saved ? { scale: 1, opacity: 1 } : { scale: 0.4, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 520, damping: 24 }}
          aria-hidden="true"
        >
          <IconCheck width={13} height={13} strokeWidth={2.6} />
        </motion.span>

        <span className="username-count mono" aria-hidden="true">
          {value.length}/{MAX}
        </span>
      </div>

      {error ? (
        <p className="username-hint error">{t(`profile.username_${error}`)}</p>
      ) : (
        <p className="username-hint">{t('profile.usernameHelp')}</p>
      )}
    </div>
  );
}
