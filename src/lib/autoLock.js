/**
 * AUTO-LOCK
 * ---------------------------------------------------------------------------
 * REAL BUG: "قفل خودکار مثلا بزاری روی یک دقیقه اپ بسته نمیشه" — set auto-lock
 * to one minute and the app never locks.
 *
 * `autoLockMinutes` was stored by the settings store, read by Settings to draw
 * its own label, and read by NOTHING ELSE. The app only ever locked on a cold
 * start, from `useState(() => biometricEnabled)` in App.jsx. Leaving the app
 * for an hour and returning left it wide open.
 *
 * Same family as the currency selector that stored a value nothing read, and
 * the biometric toggle that persisted a flag with no lock screen behind it —
 * but with a security consequence rather than a cosmetic one, because the
 * setting makes a promise about an unattended phone that the code did not keep.
 *
 * ─── WHY WALL-CLOCK TIME, NOT A TIMER ───────────────────────────────────────
 * A setTimeout does not survive what actually happens on a phone: Android
 * freezes timers in a backgrounded WebView, and the process can be killed and
 * restored. A five-minute timer started before backgrounding may fire late,
 * early, or never.
 *
 * So nothing is scheduled. We record a timestamp when the app goes away and
 * compare it against the clock when it comes back. That is correct across
 * backgrounding, process death, and device reboot.
 *
 * The timestamp lives in localStorage rather than memory for the same reason:
 * memory does not survive the WebView being torn down, and a lock that forgets
 * why it should engage is not a lock.
 *
 * ─── THE CLOCK CAN GO BACKWARDS ─────────────────────────────────────────────
 * Date.now() follows the system clock, which the user can change. A negative
 * elapsed time therefore means the clock moved, not that no time passed — and
 * the safe reading of "I cannot tell how long it has been" on a security
 * control is to LOCK. Failing open here would make the lock bypassable by
 * changing the date.
 */

const AWAY_KEY = 'fbt-away-since';

/** Never lock. Stored as 0 by the Settings picker. */
export const AUTOLOCK_NEVER = 0;

function now() {
  return Date.now();
}

/** Remember the moment the app stopped being visible. */
export function markAway(at = now()) {
  try {
    localStorage.setItem(AWAY_KEY, String(at));
  } catch {
    /* private mode — auto-lock degrades to cold-start only */
  }
}

/** Forget it, e.g. right after a successful unlock. */
export function clearAway() {
  try {
    localStorage.removeItem(AWAY_KEY);
  } catch {
    /* ignore */
  }
}

/** Milliseconds since the app was last backgrounded, or null if unknown. */
export function awayFor(at = now()) {
  let raw;
  try {
    raw = localStorage.getItem(AWAY_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  const since = Number(raw);
  if (!Number.isFinite(since) || since <= 0) return null;
  return at - since;
}

/**
 * Should the app be locked right now?
 *
 * @param {object}  opts
 * @param {boolean} opts.enabled  the user has a lock configured at all
 * @param {number}  opts.minutes  autoLockMinutes; 0 means never
 * @param {number}  [opts.at]     current time, injectable for tests
 */
export function shouldAutoLock({ enabled, minutes, at = now() }) {
  if (!enabled) return false;

  const limit = Number(minutes);
  // 0 is "never", and anything unparseable is treated the same rather than
  // locking on every resume — an app that locks when you did not ask it to is
  // its own kind of broken.
  if (!Number.isFinite(limit) || limit <= AUTOLOCK_NEVER) return false;

  const elapsed = awayFor(at);
  if (elapsed === null) return false;

  // Clock moved backwards: we cannot measure the gap, so assume the worst.
  if (elapsed < 0) return true;

  return elapsed >= limit * 60_000;
}

/**
 * Wire the document lifecycle to a lock callback.
 *
 * Returns an unsubscribe function.
 *
 * Listens to BOTH visibilitychange and pagehide. visibilitychange alone misses
 * the case where Android kills the WebView without ever reporting hidden; and
 * pagehide alone does not fire for an ordinary app switch. Together they cover
 * what a phone actually does.
 */
export function watchAutoLock({ isEnabled, getMinutes, onLock }) {
  if (typeof document === 'undefined') return () => {};

  const away = () => markAway();

  const back = () => {
    if (document.visibilityState !== 'visible') return;
    if (shouldAutoLock({ enabled: isEnabled(), minutes: getMinutes() })) {
      clearAway();
      onLock();
    } else {
      // Returned inside the grace period: drop the marker so a later short
      // trip is measured from ITS own start, not from the first one.
      clearAway();
    }
  };

  const onVisibility = () => (document.visibilityState === 'hidden' ? away() : back());

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', away);
  // A resumed WebView sometimes reports visible without firing
  // visibilitychange, so check on focus too. back() is idempotent.
  window.addEventListener('focus', back);

  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', away);
    window.removeEventListener('focus', back);
  };
}
