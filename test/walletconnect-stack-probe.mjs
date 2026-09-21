/**
 * WALLETCONNECT STACK PROBE
 * ---------------------------------------------------------------------------
 * One suite for the whole wallet-connect stack (src/lib/wc/), against the real
 * source with only the external boundary faked: sockets, fetch, storage,
 * window and the AppKit modal object. No network, no browser, no bundler.
 *
 * The failures locked here are the ones that actually happened, and each check
 * names the report it came from, because a stack this size accumulates guard
 * tests nobody can justify any more.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';

import {
  MOBILE_WALLETS,
  PAIRING_TTL_MS,
  TIMEOUT,
  androidIntentLink,
  appKitCustomWallets,
  cancelSwitch,
  chainFromSession,
  classifyConnectError,
  collectWalletHealth,
  decideWalletOpen,
  handOffChannel,
  handoffFacts,
  hasStoredSession,
  installWalletOpenBridge,
  isConnectionKey,
  isModalError,
  isOriginAllowed,
  isPairingUri,
  isRelayBlocked,
  isRelayError,
  listEmbeddedWalletKeys,
  pauseBound,
  sleep,
  linkBase,
  looksLikePairingUri,
  openWalletHandoff,
  openWalletLink,
  pairingUriFromLink,
  parseChainId,
  purgeConnectionKeys,
  purgeEmbeddedWalletKeys,
  repairPairingInLink,
  repairPairingUri,
  storageFacts,
  WALLET_LEASE_KEY,
  WALLET_RESTORE_BACKOFF,
  clearWalletLease,
  readWalletLease,
  walletRestoreDelay,
  walletRestorePlan,
  writeWalletLease,
  uriRoundTrips,
  walletByKey,
  walletForUrl,
  walletIdentityFacts,
  walletIdentityUrl,
  walletLink,
  walletLinks,
  walletLogo,
  wcMetadata,
  withTimeout
} from '../src/lib/wc/index.js';
import { createWcSession, wakeWcTransport } from '../src/lib/wc/session.js';
import { measureRelay, probeRelay, relayOrderFromHosts, relayVerdict } from '../src/lib/wc/relay.js';
import {
  TRACE_STORAGE_KEY,
  reviveEntry,
  wcEvent,
  wcEventDetail,
  wcTraceHydrate,
  wcTracePersist,
  wcTraceReset,
  wcTraceSnapshot
} from '../src/lib/wc/trace.js';
import { DEFAULT_CHAIN, EVM_CHAINS } from '../src/lib/chains.js';
import {
  SIGN_ERRORS,
  classifySignError,
  guardEip1193,
  preflightSignRequest,
  sessionCoverage
} from '../src/lib/wc/signing.js';
import {
  buildSnapshot,
  clearPortfolioSnapshot,
  readPortfolioSnapshot,
  slimChain,
  writePortfolioSnapshot
} from '../src/lib/portfolioSnapshot.js';

/* A realistic v2 pairing URI: the punctuation is what encoding must preserve. */
const URI = 'wc:7f6e4f2c1c9b4a4f9e2f1a0b3c4d5e6f@2?relay-protocol=irn&symKey=9f8e7d6c5b4a';
const FULL_URI = `wc:${'a'.repeat(64)}@2?expiryTimestamp=1780000000&relay-protocol=irn&symKey=${'b'.repeat(64)}`;

/* The slowest relay handshake measured on a REAL device — 2026-09-17, Samsung
   Internet 30 / Android 10, mobile data: `wss://relay.walletconnect.org` opened
   in 4344ms while plain HTTPS to the SAME host answered in 220ms, i.e. the cost
   is the wss handshake and not the network. TIMEOUT.relayProbe exists to be
   larger than this number; the assertion in §6 keeps it that way. */
const MEASURED_RELAY_OPEN_MS = 4_344;

/** A Storage-shaped view over a Map — the boundary every purge probe fakes. */
function fakeStorage(store) {
  return {
    get length() { return store.size; },
    key: (i) => Array.from(store.keys())[i] ?? null,
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    removeItem: (k) => store.delete(k),
    setItem: (k, v) => store.set(k, v)
  };
}

export default async function run() {
  const rows = [];
  const t = (name, ok) => rows.push([name, Boolean(ok)]);

  /* ══════════════════ 1. pairing-URI hygiene («Invalid Url: wc:…&amp;…») ══ */
  {
    t('a healthy pairing URI is recognised', isPairingUri(FULL_URI));
    t('an escaped URI is RECOGNISED as one needing repair (not rejected)',
      looksLikePairingUri(FULL_URI.replace(/&/g, '&amp;')));
    t('an escaped URI is rejected by the strict form', !isPairingUri(FULL_URI.replace(/&/g, '&amp;')));
    /* Fed to pair() the escaped form dies with "Missing or invalid. pair()
       uri#relay-protocol": `amp;relay-protocol` is glued to the previous value. */
    t('repairing restores the byte-exact URI', repairPairingUri(FULL_URI.replace(/&/g, '&amp;')) === FULL_URI);
    t('repairing a healthy URI is a no-op', repairPairingUri(FULL_URI) === FULL_URI);
    t('a non-URI is returned untouched', repairPairingUri('https://fbtswap.ir') === 'https://fbtswap.ir');
    t('a pairing URI survives one encode/decode round trip', uriRoundTrips(URI));
    t('a double-encoded URI does NOT round trip', !uriRoundTrips(encodeURIComponent(URI)));

    const link = walletLink('trust://', URI);
    t('the payload inside a link decodes back to the URI', pairingUriFromLink(link) === URI);
    /* Telegram-Android decodes once in transit, so the SDK encodes twice there. */
    const double = walletLink('trust://', encodeURIComponent(URI));
    t('a double-encoded payload still decodes after four passes', pairingUriFromLink(double) === URI);
    t('a link with no uri= parameter carries nothing', pairingUriFromLink('trust://wc?foo=1') === '');
    const escapedLink = `trust://wc?uri=${encodeURIComponent(URI.replace(/&/g, '&amp;'))}`;
    t('an escaped payload inside a link is repaired in place',
      pairingUriFromLink(repairPairingInLink(escapedLink)) === URI);
  }

  /* ══════════════════ 2. wallet registry & the last metre ═════════════════ */
  {
    t('a base without a trailing slash gains exactly one',
      linkBase('https://link.trustwallet.com') === 'https://link.trustwallet.com/');
    t('a base with a trailing slash is left alone',
      linkBase('https://link.trustwallet.com/') === 'https://link.trustwallet.com/');
    /* Stripping would produce `trust:/wc?uri=`, which no wallet recognises —
       and AppKit, which never strips, would not. */
    t('a scheme-only base keeps its two slashes', linkBase('trust://') === 'trust://');
    t('a bare scheme is completed to scheme://', linkBase('trust:') === 'trust://');
    t('a bare name is completed to name://', linkBase('rainbow') === 'rainbow://');
    t('an empty base yields no link (never a half-built URL)', walletLink('', URI) === '');
    t('an empty pairing URI yields no link', walletLink('trust://', '') === '');
    t('the link encodes the payload exactly once', walletLink('trust://', URI).includes(encodeURIComponent(URI)));

    const trust = walletByKey('trust');
    const links = walletLinks(trust, URI);
    t('native is the payload-preserving primary', links.native.startsWith('trust://wc?uri='));
    t('universal stays available for restricted channels', links.universal.startsWith('https://link.trustwallet.com/wc?uri='));
    t('every promoted wallet has a native scheme, a universal link and a package',
      MOBILE_WALLETS.every((w) => w.native && w.universal && w.androidPackage));
    t('the registry is recognised back from its own links',
      walletForUrl(links.native) === trust && walletForUrl(links.universal) === trust);
    t('an unknown URL belongs to no promoted wallet', walletForUrl('https://example.com/wc?uri=x') === null);

    /* Chrome's documented launch form: names the package, so another app that
       registered the same scheme cannot swallow the tap, and the fallback URL
       returns the user somewhere useful instead of a dead intent error. */
    const intent = androidIntentLink(trust, URI, links.universal);
    t('the Android intent names the scheme and the package',
      intent.includes('scheme=trust;') && intent.includes('package=com.wallet.crypto.trustapp'));
    t('the Android intent carries a browser fallback', intent.includes('S.browser_fallback_url='));
    t('the Android intent starts with the documented prefix', intent.startsWith('intent://wc?uri='));
    t('no intent is invented without a package', androidIntentLink({ native: 'x://' }, URI, '') === '');

    t('the logo URL carries the project id', walletLogo(trust.imageId, 'pid').includes('projectId=pid'));
    t('no logo is built without a project id', walletLogo(trust.imageId, '') === '');
    t('AppKit rows carry mobile_link and link_mode',
      appKitCustomWallets('pid').every((w) => w.mobile_link && w.link_mode));
  }

  /* ══════════════════ 3. hand-off: never navigate this document ═══════════ */
  {
    t('a bare browser is the web channel', handOffChannel({}) === 'web');
    t('a Capacitor shell is the native-app channel',
      handOffChannel({ Capacitor: { isNativePlatform: () => true } }) === 'native-app');
    t('Telegram is its own channel', handOffChannel({ Telegram: { WebApp: { openLink() {} } } }) === 'telegram');

    const trust = walletByKey('trust');
    const native = walletLink(trust.native, URI);
    const decision = decideWalletOpen(native);
    t('a known native link is opened, not passed through', decision.action === 'open');
    t('the decision carries the raw pairing URI', decision.pairingUri === URI);
    t('a universal link is rewritten back to the native route',
      decideWalletOpen(walletLink(trust.universal, URI)).url === native);
    t('an in-page scheme is never treated as a hand-off', decideWalletOpen('about:blank').action === 'pass');
    t('a wallet home page with no payload passes through untouched',
      decideWalletOpen('https://trustwallet.com/').action === 'pass');
    t('an unrelated https URL passes through', decideWalletOpen('https://example.com/').action === 'pass');
    t('an empty URL passes through', decideWalletOpen('').action === 'pass');

    /* The window.open bridge is the thing that stops the SDK's `_self`. */
    const calls = [];
    const win = { open: (...args) => { calls.push(args); return true; }, document: { createElement: () => ({ style: {}, click() {}, remove() {} }), body: { appendChild() {} } } };
    const original = win.open;
    const off = installWalletOpenBridge({ win, openWallet: (url, opts) => calls.push([url, opts]) });
    win.open('https://example.com/', '_blank');
    t('an unrelated URL still reaches the real window.open', calls.length === 1 && calls[0][0] === 'https://example.com/');
    win.open(native, '_self');
    // New bridge does sync open via original (_blank) plus openWallet callback for tracing.
    // So after intercept, we should have at least 2 more calls, no _self, and package info in callback.
    const afterIntercept = calls.slice(1);
    const hasBlankOpen = afterIntercept.some((c) => Array.isArray(c) && c[1] === '_blank' && typeof c[0] === 'string' && c[0].includes('wc?uri='));
    const hasNoSelf = afterIntercept.every((c) => !(Array.isArray(c) && (c[1] === '_self' || c[1] === '_top')));
    const hasPackageInfo = afterIntercept.some((c) => c[1]?.walletPackage === 'com.wallet.crypto.trustapp' && Boolean(c[1]?.fallbackUrl));
    t('a hand-off is intercepted instead of navigating this document', hasBlankOpen && hasNoSelf);
    t('the intercepted hand-off carries package and fallback', hasPackageInfo);
    off();
    t('uninstalling restores the original opener', win.open === original);
    t('installing without an opener is a harmless no-op',
      typeof installWalletOpenBridge({ win: null, openWallet: () => {} }) === 'function');
  }

  /* ══════════════════ 4. opening, per channel (fake window) ═══════════════ */
  {
    const trust = walletByKey('trust');
    const native = walletLink(trust.native, URI);
    const universal = walletLink(trust.universal, URI);

    /*
     * web + Android: the package-scoped intent is tried first — and it now
     * navigates THIS DOCUMENT instead of opening a tab.
     *
     * Chrome resolves `intent://` itself. When the wallet is installed the
     * navigation never commits: the app opens and fbtswap.ir stays exactly
     * where the user left it, socket and pending connect() intact. When the
     * app is missing, the navigation commits to `S.browser_fallback_url`,
     * which is the install page — the one screen that helps.
     *
     * Opening that URL in a tab instead is what left the dead
     * `trust://wc?uri=…` page the user landed on when they pressed Back.
     */
    const android = { navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/151' } };
    const seen = [];
    const navigated = [];
    android.document = {
      createElement: () => ({ style: {}, click() {}, remove() {} }),
      body: { appendChild() {} }
    };
    android.location = {
      set href(value) { navigated.push(value); },
      get href() { return navigated[navigated.length - 1] ?? ''; }
    };
    android.open = (url) => { seen.push(url); return true; };
    const okAndroid = await openWalletLink(native, {
      wallet: trust,
      walletPackage: trust.androidPackage,
      pairingUri: URI,
      fallbackUrl: universal,
      view: android
    });
    t('Android Chrome opens the package-scoped intent first', okAndroid && String(navigated[0]).startsWith('intent://'));
    t('the intent is navigated IN PLACE, so the dApp document survives', navigated.length === 1);
    t('the in-place intent opens no tab at all', seen.length === 0);
    t('the intent is scoped to the wallet package', String(navigated[0]).includes('package=com.wallet.crypto.trustapp'));
    t('the intent carries the pairing payload', String(navigated[0]).includes(encodeURIComponent(URI)));
    t('the intent names a fallback for the not-installed case', String(navigated[0]).includes('S.browser_fallback_url='));

    /* An intent with NO fallback must never be navigated in place: Chrome would
       commit to its own error page and take the dApp with it. */
    const noFallback = {
      navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/151' },
      document: { createElement: () => ({ style: {}, click() {}, remove() {} }), body: { appendChild() {} } },
      location: { set href(v) { bareNavigated.push(v); }, get href() { return ''; } },
      setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 5))
    };
    const bareNavigated = [];
    const bareSeen = [];
    noFallback.open = (url) => { bareSeen.push(url); return { close() {} }; };
    const bareWallet = { ...trust, androidPackage: trust.androidPackage, universal: '' };
    await openWalletLink(native, {
      wallet: bareWallet,
      walletPackage: trust.androidPackage,
      pairingUri: URI,
      fallbackUrl: '',
      view: noFallback
    });
    t('an intent with no fallback is never navigated in place', bareNavigated.length === 0);
    t('an intent with no fallback still reaches the wallet by tab', bareSeen.length > 0);

    /* An Android browser that does NOT speak intent:// (Firefox) must never be
       navigated in place: it would render the scheme as an error page and take
       the document with it. It gets the tab, and the tab is cleaned up. */
    const firefox = {
      navigator: { userAgent: 'Mozilla/5.0 (Android 14; Mobile; rv:130.0) Gecko/130.0 Firefox/130.0' },
      document: { createElement: () => ({ style: {}, click() {}, remove() {} }), body: { appendChild() {} } },
      location: { set href(v) { firefoxNavigated.push(v); }, get href() { return ''; } },
      setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 5))
    };
    const firefoxNavigated = [];
    const firefoxSeen = [];
    const firefoxChild = { close() { firefoxSeen.push('closed'); } };
    firefox.open = (url) => { firefoxSeen.push(url); return firefoxChild; };
    const okFirefox = await openWalletLink(native, {
      wallet: trust,
      walletPackage: trust.androidPackage,
      pairingUri: URI,
      fallbackUrl: universal,
      view: firefox
    });
    t('a browser without intent:// is NOT navigated in place',
      okFirefox && firefoxNavigated.length === 0 && !firefoxSeen.includes('intent://'));
    t('a browser without intent:// still opens the wallet scheme in a tab',
      firefoxSeen[0] === native);

    /* An embedded WebView cannot route an intent either. */
    const webview = {
      navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14; wv) Chrome/151' },
      document: { createElement: () => ({ style: {}, click() {}, remove() {} }), body: { appendChild() {} } },
      location: { set href(v) { navigated.push(v); }, get href() { return ''; } },
      setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 5))
    };
    const webviewNavigated = [];
    const webviewSeen = [];
    webview.open = (url) => { webviewSeen.push(url); return { close() {} }; };
    await openWalletLink(native, {
      wallet: trust,
      walletPackage: trust.androidPackage,
      pairingUri: URI,
      fallbackUrl: universal,
      view: webview
    });
    t('a WebView is never navigated to an intent it cannot route',
      webviewSeen.every((u) => !String(u).startsWith('intent://')));

    /* web, non-Android: the native scheme, in a new context. */
    const plain = { navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari' }, document: null };
    const plainSeen = [];
    plain.open = (url, name) => { plainSeen.push([url, name]); return true; };
    const okPlain = await openWalletLink(native, {
      wallet: trust,
      pairingUri: URI,
      fallbackUrl: universal,
      view: plain
    });
    t('iOS Safari opens the native scheme', okPlain && plainSeen[0][0] === native);
    t('the target is never _self or _top', plainSeen[0][1] === '_blank');

    /* Telegram: window.open of the scheme, double-encoded on Android. */
    const tg = {
      navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14) Telegram' },
      Telegram: { WebApp: { openLink: (url) => { tg.fallback = url; } } },
      document: null
    };
    const tgSeen = [];
    tg.open = (url) => { tgSeen.push(url); return true; };
    const okTg = await openWalletLink(native, {
      wallet: trust,
      pairingUri: URI,
      fallbackUrl: universal,
      view: tg
    });
    t('Telegram opens a URL of its own', okTg && tgSeen.length === 1);
    t('Telegram-Android receives the payload double-encoded', tgSeen[0].includes(encodeURIComponent(URI)));

    /* The APK: the Java bridge gets the RAW wc: URI and the package. */
    const cap = { navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14)' }, document: null };
    const bridgeCalls = [];
    cap.Capacitor = { isNativePlatform: () => true };
    cap.FBTWalletLink = { openWallet: (uri, pkg) => { bridgeCalls.push([uri, pkg]); return true; } };
    cap.open = () => true;
    const okCap = await openWalletLink(native, {
      wallet: trust,
      walletPackage: trust.androidPackage,
      pairingUri: URI,
      fallbackUrl: universal,
      view: cap
    });
    t('the APK hands the raw pairing URI to the Java bridge', okCap && bridgeCalls[0][0] === URI);
    t('the APK scopes the intent to one package', bridgeCalls[0][1] === 'com.wallet.crypto.trustapp');
    const mainActivity = readFileSync('android/app/src/main/java/ir/fbtswap/app/MainActivity.java', 'utf8');
    const nativeLaunch = mainActivity.indexOf('if (canOpen(nativeIntent)) return launch(nativeIntent);');
    const protocolLaunch = mainActivity.indexOf('return canOpen(protocolIntent) && launch(protocolIntent);');
    t('the APK tries the selected wallet branded URI before generic wc:',
      nativeLaunch >= 0 && protocolLaunch > nativeLaunch);
    t('the APK emits a real lifecycle resume signal to the pending pairing',
      /onResume\(\)[\s\S]*fbt:app-resume/.test(mainActivity));

    /* window.open blocked (an OEM popup blocker) must not leave the tap dead:
       a synthetic anchor is still a navigation the gesture initiated. */
    const anchorSeen = [];
    const blocked = {
      navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari' },
      document: {
        createElement: () => ({
          style: {},
          set href(v) { anchorSeen.push(v); },
          click() {},
          remove() {}
        }),
        body: { appendChild() {} }
      }
    };
    blocked.open = () => false;
    const viaAnchor = await openWalletLink(native, {
      wallet: trust,
      pairingUri: URI,
      fallbackUrl: universal,
      view: blocked
    });
    t('a blocked window.open still launches the wallet via an anchor', viaAnchor === true);
    t('the anchor carries the native link, not a redirector', anchorSeen[0] === native);

    /* A refused Java bridge with nothing to fall back to must resolve instead
       of hanging — every wait in this stack is bounded. */
    const refused = { navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14)' }, document: null };
    refused.Capacitor = { isNativePlatform: () => true };
    refused.FBTWalletLink = { openWallet: () => false };
    refused.open = () => false;
    const refusedResult = await openWalletLink(native, {
      wallet: trust,
      walletPackage: trust.androidPackage,
      pairingUri: URI,
      fallbackUrl: '',
      view: refused
    });
    t('a refused bridge resolves instead of hanging', refusedResult === false);
  }

  /* ══════════════════ 5. bounds and the failure classifier ════════════════ */
  {
    let timedOut = false;
    try {
      await withTimeout(new Promise(() => {}), 20, 'WC_CONNECT_TIMEOUT');
    } catch (e) {
      timedOut = e.message === 'WC_CONNECT_TIMEOUT';
    }
    t('a stalled promise is bounded by its own code', timedOut);
    t('a fast promise is unaffected by the bound', (await withTimeout(Promise.resolve(7), 200)) === 7);

    const { promise, cancel } = cancelSwitch('WC_USER_CANCELLED');
    let cancelled = false;
    promise.catch((e) => { cancelled = e.message === 'WC_USER_CANCELLED'; });
    cancel();
    await Promise.resolve();
    t('the cancel switch settles an in-flight attempt immediately', cancelled);

    t('a user rejection is a cancellation, not a failure',
      classifyConnectError({ message: 'User rejected the request' }) === 'USER_REJECTED');
    t('a 4001 is a cancellation', classifyConnectError({ code: 4001 }) === 'USER_REJECTED');
    t('a modal dismissal is a cancellation',
      classifyConnectError({ message: 'Connection request reset. Please try again.' }) === 'USER_REJECTED');
    t('an origin refusal is named as one',
      classifyConnectError({ message: 'origin not allowed' }) === 'WC_ORIGIN_BLOCKED');
    t('an expired pairing is named before the relay branch',
      classifyConnectError({ message: 'proposal expired' }) === 'WC_EXPIRED');
    t('a stalled socket is the relay',
      classifyConnectError({ message: 'Socket stalled when trying to connect' }) === 'WC_RELAY_UNREACHABLE');
    /* «the relay is unreachable» used to be printed for OUR OWN timeout — the
       2026-09-17 report shows why that matters: the relay had just issued the
       URI the wallet was opened with, so the sentence sent the user hunting a
       VPN while the real story was «nobody approved in time». */
    t('our own connect bound is named as a timeout, not as the network',
      classifyConnectError({ message: 'WC_CONNECT_TIMEOUT' }) === 'WC_TIMEOUT');
    t('a pairing that outlived its own expiry is named as one',
      classifyConnectError({ message: 'WC_PAIRING_EXPIRY_REACHED' }) === 'WC_TIMEOUT');
    t('an init timeout really is the socket — nothing else happens in init()',
      classifyConnectError({ message: 'WC_INIT_TIMEOUT' }) === 'WC_RELAY_UNREACHABLE');
    t('anything else is a plain failure', classifyConnectError({ message: 'nope' }) === 'CONNECT_FAILED');
    t('a relay error justifies a second host', isRelayError(new Error('websocket closed')));
    t('a user cancellation does NOT', !isRelayError(new Error('User rejected')));
    t('a modal bootstrap failure is the surface, not the network',
      isModalError(new Error('To use QR modal, please install @reown/appkit package')));
    t('a relay error is not a modal error', !isModalError(new Error('websocket closed')));
  }

  /* ══════════════════ 6. relay measurement (fake sockets) ═════════════════ */
  {
    const openSocket = class {
      constructor(url) { this.url = url; setTimeout(() => this.onopen?.(), 5); }
      close() {}
    };
    const refusedSocket = class {
      constructor() { setTimeout(() => this.onclose?.({ code: 1006 }), 5); }
      close() {}
    };
    const slowSocket = class { constructor() {} close() {} };

    const open = await probeRelay('wss://relay.example.org', {
      WebSocketImpl: openSocket,
      timeoutMs: 300
    });
    t('a socket that opens is measured as open', open.ok === true && open.ms >= 0);
    t('the measured URL is reported, never the authenticated one',
      open.url === 'wss://relay.example.org');

    const refused = await probeRelay('wss://relay.example.org', {
      WebSocketImpl: refusedSocket,
      timeoutMs: 300,
      graceMs: 5
    });
    t('a refused socket is a failure, not a success', refused.ok === false);

    const timed = await probeRelay('wss://relay.example.org', {
      WebSocketImpl: slowSocket,
      timeoutMs: 30
    });
    t('an unanswered socket times out instead of hanging', timed.ok === false && timed.error === 'TIMEOUT');
    t('an environment with no WebSocket is reported as such by the verdict',
      relayVerdict([{ url: 'a', socket: { error: 'NO_WEBSOCKET' } }]).verdict === 'NO_WEBSOCKET');

    /* The verdict separates "host alive, upgrade refused" (the shape ISP
       filtering takes) from "nothing answered at all". */
    t('one open host means OPEN',
      relayVerdict([{ url: 'a', socket: { ok: true } }, { url: 'b', socket: { ok: false, error: 'TIMEOUT' } }]).verdict === 'OPEN');
    t('HTTPS answering but no socket means WS_REFUSED',
      relayVerdict([{ url: 'a', socket: { ok: false }, https: { ok: true } }]).verdict === 'WS_REFUSED');
    t('nothing answering means UNREACHABLE',
      relayVerdict([{ url: 'a', socket: { ok: false, error: 'SOCKET_ERROR' } }]).verdict === 'UNREACHABLE');
    t('every host timing out means TIMEOUT',
      relayVerdict([{ url: 'a', socket: { ok: false, error: 'TIMEOUT' } }]).verdict === 'TIMEOUT');
    t('no hosts means there was nothing to measure', relayVerdict([]).verdict === 'NO_MEASUREMENT');
    t('OPEN is not a blocked verdict', !isRelayBlocked('OPEN'));
    t('WS_REFUSED, UNREACHABLE and TIMEOUT are', ['WS_REFUSED', 'UNREACHABLE', 'TIMEOUT'].every(isRelayBlocked));

    const ordered = relayOrderFromHosts([
      { url: 'b', socket: { ok: true } },
      { url: 'a', socket: { ok: false } }
    ], ['a', 'b']);
    t('the host that opened is tried first', ordered[0] === 'b');
    t('every configured host is still in the order', ordered.length === 2 && ordered.includes('a'));

    const measured = await measureRelay({
      projectId: 'pid',
      urls: ['wss://one.example', 'wss://two.example'],
      timeoutMs: 200,
      force: true,
      WebSocketImpl: openSocket,
      fetchImpl: async () => {}
    });
    t('every host is measured, not just the first', measured.hosts.length === 2);
    t('a measurement produces a verdict and an order', measured.verdict === 'OPEN' && measured.order.length === 2);

    /* The budget is a MEASURED number, and this is the measurement it has to
       beat: 4344ms for a healthy socket on a real phone. Under the old 5s that
       socket burned 87% of the budget, and a small hiccup turned a working
       relay into the verdict TIMEOUT → «رله روی این شبکه بسته است». So the
       probe budget must clear the measured handshake WITH headroom: if someone
       later lowers it because "8 seconds sounds like a lot", this fails and
       says why, instead of the field finding out. */
    t('the probe budget clears the slowest measured relay handshake with real headroom',
      TIMEOUT.relayProbe > MEASURED_RELAY_OPEN_MS && TIMEOUT.relayProbe >= MEASURED_RELAY_OPEN_MS * 1.5);
  }

  /* ══════════════════ 7. chain resolution (Trust-on-Ethereum reporting 56) ═ */
  {
    t('a number stays a number', parseChainId(56) === 56);
    t('a decimal string is parsed', parseChainId('56') === 56);
    t('a hex string is parsed', parseChainId('0x38') === 56);
    t('a CAIP-2 chain is parsed', parseChainId('eip155:1') === 1);
    t('a CAIP-10 account collapses to its chain', parseChainId('eip155:1:0xabc') === 1);
    t('junk is null, never NaN', parseChainId('nope') === null && parseChainId('') === null);

    /* The provider's own answer is the REQUIRED chain after connect(); the
       session's namespace is what the wallet actually approved. */
    const session = { chainId: 56, session: { namespaces: { eip155: { accounts: ['eip155:1:0xabc'] } } } };
    t('the honest chain comes from the approved session, not the provider',
      chainFromSession(session) === 1);
    t('without a session the provider answer stands', chainFromSession({ chainId: 56 }) === 56);
    t('a malformed session never throws', (() => {
      try { return chainFromSession({ session: { namespaces: null } }) === null; } catch { return false; }
    })());
  }

  /* ══════════════════ 8. storage hygiene ══════════════════════════════════ */
  {
    t('the SDK namespace is connection state', isConnectionKey('wc@2:client:0.3//session'));
    t('the deep-link choice is connection state', isConnectionKey('WALLETCONNECT_DEEPLINK_CHOICE'));
    t('a dynamic connector id is connection state', isConnectionKey('@appkit/abc123:connected_connector_id'));
    /* The embedded (email/social) wallet was retired on 2026-09-18, and its
       session key flipped side with it: it is no longer a live user's login but
       debris that makes the SDK build a secure frame nobody can use. */
    t('the retired embedded wallet session IS purged with the rest',
      isConnectionKey('@appkit-wallet/EMAIL_LOGIN_USED_KEY'));
    t('an AppKit cache is NOT connection state', !isConnectionKey('@appkit/portfolio_cache'));
    t('recent emails are NOT connection state (the boot purge names them itself)',
      !isConnectionKey('@appkit/recent_emails'));
    t('an unrelated key is NOT connection state', !isConnectionKey('fbt:vault'));

    /* ── the «disconnect, then a phantom with a balance» keys (AppKit 1.8.19) ──
       The static six-key list predated these; a purge that missed them left the
       SDK believing a logged-out wallet was still attached, and the next
       connect opened as that phantom — address, balance, and a modal that
       refuses to offer a login. */
    t('@appkit/connections (the persisted connection list) is connection state',
      isConnectionKey('@appkit/connections'));
    t('@appkit/connected_namespaces is connection state', isConnectionKey('@appkit/connected_namespaces'));
    t('@appkit/active_namespace is connection state', isConnectionKey('@appkit/active_namespace'));
    t('@appkit/social_provider is connection state', isConnectionKey('@appkit/social_provider'));
    t('@appkit/connected_social is connection state', isConnectionKey('@appkit/connected_social'));
    t('@appkit/disconnected_connector_ids is connection state', isConnectionKey('@appkit/disconnected_connector_ids'));
    t('@appkit/connection_status says nothing until its value is read',
      isConnectionKey('@appkit/connection_status') === false);
    const statusStore = {
      getItem: (k) => (k === '@appkit/connection_status' ? 'connected' : null)
    };
    t("a 'connected' status IS connection state (the phantom to kill)",
      isConnectionKey('@appkit/connection_status', statusStore) === true);
    const cleanStore = {
      getItem: (k) => (k === '@appkit/connection_status' ? 'disconnected' : null)
    };
    t("a 'disconnected' status is not (every clean boot writes it)",
      isConnectionKey('@appkit/connection_status', cleanStore) === false);
    t('the version-check key is bookkeeping, not connection state',
      !isConnectionKey('@appkit/latest_version'));
    t('the account-type preference is not connection state',
      !isConnectionKey('@appkit/preferred_account_types'));

    const store = new Map([
      ['wc@2:client:0.3//session', JSON.stringify([{ topic: 'x' }])],
      ['WALLETCONNECT_DEEPLINK_CHOICE', 'trust'],
      ['@appkit/recent_wallet', 'trust'],
      ['@appkit/connections', '{"eip155":[{"connectorId":"AUTH"}]}'],
      ['@appkit/connection_status', 'connected'],
      ['@appkit/latest_version', '1.8.20'],
      ['@appkit/portfolio_cache', '{}'],
      ['@appkit-wallet/EMAIL_LOGIN_USED_KEY', 'true']
    ]);
    const fake = {
      get length() { return store.size; },
      key: (i) => Array.from(store.keys())[i] ?? null,
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      removeItem: (k) => store.delete(k),
      setItem: (k, v) => store.set(k, v)
    };

    t('a session on disk is found before any socket is opened', hasStoredSession(fake));
    t('the purge removes exactly the connection keys — including the 1.8.19 ones',
      purgeConnectionKeys(fake) === 6);
    t('the persisted AUTH connection is gone', !store.has('@appkit/connections'));
    t('the phantom connected-status is gone', !store.has('@appkit/connection_status'));
    t('the retired embedded wallet session goes with them',
      !store.has('@appkit-wallet/EMAIL_LOGIN_USED_KEY'));
    t('the cache survives the purge', store.has('@appkit/portfolio_cache'));
    t('the version-check key survives the purge', store.has('@appkit/latest_version'));
    t('an empty store has no session', !hasStoredSession({ length: 0, key: () => null, getItem: () => null }));

    const facts = storageFacts(fakeStorage(new Map([
      ['@appkit/recent_wallet', 'trust'],
      ['@appkit-wallet/EMAIL_LOGIN_USED_KEY', 'true']
    ])));
    t('AppKit keys without a session are reported orphan', facts.orphanKeys === true);
    t('the embedded-wallet prefix is counted as legacy, not as an AppKit key',
      facts.appkitConnectionKeys === 1 && facts.legacyEmbeddedKeys === 1);
    t('the retired surface reports no marker rows any more',
      facts.sdkLoginMarker === undefined && facts.ourMarker === undefined
        && facts.emailMarkerStale === undefined);

    /* The two facts added with the 1.8.19 orphan fix: the report must name a
       stale 'connected' status and a persisted AUTH connection, because those
       are the exact residues that broke the next login. */
    const phantomFacts = storageFacts({
      length: 2,
      key: (i) => ['@appkit/connection_status', '@appkit/connections'][i],
      getItem: (k) => (k === '@appkit/connection_status'
        ? 'connected'
        : '{"eip155":[{"connectorId":"AUTH","accounts":[{"address":"0xabc"}]}]}')
    });
    t("a stale 'connected' status is named by the report", phantomFacts.connectionStatus === 'connected');
    t('a persisted AUTH connection is named by the report',
      phantomFacts.storedConnectors.includes('AUTH'));
    t('the phantom status is counted as a connection key', phantomFacts.appkitConnectionKeys === 2);
  }

  /* ══════════════════ 9. the retired email/social surface ══════════════════ */
  {
    /*
     * The embedded wallet (email OTP + social login) was REMOVED on 2026-09-18
     * at the owner's request: «ورود با سوشال … داره به ورود با والت‌کانکت هم
     * آسیب می‌زد». The mechanism behind that report is structural — the surface
     * needed a SECOND `createAppKit()` instance, and both instances share
     * AppKit's controllers singletons and the one `<w3m-modal>` element, so
     * whichever booted last decided what the other rendered: an email tap
     * opened the WalletConnect wallet grid (its rows need a `wcUri` only a
     * pairing creates), and a WalletConnect cycle left `activeCaipAddress`
     * describing a dead wallet.
     *
     * These locks are the removal itself. Each one names a way the surface
     * could come back: a module, an instance, a row, a mode, a string, or the
     * keys it left on a user's device.
     */
    /* Comments are stripped: the removal is documented in the very files that
       must not DO it any more, and a doc comment naming `createAppKit()` is not
       a second instance. */
    const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const indexSrc = strip(readFileSync('src/lib/wc/index.js', 'utf8'));
    const ctxSrc = readFileSync('src/context/WalletContext.jsx', 'utf8');
    const sheetSrc = readFileSync('src/components/WalletConnectSheet.jsx', 'utf8');

    t('the embedded-wallet module is gone from the stack', !existsSync('src/lib/wc/embedded.js'));
    t('...and nothing in the stack imports it', (() => {
      const files = readdirSync('src/lib/wc').filter((f) => f.endsWith('.js')).map((f) => `src/lib/wc/${f}`);
      return files.every((f) => !/from '\.\/embedded\.js'|wc\/embedded/.test(readFileSync(f, 'utf8')));
    })());
    t('the public surface exports no embedded-wallet symbol',
      !/embedded\.js|SOCIAL_PROVIDERS|emailOptions|probeSigning|sdkSessionFacts/.test(indexSrc));

    /* THE STRUCTURAL LOCK: one AppKit instance per page, and it is the SDK's.
       A second `createAppKit()` is what made the two surfaces fight; nothing in
       this app may create one any more. */
    t('no source file creates its own AppKit instance', (() => {
      const files = readdirSync('src/lib/wc').filter((f) => f.endsWith('.js')).map((f) => `src/lib/wc/${f}`);
      return [...files, 'src/context/WalletContext.jsx', 'src/components/WalletConnectSheet.jsx']
        .every((f) => !/createAppKit\s*\(/.test(strip(readFileSync(f, 'utf8'))));
    })());
    t('the WalletConnect surface still hard-disables auth wallets',
      /features: \{ email: false, socials: false \}/.test(strip(readFileSync('src/lib/wc/appkit.js', 'utf8'))));
    t('the email-only controller surgery went with the surface', (() => {
      const appkit = readFileSync('src/lib/wc/appkit.js', 'utf8');
      return !/assertEmailRouting|assertEmailNetwork|clearPhantomAuthConnection|resetSharedConnectionState/
        .test(appkit);
    })());

    t('the connect sheet offers no email or social row',
      !/connectEmailSocial|emailSocial|EMAIL_PROVIDER_PENDING|EMAIL_SIGNING_DENIED/.test(sheetSrc));
    t('the sheet withdraws for ONE modal only',
      /open && !wallet\.wcModalActive\}/.test(sheetSrc) && !/emailModalActive/.test(sheetSrc));
    t('the context has no email mode, no keeper and no restore',
      !/connectEmailSocial|restoreEmailSocial|EmailAttachKeeper|emailModalActive|mode === 'email'/.test(ctxSrc));
    t('the boot purge of the retired keys is wired', /purgeEmbeddedWalletKeys\(\)/.test(ctxSrc));
    t('the wallet page and the security card label no email mode', (() => {
      const wallet = readFileSync('src/pages/Wallet.jsx', 'utf8');
      const card = readFileSync('src/components/SecurityCenterCard.jsx', 'utf8');
      return !/case 'email'/.test(wallet) && !/mode === 'email'/.test(card);
    })());
    t('the locales carry no email/social login strings', (() => {
      const en = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));
      const fa = JSON.parse(readFileSync('src/i18n/locales/fa.json', 'utf8'));
      return [en, fa].every((l) => l.wallet.emailSocial === undefined
        && l.wallet.emailSocialDesc === undefined
        && l.wallet.mode.email === undefined
        && l.wallet.healthSecureSite === undefined
        && l.wallet.emailProviderPending === undefined);
    })());

    /* What the removal must NOT do is leave the old surface's machinery on a
       returning user's device: `W3mFrameProvider` reads
       `@appkit-wallet/EMAIL_LOGIN_USED_KEY` in its CONSTRUCTOR and creates the
       secure.walletconnect.org iframe whether this page has a surface for it or
       not. So the keys are named, listed and purged — and nothing else is. */
    const legacyStore = new Map([
      ['fbt_email_social_connected', '1'],
      ['@appkit-wallet/EMAIL_LOGIN_USED_KEY', 'true'],
      ['@appkit/social_provider', 'google'],
      ['@appkit/recent_emails', '["user@example.com"]'],
      ['fbt:vault', '{"address":"0xabc"}'],
      ['wc@2:client:0.3//session', '[{"topic":"x"}]'],
      ['@appkit/portfolio_cache', '{}']
    ]);
    const legacy = fakeStorage(legacyStore);
    t('the retired keys are listed — and only they are',
      listEmbeddedWalletKeys(legacy).sort().join(',') === [
        '@appkit-wallet/EMAIL_LOGIN_USED_KEY',
        '@appkit/recent_emails',
        '@appkit/social_provider',
        'fbt_email_social_connected'
      ].sort().join(','));
    t('the purge removes exactly those four', purgeEmbeddedWalletKeys(legacy) === 4);
    t('the vault, the WalletConnect session and the cache survive it',
      legacyStore.has('fbt:vault') && legacyStore.has('wc@2:client:0.3//session')
        && legacyStore.has('@appkit/portfolio_cache'));
    t('the purge is idempotent — a second boot reports nothing to do',
      purgeEmbeddedWalletKeys(legacy) === 0 && listEmbeddedWalletKeys(legacy).length === 0);
    t('a device that never used the surface reports zero',
      listEmbeddedWalletKeys(fakeStorage(new Map([['fbt:vault', '{}']]))).length === 0);
  }

  /* ══════════════════ 10. the session object's contract ═══════════════════ */
  {
    const session = createWcSession({
      chains: [56],
      optionalChains: [1, 8453],
      supportsChain: (id) => [1, 56, 8453].includes(id),
      defaultChain: 56
    });

    /* Restore with nothing on disk must not open a socket: `init()` costs the
       project relay quota, so a visitor who never connected pays nothing. */
    const restore = await session.restore();
    t('a restore with no session on disk stops before any network call',
      restore?.ok === false && restore?.code === 'WC_NO_SESSION');
    t('cancelling when nothing is pairing is a harmless no-op', (await session.cancel()) === false);
    t('disconnecting when nothing is attached is a harmless no-op', (await session.disconnect()) === true);
    t('the session reports no live provider', session.provider === null && session.busy === false);
    /* Two concurrent connects are refused rather than opening two SignClients;
       the guard is exercised through the public surface above (busy stays
       false), because a real connect() would need the SDK and the network. */

    const withModal = session._initConfig(true);
    const withoutModal = session._initConfig(false);
    t('the required chain is the first network', withModal.chains[0] === 56);
    t('every other supported chain is optional', withModal.optionalChains.includes(8453));
    t('the modal is the surface by default', withModal.showQrModal === true);
    t('the surface can be built without it', withoutModal.showQrModal === false);
    /* Leaving the explorer ids in meant the promoted list came from the API —
       so on a filtered network the wallets vanished. */
    t('the explorer recommended list is cleared so our registry is the source',
      withModal.qrModalOptions.explorerRecommendedWalletIds === 'NONE');
    t('the wallet table is handed to the legacy modal shape too',
      Array.isArray(withModal.qrModalOptions.mobileWallets) && withModal.qrModalOptions.mobileWallets.length === 5);

    /* The metadata that reaches the wallet must never be the APK's origin. */
    const meta = withModal.metadata ?? session._initConfig(true).metadata;
    t('the wallet-facing identity is the canonical public URL',
      String(meta?.url || '').startsWith('https://'));
    t('the wallet-facing identity is never a localhost origin',
      !/localhost|127\.0\.0\.1/.test(String(meta?.url || '')));
    t('the declared icon is a real file in public/', (() => {
      const icon = String(meta?.icons?.[0] || '');
      const file = icon.split('/').pop();
      if (!file) return false;
      try {
        readFileSync(`public/${file}`);
        return true;
      } catch {
        return false;
      }
    })());
    t('redirect.native is only ever set inside the packaged app',
      meta?.redirect?.native === undefined || meta.redirect.native === 'ir.fbtswap.app://');

    let transportOpens = 0;
    const resumable = {
      signer: { client: { core: { relayer: { transportOpen: async () => { transportOpens += 1; } } } } }
    };
    t('foreground recovery reopens the existing SignClient relayer',
      (await wakeWcTransport(resumable)) === true && transportOpens === 1);
    t('foreground recovery is a no-op for an unknown provider shape',
      (await wakeWcTransport({})) === false);
  }

  /* ══════ 10b. the identity the wallet is handed (Verify API mismatch) ═════
   * The report: «والت می‌گوید این dApp به نظر می‌رسد کلاهبرداری باشد و باید
   * خارج شوی». WalletConnect's Verify API attests the origin that opened the
   * socket, so a page that declares a DIFFERENT domain is reported to the
   * wallet as INVALID — the domain-mismatch screen every wallet renders as a
   * phishing warning. These lock the rule: a real https page declares itself,
   * and only a page no wallet could reach falls back to the canonical name. */
  {
    const canonical = 'https://fbtswap.ir';
    const page = (origin, extra = {}) => ({ location: { origin }, ...extra });

    t('on the canonical site the wallet is told the canonical origin',
      walletIdentityUrl(page('https://fbtswap.ir')) === canonical);
    t('a subdomain declares itself, not its parent',
      walletIdentityUrl(page('https://www.fbtswap.ir')) === 'https://www.fbtswap.ir');
    /* Both of these used to be told `https://fbtswap.ir` while the attestation
       carried the real host — which IS the mismatch wallets warn about. */
    t('a preview deployment declares its own origin',
      walletIdentityUrl(page('https://fbt-swap-git-main.vercel.app')) === 'https://fbt-swap-git-main.vercel.app');
    t('a sandbox preview declares its own origin',
      walletIdentityUrl(page('https://5173-abc123.e2b.app')) === 'https://5173-abc123.e2b.app');
    t('the packaged app declares the public origin, never the WebView origin',
      walletIdentityUrl(page('https://localhost', { Capacitor: { isNativePlatform: () => true } })) === canonical);
    t('a dev server declares the public origin (a wallet cannot fetch localhost)',
      walletIdentityUrl(page('http://localhost:5173')) === canonical);
    t('a cleartext page declares the public origin',
      walletIdentityUrl(page('http://fbtswap.ir')) === canonical);
    t('no input ever yields a localhost identity',
      ['http://localhost:5173', 'https://localhost', 'http://127.0.0.1:3000']
        .every((origin) => !/localhost|127\.0\.0\.1/.test(walletIdentityUrl(page(origin)))));
    t('a missing window falls back to the public origin',
      walletIdentityUrl({}) === canonical && walletIdentityUrl(null) === canonical);

    const previewMeta = wcMetadata(page('https://5173-abc123.e2b.app'));
    t('the declared icon is on the declared origin, so a wallet can fetch it',
      previewMeta.icons[0] === 'https://5173-abc123.e2b.app/icon-512.png');
    t('a browser page advertises no app redirect (avoids opening FBT inside Trust)',
      previewMeta.redirect === undefined);
    t('a browser page never advertises the APK scheme',
      previewMeta.redirect?.native === undefined);
    t('the packaged app advertises only its native return scheme',
      (() => {
        const m = wcMetadata(page('https://localhost', { Capacitor: { isNativePlatform: () => true } }));
        return m.redirect?.native === 'ir.fbtswap.app://'
          && m.redirect?.universal === undefined
          && m.url === canonical;
      })());

    /* ─── the report's own evidence ───────────────────────────────────────── */
    const aligned = walletIdentityFacts(page('https://fbtswap.ir'));
    t('aligned facts name the same origin twice',
      aligned.declared === aligned.pageOrigin && aligned.matchesPage === true);
    const fallback = walletIdentityFacts(page('http://localhost:5173'));
    t('a dev page reports the fallback honestly as a mismatch',
      fallback.declared === canonical && fallback.pageOrigin === 'http://localhost:5173'
        && fallback.matchesPage === false);
    const packaged = walletIdentityFacts(page('https://localhost', { Capacitor: { isNativePlatform: () => true } }));
    t('packaged facts carry the flag the report renders',
      packaged.packaged === true && packaged.declared === canonical);
  }

  /* ══════════════════ 11. the health report ═══════════════════════════════ */
  {
    t('an empty allowlist allows every origin (the SDK rule)',
      isOriginAllowed('https://fbtswap.ir', []) === true);
    t('an exact origin matches', isOriginAllowed('https://fbtswap.ir', ['https://fbtswap.ir']) === true);
    t('a bare domain matches its host', isOriginAllowed('https://fbtswap.ir', ['fbtswap.ir']) === true);
    t('a subdomain is covered by its bare domain', isOriginAllowed('https://app.fbtswap.ir', ['fbtswap.ir']) === true);
    t('an unrelated origin is refused',
      isOriginAllowed('https://evil.example', ['fbtswap.ir']) === false);
    t('no list means no answer, not a refusal', isOriginAllowed('https://fbtswap.ir', null) === null);

    /* ─── what the project row means now ────────────────────────────────────
       ONE question: does the dashboard know this project at all. The feature
       summary that used to sit under it (email on/off, and which social
       providers AppKit's platform filter would hide on this device) described a
       login this app no longer offers, and `summarizeProjectConfig()` /
       `filterSocialsByPlatform()` / `platformFlags()` went with it — a
       diagnostic that prints «socials=7» for an app with no social login sends
       the next support thread hunting a switch nobody can flip. */
    const openSocket = class {
      constructor() { setTimeout(() => this.onopen?.(), 3); }
      close() {}
    };
    const report = await collectWalletHealth({
      projectId: 'pid',
      origin: 'https://fbtswap.ir',
      storage: fakeStorage(new Map()),
      fetchImpl: async (url) => (String(url).includes('/origins')
        ? { ok: true, status: 200, json: async () => ({ allowedOrigins: ['fbtswap.ir'] }) }
        : { ok: true, status: 200, json: async () => ({ features: [] }) }),
      WebSocketImpl: openSocket,
      timeoutMs: 300,
      trace: () => []
    });
    t('the report carries the project answer', report.projectConfig?.ok === true);
    t('the report carries the allowlist verdict', report.allowedOrigins?.originAllowed === true);
    t('the report measures every relay host', Array.isArray(report.relays) && report.relays.length === 2);
    t('the report names a relay verdict', typeof report.relayVerdict === 'string');
    t('the report names the hand-off channel', Boolean(report.handoff?.channel));
    t('the report carries storage facts', Boolean(report.storage));
    /* The three probes that only existed for the embedded wallet: the secure
       frame, the usage limits that gate AppKit's email input, and the feature
       summary of a login this app does not offer. */
    t('the report no longer probes the retired surface',
      report.secureSite === undefined && report.usage === undefined
        && report.projectConfig?.features === undefined);
    t('the report still carries the in-memory controller facts',
      report.shared && typeof report.shared.isConnected === 'boolean'
        && report.shared.authConnection === undefined);
    t('the report never throws on a dead network', (await collectWalletHealth({
      projectId: 'pid',
      fetchImpl: async () => { throw new Error('offline'); },
      WebSocketImpl: class { constructor() { throw new Error('offline'); } },
      timeoutMs: 50
    })).at !== undefined);
  }

  /* ══════════════════ 12. the trace cannot leak a pairing secret ══════════ */
  {
    wcTraceReset();
    wcEvent('display_uri');
    wcEvent('session_settled', 1200);
    wcEvent('metadata_repaired', true);
    /* A relay-controlled string is the leak vector: the buffer is designed to
       be pasted into a support message. */
    wcEvent('connect_failed_relay', 'wc:topic@2?symKey=secret');
    const snap = wcTraceSnapshot();
    t('the trace records what ran', snap.length === 4);
    t('a number may ride along', snap[1].n === 1200);
    t('a boolean may ride along', snap[2].ok === true);
    t('no string payload ever enters the trace',
      snap.every((entry) => !Object.values(entry).some((v) => typeof v === 'string' && v.includes('symKey'))));
    t('the snapshot is a copy', wcTraceSnapshot() !== snap);

    /* Detail events (2026-09-18): the surface snapshot answers «what did the
       modal actually open on» with NAMED facts — but only from a closed
       vocabulary, so the paste-into-support contract survives the upgrade. */
    wcEventDetail('email_open_surface', {
      view: 'Account', conn: true, addr: true, auth: false,
      cid: 'walletConnect', na: false, prov: false, modal: true
    });
    wcEventDetail('email_open_surface', {
      /* The leak vectors: a CAIP address in the view slot, a pairing URI in
         the connector slot, a hostile key, a non-scalar value. */
      view: 'eip155:1:0xdeadbeefdeadbeefdeadbeef',
      cid: 'wc:9f8e7d6c5b4a@2?relay-protocol=irn&symKey=SECRET',
      'not a key!': 'Account',
      junk: { leak: 'deadbeef' },
      addr: true
    });
    const detailSnap = wcTraceSnapshot();
    t('a whitelisted detail event records its facts',
      detailSnap[detailSnap.length - 2].d?.view === 'Account'
        && detailSnap[detailSnap.length - 2].d?.cid === 'walletConnect'
        && detailSnap[detailSnap.length - 2].d?.conn === true);
    t('an unsafe string is coerced to a token, never recorded',
      detailSnap[detailSnap.length - 1].d?.view === 'other'
        && detailSnap[detailSnap.length - 1].d?.cid === 'other');
    t('a hostile key and a non-scalar value are dropped',
      !('junk' in (detailSnap[detailSnap.length - 1].d ?? {}))
        && !Object.keys(detailSnap[detailSnap.length - 1].d ?? {}).some((k) => k.includes(' ')));
    t('no detail payload ever leaks a secret or an address',
      !JSON.stringify(detailSnap).includes('SECRET')
        && !JSON.stringify(detailSnap).toLowerCase().includes('deadbeef'));
    wcTraceReset();
    t('the buffer can be emptied', wcTraceSnapshot().length === 0);
  }

  /* ══════════════════ 13. the connect clock ══════════════════════════════
     «The wallet opens, I approve, and nothing happens.» On 2026-09-17 20:36Z
     the wallet row was tapped 4.5s after init and the attempt was destroyed
     20s later — a flat fuse shorter than one mobile round trip — while the
     user stood in Trust Wallet reading the approval. The provider was then
     torn down from under the approval that was one tap away. */
  {
    const paused = pauseBound(60, 'WC_CONNECT_TIMEOUT', { hardCapMs: 1_000 });
    let pausedMsg = null;
    paused.promise.catch((e) => { pausedMsg = e.message; });
    paused.pause();
    await sleep(130);
    t('the clock stops while the user is inside the wallet', pausedMsg === null);
    paused.resume();
    await sleep(140);
    t('…and finishes the budget it had left when it resumes',
      pausedMsg === 'WC_CONNECT_TIMEOUT');

    const hard = pauseBound(10_000, 'WC_CONNECT_TIMEOUT', {
      hardCapMs: 40,
      hardCode: 'WC_PAIRING_EXPIRY_REACHED'
    });
    let hardMsg = null;
    hard.promise.catch((e) => { hardMsg = e.message; });
    hard.pause();
    await sleep(90);
    t('the hard cap still fires while paused — an attempt can never hang',
      hardMsg === 'WC_PAIRING_EXPIRY_REACHED');

    const granted = pauseBound(50, 'WC_CONNECT_TIMEOUT', { hardCapMs: 1_000 });
    let grantedMsg = null;
    granted.promise.catch((e) => { grantedMsg = e.message; });
    granted.extend(400); // the pairing left for a wallet app
    await sleep(130);
    t('a hand-off extends the budget past the visible bound', grantedMsg === null);
    granted.cancel();
    await sleep(0);
    t('cancel settles a paused attempt immediately', grantedMsg === 'WC_USER_CANCELLED');

    t('the in-wallet budget is longer than one mobile round trip',
      TIMEOUT.connectInWallet > 60_000);
    t('the hard cap never outlives the pairing URI',
      TIMEOUT.connectHardCap <= PAIRING_TTL_MS);
    t('the old 20s fuse is gone', TIMEOUT.connect > 20_000);
  }

  /* ══════════════════ 14. the tab the hand-off leaves behind ═════════════
     «When I press Back I never get to fbtswap.ir — I land on
     trust://wc?uri=…». Chrome launched the wallet from a `_blank` custom
     scheme and left the tab it opened sitting on the unroutable URL. */
  {
    const trust = walletByKey('trust');
    const native = walletLink(trust.native, URI);
    const universal = walletLink(trust.universal, URI);

    /* `noopener` makes window.open return null BY SPECIFICATION, so every
       attempt reported failure and the intent route was quietly skipped for
       the raw custom scheme — the one URL that leaves a dead tab behind. */
    const closed = [];
    const child = { close: () => closed.push(1) };
    const chromeNavigated = [];
    const chrome = {
      navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/151 Mobile' },
      document: { createElement: () => ({ style: {}, click() {}, remove() {} }), body: { appendChild() {} } },
      location: {
        set href(value) { chromeNavigated.push(value); },
        get href() { return chromeNavigated[chromeNavigated.length - 1] ?? ''; }
      },
      setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 5))
    };
    const opened = [];
    chrome.open = (url, name, features) => { opened.push([url, name, features]); return child; };

    const chromeResult = await openWalletHandoff(native, {
      wallet: trust,
      pairingUri: URI,
      fallbackUrl: universal,
      view: chrome
    });
    t('Android Chrome hands the pairing to the package-scoped intent',
      chromeResult.ok && chromeResult.route === 'intent');
    /* The intent is resolved by the browser, in place: there is no tab, so
       there is no handle and nothing to declare dead. */
    t('the intent route opens no tab and needs no handle', opened.length === 0);
    await sleep(30);
    /* Chrome intercepts intent:// itself: nothing is left behind when it
       resolves, and when it does not the tab is showing the install page the
       user needs. Closing it would hide that page. */
    t('the intent route leaves no tab to clean up', closed.length === 0);
    /* An https destination keeps `noopener`: it is a real page on someone
       else's origin and must not be able to navigate this tab back. */
    const httpsSeen = [];
    const httpsWin = {
      navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/151 Mobile' },
      document: null,
      setTimeout: (fn) => setTimeout(fn, 1)
    };
    /* A handle only for the https route: the fake window has no document, so
       the custom-scheme routes cannot fire and the walk reaches the fallback. */
    httpsWin.open = (url, name, features) => {
      httpsSeen.push([url, features]);
      return String(url).startsWith('https://') ? {} : null;
    };
    const httpsResult = await openWalletHandoff(native, {
      wallet: trust,
      pairingUri: URI,
      fallbackUrl: universal,
      view: httpsWin
    });
    const httpsCall = httpsSeen.find(([url]) => String(url).startsWith('https://'));
    t('an https destination is opened with noopener',
      httpsResult.route === 'universal' && String(httpsCall?.[1]).includes('noopener'));

    /* A wallet with no known Android package falls back to its own scheme — and
       THAT is the tab that used to be left sitting on `trust://wc?uri=…`. */
    const other = { key: 'other', name: 'Other Wallet', native: 'other://', universal: 'https://other.example/' };
    const closedNative = [];
    const openedNative = [];
    const chromeNative = {
      navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/151 Mobile' },
      document: { createElement: () => ({ style: {}, click() {}, remove() {} }), body: { appendChild() {} } },
      setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 5))
    };
    chromeNative.open = (url) => { openedNative.push(url); return { close: () => closedNative.push(1) }; };
    const nativeResult = await openWalletHandoff(walletLink(other.native, URI), {
      pairingUri: URI,
      fallbackUrl: walletLink(other.universal, URI),
      view: chromeNative
    });
    t('a wallet with no package falls back to its own scheme',
      nativeResult.ok && nativeResult.route === 'native' && openedNative[0].startsWith('other://'));
    await sleep(30);
    t('the dead custom-scheme tab is closed behind it', closedNative.length === 1);

    /* A WebView must never be handed an intent URL: nothing there intercepts
       `intent://`, so the navigation would commit and take the dApp with it. */
    const webviewOpened = [];
    const webview = {
      navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14; wv) Chrome/151 Mobile' },
      document: { createElement: () => ({ style: {}, click() {}, remove() {} }), body: { appendChild() {} } },
      setTimeout: (fn) => setTimeout(fn, 1)
    };
    webview.open = (url) => { webviewOpened.push(url); return null; };
    const webviewResult = await openWalletHandoff(native, {
      wallet: trust,
      pairingUri: URI,
      fallbackUrl: universal,
      view: webview
    });
    t('a WebView is never handed an intent URL',
      webviewOpened.every((url) => !url.startsWith('intent://')));
    t('a WebView falls back to the wallet\'s own scheme', webviewResult.route === 'native');

    /* The next report has to be able to say which hop it is standing on. */
    const facts = handoffFacts(chrome);
    t('the health report names the channel and whether intents work',
      facts.channel === 'web' && facts.android === true && facts.intentCapable === true && facts.webview === false);
    t('a WebView is reported as one, and as unable to take an intent',
      handoffFacts(webview).webview === true && handoffFacts(webview).intentCapable === false);
    t('the APK channel carries the Java bridge fact',
      handoffFacts({ navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14)' }, FBTWalletLink: { openWallet: () => true }, Capacitor: { isNativePlatform: () => true } }).javaBridge === true);
  }

  /* ══════════════════ 14b. the session lease ═════════════════════════════ */
  {
    const store = () => {
      const map = new Map();
      return {
        get length() { return map.size; },
        key: (i) => [...map.keys()][i] ?? null,
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => map.set(k, String(v)),
        removeItem: (k) => map.delete(k),
        _map: map
      };
    };

    /* A fresh install: the default window is 60 minutes and it is ALIVE. */
    const s1 = store();
    const rec = writeWalletLease({ address: '0xAbCd000000000000000000000000000000001234', chainId: 56, mode: 'wc', minutes: 60, at: 1_000_000, storage: s1 });
    const live = readWalletLease({ storage: s1, at: 1_000_000 + 59 * 60_000 });
    t('a 60-minute lease is alive one minute before it lapses', rec?.expiresAt === 1_000_000 + 60 * 60_000 && live?.alive === true);
    t('the lease stores no secret — address, mode, chain and a clock',
      JSON.stringify({ ...live }).length < 400 && !/wc:|topic|secret|key/i.test(JSON.stringify(live)));

    /* It LAPSES on the clock the user chose. */
    const gone = readWalletLease({ storage: s1, at: 1_000_000 + 61 * 60_000 });
    t('the lease lapses exactly when the window ends', gone?.alive === false && gone?.remainingMs === 0);

    /* «تا قطع دستی»: minutes 0 means no expiry at all. */
    const s2 = store();
    writeWalletLease({ address: '0xAbCd000000000000000000000000000000001234', mode: 'injected', rdns: 'io.metamask', minutes: 0, at: 1_000_000, storage: s2 });
    const forever = readWalletLease({ storage: s2, at: 1_000_000 + 400 * 24 * 60 * 60_000 });
    t('«until I disconnect» never lapses', forever?.alive === true && forever?.expiresAt === 0);

    /* Rolling: the record is rewritten, the address is kept. */
    const rolled = writeWalletLease({ address: '0xAbCd000000000000000000000000000000001234', mode: 'wc', chainId: 1, minutes: 15, at: 2_000_000, storage: s1 });
    t('rolling the lease moves the expiry and keeps the record honest',
      rolled.expiresAt === 2_000_000 + 15 * 60_000 && readWalletLease({ storage: s1, at: 2_000_000 }).chainId === 1);

    t('an explicit disconnect removes the record', clearWalletLease(s1) === true && readWalletLease({ storage: s1, at: 2_000_000 }) === null);

    /* Storage that refuses (private mode) is not a crash. */
    const hostile = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); }, key() { return null; }, length: 0 };
    t('a blocked storage degrades to no lease instead of throwing',
      writeWalletLease({ address: '0xAbCd000000000000000000000000000000001234', mode: 'wc', storage: hostile }) === null
        && readWalletLease({ storage: hostile }) === null);

    /* Garbage on disk is rejected rather than acted on: acting on it would
       re-attach a wallet from bytes nobody validated. */
    const junk = store();
    junk.setItem(WALLET_LEASE_KEY, JSON.stringify({ v: 1, mode: 'wc', address: 'not-an-address' }));
    junk.setItem('other', '1');
    t('a malformed lease is ignored', readWalletLease({ storage: junk }) === null);

    /* ── the restore policy, which is where the counter-intuitive branch is ── */
    const leaseOf = (mode, alive) => ({ mode, address: '0xabc', alive, expiresAt: alive ? Date.now() + 60_000 : Date.now() - 1 });
    t('a live WalletConnect lease resumes WalletConnect',
      walletRestorePlan({ lease: leaseOf('wc', true) }).action === 'wc');
    t('a live injected lease resumes the injected wallet',
      walletRestorePlan({ lease: leaseOf('injected', true) }).action === 'injected');
    t('a live local lease leaves the attach to the vault path',
      walletRestorePlan({ lease: leaseOf('local', true), hasVault: true }).action === 'local');
    t('a local lease with no vault on disk restores nothing',
      walletRestorePlan({ lease: leaseOf('local', true), hasVault: false }).action === 'none');
    /* The branch a future edit would "simplify" straight back into the bug: an
       EXPIRED lease is the one state that must purge the stored session, so the
       next Connect is a clean first attempt. */
    t('an EXPIRED lease purges the session it described',
      walletRestorePlan({ lease: leaseOf('wc', false), hasStoredSession: true }).expired === true
        && walletRestorePlan({ lease: leaseOf('wc', false), hasStoredSession: true }).action === 'none');
    /* ...while a session with NO lease at all is an install from before this
       feature: it is adopted once rather than disconnected by the update. */
    t('a pre-lease install is adopted, not disconnected',
      walletRestorePlan({ lease: null, hasStoredSession: true }).action === 'wc'
        && walletRestorePlan({ lease: null, hasStoredSession: true }).adopt === true);
    t('nothing on disk means nothing to do',
      walletRestorePlan({}).action === 'none');
    t('the retry ladder is bounded and ends on a clock a user can wait for',
      walletRestoreDelay(0) < walletRestoreDelay(1) && walletRestoreDelay(99) === walletRestoreDelay(WALLET_RESTORE_BACKOFF.length - 1));

    /* The wiring: every attach path writes a lease and the cold start reads it. */
    const ctxSrc = readFileSync('src/context/WalletContext.jsx', 'utf8');
    t('every transport records a lease when it attaches',
      (ctxSrc.match(/grantLease\(/g) || []).length >= 4);
    t('the lease is rolled while the app is in use',
      /rollLease\(\{ force: true \}\)/.test(ctxSrc) && /rollLease\(\)/.test(ctxSrc));
    t('the settings value is the lease duration', /walletSessionMinutes/.test(ctxSrc));
    /* A resume that CANNOT succeed must not spend 100 seconds pretending to
       retry: a `wc` lease whose `wc@2:` session is gone fails fast and says so. */
    t('an impossible WalletConnect resume fails fast instead of burning the ladder',
      /plan\.action === 'wc' && !hasStoredSession\(\)/.test(ctxSrc) && /lease_session_missing/.test(ctxSrc));
  }

  /* ════════════════ 15. the signing boundary («هیج صفحه امضایی نیامد») ═════
   *
   * The report: a deposit was asked for, the wallet app opened, NO signature
   * screen appeared, and the app answered «شبکه در دسترس نیست» — a sentence
   * about the internet, for a request the session could never have carried.
   *
   * What is locked here is that each way a signature can be undeliverable is
   * named for what it is, that the two automatic fixes are tried once each
   * before the user is told anything, and that a wait is bounded on a clock
   * that measures the user rather than the network.
   */
  {
    const session = {
      namespaces: {
        eip155: {
          chains: ['eip155:56', 'eip155:8453'],
          methods: ['eth_sendTransaction', 'personal_sign'],
          accounts: ['eip155:56:0xabc0000000000000000000000000000000000001']
        }
      }
    };
    const ADDR = '0xabc0000000000000000000000000000000000001';

    const coverage = sessionCoverage(session);
    t('the session coverage names the approved methods',
      coverage.methods.has('eth_sendTransaction'));
    t('the session coverage names the approved accounts',
      coverage.accounts.has('eip155:56:' + ADDR));
    t('an approved chain with no account for it is NOT silently treated as covered',
      !coverage.accounts.has('eip155:8453:' + ADDR) && coverage.chains.has('eip155:8453'));

    t('no session at all is named as one',
      preflightSignRequest({ method: 'eth_sendTransaction', chainId: 56, address: ADDR })
        .code === SIGN_ERRORS.SESSION_GONE);
    t('a closed relay socket is named as one, and it is fixable', (() => {
      const out = preflightSignRequest({
        session, method: 'eth_sendTransaction', chainId: 56, address: ADDR, relayConnected: false
      });
      return out.code === SIGN_ERRORS.RELAY_DOWN && out.fix === 'reopen';
    })());
    t('a method the wallet never approved is named as one',
      preflightSignRequest({ session, method: 'eth_signTypedData_v4', chainId: 56, address: ADDR })
        .code === SIGN_ERRORS.METHOD_UNAPPROVED);
    t('a chain the session approves but has no account for is FIXABLE by switching', (() => {
      const out = preflightSignRequest({
        session, method: 'eth_sendTransaction', chainId: 8453, address: ADDR
      });
      return out.code === SIGN_ERRORS.CHAIN_UNAPPROVED && out.fix === 'switch';
    })());
    t('a chain the session never approved is named as one, with no fix', (() => {
      const out = preflightSignRequest({
        session, method: 'eth_sendTransaction', chainId: 42161, address: ADDR
      });
      return out.code === SIGN_ERRORS.CHAIN_NOT_APPROVED && !out.fix;
    })());
    t('a request the session covers passes',
      preflightSignRequest({ session, method: 'eth_sendTransaction', chainId: 56, address: ADDR }).ok === true);
    t('a namespace it cannot read FAILS OPEN — never a refusal it invented',
      preflightSignRequest({ session: { namespaces: {} }, method: 'eth_sendTransaction', chainId: 56, address: ADDR }).ok === true);
    t('no account in the session is named, not guessed',
      preflightSignRequest({ session, method: 'eth_sendTransaction', chainId: 56, address: null })
        .code === SIGN_ERRORS.NO_ACCOUNT);

    /* ── classification: every one of these used to arrive as «the network» ── */
    t('a session that no longer exists is not the network',
      classifySignError(new Error("No matching key. session topic doesn't exist: abc"))
        === SIGN_ERRORS.SESSION_GONE);
    t('an unanswered request is not the network',
      classifySignError(new Error('WALLET_NO_RESPONSE')) === SIGN_ERRORS.NO_RESPONSE);
    t('a dead socket is not «your internet is weak»',
      classifySignError(new Error('websocket closed abnormally')) === SIGN_ERRORS.RELAY_DOWN);
    t('an unapproved method is named as one',
      classifySignError(new Error('Unauthorized method: eth_signTypedData_v4'))
        === SIGN_ERRORS.METHOD_UNAPPROVED);
    t('a user rejection is left alone — the caller owns 4001',
      classifySignError({ message: 'User rejected the request', code: 4001 }) === null);
    t('an unknown error is left alone rather than guessed at',
      classifySignError(new Error('something else entirely')) === null);

    /* ── the wrapper itself ──────────────────────────────────────────────── */
    const makeProvider = ({ relay = 'connected', accounts = [ADDR], chainId = 56 } = {}) => {
      const calls = [];
      const relayerState = { connected: relay === 'connected', connecting: relay === 'connecting', transportOpen: null };
      const provider = {
        chainId,
        accounts,
        session,
        calls,
        relayerState,
        request: async ({ method, params }) => {
          calls.push({ method, params });
          if (method === 'eth_sendTransaction') return '0xdeadbeef';
          if (method === 'wallet_switchEthereumChain') {
            /* The wallet moves, and the session's account follows it. */
            provider.accounts = accounts.map((a) => a);
            provider.chainId = Number(params?.[0]?.chainId ? params[0].chainId : chainId);
            return null;
          }
          if (method === 'eth_chainId') return `0x${Number(chainId).toString(16)}`;
          return null;
        }
      };
      provider.signer = {
        client: {
          core: {
            relayer: {
              get connected() { return relayerState.connected; },
              get connecting() { return relayerState.connecting; },
              transportOpen: async () => { relayerState.connected = true; return true; }
            }
          }
        }
      };
      return provider;
    };

    {
      const provider = makeProvider();
      const guarded = guardEip1193(provider, { timeoutMs: 200, hardCapMs: 400, doc: null });
      const hash = await guarded.request({ method: 'eth_sendTransaction', params: [{ to: ADDR }] });
      t('a covered signature goes through untouched', hash === '0xdeadbeef');
      t('the request reached the wallet exactly once', provider.calls.length === 1);
      t('the wrapper still exposes the session', guarded.session === session);
      t('the wrapper still exposes the accounts', guarded.accounts === provider.accounts);
      t('the wrapper mirrors data properties LIVE, not as a snapshot', (() => {
        provider.chainId = 8453;
        return guarded.chainId === 8453;
      })());
      t('and a write through the wrapper reaches the provider', (() => {
        guarded.chainId = 137;
        return provider.chainId === 137;
      })());
      t('the wrapper forwards an unrelated method', (await guarded.request({ method: 'eth_chainId' })) === '0x38');
    }

    {
      /* The «no signature screen ever appeared» case: the request is never
         published, and the failure says why instead of blaming the internet. */
      const provider = makeProvider();
      const guarded = guardEip1193(provider, { timeoutMs: 200, hardCapMs: 400, doc: null });
      let thrown = null;
      try {
        await guarded.request({ method: 'eth_signTypedData_v4', params: [] });
      } catch (error) {
        thrown = error;
      }
      t('an undeliverable request is refused before it is published', provider.calls.length === 0);
      t('the refusal carries a machine code, not a network guess',
        thrown?.code === SIGN_ERRORS.METHOD_UNAPPROVED && thrown?.signError === true);
    }

    {
      /* FIX 1 — a closed socket is re-opened before the user hears anything. */
      const provider = makeProvider({ relay: 'closed' });
      const guarded = guardEip1193(provider, { timeoutMs: 400, hardCapMs: 800, doc: null });
      const hash = await guarded.request({ method: 'eth_sendTransaction', params: [{ to: ADDR }] });
      t('a closed relay is re-opened instead of failing the signature', hash === '0xdeadbeef');
      t('the socket is asked to come back exactly once', provider.calls.length === 1);
    }

    {
      /* FIX 2 — an approved chain with no account for it is switched to, and
         the deposit the user asked for is then actually sent. */
      const provider = makeProvider({ chainId: 8453 });
      const guarded = guardEip1193(provider, { timeoutMs: 400, hardCapMs: 800, doc: null });
      /* The account is on 56 while the deposit wants 8453: the chain IS
         approved, so the wallet is asked to move before we give up. */
      provider.accounts = [`eip155:56:${ADDR}`];
      const hash = await guarded.request({ method: 'eth_sendTransaction', params: [{ to: ADDR }] });
      t('a chain the session approved is switched to, not refused',
        provider.calls.some((c) => c.method === 'wallet_switchEthereumChain'));
      t('the deposit is then sent — the wallet is on the network it named', hash === '0xdeadbeef');
    }

    {
      /* A switch the user declines is not a switch: the request stays refused,
         and the refusal is the named one rather than a network guess. */
      const provider = makeProvider({ chainId: 8453 });
      const inner = provider.request;
      provider.request = async ({ method, params }) => {
        if (method === 'wallet_switchEthereumChain') {
          const error = new Error('User rejected the request');
          error.code = 4001;
          throw error;
        }
        return inner({ method, params });
      };
      const guarded = guardEip1193(provider, { timeoutMs: 400, hardCapMs: 800, doc: null });
      provider.accounts = [`eip155:56:${ADDR}`];
      let thrown = null;
      try {
        await guarded.request({ method: 'eth_sendTransaction', params: [{ to: ADDR }] });
      } catch (error) {
        thrown = error;
      }
      t('a declined switch leaves the request refused',
        thrown?.code === SIGN_ERRORS.CHAIN_UNAPPROVED);
      t('and nothing is published into a session that cannot carry it',
        !provider.calls.some((c) => c.method === 'eth_sendTransaction'));
    }

    {
      /* The bound: a request the wallet never answers must end, and end named. */
      const provider = makeProvider();
      provider.request = () => new Promise(() => {});
      const guarded = guardEip1193(provider, { timeoutMs: 30, hardCapMs: 120, doc: null });
      let thrown = null;
      try {
        await guarded.request({ method: 'eth_sendTransaction', params: [] });
      } catch (error) {
        thrown = error;
      }
      t('an unanswered signature ends instead of hanging', thrown?.code === SIGN_ERRORS.NO_RESPONSE);
    }

    {
      /* The nudge: once the request is published, the wallet app is the thing
         the user has to be looking at. */
      const provider = makeProvider();
      const nudges = [];
      const guarded = guardEip1193(provider, {
        timeoutMs: 200, hardCapMs: 400, doc: null,
        onSignatureRequest: (info) => nudges.push(info)
      });
      await guarded.request({ method: 'personal_sign', params: ['0x', ADDR] });
      t('the wallet is nudged once the request is on its way', nudges.length === 1);
      t('the nudge names the method, chain and account',
        nudges[0]?.method === 'personal_sign' && nudges[0]?.chainId === 56 && nudges[0]?.address === ADDR);
      /* A non-signing read must never drag the phone into another app. */
      await guarded.request({ method: 'eth_chainId' });
      t('a plain read never nudges the wallet', nudges.length === 1);
    }
  }

  /* ════════════════ 15b. the portfolio snapshot («موجودی خیلی طول میکشه») ══
   *
   * The last verified read for an address, on the device, so a reload paints
   * the user's numbers in the first frame instead of after sixteen chains have
   * answered. What is locked: it is scoped to one address, it is slimmer than
   * the live read, it refuses to be shown once it is old, and a blocked
   * storage costs nothing but the convenience.
   */
  {
    const ADDR = '0xabc0000000000000000000000000000000000001';
    const OTHER = '0xdef0000000000000000000000000000000000002';
    const memory = () => {
      const map = new Map();
      return {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => { map.set(k, String(v)); },
        removeItem: (k) => { map.delete(k); }
      };
    };

    const chain = {
      chainId: 56,
      nativeAmount: 1.5,
      rows: [
        { key: '56:native', symbol: 'BNB', amount: 1.5, native: true, coingeckoId: 'binancecoin', decimals: 18, chainId: 56 },
        { key: '56:USDT', symbol: 'USDT', amount: 250, coingeckoId: 'tether', decimals: 18, chainId: 56 },
        /* Zero balances are noise in a cache whose only job is the first paint. */
        { key: '56:OLD', symbol: 'OLD', amount: 0, chainId: 56 }
      ]
    };

    const slim = slimChain(chain);
    t('a zero balance is dropped from the snapshot', slim.rows.length === 2);
    t('the slimmer row keeps what the first paint needs',
      slim.rows[0].symbol === 'BNB' && slim.rows[0].amount === 1.5 && slim.rows[0].coingeckoId === 'binancecoin');
    t('the native amount survives', slim.nativeAmount === 1.5);

    const store = memory();
    t('writing for an address succeeds',
      writePortfolioSnapshot({ address: ADDR, chains: [chain], at: 1_700_000_000_000, storage: store }) === true);
    const read = readPortfolioSnapshot(ADDR, { storage: store, at: 1_700_000_000_000 + 60_000 });
    t('the same address reads it back', read?.chains?.[0]?.chainId === 56);
    t('the rows come back with their amounts', read?.chains?.[0]?.rows?.[0]?.symbol === 'BNB');
    t('another address reads nothing at all',
      readPortfolioSnapshot(OTHER, { storage: store, at: 1_700_000_000_000 + 60_000 }) === null);
    t('a week-old snapshot is not shown',
      readPortfolioSnapshot(ADDR, { storage: store, at: 1_700_000_000_000 + 8 * 24 * 3600_000 }) === null);
    t('clearing leaves nothing behind', (() => {
      clearPortfolioSnapshot(store);
      return readPortfolioSnapshot(ADDR, { storage: store, at: 1_700_000_000_000 + 60_000 }) === null;
    })());
    t('a corrupt record is ignored rather than acted on', (() => {
      const broken = memory();
      broken.setItem('fbt-portfolio-snapshot-v1', '{not json');
      return readPortfolioSnapshot(ADDR, { storage: broken, at: Date.now() }) === null;
    })());
    t('a blocked storage is survivable — the snapshot is optional', (() => {
      const blocked = {
        getItem() { throw new Error('blocked'); },
        setItem() { throw new Error('blocked'); },
        removeItem() { throw new Error('blocked'); }
      };
      return writePortfolioSnapshot({ address: ADDR, chains: [chain], storage: blocked }) === false &&
        readPortfolioSnapshot(ADDR, { storage: blocked }) === null;
    })());
    t('a snapshot for a non-address is refused', buildSnapshot({ address: 'not-an-address', chains: [chain] }) === null);
  }

  /* ══════════════════ 15. wiring guards (source, not behaviour) ══════════ */
  {
    const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const ctx = strip(readFileSync('src/context/WalletContext.jsx', 'utf8'));
    const sheet = strip(readFileSync('src/components/WalletConnectSheet.jsx', 'utf8'));
    const panel = strip(readFileSync('src/components/WalletHealthPanel.jsx', 'utf8'));
    const health = strip(readFileSync('src/lib/wc/health.js', 'utf8'));

    t('the context reads the stack from one module, not from scattered files',
      /from '\.\.\/lib\/wc'/.test(ctx));

    /* The boot hygiene, in the order it has to run: the retired surface's keys
       first (one of them makes the SDK build a frame in a CONSTRUCTOR), then
       the orphan check that counts what is left. */
    t('the retired keys are purged before the orphan hygiene counts anything',
      ctx.indexOf('purgeEmbeddedWalletKeys()') > -1
        && ctx.indexOf('purgeEmbeddedWalletKeys()') < ctx.indexOf('storageFacts()'));
    t('both purges name themselves in the trace',
      /embedded_legacy_purged/.test(ctx) && /orphan_storage_purged/.test(ctx));
    t('the orphan purge has no session-evidence gate left to consult',
      !/sdkSessionFacts|hasEmailMarker|email_orphan_kept/.test(ctx));

    /* ONE resume, THREE transports, no sequencing.
       The stored `wc@2:` session used to wait behind an email restore that
       could starve it whenever a marker survived a failed login; since
       2026-09-18 it is planned from the session LEASE instead, and the plan
       covers the injected wallet and the in-app vault too — which is what makes
       a refresh stop looking like a disconnect. */
    t('the resume is plan-driven, not a single WalletConnect attempt',
      /walletRestorePlan\(/.test(ctx) && /restoreWcSession\(\{ announce: false \}\)/.test(ctx)
        && !/resumeEmailThenWc/.test(ctx));
    t('a local vault still wins the cold start',
      /!vault && \(plan\.action === 'wc' \|\| plan\.action === 'injected'\)/.test(ctx));
    t('a failed resume is retried on a bounded ladder, not abandoned',
      /scheduleWalletRestore/.test(ctx) && /walletRestoreDelay\(/.test(ctx));
    t('an injected wallet is re-attached silently — never with a prompt',
      /restoreInjected/.test(ctx) && /method: 'eth_accounts'/.test(ctx)
        && !/restoreInjected[\s\S]{0,400}eth_requestAccounts/.test(ctx));
    t('an explicit disconnect drops the lease first', (() => {
      const at = ctx.indexOf('const disconnect = useCallback');
      const body = ctx.slice(at, at + 900);
      return body.indexOf('dropLease()') > -1 && body.indexOf('dropLease()') < body.indexOf('wcRef.current?.disconnect()');
    })());
    /* The balance contract, asserted on CODE (this probe strips comments):
       the failure branch of refreshBalance must not blank the number the user
       is reading. It did, once — and it ran on a 30-second interval. */
    t('the balance keeps its last good value across a failed read', (() => {
      const at = ctx.indexOf('const refreshBalance = useCallback');
      if (at < 0) return false;
      const body = ctx.slice(at, at + 1400);
      const catchAt = body.indexOf('} catch {');
      if (catchAt < 0) return false;
      const catchBody = body.slice(catchAt, catchAt + 220);
      return !/setNativeBalance\(null\)/.test(catchBody);
    })());

    /* Every way the lease can end is explained where it ends. An unexplained
       return to «not connected» is the exact report this feature answers. */
    const locale = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));
    t('a lapsed or missing session is explained on the sheet',
      /wallet\.sessionLapsed/.test(sheet) && /wallet\.sessionGone/.test(sheet));
    t('both sentences exist in English, the fallback every locale reads',
      Boolean(locale.wallet.sessionLapsed) && Boolean(locale.wallet.sessionGone));

    /* The transports that are left, and the one attach path they share. */
    t('the sheet offers WalletConnect, the injected wallets and the vault',
      /connectWalletConnect/.test(sheet) && /connectInjected/.test(sheet) && /hasVault\(\)/.test(sheet));
    t('every external attach goes through the one adapter, with no email branch',
      (ctx.match(/attachExternal\(\{/g) || []).length === 2 && !/nextMode === 'email'/.test(ctx));
    t('a failed attach says so instead of degrading into a proxy signer',
      /wc_attach_failed/.test(ctx) && !/_isFallback/.test(ctx));

    t('no component reaches past the stack into a deleted module',
      !/lib\/(wcWallets|wcDeepLink|wcStorage|wcTimeout|wcTrace|wcRelayProbe|wcChain|wcAppKitPatch|emailSocialWallet|emailConnection|walletHealth)|lib\/wc\/embedded/.test(ctx + sheet + panel));
    t('the deleted modules are really gone', (() => {
      const files = ['wcWallets', 'wcDeepLink', 'wcStorage', 'wcTimeout', 'wcTrace', 'wcRelayProbe',
        'wcChain', 'wcAppKitPatch', 'emailSocialWallet', 'emailConnection', 'walletHealth',
        'wc/embedded'];
      return files.every((f) => !existsSync(`src/lib/${f}.js`));
    })());
    t('the wallet-facing URL is never the runtime origin',
      !/url:\s*window\.location\.origin/.test(ctx));
    t('the project id is not duplicated into the components',
      !/5997d5aee8bb42f43ddec4b1a5f94eb1/.test(sheet + panel));
    t('the sheet never opens a wallet with _self or _top',
      !/open\([^)]*'_(self|top)'/.test(sheet));
    t('the stack does not import React', (() => {
      const files = readdirSync('src/lib/wc').filter((f) => f.endsWith('.js'));
      return files.every((f) => !/from 'react/.test(readFileSync(`src/lib/wc/${f}`, 'utf8')));
    })());

    /* The panel prints the hops that are left, and nothing about the login that
       is gone: no feature summary, no frame probe, no usage limits. */
    t('the panel reads no settings from the removed surface',
      !/emailOptions|SOCIAL_PROVIDERS|projectSourceNote|secureSite|report\.usage/.test(panel + health));
    t('the panel keeps the three rows a WalletConnect report needs',
      /healthProject/.test(panel) && /healthOrigins/.test(panel) && /healthRelay/.test(panel));
    t('the panel names the retired keys when a device still carries them',
      /legacyEmbeddedKeys/.test(panel) && /legacyEmbeddedKeys/.test(health));
  }

  return rows;
}

/* Standalone run: node test/walletconnect-stack-probe.mjs */
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const rows = await run();
  for (const [name, ok] of rows) console.log(`  ${ok ? '✓' : '✗'} ${name}`);
  const failed = rows.filter(([, ok]) => !ok).length;
  console.log(failed ? `\n${failed} FAILED of ${rows.length}\n` : `\nAll ${rows.length} wallet-connect checks passed.\n`);
  process.exit(failed ? 1 : 0);
}
