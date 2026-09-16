/**
 * WALLET HEALTH PROBE
 * ---------------------------------------------------------------------------
 * The two reports the audit started from («ایمیل تأیید شد ولی والت ساخته نشد»,
 * «تراست باز می‌شود ولی چیزی برای تأیید نمی‌آید») both die on a link that is
 * invisible from the UI: the Reown project configuration, the allowed-origins
 * list, the relay socket, or the embedded-wallet frame. src/lib/walletHealth.js
 * turns those four into a report the user can copy off their own phone.
 *
 * This probe measures the module's reporting rules with every edge held
 * still — no network, no sockets, no storage — because a diagnostic that
 * reports the wrong thing is worse than no diagnostic:
 *
 *   1. URL builders: the SDK's own parameter names and encoding.
 *   2. Feature summary: the exact `social_login` shape the SDK consumes.
 *   3. URI round-trip + hand-off builders: the two shapes a wallet's deep-link
 *      route accepts, byte for byte.
 *   4. Relay probe: open / error / close-with-code / silent timeout, each
 *      mapped to a distinct, honest string.
 *   5. Storage facts: booleans and counts only, never values.
 *   6. The whole report with injected edges, plus the never-throws promise of
 *      every failure path.
 *   7. The panel is wired into the connect sheet and loads lazily.
 */
import { readFileSync } from 'node:fs';
import {
  EMAIL_MARKER_KEY,
  SDK_LOGIN_KEY,
  SECURE_SITE_URL,
  W3M_API_URL,
  WC_RELAY_URL,
  collectWalletHealth,
  configProbeUrl,
  handoffUrl,
  originsProbeUrl,
  probeRelay,
  storageFacts,
  summarizeProjectConfig,
  uriRoundTrips
} from '../src/lib/walletHealth.js';

const PROJECT_ID = '8e36eccabebf5a4567f4e974fafd6b20';

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

/** A WebSocket double that fires exactly the event it is told to. */
const socketThat = (behaviour, { code = 1006 } = {}) => {
  const sockets = [];
  class FakeSocket {
    constructor(url) {
      this.url = url;
      sockets.push(this);
      queueMicrotask(() => {
        if (behaviour === 'open') this.onopen?.({});
        else if (behaviour === 'error') this.onerror?.({});
        else if (behaviour === 'close') this.onclose?.({ code });
        /* 'silent' intentionally does nothing at all */
      });
    }
    close() { this.closed = true; }
  }
  return { FakeSocket, sockets };
};

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
    t('the relay and secure-site constants are the SDK’s own hosts',
      WC_RELAY_URL === 'wss://relay.walletconnect.com'
        && SECURE_SITE_URL === 'https://secure.walletconnect.org/sdk');
  }

  /* ---- 2. feature summary ------------------------------------------------ */
  {
    const on = summarizeProjectConfig({
      features: { social_login: { isEnabled: true, config: ['email', 'google', 'apple'] } }
    });
    t('an enabled social_login with the literal «email» reads as email:true',
      on.email === true && on.enabled === true
        && on.socials.length === 2 && !on.socials.includes('email'));
    const off = summarizeProjectConfig({
      features: { social_login: { isEnabled: false, config: ['email', 'google'] } }
    });
    t('an enabled flag of false is a hard no, whatever config says', off.email === false && off.enabled === false);
    const missing = summarizeProjectConfig({ features: {} });
    t('a dashboard with no social_login at all degrades to email:false, socials:[]',
      missing.email === false && missing.socials.length === 0 && missing.raw === null);
    const junk = summarizeProjectConfig({ features: { social_login: { isEnabled: true, config: 'email' } } });
    t('a non-array config is never iterated (no crash on a malformed payload)',
      junk.email === false && junk.socials.length === 0);
  }

  /* ---- 3. URI hygiene + hand-off bytes ----------------------------------- */
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

  /* ---- 4. relay probe: four distinct outcomes ---------------------------- */
  {
    const open = socketThat('open');
    const openResult = await probeRelay(WC_RELAY_URL, { WebSocketImpl: open.FakeSocket, projectId: PROJECT_ID });
    t('a socket that opens reports success and carries the project id',
      openResult.ok === true && openResult.state === 'open'
        && open.sockets[0].url.includes(encodeURIComponent(PROJECT_ID))
        && open.sockets[0].url.startsWith('wss://'));

    const bad = socketThat('error');
    t('a socket error is reported as SOCKET_ERROR',
      (await probeRelay(WC_RELAY_URL, { WebSocketImpl: bad.FakeSocket })).error === 'SOCKET_ERROR');

    const closed = socketThat('close', { code: 1006 });
    t('a close carries its code, so «refused by the host» is distinguishable later',
      (await probeRelay(WC_RELAY_URL, { WebSocketImpl: closed.FakeSocket })).error === 'CLOSED_1006');

    const silent = socketThat('silent');
    const timedOut = await probeRelay(WC_RELAY_URL, { WebSocketImpl: silent.FakeSocket, timeoutMs: 30 });
    t('a socket that never answers is TIMEOUT — the signature of a filtered network',
      timedOut.ok === false && timedOut.error === 'TIMEOUT' && silent.sockets[0].closed === true);

    const RealWebSocket = globalThis.WebSocket;
    try {
      delete globalThis.WebSocket;
      t('no WebSocket in the host is reported, never assumed',
        (await probeRelay(WC_RELAY_URL, { WebSocketImpl: null })).error === 'NO_WEBSOCKET');
    } finally {
      if (RealWebSocket) globalThis.WebSocket = RealWebSocket;
    }
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
  }

  /* ---- 7. failure paths never throw ------------------------------------- */
  {
    const rejected = await collectWalletHealth({
      projectId: PROJECT_ID,
      fetchImpl: fetchReject('NetworkError when attempting to fetch resource.', 'TypeError'),
      WebSocketImpl: socketThat('error').FakeSocket,
      timeoutMs: 30
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
        timeoutMs: 30
      })).projectConfig.status === 403);
    t('an aborted fetch is TIMEOUT',
      (await collectWalletHealth({
        projectId: PROJECT_ID,
        fetchImpl: fetchReject('aborted', 'AbortError'),
        WebSocketImpl: socketThat('error').FakeSocket,
        timeoutMs: 30
      })).projectConfig.error === 'TIMEOUT');
    {
      const RealFetch = globalThis.fetch;
      try {
        delete globalThis.fetch;
        t('a host with no fetch at all is reported, never assumed',
          (await collectWalletHealth({
            projectId: PROJECT_ID,
            fetchImpl: null,
            WebSocketImpl: socketThat('error').FakeSocket,
            timeoutMs: 30
          })).projectConfig.error === 'NO_FETCH');
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
      timeoutMs: 20
    });
    t('a report with nothing injected at all still returns its full shape',
      ['at', 'origin', 'projectId', 'projectConfig', 'allowedOrigins', 'relay', 'secureSite', 'storage']
        .every((key) => key in bare)
        && bare.origin === '' && bare.storage.wcSessionKeys === 0);
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
    t('the connect sheet renders the panel with the app’s own project id',
      /import WalletHealthPanel from '\.\/WalletHealthPanel'/.test(sheet)
        && /<WalletHealthPanel projectId=\{wallet\.wcProjectId\} \/>/.test(sheet));
    t('the panel explains itself in all three locales',
      ['fa', 'en', 'ar'].every((locale) => {
        const json = JSON.parse(readFileSync(`src/i18n/locales/${locale}.json`, 'utf8'));
        return Boolean(json.wallet?.healthTitle) && Boolean(json.wallet?.healthHint)
          && Boolean(json.wallet?.healthRun) && Boolean(json.wallet?.healthCopy)
          && Boolean(json.wallet?.healthProject) && Boolean(json.wallet?.healthOrigins)
          && Boolean(json.wallet?.healthRelay) && Boolean(json.wallet?.healthSecureSite);
      }));
  }

  return rows;
}
