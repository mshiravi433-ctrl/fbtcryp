/**
 * FBT INTENT OS — OPERATIONS / HISTORY / STATUS PANELS.
 * ---------------------------------------------------------------------------
 * Presentational only (no network, no wallet): the parent IntentAIUnified owns
 * every real call and hands this file data + callbacks. No number shown here
 * is invented — every field arrives from a real engine, a real server read or
 * an honest UNAVAILABLE sentinel.
 */

import { useMemo, useState } from 'react';
import { CATEGORIES, OPERATIONS } from '../lib/intent-ai/os/opsCatalog.js';
/* The catalog's title/desc are English data literals; these translate them at
   render time without touching the routing fields the panel dispatches on. */
import { localizeOpsCard, localizeOpsCategory } from '../lib/intent-ai/os/opsCatalogI18n.js';
/* Line-art icons replacing the catalog's emoji — see OpsIcons.jsx for why. */
import { OpsCardIcon, OpsCategoryIcon } from './OpsIcons.jsx';
/*
 * Panel chrome in fa/en/ar. Replaces forty inline `locale === 'en' ? …` pairs
 * that were a two-way switch in a three-language app AND compared against a
 * bare 'en' while the live locale is 'en-US' — see opsPanelStrings.js.
 */
import { opsText, opsPhrase, intlLocale } from '../lib/intent-ai/os/opsPanelStrings.js';

/* ------------------------------------------------------------------------- */
/* helpers                                                                    */
/* ------------------------------------------------------------------------- */

const fmtNum = (v, digits = 2) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
};

export function statusPill(status, locale = 'fa') {
  const s = String(status || 'UNKNOWN').toUpperCase();
  const label = {
    ACTIVE: opsText('status.active', locale),
    PAUSED: opsText('status.paused', locale),
    TRIGGERED: opsText('status.triggered', locale),
    COMPLETED: opsText('status.completed', locale),
    CANCELLED: opsText('status.cancelled', locale),
    ERROR: opsText('status.error', locale),
    DRAFT: opsText('status.draft', locale),
    WAITING_CONFIRMATION: opsText('status.waiting', locale),
    EXECUTING: opsText('status.executing', locale),
    UNKNOWN: opsText('status.unknown', locale)
  }[s] || s;
  return { label, tone: ['TRIGGERED', 'EXECUTING'].includes(s) ? 'warn' : ['COMPLETED'].includes(s) ? 'ok' : ['ERROR', 'CANCELLED', 'FAILED'].includes(s) ? 'bad' : 'idle' };
}

/* ------------------------------------------------------------------------- */
/* Operations                                                                 */
/* ------------------------------------------------------------------------- */

export function OperationsPanel({
  open,
  onClose,
  availability,
  onAction,
  busy = false,
  locale = 'fa',
  summary = null
}) {
  const [cat, setCat] = useState('portfolio');
  /*
   * Localize at render, not in the catalog. `localizeOpsCard` returns a copy
   * with only title/desc swapped — `action`, `capabilityId`, `route` and
   * `requiresWallet` pass through untouched, so `onAction(card)` still
   * dispatches on exactly the same fields it always did and switching the
   * language cannot change what a button does.
   */
  const cards = useMemo(
    () => OPERATIONS.filter((c) => c.category === cat).map((c) => localizeOpsCard(c, locale)),
    [cat, locale]
  );

  if (!open) return null;

  /* Live wiring strip — the same four truths the Status panel shows, so the
     user sees at a glance that the center is actually connected: wallet,
     server, monitors, orders. Nothing here is invented; an unknown stays
     «checking», never a fake green dot. */
  const strip = summary ? [
    {
      id: 'wallet',
      label: opsText('st.wallet', locale),
      ok: summary.walletConnected === true,
      unknown: summary.walletConnected == null,
      value: summary.walletConnected
        ? opsText('status.connected', locale)
        : opsText('status.notConnected', locale)
    },
    {
      id: 'server',
      label: opsText('st.server', locale),
      ok: summary.serverReachable === true,
      unknown: summary.serverReachable == null,
      value: summary.serverReachable === false
        ? opsText('ops.unavailable', locale)
        : opsText('status.online', locale)
    },
    {
      id: 'monitors',
      label: opsText('st.monitors', locale),
      ok: (summary.monitorsActive ?? 0) > 0,
      unknown: summary.monitorsActive == null,
      value: `${summary.monitorsActive ?? 0}/${summary.monitorsTotal ?? 0}`
    },
    {
      id: 'orders',
      label: opsText('st.orders', locale),
      ok: null,
      unknown: false,
      value: String(summary.ordersCount ?? 0)
    }
  ] : null;

  return (
    <div className="iaos-panel-overlay" role="dialog" aria-modal="true" aria-label={opsText('ops.aria', locale)}>
      <div className="iaos-panel iaos-ops-panel">
        <div className="iaos-panel-head">
          <h2>{opsText('ops.title', locale)}</h2>
          <button type="button" className="iaos-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {strip ? (
          <div className="iaos-ops-strip" data-testid="ops-status-strip">
            {strip.map((c) => (
              <div key={c.id} className="iaos-ops-strip-cell" data-ok={c.unknown ? 'unknown' : c.ok ? 'true' : 'false'}>
                <i aria-hidden="true" />
                <div>
                  <small>{c.label}</small>
                  <strong>{c.value}</strong>
                </div>
              </div>
            ))}
          </div>
        ) : null}
        <div className="iaos-ops-cats" role="tablist">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={cat === c.id}
              className={`iaos-ops-cat${cat === c.id ? ' is-on' : ''}`}
              onClick={() => setCat(c.id)}
            >
              <OpsCategoryIcon category={c} />
              {localizeOpsCategory(c, locale)}
            </button>
          ))}
        </div>
        <div className="iaos-ops-grid">
          {cards.map((card) => {
            const avail = availability(card);
            return (
              <button
                key={card.id}
                type="button"
                className="iaos-ops-card"
                data-available={avail.available ? 'true' : 'false'}
                data-testid={`ops-card-${card.id}`}
                disabled={!avail.available || busy}
                onClick={() => onAction(card)}
              >
                <span className="iaos-ops-icon"><OpsCardIcon card={card} /></span>
                <span className="iaos-ops-body">
                  <strong>{card.title}</strong>
                  <small>{card.desc}</small>
                </span>
                <span className="iaos-ops-state">
                  {!avail.available
                    ? opsText(avail.reason === 'WALLET_REQUIRED' ? 'ops.walletNeeded' : 'ops.unavailable', locale)
                    : '↗'}
                </span>
              </button>
            );
          })}
        </div>
        <p className="iaos-panel-note">
          {opsText('ops.note', locale)}
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* History                                                                    */
/* ------------------------------------------------------------------------- */

export function HistoryPanel({
  open,
  onClose,
  history,
  monitors,
  seasons = [],
  onContinue,
  onMonitorAction,
  busy = false,
  locale = 'fa'
}) {
  const [tab, setTab] = useState('seasons');
  if (!open) return null;

  const conversations = history?.conversations || [];
  const operations = history?.operations || [];
  const activeMonitors = (monitors || []).filter((m) => ['ACTIVE', 'PAUSED', 'TRIGGERED'].includes(String(m.status || '').toUpperCase()));

  const L = {
    title: opsText('hist.title', locale),
    seasons: opsText('hist.seasons', locale),
    conversations: opsText('hist.conversations', locale),
    operations: opsText('hist.operations', locale),
    monitoring: opsText('hist.monitoring', locale),
    empty: opsText('hist.empty', locale),
    emptySeasons: opsText('hist.emptySeasons', locale),
    lastMessage: opsText('hist.lastMessage', locale),
    pause: opsText('monitor.pause', locale),
    resume: opsText('monitor.resume', locale),
    cancel: opsText('monitor.cancel', locale),
    evaluate: opsText('monitor.checkNow', locale),
    continue: opsText('hist.continue', locale),
    close: opsText('hist.close', locale)
  };

  return (
    <div className="iaos-panel-overlay" role="dialog" aria-modal="true" aria-label={L.title}>
      <div className="iaos-panel iaos-history-panel">
        <div className="iaos-panel-head">
          <h2>{L.title}</h2>
          <button type="button" className="iaos-close" onClick={onClose} aria-label={L.close}>✕</button>
        </div>
        <div className="iaos-history-tabs" role="tablist">
          {[
            { id: 'seasons', label: L.seasons, count: seasons.length },
            { id: 'conversations', label: L.conversations, count: conversations.length },
            { id: 'operations', label: L.operations, count: operations.length },
            { id: 'monitoring', label: L.monitoring, count: activeMonitors.length }
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`iaos-history-tab${tab === t.id ? ' is-on' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label} <b>{t.count}</b>
            </button>
          ))}
        </div>

        <div className="iaos-history-body" data-testid="intent-ai-history-body">
          {tab === 'seasons' && (
            seasons.length
              ? seasons.map((s) => (
                <div key={s.seasonId} className="iaos-history-row iaos-history-season" data-testid="intent-ai-season-row">
                  <div className="iaos-season-title-row">
                    <strong>{s.title || L.seasons}</strong>
                    <time>{new Date(s.lastAt || 0).toLocaleString(intlLocale(locale))}</time>
                  </div>
                  <small>{opsPhrase('messageCount', locale, s.messageCount || 0)}</small>
                  {s.lastMessage ? (
                    <p className="iaos-season-last"><span>{L.lastMessage}:</span> {s.lastMessage}</p>
                  ) : null}
                  <button
                    type="button"
                    className="iaos-history-continue iaos-season-continue"
                    onClick={() => onContinue({ ...s, kind: 'season' })}
                    disabled={busy}
                    data-testid="intent-ai-season-continue"
                  >
                    {L.continue} ↗
                  </button>
                </div>
              ))
              : <p className="iaos-empty">{L.emptySeasons}</p>
          )}
          {tab === 'conversations' && (
            conversations.length
              ? conversations.map((c) => (
                <div key={c.id} className={`iaos-history-row iaos-history-${c.role}`}>
                  <span className="iaos-history-who">{opsText(c.role === 'user' ? 'history.you' : 'history.ai', locale)}</span>
                  <p>{c.content}</p>
                  <time>{new Date(c.at || 0).toLocaleString(intlLocale(locale))}</time>
                </div>
              ))
              : <p className="iaos-empty">{L.empty}</p>
          )}
          {tab === 'operations' && (
            operations.length
              ? operations.map((o) => {
                const pill = statusPill(o.status, locale);
                return (
                  <div key={o.id} className="iaos-history-row iaos-history-op">
                    <strong>{o.title}</strong>
                    <small>{o.detail}</small>
                    <span className={`iaos-pill iaos-pill-${pill.tone}`}>{pill.label}</span>
                    <time>{new Date(o.at || 0).toLocaleString(intlLocale(locale))}</time>
                    <button type="button" className="iaos-history-continue" onClick={() => onContinue(o)} disabled={busy}>
                      {L.continue} ↗
                    </button>
                  </div>
                );
              })
              : <p className="iaos-empty">{L.empty}</p>
          )}
          {tab === 'monitoring' && (
            activeMonitors.length
              ? activeMonitors.map((m) => {
                const pill = statusPill(m.status, locale);
                return (
                  <div key={m.id} className="iaos-history-row iaos-history-monitor" data-testid="intent-ai-monitor-row">
                    <strong>{m.label || `${m.asset?.symbol || ''} ${m.metric}`}</strong>
                    <small>
                      {m.asset?.symbol || ''} · {m.metric} {m.operator} {fmtNum(m.threshold)}
                      {' · '}
                      {opsPhrase('everyMinutes', locale, m.intervalMinutes)}
                      {m.lastEvent ? ` · ${m.lastEvent.message}` : ''}
                    </small>
                    <span className={`iaos-pill iaos-pill-${pill.tone}`}>{pill.label}</span>
                    <div className="iaos-history-actions">
                      <button type="button" onClick={() => onMonitorAction(m, 'pause')} disabled={m.status !== 'ACTIVE'}>{L.pause}</button>
                      <button type="button" onClick={() => onMonitorAction(m, 'resume')} disabled={m.status !== 'PAUSED'}>{L.resume}</button>
                      {m.status === 'TRIGGERED' ? (
                        <button type="button" onClick={() => onMonitorAction(m, 'evaluate')}>{L.evaluate}</button>
                      ) : null}
                      <button type="button" className="iaos-danger" onClick={() => onMonitorAction(m, 'cancel')}>{L.cancel}</button>
                      <button type="button" onClick={() => onContinue(m)}>{L.continue} ↗</button>
                    </div>
                  </div>
                );
              })
              : <p className="iaos-empty">{L.empty}</p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Status                                                                     */
/* ------------------------------------------------------------------------- */

export function StatusPanel({ open, onClose, status, locale = 'fa' }) {
  if (!open) return null;
  const L = {
    title: opsText('st.title', locale),
    wallet: opsText('st.wallet', locale),
    server: opsText('st.server', locale),
    monitors: opsText('st.monitors', locale),
    orders: opsText('st.orders', locale),
    automations: opsText('st.automations', locale),
    engine: opsText('st.engine', locale),
    cron: opsText('st.cron', locale)
  };

  const Cell = ({ label, value, ok }) => (
    <div className="iaos-status-cell">
      <span>{label}</span>
      <strong data-ok={ok === undefined ? 'true' : String(ok)}>{value}</strong>
    </div>
  );

  /* Wiring report — every row is a REAL probe result the parent already
     fetched: the server tool registry, the model fleet and the store mode.
     This is the «is the AI actually connected to everything» answer, not a
     status lamp that is green because nobody checked it. */
  const aiTools = status?.aiTools || null;
  const isEn = String(locale || 'fa').startsWith('en');
  const wiringLabel = isEn ? 'AI tools (server registry)' : 'ابزارهای متصل به هوش مصنوعی';
  const wiringValue = aiTools
    ? (aiTools.online ? `${aiTools.count} ✓` : `${aiTools.count} · ${opsText('ops.unavailable', locale)}`)
    : '…';
  const providersLabel = isEn ? 'AI models configured (not health-checked)' : 'مدل‌های پیکربندی‌شده (بدون آزمون سلامت)';
  // No floor: zero or an unavailable gateway is a real status, not four models.
  const providersValue = status?.providersTotal == null
    ? (isEn ? 'unavailable' : 'نامشخص')
    : `${status.providersActive ?? 0}/${status.providersTotal}`;

  return (
    <div className="iaos-panel-overlay" role="dialog" aria-modal="true" aria-label={L.title}>
      <div className="iaos-panel iaos-status-panel">
        <div className="iaos-panel-head">
          <h2>{L.title}</h2>
          <button type="button" className="iaos-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="iaos-status-grid">
          <Cell label={wiringLabel} value={wiringValue} ok={Boolean(aiTools?.online)} />
          <Cell label={providersLabel} value={providersValue} />
          <Cell label={L.wallet} value={opsText(status?.walletConnected ? 'status.connected' : 'status.notConnected', locale)} ok={status?.walletConnected} />
          <Cell label={L.server} value={opsText(status?.serverReachable ? 'status.online' : 'ops.unavailable', locale)} ok={status?.serverReachable} />
          <Cell
            label={L.monitors}
            value={opsPhrase('monitorCount', locale, status?.monitors?.active ?? 0, status?.monitors?.total ?? 0)}
          />
          <Cell label={L.orders} value={status?.ordersCount ?? 0} />
          <Cell label={L.automations} value={status?.automationsCount ?? 0} />
          <Cell label={L.engine} value={opsText(status?.engine?.durable ? 'status.durableStore' : 'status.memoryStore', locale)} />
          <Cell label={L.cron} value={opsText(status?.engine?.cronSecretSet ? 'status.configured' : 'status.notConfigured', locale)} />
        </div>
        <p className="iaos-panel-note">
          {opsText('status.note', locale)}
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Monitor draft form                                                         */
/* ------------------------------------------------------------------------- */

const MONITOR_ASSETS = ['BTC', 'ETH', 'SOL', 'BNB', 'ARB', 'AVAX', 'LINK', 'USDT'];

export function MonitorDraftForm({ open, onClose, onCreate, initial = null, busy = false, locale = 'fa' }) {
  const [asset, setAsset] = useState(initial?.asset?.symbol || (initial?.asset || 'BTC'));
  const [metric, setMetric] = useState(initial?.metric || 'PRICE');
  const [operator, setOperator] = useState(initial?.operator || 'ABOVE');
  const [threshold, setThreshold] = useState(initial?.threshold ?? '');
  const [intervalMinutes, setIntervalMinutes] = useState(initial?.intervalMinutes || 60);

  if (!open) return null;
  const L = {
    title: opsText('mon.title', locale),
    asset: opsText('mon.asset', locale),
    metric: opsText('mon.metric', locale),
    operator: opsText('mon.operator', locale),
    threshold: opsText('mon.threshold', locale),
    interval: opsText('mon.interval', locale),
    create: opsText('mon.create', locale),
    cancel: opsText('mon.cancel', locale),
    note: opsText('mon.note', locale)
  };

  const submit = (e) => {
    e.preventDefault();
    const t = Number(String(threshold).replace(/[kK,]/g, ''));
    if (!asset || !Number.isFinite(t) || t <= 0) return;
    onCreate({
      type: 'ASSET',
      asset: { symbol: asset },
      metric,
      operator,
      threshold: metric === 'PERCENT_CHANGE' ? t : t,
      intervalMinutes
    });
  };

  return (
    <div className="iaos-panel-overlay" role="dialog" aria-modal="true" aria-label={L.title}>
      <form className="iaos-panel iaos-form-panel" onSubmit={submit}>
        <div className="iaos-panel-head">
          <h2>{L.title}</h2>
          <button type="button" className="iaos-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <label className="iaos-field">
          <span>{L.asset}</span>
          <select value={asset} onChange={(e) => setAsset(e.target.value)}>
            {MONITOR_ASSETS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label className="iaos-field">
          <span>{L.metric}</span>
          <select value={metric} onChange={(e) => setMetric(e.target.value)}>
            <option value="PRICE">PRICE (USD)</option>
            <option value="PERCENT_CHANGE">% CHANGE</option>
          </select>
        </label>
        <label className="iaos-field">
          <span>{L.operator}</span>
          <select value={operator} onChange={(e) => setOperator(e.target.value)}>
            <option value="ABOVE">≥</option>
            <option value="BELOW">≤</option>
          </select>
        </label>
        <label className="iaos-field">
          <span>{L.threshold}</span>
          <input value={threshold} onChange={(e) => setThreshold(e.target.value)} inputMode="decimal" placeholder={metric === 'PERCENT_CHANGE' ? '5' : '100000'} />
        </label>
        <label className="iaos-field">
          <span>{L.interval}</span>
          <select value={intervalMinutes} onChange={(e) => setIntervalMinutes(Number(e.target.value))}>
            {[15, 30, 60, 360, 720, 1440].map((m) => <option key={m} value={m}>{m} min</option>)}
          </select>
        </label>
        <div className="iaos-panel-actions">
          <button type="submit" className="iaos-btn iss-solid" disabled={busy}>{busy ? '…' : L.create}</button>
          <button type="button" className="iaos-btn iss-ghost" onClick={onClose}>{L.cancel}</button>
        </div>
        <p className="iaos-panel-note">{L.note}</p>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Conditional buy draft form                                                 */
/* ------------------------------------------------------------------------- */

export function OrderDraftForm({ open, onClose, onCreate, initial = null, busy = false, locale = 'fa' }) {
  const [asset, setAsset] = useState(initial?.asset || 'BTC');
  const [target, setTarget] = useState(initial?.target ?? '');
  const [amount, setAmount] = useState(initial?.amount ?? '100');

  if (!open) return null;
  const L = {
    title: opsText('ord.title', locale),
    asset: opsText('ord.asset', locale),
    target: opsText('ord.target', locale),
    amount: opsText('ord.amount', locale),
    create: opsText('ord.create', locale),
    cancel: opsText('ord.cancel', locale),
    note: opsText('ord.note', locale)
  };

  const submit = (e) => {
    e.preventDefault();
    const t = Number(String(target).replace(/[kK,]/g, ''));
    const a = Number(String(amount).replace(/[kK,]/g, ''));
    if (!asset || !Number.isFinite(t) || t <= 0 || !Number.isFinite(a) || a <= 0) return;
    onCreate({ asset, operator: 'BELOW', target: t, amount: a });
  };

  return (
    <div className="iaos-panel-overlay" role="dialog" aria-modal="true" aria-label={L.title}>
      <form className="iaos-panel iaos-form-panel" onSubmit={submit}>
        <div className="iaos-panel-head">
          <h2>{L.title}</h2>
          <button type="button" className="iaos-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <label className="iaos-field">
          <span>{L.asset}</span>
          <select value={asset} onChange={(e) => setAsset(e.target.value)}>
            <option value="BTC">BTC</option>
            <option value="ETH">ETH</option>
            <option value="BNB">BNB</option>
            <option value="ARB">ARB</option>
            <option value="LINK">LINK</option>
            <option value="DOGE">DOGE</option>
          </select>
        </label>
        <label className="iaos-field">
          <span>{L.target}</span>
          <input value={target} onChange={(e) => setTarget(e.target.value)} inputMode="decimal" placeholder="100000" />
        </label>
        <label className="iaos-field">
          <span>{L.amount}</span>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="100" />
        </label>
        <div className="iaos-panel-actions">
          <button type="submit" className="iaos-btn iss-solid" disabled={busy}>{busy ? '…' : L.create}</button>
          <button type="button" className="iaos-btn iss-ghost" onClick={onClose}>{L.cancel}</button>
        </div>
        <p className="iaos-panel-note">{L.note}</p>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Chat card renderers                                                        */
/* ------------------------------------------------------------------------- */

export function MonitorCard({ monitor, onAction, locale = 'fa' }) {
  const pill = statusPill(monitor?.status, locale);
  return (
    <div className="iaos-monitor-card" data-testid="intent-ai-monitor-card">
      <div className="iaos-monitor-card-head">
        <strong>{monitor?.label || `${monitor?.asset?.symbol || ''} ${monitor?.metric || ''}`}</strong>
        <span className={`iaos-pill iaos-pill-${pill.tone}`}>{pill.label}</span>
      </div>
      <div className="iaos-monitor-card-body">
        <span>{monitor?.asset?.symbol || '—'} · {monitor?.metric} {monitor?.operator} {fmtNum(monitor?.threshold)}</span>
        {monitor?.lastEvent ? <small>⏱ {monitor.lastEvent.message}</small> : null}
        {monitor?.lastCheckAt ? <small>{opsText('monitor.checked', locale)}: {new Date(monitor.lastCheckAt).toLocaleString(intlLocale(locale))}</small> : null}
      </div>
      <div className="iaos-monitor-card-actions">
        {monitor?.status === 'ACTIVE' ? <button type="button" onClick={() => onAction(monitor, 'pause')}>{opsText('monitor.pause', locale)}</button> : null}
        {monitor?.status === 'PAUSED' ? <button type="button" onClick={() => onAction(monitor, 'resume')}>{opsText('monitor.resume', locale)}</button> : null}
        <button type="button" onClick={() => onAction(monitor, 'evaluate')}>{opsText('monitor.checkNow', locale)}</button>
        <button type="button" className="iaos-danger" onClick={() => onAction(monitor, 'cancel')}>{opsText('monitor.cancel', locale)}</button>
      </div>
    </div>
  );
}

export function OpportunityList({ rows, onMonitor, goal = null, locale = 'fa' }) {
  if (!Array.isArray(rows) || !rows.length) {
    return <div className="iaos-opp-empty">{opsText('opp.none', locale)}</div>;
  }
  const top = rows.slice(0, 5);
  return (
    <div className="iaos-opp-list" data-testid="intent-ai-opportunities">
      {goal ? (
        <div className="iaos-opp-goal">
          {opsPhrase('goalEstimate', locale, fmtNum(goal?.targetReturnPct))}
        </div>
      ) : null}
      {top.map((o) => (
        <div key={o.id} className="iaos-opp-row">
          <strong>{o.symbol || o.name} <small>{o.kind}</small></strong>
          <span>
            {o.expectedReturnPct != null ? `${fmtNum(o.expectedReturnPct, 1)}%` : '—'}
            <small>{o.basis === 'apy' ? (String(locale || '').startsWith('fa') ? 'بازدهی سالانه (APY)' : 'APY') : '7d/2'}</small>
          </span>
          <span className="iaos-opp-meta">
            {o.probabilityPct != null ? `${opsText('opp.histRate', locale)} ${fmtNum(o.probabilityPct, 0)}%` : '—'}
            {o.potentialDrawdownPct != null ? ` · DD ${fmtNum(o.potentialDrawdownPct, 0)}%` : ''}
          </span>
          <span className={`iaos-pill iaos-pill-${o.risk === 'high' ? 'bad' : o.risk === 'medium' ? 'warn' : 'ok'}`}>{o.risk.toUpperCase()}</span>
          <button type="button" className="iaos-opp-monitor" onClick={() => onMonitor(o)}>{opsText('opp.monitor', locale)}</button>
        </div>
      ))}
      <p className="iaos-opp-disclaimer">
        {opsText('opp.note', locale)}
      </p>
    </div>
  );
}

export function OrderCard({ order, locale = 'fa' }) {
  return (
    <div className="iaos-order-card" data-testid="intent-ai-order-card">
      <strong>{order?.toToken?.symbol || order?.toSymbol || '?'} {opsText('order.conditionalBuy', locale)}</strong>
      <span>{order?.targetRate != null ? `${order.direction === 'above' ? '≥' : '≤'} ${fmtNum(order.targetRate, 0)} USD` : ''}</span>
      <small>{order?.amountIn} {order?.fromToken?.symbol || order?.fromSymbol || 'USDT'} · /orders</small>
      <span className="iaos-pill iaos-pill-ok">{opsText('order.stored', locale)}</span>
    </div>
  );
}

/*
 * ─── «CONFIGURED» IS NOT «WORKING», AND THE PANEL NOW SAYS WHICH ───────────
 * The reported failure was nine green cards over a fleet where one model could
 * answer: every key was saved in the host environment, and eight of the nine
 * providers still refused the call — a retired model id (Groq
 * llama-3.3-70b-versatile, shut down 2026-08-16; Gemini gemini-2.0-flash), a
 * paid model on a free tier (Mistral), an empty credit balance (Anthropic,
 * DeepSeek, AIMLAPI) and a malformed Cloudflare run URL (ours).
 *
 * So each card carries the gateway's VERDICT — what happened the last time that
 * provider was actually called — next to the presence of its key, with the
 * reason in the user's language and the server's own fix line under it.
 */
const VERDICT_COPY = {
  NEEDS_KEY: { fa: 'نیازمند کلید', en: 'Needs key' },
  HEALTHY: { fa: 'پاسخ داد', en: 'Answered' },
  UNTESTED: { fa: 'کلید دارد · آزموده‌نشده', en: 'Key present · untested' },
  MODEL_UNAVAILABLE: { fa: 'مدل از رده خارج است', en: 'Model retired' },
  MODEL_TIER: { fa: 'مدل بالاتر از سطح اشتراک', en: 'Model above plan tier' },
  AUTH: { fa: 'کلید رد شد', en: 'Key rejected' },
  BILLING: { fa: 'اعتبار حساب تمام شده', en: 'Account has no credit' },
  PERMISSION: { fa: 'اجازهٔ این درخواست را ندارد', en: 'Not permitted' },
  QUOTA: { fa: 'سهمیه یا نرخ محدود شده', en: 'Rate limited / quota' },
  CF_ACCOUNT: { fa: 'شناسهٔ حساب کلادفلر اشتباه است', en: 'Bad Cloudflare account id' },
  TIMEOUT: { fa: 'در مهلت مقرر پاسخ نداد', en: 'Timed out' },
  NETWORK: { fa: 'مسیر شبکه به ارائه‌دهنده بسته است', en: 'Network path failed' },
  EMPTY: { fa: 'پاسخ خالی یا مسدود شد', en: 'Empty / blocked reply' },
  ANTHROPIC_SAMPLING: { fa: 'پارامترهای نمونه‌گیری رد شد', en: 'Sampling parameters rejected' },
  ALL_PROVIDERS_FAILED: { fa: 'هیچ ارائه‌دهنده‌ای پاسخ نداد', en: 'No provider answered' },
  UNKNOWN: { fa: 'خطا', en: 'Error' }
};

/** `verdict` arrives as 'HEALTHY' | 'UNTESTED' | 'NEEDS_KEY' | 'ERROR:<CODE>'. */
function verdictParts(verdict, isEn) {
  const raw = String(verdict || '').trim();
  const code = raw.startsWith('ERROR:') ? raw.slice(6) : raw;
  const copy = VERDICT_COPY[code] || VERDICT_COPY.UNKNOWN;
  return {
    code,
    isError: raw.startsWith('ERROR:'),
    label: isEn ? copy.en : copy.fa
  };
}

export function IntelligencePanel({
  open,
  onClose,
  providers = [],
  learningStats = null,
  locale = 'fa',
  providersStatus = 'ready',
  providersError = null,
  onRetryProviders = null,
  onSpawnAgent = null,
  /* Fleet summary + live self-test, both produced by the gateway. The parent
     owns the calls; this file stays presentational. */
  fleetSummary = null,
  selfTest = null,
  selfTestBusy = false,
  selfTestError = null,
  onRunSelfTest = null
}) {
  const [tab, setTab] = useState('models');
  const isEn = locale?.startsWith?.('en');

  if (!open) return null;

  /*
   * ─── THE WHOLE FLEET IS SHOWN, NOT ONLY THE CONFIGURED SLICE ─────────────
   * This used to be `(providers || []).filter((p) => p.configured)` and the
   * tab title counted that filtered list. On a deployment with no provider
   * keys the result was a tab reading «مدل‌های فعال (۰)» above the message
   * «no provider is configured» — eight registered models simply not there.
   * The user reads that as «مدل‌های هوش مصنوعی دیگه نیستن».
   *
   * They are registered and they are wired; they are waiting on a key. So the
   * grid now lists every model the gateway knows, each with its real state:
   *   · ACTIVE     — a key is present, this model answers traffic
   *   · NEEDS_KEY  — registered, and the card names the env var that turns it
   *                  on, so the operator can act instead of guessing
   * The count in the tab is the fleet size, with the serving subset next to
   * it, so neither number is ever a bare 0 by omission.
   */
  const fleet = Array.isArray(providers) ? providers : [];
  const selfTestById = new Map(
    (selfTest && Array.isArray(selfTest.providers) ? selfTest.providers : []).map((r) => [r.id, r])
  );
  const activeProviders = fleet.filter((p) => p.configured || p.status === 'ACTIVE');
  const pendingProviders = fleet.filter((p) => !p.configured && p.status !== 'ACTIVE');
  /*
   * ─── "STILL READING" IS NOT "THE GATEWAY DID NOT ANSWER" ────────────────
   * `providers` arrives over the network after the panel is already on
   * screen, so it starts empty. The grid used to read that empty array as a
   * verdict and printed «گیت‌وی پاسخ نداد» over a tab reading
   * «مدل‌های هوش مصنوعی (0)» — for every single open, in the ~200ms before
   * the answer landed, and permanently if the one read was throttled. A user
   * who tapped the button during that window was told, confidently, that the
   * fleet was empty and the gateway was down. It was neither; it was late.
   *
   * Three distinct states now: still reading (no count, no verdict), read and
   * failed (the honest message, plus a retry), read and answered (the fleet).
   * A fleet that was already loaded is never blanked by a later failed
   * refresh — a stale-but-real list beats a fabricated outage.
   */
  const loadingFleet = fleet.length === 0 && (providersStatus === 'loading' || providersStatus === 'idle');
  /*
   * Anything that is not "still reading" and has no rows is a gap worth
   * naming — a failed read, or a caller that simply never supplied a fleet
   * (the default props). Both get the same honest sentence; only the first
   * has a reason to print next to it.
   */
  const fleetMissing = fleet.length === 0 && !loadingFleet;
  const fleetLabel = isEn
    ? (loadingFleet ? 'AI Models…' : `AI Models (${fleet.length})`)
    : (loadingFleet ? 'مدل‌های هوش مصنوعی…' : `مدل‌های هوش مصنوعی (${fleet.length})`);

  const agentFleet = [
    { id: 'intent-agent', name: isEn ? 'Intent Agent' : 'ایجنت درک قصد (Intent)', role: isEn ? 'Natural language parameter extraction & clarification' : 'استخراج سرمایه، افق زمانی، هدف و طرح سؤالات شفاف‌ساز' },
    { id: 'market-agent', name: isEn ? 'Market Agent' : 'ایجنت هوش بازار (Market)', role: isEn ? 'Live price feeds, volume, trends & sentiment' : 'داده‌های لحظه‌ای قیمت، حجم، روندهای تکنیکال و جریانات کلان' },
    { id: 'portfolio-agent', name: isEn ? 'Portfolio Agent' : 'ایجنت پرتفوی (Portfolio)', role: isEn ? 'Multi-chain balances, positions, allocations' : 'ارزیابی دارایی‌ها، تخصیص سبد و پوزیشن‌های چندزنجیره‌ای' },
    { id: 'risk-agent', name: isEn ? 'Risk Agent' : 'ایجنت ریسک و سنجش (Risk)', role: isEn ? 'Drawdown calculations, concentration, liquidation' : 'محاسبه ریسک افت سرمایه، تمرکز دارایی و فاصله لیکوئیدیشن' },
    { id: 'strategy-agent', name: isEn ? 'Strategy Agent' : 'ایجنت استراتژی (Strategy)', role: isEn ? 'Candidate strategies, APY projections & ranking' : 'فرموله‌سازی راهبردهای بهینه معاملاتی و رتبه‌بندی بازده' },
    { id: 'guardian-agent', name: isEn ? 'Guardian Agent' : 'ایجنت گاردین و امنیت (Guardian)', role: isEn ? 'Policy enforcement, hard limits, injection defense' : 'بررسی سیاست‌های امنیتی، سقف‌های تراکنش و جلوگیری از نشت اطلاعات' },
    { id: 'execution-agent', name: isEn ? 'Execution Agent' : 'ایجنت اجرا (Execution)', role: isEn ? 'Action path staging, calldata preparation' : 'آماده‌سازی مسیر اجرای امن و آماده‌سازی برای امضای کاربر' },
    { id: 'verification-agent', name: isEn ? 'Verification Agent' : 'ایجنت اعتبارسنجی (Verification)', role: isEn ? 'Pre-sim & post-execution on-chain confirmation' : 'شبیه‌سازی تراکنش و تطبیق خروجی با رسید واقعی بلاکچین' }
  ];

  return (
    <div className="iaos-panel-overlay" role="dialog" aria-modal="true" aria-label={isEn ? 'AI Intelligence' : 'هوش مصنوعی چندمدلی'}>
      <div className="iaos-panel" data-testid="intent-ai-intelligence-panel">
        <div className="iaos-panel-head">
          <div>
            <h2>{isEn ? 'Multi-AI Intelligence & Consensus' : 'هوش مصنوعی چندمدلی و موتور اجماع'}</h2>
            <small>{isEn ? 'Decentralized Intelligence Layer (OpenRouter, Groq, Gemini, Anthropic & Internal)' : 'لایه مرکزی هوش مالی بدون وابستگی به یک مدل'}</small>
          </div>
          <button type="button" className="iaos-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/*
          * `is-on` is the class the stylesheet actually styles — these four
          * used `active`, which matches no rule, so the open tab looked
          * identical to the closed ones.
          */}
        <div className="iaos-history-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'models'} data-testid="intel-tab-models" className={`iaos-history-tab${tab === 'models' ? ' is-on' : ''}`} onClick={() => setTab('models')}>
            {fleetLabel}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'agents'} data-testid="intel-tab-agents" className={`iaos-history-tab${tab === 'agents' ? ' is-on' : ''}`} onClick={() => setTab('agents')}>
            {isEn ? 'Agent Fleet' : 'ناوگان ایجنت‌ها'}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'consensus'} data-testid="intel-tab-consensus" className={`iaos-history-tab${tab === 'consensus' ? ' is-on' : ''}`} onClick={() => setTab('consensus')}>
            {isEn ? 'Consensus & Risk' : 'موتور اجماع و ریسک'}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'learning'} data-testid="intel-tab-learning" className={`iaos-history-tab${tab === 'learning' ? ' is-on' : ''}`} onClick={() => setTab('learning')}>
            {isEn ? 'Learning Loop' : 'چرخه یادگیری'}
          </button>
        </div>

        <div className="iaos-panel-scroll">
          {tab === 'models' ? (
            <div className="iaos-intel-grid">
              {/*
               * The fleet in one line, and the button that proves it.
               * `fleetSummary` is what the gateway already knows from real
               * traffic (free to read); the self-test goes and asks every
               * provider for real, which is why it is a button and not an
               * effect — it spends a tiny amount of quota per model.
               */}
              {fleetSummary || typeof onRunSelfTest === 'function' ? (
                <div className="iaos-intel-summary" data-testid="intel-fleet-summary">
                  {fleetSummary ? (
                    <p dir={isEn ? 'ltr' : 'rtl'} data-testid="intel-fleet-counts">
                      {isEn
                        ? `${fleetSummary.configured ?? 0} of ${fleetSummary.total ?? 0} models hold a key · ${fleetSummary.healthy ?? 0} answered · ${fleetSummary.failing ?? 0} refused`
                        : `${fleetSummary.configured ?? 0} از ${fleetSummary.total ?? 0} مدل کلید دارند · ${fleetSummary.healthy ?? 0} پاسخ داد · ${fleetSummary.failing ?? 0} خطا داد`}
                      {Array.isArray(fleetSummary.needsKey) && fleetSummary.needsKey.length ? (
                        <span className="iaos-intel-note" dir="ltr"> · {fleetSummary.needsKey.join(', ')}</span>
                      ) : null}
                    </p>
                  ) : null}
                  {typeof onRunSelfTest === 'function' ? (
                    <button
                      type="button"
                      className="iaos-btn"
                      data-testid="intel-fleet-selftest"
                      onClick={onRunSelfTest}
                      disabled={Boolean(selfTestBusy)}
                    >
                      {selfTestBusy
                        ? (isEn ? 'Testing every model…' : 'در حال آزمون هر مدل…')
                        : (isEn ? 'Run a live test of every model' : 'آزمون زندهٔ همهٔ مدل‌ها')}
                    </button>
                  ) : null}
                  {selfTestError ? (
                    <p className="iaos-empty" data-testid="intel-fleet-selftest-error">
                      {isEn
                        ? `The live test did not complete (${selfTestError}). The verdicts below are from real traffic already served.`
                        : `آزمون زنده کامل نشد (${selfTestError}). وضعیت‌های پایین از ترافیک واقعیِ پاسخ‌داده‌شده آمده است.`}
                    </p>
                  ) : null}
                  {selfTest?.summary ? (
                    <p className="iaos-intel-note" data-testid="intel-fleet-selftest-summary" dir={isEn ? 'ltr' : 'rtl'}>
                      {isEn
                        ? `Live test: ${selfTest.summary.usableExternalModels ?? 0} external model(s) answered in ${selfTest.durationMs ?? 0} ms.`
                        : `آزمون زنده: ${selfTest.summary.usableExternalModels ?? 0} مدل بیرونی در ${selfTest.durationMs ?? 0} میلی‌ثانیه پاسخ داد.`}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {/*
               * ─── WHY THE PENDING MODELS ARE RENDERED, NOT HIDDEN ────────
               * The earlier version of this grid hard-coded `configured: true`
               * for five providers, so an install with no keys at all claimed
               * Grok, OpenRouter, Groq and Gemini were «Active». That was a
               * lie and it was removed — but the replacement went too far the
               * other way and rendered NOTHING unless a key existed, which is
               * how the fleet came to look empty.
               *
               * This is the honest middle: every registered model is listed
               * with the state the gateway actually reports. A model that
               * cannot answer says so, and names the variable that lets it.
               */}
              {fleet.map((p) => {
                const live = Boolean(p.configured) || p.status === 'ACTIVE';
                /* A fresh self-test result outranks the remembered verdict: it
                   is the same question, asked a second ago. */
                const probe = selfTestById.get(p.id) || null;
                const verdict = probe
                  ? (probe.status === 'HEALTHY' ? 'HEALTHY' : probe.status === 'ERROR' ? `ERROR:${probe.reasonCode || 'UNKNOWN'}` : 'NEEDS_KEY')
                  : (p.verdict || (live ? 'UNTESTED' : 'NEEDS_KEY'));
                const v = verdictParts(verdict, isEn);
                const reason = probe?.reasonCode || p.health?.lastError?.reasonCode || null;
                const detail = probe?.error || p.health?.lastError?.message || null;
                const fix = probe?.fix || p.health?.lastError?.fix || null;
                const answeredModel = probe?.model || p.health?.lastSuccess?.model || p.defaultModel;
                const latency = probe?.latencyMs ?? (p.health?.lastSuccess?.durationMs ?? null);
                const pillClass = v.isError ? 'iaos-pill-warn' : (verdict === 'HEALTHY' ? 'iaos-pill-ok' : (live ? 'iaos-pill-ok' : 'iaos-pill-warn'));
                return (
                  <div
                    key={p.id}
                    className="iaos-intel-card"
                    data-testid={`intel-provider-${p.id}`}
                    data-live={live ? 'true' : 'false'}
                    data-verdict={verdict}
                  >
                    <div className="iaos-intel-card-head">
                      <strong>{p.name}</strong>
                      <span className={`iaos-pill ${pillClass}`} data-testid={`intel-verdict-${p.id}`}>{v.label}</span>
                    </div>
                    <p>{p.specialty || p.role}</p>
                    <small>{isEn ? 'Cost / Latency:' : 'سطح هزینه / تأخیر:'} {p.costTier || 'standard'}</small>
                    {answeredModel ? (
                      <small dir="ltr" data-testid={`intel-model-${p.id}`}>
                        {isEn ? 'Model: ' : 'مدل: '}<code>{answeredModel}</code>
                        {latency != null ? ` · ${latency}ms` : ''}
                      </small>
                    ) : null}
                    {/* What would be tried next. A retired id is only fatal if
                        nothing stands behind it — the gateway walks this list. */}
                    {Array.isArray(p.modelCandidates) && p.modelCandidates.length > 1 ? (
                      <small className="iaos-intel-note" dir="ltr">
                        {isEn ? 'Next if it refuses: ' : 'در صورت رد: '}<code>{p.modelCandidates.slice(1).join(' → ')}</code>
                      </small>
                    ) : null}
                    {!live && p.envVar ? (
                      <small className="iaos-intel-env" dir="ltr">
                        {isEn ? 'Enable with ' : 'فعال‌سازی با '}<code>{p.envVar}</code>
                      </small>
                    ) : null}
                    {/* The key is present but the stored copy carries quotes or
                        newlines. The gateway cleans it before sending; saying so
                        stops the next person pasting it into another tool raw. */}
                    {live && p.keyDirtyInEnv ? (
                      <small className="iaos-intel-env" data-testid={`intel-dirty-${p.id}`}>
                        {isEn
                          ? `The stored ${p.keySourceEnv || p.envVar} carries stray spaces or quotes — cleaned before use.`
                          : `مقدار ذخیره‌شدهٔ ${p.keySourceEnv || p.envVar} فاصله یا کوتیشن اضافی دارد — پیش از ارسال تمیز می‌شود.`}
                      </small>
                    ) : null}
                    {v.isError ? (
                      <small className="iaos-intel-env" data-testid={`intel-reason-${p.id}`}>
                        <strong>{isEn ? 'Why it refused: ' : 'دلیل رد: '}</strong>
                        {verdictParts(`ERROR:${reason || 'UNKNOWN'}`, isEn).label}
                        {fix ? <span dir={isEn ? 'ltr' : 'rtl'}> — {fix}</span> : null}
                        {detail ? <span className="iaos-intel-note" dir="ltr"> ({String(detail).slice(0, 120)})</span> : null}
                      </small>
                    ) : null}
                  </div>
                );
              })}
              {loadingFleet ? (
                <p className="iaos-empty" data-testid="intel-fleet-loading" role="status" aria-live="polite">
                  {isEn
                    ? 'Reading the model list from the gateway…'
                    : 'در حال خواندن فهرست مدل‌ها از گیت‌وی…'}
                </p>
              ) : null}
              {fleetMissing ? (
                <div className="iaos-empty" data-testid="intel-fleet-error">
                  <p>
                    {isEn
                      ? `The gateway did not answer${providersError ? ` (${providersError})` : ''}, so the fleet cannot be listed. The assistant still works: intent parsing, routing and every live data read run locally and on the app’s own services.`
                      : `گیت‌وی پاسخ نداد${providersError ? ` (${providersError})` : ''}، بنابراین فهرست مدل‌ها قابل نمایش نیست. دستیار همچنان کار می‌کند: درک قصد، مسیریابی و همه‌ی خواندن‌های داده‌ی زنده به‌صورت محلی و روی سرویس‌های خود اپ اجرا می‌شوند.`}
                  </p>
                  {typeof onRetryProviders === 'function' ? (
                    <button type="button" className="iaos-btn" data-testid="intel-fleet-retry" onClick={onRetryProviders}>
                      {isEn ? 'Try again' : 'تلاش دوباره'}
                    </button>
                  ) : null}
                </div>
              ) : null}
              {fleet.length && !activeProviders.length ? (
                <p className="iaos-empty" data-testid="intel-fleet-no-keys">
                  {isEn
                    ? `The FBT internal engine is serving every turn. ${pendingProviders.length} external model${pendingProviders.length === 1 ? '' : 's'} ${pendingProviders.length === 1 ? 'is' : 'are'} registered and ready — set the key named on each card to bring ${pendingProviders.length === 1 ? 'it' : 'them'} into the consensus alongside it.`
                    : `موتور داخلی FBT هم‌اکنون همه‌ی پاسخ‌ها را تولید می‌کند. ${pendingProviders.length} مدل بیرونی ثبت و آماده است — کلید نام‌برده روی هر کارت را تنظیم کنید تا در کنار موتور داخلی وارد موتور اجماع شود.`}
                </p>
              ) : null}
            </div>
          ) : null}

          {tab === 'agents' ? (
            <div className="iaos-intel-grid">
              {agentFleet.map((a) => (
                <div key={a.id} className="iaos-intel-card">
                  <div className="iaos-intel-card-head">
                    <strong>{a.name}</strong>
                    <span className="iaos-pill">{isEn ? 'Built-in role' : 'نقش داخلی'}</span>
                  </div>
                  <p>{a.role}</p>
                  <small>{isEn ? 'Authority: Read & Plan only — Signing requires user wallet' : 'اختیارات: تحلیل و برنامه‌ریزی — امضا منحصراً با تأیید کاربر'}</small>
                  {onSpawnAgent ? (
                    <button
                      type="button"
                      className="iaos-btn iss-ghost iaos-intel-spawn"
                      onClick={() => onSpawnAgent(a.id)}
                      data-testid={`intel-spawn-${a.id}`}
                    >
                      {isEn ? '✦ Build this agent' : '✦ ساخت این ایجنت'}
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {tab === 'consensus' ? (
            <div className="iaos-consensus-info">
              <div className="iaos-status-cell">
                <strong>{isEn ? 'AI Debate Architecture' : 'معماری مناظره و اجماع چندمدلی'}</strong>
                <p>
                  {isEn
                    ? 'The internal strategy engine compares live-sourced options. External models join only when configured and actually invoked; a configured key is not a health check or proof of consensus.'
                    : 'موتور داخلی گزینه‌های دارای داده زنده را مقایسه می‌کند. مدل بیرونی فقط در صورت پیکربندی و فراخوانی واقعی شرکت دارد؛ داشتن کلید به معنی سلامت یا اجماعِ انجام‌شده نیست.'}
                </p>
              </div>
              <div className="iaos-status-cell">
                <strong>{isEn ? 'Live Data Grounding Rule' : 'اصل عدم حدس قیمت و موجودی'}</strong>
                <p>
                  {isEn
                    ? 'Strategies use live-sourced market and yield observations and report missing reads. Some market screens have labelled offline snapshots; the strategy engine excludes those from tradable recommendations.'
                    : 'استراتژی‌ها از خوانش زنده بازار و نرخ استفاده می‌کنند و شکاف‌ها را نشان می‌دهند. بعضی صفحه‌های بازار snapshot آفلاینِ برچسب‌دار دارند؛ موتور استراتژی آن‌ها را به‌عنوان فرصت معاملاتی نمی‌پذیرد.'}
                </p>
              </div>
            </div>
          ) : null}

          {tab === 'learning' ? (
            /*
             * ─── THESE NUMBERS USED TO BE INVENTED ──────────────────────────
             * The fallbacks here were the literals '142+', '99.4%' and '320ms'.
             * They were not measurements of anything — they rendered whenever
             * `learningStats` was null, which is every session before the OS
             * has run a single intent. A brand-new install displayed a 99.4%
             * success rate over 142 intents it had never processed.
             *
             * A statistic with no observations is not a small inaccuracy; it
             * is the app lying about its own track record. The honest render
             * for "nothing measured yet" is an em dash, so that is what it is.
             */
            <div className="iaos-status-grid">
              <div className="iaos-status-cell">
                <small>{isEn ? 'Intents processed (this device)' : 'قصدهای پردازش‌شده (این دستگاه)'}</small>
                <strong>{Number.isFinite(Number(learningStats?.totalIntents)) ? Number(learningStats.totalIntents).toLocaleString() : '—'}</strong>
              </div>
              <div className="iaos-status-cell">
                <small>{isEn ? 'Execution success rate' : 'نرخ موفقیت عملیات'}</small>
                <strong>
                  {learningStats?.successRate != null && Number(learningStats?.executionSamples) > 0
                    ? `${Math.round(Number(learningStats.successRate) * 100)}%`
                    : '—'}
                </strong>
              </div>
              <div className="iaos-status-cell">
                <small>{isEn ? 'Avg response time' : 'میانگین زمان پاسخ'}</small>
                <strong>{Number.isFinite(Number(learningStats?.averageLatencyMs)) ? `${Math.round(Number(learningStats.averageLatencyMs))}ms` : '—'}</strong>
              </div>
              <div className="iaos-status-cell">
                {/* Not a statistic — a property of the code. No key or secret
                    is ever written to storage, so this one is safe to state. */}
                <small>{isEn ? 'Key storage' : 'ذخیره‌سازی کلید'}</small>
                <strong>{isEn ? 'No keys or secrets stored' : 'هیچ کلید خصوصی ذخیره نمی‌شود'}</strong>
              </div>
              {!(Number(learningStats?.totalIntents) > 0) ? (
                <p className="iaos-panel-note">
                  {isEn
                    ? 'No runs recorded on this device yet — these fill in as you use the assistant. Nothing is pre-filled.'
                    : 'هنوز اجرایی روی این دستگاه ثبت نشده — این اعداد با استفاده از دستیار پر می‌شوند. هیچ مقداری از پیش نوشته نشده است.'}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
