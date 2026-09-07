import { useEffect, useState } from 'react';
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { insuranceApi, usd } from '../../lib/insuranceClient.js';
import { statusLabel, typeLabel, settlementLabel } from './insStatus.js';

export default function InsuranceCoverageList() {
  const { t } = useTranslation();
  const { wallet } = useOutletContext();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const nav = useNavigate();
  useEffect(() => {
    if (!wallet) return;
    insuranceApi.coverage(wallet).then(setData).catch((e) => setErr(e.message || String(e)));
  }, [wallet]);

  if (!wallet) return (
    <div className="ins-state-card ins-state-card--sm">
      <div className="ins-state-ico">👛</div>
      <h2>{t('insurance.shell.walletRequiredTitle')}</h2>
      <p>{t('insurance.shell.walletRequiredBody')}</p>
      <div className="ins-state-actions"><Link className="ins-btn" to="/wallet">{t('insurance.shell.goWallet')}</Link></div>
    </div>
  );
  if (err) return <div className="ins-alert">{err}</div>;

  const active = (data?.coverages || []).filter((c) => c.status === 'ACTIVE');
  const total = data?.summary?.totalProtectedUsd || '0';

  return (
    <div>
      <div className="ins-title">{t('insurance.coverage.title')}</div>
      <div className="ins-sub">{t('insurance.coverage.subtitle', { count: active.length, total: `$${usd(total)}` })}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <button className="ins-btn ghost small" onClick={() => nav('/insurance/risk')}>{t('insurance.coverage.protectGap')}</button>
        <Link className="ins-btn ghost small" to="/insurance/marketplace">{t('insurance.coverage.goMarket')}</Link>
      </div>

      {(data?.coverages || []).length === 0 && (
        <div className="ins-ok">{t('insurance.coverage.empty')}</div>
      )}

      {(data?.coverages || []).map((c) => (
        <Link key={c.coverageId} to={`/insurance/coverage/${c.coverageId}`} style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="ins-card ins-cover-row">
            <div className="ins-cover-ico">🛡️</div>
            <div className="ins-cover-main">
              <div className="ins-cover-name"><b>{typeLabel(t, c.protectionType)}</b> · {c.providerName}</div>
              <div className="ins-muted">{t('insurance.coverage.protected')} <b>${usd(c.coverageAmountMicro)}</b> · {t('insurance.coverage.premium')} ${c.premiumUsd}</div>
              <div className="ins-muted">{t('insurance.coverage.expires')} {c.expiresAt ? new Date(c.expiresAt).toLocaleDateString() : '—'}</div>
            </div>
            <span className={'ins-chip ' + c.status}>{statusLabel(t, c.status)}</span>
          </div>
        </Link>
      ))}
    </div>
  );
}

export function InsuranceCoverageDetail() {
  const { t } = useTranslation();
  const { id } = useParams();
  const { wallet, notify, confirm } = useOutletContext();
  const [cov, setCov] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const nav = useNavigate();

  const load = () => {
    if (!id) return;
    insuranceApi.coverageById(id, wallet).then((r) => setCov(r.coverage)).catch((e) => setErr(e.message || String(e)));
  };
  useEffect(load, [id, wallet]);

  async function renew() {
    setBusy('renew');
    try { await insuranceApi.renew({ coverageId: id, walletAddress: wallet, durationDays: 30 }); load(); notify(t('insurance.coverage.renewed'), 'success'); }
    catch (e) { notify(e.message || t('insurance.coverage.renewFailed'), 'error'); }
    setBusy('');
  }
  async function cancel() {
    const ok2 = await confirm({ title: t('insurance.coverage.cancelTitle'), message: t('insurance.coverage.cancelBody'), confirmLabel: t('insurance.coverage.cancelConfirm'), danger: true });
    if (!ok2) return;
    setBusy('cancel');
    try { await insuranceApi.cancel({ coverageId: id, walletAddress: wallet }); load(); notify(t('insurance.coverage.cancelled'), 'success'); }
    catch (e) { notify(e.message || t('insurance.coverage.cancelFailed'), 'error'); }
    setBusy('');
  }

  if (err) return <div className="ins-alert">{err}</div>;
  if (!cov) return <div className="ins-muted">{t('insurance.quote.loading')}</div>;

  return (
    <div>
      <button className="ins-btn ghost small" onClick={() => nav('/insurance/coverage')}>← {t('insurance.coverage.backToList')}</button>
      <div className="ins-title">{typeLabel(t, cov.protectionType)} — {t('insurance.coverage.titleSingle')}</div>
      <div className="ins-card">
        <div className="ins-row"><span>{t('insurance.coverage.statusRow')}</span><span className={'ins-chip ' + cov.status}>{statusLabel(t, cov.status)}</span></div>
        <div className="ins-row"><span>{t('insurance.coverage.providerRow')}</span><span>{cov.providerName}</span></div>
        <div className="ins-row"><span>{t('insurance.coverage.amountRow')}</span><b>${usd(cov.coverageAmountMicro)}</b></div>
        <div className="ins-row"><span>{t('insurance.coverage.premiumPaid')}</span><span>${cov.premiumUsd}</span></div>
        <div className="ins-row"><span>{t('insurance.coverage.totalCost')}</span><span>${cov.totalCostUsd}</span></div>
        <div className="ins-row"><span>{t('insurance.coverage.duration')}</span><span>{t('insurance.quote.days', { count: cov.durationDays })}</span></div>
        <div className="ins-row"><span>{t('insurance.coverage.started')}</span><span>{cov.startedAt ? new Date(cov.startedAt).toLocaleDateString() : '—'}</span></div>
        <div className="ins-row"><span>{t('insurance.coverage.expires')}</span><span>{cov.expiresAt ? new Date(cov.expiresAt).toLocaleDateString() : '—'}</span></div>
        <div className="ins-row"><span>{t('insurance.coverage.chainRow')}</span><span>{cov.chainId}</span></div>
        <div className="ins-row"><span>{t('insurance.coverage.termsHash')}</span><code style={{ fontSize: 11 }}>{cov.termsHash?.slice(0, 24)}…</code></div>
        <div className="ins-row"><span>{t('insurance.coverage.settlement')}</span><span>{settlementLabel(t, cov.settlementModel)}</span></div>
      </div>

      {cov.status === 'ACTIVE' && (
        <div className="ins-card">
          <div className="ins-sub">{t('insurance.coverage.manage')}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="ins-btn small" disabled={!!busy} onClick={renew}>{t('insurance.coverage.renew')}</button>
            <button className="ins-btn ghost small" onClick={() => nav('/insurance/claims', { state: { coverageId: id } })}>{t('insurance.coverage.fileClaim')}</button>
            <button className="ins-btn warn small" disabled={!!busy} onClick={cancel}>{t('insurance.coverage.cancelCoverage')}</button>
          </div>
        </div>
      )}

      <div className="ins-excl"><b>{t('insurance.coverage.exclusionsTitle')}:</b><ul style={{ margin: '6px 0 0 18px' }}>{(cov.exclusions || []).map((x, i) => <li key={i}>{typeof x === 'string' ? x : x?.source || x?.url || JSON.stringify(x)}</li>)}</ul></div>
    </div>
  );
}
