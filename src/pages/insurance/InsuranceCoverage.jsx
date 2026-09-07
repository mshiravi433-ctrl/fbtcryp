import { useEffect, useState } from 'react';
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { insuranceApi, usd } from '../../lib/insuranceClient.js';

export default function InsuranceCoverageList() {
  const { wallet } = useOutletContext();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const nav = useNavigate();
  useEffect(() => {
    if (!wallet) return;
    insuranceApi.coverage(wallet).then(setData).catch((e) => setErr(e.message || String(e)));
  }, [wallet]);

  if (!wallet) return <div className="ins-ok">Set a wallet to view your coverage.</div>;
  if (err) return <div className="ins-alert">{err}</div>;

  const active = (data?.coverages || []).filter((c) => c.status === 'ACTIVE');
  return (
    <div>
      <div className="ins-title">Active Coverage</div>
      <div className="ins-sub">{active.length} active · Total protected ${usd(data?.summary?.totalProtectedUsd || '0')}</div>
      <button className="ins-btn" onClick={() => nav('/insurance/risk')}>Protect a coverage gap</button>

      {(data?.coverages || []).length === 0 && <div className="ins-ok">No coverage yet. Explore the marketplace to protect your assets.</div>}

      {(data?.coverages || []).map((c) => (
        <Link key={c.coverageId} to={`/insurance/coverage/${c.coverageId}`} style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="ins-card">
            <div className="ins-row">
              <span><b style={{ textTransform: 'capitalize' }}>{c.protectionType}</b> · {c.providerName}</span>
              <span className={'ins-chip ' + c.status}>{c.status}</span>
            </div>
            <div className="ins-row"><span>Protected</span><b>${usd(c.coverageAmountMicro)}</b></div>
            <div className="ins-row"><span>Premium</span><span>${c.premiumUsd}</span></div>
            <div className="ins-row"><span>Expires</span><span>{c.expiresAt ? new Date(c.expiresAt).toLocaleDateString() : '—'}</span></div>
          </div>
        </Link>
      ))}
    </div>
  );
}

export function InsuranceCoverageDetail() {
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
    try { await insuranceApi.renew({ coverageId: id, walletAddress: wallet, durationDays: 30 }); load(); notify('Coverage renewed +30 days', 'success'); }
    catch (e) { notify(e.message || 'Renew failed', 'error'); }
    setBusy('');
  }
  async function cancel() {
    const ok2 = await confirm({ title: 'Cancel coverage?', message: 'This ends your active certificate. Past coverage remains in your history.', confirmLabel: 'Cancel coverage', danger: true });
    if (!ok2) return;
    setBusy('cancel');
    try { await insuranceApi.cancel({ coverageId: id, walletAddress: wallet }); load(); notify('Coverage cancelled', 'success'); }
    catch (e) { notify(e.message || 'Cancel failed', 'error'); }
    setBusy('');
  }

  if (err) return <div className="ins-alert">{err}</div>;
  if (!cov) return <div className="ins-muted">Loading coverage…</div>;

  return (
    <div>
      <button className="ins-btn ghost small" onClick={() => nav('/insurance/coverage')}>← Coverage</button>
      <div className="ins-title" style={{ textTransform: 'capitalize' }}>{cov.protectionType} Coverage</div>
      <div className="ins-card">
        <div className="ins-row"><span>Status</span><span className={'ins-chip ' + cov.status}>{cov.status}</span></div>
        <div className="ins-row"><span>Provider</span><span>{cov.providerName}</span></div>
        <div className="ins-row"><span>Coverage amount</span><b>${usd(cov.coverageAmountMicro)}</b></div>
        <div className="ins-row"><span>Premium paid</span><span>${cov.premiumUsd}</span></div>
        <div className="ins-row"><span>Total cost</span><span>${cov.totalCostUsd}</span></div>
        <div className="ins-row"><span>Duration</span><span>{cov.durationDays} days</span></div>
        <div className="ins-row"><span>Started</span><span>{cov.startedAt ? new Date(cov.startedAt).toLocaleDateString() : '—'}</span></div>
        <div className="ins-row"><span>Expires</span><span>{cov.expiresAt ? new Date(cov.expiresAt).toLocaleDateString() : '—'}</span></div>
        <div className="ins-row"><span>Chain</span><span>{cov.chainId} (Solana sandbox = 900)</span></div>
        <div className="ins-row"><span>Terms hash</span><code style={{ fontSize: 11 }}>{cov.termsHash?.slice(0, 24)}…</code></div>
        <div className="ins-row"><span>Settlement</span><span>{cov.settlementModel} — non-custodial</span></div>
      </div>

      {cov.status === 'ACTIVE' && (
        <div className="ins-card">
          <div className="ins-sub">Manage</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="ins-btn small" disabled={busy} onClick={renew}>Renew +30 days</button>
            <button className="ins-btn ghost small" onClick={() => nav('/insurance/claims', { state: { coverageId: id } })}>File a claim</button>
            <button className="ins-btn warn small" disabled={busy} onClick={cancel}>Cancel coverage</button>
          </div>
        </div>
      )}

      <div className="ins-excl"><b>Exclusions on this certificate:</b><ul style={{ margin: '6px 0 0 18px' }}>{(cov.exclusions || []).map((x, i) => <li key={i}>{x}</li>)}</ul></div>
    </div>
  );
}
