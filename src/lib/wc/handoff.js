/**
 * THE LAST METRE
 * ---------------------------------------------------------------------------
 * Everything upstream of this file produces one string: the URL that hands a
 * pairing to a wallet app. Everything that has ever gone wrong in this flow
 * went wrong HERE, in one of four ways:
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
 *   4. the wrong tab — 2026-09-17, the «I never get back to fbtswap.ir»
 *      report. Chrome DOES launch the wallet from a `_blank` custom scheme,
 *      but it leaves the new tab behind with the unroutable URL in its address
 *      bar. Back out of the wallet and the phone returns to that dead tab, not
 *      to the dApp. Nothing was broken except the tab we forgot to clean up.
 *
 * So there is one opener, it is channel-aware, it never navigates this
 * document, and it closes the tab it had to open.
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

/** Is this an iOS browser? Custom schemes there need no intent wrapper. */
export function isIOSView(view) {
  const ua = String(
    view?.navigator?.userAgent ??
      (typeof navigator !== 'undefined' ? navigator.userAgent : '') ??
      ''
  );
  return /iPhone|iPad|iPod/i.test(ua);
}

/**
 * An embedded WebView rather than a real browser.
 *
 * Android's WebView puts `; wv` in the UA; Telegram's Mini App WebView is a
 * plain WebView with the Telegram bridge injected on top. Neither is allowed
 * the in-place intent route: if the host does not intercept `intent://` the
 * navigation commits and the dApp document is gone.
 */
export function isWebViewEmbed(view) {
  const win = view ?? (typeof window !== 'undefined' ? window : null);
  if (!win) return false;
  const ua = String(win?.navigator?.userAgent ?? '');
  if (/; wv\b/i.test(ua)) return true;
  return Boolean(
    win?.Telegram ||
      win?.TelegramWebviewProxy ||
      win?.TelegramWebviewProxyProto
  );
}

/**
 * Does this browser speak Chrome's `intent://` scheme?
 *
 * Only Chromium-based Android browsers implement it. Firefox on Android does
 * not, and handing it an `intent://` URL is a plain navigation to a scheme it
 * cannot render. The list is a UA allowlist on purpose: guessing "Android, so
 * intent must work" is how a dApp loses its own document on the one browser
 * that disagrees.
 */
export function isIntentCapableBrowser(view) {
  if (!isAndroidView(view)) return false;
  if (isWebViewEmbed(view)) return false;
  const ua = String(view?.navigator?.userAgent ?? '');
  return /chrome|chromium|crios|samsungbrowser|ucbrowser|opr|edg|miuibrowser|huaweibrowser|vivaldi|heyTapBrowser|oppobrowser/i.test(
    ua
  );
}

/**
 * Which channel a wallet hand-off travels through.
 *
 *   `native-app` — the packaged APK. MainActivity exposes a JavascriptBridge
 *                  that fires a package-scoped ACTION_VIEW with the raw `wc:`
 *                  URI, which is the most reliable route on Android.
 *   `telegram`   — the Mini App WebView. It can route no custom scheme, so it
 *                  gets the native link first (Telegram's client forwards the
 *                  scheme to the OS) and the universal HTTPS link as the way
 *                  out when it does not.
 *   `web`        — a real browser. Native custom scheme, with the
 *                  Chrome-documented `intent://` form first on Android.
 */
export function handOffChannel(view) {
  const win = view ?? (typeof window !== 'undefined' ? window : null);
  if (win?.Capacitor?.isNativePlatform?.()) return 'native-app';
  if (win?.Telegram?.WebApp?.openLink) return 'telegram';
  return 'web';
}

/**
 * Everything the health report can say about the hop the user is standing on.
 *
 * «It opens the wallet but does not connect» has four different causes and
 * they live in different hops. Naming the channel, the WebView and whether the
 * Java bridge exists turns the next report into a diagnosis instead of a
 * description.
 */
export function handoffFacts(view) {
  const win = view ?? (typeof window !== 'undefined' ? window : null);
  const ua = String(win?.navigator?.userAgent ?? '');
  return {
    channel: handOffChannel(win),
    android: isAndroidView(win),
    ios: isIOSView(win),
    webview: isWebViewEmbed(win),
    telegram: Boolean(
      win?.Telegram || win?.TelegramWebviewProxy || win?.TelegramWebviewProxyProto
    ),
    intentCapable: isIntentCapableBrowser(win),
    javaBridge: Boolean(win?.FBTWalletLink?.openWallet),
    /* Shape only — never the browser's own UA string (the report carries it). */
    uaLooksLikeChrome: /chrome|chromium|crios/i.test(ua)
  };
}

/* ── the hand-off announcement ──────────────────────────────────────────────
 * The moment a pairing leaves this document, the connect bound stops being a
 * network wait and becomes a human one: the session grants the user the
 * in-wallet budget (see TIMEOUT.connectInWallet). Both the AppKit bridge and
 * our own sheet go through this module, so one subscription covers every route
 * the pairing can take out of the page.
 */
const handoffListeners = new Set();

/** @param {(detail:{url:string, wallet:object|null, route:string}) => void} fn */
export function onWalletHandoff(fn) {
  if (typeof fn !== 'function') return () => {};
  handoffListeners.add(fn);
  return () => handoffListeners.delete(fn);
}

function announceHandoff(detail) {
  for (const fn of handoffListeners) {
    try {
      fn(detail);
    } catch {
      /* a listener must never stop the hand-off it was told about */
    }
  }
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

/**
 * Open one URL in a new context and REMEMBER THE TAB IT CREATED.
 *
 * ─── THE `noopener` BUG ────────────────────────────────────────────────────
 * This used to pass `'noreferrer noopener'`, and a `window.open` with
 * `noopener` returns null BY SPECIFICATION. `Boolean(null)` is false, so every
 * attempt reported failure and the code fell through to the next route — the
 * intent form was tried, declared dead, and the raw `trust://` link was opened
 * instead. That is the shape of the report: the wallet opened (the second
 * route worked) but on the one URL that leaves a dead tab behind.
 *
 * `noreferrer` stays: a wallet hand-off has no business carrying our origin
 * to a third party. `noopener` goes, because a handle is the only way to clean
 * up after ourselves.
 */
function tryOpen(win, url, openWindow, opened = null) {
  const open = openWindow ?? win.open?.bind(win);
  /*
   * `noopener` is kept for http(s) destinations and dropped for everything
   * else, and the two halves of that sentence are the same reason:
   *   • an https page is a real page on someone else's origin — without
   *     `noopener` it can navigate this tab (`window.opener.location`), which
   *     is exactly the reverse-tabnabbing `noopener` exists for;
   *   • a custom scheme is NOT a page, and `noopener` there costs us the
   *     handle we need to close the dead tab behind us.
   */
  const page = isHttps(url);
  const features = page ? 'noreferrer noopener' : 'noreferrer';
  try {
    const child = open?.(url, '_blank', features);
    if (child && typeof child.close === 'function' && !page) opened?.push(child);
    return Boolean(child);
  } catch {
    return false;
  }
}

/**
 * Close the tab a hand-off opened, once the wallet has had time to take over.
 *
 * Chrome launches the app and leaves the new tab sitting on the unroutable
 * `trust://wc?uri=…` URL. Pressing Back out of the wallet returns the phone to
 * that tab, and the user's conclusion is «it never comes back to fbtswap.ir».
 * Closing it hands focus back to the dApp, which is still waiting on the very
 * pairing the wallet is deciding about.
 *
 * ONLY a plain custom-scheme route is cleaned up:
 *   • an `intent://` route is intercepted by Chrome itself — nothing is left
 *     behind when it resolves, and when it does NOT resolve the tab is showing
 *     `S.browser_fallback_url`, which is the «install this wallet» page the
 *     user needs;
 *   • an https route is a destination, never a launch.
 */
function scheduleClose(win, children, ms = TIMEOUT.handoffClose) {
  if (!children || children.length === 0) return;
  try {
    win.setTimeout?.(() => {
      for (const child of children.splice(0, children.length)) {
        try {
          child?.close?.();
        } catch {
          /* the tab already went away — that is the point */
        }
      }
    }, ms);
  } catch {
    /* no timers: the tab simply outlives us, which is survivable */
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
    /* Assigned, never RETURNED from an async function: `@capacitor/core`
       registers plugins as a Proxy that throws on any property that is not
       implemented on the current platform, and resolving a promise with a
       thenable reads `.then` off it — so the old `return mod.Browser` inside an
       async IIFE threw `"Browser.then() is not implemented on web"` straight
       out of the hand-off. */
    let plugin = null;
    try {
      const mod = await import('@capacitor/browser');
      plugin = mod?.Browser ?? null;
    } catch { plugin = null; }
    if (plugin && typeof plugin.open === 'function') {
      try {
        /* An async IIFE, not `Promise.resolve(plugin.open(…))`: inside a plain
           browser the Capacitor plugin is an un-implemented proxy that THROWS
           — and on a proxy, even reading `.then` throws — so the call has to
           become a rejection before anything can await it. Without this, one
           popup-blocked hand-off took the whole connect flow down with an
           unhandled CapacitorException instead of quietly trying the next
           route. */
        await withTimeout(
          (async () =>
            plugin.open({ url, toolbarColor: '#0a0c12', presentationStyle: 'popover' }))(),
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
 * The ordered routes for one channel, first try last.
 *
 * The synchronous pass can only fire the FIRST route: it is the only one still
 * inside the user's gesture, and a gesture is the one thing a popup blocker
 * cannot be argued with.
 */
function routesFor({ channel, win, url, raw, wallet, fallbackUrl, urlForChannel }) {
  const universal = fallbackUrl || (isHttps(url) ? url : '');
  /*
   * `intent://` is only offered on a real Android browser. On iOS it is a
   * scheme Safari cannot render, and inside a WebView nothing intercepts it,
   * so the navigation would commit and take this document with it.
   */
  const intent =
    channel === 'web' && isAndroidView(win) && isIntentCapableBrowser(win)
      ? androidIntentLink(wallet, raw, universal)
      : '';
  const list = [];

  if (channel === 'native-app') {
    list.push({ route: 'java-bridge', url: raw });
  }
  if (intent) list.push({ route: 'intent', url: intent });
  list.push({ route: 'native', url: urlForChannel });
  list.push({ route: 'universal', url: universal });
  return list.filter((entry) => Boolean(entry.url));
}

/**
 * Synchronous version — runs entirely within the user gesture, no await.
 * Fires the channel's first route only: it is the one route a popup blocker
 * cannot refuse, and firing three because the first was slow is worse than
 * firing none.
 *
 * @returns {{ok:boolean, route:string}}
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
  if (!win || !url) return { ok: false, route: 'none' };
  const raw = pairingUri || pairingUriFromLink(url) || '';
  const channel = handOffChannel(win);

  /* Telegram-Android decodes once in transit: encode the payload twice. */
  const urlForChannel =
    channel === 'telegram' && isAndroidView(win) && raw
      ? rebuildWithPayload(url, encodeURIComponent(raw))
      : url;

  const [first] = routesFor({
    channel,
    win,
    url,
    raw,
    wallet,
    walletPackage,
    fallbackUrl,
    urlForChannel
  });
  if (!first) return { ok: false, route: 'none' };

  if (first.route === 'java-bridge') {
    if (raw && walletPackage && win.FBTWalletLink?.openWallet) {
      try {
        if (win.FBTWalletLink.openWallet(raw, walletPackage)) {
          announceHandoff({ url: first.url, wallet, route: first.route });
          return { ok: true, route: first.route };
        }
      } catch { /* fall through */ }
    }
    return { ok: false, route: first.route };
  }

  const opened = [];
  const fired = tryOpen(win, first.url, openWindow, opened) || tryAnchor(win, first.url);
  /* iOS Safari prompts before it switches apps, and closing the tab it opened
     would dismiss that prompt, so only Android gets the cleanup. */
  if (first.route === 'native' && isAndroidView(win)) scheduleClose(win, opened);
  if (fired) announceHandoff({ url: first.url, wallet, route: first.route });
  return { ok: fired, route: first.route };
}

/**
 * Hand one pairing to a wallet app without ever navigating this document.
 *
 * @returns {Promise<{ok:boolean, route:string}>} whether a route was attempted,
 *   and which one, so the trace can name the hop a failure happened on.
 */
export async function openWalletHandoff(url, options = {}) {
  const {
    pairingUri = '',
    wallet = null,
    walletPackage = wallet?.androidPackage || '',
    fallbackUrl = '',
    view,
    openWindow
  } = options;
  const win = view ?? (typeof window !== 'undefined' ? window : null);
  if (!win || !url) return { ok: false, route: 'none' };

  const sync = openWalletLinkSync(url, {
    pairingUri,
    wallet,
    walletPackage,
    fallbackUrl,
    view: win,
    openWindow
  });
  if (sync.ok) return sync;

  const raw = pairingUri || pairingUriFromLink(url) || '';
  const channel = handOffChannel(win);
  const opened = [];

  for (const entry of routesFor({
    channel,
    win,
    url,
    raw,
    wallet,
    walletPackage,
    fallbackUrl,
    urlForChannel: url
  })) {
    if (entry.route === 'java-bridge') continue; // already refused above
    if (isHttps(entry.url)) {
      if (channel === 'telegram') {
        try {
          win.Telegram?.WebApp?.openLink?.(entry.url, { try_instant_view: false });
          announceHandoff({ url: entry.url, wallet, route: entry.route });
          return { ok: true, route: entry.route };
        } catch { /* fall through */ }
      }
      const okHttps = await openHttpsFallback(entry.url, { view: win, openWindow });
      if (okHttps) {
        announceHandoff({ url: entry.url, wallet, route: entry.route });
        return { ok: true, route: entry.route };
      }
      continue;
    }
    if (tryOpen(win, entry.url, openWindow, opened) || tryAnchor(win, entry.url)) {
      if (entry.route === 'native' && isAndroidView(win)) scheduleClose(win, opened);
      announceHandoff({ url: entry.url, wallet, route: entry.route });
      return { ok: true, route: entry.route };
    }
  }

  return { ok: false, route: 'none' };
}

/**
 * Hand one pairing to a wallet app without ever navigating this document.
 * @returns {Promise<boolean>} whether a route was actually attempted.
 */
export async function openWalletLink(url, options = {}) {
  const result = await openWalletHandoff(url, options);
  return result.ok;
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
      /* Synchronous open first — this is the critical path for the popup
         blocker, and the only one still inside the user's gesture. */
      const sync = (() => {
        try {
          return openWalletLinkSync(decision.url, {
            pairingUri: decision.pairingUri || '',
            wallet: decision.wallet ?? null,
            walletPackage: decision.wallet?.androidPackage || '',
            fallbackUrl: decision.fallbackUrl || '',
            view: target,
            openWindow: original.bind(target)
          });
        } catch { return { ok: false, route: 'none' }; }
      })();
      const shared = {
        pairingUri: decision.pairingUri || '',
        wallet: decision.wallet ?? null,
        walletPackage: decision.wallet?.androidPackage || '',
        fallbackUrl: decision.fallbackUrl || '',
        rewritten: decision.rewritten,
        repaired: Boolean(decision.repaired),
        openWindow: original.bind(target),
        _syncAlreadySucceeded: sync.ok,
        _syncRoute: sync.route
      };
      /* Either way the caller hears about it: the route it took is the hop the
         next report will be about. */
      openWallet(decision.url, shared);
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
