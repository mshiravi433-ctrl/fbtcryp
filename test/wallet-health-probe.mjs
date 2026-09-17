/**
 * WALLET HEALTH PROBE
 * ---------------------------------------------------------------------------
 * The two reports the audit started from («ایمیل تأیید شد ولی والت ساخته نشد»,
 * «تراست باز می‌شود ولی چیزی برای تأیید نمی‌آید») both die on a link that is
 * invisible from the UI: the Reown project configuration, the allowed-origins
 * list, the relay sockets, or the embedded-wallet frame. src/lib/walletHealth.js
 * turns those into a report the user can copy off their own phone.
 *
 * This probe measures the module's reporting rules with every edge held
 * still — no network, no sockets, no storage — because a diagnostic that
 * reports the wrong thing is worse than no diagnostic. It now also locks the
 * two ways the instrument itself lied (see the module header):
 *
 *   1. URL builders: the SDK's own parameter names and encoding.
 *   2. Feature summary: the LIVE array payload (`features: [{id,…}]`, exactly
 *      what `ConfigUtil.getApiConfig()` reads with `.find()`), the legacy object
 *      map, a withheld list, and the malformed payload — no shape may ever
 *      silently read as «email=false socials=0».
 *   3. Relay: EVERY hostname probed, per-host verdicts, timing, close codes,
 *      and the OPEN / WS_REFUSED / UNREACHABLE / TIMEOUT / NO_WEBSOCKET rules.
 *   4. URI round-trip + hand-off builders: the two shapes a wallet's deep-link
 *      route accepts, byte for byte.
 *   5. Storage facts: booleans and counts only, never values.
 *   6. The whole report with injected edges, plus the never-throws promise of
 *      every failure path.
 *   7. The panel is wired into the connect sheet, loads lazily, and prints the
 *      per-host relay rows in all three complete locales.
 */
import { readFileSync } from 'node:fs';
import {
  EMAIL_MARKER_KEY,
  SDK_LOGIN_KEY,
  SECURE_SITE_URL,
  W3M_API_URL,
  WC_RELAY_URL,
  WC_RELAY_URLS,
  collectWalletHealth,
  configProbeUrl,
  handoffUrl,
  originsProbeUrl,
  probeRelay,
  probeRelayHttps,
  relayVerdict,
  socialLoginFeature,
  storageFacts,
  summarizeProjectConfig,
  uriRoundTrips
} from '../src/lib/walletHealth.js';

const PROJECT_ID = '5997d5aee8bb42f43ddec4b1a5f94eb1';

/**
 * THE LIVE ANSWER, COPIED VERBATIM (2026-09-16, this project id):
 * `GET api.web3modal.org/appkit/v1/config?projectId=…&st=appkit&sv=…`.
 * It is a fixture on purpose — the shape of this payload is the whole point of
 * the first correction in the module header, and a hand-written "expected" JSON
 * would have hidden the bug again.
 */
const LIVE_CONFIG_BODY = {
  features: [
    { id: 'multi_wallet', isEnabled: false, config: null },
    { id: 'activity', isEnabled: true, config: null },
    { id: 'swap', isEnabled: true, config: null },
    { id: 'event_tracking', isEnabled: true, config: null },
    { id: 'onramp', isEnabled: true, config: null },
    { id: 'reown_authentication', isEnabled: true, config: [] },
    {
      id: 'social_login',
      isEnabled: true,
      config: ['email', 'google', 'x', 'discord', 'farcaster', 'github', 'apple', 'facebook']
    },
    { id: 'fund_from_exchange', isEnabled: false, config: null },
    { id: 'headless', isEnabled: false, config: null },
    { id: 'payments', isEnabled: true, config: [] },
    { id: 'reown_branding', isEnabled: false, config: null }
  ]
};

/** A fetch double: `(url, init) => {ok, status, json()}` or a rejection. */
const fetchOk = (body) => async () => ({
  ok: true,
  status: 200,
  json: async () => body
});
const fetchStatus = (status) => async () => ({
  ok: false,
  status,
  json: async () => ({})
});
const fetchReject = (message, name = 'TypeError') => async () => {
  const error = new Error(message);
  error.name = name;
  throw error;
};

/**
 * A fetch double that answers the RELAY host and the API host differently —
 * the distinction the new `https` half of each relay row exists for. `relay`
 * is 'ok' (the host answers over HTTPS) or 'error' (nothing answers).
 */
const fetchSplit = ({ config = fetchOk(LIVE_CONFIG_BODY), relay = 'ok' } = {}) => async (url, init) => {
  if (/relay\.walletconnect\.(org|com)/.test(String(url))) {
    if (relay === 'error') throw new TypeError('NetworkError when attempting to fetch resource.');
    return { ok: true, status: 200, json: async () => ({}) };
  }
  return config(url, init);
};

/** A WebSocket double that fires the event the plan names for THAT url. */
const socketPlan = (plan) => {
  const sockets = [];
  class FakeSocket {
    constructor(url) {
      this.url = url;
      sockets.push(this);
      const behaviour = typeof plan === 'function' ? plan(url) : plan;
      queueMicrotask(() => {
        if (behaviour === 'open') this.onopen?.({});
        else if (behaviour === 'error') this.onerror?.({});
        else if (behaviour === 'close') this.onclose?.({ code: 1006 });
        else if (behaviour && typeof behaviour === 'object') this.onclose?.({ code: behaviour.code });
        /* 'silent' intentionally does nothing at all */
      });
    }
    close() { this.closed = true; }
  }
  return { FakeSocket, sockets };
};

/** The one-behaviour-always socket the older assertions were written against. */
const socketThat = (behaviour, { code = 1006 } = {}) => (
  behaviour === 'close' ? socketPlan({ code }) : socketPlan(behaviour)
);

const fakeStorage = (entries) => {
  const map = new Map(Object.entries(entries));
  return {
    get length() { return map.size; },
    key: (i) => Array.from(map.keys())[i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k)
  };
};

export default async function run() {
  const rows = [];
  const t = (name, ok) => rows.push([name, Boolean(ok)]);

  /* ---- 1. URL builders --------------------------------------------------- */
  {
    const config = configProbeUrl(PROJECT_ID);
    const origins = originsProbeUrl(PROJECT_ID);
    const parsed = new URL(config);
    t('the project-config probe targets the SDK’s own endpoint with its own params',
      parsed.origin === W3M_API_URL
        && parsed.pathname === '/appkit/v1/config'
        && parsed.searchParams.get('projectId') === PROJECT_ID
        && parsed.searchParams.get('st') === 'appkit'
        && Boolean(parsed.searchParams.get('sv')));
    t('the allowed-origins probe reads the endpoint checkAllowedOrigins() calls',
      new URL(origins).pathname === '/projects/v1/origins'
        && new URL(origins).searchParams.get('projectId') === PROJECT_ID);
    t('the secure-site constant is the SDK’s own frame host',
      SECURE_SITE_URL === 'https://secure.walletconnect.org/sdk');
    t('the relay list holds BOTH hostnames, SDK default FIRST (@walletconnect/core RELAYER_DEFAULT_RELAY_URL)',
      WC_RELAY_URLS.length === 2
        && WC_RELAY_URLS[0] === 'wss://relay.walletconnect.org'
        && WC_RELAY_URLS[1] === 'wss://relay.walletconnect.com'
        && WC_RELAY_URL === WC_RELAY_URLS[0]
        && WC_RELAY_URLS.every((url) => /^wss:\/\/[a-z0-9.-]+$/.test(url)));
  }

  /* ---- 2. feature summary: the LIVE payload shape ------------------------ */
  {
    const live = summarizeProjectConfig(LIVE_CONFIG_BODY);
    t('the LIVE array payload reads email:true — not the `features.social_login` undefined of an array',
      live.email === true && live.enabled === true && live.shape === 'array'
        && live.raw?.id === 'social_login');
    t('and its socials are the list minus the literal «email» (7 of the 8 names)',
      live.socials.length === 7 && !live.socials.includes('email')
        && live.socials.includes('google') && live.socials.includes('facebook'));
    t('the raw feature rides along so the answer can be read, not summarised away',
      live.config?.length === 8 && live.raw?.config?.includes('email'));

    const found = socialLoginFeature(LIVE_CONFIG_BODY);
    t('the lookup is `.find(f => f.id === …)` — the SDK’s own getApiConfig() rule',
      found.shape === 'array' && found.feature?.id === 'social_login');

    const on = summarizeProjectConfig({
      features: { social_login: { isEnabled: true, config: ['email', 'google', 'apple'] } }
    });
    t('the legacy object map is still read as the feature it names',
      on.shape === 'object' && on.email === true && on.enabled === true
        && on.socials.length === 2 && !on.socials.includes('email'));
    const off = summarizeProjectConfig({
      features: { social_login: { isEnabled: false, config: ['email', 'google'] } }
    });
    t('an enabled flag of false is a hard no, whatever config says', off.email === false && off.enabled === false);
    const missing = summarizeProjectConfig({ features: {} });
    t('a dashboard with no social_login at all degrades to email:false, socials:[], shape:object',
      missing.email === false && missing.socials.length === 0 && missing.raw === null
        && missing.shape === 'object');
    const noFeatures = summarizeProjectConfig({});
    t('a payload with no features at all says shape:none — never «email is off»',
      noFeatures.email === false && noFeatures.shape === 'none' && noFeatures.raw === null);
    const withheld = summarizeProjectConfig({
      features: [{ id: 'social_login', isEnabled: true, config: null }]
    });
    t('a WITHHELD config list is reported as null, not as an empty list of socials',
      withheld.config === null && withheld.socials.length === 0 && withheld.enabled === true);
    const junk = summarizeProjectConfig({
      features: { social_login: { isEnabled: true, config: 'email' } }
    });
    t('a non-array config is never iterated (no crash on a malformed payload)',
      junk.email === false && junk.socials.length === 0);
  }

  /* ---- 3. relay: two hosts, timing, close codes, verdict rules ----------- */
  {
    const open = socketThat('open');
    const openResult = await probeRelay(WC_RELAY_URLS[0], { WebSocketImpl: open.FakeSocket, projectId: PROJECT_ID });
    t('a socket that opens reports success, carries the project id and its own timing',
      openResult.ok === true && openResult.state === 'open'
        && openResult.url === WC_RELAY_URLS[0]
        && Number.isFinite(openResult.ms)
        && open.sockets[0].url.includes(encodeURIComponent(PROJECT_ID))
        && open.sockets[0].url.startsWith('wss://'));

    const bad = socketThat('error');
    const badResult = await probeRelay(WC_RELAY_URLS[0], { WebSocketImpl: bad.FakeSocket, graceMs: 10 });
    t('a socket error is reported as SOCKET_ERROR', badResult.error === 'SOCKET_ERROR');

    const closed = socketThat('close', { code: 1006 });
    const closedResult = await probeRelay(WC_RELAY_URLS[0], { WebSocketImpl: closed.FakeSocket, graceMs: 10 });
    t('a browser handshake failure (1006) stays SOCKET_ERROR and carries the code as a fact',
      closedResult.error === 'SOCKET_ERROR' && closedResult.closeCode === 1006);
    const relayClosed = socketThat('close', { code: 3000 });
    const relayClosedResult = await probeRelay(WC_RELAY_URLS[0], { WebSocketImpl: relayClosed.FakeSocket, graceMs: 10 });
    t('a code the RELAY published is reported as CLOSED_<code> — «refused by the host» is distinguishable',
      relayClosedResult.error === 'CLOSED_3000' && relayClosedResult.closeCode === 3000);

    const silent = socketThat('silent');
    const timedOut = await probeRelay(WC_RELAY_URLS[0], {
      WebSocketImpl: silent.FakeSocket,
      timeoutMs: 30
    });
    t('a socket that never answers is TIMEOUT — the signature of a filtered network',
      timedOut.ok === false && timedOut.error === 'TIMEOUT' && silent.sockets[0].closed === true
        && timedOut.ms >= 25);

    const RealWebSocket = globalThis.WebSocket;
    try {
      delete globalThis.WebSocket;
      t('no WebSocket in the host is reported, never assumed',
        (await probeRelay(WC_RELAY_URLS[0], { WebSocketImpl: null })).error === 'NO_WEBSOCKET');
    } finally {
      if (RealWebSocket) globalThis.WebSocket = RealWebSocket;
    }

    /* The HTTPS door, asked separately from the socket. */
    const httpsOk = await probeRelayHttps(WC_RELAY_URLS[0], { fetchImpl: fetchOk({}) });
    const httpsDead = await probeRelayHttps(WC_RELAY_URLS[0], {
      fetchImpl: fetchReject('NetworkError when attempting to fetch resource.'),
      timeoutMs: 50
    });
    t('the relay’s HTTPS door is probed as an https:// url, and its failure is its own fact',
      httpsOk.ok === true && Number.isFinite(httpsOk.ms)
        && httpsDead.ok === false && /NetworkError/.test(httpsDead.error));

    /* The verdict rule, straight from measured facts. */
    const hostOf = (url, socket, https) => ({ url, socket, https });
    t('verdict OPEN when any host opened a socket',
      relayVerdict([
        hostOf('a', { ok: true }, { ok: false }),
        hostOf('b', { ok: false, error: 'SOCKET_ERROR' }, { ok: true })
      ]).verdict === 'OPEN');
    t('verdict WS_REFUSED when no socket opens but a host answers over HTTPS (DPI on the upgrade)',
      relayVerdict([
        hostOf('a', { ok: false, error: 'SOCKET_ERROR' }, { ok: true }),
        hostOf('b', { ok: false, error: 'SOCKET_ERROR' }, { ok: true })
      ]).verdict === 'WS_REFUSED');
    t('verdict UNREACHABLE when neither door answers',
      relayVerdict([
        hostOf('a', { ok: false, error: 'SOCKET_ERROR' }, { ok: false, error: 'NetworkError' }),
        hostOf('b', { ok: false, error: 'SOCKET_ERROR' }, { ok: false, error: 'NetworkError' })
      ]).verdict === 'UNREACHABLE');
    t('verdict TIMEOUT when every socket is swallowed silently (no HTTPS answer either)',
      relayVerdict([
        hostOf('a', { ok: false, error: 'TIMEOUT' }, { ok: false, error: 'TIMEOUT' }),
        hostOf('b', { ok: false, error: 'TIMEOUT' }, { ok: false, error: 'TIMEOUT' })
      ]).verdict === 'TIMEOUT');
    t('verdict NO_WEBSOCKET / NO_MEASUREMENT for a host with nothing to measure',
      relayVerdict([hostOf('a', { ok: false, error: 'NO_WEBSOCKET' }, { ok: false })]).verdict === 'NO_WEBSOCKET'
        && relayVerdict([]).verdict === 'NO_MEASUREMENT');
    const mixed = relayVerdict([
      hostOf('a', { ok: false, error: 'TIMEOUT' }, { ok: false, error: 'TIMEOUT' }),
      hostOf('b', { ok: false, error: 'SOCKET_ERROR' }, { ok: false, error: 'NetworkError' })
    ]);
    t('one swallowed host and one refused host is UNREACHABLE, not TIMEOUT (the rule needs ALL of them)',
      mixed.verdict === 'UNREACHABLE' && mixed.openUrls.length === 0);
  }

  /* ---- 4. URI hygiene + hand-off bytes ----------------------------------- */
  {
    const uri = 'wc:8f4e1c2b@2?relay-protocol=irn&symKey=abc.DEF-123&expiryTimestamp=1771000000';
    t('a well-formed pairing URI survives one encode/decode round-trip',
      uriRoundTrips(uri) === true && uriRoundTrips(encodeURIComponent(uri)) === false);
    t('non-pairing strings are never called round-trippable',
      uriRoundTrips('') === false && uriRoundTrips('https://fbtswap.ir') === false
        && uriRoundTrips('wc:%zz') === false);
    t('the Trust universal hand-off carries the URI encoded exactly once',
      handoffUrl('trust', uri) === `https://link.trustwallet.com/wc?uri=${encodeURIComponent(uri)}`);
    t('the Trust native scheme is offered for an installed app',
      handoffUrl('trust-native', uri) === `trust://wc?uri=${encodeURIComponent(uri)}`);
    t('an unknown wallet gets the bare URI, and an empty URI gets nothing at all',
      handoffUrl('metamask', uri) === uri && handoffUrl('trust', '') === '');
  }

  /* ---- 5. storage facts -------------------------------------------------- */
  {
    const storage = fakeStorage({
      [SDK_LOGIN_KEY]: 'true',
      [EMAIL_MARKER_KEY]: '1',
      'wc@2:client:0.3//session': JSON.stringify([{ topic: 'a' }]),
      'wc@2:client:0.3//core': JSON.stringify([{ topic: 'b' }]),
      'wc@2:ethereum_provider:/chainId': '56',
      '@appkit/wallet_id': 'x',
      '@appkit/connections': '[{}]',
      'unrelated': 'ignored'
    });
    const facts = storageFacts(storage);
    t('storage facts are booleans and counts, never values',
      facts.sdkLoginMarker === true && facts.ourMarker === true
        && facts.wcSessionKeys === 1 && facts.appkitConnectionKeys === 2);
    t('an empty session array does not count as a session, and no storage is no facts',
      storageFacts(fakeStorage({ 'wc@2:client:0.3//session': '[]' })).wcSessionKeys === 0
        && storageFacts(null).wcSessionKeys === 0);
  }

  /* ---- 6. the whole report ----------------------------------------------- */
  {
    const storage = fakeStorage({
      [SDK_LOGIN_KEY]: 'true',
      [EMAIL_MARKER_KEY]: '1',
      'wc@2:client:0.3//session': JSON.stringify([{ topic: 'a' }])
    });
    const relay = socketThat('open');
    const configBody = {
      features: { social_login: { isEnabled: true, config: ['email', 'google'] } }
    };
    const report = await collectWalletHealth({
      projectId: PROJECT_ID,
      origin: 'https://fbtswap.ir',
      fetchImpl: async (url) => (url.includes('/origins')
        ? { ok: true, status: 200, json: async () => ({ allowedOrigins: ['https://fbtswap.ir'] }) }
        : { ok: true, status: 200, json: async () => configBody }),
      WebSocketImpl: relay.FakeSocket,
      storage,
      userAgent: 'probe/1.0'
    });
    t('the report states origin, project id and agent',
      report.origin === 'https://fbtswap.ir' && report.projectId === PROJECT_ID
        && report.userAgent === 'probe/1.0' && typeof report.at === 'string');
    t('the project-config half reports ok + the parsed features',
      report.projectConfig.ok === true && report.projectConfig.status === 200
        && report.projectConfig.features.email === true
        && report.projectConfig.features.socials.join() === 'google');
    t('the origins half reports the list and the empty-means-allow-all rule',
      report.allowedOrigins.ok === true
        && report.allowedOrigins.list.length === 1
        && report.allowedOrigins.emptyMeansAllowAll === false);
    t('EVERY relay hostname is probed, not just one — with its socket, its HTTPS door and its timing',
      report.relays.length === WC_RELAY_URLS.length
        && report.relays.every((host) => WC_RELAY_URLS.includes(host.url))
        && report.relays.every((host) => host.socket && typeof host.socket.ms === 'number')
        && report.relays.every((host) => host.https && typeof host.https.ok === 'boolean'));
    t('the single-answer `relay` field is the host that OPENED — plus the verdict over all of them',
      report.relay.ok === true && WC_RELAY_URLS.includes(report.relay.url)
        && report.relayVerdict === 'OPEN');
    t('the relay and secure-site halves are present with their verdicts',
      report.relay.ok === true && report.secureSite.ok === true);
    t('the storage half travels with the report (markers + session count)',
      report.storage.sdkLoginMarker === true && report.storage.ourMarker === true
        && report.storage.wcSessionKeys === 1);
    t('a trace function is called for the report, and a missing one is null',
      (await collectWalletHealth({
        projectId: PROJECT_ID,
        fetchImpl: fetchStatus(500),
        WebSocketImpl: socketThat('error').FakeSocket,
        timeoutMs: 30,
        trace: () => [{ kind: 'probe' }]
      })).trace.length === 1
        && (await collectWalletHealth({
          projectId: PROJECT_ID,
          fetchImpl: fetchStatus(500),
          WebSocketImpl: socketThat('error').FakeSocket,
          timeoutMs: 30
        })).trace === null);

    const emptyOrigins = await collectWalletHealth({
      projectId: PROJECT_ID,
      fetchImpl: async (url) => (url.includes('/origins')
        ? { ok: true, status: 200, json: async () => ({ allowedOrigins: [] }) }
        : { ok: true, status: 200, json: async () => configBody }),
      WebSocketImpl: socketThat('open').FakeSocket,
      storage,
      timeoutMs: 30
    });
    t('an EMPTY allowlist is reported as allow-all, never as a block',
      emptyOrigins.allowedOrigins.emptyMeansAllowAll === true && emptyOrigins.allowedOrigins.ok === true);

    /* THE REPORT THE USER ACTUALLY SENT: relay ❌ on one hostname while the
       other host never got asked. Now both are asked, the verdict names the
       shape, and the config half is not a phantom «email=false». */
    const oneBlocked = await collectWalletHealth({
      projectId: PROJECT_ID,
      origin: 'https://fbtswap.ir',
      fetchImpl: fetchSplit({ config: fetchOk(LIVE_CONFIG_BODY), relay: 'error' }),
      WebSocketImpl: socketPlan((url) => (url.includes('relay.walletconnect.com') ? 'error' : 'open')).FakeSocket,
      timeoutMs: 30,
      graceMs: 10
    });
    t('a blocked legacy hostname with a working default hostname is OPEN, not «the relay is blocked»',
      oneBlocked.relayVerdict === 'OPEN' && oneBlocked.relay.ok === true
        && oneBlocked.relay.url === 'wss://relay.walletconnect.org'
        && oneBlocked.relays.find((h) => h.url.includes('.com')).socket.ok === false);
    t('the same report reads the live config correctly (email + 7 socials, shape array)',
      oneBlocked.projectConfig.features.email === true
        && oneBlocked.projectConfig.features.socials.length === 7
        && oneBlocked.projectConfig.features.shape === 'array');

    const bothBlocked = await collectWalletHealth({
      projectId: PROJECT_ID,
      fetchImpl: fetchSplit({ relay: 'ok' }),
      WebSocketImpl: socketPlan('error').FakeSocket,
      timeoutMs: 30,
      graceMs: 10
    });
    t('both sockets refused + HTTPS alive is reported as WS_REFUSED, the actionable shape',
      bothBlocked.relayVerdict === 'WS_REFUSED' && bothBlocked.relay.ok === false
        && bothBlocked.relays.every((host) => host.https.ok === true));

    const darkNet = await collectWalletHealth({
      projectId: PROJECT_ID,
      fetchImpl: fetchSplit({ relay: 'error' }),
      WebSocketImpl: socketPlan('silent').FakeSocket,
      timeoutMs: 30,
      graceMs: 10
    });
    t('every socket swallowed + no HTTPS answer is UNREACHABLE — and the report still returns',
      darkNet.relayVerdict === 'TIMEOUT' && darkNet.relay.ok === false
        && darkNet.relays.every((host) => host.https.ok === false));
  }

  /* ---- 7. failure paths never throw ------------------------------------- */
  {
    const rejected = await collectWalletHealth({
      projectId: PROJECT_ID,
      fetchImpl: fetchReject('NetworkError when attempting to fetch resource.', 'TypeError'),
      WebSocketImpl: socketThat('error').FakeSocket,
      timeoutMs: 30,
      graceMs: 10
    });
    t('a rejected fetch becomes an error string on both API halves',
      rejected.projectConfig.ok === false
        && /NetworkError/.test(rejected.projectConfig.error)
        && rejected.allowedOrigins.ok === false
        && rejected.projectConfig.features === null);
    t('an HTTP failure keeps its status for the report',
      (await collectWalletHealth({
        projectId: PROJECT_ID,
        fetchImpl: fetchStatus(403),
        WebSocketImpl: socketThat('error').FakeSocket,
        timeoutMs: 30,
        graceMs: 10
      })).projectConfig.status === 403);
    t('an aborted fetch is TIMEOUT',
      (await collectWalletHealth({
        projectId: PROJECT_ID,
        fetchImpl: fetchReject('aborted', 'AbortError'),
        WebSocketImpl: socketThat('error').FakeSocket,
        timeoutMs: 30,
        graceMs: 10
      })).projectConfig.error === 'TIMEOUT');
    {
      const RealFetch = globalThis.fetch;
      try {
        delete globalThis.fetch;
        const noFetch = await collectWalletHealth({
          projectId: PROJECT_ID,
          fetchImpl: null,
          WebSocketImpl: socketThat('error').FakeSocket,
          timeoutMs: 30,
          graceMs: 10
        });
        t('a host with no fetch at all is reported, never assumed',
          noFetch.projectConfig.error === 'NO_FETCH' && noFetch.relays.every((h) => h.https.error === 'NO_FETCH'));
      } finally {
        globalThis.fetch = RealFetch;
      }
    }
    t('a hanging fetch is bounded by the timeout, not by the network',
      (await collectWalletHealth({
        projectId: PROJECT_ID,
        fetchImpl: (url, init) => new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
        WebSocketImpl: socketThat('silent').FakeSocket,
        timeoutMs: 30
      })).relay.error === 'TIMEOUT');
    const bare = await collectWalletHealth({
      projectId: PROJECT_ID,
      fetchImpl: fetchStatus(503),
      WebSocketImpl: socketThat('error').FakeSocket,
      timeoutMs: 20,
      graceMs: 10
    });
    t('a report with nothing injected at all still returns its full shape',
      ['at', 'origin', 'projectId', 'projectConfig', 'allowedOrigins', 'relay', 'relays', 'relayVerdict', 'secureSite', 'storage']
        .every((key) => key in bare)
        && bare.origin === '' && bare.storage.wcSessionKeys === 0);
    t('a report with NO relay urls configured says NO_MEASUREMENT instead of inventing a verdict',
      (await collectWalletHealth({
        projectId: PROJECT_ID,
        fetchImpl: fetchStatus(503),
        WebSocketImpl: socketThat('error').FakeSocket,
        relayUrls: [],
        timeoutMs: 20
      })).relayVerdict === 'NO_MEASUREMENT');
  }

  /* ---- 8. the panel is mounted, and loads lazily ------------------------- */
  {
    const panel = readFileSync('src/components/WalletHealthPanel.jsx', 'utf8');
    const sheet = readFileSync('src/components/WalletConnectSheet.jsx', 'utf8');
    t('the panel imports the collector lazily (nothing joins the entry chunk)',
      /await import\('\.\.\/lib\/walletHealth\.js'\)/.test(panel)
        && !/^import .*walletHealth/m.test(panel));
    t('the panel shows all four links and a copyable report',
      /report\.projectConfig/.test(panel) && /report\.allowedOrigins/.test(panel)
        && /report\.relay/.test(panel) && /report\.secureSite/.test(panel)
        && /JSON\.stringify\(report, null, 2\)/.test(panel)
        && /navigator\.clipboard/.test(panel));
    t('the panel prints EVERY relay host, its own verdict sentence, and the relay-free routes',
      /report\.relays/.test(panel) && /RELAY_VERDICT_KEYS/.test(panel)
        && /wallet\.healthRelayFreeRoutes/.test(panel)
        && /relayHostLabel/.test(panel));
    t('the panel prints the socials LIST, not only a count (the «socials=0» report came from a count)',
      /features\.socials/.test(panel) && /\.join\(', '\)/.test(panel));
    t('the connect sheet renders the panel with the app’s own project id',
      /import WalletHealthPanel from '\.\/WalletHealthPanel'/.test(sheet)
        && /<WalletHealthPanel projectId=\{wallet\.wcProjectId\} \/>/.test(sheet));
    const newKeys = [
      'healthRelayHosts', 'healthRelayOpen', 'healthRelayHttpsOnly', 'healthRelayNoAnswer',
      'healthRelayVerdictOpen', 'healthRelayWsRefused', 'healthRelayUnreachable',
      'healthRelayTimeout', 'healthRelayNoSocket', 'healthRelayNoMeasurement',
      'healthRelayFreeRoutes'
    ];
    t('the panel explains itself in all three locales',
      ['fa', 'en', 'ar'].every((locale) => {
        const json = JSON.parse(readFileSync(`src/i18n/locales/${locale}.json`, 'utf8'));
        return Boolean(json.wallet?.healthTitle) && Boolean(json.wallet?.healthHint)
          && Boolean(json.wallet?.healthRun) && Boolean(json.wallet?.healthCopy)
          && Boolean(json.wallet?.healthProject) && Boolean(json.wallet?.healthOrigins)
          && Boolean(json.wallet?.healthRelay) && Boolean(json.wallet?.healthSecureSite);
      }));
    t('every new relay string exists in fa/en/ar, with its placeholders intact',
      ['fa', 'en', 'ar'].every((locale) => {
        const json = JSON.parse(readFileSync(`src/i18n/locales/${locale}.json`, 'utf8'));
        const w = json.wallet || {};
        return newKeys.every((key) => Boolean(w[key]))
          && /\{\{ms\}\}/.test(w.healthRelayOpen) && /\{\{ms\}\}/.test(w.healthRelayHttpsOnly)
          && /\{\{error\}\}/.test(w.healthRelayNoAnswer) && /\{\{ms\}\}/.test(w.healthRelayNoAnswer);
      }));
    t('every verdict code the rule can return has a sentence (no silent gap)',
      ['OPEN', 'WS_REFUSED', 'UNREACHABLE', 'TIMEOUT', 'NO_WEBSOCKET', 'NO_MEASUREMENT']
        .every((code) => new RegExp(`${code}: 'wallet\\.healthRelay`).test(panel)));
  }

  return rows;
}
