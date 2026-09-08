import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useWallet } from '../../context/WalletContext';
import { insuranceApi } from '../../lib/insuranceClient.js';
import { statusLabel } from './insStatus.js';
import InsuranceExplain from './InsuranceExplain.jsx';
import { InsIconShield, InsIconBell, InsIconWallet, InsIconChevronEnd, InsIconInfo, INS_TAB_ICONS } from './InsuranceIcons.jsx';
import './insurance.css';

const TABS = [
  { to: '/insurance', key: 'insurance.tabs.dashboard', icon: 'dashboard', end: true },
  { to: '/insurance/marketplace', key: 'insurance.tabs.marketplace', icon: 'marketplace' },
  { to: '/insurance/coverage', key: 'insurance.tabs.coverage', icon: 'coverage' },
  { to: '/insurance/claims', key: 'insurance.tabs.claims', icon: 'claims' },
  { to: '/insurance/risk', key: 'insurance.tabs.risk', icon: 'risk' },
  { to: '/insurance/providers', key: 'insurance.tabs.providers', icon: 'providers' }
];

/** Severity → chip class (token palette in insurance.css, both themes). */
const SEV_CHIP = { HIGH: 'HIGH', MEDIUM: 'MEDIUM', INFO: 'INFO' };

export default function InsuranceShell() {
  const { t } = useTranslation();
  const w = useWallet();
  const loc = useLocation();
  const tablistRef = useRef(null);

  const connectedAddr = (w.isConnected ? w.address : '') || '';
  const [showWallet, setShowWallet] = useState(false); // wallet dialog (connected: manage/disconnect)
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
    ...(lowHealth.map((p) => ({ sev: p.healthStatus === 'DEGRADED' ? 'MEDIUM' : 'HIGH', title: t('insurance.alerts.healthTitle', { name: p.name, status: t(`insurance.status.${p.healthStatus}`, { defaultValue: p.healthStatus }) }), body: t('insurance.alerts.healthBody') }))),
    ...(!connectedAddr ? [{ sev: 'INFO', title: t('insurance.alerts.noWalletTitle'), body: t('insurance.alerts.noWalletBody') }] : [])
  ].slice(0, 8);
  const unread = alerts.length;

  const chainLabel = w.chain?.short || w.chainId || '—';

  /* Overflow affordance for the tab rail: instead of a scrollbar inside the
     box, the wrapper gets data-edge-start/end so CSS can paint faded edges and
     small arrows only on the side that actually has more tabs. */
  const [edges, setEdges] = useState({ start: false, end: false });
  const measureEdges = useCallback(() => {
    const el = tablistRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    if (max <= 1) { setEdges((e) => (e.start || e.end ? { start: false, end: false } : e)); return; }
    // In RTL modern engines count scrollLeft negative from the inline start,
    // so the absolute value is "distance from the start edge" in both directions.
    const pos = Math.abs(el.scrollLeft);
    const next = { start: pos > 1, end: pos < max - 1 };
    setEdges((e) => (e.start === next.start && e.end === next.end ? e : next));
  }, []);
  useEffect(() => {
    measureEdges();
    const el = tablistRef.current;
    if (!el) return undefined;
    el.addEventListener('scroll', measureEdges, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measureEdges) : null;
    ro?.observe(el);
    window.addEventListener('resize', measureEdges);
    return () => { el.removeEventListener('scroll', measureEdges); ro?.disconnect(); window.removeEventListener('resize', measureEdges); };
  }, [measureEdges]);
  // Keep the active tab visible when the route changes (deep links, back/forward).
  useEffect(() => {
    const el = tablistRef.current;
    const active = el?.querySelector('a.ins-tab.active');
    if (active && typeof active.scrollIntoView === 'function') {
      try { active.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' }); } catch { /* older engines */ }
    }
    measureEdges();
  }, [loc.pathname, measureEdges]);
  const nudge = (dir) => {
    const el = tablistRef.current;
    if (!el) return;
    const rtl = getComputedStyle(el).direction === 'rtl';
    const delta = Math.round(el.clientWidth * 0.7) * (dir === 'end' ? 1 : -1) * (rtl ? -1 : 1);
    el.scrollBy({ left: delta, behavior: 'smooth' });
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

  return (
    <div className="ins-shell">
      <div className="ins-topbar">
        <div className="ins-brand">
          <span className="ins-brand-ico"><InsIconShield /></span>
          <span className="ins-brand-text">
            <span className="ins-brand-name">{t('insurance.shell.brand')}</span>
            <span className="ins-brand-sub">{t('insurance.dashboard.heroBadge')}</span>
          </span>
        </div>
        <div className="ins-topbar-right">
          <button className="ins-status-pill" onClick={() => setShowWallet(true)} title={t('insurance.shell.walletStatus')}>
            <span className={'ins-dot ' + (connectedAddr ? 'ok' : serverOk === false ? 'bad' : 'warn')} />
            <span>{connectedAddr ? `${chainLabel} · ${connectedAddr.slice(0, 6)}…${connectedAddr.slice(-4)}` : serverOk === false ? t('insurance.shell.apiOffline') : t('insurance.shell.notConnected')}</span>
          </button>
          <button className="ins-bell" onClick={() => setSheet(true)} aria-label={t('insurance.shell.alerts')}>
            <InsIconBell />
            {unread > 0 && <span className="count">{unread}</span>}
          </button>
        </div>
      </div>

      {/* Wallet is connected inside the app's Wallet page — this screen only
          links there when nothing is connected (no in-page key handling). */}
      {!connectedAddr && (
        <div className="ins-card ins-wallet-card ins-tone-magenta">
          <div className="ins-ico"><InsIconWallet /></div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="ins-title" style={{ marginTop: 0, fontSize: 16 }}>{t('insurance.shell.walletRequiredTitle')}</div>
            <div className="ins-sub" style={{ marginBottom: 0 }}>{t('insurance.shell.walletRequiredBody')}</div>
            <div className="ins-wallet-actions">
              <Link className="ins-btn small" to="/wallet">{t('insurance.shell.goWallet')} <InsIconChevronEnd /></Link>
              <span className="ins-faint">{t('insurance.shell.walletRequiredHint')}</span>
            </div>
          </div>
        </div>
      )}

      <div className="ins-tabs-wrap" data-edge-start={edges.start ? 'true' : 'false'} data-edge-end={edges.end ? 'true' : 'false'}>
        <button type="button" className="ins-tabs-arrow start" tabIndex={-1} aria-hidden="true" onClick={() => nudge('start')}><InsIconChevronEnd /></button>
        <div className="ins-tabs" role="tablist" aria-label={t('insurance.tabs.ariaLabel')} ref={tablistRef} onKeyDown={onTablistKeyDown}>
          {TABS.map((tabDef) => {
            const meta = INS_TAB_ICONS[tabDef.icon] || { Icon: InsIconShield, tone: 'cyan' };
            const Glyph = meta.Icon;
            return (
              <NavLink
                key={tabDef.to}
                to={tabDef.to}
                end={tabDef.end}
                role="tab"
                aria-label={t(tabDef.key)}
                className={({ isActive }) => `ins-tab ins-tone-${meta.tone}` + (isActive ? ' active' : '')}
              >
                <span className="ins-tab-ico"><Glyph /></span>
                <span>{t(tabDef.key)}</span>
              </NavLink>
            );
          })}
        </div>
        <button type="button" className="ins-tabs-arrow end" tabIndex={-1} aria-hidden="true" onClick={() => nudge('end')}><InsIconChevronEnd /></button>
      </div>

      <Outlet context={{ wallet: connectedAddr, connected: !!connectedAddr, chainId: w.chainId, chainLabel, notify, confirm, switchChain: w.switchChain, getEip1193Provider: w.getEip1193Provider, getSigner: w.getSigner, mode: w.mode }} key={loc.pathname} />

      {/* Transparency box at the bottom of every insurance page */}
      <InsuranceExplain />

      {/* Wallet dialog (connected wallet management only) */}
      {showWallet && (
        <div className="ins-modal-backdrop" onClick={() => setShowWallet(false)}>
          <div className="ins-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{t('insurance.shell.wallet')}</h3>
            {connectedAddr ? (
              <>
                <p>{t('insurance.shell.connectedAs')}: <b style={{ color: 'var(--text-1)', wordBreak: 'break-all' }}>{connectedAddr}</b> ({chainLabel})</p>
                <div className="ins-modal-actions">
                  <button className="ins-btn ghost" onClick={() => { w.disconnect(); notify(t('insurance.shell.disconnected'), 'info'); }}>{t('insurance.shell.disconnect')}</button>
                  <button className="ins-btn" onClick={() => setShowWallet(false)}>{t('insurance.common.done')}</button>
                </div>
              </>
            ) : (
              <>
                <p>{t('insurance.shell.walletRequiredBody')}</p>
                <div className="ins-modal-actions">
                  <Link className="ins-btn" to="/wallet" onClick={() => setShowWallet(false)}>{t('insurance.shell.goWallet')}</Link>
                  <button className="ins-btn ghost" onClick={() => setShowWallet(false)}>{t('insurance.common.close')}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Alerts sheet */}
      {sheet && (
        <>
          <div className="ins-modal-backdrop" onClick={() => setSheet(false)} />
          <div className="ins-sheet">
            <div className="ins-sheet-head">
              <h3>{t('insurance.shell.alerts')}</h3>
              <button className="ins-btn ghost small" onClick={() => setSheet(false)}>{t('insurance.common.close')}</button>
            </div>
            {alerts.length === 0 && <div className="ins-ok neutral"><InsIconInfo /><span>{t('insurance.shell.noAlerts')}</span></div>}
            {alerts.map((a, i) => (
              <div className="ins-alert-item" key={i}>
                <span className={'ins-chip ' + (SEV_CHIP[a.sev] || 'INFO')}>{statusLabel(t, a.sev)}</span>
                <div style={{ minWidth: 0 }}>
                  <b>{a.title}</b>
                  <span className="body">{a.body}</span>
                </div>
              </div>
            ))}
            {events.length > 0 && (
              <>
                <div className="ins-sheet-head" style={{ marginTop: 12 }}>
                  <h3>{t('insurance.shell.recentEvents')}</h3>
                </div>
                {events.map((ev, i) => (
                  <div className="ins-alert-item" key={i}>
                    <span className="ins-event-time">{new Date(ev.at || ev.timestamp || Date.now()).toLocaleString()}</span>
                    <div style={{ minWidth: 0 }}><span className="body" style={{ color: 'var(--text-1)' }}>{ev.type || ev.message}</span></div>
                  </div>
                ))}
              </>
            )}
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
          <div className={'ins-toast ' + toast.type} key={toast.id} role="status">{toast.msg}</div>
        ))}
      </div>

      {/* server health strip */}
      <div className="ins-health">
        <span className={'ins-dot ' + (serverOk === true ? 'ok' : serverOk === false ? 'bad' : 'warn')} />
        <span>{t('insurance.shell.server')}: {serverOk === null ? t('insurance.shell.checking') : serverOk === true ? t('insurance.shell.serverOnline') : t('insurance.shell.serverOffline')}</span>
      </div>
    </div>
  );
}
