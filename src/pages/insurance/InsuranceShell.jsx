import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { getInsuranceWallet, setInsuranceWallet } from '../../lib/insuranceClient.js';
import './insurance.css';

const TABS = [
  { to: '/insurance', label: 'Dashboard', end: true },
  { to: '/insurance/marketplace', label: 'Marketplace' },
  { to: '/insurance/coverage', label: 'Coverage' },
  { to: '/insurance/claims', label: 'Claims' },
  { to: '/insurance/risk', label: 'Risk' },
  { to: '/insurance/providers', label: 'Providers' }
];

export default function InsuranceShell() {
  const [wallet, setWallet] = useState(getInsuranceWallet());
  const [editing, setEditing] = useState(!getInsuranceWallet());
  const loc = useLocation();

  function save() {
    const w = wallet.trim();
    if (w && !/^0x[a-fA-F0-9]{40}$/.test(w)) { alert('Enter a valid 0x EVM address to continue (sandbox).'); return; }
    setInsuranceWallet(w);
    setEditing(false);
  }

  return (
    <div className="ins-shell">
      <div className="ins-banner">
        <span role="img" aria-label="shield">🛡️</span>
        <span><b>FBT Protection</b> — non-custodial on-chain protection marketplace. Sandbox providers only: nothing here is a live underwriting offer, and FBT never holds your funds.</span>
      </div>

      {editing ? (
        <div className="ins-card">
          <div className="ins-title">Wallet</div>
          <div className="ins-sub">Enter the wallet address you want to analyse/protect. This runs in sandbox mode.</div>
          <input className="ins-input" placeholder="0x… (EVM address)" value={wallet} onChange={(e) => setWallet(e.target.value)} />
          <button className="ins-btn" onClick={save}>Use this wallet</button>
        </div>
      ) : (
        <div className="ins-card">
          <div className="ins-row">
            <span>Wallet</span>
            <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <code style={{ fontSize: 12 }}>{wallet || 'not set'}</code>
              <button className="ins-btn ghost small" onClick={() => setEditing(true)}>Change</button>
            </span>
          </div>
        </div>
      )}

      <div className="ins-tabs">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end}
            className={({ isActive }) => 'ins-tab' + (isActive ? ' active' : '')}>
            {t.label}
          </NavLink>
        ))}
        <NavLink to="/insurance/admin" className="ins-tab">Admin</NavLink>
      </div>

      <Outlet context={{ wallet }} key={loc.pathname} />
    </div>
  );
}
