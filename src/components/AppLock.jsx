/**
 * APP LOCK — the screen that was missing.
 *
 * ─── THE BUG THIS FIXES ─────────────────────────────────────────────────────
 * Settings had a "Biometric unlock" toggle. Turning it on really did read the
 * fingerprint, and really did store `biometricEnabled: true`.
 *
 * And that was the entire feature. `biometricEnabled` was read in exactly two
 * places, both inside Settings.jsx: once to decide whether to prompt when the
 * switch is flipped, and once to draw the switch. No other file in the app
 * ever looked at it, and no lock screen existed.
 *
 * So the reported symptoms were both exactly right, and both inevitable:
 *
 *   "it reads the finger but the screen never closes"
 *      — that prompt was for ENABLING the toggle, not for unlocking. There
 *        was nothing to close.
 *
 *   "it never asks me to log in with the fingerprint"
 *      — nothing asked, because nothing was ever built to ask.
 *
 * The switch worked. It was simply wired to nothing.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * WHAT THIS DOES AND DOES NOT PROTECT
 *
 * This is a LOCAL UI gate. It stops someone who picks up an unlocked phone
 * from browsing the app. It does not protect funds: anyone holding the seed
 * phrase can spend from any wallet app on any device, and no screen here can
 * change that. The wallet password (which encrypts the seed at rest) is the
 * real protection, which is why it is the fallback below rather than a
 * decorative "skip" button.
 *
 * Locks on app OPEN only, by explicit choice. Re-locking on every return from
 * background is more secure but asks for a fingerprint every time the user
 * checks a message mid-swap, and an unlock people learn to dismiss reflexively
 * protects less than one they read.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../store/useSettingsStore';
import { verifyBiometric } from '../lib/security';
import { hasVault, unlockVault } from '../lib/localWallet';

export default function AppLock({ onUnlock }) {
  const { t } = useTranslation();
  const credentialId = useSettingsStore((s) => s.biometricCredentialId);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // Only offer the password route when a vault actually exists, otherwise the
  // fallback is a dead end that cannot possibly succeed.
  const [showPassword, setShowPassword] = useState(false);
  const [password, setPassword] = useState('');

  const vaultExists = hasVault();

  /*
   * Guard against double-prompting. On some devices the biometric sheet is
   * dismissed and re-triggered by a re-render, which stacks two OS prompts and
   * leaves the second one orphaned — the screen then appears frozen behind a
   * dialog nobody can answer.
   */
  const running = useRef(false);

  const tryBiometric = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      await verifyBiometric(credentialId);
      onUnlock();
    } catch (e) {
      /*
       * A rejection here is usually a CANCEL, not a failure — the user tapped
       * outside the sheet. Saying "authentication failed" for that is alarming
       * and wrong, so the message stays neutral and the retry button is the
       * primary action.
       */
      const code = String(e?.message || e);
      setError(code.includes('UNSUPPORTED') ? 'UNSUPPORTED' : 'RETRY');
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, [credentialId, onUnlock]);

  // Prompt once on mount so the fingerprint sheet appears immediately, rather
  // than making the user tap a button to reach the thing they already asked for.
  useEffect(() => {
    tryBiometric();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submitPassword(e) {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      /*
       * Verify by actually decrypting the vault. There is no stored password
       * hash to compare against — and there should not be, since a hash is one
       * more thing an attacker with the device could attack offline. If the
       * password is wrong, decryptSecret throws.
       *
       * The returned signer is deliberately discarded: this screen only proves
       * knowledge of the password. Keeping a live key in memory from the lock
       * screen would widen the window in which it can leak.
       */
      await unlockVault(password);
      setPassword('');
      onUnlock();
    } catch {
      setError('BAD_PASSWORD');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="applock">
      <div className="applock-card">
        <div className="applock-icon" aria-hidden="true">
          {/* fingerprint glyph */}
          <svg viewBox="0 0 24 24" width="56" height="56" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M12 11v3a9 9 0 0 1-.6 3.2" />
            <path d="M8.5 12a3.5 3.5 0 0 1 7 0v2a13 13 0 0 1-.5 3.5" />
            <path d="M5 12a7 7 0 0 1 12-4.9" />
            <path d="M18.8 9.5A7 7 0 0 1 19 12v2c0 1.2-.1 2.4-.4 3.5" />
            <path d="M5.2 16A7 7 0 0 1 5 14.5V13" />
          </svg>
        </div>

        <h1 className="applock-title">{t('lock.title')}</h1>
        <p className="applock-sub">{t('lock.sub')}</p>

        {error === 'UNSUPPORTED' && <p className="applock-err">{t('lock.unsupported')}</p>}
        {error === 'RETRY' && <p className="applock-err">{t('lock.retryHint')}</p>}
        {error === 'BAD_PASSWORD' && <p className="applock-err">{t('lock.badPassword')}</p>}

        {!showPassword && (
          <>
            <button className="applock-btn" onClick={tryBiometric} disabled={busy}>
              {busy ? t('lock.checking') : t('lock.useBiometric')}
            </button>

            {/*
             * Without a way through, a broken sensor or a wiped fingerprint
             * would lock the owner out of their own app permanently, with
             * reinstalling as the only escape — and reinstalling destroys the
             * encrypted vault. The password is the same secret that protects
             * the seed, so this is an equal door, not a weaker one.
             */}
            {vaultExists && (
              <button className="applock-link" onClick={() => { setError(null); setShowPassword(true); }}>
                {t('lock.usePassword')}
              </button>
            )}
          </>
        )}

        {showPassword && (
          <form onSubmit={submitPassword} className="applock-form">
            <input
              type="password"
              className="applock-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('lock.passwordPlaceholder')}
              autoFocus
              autoComplete="current-password"
              disabled={busy}
            />
            <button className="applock-btn" type="submit" disabled={busy || !password}>
              {busy ? t('lock.checking') : t('lock.unlock')}
            </button>
            <button
              type="button"
              className="applock-link"
              onClick={() => { setError(null); setShowPassword(false); }}
            >
              {t('lock.useBiometric')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
