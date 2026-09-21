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
  TIMEOUT,
  WC_ALLOWED_ORIGINS,
  WC_ANDROID_APP_ID,
  WC_PROJECT_ID,
  wcMetadata,
  walletIdentityFacts
} from './config.js';
import { handoffFacts } from './handoff.js';
import { measureRelay } from './relay.js';
/* Imported as well as re-exported: a re-export does not create a local binding,
   and the report reads these two itself. */
import { configProbeUrl, originsProbeUrl } from './apiUrls.js';
import { classifyWalletConnectDiagnosis, diagnosisStatuses, sdkConfigFacts } from './diagnostics.js';
import { wcFlowState } from './flowState.js';
import { readSharedConnectionFacts } from './appkit.js';
import { isConnectionKey, listEmbeddedWalletKeys } from './storage.js';
import {
  VERIFY_ATTESTATION_TIMEOUT_MS,
  isOriginAllowed as isOriginOnAllowlist,
  predictVerifyVerdict,
  probeVerifyAttestation,
  probeVerifyReachability
} from './verify.js';

/**
 * Is the current origin allowed, by the SDK's own rule?
 *
 * Re-exported from verify.js, where the rule lives next to the two other
 * Verify facts it has to agree with (the registry prediction and the live
 * attestation). The name and the answer are unchanged for callers.
 */
export function isOriginAllowed(currentOrigin, list) {
  return isOriginOnAllowlist(currentOrigin, list);
}

/*
 * The two Reown API URLs are re-exported from apiUrls.js, which is where they
 * live now that the diagnostic engine (diagnostics.js) reads the same two
 * endpoints and would otherwise need a second copy of the query string. The
 * names and the answers are unchanged for every existing caller.
 */
export { configProbeUrl, originsProbeUrl } from './apiUrls.js';

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
 * Head-only probe of the Verify Enclave.
 *
 * The probe itself lives in verify.js, next to the host it measures and the
 * attestation flow it belongs to, so the panel, the CLI diagnostic and any
 * other reader share one answer. Kept as a local alias here so the report
 * shape (`verifyEnclave`) is unchanged for existing readers.
 */
function probeVerifyEnclave({ fetchImpl, timeoutMs } = {}) {
  return probeVerifyReachability({ fetchImpl, timeoutMs: timeoutMs ?? TIMEOUT.healthProbe });
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
  trace,
  win,
  now
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

    /* Measured ONCE, then read by both the report and the verdict below. Two
       calls to the same probe is how a panel ends up printing «still checking»
       next to a verdict that was already decided from a different answer. */
    const identity = walletIdentityFacts();
    const metadata = wcMetadata();
    const attestation = await probeVerifyAttestation({
      win,
      projectId,
      origin: currentOrigin,
      timeoutMs: VERIFY_ATTESTATION_TIMEOUT_MS,
      now
    });
    const enclave = await probeVerifyEnclave({ fetchImpl, timeoutMs });
    /* Read once, used by both the flow derivation and the report rows below. */
    const storageNow = storageFacts(storage);
    const sharedNow = await sharedFactsSafe();
    const diagnosis = classifyWalletConnectDiagnosis({
      sdkConfig: sdkConfigFacts({ projectId, metadata, declaredOrigins: WC_ALLOWED_ORIGINS }),
      pageOrigin: currentOrigin,
      declaredUrl: metadata.url,
      packaged: identity.packaged,
      registry: { ok: Boolean(origins?.ok), status: origins?.status ?? null, list },
      projectConfig: { ok: Boolean(config?.ok), status: config?.status ?? null },
      relay,
      verify: { enclave, attestation },
      projectId
    });

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
      identity,
      /* What the wallet will be told about us, including the verifyUrl the
         SDK ships in the session proposal. The dashboard registration row
         below names the entries the allowlist MUST contain — and is the
         support copy when it does not. */
      metadata: {
        url: metadata.url,
        verifyUrl: metadata.verifyUrl || null,
        iconUrl: metadata.icons?.[0] || null
      },
      /* The expected allowlist, read from the same source `walletIdentityUrl`
         reads from. Surfaced here so the support thread can paste it next to
         whatever the dashboard actually returns and read the difference. */
      dashboardExpected: {
        origins: WC_ALLOWED_ORIGINS,
        appIds: [WC_ANDROID_APP_ID]
      },
      /* ── WHY THE WALLET SAYS «UNVERIFIED» ────────────────────────────────
         Three facts, in the order the wallet's own verdict is built:
           · `registry`   — the project's allowlist, i.e. the domain registry
                            the Verify server checks `isVerified` against. An
                            EMPTY list is not «allow all» for Verify: it is a
                            project with no domain, and every wallet renders
                            «Cannot verify» for it.
           · `attestation`— the real thing: the enclave iframe the SDK itself
                            loads, and the `isVerified` the server signed into
                            the JWT. This is the answer the wallet reads.
           · `predicted`  — the verdict those two imply, computed so the cause
                            is still nameable when the enclave is unreachable
                            and no attestation can be had at all. */
      verify: {
        registry: {
          list,
          domains: Array.isArray(list) ? list.length : null,
          /* AppKit's own gate — kept, because «AppKit refuses to boot» and
             «the wallet says unverified» are different reports. */
          originAllowed: isOriginAllowed(currentOrigin, list),
          emptyMeansAllowAllForAppKit: list !== null && list.length === 0
        },
        attestation,
        predicted: predictVerifyVerdict({
          allowedOrigins: list,
          declaredUrl: metadata.url,
          pageOrigin: currentOrigin
        })
      },
      /* Reachability of the Verify Enclave. The Enclave is the actor that
         decides whether a session proposal's origin attests VALID; if it is
         unreachable the report should say so rather than blame the dashboard.
         There is intentionally NO file fetch here: the `walletconnect.txt`
         path is part of the deprecated DNS-TXT verification flow, and a
         404 there would be a false negative for the active attestation flow. */
      verifyEnclave: enclave,
      relay: reachable ? reachable.socket : (relay.hosts[0]?.socket ?? { ok: false, error: 'NO_RELAY_URLS' }),
      relays: relay.hosts,
      relayVerdict: relay.verdict,
      /* ── THE ONE VERDICT ──────────────────────────────────────────────────
         Eight named causes, one of which is OK. It is computed from the SAME
         measurements printed above, by the same engine the CLI
         (`npm run walletconnect:check`) and the test matrix use, so the panel
         and a terminal can never disagree about what is wrong. */
      diagnosis,
      /* The two status lines, computed from the SAME verdict the CLI prints:
         the panel must never disagree with `npm run walletconnect:check`. */
      ...diagnosisStatuses(diagnosis, { ok: Boolean(origins?.ok), status: origins?.status ?? null, list }, currentOrigin),
      registry: {
        ok: Boolean(origins?.ok),
        status: origins?.status ?? null,
        error: origins?.error ?? null,
        list,
        originAllowed: isOriginAllowed(currentOrigin, list),
        emptyMeansAllowAllForAppKit: list !== null && list.length === 0
      },
      /* ── WHICH MOMENT OF THE TRIP WE ARE IN ──────────────────────────────
         Derived from the facts already measured above (an attached account, a
         stored pairing, the shared controllers) — never from a second status
         field that could disagree with them. */
      flow: (() => {
        /* The two sources the flow is derived from are read ONCE, before the
           report is assembled, so the state cannot be computed from a different
           answer than the rows below it print. */
        const connectedNow = sharedNow?.isConnected === true || storageNow?.connectionStatus === 'connected';
        return wcFlowState({
          connected: connectedNow,
          /* A stored session with nothing attached is a pairing that has not
             been approved yet — the one case a reader would otherwise have to
             infer from two separate rows. */
          connecting: !connectedNow && (storageNow?.wcSessionKeys ?? 0) > 0
        });
      })(),
      /* The hop the pairing leaves from. «The wallet opens but does not
         connect» has four causes and they live on four different hops, so the
         report names the channel instead of making the reader infer it. */
      handoff: channel,
      storage: storageNow,
      /* The in-memory half a storage purge cannot see: the shared AppKit
         controllers every `<w3m-modal>` renders from. Best-effort — an
         unreachable chunk must not cost the whole report. */
      shared: sharedNow,
      trace: typeof trace === 'function' ? trace() : null
    };
  } catch (error) {
    return { at: new Date().toISOString(), origin: currentOrigin, error: String(error?.message || error) };
  }
}
