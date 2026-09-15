/**
 * MOBILE WALLET DEEP LINKS (WalletConnect v2)
 * ---------------------------------------------------------------------------
 * The one place that knows how to hand a pairing URI to a wallet app.
 *
 * ─── WHY THIS MODULE EXISTS ────────────────────────────────────────────────
 * The reported bug — "MetaMask and WalletConnect connect in the browser, but
 * opening Trust Wallet from the app or the site shows *Invalid URL* with a
 * link under it and never connects" — was never about the pairing. The relay,
 * the project id and the session were all fine. What was broken was the last
 * metre: the URL we handed to the phone.
 *
 * Two separate mistakes met in that URL:
 *
 *   1. THE LINKS WERE WRITTEN IN A SHAPE THE MODAL DOES NOT READ.
 *      `buildWcInitConfig()` passed `qrModalOptions.mobileWallets` with
 *      `links: { native, universal }` (the old Web3Modal-standalone shape).
 *      Since `@walletconnect/ethereum-provider@2.23` the modal is
 *      **@reown/appkit**, and `convertWCMToAppKitOptions()` copies only
 *      `{ id, name, links }` into AppKit's `customWallets`. AppKit itself
 *      never reads `links`: `w3m-connecting-wc-view.determinePlatforms()` and
 *      `ConnectionControllerUtil.onConnectMobile()` both work exclusively with
 *      the EXPLORER field names — `mobile_link`, `desktop_link`,
 *      `webapp_link`, `link_mode`. A wallet entry with only `links` therefore
 *      has no link at all: `determinePlatforms()` finds no platform and the
 *      tap lands on the "unsupported" screen instead of a wallet.
 *
 *   2. THE LINK THAT WAS USED WAS A CUSTOM SCHEME (`trust://…`).
 *      AppKit builds `${mobile_link}wc?uri=<encoded>` and, by default, opens
 *      that custom scheme. A custom scheme is only navigable from a real
 *      browser. From a WebView — the packaged Android app, Telegram, or Trust
 *      Wallet's OWN in-app browser — `trust://…` is an unknown scheme, and the
 *      WebView answers exactly what was reported: **"Invalid URL"**, with the
 *      offending URL printed underneath it as a link. Nothing pairs, because
 *      nothing was ever opened.
 *
 *      Trust Wallet's own integration docs prescribe the https form:
 *        `https://link.trustwallet.com/wc?uri=${encodeURIComponent(uri)}`
 *      An https universal link is understood by every context: it opens the
 *      wallet app through Android App Links / iOS Universal Links, and where
 *      the app is missing it degrades to a web page instead of an error page.
 *
 * This module produces BOTH shapes from one table, so the two can never drift
 * apart again, and it is plain data + pure functions so the whole contract is
 * unit-testable without a browser, a bundler or a wallet — see
 * test/wc-wallets-probe.mjs.
 */

/**
 * The wallets this app promotes, in display order.
 *
 * `id` is the Reown/WalletConnect explorer id. Keeping the real explorer id
 * (rather than a short name like 'trust') matters: AppKit keys its recent-
 * wallet storage, its analytics and its "All wallets" dedup on that id, so a
 * home-made id would show the same wallet twice under two identities.
 *
 * `native` / `universal` are BASES, not URLs: the caller (or AppKit) appends
 * `wc?uri=<encoded pairing uri>`. Both must end in '/'.
 */
export const MOBILE_WALLETS = Object.freeze([
  {
    key: 'metamask',
    id: 'c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96',
    name: 'MetaMask',
    native: 'metamask://',
    universal: 'https://metamask.app.link/'
  },
  {
    key: 'trust',
    id: '4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0',
    name: 'Trust Wallet',
    /* The scheme Trust registers for its own app. Kept as the NATIVE fallback:
       it is the right thing on a real browser, and it is what the WebView
       chokes on — which is why `universal` is preferred everywhere. */
    native: 'trust://',
    /* From Trust Wallet's developer docs ("Mobile (WalletConnect)"), the
       documented deep link is exactly this host + `/wc?uri=`. */
    universal: 'https://link.trustwallet.com/'
  },
  {
    key: 'rainbow',
    id: '1ae92b26df02f0abca6304df07debccd18262fdf5fe82daa81593582dac9a369',
    name: 'Rainbow',
    native: 'rainbow://',
    universal: 'https://rnbwapp.com/'
  }
]);

/** Every promoted wallet's explorer id, for AppKit option lists. */
export const WC_WALLET_IDS = Object.freeze(MOBILE_WALLETS.map((w) => w.id));

/**
 * Normalise a deep-link base the way AppKit does.
 *
 * This mirrors `CoreHelperUtil.formatNativeUrl()` in @reown/appkit-controllers
 * line for line, because AppKit appends `wc?uri=` to whatever we hand it as
 * `mobile_link` / `link_mode`:
 *
 *   - a bare scheme (`trust:`, `rainbow`) is completed to `trust://`;
 *   - a base that does not end in `/` gains one;
 *   - a base that already ends in `/` is left ALONE. Stripping trailing
 *     slashes here would turn `trust://` into `trust:/wc?uri=` — a link no
 *     wallet recognises — while AppKit, which never strips, would produce
 *     `trust://wc?uri=` from the same value. Two rules for one link is how
 *     "it works on one platform only" bugs are born, so there is one rule.
 */
export function walletLinkBase(base) {
  const raw = String(base || '').trim();
  if (!raw) return '';
  let safe = raw;
  if (!safe.includes('://')) {
    safe = `${safe.replaceAll('/', '').replaceAll(':', '')}://`;
  }
  return safe.endsWith('/') ? safe : `${safe}/`;
}

/**
 * Build one WalletConnect deep link.
 *
 * The URI is encoded ONCE, exactly as Trust Wallet's docs show and as
 * `CoreHelperUtil.formatNativeUrl()` does. Double-encoding produces a pairing
 * URI the wallet cannot parse — which reads as a silent connect failure.
 *
 * @returns {string} '' when either half is missing (never a half-built URL).
 */
export function walletLink(base, uri) {
  const safeBase = walletLinkBase(base);
  const safeUri = String(uri || '').trim();
  if (!safeBase || !safeUri) return '';
  return `${safeBase}wc?uri=${encodeURIComponent(safeUri)}`;
}

/**
 * Both flavours of the deep link for one wallet.
 *
 * `universal` is the https link — the one to prefer, because it is the only
 * form a WebView can navigate to. `native` is kept for contexts that
 * demonstrably handle custom schemes (a system browser on Android/iOS).
 *
 * @returns {{native: string, universal: string, wallet: object}|null}
 */
export function walletDeepLinks(key, uri) {
  const wallet = MOBILE_WALLETS.find((w) => w.key === key || w.id === key);
  if (!wallet) return null;
  return {
    wallet,
    native: walletLink(wallet.native, uri),
    universal: walletLink(wallet.universal, uri)
  };
}

/**
 * The promoted wallets in the shape APPKIT ACTUALLY CONSUMES.
 *
 * `mobile_link` is the field `onConnectMobile()` reads; `link_mode` is the
 * field that makes it also compute an https `redirectUniversalLink`. Without
 * `link_mode` there is no universal link at all, so
 * `experimental_preferUniversalLinks` would have nothing to prefer.
 *
 * Deliberately NOT set: `desktop_link` (it would add a "Desktop" tab that
 * competes with the QR code on desktop) and `webapp_link` (none of these
 * three has a browser-side WalletConnect app).
 */
export function appKitCustomWallets() {
  return MOBILE_WALLETS.map((w) => ({
    id: w.id,
    name: w.name,
    mobile_link: walletLinkBase(w.native),
    link_mode: walletLinkBase(w.universal)
  }));
}

/**
 * The same table in the legacy `qrModalOptions.mobileWallets` shape.
 *
 * `convertWCMToAppKitOptions()` maps this to `customWallets` but keeps only
 * `{ id, name, links }` — and AppKit never reads `links`. It is therefore a
 * belt-and-braces entry only: harmless, and it preserves the old behaviour if
 * the SDK ever reverts to the standalone modal that did understand it. The
 * links that actually ship come from `applyAppKitWalletLinks()`.
 */
export function legacyModalWallets() {
  return MOBILE_WALLETS.map((w) => ({
    id: w.key,
    name: w.name,
    links: { native: w.native, universal: w.universal }
  }));
}
