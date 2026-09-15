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

import { isNativeShell } from './nativeShell.js';

let BrowserPlugin = null;
let pluginChecked = false;

/** Lazy so the plugin is not pulled into the entry chunk. */
async function getPlugin() {
  if (pluginChecked) return BrowserPlugin;
  pluginChecked = true;
  try {
    const mod = await import('@capacitor/browser');
    BrowserPlugin = mod.Browser ?? null;
  } catch {
    BrowserPlugin = null;
  }
  return BrowserPlugin;
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
 * Hand a WALLET deep link to the phone.
 *
 * ─── WHY THIS IS NOT openUrl() ─────────────────────────────────────────────
 * `openUrl()` exists for arbitrary external websites: https only, always
 * through the system browser, never injected into. A wallet hand-off is a
 * different animal with a different failure mode, and it needs its own
 * channel for one reason: a deep link must LEAVE the WebView.
 *
 * The reported bug — «با زدن بازکردن ارور دیپ لینک میزنه» — was AppKit doing
 * `window.open('trust://wc?uri=…', '_self')` inside the packaged app's
 * WebView. A custom scheme is navigable from a real browser and from nothing
 * else: a WebView answers with its own error page ("Invalid URL" /
 * net::ERR_UNKNOWN_URL_SCHEME) with the URL printed underneath. lib/wcDeepLink
 * already rewrites those links to the wallet's https universal link (Trust
 * publishes `https://link.trustwallet.com/wc?uri=…` for exactly this); this
 * function is what opens it:
 *
 *   • packaged app  → @capacitor/browser (Android Custom Tabs). The browser is
 *     a real browser, so the OS resolves Android App Links to the wallet —
 *     and if the wallet is not installed the user lands on the wallet's own
 *     web page instead of our WebView error page.
 *   • Telegram      → WebApp.openLink(): Telegram's opener leaves the Mini App
 *     alive underneath rather than navigating our page away.
 *   • plain web     → the very call AppKit intended, same target and features,
 *     only with the URL that can actually open a wallet.
 *
 * @returns {Promise<boolean>} false when the URL was rejected or nothing could
 *          be opened (callers treat that as "the user still has the QR code").
 */
export async function openWalletLink(url, { target = '_self', features = 'noreferrer noopener', win, openWindow } = {}) {
  const raw = String(url || '').trim();
  if (!raw) return false;
  const view = win ?? (typeof window !== 'undefined' ? window : null);
  const https = isSafeUrl(raw);

  /*
   * Inside Telegram, Telegram's own opener is the only way to leave the Mini
   * App without killing the page underneath — and it accepts http(s) links
   * only, so a custom scheme is handled further down.
   */
  const tg = typeof window !== 'undefined' ? window.Telegram?.WebApp : null;
  if (https && tg?.openLink) {
    tg.openLink(raw, { try_instant_view: false });
    return true;
  }

  /*
   * In the packaged app the WebView must not be the thing that navigates:
   * whether a WebViewClient intercepts a custom scheme — or loads an app-link
   * URL inside itself — is outside our control, and that is precisely what
   * the bug report was about. Custom Tabs is a separate activity: a real
   * browser, with real scheme/app-link resolution, and our page stays alive
   * underneath.
   */
  if (isNativeShell()) {
    const plugin = await getPlugin();
    if (plugin) {
      try {
        await plugin.open({ url: raw, toolbarColor: '#0a0c12' });
        return true;
      } catch {
        /* fall through to the plain navigation below */
      }
    }
  }

  if (view) {
    /* `openWindow` is the ORIGINAL window.open when this call came from the
       pairing bridge in lib/wcDeepLink.js — using the live one there would
       re-enter the bridge forever. */
    const open = openWindow ?? view.open?.bind(view);
    try {
      if (open && open(raw, target, features)) return true;
    } catch {
      /* pop-up blocked, or the target was rejected — try the frame itself */
    }
    try {
      /* A same-frame navigation is always permitted, and it is what AppKit
         itself does. Never reached in the native shell without having tried
         Custom Tabs above. */
      view.location.assign(raw);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Open a URL.
 * @returns {Promise<boolean>} false when the URL was rejected as unsafe.
 */
export async function openUrl(url, { toolbarColor = '#0a0c12' } = {}) {
  if (!isSafeUrl(url)) return false;

  // Inside Telegram, its own opener keeps the Mini App alive underneath.
  const tg = typeof window !== 'undefined' ? window.Telegram?.WebApp : null;
  if (tg?.openLink) {
    tg.openLink(url, { try_instant_view: false });
    return true;
  }

  const plugin = await getPlugin();
  if (plugin) {
    try {
      await plugin.open({ url, toolbarColor, presentationStyle: 'popover' });
      return true;
    } catch {
      /* fall through to a normal tab */
    }
  }

  if (typeof window !== 'undefined') {
    // noopener is not optional: without it the opened page gets a handle to
    // our window object via window.opener and can navigate us somewhere else.
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (opened) return true;
    /*
     * `window.open` returned null: a pop-up blocker refused it. That happens
     * easily here because this function awaits a dynamic import first, and
     * some browsers no longer count the click as a "user gesture" by the
     * time the open call runs. Silently doing nothing is the worst outcome —
     * the user taps "Continue to provider" and the app appears dead. Falling
     * back to a same-tab navigation is always permitted; checkout pages we
     * hand off to carry a finalUrl that brings the user back afterwards.
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
