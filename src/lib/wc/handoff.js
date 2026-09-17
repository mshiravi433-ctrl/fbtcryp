/**
 * THE LAST METRE
 * ---------------------------------------------------------------------------
 * Everything upstream of this file produces one string: the URL that hands a
 * pairing to a wallet app. Everything that has ever gone wrong in this flow
 * went wrong HERE, in one of three ways:
 *
 *   1. the wrong target — the SDK's `window.open(url, '_self')` replaces this
 *      document, so the WalletConnect client, its relay socket and the pending
 *      connect() promise all die in the instant the wallet opens. The approval
 *      the user taps is published to a relay nobody is listening to any more.
 *   2. the wrong payload — a redirector drops `uri=wc:…`, the app opens on its
 *      home screen, and nothing ever asks to connect;
 *   3. the wrong channel — a custom scheme handed to a WebView that can route
 *      no scheme at all (Telegram), or a plain `trust://` handed to an OEM
 *      Chrome that wants a package-scoped intent.
 *
 * So there is one opener, it is channel-aware, and it never navigates this
 * document.
 */

import {
  carriesPairingUri,
  looksLikePairingUri,
  pairingUriFromLink,
  repairPairingInLink,
  repairPairingUri
} from './uri.js';
import { TIMEOUT } from './config.js';
import { withTimeout } from './timing.js';
import {
  androidIntentLink,
  lastTappedWallet,
  walletForUrl,
  walletLinks
} from './wallets.js';

/** Is this view an Android browser (Chrome's documented intent:// path)? */
export function isAndroidView(view) {
  const ua = String(
    view?.navigator?.userAgent ??
      (typeof navigator !== 'undefined' ? navigator.userAgent : '') ??
      ''
  );
  return /Android/i.test(ua);
}

/**
 * Which channel a wallet hand-off travels through.
 *
 *   `native-app` — the packaged APK. MainActivity exposes a JavascriptBridge
 *                  that fires a package-scoped ACTION_VIEW with the raw `wc:`
 *                  URI, which is the most reliable route on Android.
 *   `telegram`   — the Mini App WebView. It can route no custom scheme, so it
 *                  gets the universal HTTPS link (and it decodes a deep link
 *                  once in transit, hence the double-encode below).
 *   `web`        — a real browser. Native custom scheme, with the
 *                  Chrome-documented `intent://` form first on Android.
 */
export function handOffChannel(view) {
  const win = view ?? (typeof window !== 'undefined' ? window : null);
  if (win?.Capacitor?.isNativePlatform?.()) return 'native-app';
  if (win?.Telegram?.WebApp?.openLink) return 'telegram';
  return 'web';
}

/** A custom scheme that is not http(s) — i.e. a wallet app link. */
export function isNativeWalletUrl(raw) {
  const url = String(raw ?? '').trim();
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(url) && !/^https?:\/\//i.test(url);
}

/**
 * Decide what to do with a URL the SDK asked to open.
 *
 * The SDK calls `window.open` for far more than wallet hand-offs (store links,
 * its own docs, an occasional `about:blank`), so the rule is narrow by design:
 * only URLs this app can prove are a pairing hand-off are rewritten. Anything
 * else passes straight through to the original call.
 *
 * @returns {{action:'open'|'pass', url?:string, fallbackUrl?:string,
 *            pairingUri?:string, wallet?:object|null, repaired?:boolean}}
 */
export function decideWalletOpen(raw, { view } = {}) {
  const incoming = String(raw ?? '').trim();
  if (!incoming) return { action: 'pass' };
  const text = repairPairingInLink(incoming);
  const repaired = text !== incoming;
  const scheme = (text.match(/^([a-z][a-z0-9+.-]*):/i) || [])[1]?.toLowerCase() || '';

  /* In-page schemes are never wallet hand-offs. */
  if (!scheme || ['about', 'blob', 'data', 'javascript'].includes(scheme)) {
    return { action: 'pass' };
  }

  /* An https URL that belongs to a promoted wallet is rebuilt as the native
     route: the payload-preserving form, from the registry rather than from
     whatever a redirector decided to serve. */
  if (scheme === 'http' || scheme === 'https') {
    const wallet = walletForUrl(text);
    const pairingUri = pairingUriFromLink(text);
    if (!wallet || !pairingUri) return { action: 'pass' };
    return openDecision({ wallet, pairingUri, original: text, repaired });
  }

  /* A bare `wc:` URI names no app. Complete it only when the tapped wallet is
     known (appkit.js records it); otherwise leave the browser alone. */
  if (scheme === 'wc') {
    const pairingUri = repairPairingUri(text);
    if (!looksLikePairingUri(pairingUri)) return { action: 'pass' };
    const wallet = lastTappedWallet();
    if (!wallet) return { action: 'pass' };
    return openDecision({
      wallet,
      pairingUri,
      original: text,
      repaired: repaired || pairingUri !== text
    });
  }

  /* A custom scheme with no pairing payload is a store/home link: untouched. */
  if (!carriesPairingUri(text)) return { action: 'pass' };

  const wallet = walletForUrl(text);
  const pairingUri = pairingUriFromLink(text);
  if (wallet && pairingUri) {
    return openDecision({ wallet, pairingUri, original: text, repaired });
  }

  /* An unknown wallet's own scheme: a real browser may still understand it,
     and no package-safe fallback can be invented for it. */
  return { action: 'open', url: text, fallbackUrl: '', pairingUri, wallet: null, repaired };
}

function openDecision({ wallet, pairingUri, original, repaired }) {
  const links = walletLinks(wallet, pairingUri);
  if (!links.native) return { action: 'pass' };
  return {
    action: 'open',
    url: links.native,
    fallbackUrl: links.universal || '',
    pairingUri,
    wallet,
    rewritten: links.native !== original,
    repaired: Boolean(repaired)
  };
}

/**
 * Open an https URL in a Custom Tab (or a normal tab outside the APK).
 *
 * Bounded, like every other wait here: a plugin that never answers must not
 * leave a wallet tap hanging.
 */
async function openHttpsFallback(url) {
  if (!url || !isHttps(url)) return false;
  try {
    const { openUrl } = await import('../browser.js');
    return Boolean(await withTimeout(Promise.resolve(openUrl(url)), TIMEOUT.teardown, 'FALLBACK_TIMEOUT'));
  } catch {
    return false;
  }
}

/**
 * Hand one pairing to a wallet app without ever navigating this document.
 *
 * @returns {Promise<boolean>} whether a route was actually attempted.
 */
export async function openWalletLink(url, options = {}) {
  const {
    pairingUri = '',
    wallet = null,
    walletPackage = wallet?.androidPackage || '',
    fallbackUrl = '',
    view,
    openWindow
  } = options;
  const win = view ?? (typeof window !== 'undefined' ? window : null);
  if (!win || !url) return false;

  const raw = pairingUri || pairingUriFromLink(url) || '';
  const channel = handOffChannel(win);

  if (channel === 'native-app') {
    /* Package-scoped ACTION_VIEW with the raw `wc:` URI. No redirector, no
       browser, no lost payload — and the `<queries>` block in
       AndroidManifest.xml is what lets resolveActivity() see the wallet. */
    if (raw && walletPackage && win.FBTWalletLink?.openWallet) {
      try {
        if (win.FBTWalletLink.openWallet(raw, walletPackage)) return true;
      } catch {
        /* fall through to the Custom Tab */
      }
    }
    return openHttpsFallback(fallbackUrl || (isHttps(url) ? url : ''));
  }

  if (channel === 'telegram') {
    /* Telegram's client decodes a deep link once while handing it to the OS, so
       the payload is encoded twice there — measured, and the reason a single
       encode leaves the wallet holding `wc%3A…`. */
    const payload = isAndroidView(win) && raw ? encodeURIComponent(raw) : null;
    const native = payload ? rebuildWithPayload(url, payload) : url;
    try {
      /* `_blank` is the whole point: `_self` would destroy this document. */
      if (win.open?.(native, '_blank', 'noreferrer noopener')) return true;
    } catch {
      /* popup blocked — the universal fallback below is the last resort */
    }
    try {
      win.Telegram?.WebApp?.openLink?.(fallbackUrl || (isHttps(url) ? url : native));
      return true;
    } catch {
      return false;
    }
  }

  /* ── web ────────────────────────────────────────────────────────────────
     1. Android Chrome: the package-scoped intent form first. It is the only
        route that survives a second app registering the same scheme, and its
        fallback URL returns the user to the wallet's universal link (→ Play
        Store) instead of a dead "cannot open" page.
     2. the plain native scheme, in a new browsing context;
     3. a synthetic anchor click — the shape least likely to be treated as a
        popup when an OEM or a CSP is involved. */
  if (isAndroidView(win) && wallet && raw) {
    const intent = androidIntentLink(wallet, raw, fallbackUrl);
    if (intent && (tryOpen(win, intent, openWindow) || tryAnchor(win, intent))) return true;
  }
  if (tryOpen(win, url, openWindow)) return true;
  if (tryAnchor(win, url)) return true;
  return openHttpsFallback(fallbackUrl);
}

function tryOpen(win, url, openWindow) {
  const open = openWindow ?? win.open?.bind(win);
  try {
    return Boolean(open?.(url, '_blank', 'noreferrer noopener'));
  } catch {
    return false;
  }
}

/**
 * An anchor click is not a popup in the eyes of the browser: it is still a
 * navigation the user's gesture initiated, and it is what reaches the OS intent
 * resolver on the OEM builds where `window.open(scheme://…)` is swallowed.
 */
function tryAnchor(win, url) {
  try {
    const doc = win.document;
    if (!doc) return false;
    const a = doc.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noreferrer noopener';
    a.style.display = 'none';
    doc.body?.appendChild(a);
    a.click();
    a.remove();
    return true;
  } catch {
    return false;
  }
}

function isHttps(url) {
  return /^https:\/\//i.test(String(url ?? '').trim());
}

/** Rewrite a link's `uri=` parameter to a differently-encoded payload. */
function rebuildWithPayload(url, encodedPayload) {
  const text = String(url ?? '');
  const match = /([?&]uri=)([\s\S]*)$/i.exec(text);
  if (!match) return text;
  return `${text.slice(0, match.index + match[1].length)}${encodedPayload}`;
}

/**
 * Wrap `window.open` for the duration of one pairing attempt.
 *
 * FAIL-OPEN BY CONSTRUCTION: an unsupported URL, a throwing delivery channel
 * and a missing browser API all fall back to the original `window.open` call,
 * so installing this can never cost a user a link that used to work.
 *
 * The one thing it enforces: the target is never `_self` or `_top`. A
 * hand-off that replaces this document takes the relay socket and the pending
 * connect() promise with it.
 */
export function installWalletOpenBridge({ win, openWallet } = {}) {
  const target = win ?? (typeof window !== 'undefined' ? window : null);
  if (!target || typeof target.open !== 'function' || typeof openWallet !== 'function') {
    return () => {};
  }
  const original = target.open;
  const bridge = function walletOpenBridge(url, name, features) {
    let decision;
    try {
      decision = decideWalletOpen(url, { view: target });
    } catch {
      decision = { action: 'pass' };
    }
    if (decision.action !== 'open') return original.call(target, url, name, features);
    try {
      openWallet(decision.url, {
        pairingUri: decision.pairingUri || '',
        wallet: decision.wallet ?? null,
        walletPackage: decision.wallet?.androidPackage || '',
        fallbackUrl: decision.fallbackUrl || '',
        rewritten: decision.rewritten,
        repaired: Boolean(decision.repaired),
        /* Recursion guard: the fallback must use the REAL opener. */
        openWindow: original.bind(target)
      });
      return null;
    } catch {
      return original.call(target, decision.url, name, features);
    }
  };
  target.open = bridge;
  return function uninstall() {
    if (target.open === bridge) target.open = original;
  };
}
