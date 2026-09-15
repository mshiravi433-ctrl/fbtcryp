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
 * HTML-entity spelling of `&`, in every form an HTML serialization can leave
 * behind. `&amp;` is the one that was actually observed in a user report; the
 * numeric twins are here because a page is free to escape either way.
 */
const ENTITY_AMP = /&(?:amp|#0*38|#x0*26);/gi;

/**
 * Does this look like a WalletConnect v2 pairing URI?
 *
 * Deliberately damage-tolerant: a URI whose `&`s were escaped reads
 * `…&amp;relay-protocol=irn&amp;symKey=…`, so a test that insists on a real
 * `&` before `symKey=` would refuse to look at the very strings that need
 * repairing. Topic and version are checked because they are the only parts a
 * pairing URI can be recognised by when everything else is suspect.
 */
export function looksLikePairingUri(raw) {
  const text = String(raw || '').trim();
  return /^wc:[0-9a-f]{8,}@\d/i.test(text) && /symKey=/i.test(text);
}

/**
 * REPAIR A PAIRING URI WHOSE `&`s WERE HTML-ESCAPED — «Invalid Url: wc:…».
 * ---------------------------------------------------------------------------
 * THE REPORT: connecting to a wallet answers with a bare
 * **`Invalid Url:wc:198a…@2?expiryTimestamp=…&amp;relay-protocol=irn&amp;symKey=…`**
 * — an SDK-generated pairing URI in which every `&` has become `&amp;`.
 *
 * Where does that come from? Not from this app and not from the SDK: measured
 * against the installed `@walletconnect/core`, `pairing.create()` emits
 * `wc:<topic>@2?expiryTimestamp=…&relay-protocol=irn&symKey=…` with plain `&`
 * (the parameter order is alphabetical because `formatUri()` sorts its keys).
 * `&amp;` appears only where a URL has been **serialized into HTML and read
 * back as a string** — an error page printing the URL it refused to load, an
 * `href` copied out of page source, a wallet echoing the URI it was handed.
 * That is exactly the surface a stuck deep link ends up on.
 *
 * AND IT IS FATAL, NOT COSMETIC (measured — test/wc-uri-hygiene-probe.mjs):
 * fed to the SDK's own `pairing.pair()`, the escaped string fails with
 * `Missing or invalid. pair() uri#relay-protocol` — the escaped ampersands glue
 * `amp;relay-protocol` and `amp;symKey` into the previous value, so the relay
 * protocol and the symmetric key both disappear and no pairing can ever be
 * made. The un-escaped twin parses.
 *
 * Repairing is safe by construction: a WC v2 pairing URI's values are hex, a
 * decimal version and a numeric expiry (the SDK percent-encodes anything
 * else), so a literal `&amp;` can never be a legitimate part of one. When
 * there is nothing to repair this returns its input unchanged — a no-op, never
 * a re-encoding.
 */
export function repairPairingUri(raw) {
  const text = String(raw || '').trim();
  if (!text || !looksLikePairingUri(text)) return String(raw || '');
  const repaired = text.replace(ENTITY_AMP, '&');
  return repaired === text ? String(raw || '') : repaired;
}

/**
 * The wallet whose hand-off AppKit is about to perform.
 *
 * `ConnectionControllerUtil.onConnectMobile(wallet)` is the single place the
 * SDK turns a tap into a URL, and lib/wcAppKitPatch.js wraps it — so the
 * moment before a link is built is exactly where the tapped wallet can be
 * recorded, truthfully and without guessing. It is what lets a BARE pairing
 * URI (see `decideWalletOpen`) be completed into the right wallet's https
 * link instead of being handed to a WebView, which can open no wallet at all.
 *
 * Only the public entry of the promoted table is kept: no account data, no
 * pairing URI, nothing that could leak a session.
 */
let tappedWallet = null;

/** Remember the wallet AppKit is handing a pairing to (called by the patch). */
export function rememberTappedWallet(wallet) {
  const known = walletForWalletObject(wallet);
  tappedWallet = known ? known.key : null;
  return tappedWallet;
}

/** The last tapped wallet's table entry, or null. */
export function lastTappedWallet() {
  return tappedWallet ? MOBILE_WALLETS.find((w) => w.key === tappedWallet) ?? null : null;
}

/** Test hook: forget the last tap. */
export function forgetTappedWallet() {
  tappedWallet = null;
}

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
  /*
   * `repairPairingUri` first: a URI that arrived through an HTML surface comes
   * back with `&amp;` where the `&` must be, and encoding THAT would hand the
   * wallet a pairing it can never parse (`pair() uri#relay-protocol` — see the
   * function's own note and test/wc-uri-hygiene-probe.mjs). For every healthy
   * URI this is a byte-for-byte no-op, so the single-encoding contract below
   * is unchanged.
   */
  const safeUri = repairPairingUri(String(uri || '').trim());
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
 * The scheme a URL (or a wallet's native base) registers: `trust://wc?uri=…`
 * and `trust://` both answer `trust`. '' when there is no scheme at all.
 */
export function urlScheme(raw) {
  const m = /^\s*([a-z][a-z0-9+.-]*):/i.exec(String(raw || ''));
  return m ? m[1].toLowerCase() : '';
}

/** The host a URL lives on. '' for a custom-scheme URL and for junk. */
export function urlHost(raw) {
  try {
    return new URL(String(raw)).host.toLowerCase();
  } catch {
    return '';
  }
}

/** The scheme a promoted wallet registers (`trust://` → `trust`). */
export function walletScheme(wallet) {
  return urlScheme(wallet?.native);
}

/** The host a promoted wallet's https link lives on (`link.trustwallet.com`). */
export function walletHost(wallet) {
  return urlHost(wallet?.universal);
}

/**
 * Which promoted wallet does this URL belong to — by custom scheme
 * (`trust://wc?uri=…`) or by https host (`https://link.trustwallet.com/wc?…`)?
 * null when it is not one of ours.
 */
export function walletForUrl(raw) {
  const scheme = urlScheme(raw);
  if (scheme) {
    const byScheme = MOBILE_WALLETS.find((w) => walletScheme(w) === scheme);
    if (byScheme) return byScheme;
  }
  const host = urlHost(raw);
  if (host) {
    const byHost = MOBILE_WALLETS.find((w) => walletHost(w) === host);
    if (byHost) return byHost;
  }
  return null;
}

/**
 * Which promoted wallet is this WALLET OBJECT?
 *
 * Tried in order of trustworthiness: the explorer id (stable, unique), the
 * `mobile_link` scheme (what the SDK actually builds the link from), then the
 * display name (the only thing a hand-made `customWallets` entry is guaranteed
 * to carry).
 */
export function walletForWalletObject(wallet) {
  if (!wallet || typeof wallet !== 'object') return null;
  if (wallet.id) {
    const byId = MOBILE_WALLETS.find((w) => w.id === wallet.id);
    if (byId) return byId;
  }
  const scheme = urlScheme(wallet.mobile_link);
  if (scheme) {
    const byScheme = MOBILE_WALLETS.find((w) => walletScheme(w) === scheme);
    if (byScheme) return byScheme;
  }
  if (wallet.name) {
    const name = String(wallet.name).trim().toLowerCase();
    const byName = MOBILE_WALLETS.find((w) => w.name.toLowerCase() === name);
    if (byName) return byName;
  }
  return null;
}

/**
 * Give an AppKit wallet object the https `link_mode` the explorer response
 * does not carry for these wallets.
 *
 * ─── WHY THIS IS THE BUG, MEASURED ─────────────────────────────────────────
 * The wallet the user taps on a phone is NOT our `customWallets` entry — the
 * ethereum-provider runs the modal in `basic` mode, so the mobile screen is
 * AppKit's own explorer list (`w3m-all-wallets-list` → `ApiController.state`).
 * Fetched live with THIS project's id:
 *
 *   GET https://api.web3modal.org/getWallets?projectId=8e36ecca…&sv=html-core-1.8.19
 *     Trust Wallet → { "mobile_link": "trust://",    "link_mode": null }
 *     MetaMask     → { "mobile_link": "metamask://", "link_mode": null }
 *
 * `link_mode: null` makes `CoreHelperUtil.formatNativeUrl()` return
 * `redirectUniversalLink: undefined`, so
 * `experimental_preferUniversalLinks` has nothing to prefer and AppKit opens
 * the CUSTOM SCHEME — which a WebView cannot navigate to. Adding the https
 * base here is what makes the SDK's own link the one that works everywhere.
 *
 * Returns the SAME object when there is nothing to add: AppKit keeps these
 * objects in its recent-wallet list and re-renders lists on identity change,
 * so a pointless copy is churn (and a re-render mid-tap).
 */
export function withLinkMode(wallet) {
  if (!wallet || typeof wallet !== 'object' || wallet.link_mode) return wallet;
  const known = walletForWalletObject(wallet);
  if (!known) return wallet;
  return { ...wallet, link_mode: walletLinkBase(known.universal) };
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
