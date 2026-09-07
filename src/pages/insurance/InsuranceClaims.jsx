import { useEffect, useState } from 'react';
import { Link, useLocation, useOutletContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { insuranceApi, usd } from '../../lib/insuranceClient.js';

const STATUS_CHIP = {
  DRAFT: 'PENDING', SUBMITTED: 'PENDING', UNDER_REVIEW: 'PENDING', ADDITIONAL_INFORMATION_REQUIRED: 'PENDING',
  APPROVED: 'ACTIVE', PARTIALLY_APPROVED: 'ACTIVE', PAID: 'ACTIVE', REJECTED: 'UNAVAILABLE',
  CANCELLED: 'EXPIRED', DISPUTED: 'HIGH'
};

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

  useEffect(() => { if (wallet) insuranceApi.claims(wallet).then((d) => setClaims(d.claims)).catch(() => {}); }, [wallet]);

  async function create() {
    setErr(''); setMsg(''); setBusy(true);
    try {
      const body = {
        coverageId, walletAddress: wallet, incidentType,
        description: desc, evidenceHash: '0x' + 'ab'.repeat(32)
      };
      if (amount) body.affectedAmountMicro = amount;
      const r = await insuranceApi.createClaim(body);
      setMsg(t('insurance.claims.created', { number: r.data.claim.claimNumber, status: r.data.claim.status }));
      notify(t('insurance.claims.createdToast', { number: r.data.claim.claimNumber }), 'success');
      const d = await insuranceApi.claims(wallet); setClaims(d.claims);
    } catch (e) { setErr(e.message || String(e)); notify(e.message || 'Claim creation failed', 'error'); }
    setBusy(false);
  }

  async function submit(claimId) {
    try { await insuranceApi.submitClaim(claimId, { walletAddress: wallet }); const d = await insuranceApi.claims(wallet); setClaims(d.claims); notify('Claim submitted to provider', 'success'); } catch (e) { notify(e.message || 'Submit failed', 'error'); }
  }

  return (
    <div>
      <div className="ins-title">Claims</div>
      <div className="ins-sub">Incidents are detected and flagged; you decide whether to file. Evidence is stored by hash, and payouts are verified on-chain before any claim is marked paid.</div>

      <div className="ins-card">
        <div className="ins-sub" style={{ marginTop: 0 }}>File a claim</div>
        <div className="ins-sub">Coverage ID</div>
        <input className="ins-input" value={coverageId} onChange={(e) => setCoverageId(e.target.value)} placeholder="cov-…" />
        <div className="ins-sub">Incident type</div>
        <select className="ins-select" value={incidentType} onChange={(e) => setIncidentType(e.target.value)}>
          {['smart-contract-exploit', 'bridge-incident', 'depeg-event', 'oracle-failure', 'protocol-exploit', 'wallet-custody-loss'].map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <div className="ins-grid">
          <div><div className="ins-sub">Affected amount (USD, optional)</div><input className="ins-input" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        </div>
        <div className="ins-sub">Description</div>
        <textarea className="ins-input" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Describe the incident (a verifiable incident is required)" />
        <button className="ins-btn" disabled={busy || !coverageId || !wallet} onClick={create}>{busy ? '…' : 'Create claim'}</button>
        {!wallet && <div className="ins-muted">Set wallet first.</div>}
      </div>
      {err && <div className="ins-alert">{err}</div>}
      {msg && <div className="ins-ok">{msg}</div>}

      {(claims || []).length === 0 && <div className="ins-ok">No claims yet.</div>}
      {(claims || []).map((c) => (
        <div className="ins-card" key={c.claimId}>
          <div className="ins-row">
            <span><b>{c.claimNumber}</b> · <Link to={`/insurance/coverage/${c.coverageId}`} style={{ fontSize: 12 }}>coverage</Link></span>
            <span className={'ins-chip ' + (STATUS_CHIP[c.status] || 'PENDING')}>{c.status}</span>
          </div>
          <div className="ins-row"><span>Incident</span><span>{c.incidentType}</span></div>
          <div className="ins-row"><span>Requested payout</span><b>${c.requestedPayoutUsd}</b></div>
          <div className="ins-row"><span>Approved</span><span>${c.approvedPayoutUsd ?? '—'}</span></div>
          <div className="ins-row"><span>Paid</span><span>${c.payoutUsd ?? '—'}</span></div>
          <div className="ins-row"><span>Evidence hash</span><code style={{ fontSize: 11 }}>{c.evidenceHash?.slice(0, 20)}…</code></div>
          <div className="ins-sub" style={{ marginTop: 8 }}>Timeline</div>
          {(c.timeline || []).map((t, i) => (
            <div className="ins-row" key={i}><span>{new Date(t.at).toLocaleString()}</span><span>→ {t.status}</span></div>
          ))}
          {(c.status === 'DRAFT' || c.status === 'ADDITIONAL_INFORMATION_REQUIRED') && (
            <button className="ins-btn small" onClick={() => submit(c.claimId)}>Submit to provider</button>
          )}
          {c.status === 'REJECTED' && c.rejectReason && <div className="ins-alert">Reason: {c.rejectReason}</div>}
        </div>
      ))}
    </div>
  );
}
