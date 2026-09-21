/**
 * IN-APP BROWSER
 * ---------------------------------------------------------------------------
 * Opens external links through Android Custom Tabs (via @capacitor/browser),
 * falling back to Telegram's opener inside the Mini App and to a normal tab
 * on the web.
 *
 * ─── WHY CUSTOM TABS AND NOT AN EMBEDDED WEBVIEW ────────────────────────────
 * The obvious build is a full browser screen: an address bar, a WebView, back
 * and forward. For a crypto app that design is dangerous, and the danger is
 * not theoretical.
 *
 * An embedded WebView is a window WE draw. We choose what the URL bar says, or
 * whether there is one at all. A user who lands on a phishing clone of
 * PancakeSwap inside our chrome has no reliable way to tell — and their trust
 * in the frame comes from us. Worse, an embedded WebView shares no state with
 * the system browser, so the padlock, the certificate warnings and Google Safe
 * Browsing all stop being things the user can rely on.
 *
 * Custom Tabs is the opposite: it is the SYSTEM browser rendering in our app's
 * task. The real URL is always visible and cannot be spoofed by us, TLS
 * warnings are the browser's own, Safe Browsing applies, and the user's
 * existing logins work. It still feels in-app — same back gesture, our theme
 * colour on the toolbar — without us becoming the thing that vouches for a
 * site's identity.
 *
 * The tradeoff is that we cannot inject a wallet provider into the page, so
 * dApps opened this way will ask the user to connect via WalletConnect rather
 * than detecting an injected wallet. That is the correct outcome: an app that
 * silently injects a signer into arbitrary web pages is exactly the attack
 * everyone in this space is trying to prevent.
 */

let BrowserPlugin = null;
let pluginChecked = false;

/** Lazy so the plugin is not pulled into the entry chunk. */
/*
 * The plugin is kept in a MODULE VARIABLE and never returned.
 *
 * `registerPlugin` hands back a PROXY whose every property is a method —
 * `then` included. A proxy that answers `then` is a thenable, so RETURNING it
 * from an async function makes the promise machinery call `then` on it, which
 * on a platform with no implementation throws «Browser.then() is not
 * implemented on web» instead of resolving. Keeping the value out of every
 * promise boundary is what makes a missing implementation a quiet `null`,
 * which is what `openUrl` already knows how to handle.
 */
async function loadPlugin() {
  if (pluginChecked) return;
  pluginChecked = true;
  try {
    const mod = await import('@capacitor/browser');
    BrowserPlugin = mod?.Browser ?? null;
  } catch {
    BrowserPlugin = null;
  }
}

/**
 * Load the plugin NOW, so a later `openUrl` does not have to.
 *
 * `@capacitor/browser` is a dynamic import (see above), which on a phone is a
 * network round trip. Anything that opens a tab in response to a tap — the
 * Solana wallet hand-off does — pays for that round trip before the tab
 * appears unless the module is already in memory. Idempotent, and safe to call
 * where there is no Capacitor at all: it resolves to null there.
 */
export async function preloadBrowserPlugin() {
  await loadPlugin();
  return BrowserPlugin !== null;
}

/**
 * Reject anything that is not plain https.
 *
 * `javascript:` and `data:` URLs can execute in the opening context, and
 * `http:` is trivially intercepted on a hostile network — which for a page
 * about crypto means an attacker can rewrite the addresses on it. Blocking
 * them here means no caller can introduce that by passing an unchecked value.
 */
export function isSafeUrl(raw) {
  try {
    const u = new URL(String(raw));
    return u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Open a URL.
 *
 * Custom Tabs inside the APK, Telegram's own opener inside the Mini App, and a
 * normal tab on the web — in that order, so the page the user lands on is always
 * rendered by a browser they can trust rather than by a frame we drew.
 *
 * @param {string} url
 * @param {object} [opts]
 * @param {string} [opts.toolbarColor]
 * @param {boolean} [opts.allowSameTabFallback=true] - if false, never do
 *   location.assign. For wallet pairing links, same-tab navigation destroys
 *   fbtswap.ir and lands on https://uniswap.org/app/wc?uri=... — the exact
 *   bug reported. Wallet links must set this false.
 * @returns {Promise<boolean>} false when the URL was rejected as unsafe.
 */
export async function openUrl(url, { toolbarColor = '#0a0c12', allowSameTabFallback = true } = {}) {
  if (!isSafeUrl(url)) return false;

  // Wallet pairing URLs must never trigger same-tab navigation, even if popup blocked
  const isWalletPairing = /[?&]uri=wc%3A/i.test(String(url)) || /\/wc\?uri=/i.test(String(url));
  const allowFallback = allowSameTabFallback && !isWalletPairing;

  // Inside Telegram, its own opener keeps the Mini App alive underneath.
  const tg = typeof window !== 'undefined' ? window.Telegram?.WebApp : null;
  if (tg?.openLink) {
    tg.openLink(url, { try_instant_view: false });
    return true;
  }

  await loadPlugin();
  const plugin = BrowserPlugin;
  if (plugin) {
    try {
      await plugin.open({ url, toolbarColor, presentationStyle: 'popover' });
      return true;
    } catch {
      /* fall through to a normal tab */
    }
  }

  if (typeof window !== 'undefined') {
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (opened) return true;
    if (!allowFallback) return false;
    /*
     * `window.open` returned null: a pop-up blocker refused it. That happens
     * easily here because this function awaits a dynamic import first, and
     * some browsers no longer count the click as a "user gesture" by the
     * time the open call runs. Silently doing nothing is the worst outcome —
     * the user taps "Continue to provider" and the app appears dead. Falling
     * back to a same-tab navigation is always permitted; checkout pages we
     * hand off to carry a finalUrl that brings the user back afterwards.
     * EXCEPTION: wallet pairing links must NOT fallback to same-tab — see above.
     */
    try {
      window.location.assign(url);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}
