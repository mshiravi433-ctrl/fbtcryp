/**
 * THE WALLET HEALTH REPORT
 * ---------------------------------------------------------------------------
 * The links a wallet report is always about are the ones the UI cannot show:
 * does the dashboard know this project, does its allowlist cover this origin,
 * does the relay's WebSocket open on THIS network, and which channel a wallet
 * hand-off leaves from. This measures those on the device and network where
 * the user is, and prints copyable JSON, so the next report arrives with the
 * failing hop named instead of described.
 *
 * Lean on purpose: a handful of probes, one verdict, and storage facts. Every
 * field is a measured fact or an error string — never a diagnosis, because a
 * wrong diagnosis shipped as a label is worse than raw evidence a human can
 * read.
 *
 * ─── WHAT IS NO LONGER HERE (2026-09-18) ───────────────────────────────────
 * The email/social embedded-wallet surface was retired, and every probe that
 * only existed to explain IT went with it: the secure-frame reachability check
 * (secure.walletconnect.org), the project usage limits that gate AppKit's
 * email input, the dashboard's email/social feature summary and the platform
 * filter that decided which social buttons would render. What is left measures
 * WalletConnect — the only external transport this app offers.
 *
 * Everything injectable (fetch / WebSocket / storage) so every network edge can
 * be held still in a test.
 */

import {
  HEALTH_SDK_VERSION,
  TIMEOUT,
  W3M_API_URL,
  WC_ALLOWED_ORIGINS,
  WC_ANDROID_APP_ID,
  WC_PROJECT_ID,
  WC_VERIFY_FILE_PATH,
  wcMetadata,
  walletIdentityFacts
} from './config.js';
import { handoffFacts } from './handoff.js';
import { measureRelay } from './relay.js';
import { readSharedConnectionFacts } from './appkit.js';
import { isConnectionKey, listEmbeddedWalletKeys } from './storage.js';

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

/* The keys this report reads VALUES from, beyond key names. Both hold
   connection state only: `@appkit/connection_status` is
   'connected'|'disconnected', and `@appkit/connections` maps namespace →
   connection lists whose only field read here is `connectorId` — an id like
   'io.metamask' or 'walletConnect', never an address, topic or URI. */
const CONNECTION_STATUS_KEY = '@appkit/connection_status';
const CONNECTIONS_KEY = '@appkit/connections';
/** The persisted chain `ChainController.initialize()` adopts before anything. */
const ACTIVE_CAIP_NETWORK_KEY = '@appkit/active_caip_network_id';

/**
 * Storage facts as booleans and counts — key names, never secrets.
 *
 *   • `connectionStatus` — the value `listenAdapter()` reads FIRST on every
 *     boot; a stale 'connected' opens the next one in `connecting`.
 *   • `storedConnectors` — the connector ids inside `@appkit/connections`,
 *     i.e. what the SDK would try to re-attach before asking anybody.
 *   • `legacyEmbeddedKeys` — residue of the retired email/social surface
 *     (`fbt_email_social_connected`, `@appkit-wallet/*`, the social provider
 *     keys). The boot purge removes them; this row proves it did.
 */
export function storageFacts(storage) {
  const target = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  const facts = {
    wcSessionKeys: 0,
    appkitConnectionKeys: 0,
    orphanKeys: false,
    connectionStatus: null,
    storedConnectors: [],
    /* Key names only (never values, never an address): `appkit-keys=4`
       answered «four keys survived» without saying which, and the next report
       should not have to guess. */
    appkitConnectionKeyNames: [],
    activeCaipNetworkId: null,
    legacyEmbeddedKeys: 0
  };
  if (!target) return facts;
  try {
    facts.legacyEmbeddedKeys = listEmbeddedWalletKeys(target).length;
    const status = target.getItem(CONNECTION_STATUS_KEY);
    facts.connectionStatus = status === 'connected' || status === 'disconnected' ? status : null;
    try {
      const raw = target.getItem(CONNECTIONS_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === 'object') {
        const ids = new Set();
        for (const list of Object.values(parsed)) {
          if (Array.isArray(list)) {
            for (const entry of list) {
              const id = String(entry?.connectorId ?? '').trim();
              if (id) ids.add(id);
            }
          }
        }
        facts.storedConnectors = [...ids];
      }
    } catch { /* unreadable — the empty list is the honest answer */ }
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
         counted above. */
      if (isConnectionKey(key, target) && (key.startsWith('@appkit/') || key === 'WALLETCONNECT_DEEPLINK_CHOICE')) {
        facts.appkitConnectionKeys += 1;
        if (facts.appkitConnectionKeyNames.length < 8) facts.appkitConnectionKeyNames.push(key);
      }
    }
    const activeChain = String(target.getItem(ACTIVE_CAIP_NETWORK_KEY) || '');
    if (/^[a-z0-9-]+:\d{1,12}$/.test(activeChain)) facts.activeCaipNetworkId = activeChain;
    /* Orphan = stale WalletConnect debris that would break the NEXT attempt:
       AppKit connection keys with no session behind them. */
    facts.orphanKeys = facts.appkitConnectionKeys > 0 && facts.wcSessionKeys === 0;
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
 * Head-only probe of the verification file on a given origin.
 *
 * The Reown verifier reads the file at `/.well-known/walletconnect.txt` from
 * every origin in the allowlist, not just from the canonical one. A 404 on
 * any of them is what makes a "registered" dApp read as UNVERIFIED. The
 * check is HEAD so a misconfigured origin cannot pull the whole page into a
 * long block on a slow server, and the response is cached by the browser as
 * an empty body.
 *
 * Verifies with a plain GET only if HEAD is not implemented by the origin's
 * static-file server; some hosts return 405 for HEAD on text files even
 * though GET answers 200.
 */
async function probeVerifyFile(origin, { fetchImpl, timeoutMs } = {}) {
  if (!origin) return { ok: false, error: 'NO_ORIGIN' };
  const call = fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : null);
  if (!call) return { ok: false, error: 'NO_FETCH' };
  const url = `${String(origin).replace(/\/+$/, '')}${WC_VERIFY_FILE_PATH}`;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => {
    try { controller?.abort(); } catch { /* best effort */ }
  }, timeoutMs ?? TIMEOUT.healthProbe);
  try {
    const res = await call(url, { method: 'HEAD', signal: controller?.signal, cache: 'no-store' });
    if (res.status === 405 || res.status === 501) {
      /* Some static hosts reject HEAD; the file itself may still be there. */
      const res2 = await call(url, { method: 'GET', signal: controller?.signal, cache: 'no-store' });
      return { ok: res2.ok, status: res2.status, url };
    }
    return { ok: res.ok, status: res.status, url };
  } catch (error) {
    return {
      ok: false,
      error: error?.name === 'AbortError' ? 'TIMEOUT' : String(error?.message || error),
      url
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `readSharedConnectionFacts()` without the ability to fail the report.
 * The facts themselves carry `available: false` when the controllers chunk is
 * unreachable, which is the honest answer — an exception here would replace
 * every measured row with an error string.
 */
async function sharedFactsSafe() {
  try {
    return await readSharedConnectionFacts();
  } catch {
    return { available: false };
  }
}

/**
 * The whole report. Never throws.
 *
 * Every relay host is asked both questions at once — a sequential walk would
 * make a blocked primary delay the fallback's answer by its own timeout, and
 * the report would describe the network as it looked during the first socket
 * rather than as it is.
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
  const channel = handoffFacts();
  try {
    const [config, origins, relay] = await Promise.all([
      probeJson(configProbeUrl(projectId), { fetchImpl, timeoutMs }),
      probeJson(originsProbeUrl(projectId), { fetchImpl, timeoutMs }),
      measureRelay({ projectId, timeoutMs, force: true, fetchImpl, WebSocketImpl })
    ]);
    const list = Array.isArray(origins?.body?.allowedOrigins) ? origins.body.allowedOrigins : null;
    const reachable = relay.hosts.find((host) => host.socket?.ok);
    return {
      at: new Date().toISOString(),
      origin: currentOrigin,
      projectId: String(projectId || ''),
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      /* The dashboard knowing this project at all is the first hop: a retired
         or mistyped id answers 403 here and nothing downstream can work. */
      projectConfig: {
        ok: config.ok,
        status: config.status ?? null,
        error: config.error ?? null
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
      /* ── THE ORIGIN THE WALLET WILL BE TOLD ────────────────────────────────
         A session proposal carries an identity, not a link, and the wallet
         cross-checks it against the origin WalletConnect's Verify API attested.
         When the two disagree the verdict is INVALID, which every wallet
         renders as a domain mismatch — the red «this dApp may be a scam» screen
         with a continue-anyway button. This block is that comparison, taken on
         the device that is actually connected: `declared` is what we will say,
         `pageOrigin` is what the attestation will say. */
      identity: walletIdentityFacts(),
      /* What the wallet will be told about us, including the verifyUrl the
         SDK ships in the session proposal. The dashboard registration row
         below names the entries the allowlist MUST contain — and is the
         support copy when it does not. */
      metadata: {
        url: wcMetadata().url,
        verifyUrl: wcMetadata().verifyUrl || null,
        iconUrl: wcMetadata().icons?.[0] || null,
        verifyFilePath: WC_VERIFY_FILE_PATH
      },
      /* The expected allowlist, read from the same source `walletIdentityUrl`
         reads from. Surfaced here so the support thread can paste it next to
         whatever the dashboard actually returns and read the difference. */
      dashboardExpected: {
        origins: WC_ALLOWED_ORIGINS,
        appIds: [WC_ANDROID_APP_ID]
      },
      /* Whether the verification file is served on the page's own origin.
         A 404 here is the single most common reason a "verified" dApp still
         reads as UNVERIFIED — the dashboard is registered but the file the
         verifier fetches returns 404. */
      verifyFile: await probeVerifyFile(currentOrigin, { fetchImpl, timeoutMs }),
      relay: reachable ? reachable.socket : (relay.hosts[0]?.socket ?? { ok: false, error: 'NO_RELAY_URLS' }),
      relays: relay.hosts,
      relayVerdict: relay.verdict,
      /* The hop the pairing leaves from. «The wallet opens but does not
         connect» has four causes and they live on four different hops, so the
         report names the channel instead of making the reader infer it. */
      handoff: channel,
      storage: storageFacts(storage),
      /* The in-memory half a storage purge cannot see: the shared AppKit
         controllers every `<w3m-modal>` renders from. Best-effort — an
         unreachable chunk must not cost the whole report. */
      shared: await sharedFactsSafe(),
      trace: typeof trace === 'function' ? trace() : null
    };
  } catch (error) {
    return { at: new Date().toISOString(), origin: currentOrigin, error: String(error?.message || error) };
  }
}
