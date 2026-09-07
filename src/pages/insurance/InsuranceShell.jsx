import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useWallet } from '../../context/WalletContext';
import { getInsuranceWallet, setInsuranceWallet, insuranceApi } from '../../lib/insuranceClient.js';
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
  const w = useWallet();
  const loc = useLocation();

  // Connected-wallet aware. Manual address is only a fallback when nothing is connected.
  const connectedAddr = (w.isConnected ? w.address : '') || '';
  const [manual, setManual] = useState(() => (connectedAddr ? '' : getInsuranceWallet()));
  const [showConnect, setShowConnect] = useState(false);
  const [serverOk, setServerOk] = useState(null); // null checking | true | false

  // alerts
  const [events, setEvents] = useState([]);
  const [providers, setProviders] = useState([]);
  const [sheet, setSheet] = useState(false);

  // toast + confirm modal
  const [toasts, setToasts] = useState([]);
  const [confirmState, setConfirmState] = useState(null);
  const confirmRef = useRef(null);

  const notify = useCallback((msg, type = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, msg, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  const confirm = useCallback((opts) => new Promise((resolve) => {
    confirmRef.current = resolve;
    setConfirmState({ title: opts.title || 'Confirm', message: opts.message || '', confirmLabel: opts.confirmLabel || 'Confirm', danger: !!opts.danger });
  }), []);
  const settleConfirm = (v) => { if (confirmRef.current) confirmRef.current(v); confirmRef.current = null; setConfirmState(null); };

  // Server connectivity probe
  useEffect(() => {
    let alive = true;
    insuranceApi.capabilities().then(() => alive && setServerOk(true)).catch(() => alive && setServerOk(false));
    insuranceApi.events(40).then((e) => setEvents(Array.isArray(e) ? e : [])).catch(() => {});
    insuranceApi.providers().then(setProviders).catch(() => {});
    return () => { alive = false; };
  }, []);

  // When a real wallet connects, prefer it and drop any stale manual address.
  useEffect(() => { if (connectedAddr) setManual(''); }, [connectedAddr]);

  const wallet = (connectedAddr || manual || '').trim();
  const addrValid = /^0x[a-fA-F0-9]{40}$/.test(wallet);

  const saveManual = () => {
    if (manual && !/^0x[a-fA-F0-9]{40}$/.test(manual.trim())) {
      notify('Enter a valid 0x EVM address, or connect a wallet.', 'error'); return;
    }
    setInsuranceWallet(manual.trim()); setShowConnect(false);
  };

  const connectW = (kind) => {
    setShowConnect(false);
    if (kind === 'injected') {
      w.connectInjected().then(() => notify('Injected wallet connected', 'success')).catch((e) => notify(e?.message || 'Wallet connect failed', 'error'));
    } else if (kind === 'wc') {
      w.connectWalletConnect().then(() => notify('WalletConnect connected', 'success')).catch((e) => notify(e?.message || 'WalletConnect failed', 'error'));
    } else if (kind === 'local') {
      setShowConnect(false); setManual(''); notify('Unlock your in-app wallet from the Wallet tab, then return here.', 'info');
    }
  };

  // Derived alerts (modern popover list).
  const lowHealth = providers.filter((p) => p.healthStatus && p.healthStatus !== 'HEALTHY');
  const alerts = [
    ...(serverOk === false ? [{ sev: 'HIGH', title: 'Server unreachable', body: 'Could not reach /api/insurance. Live quotes are unavailable.' }] : []),
    ...(lowHealth.map((p) => ({ sev: p.healthStatus === 'DEGRADED' ? 'MEDIUM' : 'HIGH', title: `${p.name} health: ${p.healthStatus}`, body: 'Not recommended for new purchases while degraded.' }))),
    ...(!wallet ? [{ sev: 'INFO', title: 'No wallet', body: 'Connect a wallet to quote against a real address and to sign.' }] : []),
    { sev: 'INFO', title: 'Sandbox protection only', body: 'Providers are simulations. Nothing here is a live underwriting offer and FBT never custodies funds.' }
  ].slice(0, 8);
  const unread = alerts.length;

  const chainLabel = w.chain?.short || w.chainId || '—';

  return (
    <div className="ins-shell">
      <div className="ins-topbar">
        <div style={{ fontWeight: 800, fontSize: 15, letterSpacing: '-0.01em' }}>🛡️ FBT Protection</div>
        <div className="ins-topbar-right">
          <button className="ins-status-pill" onClick={() => setShowConnect(true)} title="Wallet / server status">
            <span className={'ins-dot ' + (connectedAddr ? 'ok' : serverOk === false ? 'bad' : 'warn')} />
            {connectedAddr ? `${chainLabel} · ${connectedAddr.slice(0, 6)}…${connectedAddr.slice(-4)}` : serverOk === false ? 'API offline' : 'Not connected'}
          </button>
          <button className="ins-bell" onClick={() => setSheet(true)} aria-label="Alerts">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>
            {unread > 0 && <span className="count">{unread}</span>}
          </button>
        </div>
      </div>

      {!wallet && (
        <div className="ins-card">
          <div className="ins-title">Connect your wallet</div>
          <div className="ins-sub">Quotes run against a real address and purchases are signed by you. FBT never sees your key.</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <button className="ins-btn" onClick={() => connectW('injected')}>Browser wallet</button>
            <button className="ins-btn ghost" onClick={() => connectW('wc')}>WalletConnect</button>
            <button className="ins-btn ghost" onClick={() => connectW('local')}>In-app wallet</button>
            <button className="ins-btn ghost small" onClick={() => setShowConnect(true)}>Use address manually</button>
          </div>
          <button className="ins-btn ghost small" onClick={w.isConnected ? w.disconnect : undefined} style={{ opacity: w.isConnected ? 1 : 0.4 }}>
            {w.isConnected ? 'Disconnect' : 'Not connected yet'}
          </button>
        </div>
      )}

      <div className="ins-tabs">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => 'ins-tab' + (isActive ? ' active' : '')}>{t.label}</NavLink>
        ))}
        <NavLink to="/insurance/admin" className="ins-tab">Admin</NavLink>
      </div>

      <Outlet context={{ wallet, connected: connectedAddr, chainId: w.chainId, chainLabel, notify, confirm, switchChain: w.switchChain, getEip1193Provider: w.getEip1193Provider, getSigner: w.getSigner, mode: w.mode }} key={loc.pathname} />

      {/* Connect / manual modal */}
      {showConnect && (
        <div className="ins-modal-backdrop" onClick={() => setShowConnect(false)}>
          <div className="ins-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Wallet</h3>
            {connectedAddr ? (
              <>
                <p>Connected: <b style={{ color: 'var(--text-1)' }}>{connectedAddr}</b> ({chainLabel})</p>
                <div className="ins-modal-actions">
                  <button className="ins-btn ghost" onClick={() => { w.disconnect(); notify('Wallet disconnected', 'info'); }}>Disconnect</button>
                  <button className="ins-btn" onClick={() => setShowConnect(false)}>Done</button>
                </div>
              </>
            ) : (
              <>
                <p>Choose how you sign. In every mode your private key stays with you.</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <button className="ins-btn" onClick={() => connectW('injected')}>MetaMask / browser wallet</button>
                  <button className="ins-btn ghost" onClick={() => connectW('wc')}>WalletConnect (QR / Telegram)</button>
                </div>
                <div style={{ marginTop: 14 }} className="ins-sub">Or enter an address (view-only):</div>
                <input className="ins-input" placeholder="0x…" value={manual} onChange={(e) => setManual(e.target.value)} />
                <div className="ins-modal-actions">
                  <button className="ins-btn" onClick={saveManual}>Use address</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Alerts sheet */}
      {sheet && (
        <>
          <div className="ins-modal-backdrop" style={{ background: 'rgba(0,0,0,.35)' }} onClick={() => setSheet(false)} />
          <div className="ins-sheet">
            <div className="ins-sheet-head">
              <h3>Alerts &amp; warnings</h3>
              <button className="ins-btn ghost small" onClick={() => setSheet(false)}>Close</button>
            </div>
            {alerts.length === 0 && <div className="ins-ok">No alerts.</div>}
            {alerts.map((a, i) => (
              <div className="ins-alert-item" key={i}>
                <span className="ins-chip" style={{ background: a.sev === 'HIGH' ? '#fee2e2' : a.sev === 'MEDIUM' ? '#fef9c3' : '#e0e7ff', color: a.sev === 'HIGH' ? '#991b1b' : a.sev === 'MEDIUM' ? '#854d0e' : '#312e81' }}>{a.sev}</span>
                <div>
                  <div style={{ fontWeight: 700, color: 'var(--text-1)', fontSize: 13 }}>{a.title}</div>
                  <div style={{ color: 'var(--text-2)', fontSize: 12 }}>{a.body}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Confirm modal */}
      {confirmState && (
        <div className="ins-modal-backdrop">
          <div className="ins-modal">
            <h3>{confirmState.title}</h3>
            <p>{confirmState.message}</p>
            <div className="ins-modal-actions">
              <button className="ins-btn ghost" onClick={() => settleConfirm(false)}>Cancel</button>
              <button className={confirmState.danger ? 'ins-btn warn' : 'ins-btn'} onClick={() => settleConfirm(true)}>{confirmState.confirmLabel}</button>
            </div>
          </div>
        </div>
      )}

      {/* Toasts */}
      <div className="ins-toast-wrap">
        {toasts.map((t) => (
          <div className={'ins-toast ' + t.type} key={t.id}>{t.msg}</div>
        ))}
      </div>

      {/* server health strip */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 18, fontSize: 12, color: 'var(--text-2)' }}>
        <span className={'ins-dot ' + (serverOk === true ? 'ok' : serverOk === false ? 'bad' : 'warn')} />
        Server: {serverOk === null ? 'checking…' : serverOk === true ? 'connected · API online' : 'offline'}
      </div>
    </div>
  );
}
