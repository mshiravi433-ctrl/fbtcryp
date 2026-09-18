import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { collectWalletHealth, purgeConnectionKeys, wcTraceSnapshot } from '../lib/wc';
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
