/**
 * «Did the user just take a screenshot?»
 * ---------------------------------------------------------------------------
 * The request (2026-09-24): «باکس بالای فوتر که دکمه اشتراک و آدرس سایت هست را
 * پاک کن. وقتی کسی اسکرین گرفت یک بند برای ۳۰ ثانیه بیاد که بگه شما اسکرین
 * گرفتید، می‌خواهید اشتراک بگذارید اسکرین‌شات را با واترمارک آدرس سایت — نه
 * اینکه همیشه باشه.»
 *
 * So the share offer is no longer furniture; it is an ANSWER to a screenshot.
 * What can actually observe one, by platform, stated honestly:
 *
 *   • The packaged Android app — yes. `MainActivity` registers Android 14's
 *     `Activity.ScreenCaptureCallback` (the OS tells the visible activity it was
 *     captured) and, on older Android, watches MediaStore for a new image while
 *     the app is in the foreground. Either one dispatches `fbt:screenshot` on
 *     `window`.
 *   • Desktop browsers — the keyboard route: `PrintScreen` (Windows/Linux),
 *     ⌘⇧3 / ⌘⇧4 / ⌘⇧5 (macOS, when the browser is handed the keys) and ⊞⇧S
 *     (Windows Snipping Tool, same caveat).
 *   • Mobile browsers (Safari, Chrome on a phone) — NO. The web platform has no
 *     screenshot event, by design; a power+volume capture is invisible to a page.
 *     Nothing here pretends otherwise.
 *
 * Every source funnels into one debounced signal, because a single capture can
 * fire the native callback AND a MediaStore change AND a key event.
 */

/** The window event the native shell (and anything else) dispatches. */
export const SCREENSHOT_EVENT = 'fbt:screenshot';

/** Signals closer together than this are one screenshot. */
export const SCREENSHOT_DEBOUNCE_MS = 1500;

/** macOS capture shortcuts: ⌘⇧3 (screen), ⌘⇧4 (area), ⌘⇧5 (panel). */
const MAC_SHOT_KEYS = new Set(['3', '4', '5', '#', '$', '%']);

/**
 * Is this keyboard event a screenshot shortcut?
 * Exported for tests; the listener below is the only production caller.
 */
export function isScreenshotKey(event) {
  if (!event) return false;
  const key = String(event.key || '');
  const code = String(event.code || '');
  if (key === 'PrintScreen' || code === 'PrintScreen' || event.keyCode === 44) return true;
  if (event.metaKey && event.shiftKey) {
    if (MAC_SHOT_KEYS.has(key) || code === 'Digit3' || code === 'Digit4' || code === 'Digit5') return true;
    /* Windows ⊞⇧S (Snipping Tool) — the browser sees Meta+Shift+S when it sees it at all. */
    if (key.toLowerCase() === 's' || code === 'KeyS') return true;
  }
  return false;
}

/** Tell every listener a screenshot happened (the native shell calls this too). */
export function announceScreenshot(win = typeof window === 'undefined' ? null : window) {
  if (!win || typeof win.dispatchEvent !== 'function') return false;
  try {
    win.dispatchEvent(new win.Event(SCREENSHOT_EVENT));
    return true;
  } catch {
    return false;
  }
}

/**
 * Subscribe to screenshots from every source this platform has.
 *
 * @param {(info:{source:string, at:number}) => void} onShot
 * @param {{win?: Window, now?: () => number, debounceMs?: number}} [opts]
 * @returns {() => void} unsubscribe
 */
export function subscribeScreenshots(onShot, { win = typeof window === 'undefined' ? null : window, now = () => Date.now(), debounceMs = SCREENSHOT_DEBOUNCE_MS } = {}) {
  if (!win || typeof onShot !== 'function') return () => {};
  let last = -Infinity;

  const fire = (source) => {
    const at = now();
    if (at - last < debounceMs) return;
    last = at;
    try { onShot({ source, at }); } catch { /* a listener must never break the app */ }
  };

  const onNative = () => fire('system');
  /* PrintScreen is reliably delivered on keyup only (Windows swallows keydown);
     the macOS/Windows chords arrive, when they arrive, on keydown. Both are
     watched and the debounce folds the pair into one. */
  const onKey = (event) => { if (isScreenshotKey(event)) fire('keyboard'); };

  win.addEventListener(SCREENSHOT_EVENT, onNative);
  win.addEventListener('keyup', onKey, true);
  win.addEventListener('keydown', onKey, true);

  return () => {
    win.removeEventListener(SCREENSHOT_EVENT, onNative);
    win.removeEventListener('keyup', onKey, true);
    win.removeEventListener('keydown', onKey, true);
  };
}
