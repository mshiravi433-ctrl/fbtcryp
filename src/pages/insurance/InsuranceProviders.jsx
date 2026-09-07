import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { insuranceApi } from '../../lib/insuranceClient.js';
import { statusLabel, settlementLabel } from './insStatus.js';

export default function InsuranceProviders() {
  const { t, i18n } = useTranslation();
  const [providers, setProviders] = useState([]);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    setBusy(true);
    insuranceApi.providers().then(setProviders).catch(() => {}).finally(() => setBusy(false));
  }, [refresh]);

  const auditLabel = (audit) => {
    const s = String(audit || '');
    if (!s || s === 'none') return t('insurance.providers.auditNone');
    if (/provider-published/i.test(s)) return t('insurance.providers.auditPublished');
    return s;
  };

  return (
    <div>
      <div className="ins-title">{t('insurance.providers.title')}</div>
      <div className="ins-sub">{t('insurance.providers.subtitle')}</div>
      <button className="ins-btn ghost small" disabled={busy} onClick={() => setRefresh((r) => r + 1)}>{busy ? t('insurance.providers.checking') : t('insurance.providers.refresh')}</button>

      {providers.length === 0 && <div className="ins-ok" style={{ marginTop: 12 }}>{t('insurance.providers.empty')}</div>}

      {providers.map((p) => {
        const disabled = p.status !== 'LIVE' || !p.enabled;
        return (
          <div className="ins-card ins-provider-card" key={p.providerId} data-disabled={disabled || undefined}>
            <div className="ins-provider-head">
              <div className="ins-provider-ico">{disabled ? '⏸️' : p.status === 'SANDBOX' ? '🧪' : '🟢'}</div>
              <div>
                <div className="ins-provider-name">{p.displayName || p.name}</div>
                <div className="ins-muted">{p.status === 'LIVE' && p.enabled ? t('insurance.providers.liveDesc') : p.status === 'SANDBOX' ? t('insurance.providers.sandboxDesc') : t('insurance.providers.disabledDesc')}</div>
              </div>
              <div style={{ display: 'flex', gap: 6, marginInlineStart: 'auto', flexDirection: 'column', alignItems: 'flex-end' }}>
                {!disabled && p.status !== 'SANDBOX' && <span className={'ins-chip ' + (p.healthStatus || 'UNKNOWN')}>{p.healthStatus ? statusLabel(t, p.healthStatus) : '—'}</span>}
                <span className={'ins-chip ' + (disabled ? 'UNAVAILABLE' : 'ACTIVE')}>{disabled ? statusLabel(t, p.status === 'NOT_CONFIGURED' ? 'NOT_CONFIGURED' : 'DISABLED') : p.status === 'SANDBOX' ? statusLabel(t, 'SANDBOX') : statusLabel(t, 'LIVE')}</span>
              </div>
            </div>
            <div className="ins-provider-meta">
              <span><b>{t('insurance.providers.chains')}</b> {p.supportedChains?.length ? p.supportedChains.join(', ') : t('insurance.providers.none')}</span>
              <span><b>{t('insurance.providers.settlement')}</b> {settlementLabel(t, p.settlementModel)}</span>
              <span><b>{t('insurance.providers.audit')}</b> {auditLabel(p.auditStatus)}</span>
              <span><b>{t('insurance.providers.riskScore')}</b> {statusLabel(t, p.riskScore || 'UNKNOWN')}</span>
              <span><b>{t('insurance.providers.commission')}</b> {p.commissionModel?.type === 'none' || !p.commissionModel?.type ? t('insurance.providers.commissionNone') : `${p.commissionModel?.note || p.commissionModel?.type || '—'}`}</span>
            </div>
            {i18n.language !== 'fa' && p.disclaimer && <div className="ins-muted ins-provider-disclaimer">{p.disclaimer}</div>}
            {i18n.language === 'fa' && <div className="ins-muted ins-provider-disclaimer">{t('insurance.providers.disclaimer')}</div>}
          </div>
        );
      })}
    </div>
  );
}
