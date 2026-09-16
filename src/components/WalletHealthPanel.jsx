import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconCheck, IconCopy } from './Icons';

/**
 * WALLET HEALTH PANEL — the evidence, on the device where it failed.
 *
 * This lives inside the connect sheet (choose view), not behind a developer
 * route, because the person who needs it is the person holding the phone on
 * the network that is blocking something: they can run it in one tap, copy
 * the JSON, and the failing hop stops being a matter of opinion. See
 * lib/walletHealth.js for what each probe measures and why those exact
 * endpoints.
 *
 * The collector is imported LAZILY on first run: this sheet is in the
 * first-paint graph, and a report most sessions never ask for must not drag
 * anything into it.
 */
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
                ? `email=${String(features.email)} socials=${(features.socials || []).length}`
                : 'OK')}
              {row(t('wallet.healthOrigins'), { ok: report.allowedOrigins?.ok }, (
                Array.isArray(report.allowedOrigins?.list)
                  ? `${report.allowedOrigins.list.length}`
                  : 'list?'
              ))}
              {row(t('wallet.healthRelay'), report.relay)}
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
