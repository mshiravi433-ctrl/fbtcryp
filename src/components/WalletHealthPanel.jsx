import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { collectWalletHealth, purgeConnectionKeys, reownDashboardUrl, wcTraceSnapshot } from '../lib/wc';
import { collectSolanaHealth } from '../lib/solana/health';
import { IconCheck, IconCopy } from './Icons';

/**
 * CONNECTION HEALTH CHECK
 * ---------------------------------------------------------------------------
 * The three links a wallet report is always about are ones the UI cannot show:
 * whether the dashboard knows this project, whether its allowlist covers this
 * origin, and whether the relay's WebSocket opens on THIS network. This
 * measures all three on the device and network where the user is and prints
 * copyable JSON, so the next report arrives with the failing hop named instead
 * of described.
 *
 * RELAY MEASUREMENTS ARE ADVISORY: a browser socket error cannot distinguish
 * "blocked" from "wrong project", so the verdict is never presented as a
 * verdict on the connection itself — the panel says what it measured and what
 * to try instead.
 *
 * Two rows this panel used to carry are gone with the email/social login they
 * diagnosed (retired 2026-09-18): the reachability of the embedded-wallet frame
 * at secure.walletconnect.org, and the project usage limits AppKit reads to
 * disable its email input.
 */

/** Verdict code → the sentence that goes with it. */
const RELAY_VERDICT_KEYS = {
  OPEN: 'wallet.healthRelayVerdictOpen',
  WS_REFUSED: 'wallet.healthRelayWsRefused',
  UNREACHABLE: 'wallet.healthRelayUnreachable',
  TIMEOUT: 'wallet.healthRelayTimeout',
  NO_WEBSOCKET: 'wallet.healthRelayNoSocket',
  NO_MEASUREMENT: 'wallet.healthRelayNoMeasurement'
};

/** Short host name for the row — the scheme is noise in a support screenshot. */
const hostName = (url) => String(url ?? '').replace(/^wss:\/\//, '');

/**
 * Attestation verdict → the sentence that names the cause.
 *
 * Each of these is a different action: «not in the registry» is a dashboard
 * click, «no attestation» is a network or a five-second budget, «mismatch» is
 * our own metadata. The wallet shows one word («Unverified») for all three,
 * which is why the panel has to spell them apart.
 */
const VERIFY_VERDICT_KEYS = {
  VERIFIED: 'wallet.healthVerifyVerified',
  UNVERIFIED: 'wallet.healthVerifyUnverified',
  MISMATCH: 'wallet.healthVerifyMismatch',
  THREAT: 'wallet.healthVerifyThreat',
  EXPIRED: 'wallet.healthVerifyExpired',
  ID_MISMATCH: 'wallet.healthVerifyIdMismatch',
  NO_ATTESTATION: 'wallet.healthVerifyNoAttestation',
  NO_BROWSER: 'wallet.healthVerifyNoBrowser'
};

/**
 * The diagnostic verdict → the sentence that goes with it.
 *
 * Each of the eight codes is a different actor: ORIGIN_MISMATCH, METADATA_MISMATCH,
 * PROJECT_ID_MISMATCH and SDK_CONFIGURATION_ERROR are OURS to fix; the other four
 * need a dashboard click or a network change. Printing them as one word would
 * re-create exactly the confusion this engine was written to end.
 */
const DIAGNOSIS_KEYS = {
  OK: 'wallet.healthDiagnosisOk',
  ORIGIN_MISMATCH: 'wallet.healthDiagnosisOriginMismatch',
  DOMAIN_NOT_REGISTERED: 'wallet.healthDiagnosisDomainNotRegistered',
  VERIFY_SERVICE_UNREACHABLE: 'wallet.healthDiagnosisVerifyUnreachable',
  PROJECT_ID_MISMATCH: 'wallet.healthDiagnosisProjectId',
  METADATA_MISMATCH: 'wallet.healthDiagnosisMetadata',
  RELAY_UNREACHABLE: 'wallet.healthDiagnosisRelay',
  SDK_CONFIGURATION_ERROR: 'wallet.healthDiagnosisSdkConfig'
};

/** Registry-derived cause → the sentence that says what to click. */
const VERIFY_CAUSE_KEYS = {
  NO_DOMAIN_REGISTERED: 'wallet.healthVerifyCauseNoDomain',
  ORIGIN_NOT_REGISTERED: 'wallet.healthVerifyCauseNotRegistered'
};

/** The attestation, in the words the server used. */
function verifyDetail(attestation) {
  const att = attestation?.attested;
  const ms = `${attestation?.ms ?? 0}ms`;
  if (!att) return `${attestation?.verdict || '—'} · ${ms}`;
  return [
    `isVerified=${att.isVerified ? 'true' : 'false'}`,
    `origin=${att.origin || '—'}`,
    ...(att.isScam ? ['isScam=true'] : []),
    ms
  ].join(' · ');
}

/**
 * The hop a pairing leaves from, in measured words.
 *
 * «The wallet opens but does not connect» has four causes on four different
 * hops: a WebView that can route no scheme, a browser that ignores a bare
 * custom scheme, a package-scoped intent that never got built, or a payload
 * that arrived one encoding level off. Printing the channel turns that report
 * from a description into a diagnosis.
 */
function handoffDetail(handoff) {
  if (!handoff?.channel) return undefined;
  return `channel=${handoff.channel} · android=${handoff.android} · ios=${handoff.ios}`
    + ` · webview=${handoff.webview} · telegram=${handoff.telegram}`
    + ` · intent=${handoff.intentCapable} · bridge=${handoff.javaBridge}`;
}

/**
 * One relay host, in measured words:
 *   open        → «socket open (312ms)»
 *   HTTPS only  → «HTTPS responded but the socket test failed» (a filtered or
 *                 proxied network: this is the shape ISP blocking takes)
 *   nothing     → the raw error and how long it took
 */
function relayHostLabel(host, t) {
  const socket = host?.socket ?? {};
  const https = host?.https ?? {};
  if (socket.ok) return t('wallet.healthRelayOpen', { ms: socket.ms ?? 0 });
  if (https.ok) return t('wallet.healthRelayHttpsOnly', { ms: https.ms ?? 0 });
  return t('wallet.healthRelayNoAnswer', { error: socket.error || 'FAILED', ms: socket.ms ?? 0 });
}

export default function WalletHealthPanel({ projectId }) {
  const { t } = useTranslation();
  const [report, setReport] = useState(null);
  /* The Solana half of the same report: measured by the same button, in the same
     panel, so a support screenshot can never show one stack's health and hide
     the other's. */
  const [solana, setSolana] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const [wc, sol] = await Promise.all([
        collectWalletHealth({ projectId, trace: wcTraceSnapshot }),
        collectSolanaHealth().catch((error) => ({ error: String(error?.message || error) }))
      ]);
      setReport(wc);
      setSolana(sol);
    } catch (error) {
      setReport({ error: String(error?.message || error) });
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(JSON.stringify({ walletConnect: report, solana }, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* the JSON is on screen anyway */ }
  };

  const row = (label, probe, detail) => (
    <p className="muted" style={{ fontSize: 11.5, margin: '3px 0' }}>
      <span style={{ marginInlineEnd: 6 }}>{probe?.ok ? '✅' : '❌'}</span>
      <strong>{label}</strong>
      {' — '}
      {probe?.ok
        ? detail || 'OK'
        : `${probe?.error || 'FAILED'}${probe?.status ? ` (${probe.status})` : ''}`}
    </p>
  );

  const relays = Array.isArray(report?.relays) ? report.relays : [];
  const verdict = report?.relayVerdict;
  const verdictKey = RELAY_VERDICT_KEYS[verdict];
  const relayHasPath = verdict === 'OPEN';

  return (
    <details className="notice" style={{ marginTop: 12 }}>
      <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 12.5 }}>
        {t('wallet.healthTitle')}
      </summary>
      <p className="muted" style={{ fontSize: 11.5, margin: '8px 0' }}>{t('wallet.healthHint')}</p>
      <button className="btn btn-ghost" onClick={run} disabled={busy}>
        {busy ? t('wallet.healthRunning') : t('wallet.healthRun')}
      </button>

      {report && (
        <div style={{ marginTop: 10 }}>
          {report.error ? (
            <p className="mono" style={{ fontSize: 10.5 }}>{report.error}</p>
          ) : (
            <>
              {/* ── THE ONE VERDICT ────────────────────────────────────────
                  * Eight named causes, one of which is OK, computed by the same
                  * engine `npm run walletconnect:check` uses. The CODE / DASHBOARD
                  * split is the point: «the wallet says unverified» is not a code
                  * failure when the code is correct and the domain is not in the
                  * project's registry, and the panel must not let that be read as
                  * one.
                  */}
              {report.diagnosis && (
                <>
                  <p
                    className={report.diagnosis.code === 'OK' ? 'notice' : 'notice notice-danger'}
                    style={{ fontSize: 11.5, margin: '6px 0' }}
                  >
                    <strong>{t(DIAGNOSIS_KEYS[report.diagnosis.code] ?? 'wallet.healthDiagnosisSdkConfig')}</strong>
                    {' — '}
                    <span className="mono">{report.diagnosis.code}</span>
                    {report.diagnosis.problems?.length
                      ? ` · ${report.diagnosis.problems.join(', ')}`
                      : ''}
                  </p>
                  <p className="muted mono" style={{ fontSize: 11, margin: '2px 0' }}>
                    {`CODE STATUS: ${report.codeStatus ?? '—'} · DASHBOARD STATUS: ${report.dashboardStatus ?? 'UNKNOWN'}`}
                  </p>
                  {/*
                    * THE CLICK, NAMED.
                    *
                    * «DASHBOARD STATUS: DOMAIN NOT REGISTERED» without the row
                    * that says WHERE is a report a support thread still has to
                    * translate. The origin is printed as measured — the page's
                    * own origin, never the canonical constant — because that is
                    * the string the dashboard has to contain.
                    */}
                  {(report.diagnosis.code === 'DOMAIN_NOT_REGISTERED' || report.dashboardStatus === 'DOMAIN NOT REGISTERED') && (
                    <p className="notice" style={{ fontSize: 11.5, margin: '6px 0' }}>
                      {t('wallet.healthVerifyFix', {
                        origin: report.origin || report.identity?.pageOrigin || '—',
                        url: reownDashboardUrl(report.projectId)
                      })}
                    </p>
                  )}
                </>
              )}
              {/* Which moment of the connection trip we are in — derived from
                  the measured rows below, never from a second status field. */}
              {report.flow?.code && row(
                t('wallet.healthFlow'),
                { ok: report.flow.code !== 'FAILED' && report.flow.code !== 'REJECTED' },
                report.flow.code
              )}
              {row(
                t('wallet.healthProject'),
                {
                  ok: report.projectConfig?.ok,
                  error: report.projectConfig?.error,
                  status: report.projectConfig?.status
                },
                report?.projectId ? `id=${report.projectId}` : undefined
              )}
              {row(
                t('wallet.healthOrigins'),
                { ok: report.allowedOrigins?.ok },
                Array.isArray(report.allowedOrigins?.list)
                  ? `${report.allowedOrigins.list.length}`
                    + `${report.allowedOrigins?.originAllowed === true ? ' · ✅ origin allowed' : report.allowedOrigins?.originAllowed === false ? ' · ❌ origin NOT allowed' : ''}`
                    + ` (${report.allowedOrigins.list.join(', ')})`
                  : 'list?'
              )}
              {report.allowedOrigins?.originAllowed === false && (
                <p className="notice notice-danger" style={{ fontSize: 11.5, margin: '4px 0' }}>
                  {t('wallet.healthOriginBlocked', { origin: report.origin })}
                </p>
              )}
              {/*
                * The allowlist this app DECLARES as the right one. The row above
                * shows what the dashboard actually returned; the gap between the
                * two is the source of every "unverified domain" we have shipped.
                */}
              {Array.isArray(report.dashboardExpected?.origins) && (
                <p className="muted" style={{ fontSize: 11, margin: '2px 0 2px', marginInlineStart: 14 }}>
                  <strong>{t('wallet.healthDashboardExpected')}:</strong>{' '}
                  {report.dashboardExpected.origins.join(', ')}
                  {Array.isArray(report.dashboardExpected?.appIds) && report.dashboardExpected.appIds.length > 0
                    ? ` · App IDs: ${report.dashboardExpected.appIds.join(', ')}`
                    : ''}
                </p>
              )}
              {/*
                * The metadata the SDK ships to the wallet, including the
                * verifyUrl the wallet reads to confirm the verification file
                * lives at the URL it expects.
                */}
              {report.metadata && (
                <p className="muted" style={{ fontSize: 11, margin: '6px 0 2px' }}>
                  <strong>{t('wallet.healthMetadata')}:</strong>{' '}
                  {t('wallet.healthMetadataUrl')}={report.metadata.url || '—'}{' '}
                  · {t('wallet.healthMetadataVerifyUrl')}={report.metadata.verifyUrl || '—'}{' '}
                  · {t('wallet.healthMetadataIcon')}={report.metadata.iconUrl || '—'}
                </p>
              )}
              {/*
                * Reachability of the Verify Enclave. The Enclave is the actor
                * that turns `window.message` into a VALID/INVALID verdict; if
                * it cannot be reached from this device the report should say
                * so instead of letting a downstream label blame the dashboard.
                */}
              {row(
                t('wallet.healthVerifyEnclave'),
                report.verifyEnclave || { ok: false, error: 'NOT_MEASURED' },
                report.verifyEnclave?.url
              )}
              {/*
                * The row that answers «why does the wallet say unverified».
                *
                * The attestation probe is the SDK's own request: a hidden
                * iframe to verify.walletconnect.org/v3/attestation, and the
                * JWT the server answers with. `isVerified` inside that JWT is
                * the bit the wallet reads and we never could — so the four
                * states (Domain match / Cannot verify / Mismatch / Security
                * risk) stop being one label and become a named cause.
                */}
              {report.verify?.attestation && (
                <>
                  {row(
                    t('wallet.healthVerifyAttestation'),
                    report.verify.attestation,
                    verifyDetail(report.verify.attestation)
                  )}
                  <p className="muted" style={{ fontSize: 11, margin: '2px 0 2px', marginInlineStart: 14 }}>
                    {t(VERIFY_VERDICT_KEYS[report.verify.attestation.verdict] ?? 'wallet.healthVerifyUnknown')}
                  </p>
                </>
              )}
              {/*
                * The registry is the other half, and it is the half a human
                * fixes: an empty allowlist is a project with no domain, and no
                * amount of correct metadata makes a wallet say «verified»
                * while the registry is empty.
                */}
              {report.verify?.registry && (
                <p className="muted" style={{ fontSize: 11, margin: '2px 0 2px', marginInlineStart: 14 }}>
                  <strong>{t('wallet.healthRegistry')}:</strong>{' '}
                  {`domains=${report.verify.registry.domains ?? '?'}`}
                  {report.verify.registry.list?.length
                    ? ` (${report.verify.registry.list.join(', ')})`
                    : ` · ${t('wallet.healthRegistryEmpty')}`}
                </p>
              )}
              {report.verify?.predicted?.verdict === 'UNVERIFIED' && (
                <p className="notice notice-danger" style={{ fontSize: 11.5, margin: '6px 0' }}>
                  {t(VERIFY_CAUSE_KEYS[report.verify.predicted.reason] ?? 'wallet.healthVerifyCauseUnknown', {
                    origin: report.verify.predicted.pageOrigin || report.origin || '—'
                  })}
                </p>
              )}
              {report.verify?.predicted?.verdict === 'MISMATCH' && (
                <p className="notice notice-danger" style={{ fontSize: 11.5, margin: '6px 0' }}>
                  {t('wallet.healthVerifyCauseMismatch', {
                    declared: report.verify.predicted.declared || '—',
                    page: report.verify.predicted.pageOrigin || '—'
                  })}
                </p>
              )}
              {report.verify?.predicted?.verdict === 'UNVERIFIED' && (
                /* The one action that actually ends the report: add the origin
                   to the project's domain allowlist. Named with the URL and
                   the value to paste, because a dashboard step described in
                   prose is a step somebody re-guesses. */
                <p className="muted" style={{ fontSize: 11.5, margin: '2px 0 6px' }}>
                  {t('wallet.healthVerifyFix', {
                    url: reownDashboardUrl(report.projectId),
                    origin: report.verify.predicted.pageOrigin || report.origin || 'https://fbtswap.ir'
                  })}
                </p>
              )}
              {/*
                * The identity the wallet is handed, against the origin the
                * wallet can already see in its own prompt. A mismatch is what
                * wallets render as «domain mismatch / this dApp may be a scam»,
                * so it is stated here in both origins rather than as a label.
                */}
              {report.identity && row(
                t('wallet.healthIdentity'),
                { ok: report.identity.matchesPage === true },
                `${report.identity.declared}`
                  + ` · ${report.identity.matchesPage
                    ? `✅ ${t('wallet.healthIdentityAligned')}`
                    : `❌ ${t('wallet.healthIdentityMismatch', { page: report.identity.pageOrigin || '—' })}`}`
              )}
              {row(
                t('wallet.healthRelay'),
                report.relay,
                report.relay?.ok ? `${hostName(report.relay?.url)} · ${report.relay?.ms ?? 0}ms` : undefined
              )}
              {relays.length > 0 && (
                <p className="muted" style={{ fontSize: 11, margin: '6px 0 2px', fontWeight: 600 }}>
                  {t('wallet.healthRelayHosts')}
                </p>
              )}
              {relays.map((host) => (
                <p
                  key={host.url || 'relay'}
                  className="muted"
                  style={{ fontSize: 11, margin: '2px 0', marginInlineStart: 14 }}
                >
                  <span style={{ marginInlineEnd: 6 }}>{host?.socket?.ok ? '✅' : '❌'}</span>
                  <span className="mono">{hostName(host?.url)}</span>
                  {' — '}
                  {relayHostLabel(host, t)}
                </p>
              ))}
              {verdictKey && (
                <p
                  className={relayHasPath ? 'notice' : 'notice notice-danger'}
                  style={{ fontSize: 11.5, marginTop: 8 }}
                >
                  {t(verdictKey)}
                </p>
              )}
              {verdictKey && !relayHasPath && verdict !== 'NO_MEASUREMENT' && (
                /* The point of naming the failure is naming the way out: none
                   of these routes touches the relay. */
                <p className="muted" style={{ fontSize: 11.5, margin: '6px 0' }}>
                  {t('wallet.healthRelayFreeRoutes')}
                </p>
              )}
              {row(
                t('wallet.healthHandoff'),
                { ok: Boolean(report.handoff?.channel) },
                handoffDetail(report.handoff)
              )}
              <p className="muted" style={{ fontSize: 11.5, margin: '6px 0' }}>
                {`origin=${report.origin} · wc-sessions=${report.storage?.wcSessionKeys} · appkit-keys=${report.storage?.appkitConnectionKeys}${report.storage?.orphanKeys ? ' · ⚠️ orphan' : ''} · status=${report.storage?.connectionStatus ?? '—'} · stored=${(report.storage?.storedConnectors ?? []).join(',') || '—'}${report.storage?.legacyEmbeddedKeys ? ` · ⚠️ legacy-email-keys=${report.storage.legacyEmbeddedKeys}` : ''}`}
              </p>
              {/* Which keys survived, and which chain the SDK would boot on —
                  the two facts a count alone cannot name. */}
              {(report.storage?.appkitConnectionKeyNames?.length || report.storage?.activeCaipNetworkId) && (
                <p className="muted" style={{ fontSize: 11.5, margin: '0 0 6px' }}>
                  {`keys=${(report.storage?.appkitConnectionKeyNames ?? []).join(',') || '—'} · active=${report.storage?.activeCaipNetworkId ?? '—'}`}
                </p>
              )}
              {/* The in-memory half the storage rows cannot show: what the
                  shared AppKit controllers say, which is what the modal opens
                  on — no storage key records it. */}
              {report.shared && (
                <p className="muted" style={{ fontSize: 11.5, margin: '0 0 6px' }}>
                  {`shared: conn=${report.shared.isConnected ? 'yes' : 'no'} · connector=${report.shared.connectorId ?? '—'} · noAdapters=${report.shared.noAdapters ? 'true' : 'false'} · view=${report.shared.view ?? '—'} · modal=${report.shared.modalOpen ? 'open' : 'closed'}`}
                </p>
              )}
              {report.storage?.orphanKeys && (
                <p className="notice" style={{ fontSize: 11.5, margin: '4px 0' }}>
                  {t('wallet.healthOrphanHint')}
                  <button
                    className="btn btn-ghost"
                    style={{ marginInlineStart: 8, padding: '4px 8px', fontSize: 11 }}
                    onClick={() => {
                      try {
                        // eslint-disable-next-line no-alert
                        alert(t('wallet.healthOrphanCleared', { count: purgeConnectionKeys() }));
                        run();
                      } catch { /* storage unavailable — nothing to clear */ }
                    }}
                  >
                    {t('wallet.healthOrphanClear')}
                  </button>
                </p>
              )}
              {/* ── SOLANA ─────────────────────────────────────────────────
                  * The other wallet stack, measured by the same button. Its
                  * failure modes are completely different (an extension that is
                  * not there, an MWA registration the device cannot use, a
                  * deeplink the wallet never answered, an assetlinks.json that
                  * is not deployed), so each one is its own row with its own
                  * reason rather than one «wallet connection failed».
                  */}
              {solana && (
                <>
                  <p className="muted" style={{ fontSize: 11.5, margin: '10px 0 2px', fontWeight: 600 }}>
                    {t('wallet.healthSolanaTitle')}
                  </p>
                  {solana.error ? (
                    <p className="mono" style={{ fontSize: 10.5 }}>{solana.error}</p>
                  ) : (
                    <>
                      {row(
                        t('wallet.healthSolanaStandard'),
                        { ok: solana.truthy?.walletStandard },
                        `${solana.truthy?.walletStandard ? 'detected' : 'no Wallet Standard wallet registered'}`
                          + ` · ${t('wallet.healthSolanaMwa')}: ${solana.truthy?.mwaSupported
                            ? (solana.truthy?.mwaRegistered ? 'PASS (registered)' : 'SUPPORTED (not registered)')
                            : 'UNSUPPORTED on this platform'}`
                      )}
                      {row(
                        t('wallet.healthSolanaDeepLink'),
                        { ok: Array.isArray(solana.deepLink?.wallets) && solana.deepLink.wallets.length > 0 },
                        `${(solana.deepLink?.wallets ?? []).map((wallet) => wallet.id).join(', ')}`
                          + ` · return=${solana.deepLink?.returnState ?? 'idle'}`
                          + ` · bridge=${solana.deepLink?.returnChannels?.nativeBridge ? 'yes' : 'no'}`
                      )}
                      <p className="muted" style={{ fontSize: 11, margin: '2px 0 2px', marginInlineStart: 14 }}>
                        {`${t('wallet.healthSolanaDetection')}: `
                          + `Phantom=${solana.detection?.phantom ? 'detected' : 'not detected'} · `
                          + `Solflare=${solana.detection?.solflare ? 'detected' : 'not detected'} · `
                          + `Backpack=${solana.detection?.backpack ? 'detected' : 'not detected'}`}
                      </p>
                      {row(
                        t('wallet.healthSolanaAssetLinks'),
                        { ok: solana.assetLinks?.ok, status: solana.assetLinks?.status || undefined, error: solana.assetLinks?.ok ? undefined : solana.assetLinks?.code },
                        solana.assetLinks?.url
                      )}
                      <p className="muted" style={{ fontSize: 11, margin: '2px 0 2px', marginInlineStart: 14 }}>
                        {solana.assetLinks?.sentence ?? ''}
                        {solana.assetLinks?.problems?.length ? ` · ${solana.assetLinks.problems.join(', ')}` : ''}
                      </p>
                      <p className="muted" style={{ fontSize: 11, margin: '2px 0 2px', marginInlineStart: 14 }}>
                        {`${t('wallet.healthSolanaPending')}: ${solana.deepLink?.pending
                          ? `${solana.deepLink.pending.op} · ${solana.deepLink.pending.walletId ?? '—'}`
                          : 'none'}`
                          + ` · session=${solana.deepLink?.session ? `${solana.deepLink.session.walletId} · ${solana.deepLink.session.address}` : 'none'}`
                          + ` · transport=${solana.transport ?? 'none'}`}
                      </p>
                      {row(
                        t('wallet.healthSolanaSigning'),
                        { ok: solana.signing?.ok },
                        `${t('wallet.healthSolanaSupported')}: ${(solana.signing?.methods ?? []).join(', ') || 'none'}`
                          + (solana.signing?.unsupported?.length ? ` · ${solana.signing.unsupported.join(' · ')}` : '')
                      )}
                    </>
                  )}
                </>
              )}
              <button className="btn btn-ghost" style={{ marginTop: 6 }} onClick={copy}>
                {copied ? <IconCheck width={16} height={16} /> : <IconCopy width={16} height={16} />}
                <span style={{ marginInlineStart: 6 }}>
                  {copied ? t('common.copied') : t('wallet.healthCopy')}
                </span>
              </button>
              <pre
                className="mono"
                style={{
                  marginTop: 8,
                  maxHeight: 190,
                  overflow: 'auto',
                  fontSize: 9.5,
                  lineHeight: 1.45,
                  wordBreak: 'break-all',
                  color: 'var(--text-3)',
                  whiteSpace: 'pre-wrap'
                }}
              >
                {JSON.stringify(report, null, 2)}
              </pre>
            </>
          )}
        </div>
      )}
    </details>
  );
}
