import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useWallet } from '../../context/WalletContext';
import { getInsuranceWallet, setInsuranceWallet, insuranceApi } from '../../lib/insuranceClient.js';
import './insurance.css';

const TABS = [
  { to: '/insurance', key: 'insurance.tabs.dashboard', end: true },
  { to: '/insurance/marketplace', key: 'insurance.tabs.marketplace' },
  { to: '/insurance/coverage', key: 'insurance.tabs.coverage' },
  { to: '/insurance/claims', key: 'insurance.tabs.claims' },
  { to: '/insurance/risk', key: 'insurance.tabs.risk' },
  { to: '/insurance/providers', key: 'insurance.tabs.providers' }
];

export default function InsuranceShell() {
  const { t } = useTranslation();
  const w = useWallet();
  const loc = useLocation();
  const tablistRef = useRef(null);

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
    setToasts((prev) => [...prev, { id, msg, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 4500);
  }, []);

  const confirm = useCallback((opts) => new Promise((resolve) => {
    confirmRef.current = resolve;
    setConfirmState({ title: opts.title || t('insurance.common.confirm'), message: opts.message || '', confirmLabel: opts.confirmLabel || t('insurance.common.confirm'), danger: !!opts.danger });
  }), [t]);
  const settleConfirm = (v) => { if (confirmRef.current) confirmRef.current(v); confirmRef.current = null; setConfirmState(null); };

  // Server connectivity probe
  useEffect(() => {
    let alive = true;
    insuranceApi.capabilities().then(() => alive && setServerOk(true)).catch(() => alive && setServerOk(false));
    insuranceApi.events(40).then((e) => alive && setEvents(Array.isArray(e) ? e : [])).catch(() => {});
    insuranceApi.providers().then((p) => alive && setProviders(Array.isArray(p) ? p : [])).catch(() => {});
    return () => { alive = false; };
  }, []);

  // When a real wallet connects, prefer it and drop any stale manual address.
  useEffect(() => { if (connectedAddr) setManual(''); }, [connectedAddr]);

  const wallet = (connectedAddr || manual || '').trim();
  const addrValid = /^0x[a-fA-F0-9]{40}$/.test(wallet);

  const saveManual = () => {
    if (manual && !/^0x[a-fA-F0-9]{40}$/.test(manual.trim())) {
      notify(t('insurance.shell.invalidAddress'), 'error'); return;
    }
    setInsuranceWallet(manual.trim()); setShowConnect(false);
  };

  const connectW = (kind) => {
    setShowConnect(false);
    if (kind === 'injected') {
      w.connectInjected().then(() => notify(t('insurance.shell.injectedConnected'), 'success')).catch((e) => notify(e?.message || t('insurance.shell.connectFailed'), 'error'));
    } else if (kind === 'wc') {
      w.connectWalletConnect().then(() => notify(t('insurance.shell.wcConnected'), 'success')).catch((e) => notify(e?.message || t('insurance.shell.connectFailed'), 'error'));
    } else if (kind === 'local') {
      setShowConnect(false); setManual(''); notify(t('insurance.shell.useInAppWallet'), 'info');
    }
  };

  // Keyboard navigation for the tab rail (ArrowLeft/ArrowRight/Home/End).
  const onTablistKeyDown = (e) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    const links = tablistRef.current ? [...tablistRef.current.querySelectorAll('a.ins-tab')] : [];
    if (!links.length) return;
    e.preventDefault();
    const rtl = document.documentElement.dir === 'rtl';
    const forward = e.key === (rtl ? 'ArrowLeft' : 'ArrowRight');
    const idx = links.indexOf(document.activeElement);
    let next;
    if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = links.length - 1;
    else if (idx === -1) next = 0;
    else next = (idx + (forward ? 1 : -1) + links.length) % links.length;
    links[next]?.focus();
  };

  // Derived alerts. The sandbox notice appears ONLY while sandbox providers are
  // actually registered (dev/test) — production never shows it.
  const sandboxPresent = providers.some((p) => p.status === 'SANDBOX');
  const livePresent = providers.some((p) => p.status === 'LIVE' && p.enabled);
  const noLiveProvider = !sandboxPresent && !livePresent && serverOk === true;
  const lowHealth = providers.filter((p) => p.healthStatus && p.healthStatus !== 'HEALTHY' && p.status !== 'SANDBOX');
  const alerts = [
    ...(serverOk === false ? [{ sev: 'HIGH', title: t('insurance.alerts.serverDownTitle'), body: t('insurance.alerts.serverDownBody') }] : []),
    ...(!livePresent && !sandboxPresent && serverOk === true ? [{ sev: 'MEDIUM', title: t('insurance.alerts.noProviderTitle'), body: t('insurance.alerts.noProviderBody') }] : []),
    ...(sandboxPresent ? [{ sev: 'INFO', title: t('insurance.alerts.sandboxTitle'), body: t('insurance.alerts.sandboxBody') }] : []),
    ...(lowHealth.map((p) => ({ sev: p.healthStatus === 'DEGRADED' ? 'MEDIUM' : 'HIGH', title: t('insurance.alerts.healthTitle', { name: p.name, status: p.healthStatus }), body: t('insurance.alerts.healthBody') }))),
    ...(!wallet ? [{ sev: 'INFO', title: t('insurance.alerts.noWalletTitle'), body: t('insurance.alerts.noWalletBody') }] : [])
  ].slice(0, 8);
  const unread = alerts.length;

  const chainLabel = w.chain?.short || w.chainId || '—';

  return (
    <div className="ins-shell">
      <div className="ins-topbar">
        <div style={{ fontWeight: 800, fontSize: 15, letterSpacing: '-0.01em' }}>🛡️ {t('insurance.shell.brand')}</div>
        <div className="ins-topbar-right">
          <button className="ins-status-pill" onClick={() => setShowConnect(true)} title={t('insurance.shell.walletStatus')}>
            <span className={'ins-dot ' + (connectedAddr ? 'ok' : serverOk === false ? 'bad' : 'warn')} />
            {connectedAddr ? `${chainLabel} · ${connectedAddr.slice(0, 6)}…${connectedAddr.slice(-4)}` : serverOk === false ? t('insurance.shell.apiOffline') : t('insurance.shell.notConnected')}
          </button>
          <button className="ins-bell" onClick={() => setSheet(true)} aria-label={t('insurance.shell.alerts')}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>
            {unread > 0 && <span className="count">{unread}</span>}
          </button>
        </div>
      </div>

      {!wallet && (
        <div className="ins-card">
          <div className="ins-title">{t('insurance.shell.connectTitle')}</div>
          <div className="ins-sub">{t('insurance.shell.connectBody')}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <button className="ins-btn" onClick={() => connectW('injected')}>{t('insurance.shell.browserWallet')}</button>
            <button className="ins-btn ghost" onClick={() => connectW('wc')}>{t('insurance.shell.walletConnect')}</button>
            <button className="ins-btn ghost" onClick={() => connectW('local')}>{t('insurance.shell.inAppWallet')}</button>
            <button className="ins-btn ghost small" onClick={() => setShowConnect(true)}>{t('insurance.shell.manualAddress')}</button>
          </div>
          <button className="ins-btn ghost small" onClick={w.isConnected ? w.disconnect : undefined} style={{ opacity: w.isConnected ? 1 : 0.4 }}>
            {w.isConnected ? t('insurance.shell.disconnect') : t('insurance.shell.notConnectedYet')}
          </button>
        </div>
      )}

      <div className="ins-tabs" role="tablist" aria-label={t('insurance.tabs.ariaLabel')} ref={tablistRef} onKeyDown={onTablistKeyDown}>
        {TABS.map((tabDef) => (
          <NavLink
            key={tabDef.to}
            to={tabDef.to}
            end={tabDef.end}
            role="tab"
            aria-label={t(tabDef.key)}
            className={({ isActive }) => 'ins-tab' + (isActive ? ' active' : '')}
          >{t(tabDef.key)}</NavLink>
        ))}
      </div>

      <Outlet context={{ wallet, connected: connectedAddr, chainId: w.chainId, chainLabel, notify, confirm, switchChain: w.switchChain, getEip1193Provider: w.getEip1193Provider, getSigner: w.getSigner, mode: w.mode }} key={loc.pathname} />

      {/* Connect / manual modal */}
      {showConnect && (
        <div className="ins-modal-backdrop" onClick={() => setShowConnect(false)}>
          <div className="ins-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{t('insurance.shell.wallet')}</h3>
            {connectedAddr ? (
              <>
                <p>{t('insurance.shell.connectedAs')}: <b style={{ color: 'var(--text-1)' }}>{connectedAddr}</b> ({chainLabel})</p>
                <div className="ins-modal-actions">
                  <button className="ins-btn ghost" onClick={() => { w.disconnect(); notify(t('insurance.shell.disconnected'), 'info'); }}>{t('insurance.shell.disconnect')}</button>
                  <button className="ins-btn" onClick={() => setShowConnect(false)}>{t('insurance.common.done')}</button>
                </div>
              </>
            ) : (
              <>
                <p>{t('insurance.shell.chooseSigning')}</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <button className="ins-btn" onClick={() => connectW('injected')}>{t('insurance.shell.metamask')}</button>
                  <button className="ins-btn ghost" onClick={() => connectW('wc')}>{t('insurance.shell.wcQr')}</button>
                </div>
                <div style={{ marginTop: 14 }} className="ins-sub">{t('insurance.shell.orEnterAddress')}</div>
                <input className="ins-input" placeholder="0x…" value={manual} onChange={(e) => setManual(e.target.value)} aria-label={t('insurance.shell.manualAddress')} />
                <div className="ins-modal-actions">
                  <button className="ins-btn" onClick={saveManual} disabled={manual !== '' && !addrValid}>{t('insurance.shell.useAddress')}</button>
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
              <h3>{t('insurance.shell.alerts')}</h3>
              <button className="ins-btn ghost small" onClick={() => setSheet(false)}>{t('insurance.common.close')}</button>
            </div>
            {alerts.length === 0 && <div className="ins-ok">{t('insurance.shell.noAlerts')}</div>}
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
              <button className="ins-btn ghost" onClick={() => settleConfirm(false)}>{t('insurance.common.cancel')}</button>
              <button className={confirmState.danger ? 'ins-btn warn' : 'ins-btn'} onClick={() => settleConfirm(true)}>{confirmState.confirmLabel}</button>
            </div>
          </div>
        </div>
      )}

      {/* Toasts */}
      <div className="ins-toast-wrap">
        {toasts.map((toast) => (
          <div className={'ins-toast ' + toast.type} key={toast.id}>{toast.msg}</div>
        ))}
      </div>

      {/* server health strip */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 18, fontSize: 12, color: 'var(--text-2)' }}>
        <span className={'ins-dot ' + (serverOk === true ? 'ok' : serverOk === false ? 'bad' : 'warn')} />
        {t('insurance.shell.server')}: {serverOk === null ? t('insurance.shell.checking') : serverOk === true ? t('insurance.shell.serverOnline') : t('insurance.shell.serverOffline')}
      </div>
    </div>
  );
}
