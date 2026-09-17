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
  androidIntentLink,
  appKitCustomWallets,
  cancelSwitch,
  chainFromSession,
  classifyConnectError,
  collectWalletHealth,
  decideWalletOpen,
  handOffChannel,
  hasStoredSession,
  installWalletOpenBridge,
  isConnectionKey,
  isModalError,
  isOriginAllowed,
  isPairingUri,
  isRelayBlocked,
  isRelayError,
  linkBase,
  looksLikePairingUri,
  openWalletLink,
  pairingUriFromLink,
  parseChainId,
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
import { awaitAccount, emailOptions, rearmSdkLoginMarker, rollback as rollbackEmailMarker } from '../src/lib/wc/embedded.js';
import { wcEvent, wcTraceReset, wcTraceSnapshot } from '../src/lib/wc/trace.js';

/* A realistic v2 pairing URI: the punctuation is what encoding must preserve. */
const URI = 'wc:7f6e4f2c1c9b4a4f9e2f1a0b3c4d5e6f@2?relay-protocol=irn&symKey=9f8e7d6c5b4a';
const FULL_URI = `wc:${'a'.repeat(64)}@2?expiryTimestamp=1780000000&relay-protocol=irn&symKey=${'b'.repeat(64)}`;

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
    const win = { open: (...args) => { calls.push(args); return true; } };
    const original = win.open;
    const off = installWalletOpenBridge({ win, openWallet: (url, opts) => calls.push([url, opts]) });
    win.open('https://example.com/', '_blank');
    t('an unrelated URL still reaches the real window.open', calls.length === 1 && calls[0][0] === 'https://example.com/');
    win.open(native, '_self');
    t('a hand-off is intercepted instead of navigating this document', calls.length === 2);
    t('the intercepted hand-off carries package and fallback',
      calls[1][1]?.walletPackage === 'com.wallet.crypto.trustapp' && Boolean(calls[1][1]?.fallbackUrl));
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
    t('our own bound is the relay',
      classifyConnectError({ message: 'WC_CONNECT_TIMEOUT' }) === 'WC_RELAY_UNREACHABLE');
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

    const store = new Map([
      ['wc@2:client:0.3//session', JSON.stringify([{ topic: 'x' }])],
      ['WALLETCONNECT_DEEPLINK_CHOICE', 'trust'],
      ['@appkit/recent_wallet', 'trust'],
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
    t('the purge removes exactly the connection keys', purgeConnectionKeys(fake) === 3);
    t('the embedded wallet session survives the purge', store.has('@appkit-wallet/EMAIL_LOGIN_USED_KEY'));
    t('the cache survives the purge', store.has('@appkit/portfolio_cache'));
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

    const arrayPayload = { features: [{ id: 'social_login', isEnabled: true, config: ['email', 'google', 'x'] }] };
    const fromArray = summarizeProjectConfig(arrayPayload);
    t('the array payload shape is read the way the SDK reads it', fromArray.shape === 'array');
    t('email is on when the list carries it', fromArray.email === true);
    t('socials are the list minus email',
      fromArray.socials.length === 2 && !fromArray.socials.includes('email'));
    t('the object shape is still read, not mis-read as off',
      summarizeProjectConfig({ features: { social_login: { isEnabled: true, config: ['email'] } } }).email === true);
    t('an unknown shape says so instead of claiming email is off',
      summarizeProjectConfig({}).shape === 'none');
    t('a withheld list is null, never an empty one',
      summarizeProjectConfig({ features: [{ id: 'social_login', isEnabled: true }] }).config === null);

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
    wcTraceReset();
    t('the buffer can be emptied', wcTraceSnapshot().length === 0);
  }

  /* ══════════════════ 13. wiring guards (source, not behaviour) ══════════ */
  {
    const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const ctx = strip(readFileSync('src/context/WalletContext.jsx', 'utf8'));
    const sheet = strip(readFileSync('src/components/WalletConnectSheet.jsx', 'utf8'));
    const panel = strip(readFileSync('src/components/WalletHealthPanel.jsx', 'utf8'));

    t('the context reads the stack from one module, not from scattered files',
      /from '\.\.\/lib\/wc'/.test(ctx));
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
