import { DEEPLINK_CHOICE_KEY } from './storage.js';
import { repairPairingUri } from './uri.js';

/**
 * MOBILE WALLET REGISTRY
 * ---------------------------------------------------------------------------
 * One authoritative table for every wallet this app promotes: native scheme,
 * HTTPS fallback, Android package and Explorer identity.
 *
 * NATIVE IS PRIMARY. An HTTPS universal link goes through a redirector, and a
 * redirector that drops `uri=wc:…` produces the single worst symptom in this
 * whole flow — the wallet opens on its home screen and nothing asks to connect.
 * The universal form stays as the fallback for restricted channels (Telegram
 * can only carry https) and for the "not installed" case.
 *
 * Everything here is pure data and pure functions, so the URL the phone
 * receives can be asserted byte-for-byte without a browser.
 */

/** Promoted wallets, in display order. */
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
    native: 'trust://',
    universal: 'https://link.trustwallet.com/',
    androidPackage: 'com.wallet.crypto.trustapp',
    imageId: '7677b54f-3486-46e2-4e37-bf8747814f00',
    homepage: 'https://trustwallet.com/'
  },
  {
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

const EXPLORER_LOGO_BASE = 'https://explorer-api.walletconnect.com/v3/logo/sm';

/**
 * The brand logo AppKit and our pairing sheet render.
 *
 * `projectId` is public by design (the SDK ships it in every request), but it
 * is passed in rather than duplicated: two copies of the id is how a dashboard
 * rotation silently breaks every wallet icon.
 *
 * @returns {string} '' when there is no id to ask with, so the field is
 *   omitted and the renderer draws its own glyph instead of a broken image.
 */
export function walletLogo(imageId, projectId) {
  const id = String(imageId || '').trim();
  const pid = String(projectId || '').trim();
  if (!id || !pid) return '';
  return `${EXPLORER_LOGO_BASE}/${id}?projectId=${pid}`;
}

/** The scheme a URL registers: `trust://wc?uri=…` → `trust`. '' when none. */
export function urlScheme(raw) {
  const m = /^\s*([a-z][a-z0-9+.-]*):/i.exec(String(raw ?? ''));
  return m ? m[1].toLowerCase() : '';
}

/** The host of an https URL. '' for custom schemes and for junk. */
export function urlHost(raw) {
  try {
    return new URL(String(raw)).host.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Normalise a deep-link base the way AppKit does.
 *
 * Mirrors `CoreHelperUtil.formatNativeUrl()` line for line, because AppKit
 * appends `wc?uri=` to whatever we hand it as `mobile_link` / `link_mode`:
 *
 *   - a bare scheme (`trust:`, `rainbow`) is completed to `trust://`;
 *   - a base that does not end in `/` gains one;
 *   - a base that already ends in `/` is LEFT ALONE.
 *
 * That last rule is the important one. Stripping the trailing slash would turn
 * `trust://` into `trust:/wc?uri=` — a link no wallet recognises — while
 * AppKit, which never strips, would produce `trust://wc?uri=` from the same
 * value. Two rules for one link is how "works on one platform only" bugs are
 * born, so there is one rule.
 */
export function linkBase(base) {
  const raw = String(base ?? '').trim();
  if (!raw) return '';
  let safe = raw;
  if (!safe.includes('://')) safe = `${safe.replaceAll('/', '').replaceAll(':', '')}://`;
  return safe.endsWith('/') ? safe : `${safe}/`;
}

/**
 * Build one WalletConnect deep link: `<base>wc?uri=<encoded uri>`.
 *
 * The URI is repaired first and encoded EXACTLY ONCE, as Trust's documented
 * form and `CoreHelperUtil.formatNativeUrl()` both do. Double-encoding hands
 * the wallet a pairing it cannot parse, which reads as a silent failure.
 *
 * @returns {string} '' when either half is missing — never a half-built URL.
 */
export function walletLink(base, uri, { repair = repairPairingUri } = {}) {
  const safeBase = linkBase(base);
  const safeUri = repair(String(uri ?? '').trim());
  if (!safeBase || !safeUri) return '';
  return `${safeBase}wc?uri=${encodeURIComponent(safeUri)}`;
}

/** Both flavours of the hand-off link for one wallet. */
export function walletLinks(wallet, uri) {
  if (!wallet || !uri) return { native: '', universal: '' };
  return {
    native: walletLink(wallet.native, uri),
    universal: walletLink(wallet.universal, uri)
  };
}

/**
 * Android Chrome's documented app-launch form.
 *
 * `intent://` is the only shape that routes reliably across OEM Chrome builds:
 * it names the package, so a second app that registered the same custom scheme
 * cannot swallow the hand-off, and `S.browser_fallback_url` returns the user
 * somewhere useful (the wallet's universal link → Play Store) instead of a
 * dead-end "cannot open" error when the app is not installed.
 *
 * The resolved URI is `<scheme>://wc?uri=…`, i.e. exactly what the native link
 * would have been.
 */
export function androidIntentLink(wallet, uri, fallbackUrl) {
  const scheme = urlScheme(wallet?.native);
  const safeUri = repairPairingUri(uri);
  if (!scheme || !safeUri || !wallet?.androidPackage) return '';
  const host = `wc?uri=${encodeURIComponent(safeUri)}`;
  const parts = [
    `intent://${host}`,
    '#Intent',
    `scheme=${scheme}`,
    `package=${wallet.androidPackage}`,
    `S.browser_fallback_url=${encodeURIComponent(String(fallbackUrl || ''))}`,
    'end'
  ];
  return parts.join(';');
}

/** Look a promoted wallet up by key or by Explorer id. */
export function walletByKey(keyOrId) {
  if (!keyOrId) return null;
  return MOBILE_WALLETS.find((w) => w.key === keyOrId || w.id === keyOrId) ?? null;
}

/** Which promoted wallet does this URL belong to — by scheme or by host? */
export function walletForUrl(raw) {
  const scheme = urlScheme(raw);
  if (scheme && scheme !== 'http' && scheme !== 'https') {
    const byScheme = MOBILE_WALLETS.find((w) => urlScheme(w.native) === scheme);
    if (byScheme) return byScheme;
  }
  const host = urlHost(raw);
  if (host) {
    const byHost = MOBILE_WALLETS.find((w) => urlHost(w.universal) === host);
    if (byHost) return byHost;
  }
  return null;
}

/**
 * Which promoted wallet is this WALLET OBJECT (an Explorer row, a
 * `customWallets` entry, or the object AppKit hands `onConnectMobile`)?
 *
 * Tried in order of trustworthiness: the Explorer id (stable and unique), the
 * `mobile_link` scheme (what the SDK actually builds the link from), then the
 * display name (the only thing a hand-made entry is guaranteed to carry).
 */
export function walletForObject(wallet) {
  if (!wallet || typeof wallet !== 'object') return null;
  const byId = walletByKey(wallet.id);
  if (byId) return byId;
  const scheme = urlScheme(wallet.mobile_link);
  if (scheme) {
    const byScheme = MOBILE_WALLETS.find((w) => urlScheme(w.native) === scheme);
    if (byScheme) return byScheme;
  }
  if (wallet.name) {
    const name = String(wallet.name).trim().toLowerCase();
    const byName = MOBILE_WALLETS.find((w) => w.name.toLowerCase() === name);
    if (byName) return byName;
  }
  return null;
}

/* ── the tapped wallet ─────────────────────────────────────────────────────
 * `ConnectionControllerUtil.onConnectMobile(wallet)` is the one place the SDK
 * turns a tap into a URL, and appkit.js wraps it — so the moment before a link
 * is built is exactly where the tapped wallet can be recorded truthfully. It is
 * what lets a BARE `wc:` URI be completed into the right wallet's link instead
 * of being handed to a WebView, which can open no wallet at all.
 *
 * Only the registry entry is kept: no account data, no URI, nothing a support
 * screenshot could leak.
 */
let tappedWallet = null;

export function rememberTappedWallet(wallet) {
  const known = walletForObject(wallet);
  tappedWallet = known ? known.key : null;
  return tappedWallet;
}

export function lastTappedWallet() {
  return tappedWallet ? walletByKey(tappedWallet) : null;
}

export function forgetTappedWallet() {
  tappedWallet = null;
}

/**
 * WHICH WALLET THE SESSION ON THIS DEVICE BELONGS TO.
 *
 * A signing nudge needs to know where to knock, and there is no in-memory
 * answer after a reload: the pairing is long gone by then. Two records on disk
 * say it — AppKit's `@appkit/recent_wallet` (the wallet object the user tapped,
 * kept for exactly this purpose) and the SDK's own
 * `WALLETCONNECT_DEEPLINK_CHOICE` (the `{ name, href }` it wrote when it last
 * handed a URI to an app).
 *
 * Both are matched against the REGISTRY, never trusted as-is: a stored string
 * is a hint, and opening `window.open(href)` on the strength of a localStorage
 * value is how a dApp comes to launch an arbitrary scheme. An entry that names
 * no promoted wallet resolves to null, and a nudge that cannot name a wallet
 * simply does not happen.
 */
export function rememberedMobileWallet({ storage } = {}) {
  const target = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!target) return null;
  const read = (key) => {
    try {
      const raw = target.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };
  const fromAppKit = read('@appkit/recent_wallet');
  const byAppKit = walletForObject(fromAppKit);
  if (byAppKit) return byAppKit;

  const choice = read(DEEPLINK_CHOICE_KEY);
  const byHref = walletForUrl(choice?.href);
  if (byHref) return byHref;
  const named = walletForObject({ name: choice?.name });
  if (named) return named;
  return null;
}

/**
 * The promoted wallets in the shape APPKIT ACTUALLY CONSUMES.
 *
 * `mobile_link` is what `onConnectMobile()` reads; `link_mode` is what makes it
 * also compute an https `redirectUniversalLink` — without `link_mode` there is
 * no universal link at all, so `experimental_preferUniversalLinks` would have
 * nothing to prefer. Deliberately absent: `desktop_link` (it adds a "Desktop"
 * tab that competes with the QR on desktop) and `webapp_link` (none of these
 * wallets has a browser-side WalletConnect app).
 */
export function appKitCustomWallets(projectId) {
  return MOBILE_WALLETS.map((w) => {
    const image = walletLogo(w.imageId, projectId);
    return {
      id: w.id,
      name: w.name,
      mobile_link: linkBase(w.native),
      link_mode: linkBase(w.universal),
      ...(image ? { image_url: image } : {}),
      ...(w.homepage ? { homepage: w.homepage } : {})
    };
  });
}

/**
 * The same table in the legacy `qrModalOptions.mobileWallets` shape.
 *
 * `convertWCMToAppKitOptions()` maps this to `customWallets` but keeps only
 * `{ id, name, links }`, and AppKit never reads `links` — so on its own this
 * list can open no wallet. It is belt-and-braces: harmless today, and it
 * preserves the old behaviour if the SDK ever reverts to the standalone modal
 * that understood it. The links that actually ship are applied by
 * appkit.js's `applyWalletSurface()` after init().
 */
export function legacyModalWallets() {
  return MOBILE_WALLETS.map((w) => ({
    id: w.key,
    name: w.name,
    links: { native: w.native, universal: w.universal }
  }));
}
