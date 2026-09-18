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
import { handoffFacts } from './handoff.js';
import { measureRelay, probeReachable } from './relay.js';
import { EMAIL_MARKER_KEY, SDK_LOGIN_KEY, emailOptions, isEmailFrameChain } from './embedded.js';
import { readSharedConnectionFacts } from './appkit.js';
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

/**
 * `GET /appkit/v1/project-limits` — mirrors `ApiController.fetchUsage()`.
 *
 * The answer GATES THE EMAIL BOX ITSELF: `w3m-email-login-widget` renders its
 * input `?disabled={...|| hasExceededUsageLimit}`, and that flag is
 * `tier === 'starter' && (isAboveMauLimit || isAboveRpcLimit)`. No relay probe
 * or origin check can explain a login box that refuses to be typed into — this
 * endpoint can. The earlier reports never asked it, which is why «email is
 * broken entirely» had no named cause.
 */
export function usageProbeUrl(projectId, sdkVersion = HEALTH_SDK_VERSION) {
  return apiUrl('/appkit/v1/project-limits', projectId, sdkVersion);
}

function apiUrl(path, projectId, sdkVersion) {
  const url = new URL(`${W3M_API_URL}${path}`);
  url.searchParams.set('projectId', String(projectId || ''));
  url.searchParams.set('st', 'appkit');
  url.searchParams.set('sv', sdkVersion);
  return url.toString();
}

/**
 * The `features` object THIS APP hands `createAppKit()`.
 *
 * Read from `emailOptions()` — the one place that decides what we ask the SDK
 * for — instead of a copy written here, so the panel can never drift behind the
 * settings it is describing. Cached because both values are constants.
 */
let localRequest = null;
function localFeatureRequest() {
  if (!localRequest) {
    const features = emailOptions({ projectId: '', metadata: null }).features ?? {};
    localRequest = {
      email: features.email === true,
      socials: Array.isArray(features.socials) ? [...features.socials] : []
    };
  }
  return { email: localRequest.email, socials: [...localRequest.socials] };
}

/**
 * The four platform facts AppKit's social filter reads.
 *
 * Mirrors `CoreHelperUtil` (`@reown/appkit-controllers`) exactly, including the
 * two details that are easy to guess wrong: `isMobile()` ALSO trusts a
 * `(pointer:coarse)` matchMedia, and `isMac()` is NOT gated on `isMobile()` —
 * it is `ua.includes('macintosh') && !ua.includes('safari')`, so a Telegram
 * desktop build matches it. Everything is injectable so a report that arrived
 * from a device can be replayed here.
 */
export function platformFlags(env = {}) {
  const raw = String(env.userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '') ?? '');
  const ua = raw.toLowerCase();
  const coarse = env.pointerCoarse
    ?? (typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? Boolean(window.matchMedia('(pointer:coarse)')?.matches)
      : false);
  const inTelegram = env.telegram
    ?? (typeof window !== 'undefined'
      && Boolean(window.TelegramWebviewProxy || window.Telegram || window.TelegramWebviewProxyProto));
  /* The SDK's own pattern, run against the ORIGINAL case — it is not
     case-insensitive, and lowercasing the UA first would silently drop
     `webOS` and `Opera Mini` from the match. */
  const mobile = Boolean(coarse) || /Android|webOS|iPhone|iPad|iPod|BlackBerry|Opera Mini/u.test(raw);
  return {
    mobile,
    android: mobile && ua.includes('android'),
    ios: mobile && (ua.includes('iphone') || ua.includes('ipad')),
    mac: ua.includes('macintosh') && !ua.includes('safari'),
    telegram: Boolean(inTelegram)
  };
}

/**
 * `OptionsUtil.filterSocialsByPlatform()` — the same rules in the same order.
 *
 * `OptionsController.setRemoteFeatures()` runs it over whatever
 * `ConfigUtil.processFeature()` produced, so the list a device actually renders
 * is NOT the list the dashboard (or we) supplied: Telegram-iOS loses `google`,
 * Telegram-Mac loses `x`, Telegram-Android loses `facebook` and `x`, and every
 * mobile browser loses `facebook`.
 */
export function filterSocialsByPlatform(socials, flags = platformFlags()) {
  if (!Array.isArray(socials) || socials.length === 0) return [];
  let out = socials;
  if (flags.telegram) {
    if (flags.ios) out = out.filter((name) => name !== 'google');
    if (flags.mac) out = out.filter((name) => name !== 'x');
    if (flags.android) out = out.filter((name) => name !== 'facebook' && name !== 'x');
  }
  if (flags.mobile) out = out.filter((name) => name !== 'facebook');
  return [...out];
}

/**
 * Read the dashboard's answer the way the SDK does, and NAME THE SOURCE.
 *
 * ─── WHY THE OLD ANSWER WAS A CONFIDENT WRONG NUMBER ────────────────────────
 * A real report (Samsung Internet 30 / Android 10) carried
 * `{ id:'social_login', isEnabled:true, config:null }`, and this function said
 * `email=false socials=0`. It had modelled one of the SDK's three branches.
 * `ConfigUtil.processFeature()` in `@reown/appkit@1.8.19` is:
 *
 *   if (isBasic && !isAvailableOnBasic) return false;        // we send no `basic`
 *   const apiConfig = this.getApiConfig('social_login', apiProjectConfig);
 *   if (apiConfig?.config === null) return this.processFallbackFeature(…, localValue);
 *   if (!apiConfig?.config)         return false;
 *   return this.processApiFeature(…, apiConfig);
 *
 * So `config: null` never reaches the dashboard's `isEnabled`: AppKit falls back
 * to OUR OWN `features` — `email: true` and our seven socials. `config` ABSENT
 * is the opposite answer (`return false`), and the two used to share one
 * `config: null` in the output. And in every branch the list that finally lands
 * in `remoteFeatures.socials` is passed through the platform filter above, so
 * even the correct list is not the rendered one.
 *
 * Two more shapes, from the same source, and one dashboard answer:
 *   • `features` missing/null → `fetchRemoteFeatures()` sets
 *     `shouldUseApiConfig = false`, so the dashboard is never read → local.
 *   • `features` not an array → `getApiConfig()` is `apiProjectConfig?.find(…)`,
 *     which throws on anything without `.find`; the catch in
 *     `fetchRemoteFeatures()` then returns `DEFAULT_REMOTE_FEATURES` (email on,
 *     the SDK's own seven socials — the same set as `SOCIAL_PROVIDERS`).
 *   • `isEnabled: false` with a real list → off, and off because the DASHBOARD
 *     said so, which is a different sentence from "the list was withheld".
 *
 * Read-only: nothing in the connect path consumes this.
 *
 * @param {object} [payload] the JSON of `GET /appkit/v1/config`
 * @param {object} [env] platform overrides for `platformFlags()`
 * @returns {{shape:'array'|'object'|'none', enabled:boolean,
 *   configKind:'list'|'null'|'absent', config:string[]|null,
 *   source:'dashboard'|'local'|'default'|'off', email:boolean, socials:string[],
 *   requested:{email:boolean,socials:string[]}, platform:object}}
 */
export function summarizeProjectConfig(payload, env) {
  const requested = localFeatureRequest();
  const platform = platformFlags(env);

  const features = payload?.features;
  let shape = 'none';
  let entry = null;
  if (Array.isArray(features)) {
    shape = 'array';
    entry = features.find((item) => item?.id === 'social_login') ?? null;
  } else if (features && typeof features === 'object') {
    shape = 'object';
    entry = features.social_login ?? null;
  }

  /* `null` and `undefined` are the SDK's two opposite answers, so they are
     never merged: only a real list is a list. */
  const raw = entry && typeof entry === 'object' ? entry.config : undefined;
  const configKind = Array.isArray(raw) ? 'list' : (raw === null ? 'null' : 'absent');
  const config = Array.isArray(raw) ? [...raw] : null;

  let source;
  let email;
  let socials;
  if (shape !== 'array') {
    /* No array to `.find` in: either the dashboard was not consulted at all
       ('none') or AppKit threw reading it and used its own defaults ('object').
       Both end up with email on and the seven built-in providers. */
    source = shape === 'object' ? 'default' : 'local';
    email = requested.email;
    socials = requested.socials;
  } else if (configKind === 'null') {
    /* `processFallbackFeature()` → our own `features`. `isEnabled` is NOT read. */
    source = 'local';
    email = requested.email;
    socials = requested.socials;
  } else if (configKind === 'list') {
    /* `processApi()`: `isEnabled && config.includes('email')`, and the same
       list minus that literal — but an EMPTY list or `isEnabled:false` is
       `false`, i.e. nothing. */
    source = 'dashboard';
    email = Boolean(entry.isEnabled) && raw.includes('email');
    socials = Boolean(entry.isEnabled) && raw.length > 0 ? raw.filter((name) => name !== 'email') : [];
  } else {
    /* `if (!apiConfig?.config) return false;` — a truthy non-list would make
       the SDK call `.includes` on something that is not a list, which this
       endpoint has never sent; OFF is the honest reading of "unreadable". */
    source = 'off';
    email = false;
    socials = [];
  }

  return {
    shape,
    enabled: Boolean(entry?.isEnabled),
    configKind,
    config,
    source,
    email,
    socials: filterSocialsByPlatform(socials, platform),
    requested,
    platform
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

/* The keys this report reads VALUES from, beyond key names. Both hold
   connection state only: `@appkit/connection_status` is
   'connected'|'disconnected', and `@appkit/connections` maps namespace →
   connection lists whose only field read here is `connectorId` — an id like
   'AUTH' or 'io.metamask', never an address, topic or URI. */
const CONNECTION_STATUS_KEY = '@appkit/connection_status';
const CONNECTIONS_KEY = '@appkit/connections';
/** The persisted chain `ChainController.initialize()` adopts before anything. */
const ACTIVE_CAIP_NETWORK_KEY = '@appkit/active_caip_network_id';

/**
 * Storage facts as booleans and counts — key names, never secrets.
 *
 * Two facts were added when «email broken after disconnect» turned out to be
 * AppKit 1.8.19 state the purge never covered:
 *   • `connectionStatus` — the value `listenAdapter()` reads FIRST on every
 *     boot; a stale 'connected' opens the next one in `connecting`.
 *   • `storedConnectors` — the connector ids inside `@appkit/connections`. A
 *     non-empty AUTH entry here is what `hasAnyConnection('AUTH')` reads to
 *     DISABLE the email input, so the report must name it.
 */
export function storageFacts(storage) {
  const target = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  const facts = {
    sdkLoginMarker: false,
    ourMarker: false,
    wcSessionKeys: 0,
    appkitConnectionKeys: 0,
    orphanKeys: false,
    connectionStatus: null,
    storedConnectors: [],
    /* ─── THE THIRD REPORT'S MISSING ROWS (2026-09-18, Telegram WebView) ────
       `appkit-keys=4` answered «four keys survived» without saying which, and
       nothing in the report could say WHAT CHAIN the email surface would boot
       on — the one fact the «Action not allowed» failure is decided by. Key
       names are SDK constants (never values, never an address) and the chain
       ids are validated CAIP chain ids, so both survive the copy-paste
       contract. */
    appkitConnectionKeyNames: [],
    activeCaipNetworkId: null,
    frameLastUsedChain: null,
    frameChainSupported: null,
    emailMarkerStale: false
  };
  if (!target) return facts;
  try {
    facts.sdkLoginMarker = String(target.getItem(SDK_LOGIN_KEY) || '') === 'true';
    facts.ourMarker = target.getItem(EMAIL_MARKER_KEY) === '1';
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
      /* Same predicate the purge uses (now value-aware), so the diagnostic and
         the cleanup can never disagree about what "connection state" means.
         wc@2: keys are counted above; @appkit-wallet/* is the embedded wallet's
         session and is never counted or purged. */
      if (isConnectionKey(key, target) && (key.startsWith('@appkit/') || key === 'WALLETCONNECT_DEEPLINK_CHOICE')) {
        facts.appkitConnectionKeys += 1;
        if (facts.appkitConnectionKeyNames.length < 8) facts.appkitConnectionKeyNames.push(key);
      }
      /* The frame's own chain residue — read by `eth_chainId` and by
         `connect()`'s default chain. A value outside the frame's network list
         is the residue that turns a later login into «action not valid». */
      if (key.includes('LAST_USED_CHAIN')) {
        const raw = String(target.getItem(key) ?? '').trim();
        const id = raw.includes(':') ? raw.split(':').pop() : raw;
        if (/^\d{1,12}$/.test(id)) facts.frameLastUsedChain = id;
      }
    }
    const activeChain = String(target.getItem(ACTIVE_CAIP_NETWORK_KEY) || '');
    if (/^[a-z0-9-]+:\d{1,12}$/.test(activeChain)) {
      facts.activeCaipNetworkId = activeChain;
      facts.frameChainSupported = isEmailFrameChain(Number(activeChain.split(':').pop()));
    }
    /* `ourMarker && !sdkMarker && nothing connected` — the state that used to
       disable the clean-slate path (and cost a 30s restore on every boot)
       because nothing could tell it from a session the user is owed. */
    facts.emailMarkerStale = facts.ourMarker
      && !facts.sdkLoginMarker
      && facts.connectionStatus !== 'connected'
      && facts.storedConnectors.length === 0;
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
    const [config, origins, secureSite, relay, usage] = await Promise.all([
      probeJson(configProbeUrl(projectId), { fetchImpl, timeoutMs }),
      probeJson(originsProbeUrl(projectId), { fetchImpl, timeoutMs }),
      probeReachable(SECURE_SITE_URL, { fetchImpl, timeoutMs }),
      measureRelay({ projectId, timeoutMs, force: true, fetchImpl, WebSocketImpl }),
      probeJson(usageProbeUrl(projectId), { fetchImpl, timeoutMs })
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
      /* The hop the pairing leaves from. «The wallet opens but does not
         connect» has four causes and they live on four different hops, so the
         report names the channel instead of making the reader infer it. */
      handoff: channel,
      /* The limiter that can disable the email input outright — named in the
         report the same way the SDK computes it (starter tier above either
         limit). */
      usage: {
        ok: usage.ok,
        status: usage.status ?? null,
        error: usage.error ?? null,
        tier: usage.body?.planLimits?.tier ?? null,
        isAboveMauLimit: Boolean(usage.body?.planLimits?.isAboveMauLimit),
        isAboveRpcLimit: Boolean(usage.body?.planLimits?.isAboveRpcLimit),
        emailDisabledByUsageLimit:
          usage.body?.planLimits?.tier === 'starter'
          && (Boolean(usage.body?.planLimits?.isAboveMauLimit) || Boolean(usage.body?.planLimits?.isAboveRpcLimit))
      },
      storage: storageFacts(storage),
      /* ─── THE IN-MEMORY HALF (2026-09-18 report, third round) ──────────────
         A storage purge cannot see the shared controllers, and the one fact
         they decide that no storage row can show is whether the email input
         renders DISABLED: `w3m-email-login-widget` computes `disabled` from
         `ConnectionController.hasAnyConnection('AUTH')`, which is true for an
         entry that carries no account at all (a ghost left by an attempt whose
         teardown lost its race). The report therefore names the entries, the
         accounts they carry, and the routing flags — so «the box opened and
         the input could not be typed into» is evidence in the JSON rather than
         a sentence in a support thread. Best-effort: an unreachable chunk must
         not cost the whole report. */
      shared: await sharedFactsSafe(),
      trace: typeof trace === 'function' ? trace() : null
    };
  } catch (error) {
    return { at: new Date().toISOString(), origin: currentOrigin, error: String(error?.message || error) };
  }
}
