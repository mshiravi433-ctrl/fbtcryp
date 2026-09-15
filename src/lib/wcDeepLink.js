/**
 * WALLET DEEP-LINK DELIVERY — owning the last metre
 * ---------------------------------------------------------------------------
 * THE REPORT: «با زدن بازکردن ارور دیپ لینک میزنه» — tapping **Open** in the
 * WalletConnect sheet (app AND site) shows a deep-link error page instead of
 * opening Trust Wallet.
 *
 * ─── WHAT IS ACTUALLY ON THE WIRE (measured against the installed SDK) ─────
 * AppKit builds the mobile link from the wallet object the user tapped:
 *
 *   CoreHelperUtil.formatNativeUrl(wallet.mobile_link, uri, wallet.link_mode)
 *     → { redirect: `${mobile_link}wc?uri=…`,          // custom scheme
 *         redirectUniversalLink: link_mode ? `${link_mode}wc?uri=…` : undefined }
 *
 * and `ConnectionControllerUtil.onConnectMobile()` then opens:
 *
 *   experimental_preferUniversalLinks && redirectUniversalLink
 *     ? redirectUniversalLink      // https — the one a WebView can carry
 *     : redirect                   // trust://wc?uri=…  ← the reported error
 *
 * On a phone the tapped object comes from AppKit's own explorer list, whose
 * entries (fetched live with this project's id) are:
 *
 *   Trust Wallet → { mobile_link: 'trust://',    link_mode: null }
 *   MetaMask     → { mobile_link: 'metamask://', link_mode: null }
 *
 * `link_mode: null` ⇒ no `redirectUniversalLink` ⇒ the custom scheme is
 * opened, no matter that the app asks for universal links. A custom scheme is
 * navigable from a real browser and from nothing else; a WebView answers with
 * its error page and the URL printed underneath — exactly the report.
 *
 * ─── WHAT THIS MODULE IS FOR ──────────────────────────────────────────────
 * `withLinkMode()` (lib/wcWallets.js) fixes the link at its source. This module
 * is the safety net that makes the LAST METRE ours: for the duration of a
 * pairing it wraps `window.open` — the one function AppKit's `openHref()` uses
 * — and:
 *
 *   • a known wallet's deep link is rewritten to that wallet's https universal
 *     link before it leaves the page;
 *   • the delivery itself goes through `openWalletLink()` (lib/browser.js):
 *     Telegram's opener inside the Mini App, Android Custom Tabs in the
 *     packaged app, an ordinary navigation on the web — never the WebView's
 *     own opinion about what a scheme means.
 *
 * Everything after `scheme://` is copied VERBATIM. The SDK already encoded the
 * pairing URI exactly once; re-encoding turns a pairing into a silent failure,
 * so this module never touches the query string.
 *
 * Pure functions + one idempotent wrapper: unit-testable without a DOM, see
 * test/wc-deeplink-probe.mjs.
 */

import { walletForUrl, walletLinkBase } from './wcWallets.js';

/** Split a URL into `{ scheme, rest }`, `rest` being everything after `scheme://`. */
export function splitUrl(raw) {
  const text = String(raw || '').trim();
  const m = /^([a-z][a-z0-9+.-]*):\/\/([\s\S]*)$/i.exec(text);
  if (m) return { scheme: m[1].toLowerCase(), rest: m[2] };
  /* `trust:wc?uri=…` (no slashes) is accepted by Android and by the wallets
     themselves, so it is recognised too — with leading slashes removed so the
     rebuilt URL is uniform. */
  const loose = /^([a-z][a-z0-9+.-]*):([\s\S]*)$/i.exec(text);
  if (loose) return { scheme: loose[1].toLowerCase(), rest: loose[2].replace(/^\/+/, '') };
  return null;
}

/** Is this an https URL? (The only scheme a WebView — and our opener — can carry.) */
export function isHttpsUrl(raw) {
  return /^https:\/\//i.test(String(raw || '').trim());
}

/** Does this URL carry a WalletConnect pairing payload? */
export function carriesPairingUri(raw) {
  return /(?:^|[?&])uri=/i.test(String(raw || ''));
}

/**
 * The https universal link for a wallet deep link — '' when the URL is not a
 * wallet hand-off we know, or is already https.
 *
 *   trust://wc?uri=wc%3A… → https://link.trustwallet.com/wc?uri=wc%3A…
 */
export function universalForWalletLink(raw) {
  const text = String(raw || '').trim();
  if (!text || isHttpsUrl(text)) return '';
  const wallet = walletForUrl(text);
  if (!wallet) return '';
  const base = walletLinkBase(wallet.universal);
  if (!base) return '';
  const parts = splitUrl(text);
  if (!parts) return '';
  return `${base}${parts.rest}`;
}

/**
 * What should happen to a URL AppKit asked us to open?
 *
 *   { action: 'open', url, wallet, rewritten } — deliver it through
 *                                               openWalletLink().
 *   { action: 'pass', url: null }              — not a wallet hand-off: the
 *                                               caller leaves the original
 *                                               call untouched.
 *
 * The rules are deliberately narrow, because this bridge sits on `window.open`
 * for the whole pairing and AppKit also uses it for its own links ("Get a
 * wallet", store pages, Reown branding). Only a URL that clearly carries a
 * pairing to a wallet app is touched.
 */
export function decideWalletOpen(raw) {
  const text = String(raw || '').trim();
  if (!text) return { action: 'pass', url: null };
  const parts = splitUrl(text);
  const scheme = parts?.scheme || '';

  /* A web link: ours only when it is already a wallet hand-off carrying a
     pairing URI on a host we know (e.g. a hand-built universal link). */
  if (scheme === 'http' || scheme === 'https') {
    const wallet = walletForUrl(text);
    if (wallet && isHttpsUrl(text) && carriesPairingUri(text)) {
      return { action: 'open', url: text, wallet, rewritten: false };
    }
    return { action: 'pass', url: null };
  }

  /* In-page schemes the SDK may legitimately open — never ours. */
  if (!scheme || scheme === 'about' || scheme === 'blob' || scheme === 'data' || scheme === 'javascript') {
    return { action: 'pass', url: null };
  }

  /* A custom scheme WITHOUT a pairing payload is not a wallet hand-off (store
     links, `market://`, wallet homepages). Leave it to the WebView. */
  if (!carriesPairingUri(text)) return { action: 'pass', url: null };

  const wallet = walletForUrl(text);
  const universal = universalForWalletLink(text);
  if (wallet && universal) {
    return { action: 'open', url: universal, wallet, rewritten: true };
  }
  /* A pairing for a wallet we have no https link for: still delivered through
     the opener — a real browser resolves custom schemes, our WebView may not.
     `openWalletLink` itself refuses non-https in the Telegram context, where
     the platform only accepts http(s) links. */
  return { action: 'open', url: text, wallet: null, rewritten: false };
}

/**
 * Install the wallet hand-off bridge on `win.open`.
 *
 * @param {object}   options
 * @param {Window}   options.win         defaults to the global window
 * @param {Function} options.openWallet  `(url, { target, features }) => void`
 *                                       — the delivery channel (lib/browser.js
 *                                       `openWalletLink`). A throw falls back
 *                                       to the original call.
 * @returns {Function} uninstall — always call it: a bridge left installed
 *                    would keep rewriting links for the whole session.
 *
 * FAIL-OPEN BY CONSTRUCTION: an opener that throws, a window without `open`,
 * an unknown URL — every path degrades to exactly the behaviour that existed
 * before this module, never to a silent dead tap.
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
      decision = decideWalletOpen(url);
    } catch {
      decision = { action: 'pass', url: null };
    }
    if (decision.action !== 'open') return original.call(target, url, name, features);
    try {
      openWallet(decision.url, {
        target: name || '_self',
        features: features || 'noreferrer noopener',
        wallet: decision.wallet ?? null,
        rewritten: decision.rewritten,
        /* The ORIGINAL opener: the live `window.open` is this bridge, so a
           delivery that falls back to window.open would recurse forever. */
        openWindow: original.bind(target)
      });
      /* AppKit ignores the return value on this path (CoreHelperUtil.openHref)
         and must not be told a Window object exists for a deep link. */
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
