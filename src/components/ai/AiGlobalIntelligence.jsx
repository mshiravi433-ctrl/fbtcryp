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
  .ai-global { padding: 16px; min-height: 100%; }
  .aig-header { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
  .aig-title { font-size: 20px; font-weight: 700; color: #f0f0ff; flex: 1; }
  .aig-chip { font-size: 11px; color: #a5b4fc; background: rgba(99,102,241,0.15); padding: 3px 9px; border-radius: 10px; white-space: nowrap; }
  .aig-chip.warn { color: #eab308; background: rgba(234,179,8,0.12); }
  .aig-chip.bad { color: #f87171; background: rgba(239,68,68,0.12); }
  .aig-tabs { display: flex; gap: 4px; margin-bottom: 14px; overflow-x: auto; padding-bottom: 4px; }
  .aig-tab { padding: 6px 12px; border-radius: 10px; font-size: 12px; font-weight: 500; color: #888; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); cursor: pointer; white-space: nowrap; }
  .aig-tab.active { color: #c4b5fd; background: rgba(99,102,241,0.15); border-color: rgba(99,102,241,0.3); }
  .aig-section { margin-bottom: 14px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 14px; padding: 14px; }
  .aig-section-title { font-size: 13px; font-weight: 600; color: #c4b5fd; margin-bottom: 10px; display: flex; align-items: center; gap: 8px; }
  .aig-refresh { margin-inline-start: auto; font-size: 11px; color: #a5b4fc; background: rgba(99,102,241,0.12); border: 1px solid rgba(99,102,241,0.25); border-radius: 8px; padding: 3px 10px; cursor: pointer; }
  .aig-item { padding: 10px; border-radius: 10px; margin-bottom: 8px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); }
  .aig-item-top { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
  .aig-prio { font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 6px; letter-spacing: 0.4px; }
  .aig-prio.critical { color: #fca5a5; background: rgba(239,68,68,0.15); border: 1px solid rgba(239,68,68,0.3); }
  .aig-prio.high { color: #fdba74; background: rgba(249,115,22,0.13); border: 1px solid rgba(249,115,22,0.28); }
  .aig-prio.normal { color: #fde047; background: rgba(234,179,8,0.1); border: 1px solid rgba(234,179,8,0.25); }
  .aig-prio.info { color: #86efac; background: rgba(34,197,94,0.1); border: 1px solid rgba(34,197,94,0.22); }
  .aig-item-kind { font-size: 10px; color: #777; }
  .aig-item-title { font-size: 13px; font-weight: 600; color: #e8e8f5; }
  .aig-item-detail { font-size: 11.5px; color: #9a9aad; margin-top: 3px; line-height: 1.5; }
  .aig-item-meta { display: flex; align-items: center; gap: 10px; margin-top: 6px; font-size: 10px; color: #666; }
  .aig-item-action { color: #a5b4fc; cursor: pointer; font-weight: 600; }
  .aig-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
  .aig-card { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; padding: 10px; }
  .aig-card-name { font-size: 11px; color: #9a9aad; display: flex; align-items: center; gap: 6px; }
  .aig-card-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
  .aig-card-value { font-size: 15px; font-weight: 700; color: #f0f0ff; margin-top: 4px; }
  .aig-card-sub { font-size: 10px; color: #6b7280; margin-top: 2px; line-height: 1.45; }
  .aig-light { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-radius: 9px; background: rgba(255,255,255,0.03); margin-bottom: 5px; }
  .aig-light-name { font-size: 12px; color: #c0c0d0; flex: 1; }
  .aig-light-lamps { display: flex; gap: 5px; }
  .aig-lamp { width: 8px; height: 8px; border-radius: 50%; background: rgba(255,255,255,0.12); }
  .aig-lamp.on { background: #22c55e; }
  .aig-lamp.off { background: rgba(255,255,255,0.12); }
  .aig-empty { text-align: center; padding: 22px; color: #666; font-size: 12px; line-height: 1.7; }
  .aig-reason { font-size: 10px; color: #f87171; margin-top: 3px; direction: ltr; text-align: start; word-break: break-all; }
  .aig-regime { padding: 12px; border-radius: 12px; text-align: center; margin-bottom: 10px; }
  .aig-regime.risk_on { background: rgba(34,197,94,0.09); border: 1px solid rgba(34,197,94,0.25); }
  .aig-regime.risk_off { background: rgba(239,68,68,0.09); border: 1px solid rgba(239,68,68,0.25); }
  .aig-regime.mixed { background: rgba(234,179,8,0.08); border: 1px solid rgba(234,179,8,0.22); }
  .aig-regime.partial { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1); }
  .aig-regime-label { font-size: 16px; font-weight: 700; color: #f0f0ff; }
  .aig-regime-sub { font-size: 11px; color: #9a9aad; margin-top: 4px; }
  .aig-note { font-size: 10.5px; color: #6b7280; line-height: 1.6; margin-top: 8px; }
  @media (max-width: 380px) { .aig-grid { grid-template-columns: 1fr 1fr; } }
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
  const isRTL = !i18n.language?.startsWith('en');
  const L = (fa, en) => (isRTL ? fa : en);

  const load = useCallback(async (refresh = false) => {
    try {
      if (refresh) setRefreshing(true);
      const qs = refresh ? '?refresh=1' : '';
      const [intelRes, briefRes, crossRes] = await Promise.allSettled([
        fetch(`/api/ai/global/intelligence${qs}`).then((r) => r.json()),
        fetch(`/api/ai/global/briefing${qs}`).then((r) => r.json()),
        fetch('/api/ai/global/cross-asset').then((r) => r.json())
      ]);
      const intelligence = intelRes.status === 'fulfilled' && intelRes.value?.ok ? intelRes.value.globalIntelligence : null;
      const briefing = briefRes.status === 'fulfilled' && briefRes.value?.ok ? briefRes.value.briefing : null;
      const cross = crossRes.status === 'fulfilled' && crossRes.value?.ok ? crossRes.value : null;
      setData((prev) => ({ intelligence: intelligence || prev.intelligence, briefing: briefing || prev.briefing, cross: cross || prev.cross, providers: intelligence?.providers || null }));
    } catch {
      /* the panels keep their honest empty state */
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
            {t.icon} {t.id === 'briefing' ? L('بریفینگ', 'Briefing')
              : t.id === 'domains' ? L('دامنه‌ها', 'Domains')
              : t.id === 'cross' ? L('کراس-است', 'Cross-asset')
              : L('ارائه‌دهنده‌ها', 'Providers')}
          </button>
        ))}
        <button type="button" className="aig-refresh" onClick={() => load(true)} disabled={refreshing}>
          {refreshing ? L('…در حال خواندن', 'reading…') : L('به‌روزرسانی', 'refresh')}
        </button>
      </div>

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
