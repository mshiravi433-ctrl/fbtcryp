/**
 * THE WALLET HEALTH REPORT
 * ---------------------------------------------------------------------------
 * The links a wallet report is always about are the ones the UI cannot show:
 * does the dashboard know this project, does its allowlist cover this origin,
 * does the relay's WebSocket open on THIS network, can the embedded-wallet
 * frame be reached. This measures those four on the device and network where
 * the user is, and prints copyable JSON, so the next report arrives with the
 * failing hop named instead of described.
 *
 * Lean on purpose: four probes, one verdict, and storage facts. Every field is
 * a measured fact or an error string — never a diagnosis, because a wrong
 * diagnosis shipped as a label is worse than raw evidence a human can read.
 *
 * Everything injectable (fetch / WebSocket / storage) so every network edge can
 * be held still in a test.
 */

import { HEALTH_SDK_VERSION, SECURE_SITE_URL, W3M_API_URL, WC_PROJECT_ID } from './config.js';
import { measureRelay, probeReachable } from './relay.js';
import { EMAIL_MARKER_KEY, SDK_LOGIN_KEY, emailOptions } from './embedded.js';
import { isConnectionKey } from './storage.js';
import { TIMEOUT } from './config.js';

/** `GET /appkit/v1/config` — mirrors `ApiController.fetchProjectConfig()`. */
export function configProbeUrl(projectId, sdkVersion = HEALTH_SDK_VERSION) {
  return apiUrl('/appkit/v1/config', projectId, sdkVersion);
}

/** `GET /projects/v1/origins` — the list `checkAllowedOrigins()` reads. */
export function originsProbeUrl(projectId, sdkVersion = HEALTH_SDK_VERSION) {
  return apiUrl('/projects/v1/origins', projectId, sdkVersion);
}

function apiUrl(path, projectId, sdkVersion) {
  const url = new URL(`${W3M_API_URL}${path}`);
  url.searchParams.set('projectId', String(projectId || ''));
  url.searchParams.set('st', 'appkit');
  url.searchParams.set('sv', sdkVersion);
  return url.toString();
}

/**
 * Read the dashboard's answer the way the SDK does.
 *
 * `ConfigUtil`'s email rule is
 * `Boolean(apiConfig.isEnabled) && apiConfig.config.includes('email')`, and its
 * socials rule is the same list minus that literal. The live endpoint answers
 * with `features: [ {id, isEnabled, config}, … ]` — an ARRAY — so reading
 * `features.social_login` as an object reports `email=false` for a project whose
 * live answer has it enabled. Both shapes are read, and `shape` is reported so a
 * future payload change shows up as `shape:"none"` instead of as "email is off".
 *
 * `config: null` is a real answer too (the SDK falls back to defaults) and is
 * reported as null rather than as an empty list, so "the dashboard withheld the
 * list" can never be mistaken for "every social is off".
 */
export function summarizeProjectConfig(payload, { userAgent } = {}) {
  const features = payload?.features;
  let shape = 'none';
  let feature = null;
  if (Array.isArray(features)) {
    shape = 'array';
    feature = features.find((entry) => entry?.id === 'social_login') ?? null;
  } else if (features && typeof features === 'object') {
    shape = 'object';
    feature = features.social_login ?? null;
  }

  // Keep this in lockstep with the values actually passed to createAppKit.
  const requested = emailOptions({ projectId: '', metadata: {} }).features;
  const raw = feature && Object.prototype.hasOwnProperty.call(feature, 'config')
    ? feature.config : undefined;
  const configKind = Array.isArray(raw) ? 'list' : raw === null ? 'null' : 'absent';
  const config = Array.isArray(raw) ? [...raw] : null;
  const source = configKind === 'list' ? 'dashboard' : configKind === 'null' ? 'local' : 'off';
  const enabled = source === 'local' ? true : source === 'dashboard' ? Boolean(feature?.isEnabled) : false;
  const selected = source === 'dashboard' && enabled
    ? config
    : source === 'local' ? requested.socials.concat(requested.email ? ['email'] : []) : [];
  const ua = String(userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : ''));
  const telegram = /Telegram/i.test(ua);
  const ios = /iPhone|iPad|iPod/i.test(ua);
  const android = /Android/i.test(ua);
  const mac = /Macintosh|Mac OS/i.test(ua) && !ios;
  const socials = selected.filter((name) => name !== 'email').filter((name) => {
    if (telegram && ios && name === 'google') return false;
    if (telegram && mac && name === 'x') return false;
    if (android && (name === 'facebook' || name === 'x')) return false;
    if (!telegram && (ios || android) && name === 'facebook') return false;
    return true;
  });
  return {
    shape, enabled, configKind, config, source,
    email: enabled && selected.includes('email'), socials,
    requested: { email: Boolean(requested.email), socials: [...requested.socials] }
  };
}

/**
 * Is the current origin allowed, by the SDK's own rule?
 *
 * Empty list → allow all (reported separately, so an empty list is never
 * mistaken for a block). Otherwise an exact match, a host match, or a
 * scheme-less domain that covers the host.
 */
export function isOriginAllowed(currentOrigin, list) {
  if (!Array.isArray(list)) return null;
  if (list.length === 0) return true;
  const origin = String(currentOrigin || '').trim();
  if (!origin) return null;
  let host = '';
  try {
    host = new URL(origin).host;
  } catch {
    host = origin;
  }
  return list.some((entry) => {
    const e = String(entry ?? '').trim();
    if (!e) return false;
    if (e === origin || e === host) return true;
    try {
      if (new URL(e).host === host) return true;
    } catch { /* not a URL — try the bare-domain forms below */ }
    if (!e.includes('://')) {
      if (e === host.replace(/^www\./, '')) return true;
      if (host.endsWith(`.${e}`)) return true;
    }
    return false;
  });
}

/** Storage facts as booleans and counts — never values. */
export function storageFacts(storage) {
  const target = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  const facts = {
    sdkLoginMarker: false,
    ourMarker: false,
    wcSessionKeys: 0,
    appkitConnectionKeys: 0,
    orphanKeys: false
  };
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
      /* Same predicate the purge uses, so the diagnostic and the cleanup can
         never disagree about what "connection state" means. wc@2: keys are
         counted above; @appkit-wallet/* is the embedded wallet's session and is
         never counted or purged. */
      if (isConnectionKey(key) && (key.startsWith('@appkit/') || key === 'WALLETCONNECT_DEEPLINK_CHOICE')) {
        facts.appkitConnectionKeys += 1;
      }
    }
    /* Orphan = stale WalletConnect debris that would break the NEXT attempt.
       When the email marker stands those @appkit/* keys belong to the embedded
       wallet's own instance — purging them churns the count forever (observed
       5→4→4) and breaks the restore they were created for. */
    facts.orphanKeys = facts.appkitConnectionKeys > 0 && facts.wcSessionKeys === 0 && !facts.ourMarker;
  } catch {
    /* storage unavailable: the false/0 defaults are the honest answer */
  }
  return facts;
}

/** One fetch with a hard bound. Never throws. */
async function probeJson(url, { fetchImpl, timeoutMs }) {
  const call = fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : null);
  if (!call) return { ok: false, error: 'NO_FETCH' };
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => {
    try { controller?.abort(); } catch { /* best effort */ }
  }, timeoutMs);
  try {
    const res = await call(url, { signal: controller?.signal, cache: 'no-store' });
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    return { ok: Boolean(res.ok), status: res.status, body };
  } catch (error) {
    return {
      ok: false,
      error: error?.name === 'AbortError' ? 'TIMEOUT' : String(error?.message || error)
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The whole report. Never throws.
 *
 * Every host is asked both questions at once — a sequential walk would make a
 * blocked primary delay the fallback's answer by its own timeout, and the report
 * would describe the network as it looked during the first socket rather than as
 * it is.
 */
export async function collectWalletHealth({
  projectId = WC_PROJECT_ID,
  origin,
  fetchImpl,
  WebSocketImpl,
  storage,
  timeoutMs = TIMEOUT.healthProbe,
  trace
} = {}) {
  const currentOrigin = origin ?? (typeof window !== 'undefined' ? window.location.origin : '');
  try {
    const [config, origins, secureSite, relay] = await Promise.all([
      probeJson(configProbeUrl(projectId), { fetchImpl, timeoutMs }),
      probeJson(originsProbeUrl(projectId), { fetchImpl, timeoutMs }),
      probeReachable(SECURE_SITE_URL, { fetchImpl, timeoutMs }),
      measureRelay({ projectId, timeoutMs, force: true, fetchImpl, WebSocketImpl })
    ]);
    const list = Array.isArray(origins?.body?.allowedOrigins) ? origins.body.allowedOrigins : null;
    const reachable = relay.hosts.find((host) => host.socket?.ok);
    return {
      at: new Date().toISOString(),
      origin: currentOrigin,
      projectId: String(projectId || ''),
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
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
        emptyMeansAllowAll: list !== null && list.length === 0,
        originAllowed: isOriginAllowed(currentOrigin, list),
        currentOrigin
      },
      /* `relay` stays the single answer the panel's first row reads; `relays`
         carries every host's own facts, so a ❌ is never one hostname
         pretending to be the whole relay. */
      relay: reachable ? reachable.socket : (relay.hosts[0]?.socket ?? { ok: false, error: 'NO_RELAY_URLS' }),
      relays: relay.hosts,
      relayVerdict: relay.verdict,
      secureSite,
      storage: storageFacts(storage),
      trace: typeof trace === 'function' ? trace() : null
    };
  } catch (error) {
    return { at: new Date().toISOString(), origin: currentOrigin, error: String(error?.message || error) };
  }
}
