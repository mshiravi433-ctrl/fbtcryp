import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { insuranceApi } from '../../lib/insuranceClient.js';
import { statusLabel, settlementLabel } from './insStatus.js';
import AssetIcon from '../../components/AssetIcon.jsx';
import { InsIconProviders, InsIconRetry, InsIconInfo, InsIconLive, InsIconPause, InsIconFlask, InsIconLock } from './InsuranceIcons.jsx';

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
    <div className="ins-tone-violet">
      <div className="ins-hero">
        <div className="ins-ico lg"><InsIconProviders /></div>
        <div className="ins-hero-body">
          <h1>{t('insurance.providers.title')}</h1>
          <p>{t('insurance.providers.subtitle')}</p>
          <div className="ins-hero-actions">
            <button className="ins-btn ghost small" disabled={busy} onClick={() => setRefresh((r) => r + 1)}><InsIconRetry /> {busy ? t('insurance.providers.checking') : t('insurance.providers.refresh')}</button>
          </div>
        </div>
      </div>

      {providers.length === 0 && <div className="ins-ok neutral"><InsIconInfo /><span>{t('insurance.providers.empty')}</span></div>}

      {providers.map((p) => {
        const disabled = p.status !== 'LIVE' || !p.enabled;
        const sandbox = p.status === 'SANDBOX';
        const tone = disabled ? (sandbox ? 'violet' : 'neutral') : 'mint';
        const StateGlyph = disabled ? (sandbox ? InsIconFlask : InsIconPause) : InsIconLive;
        return (
          <div className={`ins-card ins-provider-card ins-tone-${tone}`} key={p.providerId} data-disabled={disabled || undefined}>
            <div className="ins-provider-head">
              <div className="ins-ico"><StateGlyph /></div>
              <div className="ins-provider-text">
                <div className="ins-provider-name">{p.displayName || p.name}</div>
                <div className="ins-muted">{p.status === 'LIVE' && p.enabled ? t('insurance.providers.liveDesc') : sandbox ? t('insurance.providers.sandboxDesc') : t('insurance.providers.disabledDesc')}</div>
              </div>
              <div className="ins-provider-chips">
                {!disabled && !sandbox && <span className={'ins-chip ' + (p.healthStatus || 'UNKNOWN')}>{p.healthStatus ? statusLabel(t, p.healthStatus) : '—'}</span>}
                <span className={'ins-chip ' + (disabled ? (sandbox ? 'SANDBOX' : 'UNAVAILABLE') : 'LIVE')}>{disabled ? statusLabel(t, sandbox ? 'SANDBOX' : p.status === 'NOT_CONFIGURED' ? 'NOT_CONFIGURED' : 'DISABLED') : statusLabel(t, 'LIVE')}</span>
              </div>
            </div>
            <div className="ins-kv-grid">
              <div className="ins-kv">
                <span className="k">{t('insurance.providers.chains')}</span>
                <span className="v">
                  {p.supportedChains?.length ? p.supportedChains.map((c) => (
                    <span key={c} className="ins-assets"><AssetIcon chain={c} size={18} radius={999} /> {c}</span>
                  )) : t('insurance.providers.none')}
                </span>
              </div>
              <div className="ins-kv"><span className="k">{t('insurance.providers.settlement')}</span><span className="v">{settlementLabel(t, p.settlementModel)}</span></div>
              <div className="ins-kv"><span className="k">{t('insurance.providers.audit')}</span><span className="v">{auditLabel(p.auditStatus)}</span></div>
              <div className="ins-kv"><span className="k">{t('insurance.providers.riskScore')}</span><span className="v"><span className={'ins-chip ' + (p.riskScore || 'UNKNOWN')}>{statusLabel(t, p.riskScore || 'UNKNOWN')}</span></span></div>
              <div className="ins-kv"><span className="k">{t('insurance.providers.commission')}</span><span className="v">{p.commissionModel?.type === 'none' || !p.commissionModel?.type ? t('insurance.providers.commissionNone') : `${p.commissionModel?.note || p.commissionModel?.type || '—'}`}</span></div>
            </div>
            {i18n.language !== 'fa' && p.disclaimer && <div className="ins-muted ins-provider-disclaimer"><InsIconLock style={{ width: 14, height: 14, verticalAlign: '-2px', marginInlineEnd: 4 }} />{p.disclaimer}</div>}
            {i18n.language === 'fa' && <div className="ins-muted ins-provider-disclaimer"><InsIconLock style={{ width: 14, height: 14, verticalAlign: '-2px', marginInlineEnd: 4 }} />{t('insurance.providers.disclaimer')}</div>}
          </div>
        );
      })}
    </div>
  );
}
