/**
 * MOBILE WALLET HAND-OFF REGISTRY (WalletConnect v2)
 * ---------------------------------------------------------------------------
 * One authoritative table for the native scheme, universal fallback, Explorer
 * identity and Android package of every wallet promoted by this app.
 *
 * Native deep links are primary. An HTTPS app/universal link may open the
 * correct application after a redirector drops `uri=wc:…`, which produces a
 * wallet home screen with no connection proposal. The universal form remains
 * necessary for Telegram and install/fallback UX; packaged Android instead
 * receives the raw pairing URI through a package-scoped ACTION_VIEW intent.
 *
 * URL building is pure and encodes the repaired pairing URI exactly once. See
 * test/wc-wallets-probe.mjs and test/wc-deeplink-probe.mjs.
 */

/**
 * Promoted wallets in display order. IDs, mobile link bases and image IDs come
 * from their live Reown Explorer records. `androidPackage` is fixed alongside
 * the native scheme so the APK can never turn web content into a generic
 * package/intent launcher.
 */
export const MOBILE_WALLETS = Object.freeze([
  {
    key: 'metamask',
    id: 'c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96',
    name: 'MetaMask',
    native: 'metamask://',
    universal: 'https://metamask.app.link/',
    androidPackage: 'io.metamask',
    imageId: 'eebe4a7f-7166-402f-92e0-1f64ca2aa800',
    homepage: 'https://metamask.io/'
  },
  {
    key: 'trust',
    id: '4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0',
    name: 'Trust Wallet',
    /* Trust documents this native route for installed-wallet campaigns. */
    native: 'trust://',
    /* From Trust Wallet's developer docs ("Mobile (WalletConnect)"), the
       documented deep link is exactly this host + `/wc?uri=`. */
    universal: 'https://link.trustwallet.com/',
    androidPackage: 'com.wallet.crypto.trustapp',
    imageId: '7677b54f-3486-46e2-4e37-bf8747814f00',
    homepage: 'https://trustwallet.com/'
  },
  {
    /*
     * UNISWAP'S EXPLORER RECORD IS NOT ENOUGH ON ANDROID.
     *
     * The record advertises both `uniswap://` and `https://uniswap.org/app`,
     * but the https hop may open the application after dropping the `uri`
     * payload — exactly the reported "the app opens and nothing asks to
     * connect" symptom. The wallet's current open-source mobile app declares
     * and parses the native form below verbatim:
     *
     *   UNISWAP_URL_SCHEME_WALLETCONNECT_AS_PARAM = 'uniswap://wc?uri='
     *
     * Keep both bases for Telegram/iOS fallback, but prefer the native route
     * where the platform can launch it directly. In the packaged Android app
     * the Java bridge sends the raw `wc:` URI to this exact package, avoiding
     * both the browser redirect and proprietary URL parser entirely.
     */
    key: 'uniswap',
    id: 'c03dfee351b6fcc421b4494ea33b9d4b92a984f87aa76d1663bb28705e95034a',
    name: 'Uniswap Wallet',
    native: 'uniswap://',
    universal: 'https://uniswap.org/app/',
    androidPackage: 'com.uniswap.mobile',
    imageId: 'bff9cf1f-df19-42ce-f62a-87f04df13c00',
    homepage: 'https://uniswap.org/'
  },
  {
    /*
     * THE ALTERNATIVE THAT IS ASKED FOR («الترناتیو که مثل تراست والت باشه»).
     *
     * SafePal is promoted alongside Trust because it answers the same report
     * with a different set of moving parts: it is a mobile-first WalletConnect
     * v2 wallet, its explorer listing carries BOTH a scheme
     * (`safepalwallet://`) and an https `link_mode` (`https://link.safepal.io`,
     * read from the live API), and — the part that matters when Trust itself
     * refuses a hand-off — it resolves the `wc?uri=` path on its own universal
     * host, verified by requesting
     * `https://link.safepal.io/wc?uri=wc%3A…` and watching it carry the
     * pairing through to `safepal.com/en/download?fromlink=1&p=/wc&uri=wc%3A…`
     * (i.e. the payload survives the redirect, so Android App Links can still
     * hand it to the installed app).
     *
     * A fourth entry also fixes a structural weakness: with three promoted
     * wallets, one broken hand-off took out a third of the surface. With four
     * independent wallets — two of which (SafePal, Rainbow) share no
     * infrastructure with Trust — a user whose Trust hand-off fails still has
     * a working path in the same modal, without leaving the sheet.
     */
    key: 'safepal',
    id: '0b415a746fb9ee99cce155c2ceca0c6f6061b1dbca2d722b3ba16381d0562150',
    name: 'SafePal',
    native: 'safepalwallet://',
    universal: 'https://link.safepal.io/',
    androidPackage: 'io.safepal.wallet',
    imageId: '252753e7-b783-4e03-7f77-d39864530900',
    homepage: 'https://safepal.com/'
  },
  {
    key: 'rainbow',
    id: '1ae92b26df02f0abca6304df07debccd18262fdf5fe82daa81593582dac9a369',
    name: 'Rainbow',
    native: 'rainbow://',
    universal: 'https://rnbwapp.com/',
    androidPackage: 'me.rainbow',
    imageId: '7a33d7f1-3d12-4b5c-f3ee-5cd83cb1b500',
    homepage: 'https://rainbow.me/'
  }
]);

/**
 * The explorer's logo CDN. `projectId` is a public client-side identifier (the
 * SDK ships it in every request), so building the URL here leaks nothing — but
 * it must be passed in rather than duplicated: two copies of the project id is
 * how a dashboard rotation silently breaks every wallet icon.
 */
const EXPLORER_LOGO_BASE = 'https://explorer-api.walletconnect.com/v3/logo/sm';

/**
 * The brand logo AppKit should render for a promoted wallet — '' when there is
 * no project id to ask for it with, in which case the field is omitted and
 * AppKit draws its own placeholder rather than a broken image.
 */
export function walletLogo(imageId, projectId) {
  const id = String(imageId || '').trim();
  const pid = String(projectId || '').trim();
  if (!id || !pid) return '';
  return `${EXPLORER_LOGO_BASE}/${encodeURIComponent(id)}?projectId=${encodeURIComponent(pid)}`;
}

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
 * `native` is the payload-preserving primary route. `universal` is the HTTPS
 * fallback for restricted channels such as Telegram.
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
 * Fill AppKit's optional HTTPS fallback for Explorer rows that omit link_mode.
 * This does NOT select it: WalletContext keeps preferUniversalLinks false. The
 * wrapper also gives restricted channels a known fallback without mutating the
 * Explorer/recent-wallet object in place.
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
export function appKitCustomWallets(projectId) {
  return MOBILE_WALLETS.map((w) => {
    const image = walletLogo(w.imageId, projectId);
    return {
      id: w.id,
      name: w.name,
      mobile_link: walletLinkBase(w.native),
      link_mode: walletLinkBase(w.universal),
      /* AppKit's wallet list renders `image_url` when it is present and falls
         back to a generic glyph when it is not. Omitted (not '') when there
         is no project id, so the fallback is a placeholder and never a
         request to `/logo/sm/?projectId=`. */
      ...(image ? { image_url: image } : {}),
      /* `homepage` is what AppKit links from the wallet's own row ("Don't have
         X? Get it here"), and it is also the field `WalletUtil` uses when it
         decides two entries are the same wallet. */
      ...(w.homepage ? { homepage: w.homepage } : {})
    };
  });
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
