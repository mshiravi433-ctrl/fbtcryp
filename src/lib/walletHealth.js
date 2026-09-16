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
 *      the exact request `ConfigUtil.fetchRemoteFeatures()` makes at boot. This
 *      is what decides whether the dashboard has Email & Socials on for this
 *      project id and whether the page's origin is allowlisted. A 200 means
 *      the id is real and the feature flags ARE what the app reads; a 403/404
 *      explains an email login before a single tap.
 *   2. ALLOWED ORIGINS — `GET api.web3modal.org/projects/v1/origins?…`, the
 *      list `checkAllowedOrigins()` compares against. Measured in
 *      appkit-controllers (`WalletConnectUtil.isOriginAllowed`): an EMPTY list
 *      allows every origin and `localhost` is always allowed — so a mismatch
 *      can only be a NON-empty list that does not cover this exact origin.
 *   3. RELAY — `wss://relay.walletconnect.com`. The pairing URI is a topic on
 *      this socket: if either side cannot reach it, the wallet opens and shows
 *      NOTHING to approve (the proposal never arrives) — precisely the Trust
 *      report.
 *   4. SECURE SITE — `https://secure.walletconnect.org/sdk`, the frame that
 *      holds the embedded (email/social) wallet. Unreachable there means the
 *      login cannot complete or restore, whatever the app does.
 *
 * Everything is injectable (fetch / WebSocket / storage / clock) so the probe
 * suite can hold every edge still and assert the reporting, not the internet.
 */

/** The SDK's public API host (appkit-common `W3M_API_URL`). */
export const W3M_API_URL = 'https://api.web3modal.org';

/** The relay every WalletConnect v2 pairing topic lives on. */
export const WC_RELAY_URL = 'wss://relay.walletconnect.com';

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

/** `GET /appkit/v1/config` — mirrors `ApiController._getSdkProperties()`. */
export function configProbeUrl(projectId, sdkVersion = HEALTH_SDK_VERSION) {
  return buildApiUrl('/appkit/v1/config', projectId, sdkVersion);
}

/** `GET /projects/v1/origins` — the list `checkAllowedOrigins()` reads. */
export function originsProbeUrl(projectId, sdkVersion = HEALTH_SDK_VERSION) {
  return buildApiUrl('/projects/v1/origins', projectId, sdkVersion);
}

/**
 * Read the dashboard's answer the way the SDK does: `fetchRemoteFeatures()`
 * turns `features.social_login` into `remoteFeatures.email` when `isEnabled`
 * is true AND `config` contains the literal `'email'`; everything else in
 * `config` becomes the socials list. The raw object is reported too, because
 * «what the dashboard says» is the fact the user needs to see.
 */
export function summarizeProjectConfig(payload) {
  const socialLogin = payload?.features?.social_login;
  const config = Array.isArray(socialLogin?.config) ? socialLogin.config : [];
  return {
    email: Boolean(socialLogin?.isEnabled) && config.includes('email'),
    socials: config.filter((name) => name !== 'email'),
    enabled: Boolean(socialLogin?.isEnabled),
    raw: socialLogin ?? null
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
 * Reachability without a readable body (the frame does not send CORS headers):
 * `no-cors` RESOLVES with an opaque response when the request reached the
 * server, and rejects when the network refused — which is the distinction the
 * report needs.
 */
async function probeReachable(url, { fetchImpl, timeoutMs }) {
  const call = fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : null);
  if (!call) return { ok: false, error: 'NO_FETCH' };
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => { try { controller?.abort(); } catch { /* noop */ } }, timeoutMs);
  try {
    await call(url, { signal: controller?.signal, mode: 'no-cors', cache: 'no-store' });
    return { ok: true };
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
 * Open the relay socket and report what happened. A page cannot `no-cors`
 * fetch a WebSocket, so this is a bare socket with the project id: `open`
 * proves routing to the relay, a fast `close`/`error` proves the host is
 * refused or the project id rejected, and a timeout proves the network is
 * dropping it silently — which is exactly how a filtered connection behaves.
 */
export function probeRelay(url, { WebSocketImpl, projectId = '', timeoutMs = 8_000 } = {}) {
  const WS = WebSocketImpl ?? (typeof WebSocket !== 'undefined' ? WebSocket : null);
  if (!WS) return Promise.resolve({ ok: false, error: 'NO_WEBSOCKET' });
  return new Promise((resolve) => {
    let settled = false;
    let socket = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket?.close?.(); } catch { /* noop */ }
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: false, error: 'TIMEOUT' }), timeoutMs);
    try {
      const target = projectId ? `${url}/?projectId=${encodeURIComponent(projectId)}` : url;
      socket = new WS(target);
    } catch (error) {
      finish({ ok: false, error: String(error?.message || error) });
      return;
    }
    socket.onopen = () => finish({ ok: true, state: 'open' });
    socket.onerror = () => finish({ ok: false, error: 'SOCKET_ERROR' });
    socket.onclose = (event) => finish({
      ok: false,
      error: `CLOSED_${Number.isFinite(event?.code) ? event.code : ''}`
    });
  });
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
 * than raw evidence a human can read. Never throws.
 */
export async function collectWalletHealth({
  projectId,
  origin,
  fetchImpl,
  WebSocketImpl,
  storage,
  timeoutMs = 8_000,
  trace,
  userAgent
} = {}) {
  const currentOrigin = origin ?? (typeof window !== 'undefined' ? window.location.origin : '');
  const [config, origins, relay, secureSite] = await Promise.all([
    probeJson(configProbeUrl(projectId), { fetchImpl, timeoutMs }),
    probeJson(originsProbeUrl(projectId), { fetchImpl, timeoutMs }),
    probeRelay(WC_RELAY_URL, { WebSocketImpl, projectId, timeoutMs }),
    probeReachable(SECURE_SITE_URL, { fetchImpl, timeoutMs })
  ]);
  const list = Array.isArray(origins?.body?.allowedOrigins) ? origins.body.allowedOrigins : null;
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
    relay,
    secureSite,
    storage: storageFacts(storage),
    trace: typeof trace === 'function' ? trace() : null
  };
}
