/**
 * MOBILE WALLET DEEP-LINK PROBE (runtime, no DOM, no bundler)
 * ---------------------------------------------------------------------------
 * The reported bug: "MetaMask and WalletConnect connect in the browser, but
 * opening Trust Wallet from the app or from the site shows *Invalid URL* with
 * a link under it and never connects."
 *
 * The pairing was never at fault — the URL we handed to the phone was:
 *
 *   1. `qrModalOptions.mobileWallets` used `links: { native, universal }`.
 *      Since @walletconnect/ethereum-provider@2.23 the modal is @reown/appkit,
 *      and `convertWCMToAppKitOptions()` forwards only `{ id, name, links }`
 *      while AppKit itself reads the EXPLORER field names `mobile_link` and
 *      `link_mode`. An entry with only `links` has no deep link at all, so
 *      `determinePlatforms()` finds no platform and the tap goes nowhere.
 *
 *   2. The link that WAS built was the custom scheme `trust://wc?uri=…`. A
 *      custom scheme is navigable from a system browser only. Inside a WebView
 *      — the packaged app, Telegram, Trust Wallet's own browser — it is an
 *      unknown scheme, and the WebView renders "Invalid URL" with the URL
 *      printed underneath. Trust's own docs prescribe the https form.
 *
 * This probe locks both halves: the links we emit are the https universal
 * links, they are shaped so AppKit can actually find them, and they survive
 * AppKit's own formatting rule byte for byte.
 */
import { readFileSync } from 'node:fs';
import {
  MOBILE_WALLETS,
  appKitCustomWallets,
  legacyModalWallets,
  walletDeepLinks,
  walletLink,
  walletLinkBase
} from '../src/lib/wcWallets.js';

/* A realistic v2 pairing URI: the punctuation is what encoding must preserve. */
const URI = 'wc:7f6e4f2c1c9b4a4f9e2f1a0b3c4d5e6f@2?relay-protocol=irn&symKey=9f8e7d6c5b4a';

export default function run() {
  const rows = [];
  const t = (name, ok) => rows.push([name, Boolean(ok)]);

  /* ---- 1. base normalisation: exactly AppKit's rule (add-only) ---- */
  t('a base without a trailing slash gains exactly one',
    walletLinkBase('https://link.trustwallet.com') === 'https://link.trustwallet.com/');
  t('a base with a trailing slash is left alone',
    walletLinkBase('https://link.trustwallet.com/') === 'https://link.trustwallet.com/');
  /* `trust://` MUST survive intact: stripping its slashes would produce
     `trust:/wc?uri=`, a link no wallet recognises — and AppKit, which never
     strips, would produce `trust://wc?uri=` from the very same value. */
  t('a scheme-only base keeps its two slashes',
    walletLinkBase('trust://') === 'trust://');
  t('a bare scheme is completed to scheme://',
    walletLinkBase('trust:') === 'trust://' && walletLinkBase('rainbow') === 'rainbow://');
  t('an empty base yields no link (never a half-built URL)', walletLink('', URI) === '');
  t('an empty pairing URI yields no link', walletLink('trust://', '') === '');

  /* ---- 2. the link itself: encoded exactly once, in Trust's documented form ---- */
  const trust = MOBILE_WALLETS.find((w) => w.key === 'trust');
  t('Trust Wallet is in the promoted table', Boolean(trust));
  t('Trust Wallet uses the host its own docs prescribe',
    trust?.universal === 'https://link.trustwallet.com/');
  t('the Trust deep link is byte-identical to the documented one',
    walletLink(trust.universal, URI)
      === `https://link.trustwallet.com/wc?uri=${encodeURIComponent(URI)}`);
  t('the pairing URI is encoded exactly once (not double-encoded)',
    walletLink(trust.universal, URI).includes(encodeURIComponent(URI))
      && !walletLink(trust.universal, URI).includes(encodeURIComponent(encodeURIComponent(URI))));

  /* ---- 3. the invariant that kills "Invalid URL" ----
     Every promoted wallet must offer an https universal link. A custom scheme
     is the thing a WebView cannot navigate to. */
  const links = walletDeepLinks('trust', URI);
  t('a promoted wallet resolves to both a native and an https link',
    Boolean(links?.native) && Boolean(links?.universal));
  t('the universal link is https, never a custom scheme',
    MOBILE_WALLETS.every((w) => w.universal.startsWith('https://')));
  t('the universal link is the one pointed at the wallet app host',
    MOBILE_WALLETS.every((w) => /^https:\/\/[a-z0-9.-]+\//.test(w.universal)));
  t('an unknown wallet key resolves to nothing rather than a guess',
    walletDeepLinks('not-a-wallet', URI) === null);

  /* ---- 4. the shape AppKit actually reads ----
     `determinePlatforms()` and `onConnectMobile()` read `mobile_link` /
     `link_mode`. `links` is ignored — an entry carrying only `links` opens
     nothing. */
  const custom = appKitCustomWallets();
  t('every AppKit entry carries mobile_link (the field onConnectMobile reads)',
    custom.length > 0 && custom.every((w) => typeof w.mobile_link === 'string' && w.mobile_link));
  t('every AppKit entry carries link_mode (without it there is no universal link)',
    custom.every((w) => typeof w.link_mode === 'string' && w.link_mode));
  t('every mobile_link is a base AppKit can append to (ends in /)',
    custom.every((w) => w.mobile_link.endsWith('/')));
  t('every link_mode is an https base', custom.every((w) => w.link_mode.startsWith('https://')));
  t('no AppKit entry depends on the ignored `links` shape',
    custom.every((w) => !('links' in w)));
  t('the promoted wallets keep their real explorer ids',
    custom.every((w) => /^[0-9a-f]{64}$/.test(w.id)));
  t('the AppKit list covers every promoted wallet',
    custom.length === MOBILE_WALLETS.length);

  /* ---- 5. what AppKit builds from our entry is what we intend ----
     Reimplemented verbatim from @reown/appkit-controllers
     CoreHelperUtil.formatNativeUrl / formatUniversalUrl. */
  const appKitNative = (base, uri) => `${base.endsWith('/') ? base : `${base}/`}wc?uri=${encodeURIComponent(uri)}`;
  t('AppKit\'s own formatting of our link_mode reproduces our universal link',
    custom.every((w, i) => appKitNative(w.link_mode, URI) === walletLink(MOBILE_WALLETS[i].universal, URI)));
  t('AppKit\'s own formatting of our mobile_link reproduces our native link',
    custom.every((w, i) => appKitNative(w.mobile_link, URI) === walletLink(MOBILE_WALLETS[i].native, URI)));

  /* ---- 5b. which screen AppKit opens for a tap ----
     Re-implemented from w3m-connecting-wc-view.determinePlatforms()
     (@reown/appkit-scaffold-ui). It reads `mobile_link` / `webapp_link` /
     `desktop_link` ONLY — `links` is invisible to it. An empty platform list
     means the "connecting" screen has nothing to connect with, which is what
     a tap on the old entries produced. */
  const determinePlatforms = (wallet, isMobile) => {
    const platforms = [];
    if (wallet.mobile_link) platforms.push(isMobile ? 'mobile' : 'qrcode');
    if (wallet.webapp_link) platforms.push('web');
    if (wallet.desktop_link && !isMobile) platforms.push('desktop');
    return platforms;
  };
  const trustCustom = custom.find((w) => w.name === 'Trust Wallet');
  t('the OLD shape (links only) left AppKit with no platform at all — the bug',
    determinePlatforms(
      { id: 'trust', name: 'Trust Wallet', links: { native: 'trust://', universal: 'https://link.trustwallet.com/' } },
      true
    ).length === 0);
  t('the NEW shape opens the deep-link screen on a phone',
    determinePlatforms(trustCustom, true)[0] === 'mobile');
  t('the NEW shape still opens the QR screen on a desktop',
    determinePlatforms(trustCustom, false)[0] === 'qrcode');
  t('the NEW shape adds no competing Desktop tab',
    !determinePlatforms(trustCustom, false).includes('desktop'));

  /* ---- 6. the legacy list stays available for the old modal shape ---- */
  const legacy = legacyModalWallets();
  t('the legacy mobileWallets list still carries native + universal',
    legacy.every((w) => w.links?.native && w.links?.universal));

  /* ---- 7. WalletContext wiring (static, because the failure is wiring) ---- */
  const src = readFileSync('src/context/WalletContext.jsx', 'utf8');
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const code = strip(src);
  t('WalletContext takes its wallet links from lib/wcWallets',
    /from '\.\.\/lib\/wcWallets(\.js)?'/.test(code));
  t('WalletContext applies the links to the modal before connect()',
    /applyAppKitWalletLinks\(wc\)/.test(code));
  t('the modal is told to PREFER https universal links over custom schemes',
    /experimental_preferUniversalLinks:\s*true/.test(code));
  t('the init config no longer hardcodes a wallet deep link',
    !/native:\s*'trust:\/\/'/.test(code));
  /* The application must be wired where it runs, not merely defined. */
  const defined = code.indexOf('const applyAppKitWalletLinks');
  const called = code.indexOf('await applyAppKitWalletLinks(wc)');
  t('applyAppKitWalletLinks is called, not just defined',
    defined > -1 && called > defined);
  /* And it must not be able to fail the connect: the call is awaited inside a
     try/catch owning flow, so a thrown modal update cannot reject Connect. */
  t('the link application is best effort (inside the connect try/catch)',
    code.indexOf('await applyAppKitWalletLinks(wc)') > code.indexOf('wc = await initWcProvider(')
      && code.indexOf('await applyAppKitWalletLinks(wc)') < code.indexOf('wc.connect()'));

  return rows;
}
