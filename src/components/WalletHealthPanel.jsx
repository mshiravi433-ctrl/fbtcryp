import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconCheck, IconCopy } from './Icons';

/** Relay measurements are advisory; browser socket errors do not identify their cause. */

/** Verdict code (from relayVerdict(), or OPEN) -> the sentence that goes with it. */
const RELAY_VERDICT_KEYS = {
  OPEN: 'wallet.healthRelayVerdictOpen',
  WS_REFUSED: 'wallet.healthRelayWsRefused',
  UNREACHABLE: 'wallet.healthRelayUnreachable',
  TIMEOUT: 'wallet.healthRelayTimeout',
  NO_WEBSOCKET: 'wallet.healthRelayNoSocket',
  NO_MEASUREMENT: 'wallet.healthRelayNoMeasurement'
};

/** Short host name for the row (the scheme is noise in a support screenshot). */
const hostName = (url) => String(url || '').replace(/^wss:\/\//, '');

/**
 * One relay hostname, in measured words:
 *   open            -> «سوکت باز شد (۳۱۲ میلیثانیه)»
 *   HTTPS only      -> «HTTPS رسید ولی سوکت باز نشد…» (host alive, upgrade refused)
 *   nothing at all  -> the raw error string and how long it took
 */
function relayHostLabel(host, t) {
  const socket = host?.socket || {};
  const https = host?.https || {};
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
      const { collectWalletHealth } = await import('../lib/walletHealth.js');
      const { wcTraceSnapshot } = await import('../lib/wcTrace.js');
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
        ? (detail || 'OK')
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
      <p className="muted" style={{ fontSize: 11.5, margin: '8px 0' }}>
        {t('wallet.healthHint')}
      </p>
      <button className="btn btn-ghost" onClick={run} disabled={busy}>
        {busy ? t('wallet.healthRunning') : t('wallet.healthRun')}
      </button>

      {report && (
        <div style={{ marginTop: 10 }}>
          {report.error ? (
            <p className="mono" style={{ fontSize: 10.5 }}>{report.error}</p>
          ) : (
            <>
              {row(t('wallet.healthProject'), {
                ok: report.projectConfig?.ok,
                error: report.projectConfig?.error,
                status: report.projectConfig?.status
              }, features
                /* The dashboard's own answer, printed as it is — including the
                   socials LIST, because «socials=0» and «socials=7» are the
                   difference between a dashboard setting and a bug hunt. */
                ? `email=${String(features.email)} socials=${(features.socials || []).length}`
                  + `${features.socials?.length ? ` (${features.socials.join(', ')})` : ''}`
                : 'OK')}
              {row(t('wallet.healthOrigins'), { ok: report.allowedOrigins?.ok }, (
                Array.isArray(report.allowedOrigins?.list)
                  ? `${report.allowedOrigins.list.length}`
                  : 'list?'
              ))}
              {row(t('wallet.healthRelay'), report.relay, report.relay?.ok
                ? `${hostName(report.relay?.url)} · ${report.relay?.ms ?? 0}ms`
                : undefined)}
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
                /* The whole point of naming the failure: what to do instead.
                   None of these three routes touches the relay. */
                <p className="muted" style={{ fontSize: 11.5, margin: '6px 0' }}>
                  {t('wallet.healthRelayFreeRoutes')}
                </p>
              )}
              {row(t('wallet.healthSecureSite'), report.secureSite)}
              <p className="muted" style={{ fontSize: 11.5, margin: '6px 0' }}>
                {`origin=${report.origin} · sdk-login=${report.storage?.sdkLoginMarker} · fbt-marker=${report.storage?.ourMarker} · wc-sessions=${report.storage?.wcSessionKeys}`}
              </p>
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
