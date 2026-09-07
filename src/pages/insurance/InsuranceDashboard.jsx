import { useEffect, useState } from 'react';
import { Link, useNavigate, useOutletContext } from 'react-router-dom';
import { insuranceApi, usd } from '../../lib/insuranceClient.js';

const CATEGORIES = ['Smart Contract', 'Bridge', 'Stablecoin', 'Lending', 'LP', 'Wallet', 'Oracle', 'DeFi Protocol'];

export default function InsuranceDashboard() {
  const { wallet, notify, connected } = useOutletContext();
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
      .catch((e) => { setErr(e.message || String(e)); notify?.(e.message || 'Could not load coverage', 'error'); });
  }, [wallet, notify]);

  const risk = data?.activeCovers ? 'LOW' : '—';

  return (
    <div>
      <div className="ins-hero">
        <h1>FBT Protection</h1>
        <p>Discover, compare and purchase on-chain protection from external providers. You sign and settle directly — FBT never underwrites or custodies your funds.</p>
        {connected && <span className="ins-chip ACTIVE" style={{ marginTop: 10, display: 'inline-block' }}>Wallet connected</span>}
      </div>

      {err && <div className="ins-alert">{err}</div>}

      <div className="ins-grid">
        <div className="ins-stat"><div className="lbl">Total Protected</div><div className="val acc">${usd(data?.totalProtectedUsd || '0')}</div></div>
        <div className="ins-stat"><div className="lbl">Active Covers</div><div className="val">{data?.activeCovers ?? '—'}</div></div>
        <div className="ins-stat"><div className="lbl">Total Premium</div><div className="val">${usd(data?.totalPremiumUsd || '0')}</div></div>
        <div className="ins-stat"><div className="lbl">Portfolio Risk</div><div className="val"><span className={'ins-chip ' + (risk || 'LOW')}>{risk}</span></div></div>
      </div>

      <button className="ins-btn" onClick={() => nav('/insurance/risk')}>Protect My Assets</button>

      {data?.active?.length > 0 && (
        <>
          <div className="ins-sub" style={{ marginTop: 18 }}>Active Protection</div>
          {data.active.map((c) => (
            <Link key={c.coverageId} to={`/insurance/coverage/${c.coverageId}`} style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="ins-card">
                <div className="ins-row"><span><b style={{ textTransform: 'capitalize' }}>{c.protectionType}</b> · {c.providerName}</span><span className={'ins-chip ' + c.status}>{c.status}</span></div>
                <div className="ins-row"><span>Protected</span><b>${usd(c.coverageAmountMicro)}</b></div>
                <div className="ins-row"><span>Expires</span><span>{c.expiresAt ? new Date(c.expiresAt).toLocaleDateString() : '—'}</span></div>
              </div>
            </Link>
          ))}
        </>
      )}

      <div className="ins-sub" style={{ marginTop: 18 }}>Available Protection</div>
      <div className="ins-grid">
        {CATEGORIES.map((c) => (
          <button key={c} className="ins-card" style={{ textAlign: 'left', cursor: 'pointer', display: 'block' }}
            onClick={() => nav(`/insurance/marketplace?type=${encodeURIComponent(c.toLowerCase().replace(' ', '-'))}`)}>
            <b>{c}</b>
            <div className="ins-muted" style={{ marginTop: 4 }}>Protect {c} exposure</div>
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
