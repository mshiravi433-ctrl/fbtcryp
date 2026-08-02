import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isNativeShell } from '../lib/nativeShell';
import { isIOSSafari, isStandalone } from '../lib/platform';

/**
 * "Install this app" — the piece that was missing.
 *
 * ─── WHY THE PWA "DID NOT APPEAR" ───────────────────────────────────────────
 * Everything a browser needs was already in place and verified live: the
 * manifest is served with a name, a 192 and a 512 icon, a maskable icon,
 * display:standalone and a start_url; the service worker registers over https;
 * the site is on a real domain.
 *
 * What was missing is the last step, and it is easy to overlook because it is
 * not a manifest field: on desktop Chrome and on Android the install offer is
 * mostly INVISIBLE unless the page handles `beforeinstallprompt` itself.
 * Chrome fires that event, the page is expected to keep it and call
 * `prompt()` from a real user gesture. Nothing here listened, so the event
 * fired into nothing and the only route left was the browser's own menu —
 * which most people never open, and which on desktop is a small icon in the
 * address bar that is easy to miss entirely.
 *
 * So this is not a new feature so much as the missing half of one.
 *
 * ─── AND WHY iOS NEEDED A SECOND PATH ───────────────────────────────────────
 * Safari on iPhone and iPad NEVER fires `beforeinstallprompt`. Apple has never
 * implemented it and there is no equivalent — `prompt()` does not exist, and a
 * site cannot trigger installation at all. The only route is the user tapping
 * Share → "Add to Home Screen" themselves.
 *
 * So on iOS this component previously rendered nothing, forever. An iPhone
 * user had no way to learn the app was installable. Since there is no APK for
 * them either, the home-screen PWA is the ONLY way an iPhone user can keep
 * this app — which makes a missing hint on iOS more costly than on Android,
 * not less.
 *
 * The iOS branch therefore shows the instruction instead of a button, and only
 * in real Safari: Chrome and Firefox on iOS cannot add to the home screen at
 * all, so telling their users to look for the option would send them hunting
 * for a menu item that does not exist.
 *
 * ─── WHAT THIS DELIBERATELY DOES NOT DO ─────────────────────────────────────
 * It does not nag. The banner appears only when the browser has already
 * decided the app is installable, it can be dismissed, and a dismissal is
 * remembered. An install prompt that reappears on every visit is the reason
 * people learn to ignore them.
 */

const DISMISS_KEY = 'fbt-install-dismissed';

export default function InstallPrompt() {
  const { t } = useTranslation();
  const [deferred, setDeferred] = useState(null);
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    // Inside the packaged app there is nothing to install.
    if (isNativeShell()) return undefined;

    const onPrompt = (e) => {
      /*
       * preventDefault stops Chrome's own mini-infobar so ours is the only
       * offer on screen, and keeps the event usable later — once it has been
       * allowed to proceed it cannot be replayed.
       */
      e.preventDefault();
      setDeferred(e);
    };

    /*
     * If the app gets installed by any route — our button, the address-bar
     * icon, the browser menu — the banner must disappear immediately rather
     * than inviting someone to install what they already have.
     */
    const onInstalled = () => {
      setDeferred(null);
      setHidden(true);
    };

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  /*
   * Already running as an installed app? Then there is nothing to offer.
   * `display-mode: standalone` covers Chrome/Edge/Android; `navigator.standalone`
   * is the iOS Safari equivalent, which does not support the media query.
   */
  const alreadyInstalled = isStandalone();

  if (hidden || alreadyInstalled || isNativeShell()) return null;

  /*
   * iOS: no event to wait for, so the offer is shown on its own terms.
   * Gated on real Safari — see the note at the top of the file.
   */
  const iosHint = !deferred && isIOSSafari();
  if (!deferred && !iosHint) return null;

  const install = async () => {
    try {
      deferred.prompt();
      await deferred.userChoice;
    } catch {
      /* the browser refused; nothing useful to say */
    }
    // Single-use either way: Chrome will fire a fresh event if it still
    // considers the app installable later.
    setDeferred(null);
  };

  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* private mode — it will simply offer again next time */
    }
  };

  return (
    <div className="install-bar">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>{t('install.title')}</div>
        <div className="faint" style={{ fontSize: 11.5, marginTop: 2 }}>
          {iosHint ? t('install.iosBody') : t('install.body')}
        </div>
      </div>
      {/*
        No button on iOS. There is nothing for it to call — Safari exposes no
        install API — and a button that does nothing is worse than a sentence
        that explains the two taps.
      */}
      {!iosHint && (
        <button className="btn btn-primary btn-sm" onClick={install}>{t('install.action')}</button>
      )}
      <button className="icon-btn" onClick={dismiss} aria-label={t('common.close')}>✕</button>
    </div>
  );
}
