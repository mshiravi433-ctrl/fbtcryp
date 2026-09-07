import { useEffect, useState } from 'react';
import { Link, useNavigate, useOutletContext } from 'react-router-dom';
import { insuranceApi, usd } from '../../lib/insuranceClient.js';

const CATEGORIES = ['Smart Contract', 'Bridge', 'Stablecoin', 'Lending', 'LP', 'Wallet', 'Oracle', 'DeFi Protocol'];

export default function InsuranceDashboard() {
  const { wallet } = useOutletContext();
  const [data, setData] = useState(null);
  const [providers, setProviders] = useState([]);
  const [err, setErr] = useState('');
  const nav = useNavigate();

  useEffect(() => {
    setErr('');
    insuranceApi.providers().then(setProviders).catch(() => {});
    if (!wallet) return;
    insuranceApi.coverage(wallet)
      .then((d) => setData(d.summary))
      .catch((e) => setErr(e.message || String(e)));
  }, [wallet]);

  const risk = data?.activeCovers ? 'LOW' : '—';

  return (
    <div>
      <div className="ins-title">FBT Protection</div>
      <div className="ins-sub">Discover, compare and purchase protection from external providers. FBT never underwrites or custodies — you sign and settle directly.</div>

      {err && <div className="ins-alert">Could not load coverage: {err}</div>}
      {!wallet && (
        <div className="ins-ok">Set a wallet address above to see your protection dashboard and coverage.</div>
      )}

      <div className="ins-grid">
        <div className="ins-stat"><div className="lbl">Total Protected</div><div className="val">${usd(data?.totalProtectedUsd || '0')}</div></div>
        <div className="ins-stat"><div className="lbl">Active Covers</div><div className="val">{data?.activeCovers ?? '—'}</div></div>
        <div className="ins-stat"><div className="lbl">Total Premium</div><div className="val">${usd(data?.totalPremiumUsd || '0')}</div></div>
        <div className="ins-stat"><div className="lbl">Portfolio Risk</div><div className="val"><span className={'ins-chip ' + (risk || 'LOW')}>{risk}</span></div></div>
      </div>

      <button className="ins-btn" onClick={() => nav('/insurance/risk')}>Protect My Assets</button>

      {data?.active?.length > 0 && (
        <>
          <div className="ins-sub" style={{ marginTop: 20 }}>Active Protection</div>
          {data.active.map((c) => (
            <Link key={c.coverageId} to={`/insurance/coverage/${c.coverageId}`} style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="ins-card">
                <div className="ins-row"><span><b>{c.protectionType}</b></span><span className={'ins-chip ' + c.status}>{c.status}</span></div>
                <div className="ins-row"><span>Protected</span><b>${usd(c.coverageAmountMicro)}</b></div>
                <div className="ins-row"><span>Expires</span><span>{new Date(c.expiresAt).toLocaleDateString()}</span></div>
              </div>
            </Link>
          ))}
        </>
      )}

      <div className="ins-sub" style={{ marginTop: 20 }}>Available Protection</div>
      <div className="ins-grid">
        {CATEGORIES.map((c) => (
          <button key={c} className="ins-card" style={{ textAlign: 'left', cursor: 'pointer' }}
            onClick={() => nav(`/insurance/marketplace?type=${encodeURIComponent(c.toLowerCase().replace(' ', '-'))}`)}>
            <b>{c}</b>
            <div className="ins-muted">Protect {c} exposure</div>
          </button>
        ))}
      </div>

      <div className="ins-card">
        <div className="ins-sub" style={{ marginTop: 0 }}>Connected providers</div>
        {providers.filter((p) => p.configured).map((p) => (
          <div key={p.providerId} className="ins-row">
            <span>{p.displayName || p.name}</span>
            <span className={'ins-chip ' + (p.healthStatus || 'UNKNOWN')}>{p.healthStatus}</span>
          </div>
        ))}
        <div className="ins-muted">Nexus Mutual is registered but disabled until its live integration is verified.</div>
      </div>
    </div>
  );
}
