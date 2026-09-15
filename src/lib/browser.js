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
 * Which channel a wallet hand-off will travel through, so a caller can decide
 * whether to let the browser navigate a real `<a target="_blank">` (never
 * pop-up blocked, and the page survives) or hand the URL to `openWalletLink()`
 * instead.
 *
 *   'telegram'    — the Mini App iframe: only Telegram's own opener can leave
 *                   it without unloading the app underneath.
 *   'custom-tabs' — the packaged app: the WebView must not navigate, so the
 *                   system browser takes the URL.
 *   'web'         — a plain browser: an anchor with `target="_blank"` is the
 *                   best possible delivery and needs no help.
 */
export function walletHandOffChannel(win) {
  const view = win ?? (typeof window !== 'undefined' ? window : null);
  if (view?.Telegram?.WebApp?.openLink) return 'telegram';
  /* The same test `isNativeShell()` makes, spelled out against the window we
     were handed so a caller (or a probe) can ask about a window that is not
     the global one. */
  if (view?.Capacitor?.isNativePlatform?.()) return 'custom-tabs';
  return 'web';
}

/**
 * Hand a WALLET deep link to the phone.
 *
 * ─── WHY THIS IS NOT openUrl() ─────────────────────────────────────────────
 * `openUrl()` exists for arbitrary external websites: https only, always
 * through the system browser, never injected into. A wallet hand-off is a
 * different animal with a different failure mode, and it needs its own
 * channel for two reasons: a deep link must LEAVE the WebView, and — the one
 * that survived three rounds of fixes — it must not TAKE THIS PAGE WITH IT.
 *
 * ─── THE MEASURED ROOT CAUSE OF «ارور دیپ لینک» ────────────────────────────
 * Three rounds of fixes corrected the URL (`trust://` → the https universal
 * link, `&amp;` → `&`, one level of encoding) and the report did not change,
 * because the URL was never the last thing that was wrong. The TARGET was.
 * Read out of the installed SDK, `@reown/appkit-controllers@1.8.19`,
 * `ConnectionControllerUtil.onConnectMobile()`:
 *
 *     const target = CoreHelperUtil.isIframe() ? '_top' : '_self';
 *     CoreHelperUtil.openHref(universalLink, target);   // → window.open(url, '_self')
 *
 * `window.open(url, '_self')` REPLACES the current document. So on a phone,
 * tapping a wallet in the modal navigated this tab to
 * `https://link.trustwallet.com/wc?uri=…` and destroyed, in that instant, the
 * WalletConnect client, its relay socket and the pending `connect()` promise.
 * The user then approves in Trust; the wallet publishes the approval to the
 * relay; nobody is left to receive it. The tab shows Trust's own
 * "Download the app" page — the «شکل عوض شده و زشت شده» report — and the
 * session never exists. Every byte of the URL was correct and the connection
 * still could not complete.
 *
 * (AppKit only special-cases Telegram here — "Only '_blank' deeplinks work in
 * Telegram context". For the open web it uses `_self`, which is precisely
 * wrong for a pairing: a wallet hand-off is a round trip, and a round trip
 * needs the caller to still be alive when the answer arrives.)
 *
 * So this function's rule is: a wallet hand-off NEVER navigates this document.
 *
 *   • packaged app  → @capacitor/browser (Android Custom Tabs). The browser is
 *     a real browser, so the OS resolves Android App Links to the wallet —
 *     and if the wallet is not installed the user lands on the wallet's own
 *     web page instead of our WebView error page. Our page stays underneath.
 *   • Telegram      → WebApp.openLink(): Telegram's opener leaves the Mini App
 *     alive underneath rather than navigating our page away.
 *   • plain web     → `window.open(url, '_blank')` — the target Trust Wallet's
 *     own developer docs prescribe (`window.open(deepLink, '_blank',
 *     'noreferrer noopener')`). The pairing page survives in its own tab and
 *     is still connected when the wallet answers.
 *
 * A `_blank` that a pop-up blocker refuses is retried once through a real
 * `<a target="_blank">` click, which is not a scripted window and is
 * therefore not blocked. What this function will NOT do as a last resort is
 * `location.assign()`: navigating away would look like success and quietly
 * kill the pairing it was called to make.
 *
 * @returns {Promise<boolean>} false when the URL was rejected or nothing could
 *          be opened (callers treat that as "the user still has the QR code").
 */
export async function openWalletLink(url, { target = '_blank', features = 'noreferrer noopener', win, openWindow } = {}) {
  const raw = String(url || '').trim();
  if (!raw) return false;
  const view = win ?? (typeof window !== 'undefined' ? window : null);
  const https = isSafeUrl(raw);

  /*
   * Inside Telegram, Telegram's own opener is the only way to leave the Mini
   * App without killing the page underneath — and it accepts http(s) links
   * only, so a custom scheme is handled further down.
   *
   * Read off `view` (the window we were handed), not the global: every other
   * branch of this function honours the injected window, and a branch that
   * quietly reads `window` instead is one a caller cannot test or override.
   */
  const tg = view?.Telegram?.WebApp ?? null;
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

  if (!view) return false;

  /*
   * THE TARGET RULE. `_self` / `_top` / '' all mean "replace this document",
   * and for a wallet hand-off that is the bug, not a fallback. Everything
   * that is not an explicit named window becomes `_blank`.
   */
  const asked = String(target || '_blank');
  const safeTarget = asked === '_self' || asked === '_top' || asked === '' ? '_blank' : asked;

  /* `openWindow` is the ORIGINAL window.open when this call came from the
     pairing bridge in lib/wcDeepLink.js — using the live one there would
     re-enter the bridge forever. */
  const open = openWindow ?? view.open?.bind(view);
  if (open) {
    try {
      if (open(raw, safeTarget, features)) return true;
    } catch {
      /* a refused target or a thrown SecurityError — try the anchor below */
    }
  }

  /*
   * POP-UP BLOCKED. A real anchor click is not a scripted window, so the
   * blocker does not apply to it — and we are still inside the user's own
   * click task, so the gesture is intact. This is the difference between
   * "tap Trust Wallet and nothing happens" and a hand-off that works with
   * strict blocker settings.
   */
  if (typeof view.document?.createElement === 'function') {
    try {
      const a = view.document.createElement('a');
      a.href = raw;
      a.target = '_blank';
      a.rel = 'noreferrer noopener';
      /* The anchor is never visible and never needs to be: click() works on a
         detached-then-appended element, and appending first is what makes the
         navigation count as a real link activation in every engine. */
      a.style.display = 'none';
      view.document.body?.appendChild(a);
      a.click();
      a.remove();
      return true;
    } catch {
      /* nothing left that would not destroy the pairing */
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
