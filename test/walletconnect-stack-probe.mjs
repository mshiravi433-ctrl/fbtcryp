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
import { readFileSync } from 'node:fs';

import {
  MOBILE_WALLETS,
  PAIRING_TTL_MS,
  TIMEOUT,
  androidIntentLink,
  appKitCustomWallets,
  cancelSwitch,
  chainFromSession,
  clearPhantomAuthConnection,
  assertEmailRouting,
  classifyConnectError,
  collectWalletHealth,
  decideWalletOpen,
  filterSocialsByPlatform,
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
  pauseBound,
  readSharedConnectionFacts,
  resetSharedConnectionState,
  sleep,
  linkBase,
  looksLikePairingUri,
  openWalletHandoff,
  openWalletLink,
  pairingUriFromLink,
  parseChainId,
  platformFlags,
  purgeConnectionKeys,
  repairPairingInLink,
  repairPairingUri,
  storageFacts,
  summarizeProjectConfig,
  uriRoundTrips,
  walletByKey,
  walletForUrl,
  walletLink,
  walletLinks,
  walletLogo,
  withTimeout
} from '../src/lib/wc/index.js';
import { createWcSession } from '../src/lib/wc/session.js';
import { measureRelay, probeRelay, relayOrderFromHosts, relayVerdict } from '../src/lib/wc/relay.js';
import {
  EMAIL_FRAME_CHAIN_IDS,
  SOCIAL_PROVIDERS,
  authConnectorProvider,
  awaitAccount,
  buildNetworks,
  classifyEmailMarker,
  clearFrameChainResidue,
  emailOptions,
  isEmailFrameChain,
  openSurfaceDetail,
  probeSigning,
  rearmSdkLoginMarker,
  rollback as rollbackEmailMarker,
  sdkLoginMarkerPresent,
  sdkSessionFacts,
  switchEmbeddedNetwork
} from '../src/lib/wc/embedded.js';
import { assertEmailNetwork } from '../src/lib/wc/appkit.js';
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

/* A realistic v2 pairing URI: the punctuation is what encoding must preserve. */
const URI = 'wc:7f6e4f2c1c9b4a4f9e2f1a0b3c4d5e6f@2?relay-protocol=irn&symKey=9f8e7d6c5b4a';
const FULL_URI = `wc:${'a'.repeat(64)}@2?expiryTimestamp=1780000000&relay-protocol=irn&symKey=${'b'.repeat(64)}`;

/* The slowest relay handshake measured on a REAL device — 2026-09-17, Samsung
   Internet 30 / Android 10, mobile data: `wss://relay.walletconnect.org` opened
   in 4344ms while plain HTTPS to the SAME host answered in 220ms, i.e. the cost
   is the wss handshake and not the network. TIMEOUT.relayProbe exists to be
   larger than this number; the assertion in §6 keeps it that way. */
const MEASURED_RELAY_OPEN_MS = 4_344;

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

    /* web + Android: the package-scoped intent is tried first. */
    const android = { navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/151' } };
    const seen = [];
    android.document = {
      createElement: () => ({ style: {}, click() {}, remove() {} }),
      body: { appendChild() {} }
    };
    android.open = (url) => { seen.push(url); return true; };
    const okAndroid = await openWalletLink(native, {
      wallet: trust,
      walletPackage: trust.androidPackage,
      pairingUri: URI,
      fallbackUrl: universal,
      view: android
    });
    t('Android Chrome opens the package-scoped intent first', okAndroid && seen[0].startsWith('intent://'));

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
    t('the embedded wallet session is NOT (purging it logs a real user out)',
      !isConnectionKey('@appkit-wallet/EMAIL_LOGIN_USED_KEY'));
    t('an AppKit cache is NOT connection state', !isConnectionKey('@appkit/portfolio_cache'));
    t('recent emails are NOT connection state', !isConnectionKey('@appkit/recent_emails'));
    t('an unrelated key is NOT connection state', !isConnectionKey('fbt:vault'));

    /* ── the «disconnect, then a phantom with a balance» keys (AppKit 1.8.19) ──
       The static six-key list predated these; a purge that missed them left the
       SDK believing a logged-out email wallet was still attached, and the next
       login opened as that phantom — address, balance, an input disabled by
       `hasAnyConnection('AUTH')` — instead of the email form. */
    t('@appkit/connections (disables the email input when left) is connection state',
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
      purgeConnectionKeys(fake) === 5);
    t('the persisted AUTH connection is gone (the email input can render enabled)',
      !store.has('@appkit/connections'));
    t('the phantom connected-status is gone', !store.has('@appkit/connection_status'));
    t('the embedded wallet session survives the purge', store.has('@appkit-wallet/EMAIL_LOGIN_USED_KEY'));
    t('the cache survives the purge', store.has('@appkit/portfolio_cache'));
    t('the version-check key survives the purge', store.has('@appkit/latest_version'));
    t('an empty store has no session', !hasStoredSession({ length: 0, key: () => null, getItem: () => null }));

    const facts = storageFacts({
      length: 2,
      key: (i) => ['@appkit/recent_wallet', '@appkit-wallet/EMAIL_LOGIN_USED_KEY'][i],
      getItem: (k) => (k === '@appkit-wallet/EMAIL_LOGIN_USED_KEY' ? 'true' : 'trust')
    });
    t('the SDK login marker is reported', facts.sdkLoginMarker === true);
    t('AppKit keys without a session are reported orphan', facts.orphanKeys === true);
    t('the embedded-wallet prefix is never counted as an AppKit connection key',
      facts.appkitConnectionKeys === 1);

    /* The two facts added with the 1.8.19 orphan fix: the report must name a
       stale 'connected' status and a persisted AUTH connection, because those
       are the exact residues that broke the next email login. */
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

  /* ══════════════════ 9. the embeddes wallet's contract ═══════════════════ */
  {
    const options = emailOptions({ projectId: 'pid', metadata: { name: 'x' } });
    t('the email surface never offers wallet rows (they cannot connect there)',
      options.enableWallets === false && options.features.emailShowWallets === false);
    t('the email surface takes no other connection route',
      options.enableInjected === false && options.enableCoinbase === false
      && options.enableEIP6963 === false && options.enableWalletConnect === false);
    t('the email surface offers email and socials',
      options.features.email === true && options.features.socials.length > 0);
    t('manualWCControl is never set (it would hijack open() to AllWallets)',
      !('manualWCControl' in options));
    t('our own registry leads the network list', options.networks[0].id === 56);
    t('the auth connector exposes its frame provider (the lag-proof EIP-1193 fallback)',
      typeof authConnectorProvider === 'function');

    /* A provider that answers "not ready" for a few ticks must still resolve —
       the «email confirmed, we came back, no wallet» report. */
    let ticks = 0;
    const slowModal = {
      getIsConnectedState: () => ticks >= 2,
      getAddress: () => (ticks >= 2 ? '0xabc' : undefined),
      getWalletProvider: () => (ticks >= 3 ? { request() {} } : null),
      subscribeAccount: () => () => {},
      subscribeState: () => () => {},
      open: async () => {}
    };
    const ticker = setInterval(() => { ticks += 1; }, 20);
    const account = await awaitAccount(slowModal, { timeoutMs: 2000, pollMs: 20, closeGraceMs: 0 });
    clearInterval(ticker);
    t('an account is only reported once the provider is real too', account?.address === '0xabc');
    t('the provider is handed over with the address', Boolean(account?.provider));

    t('a modal that never answers resolves null instead of hanging',
      (await awaitAccount({ getIsConnectedState: () => false }, { timeoutMs: 60, pollMs: 20, closeGraceMs: 0 })) === null);

    const store = new Map([['fbt_email_social_connected', '1']]);
    const fake = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, v),
      removeItem: (k) => store.delete(k)
    };
    t('the SDK login marker is re-armed when ours stands and theirs is gone',
      rearmSdkLoginMarker(fake) === 'rearmed');
    t('re-arming twice reports present, not rearmed', rearmSdkLoginMarker(fake) === 'present');
    t('without our marker nothing is written',
      rearmSdkLoginMarker({ getItem: () => null, setItem() {} }) === 'not_marked');

    /* The pure read that gates the awaited forget in connectEmailSocial: our
       marker says a login was ATTEMPTED, the SDK's says the frame still
       HOLDS one. The 2026-09-18 report had ours standing and theirs deleted
       — the exact state where the honest move is to forget, not to hope. */
    const owedStore = new Map([
      ['fbt_email_social_connected', '1'],
      ['@appkit-wallet/EMAIL_LOGIN_USED_KEY', 'true']
    ]);
    t('a standing SDK marker is reported (a live frame session may be owed)',
      sdkLoginMarkerPresent({
        getItem: (k) => (owedStore.has(k) ? owedStore.get(k) : null)
      }) === true);
    t('the reported-state (ours standing, theirs deleted) is reported as not owed',
      sdkLoginMarkerPresent({ getItem: (k) => (k === 'fbt_email_social_connected' ? '1' : null) }) === false);
    t('the read never writes (unlike the re-arm, it can gate decisions)',
      (() => {
        const writes = [];
        sdkLoginMarkerPresent({
          getItem: () => null,
          setItem: (k) => writes.push(k),
          removeItem: (k) => writes.push(k)
        });
        return writes.length === 0;
      })());
    t('a rollback keeps the marker when the SDK still reports a session',
      (await rollbackEmailMarker({ getIsConnectedState: () => true, getAddress: () => '0xabc' })) === false);
    t('a rollback clears it only on a definitive no', (await rollbackEmailMarker(null)) === true);
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

    /* ─── what the project row means ─────────────────────────────────────────
       The report that made this section grow: Samsung Internet 30 / Android 10
       answered `{ id:'social_login', isEnabled:true, config:null }` and the
       panel printed «email=false socials=0». `ConfigUtil.processFeature()` says
       the opposite — `if (apiConfig?.config === null) return
       processFallbackFeature(…)`, i.e. AppKit never looks at the dashboard and
       uses the `features` we hand `createAppKit()`. Each path is held here. */
    const ANDROID = {
      userAgent: 'Mozilla/5.0 (Linux; Android 10; SM-A505F) AppleWebKit/537.36'
        + ' (KHTML, like Gecko) SamsungBrowser/30.0 Chrome/122.0.0.0 Mobile Safari/537.36',
      pointerCoarse: true
    };
    const DESKTOP = {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        + ' (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
    };
    const listPayload = (config, isEnabled = true) => ({
      features: [{ id: 'social_login', isEnabled, config }]
    });
    /* The settings themselves are the reference for every "local" answer. */
    const asked = emailOptions({ projectId: 'pid', metadata: null }).features;

    const arrayPayload = listPayload(['email', 'google', 'x']);
    const fromArray = summarizeProjectConfig(arrayPayload, DESKTOP);
    t('the array payload shape is read the way the SDK reads it', fromArray.shape === 'array');
    t('a real list is the dashboard answer',
      fromArray.source === 'dashboard' && fromArray.configKind === 'list');
    t('email is on when the list carries it', fromArray.email === true);
    t('socials are the list minus email',
      fromArray.socials.length === 2 && !fromArray.socials.includes('email'));
    t('the raw list is reported as it arrived',
      fromArray.config.length === 3 && fromArray.config[0] === 'email');
    t('a list the dashboard switched off is off — not our local list', (() => {
      const off = summarizeProjectConfig(listPayload(['email', 'google'], false), DESKTOP);
      return off.source === 'dashboard' && off.email === false && off.socials.length === 0;
    })());
    t('an empty dashboard list is off, not the seven local providers', (() => {
      const empty = summarizeProjectConfig(listPayload([]), DESKTOP);
      return empty.source === 'dashboard' && empty.email === false && empty.socials.length === 0;
    })());

    /* config === null → `processFallbackFeature()` → OUR features. */
    const withheld = summarizeProjectConfig(listPayload(null), DESKTOP);
    t('a withheld list is null, never an empty one',
      withheld.config === null && withheld.configKind === 'null');
    t('a withheld list is not the dashboard answer', withheld.source === 'local');
    t('a withheld list leaves email on — isEnabled is never read',
      withheld.email === true && withheld.email === (asked.email === true));
    t('a withheld list falls back to our own provider list',
      withheld.socials.length === SOCIAL_PROVIDERS.length
        && withheld.socials.every((name) => SOCIAL_PROVIDERS.includes(name)));
    t('the reported source survives an isEnabled:false answer',
      summarizeProjectConfig(listPayload(null, false), DESKTOP).email === true);

    /* config ABSENT → `if (!apiConfig?.config) return false;` — the opposite. */
    const absent = summarizeProjectConfig({ features: [{ id: 'social_login', isEnabled: true }] }, DESKTOP);
    t('a missing config field is absent, not null',
      absent.configKind === 'absent' && absent.config === null);
    t('a missing config field is OFF — the opposite of null',
      absent.source === 'off' && absent.email === false && absent.socials.length === 0);
    t('no social_login entry at all is OFF too',
      summarizeProjectConfig({ features: [] }, DESKTOP).source === 'off');
    t('a config that is neither a list nor null is OFF, not a guess',
      summarizeProjectConfig(listPayload('email,google'), DESKTOP).source === 'off');

    /* Shapes the SDK's `apiProjectConfig?.find(…)` cannot read. */
    t('an unknown shape says so instead of claiming email is off',
      summarizeProjectConfig({}).shape === 'none');
    t('no features array means the dashboard is never consulted', (() => {
      const none = summarizeProjectConfig({}, DESKTOP);
      return none.source === 'local' && none.email === true
        && none.socials.length === SOCIAL_PROVIDERS.length;
    })());
    t('an object payload is read as AppKit reading its own defaults, not as off', (() => {
      const object = summarizeProjectConfig(
        { features: { social_login: { isEnabled: true, config: ['email'] } } }, DESKTOP);
      return object.shape === 'object' && object.source === 'default' && object.email === true;
    })());

    /* The local value is READ from the settings, so the panel cannot drift. */
    t('the requested row is the object we actually hand createAppKit',
      withheld.requested.email === (asked.email === true)
        && withheld.requested.socials.join(',') === [...asked.socials].join(','));

    /* ─── the platform filter is part of the number ───────────────────────── */
    t('a coarse pointer counts as mobile (CoreHelperUtil.isMobile)',
      platformFlags({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', pointerCoarse: true }).mobile === true);
    t('Chrome on macOS is NOT mac for the SDK — its UA says Safari',
      platformFlags(DESKTOP).mac === false && platformFlags(DESKTOP).mobile === false);
    t('a macOS UA without Safari is mac, without being mobile',
      platformFlags({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15' }).mac === true);

    const phone = summarizeProjectConfig(listPayload(null), ANDROID);
    t('the phone that sent the report keeps email on', phone.email === true);
    t('a mobile browser never renders facebook',
      phone.socials.length === SOCIAL_PROVIDERS.length - 1 && !phone.socials.includes('facebook'));
    t('Telegram on Android also drops x', (() => {
      const list = summarizeProjectConfig(listPayload(null), { ...ANDROID, telegram: true }).socials;
      return !list.includes('facebook') && !list.includes('x') && list.includes('google');
    })());
    t('Telegram on iOS drops google', (() => {
      const list = filterSocialsByPlatform([...SOCIAL_PROVIDERS], platformFlags({
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
        telegram: true
      }));
      return !list.includes('google') && list.includes('facebook') === false && list.includes('x');
    })());
    t('Telegram on macOS drops x', !filterSocialsByPlatform(
      [...SOCIAL_PROVIDERS], platformFlags({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', telegram: true })
    ).includes('x'));
    t('a desktop browser keeps every provider we ask for',
      summarizeProjectConfig(listPayload(null), DESKTOP).socials.length === SOCIAL_PROVIDERS.length);
    t('the filter leaves an empty list empty', filterSocialsByPlatform([], platformFlags(ANDROID)).length === 0);

    const openSocket = class {
      constructor() { setTimeout(() => this.onopen?.(), 3); }
      close() {}
    };
    const report = await collectWalletHealth({
      projectId: 'pid',
      origin: 'https://fbtswap.ir',
      storage: { length: 0, key: () => null, getItem: () => null },
      fetchImpl: async (url) => (String(url).includes('/origins')
        ? { ok: true, status: 200, json: async () => ({ allowedOrigins: ['fbtswap.ir'] }) }
        : { ok: true, status: 200, json: async () => arrayPayload }),
      WebSocketImpl: openSocket,
      timeoutMs: 300,
      trace: () => []
    });
    t('the report carries the project answer', report.projectConfig?.ok === true);
    t('the report names where the project number came from',
      report.projectConfig?.features?.source === 'dashboard'
        && report.projectConfig?.features?.email === true);
    t('the report carries the allowlist verdict', report.allowedOrigins?.originAllowed === true);
    t('the report measures every relay host', Array.isArray(report.relays) && report.relays.length === 2);
    t('the report names a relay verdict', typeof report.relayVerdict === 'string');
    t('the report checks the embedded-wallet frame', Boolean(report.secureSite));
    t('the report carries storage facts', Boolean(report.storage));
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
    const chrome = {
      navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/151 Mobile' },
      document: { createElement: () => ({ style: {}, click() {}, remove() {} }), body: { appendChild() {} } },
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
    t('window.open keeps the handle, so the route is not declared dead',
      opened[0][2] === 'noreferrer' && !String(opened[0][2]).includes('noopener'));
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

  /* ══════════════════ 15. the wc→email hand-over: shared singletons ═══════
     The 2026-09-18 report: after a WalletConnect connect→disconnect cycle,
     tapping «email & social» opened the ACCOUNT view of the dead wallet —
     address, balance, no email form — while every STORAGE fact in the report
     read clean. What survived was the shared controllers' IN-MEMORY state:
     the WalletConnect surface's modal is created by ethereum-provider with
     ZERO adapters, and the SDK's only code that clears ChainController on a
     wallet's death is an ADAPTER listener — one that never exists for an
     adapter-less instance. `getIsConnectedState()` is literally
     Boolean(ChainController.state.activeCaipAddress), so the residue answers
     «connected» to every question the email surface asks. */
  {
    const controllers = await import('@reown/appkit-controllers');
    const { ChainController, ConnectorController, ConnectionController, RouterController } = controllers;

    /* Build the residue a WalletConnect cycle leaves behind — never a real
       address, this is a probe. */
    ChainController.state.activeCaipAddress = 'eip155:56:0xdeadbeefdeadbeefdeadbeefdeadbeef';
    ChainController.state.noAdapters = true;
    ConnectorController.setConnectorId('walletConnect', 'eip155');
    ConnectionController.setConnections([{ connectorId: 'AUTH', accounts: [] }], 'eip155');
    RouterController.state.view = 'Account';

    const factsDirty = await readSharedConnectionFacts();
    t('the shared facts see the residue the storage report cannot',
      factsDirty.available === true && factsDirty.isConnected === true
        && factsDirty.connectorId === 'walletConnect'
        && factsDirty.authConnection === true
        && factsDirty.noAdapters === true);

    /* The snapshot the trace will carry — the whole point is that the NEXT
       report can say which view the modal opened on. */
    const surface = await openSurfaceDetail({
      getIsConnectedState: () => true,
      getAddress: () => '0xdeadbeefdeadbeefdeadbeefdeadbeefdead'
    });
    t('the open-surface snapshot reads what the modal would render',
      surface.view === 'Account' && surface.conn === true
        && surface.addr === true && surface.na === true && surface.cid === 'walletConnect');
    t('the snapshot never carries the address itself',
      !JSON.stringify(surface).toLowerCase().includes('deadbeef'));

    t('the reset runs against the real controllers',
      (await resetSharedConnectionState()) === true);
    const factsClean = await readSharedConnectionFacts();
    t('the phantom address is gone — getIsConnectedState() now answers false',
      factsClean.isConnected === false);
    t('the stale connector id is gone (no reconnect-as-WC on the next boot)',
      factsClean.connectorId === null);
    t('the AUTH entry that disabled the email input is gone',
      factsClean.authConnection === false);
    t('noAdapters is back to false — the email widget can render again',
      factsClean.noAdapters === false);
    t('a second reset on clean state is a harmless no-op',
      (await resetSharedConnectionState()) === true
        && (await readSharedConnectionFacts()).isConnected === false);

    /* Leave the shared page state clean for whatever runs next. */
    RouterController.state.view = 'Connect';
  }

  /* ══════════════════ 15b. the email tap that opened the wallet grid ══════
     The second 2026-09-18 report: «the email option connects sometimes, and
     when it doesn't, the WalletConnect wallet list opens and nothing attaches
     to the app». Reproduced against the shipped singletons: the WalletConnect
     surface boots its AppKit instance adapter-less, and its initialize() sets
     ChainController.state.noAdapters = true — a flag the SDK has no code to
     set back to false. ModalController.open() reads it BEFORE the requested
     view: manualWCControl || (noAdapters && !caipAddress) → the wallet grid.
     `assertEmailRouting()` is the email surface's claim on those flags: it
     must clear exactly them, nothing else. */
  {
    const controllers = await import('@reown/appkit-controllers');
    const { ChainController, OptionsController, ConnectionController } = controllers;

    /* The residue the adapter-less WalletConnect surface leaves behind. */
    ChainController.state.noAdapters = true;
    OptionsController.state.manualWCControl = true;
    OptionsController.state.enableWallets = true;

    /* …next to state the assertion must NOT touch: a live address and a
       connection the user is owed, plus a storage key a frame session holds.
       (Plain node has no localStorage; a stand-in backs the «storage is not
       touched» check for the duration of this section.) */
    const backing = new Map([['@appkit-wallet/EMAIL_LOGIN_USED_KEY', 'true']]);
    globalThis.localStorage = {
      getItem: (k) => (backing.has(k) ? backing.get(k) : null),
      setItem: (k, v) => backing.set(k, String(v)),
      removeItem: (k) => backing.delete(k)
    };

    const owedAddress = 'eip155:56:0x1111111111111111111111111111111111111111';
    ChainController.state.activeCaipAddress = owedAddress;
    ConnectionController.setConnections([{ connectorId: 'AUTH', accounts: [{ address: '0x1111111111111111111111111111111111111111' }] }], 'eip155');

    t('a dirty routing state is reported as fixed, not as clean',
      (await assertEmailRouting()) === 'fixed');
    t('the one-way noAdapters latch is released (the email widget can render)',
      ChainController.state.noAdapters === false);
    t('the WC surface claim on open() routing is released',
      OptionsController.state.manualWCControl === false);
    t('the email popup does not inherit the wallet list',
      OptionsController.state.enableWallets === false);
    t('a live address is NOT touched by the routing assertion',
      ChainController.state.activeCaipAddress === owedAddress);
    t('the owed connection is NOT touched by the routing assertion',
      (await readSharedConnectionFacts()).authConnection === true);
    t('storage is NOT touched (a frame session is owed, not purged)',
      backing.get('@appkit-wallet/EMAIL_LOGIN_USED_KEY') === 'true');

    t('a second assertion on clean state is a no-op that says so',
      (await assertEmailRouting()) === 'clean');
    t('clean state stays clean after a no-op',
      ChainController.state.noAdapters === false
        && OptionsController.state.manualWCControl === false
        && OptionsController.state.enableWallets === false);

    /* The email surface's instance re-asserts the same flags through
       updateOptions — the two paths must agree on the direction. */
    const embedded = await import('../src/lib/wc/embedded.js');
    t('the instance-level re-assert lands on the same flags, in the same direction',
      embedded.reassertFeatures({
        updateOptions: (patch) => {
          /* the same Object.assign the SDK's setOptions performs */
          Object.assign(OptionsController.state, patch);
          return true;
        }
      }) === true
        && OptionsController.state.manualWCControl === false
        && OptionsController.state.enableWallets === false);

    /* Wiring: the assertion runs on the email path — the fresh=false boot
       (the one that skips the full reset on purpose) and again at open(),
       because a late WC init can land between the two. */
    const embeddedSrc = readFileSync('src/lib/wc/embedded.js', 'utf8');
    t('getAppKit asserts the routing before any other decision',
      /const routing = await assertEmailRouting\(\);/.test(embeddedSrc));
    t('the open re-asserts right before the modal is opened',
      /await assertEmailRouting\(\);\s*\n\s*let openError = null;/.test(embeddedSrc));
    t('a fixed routing is traced so the next report can say it happened',
      /email_routing_fixed/.test(embeddedSrc));

    /* Clean up the owed state for whatever runs next. */
    ConnectionController.setConnections([], 'eip155');
    ChainController.state.activeCaipAddress = undefined;
    backing.delete('@appkit-wallet/EMAIL_LOGIN_USED_KEY');
    delete globalThis.localStorage;
  }

  /* ══════════════════ 15c. the email tap on a real phone ═════════════════
     The third 2026-09-18 report (Telegram Android WebView): email/social still
     fails while WalletConnect is healthy, and the snapshot carries the
     signature of a marker nobody can honour — ourMarker=true,
     sdkLoginMarker=false, storedConnectors=[], status=disconnected — with ONE
     event in the trace (`email_appkit_ready`). Four defects, four locks:

       • `fresh = !hasMarker()` meant a stale claim disabled the clean-slate
         path (no purge, no shared reset, no chain cleanup) AND every cold
         start spent the full 30s restore window on it, while WalletContext
         kept the WalletConnect restore gated off;
       • the frame's `LAST_USED_CHAIN_KEY` (its own record of the last chain it
         served) was only cleared on the fresh path, and the ACTIVE CAIP
         network can be adopted from storage — 8 of this app's 16 chains are
         NOT on the frame's hard-coded list, which is what makes the frame
         answer «Action not allowed» / «action not valid»;
       • a raw `wallet_switchEthereumChain` on the embedded wallet is on
         NEITHER of the frame's method lists: AppKit opens the modal, shows
         «Action not allowed» and aborts every pending RPC;
       • the trace was memory-only, i.e. gone exactly when a mobile WebView
         reloads — the reason every report so far ended at «no evidence». */
  {
    const { ChainController, ConnectionController } = await import('@reown/appkit-controllers');
    /* Whatever ran before may have left a connection; this section's verdicts
       depend on an empty shared map. */
    ConnectionController.setConnections([], 'eip155');
    ChainController.state.activeCaipAddress = undefined;

    const fakeStore = () => {
      const backing = new Map();
      return {
        backing,
        get length() {
          return backing.size;
        },
        key: (i) => [...backing.keys()][i] ?? null,
        getItem: (k) => (backing.has(k) ? backing.get(k) : null),
        setItem: (k, v) => backing.set(k, String(v)),
        removeItem: (k) => backing.delete(k)
      };
    };

    /* ── the frame's network list is the truth the surface orders by ── */
    const networks = buildNetworks();
    const ids = networks.map((n) => Number(n.id));
    t('the email surface starts on a chain the frame can serve (DEFAULT_CHAIN first)',
      ids[0] === DEFAULT_CHAIN && isEmailFrameChain(ids[0]));
    t('every frame-supported chain comes before every chain the frame cannot serve',
      ids.every((id, i) => i === 0 || isEmailFrameChain(ids[i - 1]) || !isEmailFrameChain(id)));
    t('no chain is dropped — the WalletConnect surface boots from the same list',
      ids.length === Object.keys(EVM_CHAINS).length);
    t('the supported list is our registry ∩ the frame\'s own list',
      EMAIL_FRAME_CHAIN_IDS.every((id) => Boolean(EVM_CHAINS[id]))
        && EMAIL_FRAME_CHAIN_IDS.every((id) => ids.includes(id))
        && !isEmailFrameChain(146) && !isEmailFrameChain(5000) && !isEmailFrameChain(80094));

    /* ── chain residue: normalized everywhere, never on the fresh path only ── */
    const residueStore = fakeStore();
    residueStore.setItem('@appkit-wallet/LAST_USED_CHAIN_KEY', '146');
    const dropped = clearFrameChainResidue(residueStore);
    t('the frame\'s last-used chain is dropped when the frame cannot serve it',
      dropped.removed.includes('@appkit-wallet/LAST_USED_CHAIN_KEY')
        && residueStore.getItem('@appkit-wallet/LAST_USED_CHAIN_KEY') === null);
    residueStore.setItem('@appkit-wallet/LAST_USED_CHAIN_KEY', 'eip155:56');
    t('a supported last-used chain is the user\'s own choice and survives',
      clearFrameChainResidue(residueStore).removed.length === 0
        && residueStore.getItem('@appkit-wallet/LAST_USED_CHAIN_KEY') === 'eip155:56');

    /* ── the marker verdict: a stale claim is not a session ── */
    const markerStore = fakeStore();
    t('no marker is not a claim', (await classifyEmailMarker({ storage: markerStore })) === 'none');
    markerStore.setItem('fbt_email_social_connected', '1');
    t('our marker with the frame\'s marker gone and nothing connected is STALE',
      (await classifyEmailMarker({ storage: markerStore })) === 'stale');
    markerStore.setItem('@appkit-wallet/EMAIL_LOGIN_USED_KEY', 'true');
    t('the frame\'s own marker means a session may be owed — never forgotten',
      (await classifyEmailMarker({ storage: markerStore })) === 'owed');
    markerStore.removeItem('@appkit-wallet/EMAIL_LOGIN_USED_KEY');
    t('a connected instance is owed its session, marker or not',
      (await classifyEmailMarker({
        storage: markerStore,
        modal: { getIsConnectedState: () => true }
      })) === 'owed');

    /* ── the active network: pruned in storage, pinned in memory ── */
    const networkStore = fakeStore();
    networkStore.setItem('@appkit/active_caip_network_id', 'eip155:146');
    globalThis.localStorage = networkStore;
    const networkArgs = {
      networks,
      supportedChainIds: EMAIL_FRAME_CHAIN_IDS,
      defaultChainId: DEFAULT_CHAIN
    };
    t('an unsupported chain picked in storage is pruned before the boot reads it',
      (await assertEmailNetwork(networkArgs)) === 'fixed'
        && networkStore.getItem('@appkit/active_caip_network_id') === null);
    ChainController.state.activeCaipNetwork = { id: 146, caipNetworkId: 'eip155:146', chainNamespace: 'eip155' };
    t('an unsupported ACTIVE network is pinned to the default the frame serves',
      (await assertEmailNetwork(networkArgs)) === 'fixed'
        && Number(ChainController.state.activeCaipNetwork?.id) === DEFAULT_CHAIN);
    t('a supported active network is left exactly as it is',
      (await assertEmailNetwork(networkArgs)) === 'clean'
        && Number(ChainController.state.activeCaipNetwork?.id) === DEFAULT_CHAIN);
    ChainController.state.activeCaipNetwork = { id: 5000, caipNetworkId: 'eip155:5000', chainNamespace: 'eip155' };
    ChainController.state.activeCaipAddress = 'eip155:5000:0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
    t('a live address is never yanked onto another chain — it is reported blocked',
      (await assertEmailNetwork(networkArgs)) === 'blocked'
        && Number(ChainController.state.activeCaipNetwork?.id) === 5000);
    ChainController.state.activeCaipNetwork = undefined;
    ChainController.state.activeCaipAddress = undefined;
    delete globalThis.localStorage;

    /* ── the switch the frame actually implements ── */
    t('the email wallet refuses a chain the frame cannot serve before asking for it',
      (await switchEmbeddedNetwork(146)) === 'unsupported_chain');
    t('with no instance there is nothing to switch (and no request is sent)',
      (await switchEmbeddedNetwork(56)) === 'no_instance');

    /* ── the trace now survives the reload that used to erase it ── */
    wcTraceReset();
    const mirror = fakeStore();
    wcEvent('email_marker_stale', 4);
    wcEventDetail('email_open_surface', { view: 'Connect', op: 'pending', conn: false });
    t('the mirror is written as the events happen', wcTracePersist(mirror) === true
      && String(mirror.getItem(TRACE_STORAGE_KEY)).includes('email_marker_stale'));
    t('a live buffer is never overwritten by what storage still holds',
      wcTraceHydrate(mirror) === 0);
    wcTraceReset(mirror);
    t('resetting the buffer resets the mirror too', mirror.getItem(TRACE_STORAGE_KEY) === null);
    mirror.setItem(TRACE_STORAGE_KEY, JSON.stringify([
      { at: 1, event: 'email_open_err', d: { m: 'wc:topic@2?symKey=SECRET', view: 'eip155:1:0xdeadbeefdeadbeefdeadbeef', junk: { leak: 1 } } }
    ]));
    const revived = wcTraceHydrate(mirror);
    t('a hostile mirror is re-validated, never trusted',
      revived === 1
        && wcTraceSnapshot()[0].d?.view === 'other'
        && wcTraceSnapshot()[0].d?.m === '[wc]'
        && !JSON.stringify(wcTraceSnapshot()).includes('SECRET'));
    t('a non-event in the mirror is refused outright',
      reviveEntry({ event: '' }) === null && reviveEntry(null) === null && reviveEntry({ at: 1, event: 'ok' })?.event === 'ok');
    wcTraceReset(mirror);

    /* ── the health report can now NAME the two facts it never had ── */
    const factsStore = fakeStore();
    factsStore.setItem('fbt_email_social_connected', '1');
    factsStore.setItem('@appkit/connection_status', 'disconnected');
    factsStore.setItem('@appkit/active_caip_network_id', 'eip155:146');
    factsStore.setItem('@appkit/recent_wallet', '{"name":"probe"}');
    factsStore.setItem('@appkit-wallet/LAST_USED_CHAIN_KEY', '146');
    const facts = storageFacts(factsStore);
    t('the report names the AppKit keys that survived, not just how many',
      facts.appkitConnectionKeys > 0 && facts.appkitConnectionKeyNames.includes('@appkit/recent_wallet'));
    t('the report names the chain the email surface would boot on, and whether the frame serves it',
      facts.activeCaipNetworkId === 'eip155:146' && facts.frameChainSupported === false);
    t('the report names the frame\'s own last-used chain',
      facts.frameLastUsedChain === '146');
    t('the report says «stale» instead of leaving it to inference',
      facts.emailMarkerStale === true && facts.ourMarker === true && facts.sdkLoginMarker === false);

    /* ── the ghost that disables the email input ───────────────────────────
       `hasAnyConnection('AUTH')` is the email input's `disabled` binding, and
       it checks the connector ID alone. An AUTH entry with an EMPTY account
       list is residue — the state in which the box opens, the input cannot be
       typed into, and nothing at all reaches the trace. It must not count as
       a session, and it must be removed before the surface renders. */
    const ghostStore = fakeStore();
    ghostStore.setItem('fbt_email_social_connected', '1');

    ConnectionController.setConnections([], 'eip155');
    ChainController.state.activeCaipAddress = undefined;
    ConnectionController.setConnections(
      [{ connectorId: 'AUTH', accounts: [] }, { connectorId: 'walletConnect', accounts: [{ address: '0xabc' }] }],
      'eip155'
    );
    const ghostFacts = await readSharedConnectionFacts();
    t('the report distinguishes an AUTH entry from an AUTH wallet',
      ghostFacts.authConnection === true && ghostFacts.authEntries === 1 && ghostFacts.authAccounts === 0
        && ghostFacts.connectorId === null && ghostFacts.isConnected === false);
    t('a ghost does not vote «owed» — the standing marker is stale, not a session',
      (await classifyEmailMarker({ storage: ghostStore })) === 'stale');
    t('the ghost is removed through the official setter, and only the ghost',
      (await clearPhantomAuthConnection()) === 1
        && ConnectionController.hasAnyConnection('AUTH') === false
        && ConnectionController.hasAnyConnection('walletConnect') === true);

    ConnectionController.setConnections([], 'eip155');
    ConnectionController.setConnections([{ connectorId: 'AUTH', accounts: [] }], 'eip155');
    ChainController.state.activeCaipAddress = 'eip155:56:0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
    t('a wallet that owns the map is never robbed of its entry (that reset is elsewhere)',
      (await clearPhantomAuthConnection()) === 0 && ConnectionController.hasAnyConnection('AUTH') === true);
    ChainController.state.activeCaipAddress = undefined;

    ConnectionController.setConnections([{ connectorId: 'AUTH', accounts: [{ address: '0xabc' }] }], 'eip155');
    t('a real AUTH wallet is a session: left alone, and «owed»',
      (await clearPhantomAuthConnection()) === 0
        && (await readSharedConnectionFacts()).authAccounts === 1
        && (await classifyEmailMarker({ storage: ghostStore })) === 'owed');
    ConnectionController.setConnections([], 'eip155');
    ChainController.state.activeCaipAddress = undefined;

    /* ── wiring: the fixes run where they must ── */
    const embeddedSrc = readFileSync('src/lib/wc/embedded.js', 'utf8');
    t('the open classifies the marker before it trusts it',
      /const markerState = await classifyEmailMarker\(\);/.test(embeddedSrc)
        && /email_marker_stale/.test(embeddedSrc));
    t('a stale claim is forgotten, not restored (and the caller can resume WC)',
      /STALE_CLEARED/.test(embeddedSrc) && /email_restore_stale_cleared/.test(embeddedSrc));
    t('the network is pinned before the provider exists and again before the open',
      (embeddedSrc.match(/assertEmailNetwork\(/g) ?? []).length >= 2 && /email_network_fixed/.test(embeddedSrc));
    t('the chain residue is normalized on every path, not only the fresh one',
      /clearFrameChainResidue\(\)/.test(embeddedSrc)
        && !/if \(fresh\) \{[\s\S]{0,200}@appkit-wallet\/LAST_USED_CHAIN_KEY/.test(embeddedSrc));
    t('the open records whether it settled and what the frame answered last',
      /op: openState/.test(embeddedSrc) && /lastProviderProbeError/.test(embeddedSrc));
    t('the ghost is cleared on every boot, before anything renders',
      /const phantoms = await clearPhantomAuthConnection\(\);/.test(embeddedSrc)
        && /email_phantom_auth_cleared/.test(embeddedSrc));
    t('a ghost is not a session: the classifier weighs accounts, not the id alone',
      /if \(shared\.authAccounts > 0\) return 'owed';/.test(embeddedSrc));
    const healthSrc = readFileSync('src/lib/wc/health.js', 'utf8');
    t('the health report carries the in-memory half too',
      /shared: await sharedFactsSafe\(\)/.test(healthSrc)
        && /authAccounts/.test(readFileSync('src/lib/wc/appkit.js', 'utf8')));
    const ctxSource = readFileSync('src/context/WalletContext.jsx', 'utf8');
    t('the embedded wallet never receives a raw wallet_switchEthereumChain',
      /if \(mode === 'email'\)[\s\S]{0,600}switchEmbeddedNetwork\(targetId\)/.test(ctxSource));
  }

  /* ══════════════════ 15d. the login that arrives late (2026-09-18, Telegram
     Android WebView) ═══════════════════════════════════════════════════════
     The report: the OTP finished AFTER the 30s wait gave up (`email_wait_timeout`
     30.2s after the open, then a healthy frame session in the final storage —
     sdkLoginMarker, connection_status 'connected', AUTH record, authAccounts 2).
     From that moment on nothing in the app knew a session was owed: the marker
     was cleared, the app showed «not connected», signing and switching did not
     exist, and the next cold start's orphan hygiene would have PURGED the live
     session's keys (a silent logout). The locks:

       • `sdkSessionFacts()` — one reader for the SDK's own witnesses
         (login marker / 'connected' status / AUTH record), shared by every
         gate so they cannot disagree about what «a session exists» means;
       • `classifyEmailMarker` weighs those witnesses and the OPEN MODAL
         (a login in progress) before calling a claim stale, and a stale
         verdict now costs one bounded 2s re-measurement — never more, never
         less evidence;
       • `rollback()` releases the marker only on a definitive no (no
         in-memory connection, modal closed, no SDK witness);
       • `probeSigning()` — «متصل» means «can sign»: eth_accounts + one real
         personal_sign, bounded, sanitized;
       • `awaitAccount` is event-driven: an account that arrives via the SDK's
         own subscription is seen at once, not on the next poll tick. */
  {
    const fakeStore = (backing = new Map()) => ({
      backing,
      get length() { return backing.size; },
      key: (i) => [...backing.keys()][i] ?? null,
      getItem: (k) => (backing.has(k) ? backing.get(k) : null),
      setItem: (k, v) => backing.set(k, String(v)),
      removeItem: (k) => backing.delete(k)
    });
    const { ChainController, ConnectionController, ModalController } = await import('@reown/appkit-controllers');
    ConnectionController.setConnections([], 'eip155');
    ChainController.state.activeCaipAddress = undefined;

    /* ── the four witnesses, one reader ── */
    const writes = [];
    const witnessBacking = new Map();
    const spy = {
      length: 0,
      key: () => null,
      getItem: (k) => (witnessBacking.has(k) ? witnessBacking.get(k) : null),
      setItem: (k, v) => { writes.push(`set:${k}`); witnessBacking.set(k, String(v)); },
      removeItem: (k) => { writes.push(`rm:${k}`); witnessBacking.delete(k); }
    };
    t('empty storage is no evidence',
      (() => {
        const f = sdkSessionFacts(spy);
        return f.anyEvidence === false && f.loginMarker === false
          && f.statusConnected === false && f.authStored === false
          && f.authAccounts === 0;
      })());
    t('the reader never writes (it can gate a decision)', writes.length === 0);
    witnessBacking.set('@appkit-wallet/EMAIL_LOGIN_USED_KEY', 'true');
    t('the frame login marker is evidence',
      sdkSessionFacts(spy).loginMarker === true && sdkSessionFacts(spy).anyEvidence === true);
    witnessBacking.delete('@appkit-wallet/EMAIL_LOGIN_USED_KEY');
    witnessBacking.set('@appkit/connection_status', 'connected');
    t('a persisted «connected» status is evidence',
      sdkSessionFacts(spy).statusConnected === true && sdkSessionFacts(spy).anyEvidence === true);
    witnessBacking.set('@appkit/connections',
      JSON.stringify({ eip155: [{ connectorId: 'AUTH', accounts: [{ address: '0xabc' }, { address: '0xdef' }] }] }));
    t('an AUTH record is evidence, and its accounts are counted',
      (() => {
        const f = sdkSessionFacts(spy);
        return f.authStored === true && f.authAccounts === 2 && f.anyEvidence === true;
      })());
    t('and it still never wrote anything', writes.length === 0);

    /* ── the classifier weighs the witnesses, and the open modal ── */
    const markerStore = fakeStore();
    markerStore.setItem('fbt_email_social_connected', '1');
    t('a standing marker with a «connected» status is OWED, not stale',
      (await classifyEmailMarker({
        storage: fakeStore(new Map([
          ['fbt_email_social_connected', '1'],
          ['@appkit/connection_status', 'connected']
        ]))
      })) === 'owed');
    t('a standing marker with an AUTH record is OWED, not stale',
      (await classifyEmailMarker({
        storage: fakeStore(new Map([
          ['fbt_email_social_connected', '1'],
          ['@appkit/connections', JSON.stringify({ eip155: [{ connectorId: 'AUTH', accounts: [{ address: '0xabc' }] }] })]
        ]))
      })) === 'owed');
    /* The report's hit: a visibility-triggered restore 22s into a first
       attempt found the marker standing and the box still on screen — the
       old classifier called it stale and purged four keys. An open modal is
       an attempt in progress and must vote «owed». */
    ModalController.state.open = true;
    t('an open modal (a login in progress) is OWED — never stale under it',
      (await classifyEmailMarker({ storage: markerStore })) === 'owed');
    ModalController.state.open = false;
    t('no witness, modal closed: the claim is stale after the one re-measurement',
      (await classifyEmailMarker({ storage: markerStore })) === 'stale');

    /* ── the marker falls only on a definitive no ── */
    const backing = new Map([
      ['fbt_email_social_connected', '1'],
      ['@appkit/connection_status', 'connected']
    ]);
    const origLocal = globalThis.localStorage;
    globalThis.localStorage = fakeStore(backing);
    t('a rollback keeps the marker while the SDK holds a session',
      (await rollbackEmailMarker(null)) === false && backing.has('fbt_email_social_connected'));
    backing.delete('@appkit/connection_status');
    ModalController.state.open = true;
    const keptUnderModal = await rollbackEmailMarker(null);
    ModalController.state.open = false;
    t('a rollback keeps the marker under an open modal',
      keptUnderModal === false && backing.has('fbt_email_social_connected'));
    t('a rollback releases it on a definitive no',
      (await rollbackEmailMarker(null)) === true && !backing.has('fbt_email_social_connected'));
    if (origLocal === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = origLocal;

    /* ── the signing probe: «متصل» means «can sign» ── */
    const ADDR = '0x1111111111111111111111111111111111111111';
    const SIG = `0x${'ab'.repeat(65)}`;
    t('a provider that signs the probe message is signing-ready',
      (await probeSigning({
        request: async ({ method }) => (method === 'eth_accounts' ? [ADDR] : SIG)
      }, ADDR)).ok === true);
    {
      const r = await probeSigning({
        request: async ({ method }) => {
          if (method === 'eth_accounts') return [ADDR];
          throw new Error('Action not allowed');
        }
      }, ADDR);
      t('a provider that throws «Action not allowed» is not (and the message is kept, sanitized)',
        r.ok === false && /not allowed/i.test(r.error));
    }
    {
      const r = await probeSigning({ request: async () => [] }, ADDR);
      t('a provider with no accounts is not signing-ready',
        r.ok === false && r.error === 'NO_ACCOUNTS');
    }
    {
      const r = await probeSigning({ request: async ({ method }) => (method === 'eth_accounts' ? [ADDR] : SIG) },
        '0x2222222222222222222222222222222222222222');
      t('a provider that answers with a DIFFERENT wallet is not silently adopted',
        r.ok === false && r.error === 'ACCOUNT_MISMATCH');
    }
    {
      const t0 = Date.now();
      const r = await probeSigning({
        request: async ({ method }) => (method === 'eth_accounts' ? [ADDR] : new Promise(() => {}))
      }, ADDR, { timeoutMs: 300 });
      t('a provider that never answers is bounded, not a hang',
        r.ok === false && r.error === 'PROBE_TIMEOUT' && Date.now() - t0 < 2_000);
    }
    t('no provider is a probe failure, not a crash',
      (await probeSigning(null, ADDR)).ok === false && (await probeSigning(null, ADDR)).error === 'NO_PROVIDER');

    /* ── the wait is event-driven: the SDK's own subscription, not a tick ── */
    let lateConnected = false;
    let accountCb = null;
    const lateModal = {
      getIsConnectedState: () => lateConnected,
      getAddress: () => (lateConnected ? ADDR : undefined),
      getWalletProvider: () => (lateConnected ? { request: async () => [ADDR] } : null),
      subscribeAccount: (cb) => { accountCb = cb; return () => {}; },
      subscribeState: () => () => {},
      subscribeCaipNetworkChange: () => () => {}
    };
    const lateStarted = Date.now();
    const lateTimer = setTimeout(() => { lateConnected = true; accountCb?.(); }, 300);
    const late = await awaitAccount(lateModal, { timeoutMs: 4_000, pollMs: 2_000, closeGraceMs: 0 });
    clearTimeout(lateTimer);
    t('an account that arrives 300ms in is seen by the event, not the next poll (2s away)',
      late?.address === ADDR && Date.now() - lateStarted < 1_000);

    let stateCb = null;
    const closedModal = {
      getIsConnectedState: () => false,
      getAddress: () => undefined,
      getWalletProvider: () => null,
      subscribeAccount: () => () => {},
      subscribeState: (cb) => { stateCb = cb; return () => {}; },
      subscribeCaipNetworkChange: () => () => {}
    };
    const closedPromise = awaitAccount(closedModal, { timeoutMs: 10_000, pollMs: 200, closeGraceMs: 100 });
    stateCb?.({ open: true });
    const closeTimer = setTimeout(() => stateCb?.({ open: false }), 60);
    const closedAt = Date.now();
    const closed = await closedPromise;
    clearTimeout(closeTimer);
    t('a dismissed modal without an account resolves null, bounded by the grace (not the 10s backstop)',
      closed === null && Date.now() - closedAt < 3_000);

    /* ── wiring: the open() wait is the hard cap, and the claim is re-armed ── */
    const embeddedSrc = readFileSync('src/lib/wc/embedded.js', 'utf8');
    t('the open wait is event-driven under the five-minute hard cap, not a 30s one-shot',
      /timeoutMs: TIMEOUT\.connectHardCap/.test(embeddedSrc)
        && /closeGraceMs: TIMEOUT\.emailLateGrace/.test(embeddedSrc));
    t('a session the SDK still holds re-arms the claim BEFORE the clean-slate path',
      /email_marker_reclaimed/.test(embeddedSrc)
        && /if \(!hasMarker\(\)\) \{[\s\S]{0,220}sdkSessionFacts\(\)/.test(embeddedSrc));
    t('the wait subscribes to the account, the state, the chain change AND the controller address',
      /subscribeAccount\?\.\(onArrival, 'eip155'\)/.test(embeddedSrc)
        && /subscribeCaipNetworkChange\?\.\(onArrival\)/.test(embeddedSrc)
        && /subscribeKey\?\.\('activeCaipAddress', onArrival\)/.test(embeddedSrc));
  }

  /* ══════════════════ 16. wiring guards (source, not behaviour) ══════════ */
  {
    const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const ctx = strip(readFileSync('src/context/WalletContext.jsx', 'utf8'));
    const sheet = strip(readFileSync('src/components/WalletConnectSheet.jsx', 'utf8'));
    const panel = strip(readFileSync('src/components/WalletHealthPanel.jsx', 'utf8'));

    t('the context reads the stack from one module, not from scattered files',
      /from '\.\.\/lib\/wc'/.test(ctx));
    /* The stale-marker race fix (2026-09-18): an explicit email tap must
       AWAIT the bounded forget — a fire-and-forget one loses to the very
       next read of the marker — and only when no frame session is owed.
       The Telegram report widened «owed» from the SDK's login marker alone
       to the SDK's full session evidence: a session whose login finished
       after our wait gave up is owed even when that marker is gone. */
    t('an email tap awaits the bounded forget, and only when nothing is owed',
      /modeRef\.current !== 'email' && !sdkSessionFacts\(\)\.anyEvidence/.test(ctx)
        && /await forgetEmbeddedWallet\(\)/.test(ctx));
    /* The silent-logout lock: the orphan purge must ask the SDK's own
       witnesses first, and keep the keys — named in the trace — when they
       describe a session the user is owed. */
    t('the orphan purge is locked against a live SDK session',
      /email_orphan_kept/.test(ctx) && /orphan_storage_purged/.test(ctx));
    /* The resume gate: a session can be owed when our marker is gone — the
       email restore runs on the SDK evidence, and re-arms the marker. */
    t('the email restore is gated on the SDK evidence, not the marker alone',
      /hasEmailMarker\(\) \|\| sdkSessionFacts\(\)\.anyEvidence/.test(ctx)
        && /email_late_attach/.test(ctx));
    /* «متصل» means «can sign»: every email attach is probe-gated, and a
       failed probe names itself (sanitized) in the trace instead of
       discovering itself mid-swap. */
    t('every email attach is gated on a real signing probe',
      /probeSigning\(result\.provider, result\.address\)/.test(ctx)
        && /probeSigning\(freshProvider, result\.address\)/.test(ctx)
        && /probeSigning\(result\.provider, result\.address\)/.test(ctx)
        && /email_sign_probe_failed/.test(ctx));
    /* The refused switch: the exact code reaches the UI (context + the
       Swap surface), and each refusal has a sentence — including the
       «signing chain ≠ swap chain» one and the «reconnect email» one. */
    t('a refused network switch reaches the UI with its exact code',
      /setSwitchChainResult\(\{ code: result/.test(ctx)
        && /emailSwitchUnsupported/.test(ctx)
        && /emailSwitchReconnect/.test(ctx));
    const swapSrc = strip(readFileSync('src/pages/Swap.jsx', 'utf8'));
    t('the swap surface names the refused chain (and the way out)',
      /wallet\.switchChainResult/.test(swapSrc)
        && /emailChainSignOnly/.test(swapSrc)
        && /emailChainSwitchFailed/.test(swapSrc));
    /* The two new functions live in the one public surface. */
    const indexSrc = readFileSync('src/lib/wc/index.js', 'utf8');
    t('sdkSessionFacts and probeSigning are exported from the stack surface',
      /sdkSessionFacts/.test(indexSrc) && /probeSigning/.test(indexSrc));
    t('no component reaches past the stack into a deleted module',
      !/lib\/(wcWallets|wcDeepLink|wcStorage|wcTimeout|wcTrace|wcRelayProbe|wcChain|wcAppKitPatch|emailSocialWallet|emailConnection|walletHealth)/.test(ctx + sheet + panel));
    t('the deleted modules are really gone', (() => {
      const files = ['wcWallets', 'wcDeepLink', 'wcStorage', 'wcTimeout', 'wcTrace', 'wcRelayProbe',
        'wcChain', 'wcAppKitPatch', 'emailSocialWallet', 'emailConnection', 'walletHealth'];
      return files.every((f) => {
        try {
          readFileSync(`src/lib/${f}.js`);
          return false;
        } catch {
          return true;
        }
      });
    })());
    t('the wallet-facing URL is never the runtime origin',
      !/url:\s*window\.location\.origin/.test(ctx));
    t('the project id is not duplicated into the components',
      !/5997d5aee8bb42f43ddec4b1a5f94eb1/.test(sheet + panel));
    t('the sheet never opens a wallet with _self or _top',
      !/open\([^)]*'_(self|top)'/.test(sheet));
    t('the stack does not import React', (() => {
      const files = ['config', 'trace', 'timing', 'uri', 'chain', 'wallets', 'handoff', 'storage', 'relay', 'session', 'embedded', 'health'];
      return files.every((f) => !/from 'react/.test(readFileSync(`src/lib/wc/${f}.js`, 'utf8')));
    })());
    /* «email=false socials=0» was a confident wrong number: it never said that
       AppKit had not read the dashboard at all. The row has to name the source. */
    t('the panel prints where the project number came from',
      /projectSourceNote/.test(panel)
        && ['Dashboard', 'Local', 'Default', 'Off'].every((k) => panel.includes(`healthProjectSource${k}`)));
    t('the local value is read from the settings module, never copied into the report',
      /emailOptions\(/.test(readFileSync('src/lib/wc/health.js', 'utf8'))
        && !/SOCIAL_PROVIDERS|emailOptions/.test(panel));
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
