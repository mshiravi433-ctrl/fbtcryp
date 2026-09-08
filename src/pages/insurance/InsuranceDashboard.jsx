import { useEffect, useState } from 'react';
import { Link, useNavigate, useOutletContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { insuranceApi, usd } from '../../lib/insuranceClient.js';
import { statusLabel } from './insStatus.js';
import {
  InsIconDashboard, InsIconShield, InsIconProviders, InsIconChevronEnd, InsIconInfo, InsIconAlert, InsIconCoverage,
  INS_TYPE_ICONS, INS_TYPE_TONES
} from './InsuranceIcons.jsx';

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
    <div className="ins-tone-cyan">
      <div className="ins-hero">
        <div className="ins-ico lg"><InsIconDashboard /></div>
        <div className="ins-hero-body">
          <span className="ins-hero-badge"><InsIconShield /> {t('insurance.dashboard.heroBadge')}</span>
          <h1>{t('insurance.dashboard.title')}</h1>
          <p>{t('insurance.dashboard.subtitle')}</p>
          <div className="ins-hero-actions">
            <button className="ins-btn" onClick={() => nav('/insurance/marketplace')}>{t('insurance.dashboard.explore')} <InsIconChevronEnd /></button>
            {wallet && <button className="ins-btn ghost" onClick={() => nav('/insurance/risk')}>{t('insurance.dashboard.riskCheck')}</button>}
          </div>
        </div>
      </div>

      {err && <div className="ins-alert"><InsIconAlert /><span>{err}</span></div>}

      <div className="ins-grid">
        <div className="ins-stat"><div className="lbl">{t('insurance.dashboard.totalProtected')}</div><div className="val acc">${usd(data?.totalProtectedUsd || '0')}</div></div>
        <div className="ins-stat"><div className="lbl">{t('insurance.dashboard.activeCovers')}</div><div className="val">{data?.activeCovers ?? '—'}</div></div>
        <div className="ins-stat"><div className="lbl">{t('insurance.dashboard.totalPremium')}</div><div className="val">${usd(data?.totalPremiumUsd || '0')}</div></div>
        <div className="ins-stat"><div className="lbl">{t('insurance.dashboard.portfolioRisk')}</div><div className="val"><span className={'ins-chip ' + (risk === '—' ? 'UNKNOWN' : risk)}>{risk === '—' ? t('insurance.dashboard.unknown') : statusLabel(t, risk)}</span></div></div>
      </div>

      {!wallet && <div className="ins-ok neutral"><InsIconInfo /><span>{t('insurance.dashboard.walletEmpty')}</span></div>}

      {data?.active?.length > 0 && (
        <>
          <div className="ins-sec-title ins-tone-mint">
            <span className="ins-ico"><InsIconCoverage /></span>
            {t('insurance.dashboard.activeTitle')}
            <span className="ins-sec-count">{data.active.length}</span>
          </div>
          {data.active.map((c) => {
            const Glyph = INS_TYPE_ICONS[c.protectionType] || InsIconShield;
            return (
              <Link key={c.coverageId} to={`/insurance/coverage/${c.coverageId}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <div className={`ins-card ins-cover-row ins-tone-${INS_TYPE_TONES[c.protectionType] || 'cyan'}`}>
                  <div className="ins-ico"><Glyph /></div>
                  <div className="ins-cover-main">
                    <div className="ins-cover-name"><b>{t(`insurance.types.${c.protectionType}`, { defaultValue: c.protectionType })}</b> · {c.providerName}</div>
                    <div className="ins-muted">{t('insurance.dashboard.protected')} <b>${usd(c.coverageAmountMicro)}</b> · {t('insurance.dashboard.expires')} {c.expiresAt ? new Date(c.expiresAt).toLocaleDateString() : '—'}</div>
                  </div>
                  <span className={'ins-chip ' + c.status}>{statusLabel(t, c.status)}</span>
                  <span className="ins-next"><InsIconChevronEnd /></span>
                </div>
              </Link>
            );
          })}
        </>
      )}

      <div className="ins-sec-title">
        <span className="ins-ico"><InsIconShield /></span>
        {t('insurance.dashboard.availableTitle')}
      </div>
      <div className="ins-cat-grid">
        {TYPES.map((typeId) => {
          const Glyph = INS_TYPE_ICONS[typeId] || InsIconShield;
          return (
            <button key={typeId} type="button" className={`ins-cat ins-tone-${INS_TYPE_TONES[typeId] || 'cyan'}`}
              onClick={() => nav(`/insurance/marketplace?type=${typeId}`)}>
              <span className="ins-ico"><Glyph /></span>
              <span className="ins-cat-body">
                <b>{t(`insurance.types.${typeId}`)}</b>
                <span className="ins-muted">{t('insurance.dashboard.cardProtect', { type: t(`insurance.types.${typeId}`) })}</span>
              </span>
              <span className="ins-next"><InsIconChevronEnd /></span>
            </button>
          );
        })}
      </div>

      <div className="ins-card ins-tone-violet">
        <div className="ins-card-title"><span className="ins-ico"><InsIconProviders /></span>{t('insurance.dashboard.providersConnected')}</div>
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
