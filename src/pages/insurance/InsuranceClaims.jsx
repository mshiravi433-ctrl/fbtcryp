import { useEffect, useState } from 'react';
import { Link, useLocation, useOutletContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { insuranceApi, usd } from '../../lib/insuranceClient.js';
import { statusLabel, typeLabel } from './insStatus.js';

const STATUS_CHIP = {
  DRAFT: 'PENDING', SUBMITTED: 'PENDING', UNDER_REVIEW: 'PENDING', ADDITIONAL_INFORMATION_REQUIRED: 'PENDING',
  APPROVED: 'ACTIVE', PARTIALLY_APPROVED: 'ACTIVE', PAID: 'ACTIVE', REJECTED: 'UNAVAILABLE',
  CANCELLED: 'EXPIRED', DISPUTED: 'HIGH'
};

const INCIDENTS = ['smart-contract-exploit', 'bridge-incident', 'depeg-event', 'oracle-failure', 'protocol-exploit', 'wallet-custody-loss'];

export default function InsuranceClaims() {
  const { t } = useTranslation();
  const { wallet, notify } = useOutletContext();
  const loc = useLocation();
  const initialCoverage = loc.state?.coverageId || '';
  const [claims, setClaims] = useState([]);
  const [coverageId, setCoverageId] = useState(initialCoverage);
  const [incidentType, setIncidentType] = useState('smart-contract-exploit');
  const [amount, setAmount] = useState('');
  const [desc, setDesc] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (wallet) insuranceApi.claims(wallet).then((d) => setClaims(d.claims || [])).catch(() => {}); }, [wallet]);

  async function create() {
    setErr(''); setMsg(''); setBusy(true);
    try {
      const body = {
        coverageId, walletAddress: wallet, incidentType,
        description: desc, evidenceHash: '0x' + 'ab'.repeat(32)
      };
      if (amount) body.affectedAmountMicro = amount;
      const r = await insuranceApi.createClaim(body);
      setMsg(t('insurance.claims.created', { number: r.data.claim.claimNumber, status: statusLabel(t, r.data.claim.status) }));
      notify(t('insurance.claims.createdToast', { number: r.data.claim.claimNumber }), 'success');
      const d = await insuranceApi.claims(wallet); setClaims(d.claims || []);
    } catch (e) { setErr(e.message || String(e)); notify(e.message || t('insurance.claims.failed'), 'error'); }
    setBusy(false);
  }

  async function submit(claimId) {
    try { await insuranceApi.submitClaim(claimId, { walletAddress: wallet }); const d = await insuranceApi.claims(wallet); setClaims(d.claims || []); notify(t('insurance.claims.submitted'), 'success'); } catch (e) { notify(e.message || t('insurance.claims.submitFailed'), 'error'); }
  }

  if (!wallet) {
    return (
      <div>
        <div className="ins-title">{t('insurance.claims.title')}</div>
        <div className="ins-state-card ins-state-card--sm">
          <div className="ins-state-ico">👛</div>
          <h2>{t('insurance.shell.walletRequiredTitle')}</h2>
          <p>{t('insurance.shell.walletRequiredBody')}</p>
          <div className="ins-state-actions"><Link className="ins-btn" to="/wallet">{t('insurance.shell.goWallet')}</Link></div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="ins-title">{t('insurance.claims.title')}</div>
      <div className="ins-sub">{t('insurance.claims.subtitle')}</div>

      <div className="ins-card">
        <div className="ins-sub" style={{ marginTop: 0 }}>{t('insurance.claims.fileTitle')}</div>
        <div className="ins-sub">{t('insurance.claims.coverageId')}</div>
        <input className="ins-input" value={coverageId} onChange={(e) => setCoverageId(e.target.value)} placeholder="cov-…" />
        <div className="ins-sub">{t('insurance.claims.incidentType')}</div>
        <select className="ins-select" value={incidentType} onChange={(e) => setIncidentType(e.target.value)}>
          {INCIDENTS.map((v) => <option key={v} value={v}>{t(`insurance.claims.incidents.${v}`)}</option>)}
        </select>
        <div className="ins-grid">
          <div><div className="ins-sub">{t('insurance.claims.affectedAmount')}</div><input className="ins-input" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1000" /></div>
        </div>
        <div className="ins-sub">{t('insurance.claims.description')}</div>
        <textarea className="ins-input" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={t('insurance.claims.descPlaceholder')} />
        <button className="ins-btn" disabled={busy || !coverageId} onClick={create}>{busy ? t('insurance.claims.creating') : t('insurance.claims.createBtn')}</button>
      </div>
      {err && <div className="ins-alert">{err}</div>}
      {msg && <div className="ins-ok">{msg}</div>}

      {(claims || []).length === 0 && <div className="ins-ok">{t('insurance.claims.empty')}</div>}
      {(claims || []).map((c) => (
        <div className="ins-card" key={c.claimId}>
          <div className="ins-row">
            <span><b>{c.claimNumber}</b> · <Link to={`/insurance/coverage/${c.coverageId}`} style={{ fontSize: 12 }}>{t('insurance.claims.linkCoverage')}</Link></span>
            <span className={'ins-chip ' + (STATUS_CHIP[c.status] || 'PENDING')}>{statusLabel(t, c.status)}</span>
          </div>
          <div className="ins-row"><span>{t('insurance.claims.incidentType')}</span><span>{t(`insurance.claims.incidents.${c.incidentType}`, { defaultValue: c.incidentType })}</span></div>
          <div className="ins-row"><span>{t('insurance.claims.requestPayout')}</span><b>${usd(c.requestedPayoutUsd || '0')}</b></div>
          <div className="ins-row"><span>{t('insurance.claims.approved')}</span><span>${c.approvedPayoutUsd ?? '—'}</span></div>
          <div className="ins-row"><span>{t('insurance.claims.paid')}</span><span>${c.payoutUsd ?? '—'}</span></div>
          <div className="ins-row"><span>{t('insurance.claims.evidence')}</span><code style={{ fontSize: 11 }}>{c.evidenceHash?.slice(0, 20)}…</code></div>
          <div className="ins-sub" style={{ marginTop: 8 }}>{t('insurance.claims.timeline')}</div>
          {(c.timeline || []).map((tl, i) => (
            <div className="ins-row" key={i}><span>{new Date(tl.at).toLocaleString()}</span><span>← {statusLabel(t, tl.status)}</span></div>
          ))}
          {(c.status === 'DRAFT' || c.status === 'ADDITIONAL_INFORMATION_REQUIRED') && (
            <button className="ins-btn small" onClick={() => submit(c.claimId)}>{t('insurance.claims.submitBtn')}</button>
          )}
          {c.status === 'REJECTED' && c.rejectReason && <div className="ins-alert">{t('insurance.claims.rejectReason')}: {c.rejectReason}</div>}
        </div>
      ))}
    </div>
  );
}
