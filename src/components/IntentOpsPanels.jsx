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
    ACTIVE: locale === 'en' ? 'Active' : 'فعال',
    PAUSED: locale === 'en' ? 'Paused' : 'متوقف',
    TRIGGERED: locale === 'en' ? 'Triggered' : 'شرط برقرار شد',
    COMPLETED: locale === 'en' ? 'Completed' : 'تکمیل',
    CANCELLED: locale === 'en' ? 'Cancelled' : 'لغو شده',
    ERROR: locale === 'en' ? 'Error' : 'خطا',
    DRAFT: locale === 'en' ? 'Draft' : 'پیش‌نویس',
    WAITING_CONFIRMATION: locale === 'en' ? 'Waiting' : 'در انتظار تأیید',
    EXECUTING: locale === 'en' ? 'Executing' : 'در حال اجرا',
    UNKNOWN: locale === 'en' ? 'Unknown' : 'نامشخص'
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
  locale = 'fa'
}) {
  const [cat, setCat] = useState('portfolio');
  const cards = useMemo(() => OPERATIONS.filter((c) => c.category === cat), [cat]);

  if (!open) return null;
  return (
    <div className="iaos-panel-overlay" role="dialog" aria-modal="true" aria-label={locale === 'en' ? 'Operations' : 'عملیات'}>
      <div className="iaos-panel iaos-ops-panel">
        <div className="iaos-panel-head">
          <h2>{locale === 'en' ? 'Operations Center' : 'مرکز عملیات'}</h2>
          <button type="button" className="iaos-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
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
              <span aria-hidden="true">{c.icon}</span>
              {c.title}
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
                <span className="iaos-ops-icon" aria-hidden="true">{card.icon}</span>
                <span className="iaos-ops-body">
                  <strong>{card.title}</strong>
                  <small>{card.desc}</small>
                </span>
                <span className="iaos-ops-state">
                  {!avail.available
                    ? (avail.reason === 'WALLET_REQUIRED' ? (locale === 'en' ? 'Wallet needed' : 'نیاز به کیف پول') : (locale === 'en' ? 'Unavailable' : 'در دسترس نیست'))
                    : '↗'}
                </span>
              </button>
            );
          })}
        </div>
        <p className="iaos-panel-note">
          {locale === 'en'
            ? 'Every card is a real operation. Cards needing a connected wallet show why they are disabled.'
            : 'هر کارت یک عملیات واقعی است؛ کارت‌هایی که کیف پول می‌خواهند دلیل غیرفعال بودن را نشان می‌دهند.'}
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
  onContinue,
  onMonitorAction,
  busy = false,
  locale = 'fa'
}) {
  const [tab, setTab] = useState('conversations');
  if (!open) return null;

  const conversations = history?.conversations || [];
  const operations = history?.operations || [];
  const activeMonitors = (monitors || []).filter((m) => ['ACTIVE', 'PAUSED', 'TRIGGERED'].includes(String(m.status || '').toUpperCase()));

  const L = locale === 'en' ? {
    title: 'History', conversations: 'Conversations', operations: 'Operations', monitoring: 'Active Monitoring',
    empty: 'Nothing recorded yet', pause: 'Pause', resume: 'Resume', cancel: 'Cancel', evaluate: 'Check now',
    continue: 'Continue', close: 'Close'
  } : {
    title: 'تاریخچه', conversations: 'گفتگوها', operations: 'عملیات', monitoring: 'پایش فعال',
    empty: 'هنوز چیزی ثبت نشده', pause: 'توقف', resume: 'ادامه', cancel: 'لغو', evaluate: 'بررسی اکنون',
    continue: 'ادامه', close: 'بستن'
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
          {tab === 'conversations' && (
            conversations.length
              ? conversations.map((c) => (
                <div key={c.id} className={`iaos-history-row iaos-history-${c.role}`}>
                  <span className="iaos-history-who">{c.role === 'user' ? (locale === 'en' ? 'You' : 'شما') : (locale === 'en' ? 'AI' : 'اینتنت')}</span>
                  <p>{c.content}</p>
                  <time>{new Date(c.at || 0).toLocaleString(locale === 'en' ? 'en-US' : 'fa-IR')}</time>
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
                    <time>{new Date(o.at || 0).toLocaleString(locale === 'en' ? 'en-US' : 'fa-IR')}</time>
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
                      {m.asset?.symbol || ''} · {m.metric} {m.operator} {fmtNum(m.threshold)} · every {m.intervalMinutes}m
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
  const L = locale === 'en'
    ? { title: 'Intent OS Status', wallet: 'Wallet', server: 'AI Gateway', monitors: 'Monitors', orders: 'Orders', automations: 'Automations', engine: 'Monitor engine', cron: 'Background cron' }
    : { title: 'وضعیت Intent OS', wallet: 'کیف پول', server: 'درگاه AI', monitors: 'پایش‌ها', orders: 'سفارش‌ها', automations: 'اتوماسیون‌ها', engine: 'موتور پایش', cron: 'کرون پس‌زمینه' };

  const Cell = ({ label, value, ok }) => (
    <div className="iaos-status-cell">
      <span>{label}</span>
      <strong data-ok={ok === undefined ? 'true' : String(ok)}>{value}</strong>
    </div>
  );

  return (
    <div className="iaos-panel-overlay" role="dialog" aria-modal="true" aria-label={L.title}>
      <div className="iaos-panel iaos-status-panel">
        <div className="iaos-panel-head">
          <h2>{L.title}</h2>
          <button type="button" className="iaos-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="iaos-status-grid">
          <Cell label={L.wallet} value={status?.walletConnected ? (locale === 'en' ? 'Connected' : 'متصل') : (locale === 'en' ? 'Not connected' : 'متصل نیست')} ok={status?.walletConnected} />
          <Cell label={L.server} value={status?.serverReachable ? (locale === 'en' ? 'Online' : 'آنلاین') : (locale === 'en' ? 'Unavailable' : 'در دسترس نیست')} ok={status?.serverReachable} />
          <Cell label={L.monitors} value={`${status?.monitors?.active ?? 0} active / ${status?.monitors?.total ?? 0} total`} />
          <Cell label={L.orders} value={status?.ordersCount ?? 0} />
          <Cell label={L.automations} value={status?.automationsCount ?? 0} />
          <Cell label={L.engine} value={status?.engine?.durable ? (locale === 'en' ? 'Durable store' : 'ذخیره بادوام') : (locale === 'en' ? 'Memory store' : 'حافظه موقت')} />
          <Cell label={L.cron} value={status?.engine?.cronSecretSet ? (locale === 'en' ? 'Configured' : 'پیکربندی شده') : (locale === 'en' ? 'Not configured' : 'پیکربندی نشده')} />
        </div>
        <p className="iaos-panel-note">
          {locale === 'en'
            ? 'All values are read from live services. Nothing here is a simulated number.'
            : 'همه مقادیر از سرویس‌های واقعی خوانده می‌شوند؛ هیچ عدد شبیه‌سازی‌شده‌ای نمایش داده نمی‌شود.'}
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
  const L = locale === 'en'
    ? { title: 'Create Monitor', asset: 'Asset', metric: 'Metric', operator: 'Operator', threshold: 'Threshold', interval: 'Check every', create: 'Create Monitor', cancel: 'Cancel', note: 'The server evaluates this job against live prices and records every check. No fake trigger.' }
    : { title: 'ایجاد پایش', asset: 'دارایی', metric: 'شاخص', operator: 'شرط', threshold: 'آستانه', interval: 'بررسی هر', create: 'ایجاد پایش', cancel: 'انصراف', note: 'سرور این پایش را با قیمت واقعی ارزیابی می‌کند و هر بررسی ثبت می‌شود؛ هیچ شرط ساختگی‌ای وجود ندارد.' };

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
  const L = locale === 'en'
    ? { title: 'Conditional Buy', asset: 'Asset', target: 'Target price (USD)', amount: 'Amount (USD)', create: 'Create Order', cancel: 'Cancel', note: 'Creates a REAL limit watch on /orders: the server watches the price and alerts; the fill is always signed by you at the swap screen.' }
    : { title: 'خرید شرطی', asset: 'دارایی', target: 'قیمت هدف (دلار)', amount: 'مبلغ (دلار)', create: 'ایجاد سفارش', cancel: 'انصراف', note: 'یک سفارش واقعی در /orders ایجاد می‌شود: سرور قیمت را پایش می‌کند و خبر می‌دهد؛ پر شدن همیشه با امضای شما در صفحه سواپ انجام می‌شود.' };

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
        {monitor?.lastCheckAt ? <small>{locale === 'en' ? 'checked' : 'آخرین بررسی'}: {new Date(monitor.lastCheckAt).toLocaleString(locale === 'en' ? 'en-US' : 'fa-IR')}</small> : null}
      </div>
      <div className="iaos-monitor-card-actions">
        {monitor?.status === 'ACTIVE' ? <button type="button" onClick={() => onAction(monitor, 'pause')}>{locale === 'en' ? 'Pause' : 'توقف'}</button> : null}
        {monitor?.status === 'PAUSED' ? <button type="button" onClick={() => onAction(monitor, 'resume')}>{locale === 'en' ? 'Resume' : 'ادامه'}</button> : null}
        <button type="button" onClick={() => onAction(monitor, 'evaluate')}>{locale === 'en' ? 'Check now' : 'بررسی اکنون'}</button>
        <button type="button" className="iaos-danger" onClick={() => onAction(monitor, 'cancel')}>{locale === 'en' ? 'Cancel' : 'لغو'}</button>
      </div>
    </div>
  );
}

export function OpportunityList({ rows, onMonitor, goal = null, locale = 'fa' }) {
  if (!Array.isArray(rows) || !rows.length) {
    return <div className="iaos-opp-empty">{locale === 'en' ? 'No opportunities with enough real data.' : 'فرصتی با داده کافی پیدا نشد.'}</div>;
  }
  const top = rows.slice(0, 5);
  return (
    <div className="iaos-opp-list" data-testid="intent-ai-opportunities">
      {goal ? (
        <div className="iaos-opp-goal">
          {locale === 'en'
            ? `Goal: ${fmtNum(goal?.targetReturnPct)}% → this is an estimate, never a guarantee`
            : `هدف: ${fmtNum(goal?.targetReturnPct)}٪ → این تخمین است، نه تضمین`}
        </div>
      ) : null}
      {top.map((o) => (
        <div key={o.id} className="iaos-opp-row">
          <strong>{o.symbol || o.name} <small>{o.kind}</small></strong>
          <span>
            {o.expectedReturnPct != null ? `${fmtNum(o.expectedReturnPct, 1)}%` : '—'}
            <small>{o.basis === 'apy' ? 'APY' : '7d/2'}</small>
          </span>
          <span className="iaos-opp-meta">
            {o.probabilityPct != null ? `${locale === 'en' ? 'hist. rate' : 'نرخ تاریخی'} ${fmtNum(o.probabilityPct, 0)}%` : '—'}
            {o.potentialDrawdownPct != null ? ` · DD ${fmtNum(o.potentialDrawdownPct, 0)}%` : ''}
          </span>
          <span className={`iaos-pill iaos-pill-${o.risk === 'high' ? 'bad' : o.risk === 'medium' ? 'warn' : 'ok'}`}>{o.risk.toUpperCase()}</span>
          <button type="button" className="iaos-opp-monitor" onClick={() => onMonitor(o)}>{locale === 'en' ? 'Monitor' : 'پایش کن'}</button>
        </div>
      ))}
      <p className="iaos-opp-disclaimer">
        {locale === 'en'
          ? 'Expected return / probability are historical observations or stated APY — never guaranteed. Confidence and data quality are shown per row.'
          : 'بازده و احتمال، مشاهدات تاریخی یا APY اعلام‌شده‌اند — هیچ‌گاه تضمین نیستند. اطمینان و کیفیت داده هر ردیف نمایش داده می‌شود.'}
      </p>
    </div>
  );
}

export function OrderCard({ order, locale = 'fa' }) {
  return (
    <div className="iaos-order-card" data-testid="intent-ai-order-card">
      <strong>{order?.toToken?.symbol || order?.toSymbol || '?'} {locale === 'en' ? 'conditional buy' : 'خرید شرطی'}</strong>
      <span>{order?.targetRate != null ? `${order.direction === 'above' ? '≥' : '≤'} ${fmtNum(order.targetRate, 0)} USD` : ''}</span>
      <small>{order?.amountIn} {order?.fromToken?.symbol || order?.fromSymbol || 'USDT'} · /orders</small>
      <span className="iaos-pill iaos-pill-ok">{locale === 'en' ? 'Stored real order' : 'سفارش واقعی ثبت شد'}</span>
    </div>
  );
}
