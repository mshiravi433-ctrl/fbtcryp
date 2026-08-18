import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { clearApiCache } from '../lib/api';
import { invalidateCalmCache } from '../lib/audio';
import { isScrollLocked } from '../lib/scrollLock';
import { isNativeShell } from '../lib/nativeShell';
import { isStandalone } from '../lib/platform';
import { onRefreshStateChange, refreshBlocked, requestSoftRefresh } from '../lib/refresh';
import { useTelegram } from '../context/TelegramContext';
import { IconRefresh } from './Icons';

/**
 * PULL-TO-REFRESH — replaces the header Refresh button.
 * ---------------------------------------------------------------------------
 * The header button is removed everywhere (`common.refresh` icon-button is
 * gone from Header.jsx). This is the replacement affordance: drag the page
 * down from the top and release past a threshold to run the identical
 * `requestSoftRefresh()` cycle the old button ran — same guards, same
 * single-flight, same "no reload, no remount, no new SignClient" contract
 * (see lib/refresh.js). Nothing about the refresh CONTRACT changed, only how
 * it is triggered.
 *
 * ─── WHY THE APK NEEDED THIS AND THE WEBSITE DID NOT STRICTLY NEED IT ──────
 * A normal mobile BROWSER already has its own native pull-to-refresh (Chrome
 * on Android, Safari on iOS) — see `overscroll-behavior-y: contain` on
 * `body` in index.css, which was deliberately chosen over `none` so that
 * gesture keeps working there. The Capacitor WebView has NO such gesture at
 * all: a Capacitor app is not "a browser tab", so there is no chrome to pull.
 * Before this component, the packaged app had NO way to refresh short of
 * killing and reopening it. This component fills exactly that gap, and
 * degrades to a harmless no-op everywhere the platform already has an
 * equivalent (see the native-only mount gate below).
 *
 * ─── WHY NATIVE/STANDALONE-ONLY RATHER THAN EVERYWHERE ─────────────────────
 * Stacking our OWN pull gesture UNDER the browser's native one on the
 * website would double-trigger: the browser reloads the whole page (a hard
 * refresh) while our own drag handler is also running requestSoftRefresh() a
 * few pixels above it — two competing refreshes racing each other for no
 * reason. Since desktop and mobile-web already have a working refresh path
 * (the browser's own, plus F5), this component only actually LISTENS for
 * gestures inside the packaged Capacitor app OR a home-screen-installed PWA
 * (`isStandalone()` — no browser chrome there either, on iOS Safari added-
 * to-home-screen or Android's installed PWA, so neither has the browser's
 * own pull gesture) and renders nothing (not even the listener) elsewhere —
 * "must not break" on the web is satisfied by not touching it at all there.
 *
 * ─── THE GUARD CONTRACT, UNCHANGED ─────────────────────────────────────────
 * `requestSoftRefresh()` already refuses (resolves false) while ANY guard is
 * held — `wc-connect`, `injected-connect`, `swap-tx` — so a pull during a
 * WalletConnect pairing or a swap signature cannot strand it, exactly as the
 * header button could not. This component adds only ONE more source of
 * "busy": a currently-open sheet (isScrollLocked()) suppresses the drag
 * entirely, so pulling down through an open WalletConnect sheet cannot fire
 * a refresh underneath it.
 */

const TRIGGER_PX = 68; // distance to pull before release triggers a refresh
const MAX_PULL_PX = 110; // rubber-band ceiling; pulling further has no extra effect
const PILL_TOP_PX = 10;

export default function PullToRefresh({ children }) {
  const { t } = useTranslation();
  const { haptic } = useTelegram();
  const reducedMotion = useReducedMotion();
  const [native] = useState(() => isNativeShell() || isStandalone());

  const [pull, setPull] = useState(0); // 0..MAX_PULL_PX, current drag distance
  const [phase, setPhase] = useState('idle'); // idle | pulling | ready | refreshing
  const [blocked, setBlocked] = useState(() => refreshBlocked());

  const startYRef = useRef(null);
  const draggingRef = useRef(false);
  const hapticFiredRef = useRef(false);
  const containerRef = useRef(null);

  useEffect(() => onRefreshStateChange(() => setBlocked(refreshBlocked())), []);

  const run = useCallback(() => {
    haptic?.('light');
    setPhase('refreshing');
    void requestSoftRefresh({
      invalidate: () => {
        clearApiCache();
        invalidateCalmCache();
      }
    }).finally(() => {
      setPhase('idle');
      setPull(0);
    });
  }, [haptic]);

  /*
   * Only ever attach the touch listeners inside the packaged app — see the
   * file header. `native` is read once (Capacitor doesn't stop being
   * Capacitor at runtime), same pattern as RgbBackground/nativeShell.js.
   */
  useEffect(() => {
    if (!native) return undefined;
    const el = containerRef.current;
    if (!el) return undefined;

    const atTop = () => (window.scrollY || document.documentElement.scrollTop || 0) <= 0;

    const onTouchStart = (e) => {
      if (blocked || isScrollLocked() || phase === 'refreshing') return;
      if (!atTop() || e.touches.length !== 1) return;
      startYRef.current = e.touches[0].clientY;
      draggingRef.current = true;
      hapticFiredRef.current = false;
    };

    const onTouchMove = (e) => {
      if (!draggingRef.current || startYRef.current == null) return;
      // A guard can appear (wallet pairing starts) mid-drag; bail immediately.
      if (refreshBlocked() || isScrollLocked()) {
        draggingRef.current = false;
        setPull(0);
        setPhase('idle');
        return;
      }
      const dy = e.touches[0].clientY - startYRef.current;
      if (dy <= 0 || !atTop()) {
        // Scrolling up, or the page has scrolled away from the top mid-drag.
        draggingRef.current = false;
        setPull(0);
        setPhase('idle');
        return;
      }
      // Rubber-band: diminishing returns past the trigger point.
      const eased = dy < TRIGGER_PX ? dy : TRIGGER_PX + (dy - TRIGGER_PX) * 0.35;
      const clamped = Math.min(MAX_PULL_PX, eased);
      setPull(clamped);
      const nextPhase = clamped >= TRIGGER_PX ? 'ready' : 'pulling';
      setPhase(nextPhase);
      if (nextPhase === 'ready' && !hapticFiredRef.current) {
        hapticFiredRef.current = true;
        haptic?.('light');
      }
      if (nextPhase === 'pulling') hapticFiredRef.current = false;
      // Prevent the WebView's own rubber-band scroll from fighting our pill.
      if (dy > 4) e.preventDefault();
    };

    const onTouchEnd = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      startYRef.current = null;
      if (phase === 'ready') run();
      else {
        setPull(0);
        setPhase('idle');
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [native, blocked, phase, run, haptic]);

  if (!native) return children;

  const label =
    phase === 'refreshing'
      ? t('refresh.refreshing')
      : phase === 'ready'
        ? t('refresh.releaseToRefresh')
        : t('refresh.pullToRefresh');

  return (
    <div ref={containerRef} className="ptr-root">
      <div
        className="ptr-indicator"
        style={{
          opacity: pull > 4 || phase === 'refreshing' ? 1 : 0,
          transform: `translate(-50%, ${Math.max(pull, phase === 'refreshing' ? PILL_TOP_PX + 24 : 0) - 34}px)`
        }}
        aria-hidden={phase === 'idle'}
      >
        <span className="ptr-pill" data-ready={phase === 'ready' || phase === 'refreshing' ? 'true' : 'false'}>
          <IconRefresh
            width={15}
            height={15}
            className={phase === 'refreshing' && !reducedMotion ? 'refresh-spin' : undefined}
            style={
              phase !== 'refreshing' && !reducedMotion
                ? { transform: `rotate(${Math.min(180, (pull / TRIGGER_PX) * 180)}deg)`, transition: 'transform 0.05s linear' }
                : undefined
            }
          />
        </span>
        <span className="ptr-label">{label}</span>
      </div>
      <motion.div
        animate={{ y: phase === 'refreshing' ? PILL_TOP_PX + 30 : pull }}
        transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 38 }}
      >
        {children}
      </motion.div>
    </div>
  );
}

/* Re-exported so tests and Icons keep one source of truth. */
export const PTR_TRIGGER_PX = TRIGGER_PX;
