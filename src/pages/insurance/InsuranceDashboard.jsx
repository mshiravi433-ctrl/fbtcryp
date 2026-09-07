import { useEffect, useState } from 'react';
import { Link, useNavigate, useOutletContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { insuranceApi, usd } from '../../lib/insuranceClient.js';
import { statusLabel } from './insStatus.js';

const TYPES = ['smart-contract', 'bridge', 'stablecoin', 'lending', 'lp', 'wallet', 'oracle', 'defi-protocol'];

export default function InsuranceDashboard() {
  const { t } = useTranslation();
  const { wallet, notify } = useOutletContext();
  const [data, setData] = useState(null);
  const [providers, setProviders] = useState([]);
  const [err, setErr] = useState('');
  const nav = useNavigate();

  useEffect(() => {
    setErr('');
    insuranceApi.providers().then(setProviders).catch(() => {});
    if (!wallet) { setData(null); return; }
    insuranceApi.coverage(wallet)
      .then((d) => setData(d.summary))
      .catch((e) => { setErr(e.message || String(e)); notify?.(e.message || t('insurance.dashboard.loadError'), 'error'); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet]);

  const liveProviders = providers.filter((p) => p.status === 'LIVE' && p.enabled);
  const allProviders = providers.filter((p) => p.configured);
  const risk = data?.activeCovers ? 'LOW' : '—';

  return (
    <div>
      <div className="ins-hero">
        <div className="ins-hero-badge">{t('insurance.dashboard.heroBadge')}</div>
        <h1>{t('insurance.dashboard.title')}</h1>
        <p>{t('insurance.dashboard.subtitle')}</p>
        <div className="ins-hero-actions">
          <button className="ins-btn" onClick={() => nav('/insurance/marketplace')}>{t('insurance.dashboard.explore')}</button>
          {wallet && <button className="ins-btn ghost" onClick={() => nav('/insurance/risk')}>{t('insurance.dashboard.riskCheck')}</button>}
        </div>
      </div>

      {err && <div className="ins-alert">{err}</div>}

      <div className="ins-grid">
        <div className="ins-stat"><div className="lbl">{t('insurance.dashboard.totalProtected')}</div><div className="val acc">${usd(data?.totalProtectedUsd || '0')}</div></div>
        <div className="ins-stat"><div className="lbl">{t('insurance.dashboard.activeCovers')}</div><div className="val">{data?.activeCovers ?? '—'}</div></div>
        <div className="ins-stat"><div className="lbl">{t('insurance.dashboard.totalPremium')}</div><div className="val">${usd(data?.totalPremiumUsd || '0')}</div></div>
        <div className="ins-stat"><div className="lbl">{t('insurance.dashboard.portfolioRisk')}</div><div className="val"><span className={'ins-chip ' + (risk || 'LOW')}>{risk === '—' ? t('insurance.dashboard.unknown') : statusLabel(t, risk)}</span></div></div>
      </div>

      {!wallet && <div className="ins-ok">{t('insurance.dashboard.walletEmpty')}</div>}

      {data?.active?.length > 0 && (
        <>
          <div className="ins-sub ins-sec-title">{t('insurance.dashboard.activeTitle')}</div>
          {data.active.map((c) => (
            <Link key={c.coverageId} to={`/insurance/coverage/${c.coverageId}`} style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="ins-card ins-cover-row">
                <div className="ins-cover-ico">🛡️</div>
                <div className="ins-cover-main">
                  <div className="ins-cover-name"><b style={{ textTransform: 'capitalize' }}>{t(`insurance.types.${c.protectionType}`, { defaultValue: c.protectionType })}</b> · {c.providerName}</div>
                  <div className="ins-muted">{t('insurance.dashboard.protected')} <b>${usd(c.coverageAmountMicro)}</b> · {t('insurance.dashboard.expires')} {c.expiresAt ? new Date(c.expiresAt).toLocaleDateString() : '—'}</div>
                </div>
                <span className={'ins-chip ' + c.status}>{statusLabel(t, c.status)}</span>
              </div>
            </Link>
          ))}
        </>
      )}

      <div className="ins-sub ins-sec-title">{t('insurance.dashboard.availableTitle')}</div>
      <div className="ins-grid ins-cat-grid">
        {TYPES.map((typeId) => (
          <button key={typeId} className="ins-cat"
            onClick={() => nav(`/insurance/marketplace?type=${typeId}`)}>
            <span className="ins-cat-ico">{typeId === 'wallet' ? '👛' : typeId === 'bridge' ? '🌉' : typeId === 'stablecoin' ? '💲' : typeId === 'lending' ? '🏦' : typeId === 'lp' ? '💧' : typeId === 'oracle' ? '📡' : typeId === 'defi-protocol' ? '🧩' : '⚙️'}</span>
            <b>{t(`insurance.types.${typeId}`)}</b>
            <span className="ins-muted">{t('insurance.dashboard.cardProtect', { type: t(`insurance.types.${typeId}`) })}</span>
          </button>
        ))}
      </div>

      <div className="ins-card">
        <div className="ins-sub" style={{ marginTop: 0 }}>{t('insurance.dashboard.providersConnected')}</div>
        {allProviders.length === 0 && <div className="ins-muted">{t('insurance.dashboard.providersEmpty')}</div>}
        {allProviders.map((p) => (
          <div key={p.providerId} className="ins-row">
            <span>{p.displayName || p.name} {p.status === 'SANDBOX' && <span className="ins-tag">{statusLabel(t, 'SANDBOX')}</span>}</span>
            <span className={'ins-chip ' + (p.healthStatus || 'UNKNOWN')}>{p.healthStatus ? statusLabel(t, p.healthStatus) : '—'}</span>
          </div>
        ))}
        {liveProviders.length > 0 && <div className="ins-muted" style={{ marginTop: 8 }}>{t('insurance.dashboard.providersNote')}</div>}
      </div>
    </div>
  );
}
