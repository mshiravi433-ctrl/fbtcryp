/**
 * WALLET HEALTH — making the invisible links visible.
 * ---------------------------------------------------------------------------
 * The two reports this app keeps receiving — «ایمیل تأیید می‌شود ولی والت ساخته
 * نمی‌شود» and «تراست باز می‌شود ولی چیزی برای تأیید نمی‌آید» — share one
 * property that makes them impossible to argue about: the failing link is a
 * network or cloud step the UI cannot show. Everything visible (the sheet, the
 * wallet rows, the QR) can be perfectly correct while the chain is broken one
 * hop further out, and then every UI-level fix looks like a no-op.
 *
 * The chain, in order, with what breaks it:
 *
 *   1. PROJECT CONFIG — `GET api.web3modal.org/appkit/v1/config?projectId=…`,
 *      the exact request `ApiController.fetchProjectConfig()` makes at boot.
 *      This is what decides whether the dashboard has Email & Socials on for
 *      this project id and whether the page's origin is allowlisted. A 200 means
 *      the id is real and the feature flags ARE what the app reads; a 403/404
 *      explains an email login before a single tap.
 *   2. ALLOWED ORIGINS — `GET api.web3modal.org/projects/v1/origins?…`, the
 *      list `checkAllowedOrigins()` compares against. Measured in
 *      appkit-controllers (`WalletConnectUtil.isOriginAllowed`): an EMPTY list
 *      allows every origin and `localhost` is always allowed — so a mismatch
 *      can only be a NON-empty list that does not cover this exact origin.
 *   3. RELAY — both WalletConnect relay hostnames. The pairing URI is a topic
 *      on this socket: if either side cannot reach it, the wallet opens and
 *      shows NOTHING to approve (the proposal never arrives) — precisely the
 *      Trust report. ONE hostname is not a measurement of "the relay": see the
 *      two corrections below.
 *   4. SECURE SITE — `https://secure.walletconnect.org/sdk`, the frame that
 *      holds the embedded (email/social) wallet. Unreachable there means the
 *      login cannot complete or restore, whatever the app does.
 *
 * ─── CORRECTION 1: THE RELAY IS TWO HOSTNAMES, NOT ONE ──────────────────────
 * This module used to probe `wss://relay.walletconnect.com` only, and the panel
 * printed that single verdict as «رلهٔ WalletConnect» — so a ❌ on that one host
 * read as "the relay is blocked for you". Measured against the SDK this app
 * actually installs:
 *
 *   • `@walletconnect/core@2.25.0` — `dist/types/constants/relayer.d.ts`:
 *     `RELAYER_DEFAULT_RELAY_URL = "wss://relay.walletconnect.org"`. It is the
 *     ONLY `wss://` literal in that bundle, and `Core` uses it whenever no
 *     `relayUrl` is passed (`relayUrl: t.relayUrl || pt`).
 *   • docs.reown.com/advanced/faq — «The default relay endpoint is blocked. How
 *     can I get around this? … set `relayUrl` to `wss://relay.walletconnect.org`».
 *   • `@reown/appkit@1.8.19` — the string `relayUrl` does not appear anywhere in
 *     its dist: the AppKit surface has no relay knob of its own, so the only
 *     relay this app can choose is the one `EthereumProvider.init({ relayUrl })`
 *     is given (lib/wcTimeout.js walks that list).
 *
 * So `.com` is the historical hostname, NOT the default, and a single-host probe
 * can manufacture a false "relay blocked" on a network where `.org` — the host
 * the SDK would have used by itself — answers in 40ms. Every relay hostname the
 * app can use is now probed, per host, with the time each one took.
 *
 * ─── CORRECTION 2: THE CONFIG PAYLOAD IS AN ARRAY ───────────────────────────
 * `summarizeProjectConfig()` used to read `payload.features.social_login` — an
 * object lookup. The endpoint returns `features` as an ARRAY of feature
 * objects, and the SDK's own reader is `ConfigUtil.getApiConfig()`:
 *
 *     getApiConfig(id, apiProjectConfig) { return apiProjectConfig?.find((f) => f.id === id) }
 *     processApi: (apiConfig) => Boolean(apiConfig.isEnabled) && apiConfig.config.includes('email')
 *
 * On an array, `.social_login` is `undefined`, so the panel reported
 * `email=false socials=0` for a project whose live answer is
 * `{"id":"social_login","isEnabled":true,"config":["email","google","x","discord",
 * "farcaster","github","apple","facebook"]}` — a confident wrong number about
 * the one thing the dashboard controls. Both shapes are now read the way the
 * SDK reads them, and `shape` is reported so a future payload change shows up
 * as `shape:"none"` instead of as "email is off".
 *
 * Everything is injectable (fetch / WebSocket / storage / clock) so the probe
 * suite can hold every edge still and assert the reporting, not the internet.
 */

import { WC_RELAY_URLS } from './wcTimeout.js';

/** The SDK's public API host (appkit-common `W3M_API_URL`). */
export const W3M_API_URL = 'https://api.web3modal.org';

/**
 * The relay the SDK itself would use with no `relayUrl` override —
 * `RELAYER_DEFAULT_RELAY_URL` in @walletconnect/core@2.25.0. Kept as the
 * single-value export so old callers read the default, not a guess.
 */
export const WC_RELAY_URL = WC_RELAY_URLS[0];

/** The historical hostname, still live, still worth trying second. */
export const WC_RELAY_LEGACY_URL = WC_RELAY_URLS[WC_RELAY_URLS.length - 1];

/** Every relay hostname this app can connect through, in try order. */
export { WC_RELAY_URLS };

/** The embedded-wallet frame (`DEFAULT_SDK_URL` in @reown/appkit-wallet). */
export const SECURE_SITE_URL = 'https://secure.walletconnect.org/sdk';

/** Our own boot marker — kept in sync with lib/emailSocialWallet.js. */
export const EMAIL_MARKER_KEY = 'fbt_email_social_connected';

/** The SDK's own login marker (why it matters: see the rearm in emailSocialWallet). */
export const SDK_LOGIN_KEY = '@appkit-wallet/EMAIL_LOGIN_USED_KEY';

/** The version string AppKit's own API calls send; informational for config. */
export const HEALTH_SDK_VERSION = 'html-appkit-1.8.19';

function buildApiUrl(path, projectId, sdkVersion) {
  const url = new URL(`${W3M_API_URL}${path}`);
  url.searchParams.set('projectId', String(projectId || ''));
  url.searchParams.set('st', 'appkit');
  url.searchParams.set('sv', sdkVersion);
  return url.toString();
}

/** `GET /appkit/v1/config` — mirrors `ApiController.fetchProjectConfig()`. */
export function configProbeUrl(projectId, sdkVersion = HEALTH_SDK_VERSION) {
  return buildApiUrl('/appkit/v1/config', projectId, sdkVersion);
}

/** `GET /projects/v1/origins` — the list `checkAllowedOrigins()` reads. */
export function originsProbeUrl(projectId, sdkVersion = HEALTH_SDK_VERSION) {
  return buildApiUrl('/projects/v1/origins', projectId, sdkVersion);
}

/**
 * Find the `social_login` feature the way `ConfigUtil.getApiConfig()` does.
 *
 * The live endpoint answers with `features: [ {id, isEnabled, config}, … ]`
 * (`ApiController.fetchProjectConfig()` returns exactly that array). The object
 * map shape is still accepted, because an older/legacy payload must not read as
 * "email is off" — it must read as the feature, or as nothing at all.
 */
export function socialLoginFeature(payload) {
  const features = payload?.features;
  if (Array.isArray(features)) {
    return {
      shape: 'array',
      feature: features.find((entry) => entry?.id === 'social_login') ?? null
    };
  }
  if (features && typeof features === 'object') {
    return { shape: 'object', feature: features.social_login ?? null };
  }
  return { shape: 'none', feature: null };
}

/**
 * Read the dashboard's answer the way the SDK does: `ConfigUtil`'s email rule is
 * `Boolean(apiConfig.isEnabled) && apiConfig.config.includes('email')`, and its
 * socials rule is the same list minus that literal. `config: null` is a real
 * answer too (the SDK falls back to local/default values) and is reported as
 * `config: null` rather than as an empty list, so "the dashboard withheld the
 * list" can never be mistaken for "every social is off".
 */
export function summarizeProjectConfig(payload) {
  const { shape, feature } = socialLoginFeature(payload);
  const config = Array.isArray(feature?.config) ? feature.config : null;
  return {
    email: Boolean(feature?.isEnabled) && Boolean(config?.includes('email')),
    socials: config ? config.filter((name) => name !== 'email') : [],
    enabled: Boolean(feature?.isEnabled),
    config: config ? [...config] : null,
    shape,
    raw: feature
  };
}

/** One fetch with a hard bound. Never throws. */
async function probeJson(url, { fetchImpl, timeoutMs }) {
  const call = fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : null);
  if (!call) return { ok: false, error: 'NO_FETCH' };
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => { try { controller?.abort(); } catch { /* noop */ } }, timeoutMs);
  try {
    const res = await call(url, { signal: controller?.signal, cache: 'no-store' });
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    return { ok: Boolean(res.ok), status: res.status, body };
  } catch (error) {
    return {
      ok: false,
      error: String(error?.name === 'AbortError' ? 'TIMEOUT' : (error?.message || error))
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reachability without a readable body (neither the frame nor the relay sends
 * CORS headers): `no-cors` RESOLVES with an opaque response when the request
 * reached the server, and rejects when the network refused — which is the
 * distinction the report needs.
 */
async function probeReachable(url, { fetchImpl, timeoutMs }) {
  const call = fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : null);
  if (!call) return { ok: false, error: 'NO_FETCH' };
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => { try { controller?.abort(); } catch { /* noop */ } }, timeoutMs);
  const started = Date.now();
  try {
    await call(url, { signal: controller?.signal, mode: 'no-cors', cache: 'no-store' });
    return { ok: true, ms: Date.now() - started };
  } catch (error) {
    return {
      ok: false,
      ms: Date.now() - started,
      error: String(error?.name === 'AbortError' ? 'TIMEOUT' : (error?.message || error))
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Open the relay socket and report what happened.
 *
 * A page cannot `no-cors` fetch a WebSocket, so this is a bare socket with the
 * project id: `open` proves routing to the relay, a fast `close`/`error` proves
 * the host is refused or the project id rejected, and a timeout proves the
 * network is dropping it silently — which is exactly how a filtered connection
 * behaves.
 *
 * Two facts ride along because they are the difference between the possible
 * verdicts, and neither can be reconstructed after the fact:
 *
 *   • `ms` — how long the failure took. A reset in 40ms is a refusal; a stall
 *     that ends at the timeout is a filter that swallows packets. Two very
 *     different phone calls for the user.
 *   • `closeCode` — what the socket published. Browsers report `1006` for ANY
 *     failed handshake, so 1006 is kept as `SOCKET_ERROR` + `closeCode: 1006`
 *     (never dressed up as "the host refused you"), while a real close code
 *     from the relay (e.g. 3000, project/origin rejected) is reported as
 *     `CLOSED_<code>` and IS distinguishable.
 *
 * `graceMs` lets a following `close` event land before the error is reported,
 * because in browsers `error` arrives first and the close code arrives with the
 * second event.
 */
export function probeRelay(url, { WebSocketImpl, projectId = '', timeoutMs = 8_000, graceMs = 250 } = {}) {
  const WS = WebSocketImpl ?? (typeof WebSocket !== 'undefined' ? WebSocket : null);
  if (!WS) return Promise.resolve({ url, ok: false, error: 'NO_WEBSOCKET', ms: 0 });
  const started = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    let socket = null;
    let graceTimer = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(graceTimer);
      try { socket?.close?.(); } catch { /* noop */ }
      resolve({ url, ms: Date.now() - started, ...result });
    };
    const timer = setTimeout(() => finish({ ok: false, error: 'TIMEOUT', state: 'timeout' }), timeoutMs);
    try {
      const target = projectId ? `${url}/?projectId=${encodeURIComponent(projectId)}` : url;
      socket = new WS(target);
    } catch (error) {
      finish({ ok: false, error: String(error?.message || error) });
      return;
    }
    socket.onopen = () => finish({ ok: true, state: 'open' });
    socket.onerror = () => {
      /* Report the error itself, but give the close event its beat first — the
         code (if the relay published one) is worth waiting 250ms for. */
      if (settled) return;
      graceTimer = setTimeout(
        () => finish({ ok: false, error: 'SOCKET_ERROR', state: 'error' }),
        graceMs
      );
    };
    socket.onclose = (event) => {
      const code = Number.isFinite(event?.code) ? Number(event.code) : null;
      if (code !== null && code !== 1006) {
        finish({ ok: false, error: `CLOSED_${code}`, closeCode: code, state: 'closed' });
        return;
      }
      finish({ ok: false, error: 'SOCKET_ERROR', closeCode: code, state: 'error' });
    };
  });
}

/**
 * The relay's HTTPS door, asked separately from its WebSocket door.
 *
 * This is the measurement that separates the two shapes of "the relay does not
 * work here": an HTTPS request to the same host that RESOLVES proves DNS, TCP
 * and TLS are all fine and only the upgrade was refused (DPI on the WebSocket
 * handshake, or an edge rule) — while an HTTPS request that REJECTS too means
 * the hostname itself is filtered, poisoned or unroutable.
 */
export function probeRelayHttps(url, { fetchImpl, timeoutMs = 8_000 } = {}) {
  const target = String(url || '').replace(/^wss:/, 'https:');
  return probeReachable(target, { fetchImpl, timeoutMs });
}

/**
 * The verdict over every probed relay host, from measured facts only.
 *
 *   OPEN          at least one socket opened — pairing has a path.
 *   WS_REFUSED    no socket opened, but a relay host answered over HTTPS:
 *                 the host is alive and the WebSocket upgrade is what fails.
 *   UNREACHABLE   no socket opened and no host answered over HTTPS: the
 *                 hostname/route is filtered (DNS, SNI or a dead network).
 *   NO_WEBSOCKET  this host has no WebSocket at all (nothing was measured).
 *
 * Kept as a pure function taking the probe results, so the panel's sentence
 * and the connect flow's decision come from the same rule.
 */
export function relayVerdict(hosts = []) {
  const list = Array.isArray(hosts) ? hosts : [];
  const openUrls = list.filter((host) => host?.socket?.ok).map((host) => host.url);
  const httpsUrls = list.filter((host) => host?.https?.ok).map((host) => host.url);
  let verdict = 'UNREACHABLE';
  if (list.length === 0) verdict = 'NO_MEASUREMENT';
  else if (openUrls.length > 0) verdict = 'OPEN';
  else if (list.every((host) => !host?.socket || host.socket.error === 'NO_WEBSOCKET')) verdict = 'NO_WEBSOCKET';
  else if (httpsUrls.length > 0) verdict = 'WS_REFUSED';
  /* No host answered on either door AND every socket ended at the timer: the
     network is swallowing packets instead of refusing them — the filtered-link
     signature, and a different conversation from "your DNS is wrong". */
  else if (list.every((host) => host?.socket?.error === 'TIMEOUT')) verdict = 'TIMEOUT';
  return { verdict, openUrls, httpsUrls };
}

/** Storage facts as booleans and counts — never values. */
export function storageFacts(storage) {
  const target = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  const facts = { sdkLoginMarker: false, ourMarker: false, wcSessionKeys: 0, appkitConnectionKeys: 0 };
  if (!target) return facts;
  try {
    facts.sdkLoginMarker = String(target.getItem(SDK_LOGIN_KEY) || '') === 'true';
    facts.ourMarker = target.getItem(EMAIL_MARKER_KEY) === '1';
    for (let i = 0; i < target.length; i += 1) {
      const key = target.key(i) || '';
      if (key.startsWith('wc@2:') && key.endsWith('//session')) {
        try {
          const parsed = target.getItem(key) ? JSON.parse(target.getItem(key)) : null;
          if (Array.isArray(parsed) && parsed.length > 0) facts.wcSessionKeys += 1;
        } catch { /* unreadable entry — not counted */ }
      }
      if (key.startsWith('@appkit/')) facts.appkitConnectionKeys += 1;
    }
  } catch { /* storage unavailable: the false/0 defaults are the honest answer */ }
  return facts;
}

/**
 * A pairing URI must survive one encode/decode round-trip byte for byte —
 * the «Invalid Url» report is what a double-encoded `uri=` param looks like
 * from the wallet's side.
 */
export function uriRoundTrips(uri) {
  if (typeof uri !== 'string' || !uri.startsWith('wc:')) return false;
  try {
    return encodeURIComponent(decodeURIComponent(uri)) === encodeURIComponent(uri);
  } catch {
    return false;
  }
}

/** The hand-off URLs a wallet may be opened with, for inspection by hand. */
export function handoffUrl(wallet, uri) {
  if (!uri) return '';
  const encoded = encodeURIComponent(uri);
  if (wallet === 'trust-native') return `trust://wc?uri=${encoded}`;
  if (wallet === 'trust') return `https://link.trustwallet.com/wc?uri=${encoded}`;
  return uri;
}

/**
 * The whole report. Every field is a measured fact or an error string — no
 * "diagnosis" text, because a wrong diagnosis shipped as a label is worse
 * than raw evidence a human can read. The one derived value is
 * `relayVerdict`, and it is a code with a documented rule (relayVerdict())
 * rather than prose, so the panel can translate it once and the tests can
 * hold every branch. Never throws.
 */
export async function collectWalletHealth({
  projectId,
  origin,
  fetchImpl,
  WebSocketImpl,
  storage,
  timeoutMs = 8_000,
  trace,
  userAgent,
  relayUrls = WC_RELAY_URLS
} = {}) {
  const currentOrigin = origin ?? (typeof window !== 'undefined' ? window.location.origin : '');
  const hosts = (Array.isArray(relayUrls) ? relayUrls : WC_RELAY_URLS).map((url) => url);
  /* Every host is asked BOTH questions at once. A sequential walk would make a
     blocked primary delay the fallback's answer by its own timeout, and the
     report would then describe the network as it looked during the first
     socket rather than as it is. */
  const [config, origins, secureSite, relayHosts] = await Promise.all([
    probeJson(configProbeUrl(projectId), { fetchImpl, timeoutMs }),
    probeJson(originsProbeUrl(projectId), { fetchImpl, timeoutMs }),
    probeReachable(SECURE_SITE_URL, { fetchImpl, timeoutMs }),
    Promise.all(hosts.map(async (url) => ({
      url,
      socket: await probeRelay(url, { WebSocketImpl, projectId, timeoutMs }),
      https: await probeRelayHttps(url, { fetchImpl, timeoutMs })
    })))
  ]);
  const list = Array.isArray(origins?.body?.allowedOrigins) ? origins.body.allowedOrigins : null;
  const verdict = relayVerdict(relayHosts);
  const reachable = relayHosts.find((host) => host.socket?.ok);
  return {
    at: new Date().toISOString(),
    origin: currentOrigin,
    projectId: String(projectId || ''),
    userAgent: userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : ''),
    projectConfig: {
      ok: config.ok,
      status: config.status ?? null,
      error: config.error ?? null,
      features: config.ok ? summarizeProjectConfig(config.body) : null
    },
    allowedOrigins: {
      ok: origins.ok,
      status: origins.status ?? null,
      error: origins.error ?? null,
      list,
      /* Measured SDK rule: an EMPTY list allows every origin. Reported so an
         empty list is never mistaken for a block. */
      emptyMeansAllowAll: list !== null && list.length === 0
    },
    /* `relay` stays the single-answer field the panel's first row reads: the
       first host that opened, or the default host's failure when none did —
       with every host's own facts in `relays` so a ❌ is never one hostname
       pretending to be the whole relay. */
    relay: reachable ? reachable.socket : (relayHosts[0]?.socket ?? { ok: false, error: 'NO_RELAY_URLS' }),
    relays: relayHosts,
    relayVerdict: verdict.verdict,
    secureSite,
    storage: storageFacts(storage),
    trace: typeof trace === 'function' ? trace() : null
  };
}
