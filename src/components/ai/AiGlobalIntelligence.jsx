/**
 * FBT INTENT OS — AI GLOBAL INTELLIGENCE (Phase 211).
 * ---------------------------------------------------------------------------
 * The user-facing surface of the Global Intelligence Engine: one screen that
 * shows what the AI's global brain actually READ — smart money, whales,
 * on-chain health, macro, news, stocks, forex, commodities, RWA — plus the
 * cross-asset regime and the proactive briefing, with the same honesty rules
 * the engine enforces server-side:
 *
 *   · a domain that was not read says «unread» with its reason — never zero
 *   · a provider light marked live means a real result, not a promise
 *   · every briefing item names its source; nothing carries execution
 *
 * This screen is ADDITIVE (Phase 211 rule): it adds the /ai-global route and
 * one tile in the More sheet; it replaces and removes nothing. It talks to
 * the FI's own additive endpoints under /api/ai/global/*.
 */
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ThinkingOrb } from './ThinkingOrb.jsx';

/* ── Styles (scoped, same visual language as the AI control center) ────── */
const STYLES = `
  .ai-global { width: 100%; padding: var(--sp-4); min-height: 100%; color: var(--text-1); }
  .aig-header { display:flex; align-items:center; gap:var(--sp-3); margin-bottom:var(--sp-4); min-height:44px; }
  .aig-title { flex:1; min-width:0; font-size:var(--fs-lg); line-height:var(--lh-tight); font-weight:800; color:var(--text-1); }
  .aig-chip { flex:0 0 auto; font-size:var(--fs-xs); font-weight:700; color:var(--rgb-2); background:color-mix(in srgb,var(--rgb-2) 13%,transparent); border:1px solid color-mix(in srgb,var(--rgb-2) 28%,transparent); padding:5px 9px; border-radius:999px; white-space:nowrap; }
  .aig-chip.warn { color:var(--rgb-5); background:color-mix(in srgb,var(--rgb-5) 12%,transparent); }
  .aig-chip.bad { color:var(--down); background:color-mix(in srgb,var(--down) 12%,transparent); }
  .aig-tabs { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:var(--sp-2); margin-bottom:var(--sp-3); direction:inherit; }
  .aig-tab { min-width:0; min-height:48px; padding:7px 4px; border-radius:var(--radius-sm); font:inherit; font-size:11px; font-weight:700; line-height:1.25; color:var(--text-2); background:var(--bg-panel); border:1px solid var(--line); cursor:pointer; white-space:normal; display:flex; align-items:center; justify-content:center; gap:4px; transition:.2s ease; }
  .aig-tab-icon { font-size:var(--icon-sm); line-height:1; }
  .aig-tab.active { color:var(--text-1); background:linear-gradient(135deg,color-mix(in srgb,var(--rgb-1) 13%,var(--bg-panel-solid)),color-mix(in srgb,var(--rgb-2) 15%,var(--bg-panel-solid))); border-color:color-mix(in srgb,var(--rgb-2) 45%,var(--line)); box-shadow:inset 0 -2px var(--rgb-1); }
  .aig-refresh { width:100%; min-height:44px; margin-bottom:var(--sp-4); color:var(--text-1); background:var(--bg-raised); border:1px solid var(--line-strong); border-radius:var(--radius-sm); font:inherit; font-size:var(--fs-sm); font-weight:700; cursor:pointer; }
  .aig-refresh:disabled { opacity:.6; cursor:wait; }
  .aig-connection { display:flex; align-items:center; gap:8px; margin-bottom:var(--sp-3); padding:9px 12px; border:1px solid color-mix(in srgb,var(--down) 35%,var(--line)); border-radius:var(--radius-sm); color:var(--down); background:color-mix(in srgb,var(--down) 8%,var(--bg-panel-solid)); font-size:var(--fs-xs); }
  .aig-section { margin-bottom:var(--sp-4); background:var(--bg-panel); border:1px solid var(--line); border-radius:var(--radius); padding:var(--sp-4); box-shadow:var(--glass-shadow); }
  .aig-section-title { font-size:var(--fs-sm); font-weight:800; color:var(--text-1); margin-bottom:var(--sp-3); display:flex; align-items:center; gap:var(--sp-2); }
  .aig-item { padding:var(--sp-3); border-radius:var(--radius-sm); margin-bottom:var(--sp-2); background:var(--bg-raised); border:1px solid var(--line); }
  .aig-item-top { display:flex; align-items:center; gap:8px; margin-bottom:6px; }
  .aig-prio { font-size:10px; font-weight:800; padding:2px 7px; border-radius:6px; letter-spacing:.3px; }
  .aig-prio.critical { color:var(--down); background:color-mix(in srgb,var(--down) 12%,transparent); }
  .aig-prio.high { color:#f97316; background:rgba(249,115,22,.12); }
  .aig-prio.normal { color:var(--rgb-5); background:color-mix(in srgb,var(--rgb-5) 10%,transparent); }
  .aig-prio.info { color:var(--up); background:color-mix(in srgb,var(--up) 10%,transparent); }
  .aig-item-kind,.aig-item-meta { font-size:var(--fs-xs); color:var(--text-3); }
  .aig-item-title { font-size:var(--fs-sm); font-weight:700; color:var(--text-1); }
  .aig-item-detail { font-size:var(--fs-xs); color:var(--text-2); margin-top:4px; line-height:var(--lh-normal); }
  .aig-item-meta { display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin-top:8px; }
  .aig-item-action { color:var(--rgb-1); cursor:pointer; font-weight:700; }
  .aig-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:var(--sp-2); }
  .aig-card { min-width:0; background:var(--bg-raised); border:1px solid var(--line); border-radius:var(--radius-sm); padding:var(--sp-3); }
  .aig-card-name { font-size:var(--fs-xs); color:var(--text-2); display:flex; align-items:center; gap:6px; }
  .aig-card-dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; box-shadow:0 0 8px currentColor; }
  .aig-card-value { font-size:var(--fs-lg); font-weight:800; color:var(--text-1); margin-top:6px; }
  .aig-card-sub { font-size:11px; color:var(--text-2); margin-top:3px; line-height:1.45; overflow-wrap:anywhere; }
  .aig-light { display:flex; align-items:center; gap:8px; padding:10px 12px; border-radius:var(--radius-sm); background:var(--bg-raised); border:1px solid var(--line); margin-bottom:6px; }
  .aig-light-name { min-width:0; font-size:var(--fs-xs); color:var(--text-1); flex:1; overflow-wrap:anywhere; }
  .aig-light-lamps { display:flex; flex:0 0 auto; gap:5px; direction:ltr; }
  .aig-lamp { width:9px; height:9px; border-radius:50%; background:var(--line-strong); }
  .aig-lamp.on { background:var(--up); box-shadow:0 0 7px color-mix(in srgb,var(--up) 60%,transparent); }
  .aig-empty { text-align:center; padding:24px 8px; color:var(--text-2); font-size:var(--fs-sm); line-height:var(--lh-loose); }
  .aig-reason { font-size:10px; color:var(--down); margin-top:4px; direction:ltr; text-align:start; overflow-wrap:anywhere; }
  .aig-regime { padding:var(--sp-4); border-radius:var(--radius-sm); text-align:center; margin-bottom:var(--sp-3); border:1px solid var(--line); background:var(--bg-raised); }
  .aig-regime.risk_on { background:color-mix(in srgb,var(--up) 8%,var(--bg-raised)); border-color:color-mix(in srgb,var(--up) 28%,var(--line)); }
  .aig-regime.risk_off { background:color-mix(in srgb,var(--down) 8%,var(--bg-raised)); border-color:color-mix(in srgb,var(--down) 28%,var(--line)); }
  .aig-regime.mixed { background:color-mix(in srgb,var(--rgb-5) 8%,var(--bg-raised)); }
  .aig-regime-label { font-size:var(--fs-lg); font-weight:800; color:var(--text-1); }
  .aig-regime-sub,.aig-note { font-size:var(--fs-xs); color:var(--text-2); line-height:var(--lh-normal); margin-top:6px; }
  @media (min-width:480px) { .aig-tab { font-size:var(--fs-xs); } .aig-grid { grid-template-columns:repeat(3,minmax(0,1fr)); } }
`;

const TABS = [
  { id: 'briefing', icon: '📰' },
  { id: 'domains', icon: '🌍' },
  { id: 'cross', icon: '🔀' },
  { id: 'providers', icon: '🔌' }
];

const DOMAIN_META = {
  smart_money: { icon: '🧠', fa: 'پول هوشمند', en: 'Smart money' },
  whales: { icon: '🐋', fa: 'نهنگ‌ها', en: 'Whales' },
  onchain: { icon: '⛓️', fa: 'روی زنجیره', en: 'On-chain' },
  news: { icon: '📰', fa: 'اخبار', en: 'News' },
  macro: { icon: '🏛️', fa: 'کلان', en: 'Macro' },
  stocks: { icon: '📈', fa: 'سهام', en: 'Stocks' },
  forex: { icon: '💱', fa: 'فارکس', en: 'Forex' },
  commodities: { icon: '🛢️', fa: 'کالاها', en: 'Commodities' },
  rwa: { icon: '🏛️', fa: 'دارایی واقعی', en: 'RWA' }
};

const fmtK = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(Math.round(n));
};

const timeAgo = (at, isRTL) => {
  const s = Math.max(0, Math.round((Date.now() - Number(at || 0)) / 1000));
  if (s < 60) return isRTL ? `${s} ثانیه پیش` : `${s}s ago`;
  if (s < 3600) return isRTL ? `${Math.round(s / 60)} دقیقه پیش` : `${Math.round(s / 60)}m ago`;
  return isRTL ? `${Math.round(s / 3600)} ساعت پیش` : `${Math.round(s / 3600)}h ago`;
};

function AiGlobalIntelligenceInner() {
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const [tab, setTab] = useState('briefing');
  const [data, setData] = useState({ intelligence: null, briefing: null, cross: null, providers: null });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [connectionError, setConnectionError] = useState(null);
  const language = String(i18n.resolvedLanguage || i18n.language || 'en').split('-')[0];
  const isPersian = language === 'fa';
  const isRTL = ['fa', 'ar', 'ur'].includes(language);
  const L = (fa, en) => (isPersian ? fa : en);

  const load = useCallback(async (refresh = false) => {
    const readJson = async (url) => {
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (!payload?.ok) throw new Error(payload?.error || 'INVALID_RESPONSE');
      return payload;
    };
    try {
      if (refresh) setRefreshing(true);
      setConnectionError(null);
      const qs = refresh ? '?refresh=1' : '';
      const [intel, brief, crossAsset, providerState] = await Promise.all([
        readJson(`/api/ai/global/intelligence${qs}`),
        readJson(`/api/ai/global/briefing${qs}`),
        readJson('/api/ai/global/cross-asset'),
        readJson('/api/ai/global/providers')
      ]);
      setData({
        intelligence: intel.globalIntelligence || null,
        briefing: brief.briefing || null,
        cross: crossAsset || null,
        providers: providerState.providers || intel.globalIntelligence?.providers || null
      });
    } catch (error) {
      setConnectionError(error?.message || 'NETWORK_ERROR');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load(false);
    const timer = setInterval(() => load(false), 60_000);
    return () => clearInterval(timer);
  }, [load]);

  const domains = useMemo(() => data.intelligence?.domains || null, [data.intelligence]);
  const briefingItems = useMemo(() => data.briefing?.items || [], [data.briefing]);
  const cross = data.cross?.crossAsset || null;

  const statusColor = (status) => (status === 'OK' ? '#22c55e' : status === 'PARTIAL' ? '#eab308' : '#6b7280');
  const regimeClass = cross?.regime?.regime ? String(cross.regime.regime).toLowerCase() : 'partial';

  /* ── per-domain one-line summaries (only what was actually read) ─────── */
  const domainValue = (key, d) => {
    if (!d || d.status === 'UNAVAILABLE') return { value: L('خوانده نشد', 'unread'), sub: d?.reason || null, bad: true };
    const v = d.data || {};
    switch (key) {
      case 'smart_money': {
        const net = v.accumulationUsd != null && v.distributionUsd != null ? v.accumulationUsd - v.distributionUsd : null;
        return {
          value: net != null ? `${net >= 0 ? '+' : '−'}$${fmtK(Math.abs(net))}` : '—',
          sub: `${v.whaleActivity?.count ?? '—'} ${L('رویداد نهنگ', 'whale events')} · ${v.window || '24h'}`
        };
      }
      case 'whales':
        return { value: `${v.count ?? '—'}`, sub: v.events?.[0] ? `${v.events[0].symbol} $${fmtK(v.events[0].valueUsd)}` : null };
      case 'onchain':
        return { value: `${v.healthySources ?? 0}/${(v.sources || []).length}`, sub: v.downSources ? `${v.downSources} ${L('منبع خاموش', 'sources down')}` : L('همه سالم', 'all healthy') };
      case 'news':
        return { value: `${v.count ?? 0}`, sub: v.items?.[0] ? String(v.items[0].title).slice(0, 46) : null };
      case 'macro':
        return { value: `${v.attention ?? 0}`, sub: Object.entries(v.byTopic || {}).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([t, n]) => `${t}×${n}`).join(' · ') || null };
      case 'stocks':
      case 'forex':
      case 'commodities':
      case 'rwa': {
        const inst = v.instruments || [];
        const withChange = inst.filter((i) => i.change24hPct != null);
        const top = withChange.sort((a, b) => Math.abs(b.change24hPct) - Math.abs(a.change24hPct))[0];
        return {
          value: `${inst.length}`,
          sub: top ? `${top.symbol} ${top.change24hPct > 0 ? '+' : ''}${top.change24hPct.toFixed(1)}%` : L('بدون تغییر ۲۴س', 'no 24h change'),
          note: L('دسترس فقط‌خواندنی', 'read-only venue')
        };
      }
      default:
        return { value: '—', sub: null };
    }
  };

  return (
    <div className="ai-global" dir={isRTL ? 'rtl' : 'ltr'}>
      <style>{STYLES}</style>

      <div className="aig-header">
        <ThinkingOrb state={loading || refreshing ? 'working' : 'idle'} size={26} />
        <div className="aig-title">{L('هوش جهانی FBT', 'FBT Global Intelligence')}</div>
        {data.intelligence && (
          <span className={`aig-chip ${data.intelligence.available >= 5 ? '' : data.intelligence.available >= 1 ? 'warn' : 'bad'}`}>
            {data.intelligence.available}/9 {L('دامنه زنده', 'domains live')}
          </span>
        )}
      </div>

      <div className="aig-tabs">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={`aig-tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            <span className="aig-tab-icon" aria-hidden="true">{t.icon}</span><span>{t.id === 'briefing' ? L('بریفینگ', 'Briefing')
              : t.id === 'domains' ? L('دامنه‌ها', 'Domains')
              : t.id === 'cross' ? L('کراس-است', 'Cross-asset')
              : L('ارائه‌دهنده‌ها', 'Providers')}</span>
          </button>
        ))}
      </div>
      <button type="button" className="aig-refresh" onClick={() => load(true)} disabled={refreshing}>
        {refreshing ? L('در حال دریافت داده…', 'Reading live data…') : L('به‌روزرسانی داده‌های زنده', 'Refresh live data')}
      </button>
      {connectionError ? (
        <div className="aig-connection" role="status">
          <span aria-hidden="true">●</span>
          <span>{L('ارتباط با سرور برقرار نشد. برای تلاش دوباره، به‌روزرسانی را بزنید.', 'Server connection failed. Tap refresh to try again.')}</span>
        </div>
      ) : null}

      {/* ── BRIEFING — the proactive layer ─────────────────────────────── */}
      {tab === 'briefing' && (
        <div className="aig-section">
          <div className="aig-section-title">
            📰 {L('بریفینگ فعال هوش مصنوعی', 'Proactive AI briefing')}
            {data.briefing?.at ? <span className="aig-item-kind">{timeAgo(data.briefing.at, isRTL)}</span> : null}
          </div>
          {briefingItems.length ? briefingItems.map((item) => (
            <div key={item.id} className="aig-item">
              <div className="aig-item-top">
                <span className={`aig-prio ${item.priority}`}>{item.priority.toUpperCase()}</span>
                <span className="aig-item-kind">{item.kind}</span>
              </div>
              <div className="aig-item-title">{item.title}</div>
              {item.detail ? <div className="aig-item-detail">{item.detail}</div> : null}
              <div className="aig-item-meta">
                <span>{item.source}</span>
                {item.confidence != null ? <span>· {Math.round(item.confidence * 100)}%</span> : null}
                {item.untrusted ? <span>· {L('داده، نه دستور', 'data, not authority')}</span> : null}
                {item.action?.to ? (
                  <span
                    className="aig-item-action"
                    role="button"
                    tabIndex={0}
                    onClick={() => navigate(item.action.to)}
                    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && navigate(item.action.to)}
                  >
                    {L('باز کن', 'open')} →
                  </span>
                ) : null}
              </div>
            </div>
          )) : (
            <div className="aig-empty">
              {L(
                'هنوز چیزی برای گفتن نیست — مغز مالی فقط از چیزی که واقعاً خوانده حرف می‌زند.',
                'Nothing to report yet — the financial brain only speaks from what it actually read.'
              )}
              {data.briefing?.missing?.length ? (
                <div className="aig-note">{L('ورودی‌های خوانده‌نشده:', 'unread inputs:')} {data.briefing.missing.join(', ')}</div>
              ) : null}
            </div>
          )}
          <div className="aig-note">
            {L(
              'بریفینگ یک توصیه به خواندن است؛ هیچ موردی مجوز اجرا ندارد. هر عدد از منبع خودش آمده.',
              'A briefing is a recommendation to read — no item carries execution permission. Every number cites its source.'
            )}
          </div>
        </div>
      )}

      {/* ── DOMAINS — the nine intelligence domains ────────────────────── */}
      {tab === 'domains' && (
        <div className="aig-section">
          <div className="aig-section-title">🌍 {L('دامنه‌های هوش جهانی', 'Global intelligence domains')}</div>
          {domains ? (
            <div className="aig-grid">
              {Object.keys(DOMAIN_META).map((key) => {
                const d = domains[key];
                const meta = DOMAIN_META[key];
                const summary = domainValue(key, d);
                return (
                  <div key={key} className="aig-card">
                    <div className="aig-card-name">
                      <span className="aig-card-dot" style={{ background: statusColor(d?.status) }} />
                      {meta.icon} {isRTL ? meta.fa : meta.en}
                    </div>
                    <div className="aig-card-value">{summary.value}</div>
                    {summary.sub ? <div className="aig-card-sub">{summary.sub}</div> : null}
                    {summary.bad && summary.sub ? <div className="aig-reason">{summary.sub}</div> : null}
                    {summary.note ? <div className="aig-card-sub">{summary.note}</div> : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="aig-empty">{L('اسنپ‌شات جهانی هنوز خوانده نشده.', 'The global snapshot has not been read yet.')}</div>
          )}
          <div className="aig-note">
            {L(
              'دامنه «خوانده نشد» یعنی دقیقاً همان — سیستم هیچ عددی را حدس نمی‌زند.',
              'An «unread» domain means exactly that — the system never guesses a number.'
            )}
          </div>
        </div>
      )}

      {/* ── CROSS-ASSET — regime, breadth, divergences ─────────────────── */}
      {tab === 'cross' && (
        <div className="aig-section">
          <div className="aig-section-title">🔀 {L('تحلیل کراس-است', 'Cross-asset intelligence')}</div>
          {cross && cross.status !== 'UNAVAILABLE' ? (
            <>
              <div className={`aig-regime ${regimeClass}`}>
                <div className="aig-regime-label">
                  {cross.regime?.regime ? String(cross.regime.regime).replace(/_/g, ' ') : L('ترکیبی', 'MIXED')}
                </div>
                <div className="aig-regime-sub">
                  {cross.observedClasses?.length
                    ? `${cross.observedClasses.join(' · ')} — ${L('میانگین تغییر ۲۴ ساعته واقعی هر کلاس', 'real per-class average 24h change')}`
                    : L('کلاس کافی برای رژیم نیست', 'not enough classes for a regime')}
                </div>
              </div>
              <div className="aig-grid">
                {Object.entries(cross.classes || {}).filter(([, c]) => c).map(([cls, c]) => (
                  <div key={cls} className="aig-card">
                    <div className="aig-card-name">{cls}</div>
                    <div className="aig-card-value" style={{ color: c.avgChangePct > 0 ? '#4ade80' : c.avgChangePct < 0 ? '#f87171' : '#f0f0ff' }}>
                      {c.avgChangePct > 0 ? '+' : ''}{c.avgChangePct?.toFixed(2)}%
                    </div>
                    <div className="aig-card-sub">{c.advancing}/{c.withChange} {L('در صعود', 'advancing')}</div>
                  </div>
                ))}
              </div>
              {cross.divergences?.length ? (
                <div style={{ marginTop: 10 }}>
                  <div className="aig-section-title" style={{ marginBottom: 6 }}>↔️ {L('واگرایی‌ها', 'Divergences')}</div>
                  {cross.divergences.map((d, i) => (
                    <div key={i} className="aig-item-detail" style={{ marginBottom: 4 }}>
                      {d.classes[0]} {d.avgChangePct[d.classes[0]]}% × {d.classes[1]} {d.avgChangePct[d.classes[1]]}% ({d.gapPct}pp)
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="aig-note">
                {cross.correlations?.UNAVAILABLE
                  ? L('همبستگی فقط با سری زمانی جفتی واقعی محاسبه می‌شود؛ یک اسنپ‌شات همبستگی تولید نمی‌کند.', 'Correlations need real paired history; one snapshot cannot produce one.')
                  : null}
                {cross.readOnlyClasses?.length
                  ? ` · ${L('کلاس‌های فقط-خواندنی: ', 'read-only classes: ')}${cross.readOnlyClasses.join(', ')}`
                  : null}
              </div>
            </>
          ) : (
            <div className="aig-empty">
              {cross?.missing?.length
                ? `${L('کلاس‌های خوانده‌نشده:', 'unread classes:')} ${cross.missing.join(', ')}`
                : L('تحلیل کراس-است هنوز محاسبه نشده.', 'Cross-asset analysis has not been computed yet.')}
            </div>
          )}
        </div>
      )}

      {/* ── PROVIDERS — the five readiness lights per domain ───────────── */}
      {tab === 'providers' && (
        <div className="aig-section">
          <div className="aig-section-title">🔌 {L('چراغ‌های آمادگی ارائه‌دهنده', 'Provider readiness lights')}</div>
          {data.providers ? (
            <>
              {Object.entries(data.providers).map(([name, p]) => (
                <div key={name} className="aig-light">
                  <span className="aig-light-name">
                    {DOMAIN_META[name]?.icon || '•'} {name}
                    {p.reason ? <div className="aig-reason">{p.reason}</div> : null}
                  </span>
                  <span className="aig-light-lamps" title="implemented · configured · provider_available · runtime_ready · live">
                    {['implemented', 'configured', 'provider_available', 'runtime_ready', 'live'].map((k) => (
                      <span key={k} className={`aig-lamp ${p[k] ? 'on' : 'off'}`} />
                    ))}
                  </span>
                </div>
              ))}
              <div className="aig-note">
                {L(
                  'پنج چراغ: پیاده‌سازی · پیکربندی · دسترس‌پذیری ارائه‌دهنده · آمادهٔ اجرا · زنده. «زنده» یعنی نتیجهٔ واقعی در همین فرایند.',
                  'Five lamps: implemented · configured · provider_available · runtime_ready · live. «live» means a real result in this process.'
                )}
              </div>
            </>
          ) : (
            <div className="aig-empty">{L('وضعیت ارائه‌دهنده‌ها هنوز خوانده نشده.', 'Provider status has not been read yet.')}</div>
          )}
        </div>
      )}
    </div>
  );
}

export const AiGlobalIntelligence = memo(AiGlobalIntelligenceInner);
export default AiGlobalIntelligence;
