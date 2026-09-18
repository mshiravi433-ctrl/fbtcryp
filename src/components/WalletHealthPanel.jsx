import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { collectWalletHealth, purgeConnectionKeys, wcTraceSnapshot } from '../lib/wc';
import { IconCheck, IconCopy } from './Icons';

/**
 * CONNECTION HEALTH CHECK
 * ---------------------------------------------------------------------------
 * The four links a wallet report is always about are ones the UI cannot show:
 * whether the dashboard knows this project, whether its allowlist covers this
 * origin, whether the relay's WebSocket opens on THIS network, and whether the
 * embedded-wallet frame can be reached. This measures all four on the device
 * and network where the user is and prints copyable JSON, so the next report
 * arrives with the failing hop named instead of described.
 *
 * RELAY MEASUREMENTS ARE ADVISORY: a browser socket error cannot distinguish
 * "blocked" from "wrong project", so the verdict is never presented as a
 * verdict on the connection itself — the panel says what it measured and what
 * to try instead.
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

/** Where the project number came from → the sentence that goes with it. */
const PROJECT_SOURCE_KEYS = {
  dashboard: 'wallet.healthProjectSourceDashboard',
  local: 'wallet.healthProjectSourceLocal',
  default: 'wallet.healthProjectSourceDefault',
  off: 'wallet.healthProjectSourceOff'
};

/** Short host name for the row — the scheme is noise in a support screenshot. */
const hostName = (url) => String(url ?? '').replace(/^wss:\/\//, '');

/**
 * The project row's numbers, printed as measured.
 *
 * The socials LIST is printed too, because «socials=0» and «socials=7» are the
 * difference between a dashboard setting and a bug hunt.
 */
function projectDetail(features) {
  if (!features) return 'OK';
  const socials = Array.isArray(features.socials) ? features.socials : [];
  return `email=${String(features.email)} · socials=${socials.length}`
    + `${socials.length ? ` (${socials.join(', ')})` : ''}`;
}

/**
 * …and the sentence those numbers are useless without.
 *
 * `email=false socials=0` is what sent a support thread hunting a dashboard
 * switch nobody had flipped: when the answer carries `config: null`, AppKit
 * never reads the dashboard at all and uses the `features` WE hand
 * `createAppKit()`. So the row names the source, and names whatever AppKit's
 * own platform filter took away — a provider hidden on this device is not a
 * provider the dashboard disabled.
 */
function projectSourceNote(features, t) {
  const key = PROJECT_SOURCE_KEYS[features?.source];
  const parts = key ? [t(key)] : [];
  const requested = Array.isArray(features?.requested?.socials) ? features.requested.socials : [];
  const shown = Array.isArray(features?.socials) ? features.socials : [];
  const hidden = requested.filter((name) => !shown.includes(name));
  if (hidden.length > 0) {
    parts.push(t('wallet.healthProjectPlatformFiltered', { removed: hidden.join(', ') }));
  }
  return parts.join(' · ');
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
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      setReport(await collectWalletHealth({ projectId, trace: wcTraceSnapshot }));
    } catch (error) {
      setReport({ error: String(error?.message || error) });
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(JSON.stringify(report, null, 2));
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

  const features = report?.projectConfig?.features;
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
              {row(
                t('wallet.healthProject'),
                {
                  ok: report.projectConfig?.ok,
                  error: report.projectConfig?.error,
                  status: report.projectConfig?.status
                },
                projectDetail(features)
              )}
              {report.projectConfig?.ok && features && (
                <p
                  className="muted"
                  style={{ fontSize: 11, margin: '2px 0', marginInlineStart: 14 }}
                >
                  {projectSourceNote(features, t)}
                </p>
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
              {row(t('wallet.healthSecureSite'), report.secureSite)}
              {report.usage?.ok != null && row(
                t('wallet.healthUsage'),
                { ok: Boolean(report.usage.ok) },
                `tier=${report.usage.tier ?? '?'} · mau>${report.usage.isAboveMauLimit ? 'YES' : 'no'} · rpc>${report.usage.isAboveRpcLimit ? 'YES' : 'no'}`
              )}
              {report.usage?.emailDisabledByUsageLimit && (
                <p className="notice notice-danger" style={{ fontSize: 11.5, margin: '4px 0' }}>
                  {t('wallet.healthUsageBlocked')}
                </p>
              )}
              {row(
                t('wallet.healthHandoff'),
                { ok: Boolean(report.handoff?.channel) },
                handoffDetail(report.handoff)
              )}
              <p className="muted" style={{ fontSize: 11.5, margin: '6px 0' }}>
                {`origin=${report.origin} · sdk-login=${report.storage?.sdkLoginMarker} · fbt-marker=${report.storage?.ourMarker}${report.storage?.emailMarkerStale ? ' (stale)' : ''} · wc-sessions=${report.storage?.wcSessionKeys} · appkit-keys=${report.storage?.appkitConnectionKeys}${report.storage?.orphanKeys ? ' · ⚠️ orphan' : ''} · status=${report.storage?.connectionStatus ?? '—'} · stored=${(report.storage?.storedConnectors ?? []).join(',') || '—'}`}
              </p>
              {/* Which keys survived, and which chain the email surface would
                  boot on — the two facts the previous report could not name. */}
              {(report.storage?.appkitConnectionKeyNames?.length || report.storage?.activeCaipNetworkId) && (
                <p className="muted" style={{ fontSize: 11.5, margin: '0 0 6px' }}>
                  {`keys=${(report.storage?.appkitConnectionKeyNames ?? []).join(',') || '—'} · active=${report.storage?.activeCaipNetworkId ?? '—'} · frame-chain=${report.storage?.frameChainSupported == null ? '—' : (report.storage.frameChainSupported ? 'ok' : 'UNSUPPORTED')} · frame-last-chain=${report.storage?.frameLastUsedChain ?? '—'}`}
                </p>
              )}
              {/* The in-memory half the storage rows cannot show: which of
                  these facts is why the email input renders disabled. */}
              {report.shared && (
                <p className="muted" style={{ fontSize: 11.5, margin: '0 0 6px' }}>
                  {`shared: conn=${report.shared.isConnected ? 'yes' : 'no'} · connector=${report.shared.connectorId ?? '—'} · authConn=${report.shared.authConnection ? 'yes' : 'no'}${report.shared.authConnection ? `(acct=${report.shared.authAccounts ?? '?'}${(report.shared.authAccounts ?? 0) === 0 ? ' GHOST' : ''})` : ''} · noAdapters=${report.shared.noAdapters ? 'true' : 'false'} · view=${report.shared.view ?? '—'} · modal=${report.shared.modalOpen ? 'open' : 'closed'}`}
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
