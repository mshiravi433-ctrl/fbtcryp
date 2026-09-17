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

/**
 * Open an https URL in a Custom Tab (or a normal tab outside the APK).
 * NEVER does same-tab navigation for wallet links.
 */
async function openHttpsFallback(url, { view, openWindow } = {}) {
  if (!url || !isHttps(url)) return false;
  const win = view ?? (typeof window !== 'undefined' ? window : null);
  if (!win) return false;
  // Try _blank first
  if (tryOpen(win, url, openWindow)) return true;
  if (tryAnchor(win, url)) return true;
  // Try Capacitor Browser plugin (Custom Tabs) — safe, keeps dApp alive
  try {
    const plugin = await (async () => {
      try {
        const mod = await import('@capacitor/browser');
        return mod.Browser ?? null;
      } catch { return null; }
    })();
    if (plugin) {
      try {
        await withTimeout(
          Promise.resolve(plugin.open({ url, toolbarColor: '#0a0c12', presentationStyle: 'popover' })),
          TIMEOUT.teardown,
          'FALLBACK_TIMEOUT'
        );
        return true;
      } catch { /* fall through */ }
    }
    const tg = win.Telegram?.WebApp;
    if (tg?.openLink) {
      try { tg.openLink(url, { try_instant_view: false }); return true; } catch { /* noop */ }
    }
    // No location.assign — returning false preserves fbtswap.ir
    return false;
  } catch {
    return false;
  }
}

/**
 * Synchronous version — runs entirely within the user gesture, no await.
 * Returns true if a route was attempted (intent, native, or anchor).
 */
export function openWalletLinkSync(url, options = {}) {
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
    if (raw && walletPackage && win.FBTWalletLink?.openWallet) {
      try {
        if (win.FBTWalletLink.openWallet(raw, walletPackage)) return true;
      } catch { /* fall through */ }
    }
    return false;
  }

  if (channel === 'telegram') {
    const payload = isAndroidView(win) && raw ? encodeURIComponent(raw) : null;
    const native = payload ? rebuildWithPayload(url, payload) : url;
    if (tryOpen(win, native, openWindow)) return true;
    if (tryAnchor(win, native)) return true;
    return false;
  }

  // web — intent first, then native, then anchor
  if (isAndroidView(win) && wallet && raw) {
    const intent = androidIntentLink(wallet, raw, fallbackUrl);
    if (intent) {
      if (tryOpen(win, intent, openWindow)) return true;
      if (tryAnchor(win, intent)) return true;
    }
  }
  if (tryOpen(win, url, openWindow)) return true;
  if (tryAnchor(win, url)) return true;
  return false;
}

/**
 * Hand one pairing to a wallet app without ever navigating this document.
 * @returns {Promise<boolean>} whether a route was actually attempted.
 */
export async function openWalletLink(url, options = {}) {
  const win = options.view ?? (typeof window !== 'undefined' ? window : null);
  if (!win || !url) return false;

  // Sync attempt first — preserves user gesture
  if (openWalletLinkSync(url, options)) return true;

  const raw = options.pairingUri || pairingUriFromLink(url) || '';
  const channel = handOffChannel(win);

  if (channel === 'native-app') {
    if (raw && options.walletPackage && win.FBTWalletLink?.openWallet) {
      try {
        if (win.FBTWalletLink.openWallet(raw, options.walletPackage)) return true;
      } catch { /* fall through */ }
    }
    return openHttpsFallback(options.fallbackUrl || (isHttps(url) ? url : ''), { view: win, openWindow: options.openWindow });
  }

  if (channel === 'telegram') {
    try {
      win.Telegram?.WebApp?.openLink?.(options.fallbackUrl || (isHttps(url) ? url : url));
      return true;
    } catch {
      return false;
    }
  }

  // web — only https fallback remains, never location.assign
  return openHttpsFallback(options.fallbackUrl, { view: win, openWindow: options.openWindow });
}

/**
 * Wrap `window.open` for the duration of one pairing attempt.
 * FAIL-OPEN BY CONSTRUCTION.
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
      // Synchronous open first — this is the critical path for popup-blocker
      const syncOk = (() => {
        try {
          // Build options for sync open
          return openWalletLinkSync(decision.url, {
            pairingUri: decision.pairingUri || '',
            wallet: decision.wallet ?? null,
            walletPackage: decision.wallet?.androidPackage || '',
            fallbackUrl: decision.fallbackUrl || '',
            view: target,
            openWindow: original.bind(target)
          });
        } catch { return false; }
      })();
      if (!syncOk) {
        // Async path for fallback (https) — still never _self
        openWallet(decision.url, {
          pairingUri: decision.pairingUri || '',
          wallet: decision.wallet ?? null,
          walletPackage: decision.wallet?.androidPackage || '',
          fallbackUrl: decision.fallbackUrl || '',
          rewritten: decision.rewritten,
          repaired: Boolean(decision.repaired),
          openWindow: original.bind(target)
        });
      } else {
        // Even when sync succeeded, still call openWallet for tracing, but it will no-op or trace success
        try {
          openWallet(decision.url, {
            pairingUri: decision.pairingUri || '',
            wallet: decision.wallet ?? null,
            walletPackage: decision.wallet?.androidPackage || '',
            fallbackUrl: decision.fallbackUrl || '',
            rewritten: decision.rewritten,
            repaired: Boolean(decision.repaired),
            openWindow: original.bind(target),
            _syncAlreadySucceeded: true
          });
        } catch { /* tracing only */ }
      }
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
