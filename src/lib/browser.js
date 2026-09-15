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
 * Which channel a wallet hand-off will travel through.
 *
 * `android-intent` is deliberately not called Custom Tabs: current APKs use a
 * package-scoped ACTION_VIEW intent with the raw `wc:` URI. `telegram` can only
 * carry HTTPS. A plain browser receives the wallet's native custom scheme.
 */
export function walletHandOffChannel(win) {
  const view = win ?? (typeof window !== 'undefined' ? window : null);
  if (view?.Telegram?.WebApp?.openLink) return 'telegram';
  if (view?.Capacitor?.isNativePlatform?.()) return 'android-intent';
  return 'web-native';
}

function isNativeWalletUrl(raw) {
  const url = String(raw || '').trim();
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(url) && !/^https?:\/\//i.test(url);
}

function isPairingUri(raw) {
  const uri = String(raw || '').trim();
  return /^wc:[^\s@]+@2\?(?=[^#]*\brelay-protocol=)(?=[^#]*\bsymKey=)[^#]+$/i.test(uri);
}

/**
 * Hand one WalletConnect pairing to a mobile wallet while this page and its
 * relay socket remain alive.
 *
 * `url` is the native wallet deep link. The decoded `pairingUri`, exact Android
 * package and HTTPS `fallbackUrl` are supplied by wcDeepLink/wcWallets:
 *
 *   • packaged Android → raw `wc:` ACTION_VIEW intent, package-scoped;
 *   • ordinary browser → native custom scheme in a separate browsing context;
 *   • Telegram         → universal HTTPS fallback (its only accepted scheme).
 *
 * A universal link opening an app is not treated as primary success: redirect
 * services may strip the pairing query, which opens the wallet home screen but
 * produces no session proposal.
 */
export async function openWalletLink(url, {
  target = '_blank',
  features = 'noreferrer noopener',
  win,
  openWindow,
  wallet = null,
  walletPackage = wallet?.androidPackage || '',
  pairingUri = '',
  fallbackUrl = ''
} = {}) {
  const raw = String(url || '').trim();
  const fallback = isSafeUrl(fallbackUrl)
    ? String(fallbackUrl).trim()
    : (isSafeUrl(raw) ? raw : '');
  const native = isNativeWalletUrl(raw) ? raw : '';
  const view = win ?? (typeof window !== 'undefined' ? window : null);
  const channel = walletHandOffChannel(view);

  /* Android's generic `wc:` intent is the protocol-native hand-off recommended
     by WalletConnect. The explicit package prevents another wallet from
     stealing the tap. MainActivity validates the package allowlist and URI
     shape again before Android ever sees it. */
  if (channel === 'android-intent') {
    if (walletPackage && isPairingUri(pairingUri)) {
      try {
        const bridge = view?.FBTWalletLink;
        if (bridge && typeof bridge.openWallet === 'function') {
          const opened = bridge.openWallet(pairingUri, walletPackage);
          if (opened === true || opened === 'true') return true;
        }
      } catch {
        /* An old/partially upgraded APK falls through to its HTTPS compatibility path. */
      }
    }

    if (fallback) {
      const plugin = await getPlugin();
      if (plugin) {
        try {
          await plugin.open({ url: fallback, toolbarColor: '#0a0c12' });
          return true;
        } catch {
          /* Keep the pairing page alive; never replace its WebView as fallback. */
        }
      }
    }
    return false;
  }

  if (channel === 'telegram') {
    if (!fallback) return false;
    try {
      view.Telegram.WebApp.openLink(fallback, { try_instant_view: false });
      return true;
    } catch {
      return false;
    }
  }

  const launchUrl = native || fallback;
  if (!launchUrl || !view) return false;

  /* Never accept AppKit's `_self`/`_top` here: replacing this document destroys
     the pending connect() promise before the wallet publishes its approval. */
  const asked = String(target || '_blank');
  const safeTarget = asked === '_self' || asked === '_top' || asked === '' ? '_blank' : asked;
  const open = openWindow ?? view.open?.bind(view);
  if (open) {
    try {
      if (open(launchUrl, safeTarget, features)) return true;
    } catch {
      /* A real anchor below is the final non-destructive fallback. */
    }
  }

  if (typeof view.document?.createElement === 'function') {
    try {
      const a = view.document.createElement('a');
      a.href = launchUrl;
      a.target = '_blank';
      a.rel = 'noreferrer noopener';
      a.style.display = 'none';
      view.document.body?.appendChild(a);
      a.click();
      a.remove();
      return true;
    } catch {
      /* No same-document navigation: leaving the QR visible is safer. */
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
