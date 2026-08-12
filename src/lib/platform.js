/**
 * PLATFORM DETECTION
 * ---------------------------------------------------------------------------
 * One place for "what am I running on", because the answers are subtle enough
 * that three screens each getting them slightly wrong is a certainty.
 *
 * Everything here is a plain function, not a hook: a device does not change
 * class at runtime, so subscribing to it would be wasted renders.
 */

const ua = () => (typeof navigator === 'undefined' ? '' : String(navigator.userAgent || ''));

/**
 * Is this iOS (or iPadOS)?
 *
 * ─── WHY THE SECOND TEST EXISTS ─────────────────────────────────────────────
 * Since iPadOS 13, Safari on iPad reports a DESKTOP user-agent string:
 * "Macintosh; Intel Mac OS X". `/iPad/` matches nothing. Every naive iOS check
 * therefore treats an iPad as a Mac — which is exactly why iPad users would
 * have been shown the wrong install instructions and desktop-only advice.
 *
 * The reliable tell is a Mac-looking UA that also reports a touchscreen:
 * no real Mac has `maxTouchPoints > 1`.
 */
export function isIOS() {
  if (typeof navigator === 'undefined') return false;
  const s = ua();
  if (/iPad|iPhone|iPod/.test(s)) return true;
  return /Macintosh/.test(s) && (navigator.maxTouchPoints || 0) > 1;
}

/**
 * Safari proper — not Chrome, Edge, Firefox or an in-app browser on iOS.
 *
 * This matters because on iOS every browser is WebKit underneath, but ONLY
 * Safari can add a site to the home screen. Telling a Chrome-on-iOS user to
 * "tap Share then Add to Home Screen" sends them looking for a menu item that
 * is not in their browser.
 */
export function isIOSSafari() {
  if (!isIOS()) return false;
  const s = ua();
  // CriOS = Chrome, FxiOS = Firefox, EdgiOS = Edge, OPiOS/OPT = Opera.
  if (/CriOS|FxiOS|EdgiOS|OPiOS|OPT\//.test(s)) return false;
  // Facebook / Instagram / Telegram in-app browsers.
  if (/FBAN|FBAV|Instagram|Line\/|Twitter/.test(s)) return false;
  return /Safari/.test(s);
}

export function isAndroid() {
  return /Android/.test(ua());
}

/** Coarse pointer + narrow screen: treat as a phone for layout decisions. */
export function isPhone() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(max-width: 700px)')?.matches ?? false;
}

/**
 * Already launched from a home-screen icon?
 *
 * Two different APIs because iOS Safari does not support the standard one:
 * `display-mode: standalone` is the spec, `navigator.standalone` is Apple's
 * pre-spec property and is still the only reliable answer on iPhone.
 */
export function isStandalone() {
  if (typeof window === 'undefined') return false;
  return Boolean(
    window.matchMedia?.('(display-mode: standalone)')?.matches ||
      window.matchMedia?.('(display-mode: fullscreen)')?.matches ||
      window.navigator?.standalone === true
  );
}

/**
 * Are we inside a third-party WebView (Telegram/Instagram/Facebook in-app
 * browser, Capacitor WebView, an app iframe)?
 *
 * WebViews have three consequences we actively work around:
 *  1. No Web Push (PushManager), even on iOS 16.4+
 *  2. Universal-link deep linking is often broken or intercepted
 *  3. The Capacitor @capacitor/browser plugin is available natively
 */
export function isWebView() {
  if (typeof window === 'undefined') return false;
  if (window.Capacitor?.isNativePlatform?.()) return true;
  const s = ua();
  return (
    /(FBAN|FBAV|Instagram|Twitter|Line\/|LinkedIn|SnapChat|TikTok)/.test(s) ||
    // Telegram (WebView inside Telegram Mini App)
    Boolean(window.Telegram?.WebApp) ||
    // Generic WKWebView without Safari
    (/iPhone|iPad|iPod/.test(s) && !/Safari/.test(s)) ||
    // Android webview without Chrome
    (/Android/.test(s) && /wv/.test(s))
  );
}

/** iOS Safari version as a number, or 0. */
export function iosSafariVersion() {
  if (!isIOS()) return 0;
  const m = ua().match(/Version\/(\d+)[\d.]*/);
  return m ? parseInt(m[1], 10) : 0;
}

/**
 * Can this browser show real push notifications with the app closed?
 *
 * iOS only supports Web Push in Safari ≥ 16.4, AND only when the site has been
 * added to the home screen (navigator.standalone). Anywhere else on iOS —
 * Chrome/Firefox, in-app browsers, normal Safari not added to home — push
 * arrives only while the app is open, via local notifications.
 */
export function pushTrulySupported() {
  if (typeof window === 'undefined') return false;
  if (isNativeApp()) return true; // FCM/APNs via native layer
  if (isIOS()) {
    return isStandalone() && iosSafariVersion() >= 16 && 'PushManager' in window;
  }
  return 'Notification' in window && 'PushManager' in window && 'serviceWorker' in navigator;
}

/** Mirror native-app check here too, so platform.js is the single source. */
export function isNativeApp() {
  return typeof window !== 'undefined' && Boolean(window.Capacitor?.isNativePlatform?.());
}
