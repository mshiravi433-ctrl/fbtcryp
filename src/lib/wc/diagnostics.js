/**
 * WALLETCONNECT DIAGNOSIS — ONE ENGINE, ONE ANSWER, EIGHT POSSIBLE CAUSES.
 * ---------------------------------------------------------------------------
 * «Invalid domain», «Unverified domain», «Unknown verification», «wrong origin»
 * and «the wallet opens but FBT loses the pending connection» are five reports
 * that arrive with ONE label from the wallet and lead to five different fixes:
 *
 *   a code fix (our metadata names another origin)      → ORIGIN_MISMATCH
 *   a code fix (metadata is malformed for the wallet)   → METADATA_MISMATCH
 *   a code fix (the build shipped a retired project id) → PROJECT_ID_MISMATCH
 *   a code fix (the SDK is wired with impossible values) → SDK_CONFIGURATION_ERROR
 *   a dashboard fix (the origin is not in the registry) → DOMAIN_NOT_REGISTERED
 *   a network fix (the attestation host is filtered)    → VERIFY_SERVICE_UNREACHABLE
 *   a network fix (no relay socket opens)               → RELAY_UNREACHABLE
 *   nothing is wrong                                    → OK
 *
 * This module measures the facts and returns exactly one of those, with the
 * measured values next to it. It is the single source of truth for three
 * readers that must never disagree:
 *
 *   · `npm run walletconnect:check`  (scripts/walletconnect-domain-verify.mjs)
 *   · the Wallet Health panel        (src/components/WalletHealthPanel.jsx)
 *   · the test matrix                (test/wallet-diagnostics-probe.mjs)
 *
 * ─── THE ONE RULE THIS FILE OBEYS ───────────────────────────────────────────
 * A code-side fact (metadata, project id, origin agreement) is checked FIRST
 * and reported as its own code, because those are the only ones a commit can
 * fix. Only after every code-side fact is PASS does a dashboard or network
 * cause get the headline — and even then the code status is printed as PASS
 * rather than being folded into the failure. That is what stops the next
 * investigation from re-reading the code for four days while the answer sits in
 * a dashboard.
 *
 * Everything external is injectable (fetch, WebSocket, window, clock) so every
 * branch below is testable without a browser and without a network.
 */

import {
  RELAY_URLS,
  TIMEOUT,
  WC_ALLOWED_ORIGINS,
  WC_PROJECT_ID,
  wcMetadata,
  walletIdentityFacts
} from './config.js';
import { configProbeUrl, originsProbeUrl } from './apiUrls.js';
import { measureRelay } from './relay.js';
import { isOriginAllowed, predictVerifyVerdict, probeVerifyAttestation, probeVerifyReachability } from './verify.js';

/** The only verdicts this engine can return. */
export const WC_DIAGNOSIS = Object.freeze({
  OK: 'OK',
  ORIGIN_MISMATCH: 'ORIGIN_MISMATCH',
  DOMAIN_NOT_REGISTERED: 'DOMAIN_NOT_REGISTERED',
  VERIFY_SERVICE_UNREACHABLE: 'VERIFY_SERVICE_UNREACHABLE',
  PROJECT_ID_MISMATCH: 'PROJECT_ID_MISMATCH',
  METADATA_MISMATCH: 'METADATA_MISMATCH',
  RELAY_UNREACHABLE: 'RELAY_UNREACHABLE',
  SDK_CONFIGURATION_ERROR: 'SDK_CONFIGURATION_ERROR'
});

/** Which side owns the fix. Nothing here is ever presented as a code fix twice. */
export const WC_DIAGNOSIS_OWNER = Object.freeze({
  OK: 'NONE',
  ORIGIN_MISMATCH: 'CODE',
  METADATA_MISMATCH: 'CODE',
  PROJECT_ID_MISMATCH: 'CODE_OR_CONFIG',
  SDK_CONFIGURATION_ERROR: 'CODE',
  DOMAIN_NOT_REGISTERED: 'DASHBOARD',
  VERIFY_SERVICE_UNREACHABLE: 'NETWORK',
  RELAY_UNREACHABLE: 'NETWORK'
});

/** One sentence per code — the sentence, not a label. */
export const WC_DIAGNOSIS_SENTENCE = Object.freeze({
  OK: 'metadata, project id, origin, registry, relay and the verify service all agree.',
  ORIGIN_MISMATCH:
    'metadata.url is not the origin this page is running on. Wallets cross-check the two and '
    + 'render a mismatch («this dApp may be a scam»), so the page must introduce itself with the '
    + 'origin it was actually served from.',
  METADATA_MISMATCH:
    'the metadata object cannot be silently repaired: a required field is missing, or one of its '
    + 'URLs points somewhere a wallet cannot fetch to confirm this dApp.',
  PROJECT_ID_MISMATCH:
    'the project id this build ships is not the project the API knows (403/404). Every session '
    + 'proposal made with it is unverifiable, no matter how correct the metadata is.',
  SDK_CONFIGURATION_ERROR:
    'the SDK was handed a value it cannot use (project id shape, non-https url, origin list). '
    + 'This fails before any wallet is involved.',
  DOMAIN_NOT_REGISTERED:
    'the code is correct but this origin is not in the project’s domain registry. The Verify '
    + 'service therefore signs `isVerified: false` and every wallet shows «Cannot verify / '
    + 'Unverified domain». A human has to add the origin in the Reown dashboard.',
  VERIFY_SERVICE_UNREACHABLE:
    'verify.walletconnect.org did not answer from this network, so no attestation can be '
    + 'produced. The wallet sees the absence and reports «Unknown / cannot verify» — the same '
    + 'label as an unregistered domain, with the opposite fix.',
  RELAY_UNREACHABLE:
    'no relay WebSocket opened on any configured host. Pairing cannot complete on this network; '
    + 'the wallet may still open but the approval can never reach the dApp.'
});

/** The project id shape the API accepts: 32 lowercase hex characters. */
const PROJECT_ID_RE = /^[0-9a-f]{32}$/;

/**
 * Everything that can be decided WITHOUT the network.
 *
 * Split out because it is the half a commit can fix, and because a support
 * report that names «metadata.url is not the page origin» does not need a
 * relay probe to be believed.
 *
 * @returns {{ok:boolean, problems:string[], facts:object}}
 */
export function sdkConfigFacts({ projectId = WC_PROJECT_ID, metadata, declaredOrigins = WC_ALLOWED_ORIGINS, view } = {}) {
  const meta = metadata ?? wcMetadata(view);
  const problems = [];
  const facts = {
    projectId: String(projectId || ''),
    metadata: meta,
    declaredOrigins: [...(declaredOrigins ?? [])]
  };

  if (!PROJECT_ID_RE.test(String(projectId || ''))) problems.push('PROJECT_ID_SHAPE');
  if (!meta?.name) problems.push('METADATA_NAME_MISSING');
  if (!meta?.description) problems.push('METADATA_DESCRIPTION_MISSING');
  if (!/^https:\/\//i.test(String(meta?.url || ''))) problems.push('METADATA_URL_NOT_HTTPS');
  if (!Array.isArray(meta?.icons) || meta.icons.length === 0) problems.push('METADATA_ICONS_MISSING');
  for (const icon of meta?.icons ?? []) {
    if (!/^https:\/\//i.test(String(icon))) {
      problems.push('METADATA_ICON_NOT_HTTPS');
      break;
    }
    /*
     * The icon is fetched by the WALLET, from its own network, before it shows
     * the prompt. A same-origin icon is the only one whose availability we can
     * vouch for; a cross-origin icon is a promise about somebody else's
     * uptime, and a broken one renders as the wallet's placeholder mark.
     */
    try {
      if (new URL(icon).origin !== new URL(String(meta.url)).origin) {
        problems.push('METADATA_ICON_CROSS_ORIGIN');
        break;
      }
    } catch {
      problems.push('METADATA_ICON_UNPARSEABLE');
      break;
    }
  }
  if (!meta?.verifyUrl) problems.push('METADATA_VERIFY_URL_MISSING');
  else if (String(meta.verifyUrl).replace(/\/+$/, '') !== String(meta.url).replace(/\/+$/, '')) {
    /*
     * The Verify service is asked about ONE url. A verifyUrl naming a different
     * host than `url` means the wallet is told two things about where this dApp
     * lives, which is the shape of a spoofed proposal.
     */
    problems.push('METADATA_VERIFY_URL_MISMATCH');
  }
  if (!Array.isArray(declaredOrigins) || declaredOrigins.length === 0) problems.push('ALLOWED_ORIGINS_EMPTY');
  for (const origin of declaredOrigins ?? []) {
    if (!/^https?:\/\/[^\s]+$/i.test(String(origin))) {
      problems.push('ALLOWED_ORIGIN_MALFORMED');
      break;
    }
  }

  return { ok: problems.length === 0, problems, facts };
}

/**
 * The verdict, from measured facts.
 *
 * Inputs (all optional — a missing measurement is not a failure):
 *   sdkConfig       — the result of sdkConfigFacts()
 *   pageOrigin      — window.location.origin
 *   declaredUrl     — metadata.url
 *   packaged        — Capacitor native platform?
 *   registry        — {list: string[]|null, ok:boolean, status?:number}
 *   projectConfig   — {ok:boolean, status?:number}
 *   relay           — {hosts:[{url, socket:{ok}}]}
 *   verify          — {enclave:{ok}, attestation:{verdict}|null}
 */
export function classifyWalletConnectDiagnosis({
  sdkConfig,
  pageOrigin = '',
  declaredUrl = '',
  packaged = false,
  registry = null,
  projectConfig = null,
  relay = null,
  verify = null,
  projectId = WC_PROJECT_ID
} = {}) {
  const page = String(pageOrigin || '').replace(/\/+$/, '');
  const declared = String(declaredUrl || '').replace(/\/+$/, '');
  /*
   * `https://localhost` (the packaged WebView) and a dev server are NOT public
   * origins. `walletIdentityUrl()` deliberately declares the canonical public
   * host from there — a wallet cannot fetch localhost — so an inequality there
   * is the documented exception, not a mismatch. Anything else that disagrees
   * with its own address bar is a mismatch.
   */
  const localOnly = !/^https:\/\//i.test(page) || /^https:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(page);
  const originMatch = {
    pageOrigin: page,
    declared,
    packaged: Boolean(packaged),
    localOnly,
    matches: Boolean(page) && declared === page,
    exempt: Boolean(localOnly)
  };

  const hosts = Array.isArray(relay?.hosts) ? relay.hosts : [];
  const relayOpen = hosts.filter((h) => h?.socket?.ok);
  const registryList = Array.isArray(registry?.list) ? registry.list : null;
  const originAllowed = registryList === null ? null : isOriginAllowed(page, registryList);
  /*
   * The attestation is optional in two places: a CLI run has no document to
   * hang the SDK's iframe on, and a filtered network may never answer. Only an
   * ANSWERED attestation is allowed to move the verdict; absence is reported as
   * absence (the sub-facts carry it).
   */
  const attested = verify?.attestation?.verdict ?? null;
  const enclaveOk = verify?.enclave ? Boolean(verify.enclave.ok) : null;

  const base = {
    ok: false,
    code: WC_DIAGNOSIS.SDK_CONFIGURATION_ERROR,
    owner: WC_DIAGNOSIS_OWNER.SDK_CONFIGURATION_ERROR,
    sentence: WC_DIAGNOSIS_SENTENCE.SDK_CONFIGURATION_ERROR,
    problems: [],
    facts: {
      projectId: String(projectId || ''),
      originMatch,
      registry: { readable: registryList !== null, domains: registryList?.length ?? null, list: registryList, originAllowed },
      projectConfig: projectConfig ? { ok: Boolean(projectConfig.ok), status: projectConfig.status ?? null } : null,
      relay: { hosts: hosts.length, open: relayOpen.length, openUrls: relayOpen.map((h) => h.url) },
      verify: { enclaveOk, attested }
    }
  };
  const finish = (code, problems = []) => ({
    ...base,
    ok: code === WC_DIAGNOSIS.OK,
    code,
    owner: WC_DIAGNOSIS_OWNER[code] ?? 'UNKNOWN',
    sentence: WC_DIAGNOSIS_SENTENCE[code] ?? '—',
    problems
  });

  /*
   * ── THE ORDER ────────────────────────────────────────────────────────────
   * Code-side causes are absolute: nothing else can be trusted while the page
   * is introducing itself wrongly. After those, the causes are ordered by what
   * the user experiences FIRST — a registry with no domain on it (every wallet
   * says «unverified»), then a relay that cannot carry the pairing, then an
   * enclave that cannot attest. Every cause that was detected is kept in
   * `findings`, so a report never hides the second problem behind the first.
   */
  const findings = [];

  /* ── 1. code-side: the SDK was handed something it cannot use ───────────── */
  if (sdkConfig && sdkConfig.ok === false) {
    return finish(WC_DIAGNOSIS.SDK_CONFIGURATION_ERROR, sdkConfig.problems ?? []);
  }

  /* ── 2. code-side: the page must declare itself ─────────────────────────── */
  if (!originMatch.exempt && page && declared && !originMatch.matches) {
    return finish(WC_DIAGNOSIS.ORIGIN_MISMATCH, ['METADATA_URL_NOT_PAGE_ORIGIN']);
  }

  /* ── 3. code-side: the project this build ships must be the real one ────── */
  const projectMissing = projectConfig
    && projectConfig.ok === false
    && (projectConfig.status === 403 || projectConfig.status === 404);
  if (projectMissing) return finish(WC_DIAGNOSIS.PROJECT_ID_MISMATCH, [`PROJECT_CONFIG_HTTP_${projectConfig.status}`]);

  const registryUnknownId = registry && registry.ok === false
    && (registry.status === 403 || registry.status === 404);
  if (registryUnknownId) return finish(WC_DIAGNOSIS.PROJECT_ID_MISMATCH, [`ORIGINS_HTTP_${registry.status}`]);

  /*
   * ── 4. dashboard: the origin is not in the registry ───────────────────────
   *
   * Read BEFORE the network causes on purpose. A project with no domain (or an
   * origin missing from it) makes every wallet render «cannot verify»
   * regardless of how well the relay and the enclave answer — reporting
   * RELAY_UNREACHABLE at the same moment would send the owner to look at their
   * VPN while the actual fix is one row in a dashboard. Only a READABLE
   * registry can produce this verdict; an unreadable one is a network report.
   */
  if (registryList !== null && (registryList.length === 0 || originAllowed === false)) {
    findings.push({
      code: WC_DIAGNOSIS.DOMAIN_NOT_REGISTERED,
      problems: [registryList.length === 0 ? 'REGISTRY_EMPTY' : 'ORIGIN_NOT_IN_REGISTRY']
    });
  }

  /* ── 5. the relay: pairing is impossible without a socket ───────────────── */
  if (hosts.length > 0 && relayOpen.length === 0) {
    findings.push({
      code: WC_DIAGNOSIS.RELAY_UNREACHABLE,
      problems: [`RELAY_VERDICT_${relay?.verdict ?? 'UNKNOWN'}`]
    });
  }

  /* ── 6. the attestation service: reachable? did it answer? ──────────────── */
  if (registryList === null && registry && registry.ok === false) {
    const attestationMissing = attested === null || attested === 'NO_ATTESTATION' || attested === 'NO_BROWSER';
    if (enclaveOk === false || attestationMissing) {
      findings.push({
        code: WC_DIAGNOSIS.VERIFY_SERVICE_UNREACHABLE,
        problems: [
          enclaveOk === false ? 'ENCLAVE_UNREACHABLE' : 'ENCLAVE_NOT_MEASURED',
          attestationMissing ? `ATTESTATION_${attested ?? 'NOT_MEASURED'}` : 'ATTESTATION_PRESENT'
        ]
      });
    }
  }

  /* ── 7. an answered attestation that contradicts this origin ───────────── */
  if (attested === 'MISMATCH') findRest(WC_DIAGNOSIS.ORIGIN_MISMATCH, 'ATTESTATION_ORIGIN_MISMATCH');
  if (attested === 'THREAT') findRest(WC_DIAGNOSIS.METADATA_MISMATCH, 'ATTESTATION_THREAT');
  if (attested === 'EXPIRED' || attested === 'ID_MISMATCH') {
    findRest(WC_DIAGNOSIS.VERIFY_SERVICE_UNREACHABLE, `ATTESTATION_${attested}`);
  }

  /* ── 8. nothing measured at all is not the same as healthy ─────────────── */
  if (findings.length === 0 && registryList === null && hosts.length === 0 && enclaveOk === null) {
    return finish(WC_DIAGNOSIS.SDK_CONFIGURATION_ERROR, ['NOTHING_MEASURED']);
  }

  if (findings.length === 0) return { ...finish(WC_DIAGNOSIS.OK), findings: [] };
  const headline = findings[0];
  const result = finish(headline.code, headline.problems);
  return {
    ...result,
    findings: findings.map((finding) => ({
      code: finding.code,
      owner: WC_DIAGNOSIS_OWNER[finding.code] ?? 'UNKNOWN',
      problems: finding.problems
    }))
  };

  /** Push a cause that must not overwrite one already found. */
  function findRest(code, problem) {
    if (findings.some((finding) => finding.code === code)) return;
    findings.push({ code, problems: [problem] });
  }
}

/** The verdicts a commit or a build variable owns (rather than a dashboard click). */
const CODE_OWNED = new Set(['CODE', 'CODE_OR_CONFIG']);

/**
 * THE TWO STATUS LINES, FROM ONE PLACE.
 *
 * «CODE STATUS: PASS / DASHBOARD STATUS: DOMAIN NOT REGISTERED» is what the
 * audit asked for, and it has to mean the same thing in the CLI, in the health
 * panel and in the test matrix. Splitting the verdict by its OWNER is what makes
 * that safe: a code-owned cause is a FAIL on our side, and a dashboard-owned
 * cause is never allowed to be printed as a code failure — the deployment that
 * reports «the domain is not registered» while our metadata and origin match is
 * a correct deployment.
 *
 * @returns {{codeStatus:'PASS'|'FAIL', dashboardStatus:'REGISTERED'|'DOMAIN NOT REGISTERED'|'UNKNOWN'}}
 */
export function diagnosisStatuses(diagnosis, registry = null, origin = '') {
  const list = Array.isArray(registry?.list) ? registry.list : null;
  return {
    codeStatus: CODE_OWNED.has(diagnosis?.owner) ? 'FAIL' : 'PASS',
    dashboardStatus: list === null
      ? 'UNKNOWN'
      : (list.length === 0 || isOriginAllowed(origin, list) === false ? 'DOMAIN NOT REGISTERED' : 'REGISTERED')
  };
}

/** One fetch that never throws and always names why. */
async function probeJson(url, { fetchImpl, timeoutMs }) {
  const call = fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : null);
  if (!call) return { ok: false, error: 'NO_FETCH', url };
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => {
    try {
      controller?.abort();
    } catch { /* best effort */ }
  }, timeoutMs);
  try {
    const res = await call(url, { signal: controller?.signal, cache: 'no-store' });
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { ok: Boolean(res?.ok), status: res?.status ?? null, body, url };
  } catch (error) {
    return { ok: false, error: error?.name === 'AbortError' ? 'TIMEOUT' : String(error?.message || error), url };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Measure everything, decide once.
 *
 * @param {object} [options]
 * @param {string} [options.origin]       defaults to window.location.origin
 * @param {string} [options.projectId]    defaults to the in-source project id
 * @param {Function} [options.fetchImpl]  injectable fetch
 * @param {Function} [options.WebSocketImpl] injectable WebSocket
 * @param {Window}  [options.win]         injectable window (identity + attestation)
 * @param {object}  [options.windowLike]  alias for `win`, kept for readability at call sites
 * @param {boolean} [options.includeAttestation] run the SDK's own iframe (browser only)
 */
export async function collectWalletConnectDiagnosis({
  origin,
  projectId = WC_PROJECT_ID,
  fetchImpl,
  WebSocketImpl,
  win,
  windowLike,
  timeoutMs = TIMEOUT.healthProbe,
  includeAttestation,
  now
} = {}) {
  const view = win ?? windowLike ?? (typeof window !== 'undefined' ? window : null);
  const pageOrigin = String(origin ?? view?.location?.origin ?? '');
  const metadata = wcMetadata(view);
  const identity = walletIdentityFacts(view);
  const sdkConfig = sdkConfigFacts({ projectId, metadata, declaredOrigins: WC_ALLOWED_ORIGINS, view });

  const wantsAttestation = includeAttestation ?? Boolean(view?.document);
  const [config, origins, relay, enclave, attestation] = await Promise.all([
    probeJson(configProbeUrl(projectId), { fetchImpl, timeoutMs }),
    probeJson(originsProbeUrl(projectId), { fetchImpl, timeoutMs }),
    measureRelay({ projectId, urls: RELAY_URLS, timeoutMs: TIMEOUT.relayProbe, force: true, fetchImpl, WebSocketImpl }),
    probeVerifyReachability({ fetchImpl, timeoutMs }),
    wantsAttestation && view
      ? probeVerifyAttestation({ win: view, projectId, origin: pageOrigin, now })
      : Promise.resolve(null)
  ]);

  const list = Array.isArray(origins?.body?.allowedOrigins) ? origins.body.allowedOrigins : null;
  const registry = { ok: Boolean(origins?.ok), status: origins?.status ?? null, list, error: origins?.error ?? null };
  const verify = { enclave, attestation, predicted: predictVerifyVerdict({ allowedOrigins: list, declaredUrl: metadata.url, pageOrigin }) };

  const diagnosis = classifyWalletConnectDiagnosis({
    sdkConfig,
    pageOrigin: pageOrigin || identity.pageOrigin,
    declaredUrl: metadata.url,
    packaged: identity.packaged,
    registry,
    projectConfig: { ok: Boolean(config?.ok), status: config?.status ?? null },
    relay,
    verify,
    projectId
  });

  return {
    at: new Date().toISOString(),
    projectId: String(projectId || ''),
    origin: pageOrigin || identity.pageOrigin,
    metadata,
    identity,
    sdkConfig,
    /*
     * The two halves are printed separately on purpose: a dashboard problem
     * must not read as a code problem, and a code problem must not be excused
     * as «somebody forgot to click something».
     */
    ...diagnosisStatuses(diagnosis, registry, pageOrigin || identity.pageOrigin),
    projectConfig: { ok: Boolean(config?.ok), status: config?.status ?? null, error: config?.error ?? null, url: config?.url ?? null },
    registry,
    allowedOrigins: {
      configured: [...WC_ALLOWED_ORIGINS],
      list,
      readable: list !== null,
      originAllowed: list === null ? null : isOriginAllowed(pageOrigin || identity.pageOrigin, list)
    },
    originMatch: {
      windowOrigin: pageOrigin || identity.pageOrigin,
      metadataUrl: metadata.url,
      verifyUrl: metadata.verifyUrl ?? null,
      matches: (pageOrigin || identity.pageOrigin) === metadata.url,
      packaged: identity.packaged,
      rule: 'metadata.url must equal the browser origin; the packaged WebView declares the canonical public origin'
    },
    relay: {
      urls: [...RELAY_URLS],
      verdict: relay.verdict,
      open: relay.hosts.filter((h) => h?.socket?.ok).map((h) => h.url),
      hosts: relay.hosts
    },
    verify,
    diagnosis
  };
}

/**
 * The lines every reader prints — the CLI, the panel and a support thread.
 *
 * Deliberately a flat list of strings rather than an object: the requirement is
 * that a report can be pasted into a conversation and still name the failing
 * hop, and that is exactly what a flat list is good at.
 */
export function diagnosisLines(report = {}) {
  const d = report.diagnosis ?? {};
  const registry = report.registry ?? {};
  const lines = [
    `projectId              : ${report.projectId ?? '—'}`,
    `window.location.origin : ${report.originMatch?.windowOrigin || report.origin || '—'}`,
    `metadata.url           : ${report.metadata?.url ?? '—'}`,
    `metadata.verifyUrl     : ${report.metadata?.verifyUrl ?? '—'}`,
    `allowed origins (code) : ${(report.allowedOrigins?.configured ?? []).join(', ') || '—'}`,
    `origin match           : ${report.originMatch?.matches ? 'PASS (metadata.url === origin)' : report.originMatch?.packaged ? 'PASS (packaged app declares the canonical origin)' : 'FAIL'}`,
    `project config         : ${report.projectConfig?.ok ? `OK (HTTP ${report.projectConfig.status})` : `${report.projectConfig?.error || 'FAILED'}${report.projectConfig?.status ? ` (HTTP ${report.projectConfig.status})` : ''}`}`,
    `allowlist              : ${registry.readable
      ? (Array.isArray(registry.list) && registry.list.length
        ? `${registry.list.length} domain(s): ${registry.list.join(', ')}`
        : 'EMPTY — no domain registered on this project')
      : `unreadable${registry.status ? ` (HTTP ${registry.status})` : ''}${registry.error ? ` — ${registry.error}` : ''}`}`,
    `verify service         : ${report.verify?.enclave?.ok ? `reachable (HTTP ${report.verify.enclave.status})` : `unreachable${report.verify?.enclave?.error ? ` — ${report.verify.enclave.error}` : ''}`}`
      + `${report.verify?.attestation?.verdict ? ` · attestation ${report.verify.attestation.verdict}` : ' · attestation not measured (no document)'}`,
    `relay                  : ${report.relay?.verdict ?? '—'}`
      + ` (${(report.relay?.open ?? []).length}/${(report.relay?.hosts ?? []).length} socket(s) open)`,
    `final diagnosis        : ${d.code ?? 'NOT_MEASURED'}`
  ];
  if (d.problems?.length) lines.push(`problems               : ${d.problems.join(', ')}`);
  if (report.codeStatus) lines.push(`CODE STATUS            : ${report.codeStatus}`);
  if (report.dashboardStatus) lines.push(`DASHBOARD STATUS       : ${report.dashboardStatus}`);
  if (d.owner === 'DASHBOARD') {
    lines.push(`register this origin   : ${report.originMatch?.windowOrigin || report.origin || '—'}`);
  }
  return lines;
}

