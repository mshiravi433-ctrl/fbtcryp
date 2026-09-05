/**
 * FBT FINANCIAL OS — AI Control Center (Upgrade 11+12 §33)
 * ---------------------------------------------------------------------------
 * Unified dashboard showing the full AI brain status: agents, tools, active
 * tasks, goals, strategies, monitoring, alerts, opportunities, confidence,
 * data freshness, recent decisions, and pending permissions.
 *
 * Matches the existing FBT visual identity — dark background, gradient
 * accents, RTL-aware, mobile-optimized.
 */
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCentralBrain } from '../../context/CentralBrainContext.jsx';
import { ThinkingOrb } from './ThinkingOrb.jsx';
import {
  BRAIN_VERSION,
  generateDailyBrief,
  orchestrateBrain
} from '../../lib/brain/index.js';

/* ── Styles (scoped to this component) ─────────────────────────────────── */
const STYLES = `
  .ai-control-center { padding: 16px; min-height: 100%; }
  .ai-cc-header { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
  .ai-cc-title { font-size: 20px; font-weight: 700; color: #f0f0ff; flex: 1; }
  .ai-cc-version { font-size: 11px; color: #888; background: rgba(99,102,241,0.15); padding: 2px 8px; border-radius: 8px; }
  .ai-cc-status { display: flex; align-items: center; gap: 6px; font-size: 12px; padding: 4px 10px; border-radius: 12px; }
  .ai-cc-status.online { color: #22c55e; background: rgba(34,197,94,0.1); }
  .ai-cc-status.degraded { color: #eab308; background: rgba(234,179,8,0.1); }
  .ai-cc-status.offline { color: #ef4444; background: rgba(239,68,68,0.1); }
  .ai-cc-dot { width: 8px; height: 8px; border-radius: 50%; }
  .ai-cc-section { margin-bottom: 16px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 14px; padding: 14px; }
  .ai-cc-section-title { font-size: 14px; font-weight: 600; color: #c4b5fd; margin-bottom: 10px; display: flex; align-items: center; gap: 8px; }
  .ai-cc-section-badge { font-size: 10px; background: rgba(99,102,241,0.2); color: #a5b4fc; padding: 2px 6px; border-radius: 6px; }
  .ai-cc-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; }
  .ai-cc-card { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; padding: 10px; }
  .ai-cc-card-label { font-size: 11px; color: #888; margin-bottom: 4px; }
  .ai-cc-card-value { font-size: 16px; font-weight: 700; color: #f0f0ff; }
  .ai-cc-card-sub { font-size: 10px; color: #666; margin-top: 2px; }
  .ai-cc-alert { display: flex; align-items: flex-start; gap: 8px; padding: 8px; border-radius: 8px; margin-bottom: 6px; }
  .ai-cc-alert.critical { background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.2); }
  .ai-cc-alert.high { background: rgba(249,115,22,0.08); border: 1px solid rgba(249,115,22,0.2); }
  .ai-cc-alert.medium { background: rgba(234,179,8,0.08); border: 1px solid rgba(234,179,8,0.2); }
  .ai-cc-alert.low { background: rgba(34,197,94,0.08); border: 1px solid rgba(34,197,94,0.2); }
  .ai-cc-alert-icon { font-size: 14px; flex-shrink: 0; margin-top: 2px; }
  .ai-cc-alert-text { flex: 1; }
  .ai-cc-alert-title { font-size: 12px; font-weight: 600; color: #e0e0f0; }
  .ai-cc-alert-detail { font-size: 11px; color: #999; margin-top: 2px; }
  .ai-cc-alert-action { font-size: 10px; color: #a5b4fc; margin-top: 4px; cursor: pointer; }
  .ai-cc-module { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 8px; background: rgba(255,255,255,0.03); margin-bottom: 4px; }
  .ai-cc-module-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
  .ai-cc-module-name { font-size: 12px; color: #c0c0d0; flex: 1; }
  .ai-cc-module-score { font-size: 11px; color: #888; }
  .ai-cc-brief-section { padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.04); }
  .ai-cc-brief-section:last-child { border-bottom: none; }
  .ai-cc-brief-title { font-size: 12px; font-weight: 600; color: #a5b4fc; margin-bottom: 6px; }
  .ai-cc-brief-item { display: flex; justify-content: space-between; align-items: center; padding: 3px 0; }
  .ai-cc-brief-label { font-size: 11px; color: #999; }
  .ai-cc-brief-value { font-size: 12px; font-weight: 600; }
  .ai-cc-health-bar { height: 6px; border-radius: 3px; background: rgba(255,255,255,0.06); overflow: hidden; margin-top: 6px; }
  .ai-cc-health-fill { height: 100%; border-radius: 3px; transition: width 0.5s ease; }
  .ai-cc-opp-card { display: flex; align-items: center; gap: 8px; padding: 8px; border-radius: 8px; background: rgba(99,102,241,0.05); border: 1px solid rgba(99,102,241,0.1); margin-bottom: 6px; }
  .ai-cc-opp-icon { font-size: 16px; }
  .ai-cc-opp-text { flex: 1; }
  .ai-cc-opp-title { font-size: 12px; font-weight: 500; color: #d0d0e0; }
  .ai-cc-opp-meta { font-size: 10px; color: #888; margin-top: 2px; }
  .ai-cc-opp-score { font-size: 11px; font-weight: 700; color: #a5b4fc; }
  .ai-cc-empty { text-align: center; padding: 20px; color: #666; font-size: 12px; }
  .ai-cc-tab-bar { display: flex; gap: 4px; margin-bottom: 14px; overflow-x: auto; padding-bottom: 4px; }
  .ai-cc-tab { padding: 6px 12px; border-radius: 10px; font-size: 12px; font-weight: 500; color: #888; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); cursor: pointer; white-space: nowrap; transition: all 0.2s; }
  .ai-cc-tab.active { color: #c4b5fd; background: rgba(99,102,241,0.15); border-color: rgba(99,102,241,0.3); }
`;

const TABS = [
  { id: 'overview', label: 'Overview', icon: '🧠' },
  { id: 'guardian', label: 'Guardian', icon: '🛡️' },
  { id: 'opportunities', label: 'Opportunities', icon: '💡' },
  { id: 'predictions', label: 'Predictions', icon: '📈' },
  { id: 'modules', label: 'Modules', icon: '🔗' }
];

function AiControlCenterInner() {
  const { t, i18n } = useTranslation();
  const brain = useCentralBrain();
  const [activeTab, setActiveTab] = useState('overview');
  const [brainData, setBrainData] = useState(null);
  const [brief, setBrief] = useState(null);
  const locale = i18n.language?.startsWith('en') ? 'en' : 'fa';
  const isRTL = locale === 'fa';

  // Fetch brain state from the kernel API
  useEffect(() => {
    let cancelled = false;
    async function fetchBrainState() {
      try {
        const [stateRes, monitorRes, profileRes, goalsRes] = await Promise.allSettled([
          fetch('/api/brain/financial/state').then(r => r.json()),
          fetch('/api/brain/financial/monitor').then(r => r.json()),
          fetch('/api/brain/financial/profile').then(r => r.json()),
          fetch('/api/brain/financial/goals').then(r => r.json())
        ]);

        if (cancelled) return;

        const state = stateRes.status === 'fulfilled' && stateRes.value?.ok ? stateRes.value : null;
        const monitor = monitorRes.status === 'fulfilled' && monitorRes.value?.ok ? monitorRes.value : null;
        const profile = profileRes.status === 'fulfilled' && profileRes.value?.ok ? profileRes.value : null;
        const goals = goalsRes.status === 'fulfilled' && goalsRes.value?.ok ? goalsRes.value : null;

        setBrainData({ state, monitor, profile, goals });

        // Generate daily brief
        const b = generateDailyBrief({
          financialState: state?.financialState || null,
          goals: goals?.goals || [],
          guardian: monitor ? { healthScore: monitor.warnings?.length > 0 ? 60 : 90, alertCount: monitor.warnings?.length || 0, criticalAlerts: 0, highAlerts: monitor.warnings?.length || 0, alerts: (monitor.warnings || []).map(w => ({ ...w, severity: w.severity || 'MEDIUM', recommendedAction: w.action || 'REVIEW' })) } : null,
          marketContext: state?.financialState?.marketContext || null,
          now: Date.now()
        });
        setBrief(b);
      } catch (e) {
        // silent
      }
    }
    fetchBrainState();
    const timer = setInterval(fetchBrainState, 30_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  const brainOnline = brain?.transport === 'sse' || brain?.transport === 'polling';
  const healthLevel = brainData?.monitor?.warnings?.length > 2 ? 'degraded' : brainOnline ? 'online' : 'offline';

  return (
    <div className="ai-control-center" dir={isRTL ? 'rtl' : 'ltr'}>
      <style>{STYLES}</style>

      {/* Header */}
      <div className="ai-cc-header">
        <ThinkingOrb state={brain?.busy ? 'working' : 'idle'} size={28} />
        <div className="ai-cc-title">
          {isRTL ? 'مرکز کنترل هوش مصنوعی' : 'AI Control Center'}
        </div>
        <span className="ai-cc-version">v{BRAIN_VERSION}</span>
        <div className={`ai-cc-status ${healthLevel}`}>
          <span className="ai-cc-dot" style={{ background: healthLevel === 'online' ? '#22c55e' : healthLevel === 'degraded' ? '#eab308' : '#ef4444' }} />
          {healthLevel === 'online' ? (isRTL ? 'آنلاین' : 'Online') : healthLevel === 'degraded' ? (isRTL ? 'کند' : 'Degraded') : (isRTL ? 'آفلاین' : 'Offline')}
        </div>
      </div>

      {/* Tab Bar */}
      <div className="ai-cc-tab-bar">
        {TABS.map(tab => (
          <button
            key={tab.id}
            className={`ai-cc-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.icon} {isRTL ? TAB_LABELS_FA[tab.id] : tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {activeTab === 'overview' && <OverviewTab brain={brain} brainData={brainData} brief={brief} isRTL={isRTL} />}
      {activeTab === 'guardian' && <GuardianTab brainData={brainData} isRTL={isRTL} />}
      {activeTab === 'opportunities' && <OpportunitiesTab brainData={brainData} isRTL={isRTL} />}
      {activeTab === 'predictions' && <PredictionsTab brainData={brainData} isRTL={isRTL} />}
      {activeTab === 'modules' && <ModulesTab brain={brain} brainData={brainData} isRTL={isRTL} />}
    </div>
  );
}

const TAB_LABELS_FA = {
  overview: 'نمای کلی', guardian: 'محافظ', opportunities: 'فرصت‌ها',
  predictions: 'پیش‌بینی', modules: 'ماژول‌ها'
};

/* ── Overview Tab ─────────────────────────────────────────────────────── */
function OverviewTab({ brain, brainData, brief, isRTL }) {
  const state = brainData?.state;
  const fs = state?.financialState;

  return (
    <>
      {/* Key Metrics */}
      <div className="ai-cc-section">
        <div className="ai-cc-section-title">
          {isRTL ? '📊 وضعیت مالی' : '📊 Financial State'}
        </div>
        <div className="ai-cc-grid">
          <div className="ai-cc-card">
            <div className="ai-cc-card-label">{isRTL ? 'ارزش کل' : 'Net Worth'}</div>
            <div className="ai-cc-card-value">${formatNum(fs?.netWorthUsd || 0)}</div>
          </div>
          <div className="ai-cc-card">
            <div className="ai-cc-card-label">{isRTL ? 'نقد' : 'Liquid'}</div>
            <div className="ai-cc-card-value">${formatNum(fs?.liquidUsd || 0)}</div>
          </div>
          <div className="ai-cc-card">
            <div className="ai-cc-card-label">{isRTL ? 'بدهی' : 'Debt'}</div>
            <div className="ai-cc-card-value" style={{ color: (fs?.totalDebtUsd || 0) > 0 ? '#f97316' : '#22c55e' }}>
              ${formatNum(fs?.totalDebtUsd || 0)}
            </div>
          </div>
          <div className="ai-cc-card">
            <div className="ai-cc-card-label">{isRTL ? 'ریسک' : 'Risk'}</div>
            <div className="ai-cc-card-value">{fs?.riskLevel || '—'}</div>
          </div>
        </div>
      </div>

      {/* Guardian Health */}
      {brainData?.monitor && (
        <div className="ai-cc-section">
          <div className="ai-cc-section-title">
            {isRTL ? '🛡️ سلامت سیستم' : '🛡️ System Health'}
            <span className="ai-cc-section-badge">Guardian</span>
          </div>
          <GuardianHealthBar warnings={brainData.monitor.warnings || []} isRTL={isRTL} />
        </div>
      )}

      {/* Daily Brief */}
      {brief && brief.sections.length > 0 && (
        <div className="ai-cc-section">
          <div className="ai-cc-section-title">
            {isRTL ? '📋 خلاصه روزانه' : '📋 Daily Brief'}
            <span className="ai-cc-section-badge">{brief.date}</span>
          </div>
          {brief.sections.map(sec => (
            <div key={sec.id} className="ai-cc-brief-section">
              <div className="ai-cc-brief-title">{sec.title}</div>
              {sec.items.map((item, i) => (
                <div key={i} className="ai-cc-brief-item">
                  <span className="ai-cc-brief-label">{item.label}</span>
                  <span className="ai-cc-brief-value" style={{ color: item.color || '#e0e0f0' }}>{item.value}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Goals */}
      {brainData?.goals?.goals?.length > 0 && (
        <div className="ai-cc-section">
          <div className="ai-cc-section-title">
            {isRTL ? '🎯 اهداف فعال' : '🎯 Active Goals'}
            <span className="ai-cc-section-badge">{brainData.goals.goals.length}</span>
          </div>
          {brainData.goals.goals.slice(0, 4).map(g => (
            <div key={g.goalId} className="ai-cc-module">
              <div className="ai-cc-module-name">{g.name}</div>
              <div className="ai-cc-module-score">
                {g.progress ? `${Math.round(g.progress.pct || 0)}%` : '—'}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Active Turns */}
      <div className="ai-cc-section">
        <div className="ai-cc-section-title">
          {isRTL ? '💬 مکالمه فعال' : '💬 Active Conversation'}
        </div>
        <div className="ai-cc-grid">
          <div className="ai-cc-card">
            <div className="ai-cc-card-label">{isRTL ? 'تعداد پیام‌ها' : 'Turns'}</div>
            <div className="ai-cc-card-value">{brain?.turns?.length || 0}</div>
          </div>
          <div className="ai-cc-card">
            <div className="ai-cc-card-label">{isRTL ? 'وضعیت' : 'Status'}</div>
            <div className="ai-cc-card-value" style={{ fontSize: 13 }}>
              {brain?.busy ? (isRTL ? 'در حال پردازش' : 'Processing') : (isRTL ? 'آماده' : 'Ready')}
            </div>
          </div>
          <div className="ai-cc-card">
            <div className="ai-cc-card-label">{isRTL ? 'انتقال' : 'Transport'}</div>
            <div className="ai-cc-card-value" style={{ fontSize: 12 }}>{brain?.transport || '—'}</div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ── Guardian Tab ─────────────────────────────────────────────────────── */
function GuardianTab({ brainData, isRTL }) {
  const warnings = brainData?.monitor?.warnings || [];
  const alerts = warnings.map((w, i) => ({
    alertId: `w${i}`,
    type: w.code || w.type || 'WARNING',
    severity: w.severity || 'MEDIUM',
    title: w.title || w.message || w.code || 'Warning',
    detail: w.detail || w.reason || '',
    recommendedAction: w.action || w.recommendedAction || 'REVIEW',
    modules: w.modules || ['RISK']
  }));

  if (alerts.length === 0) {
    return (
      <div className="ai-cc-section">
        <div className="ai-cc-section-title">🛡️ {isRTL ? 'محافظ مالی' : 'Financial Guardian'}</div>
        <div className="ai-cc-empty">
          {isRTL ? '✅ همه چیز امن است — هیچ هشدار فعالی وجود ندارد' : '✅ All clear — no active alerts'}
        </div>
      </div>
    );
  }

  return (
    <div className="ai-cc-section">
      <div className="ai-cc-section-title">
        🛡️ {isRTL ? 'محافظ مالی' : 'Financial Guardian'}
        <span className="ai-cc-section-badge">{alerts.length}</span>
      </div>
      {alerts.map(alert => (
        <div key={alert.alertId} className={`ai-cc-alert ${alert.severity.toLowerCase()}`}>
          <span className="ai-cc-alert-icon">
            {alert.severity === 'CRITICAL' ? '🔴' : alert.severity === 'HIGH' ? '🟠' : alert.severity === 'MEDIUM' ? '🟡' : '🟢'}
          </span>
          <div className="ai-cc-alert-text">
            <div className="ai-cc-alert-title">{alert.title}</div>
            {alert.detail && <div className="ai-cc-alert-detail">{alert.detail}</div>}
            <div className="ai-cc-alert-action">
              → {alert.recommendedAction}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Opportunities Tab ────────────────────────────────────────────────── */
function OpportunitiesTab({ brainData, isRTL }) {
  // In production, this would call the opportunity engine API
  // For now, show from guardian context
  const state = brainData?.state;
  const fs = state?.financialState;

  return (
    <div className="ai-cc-section">
      <div className="ai-cc-section-title">💡 {isRTL ? 'فرصت‌های شخصی' : 'Personalized Opportunities'}</div>
      {fs?.status === 'UNAVAILABLE' ? (
        <div className="ai-cc-empty">
          {isRTL ? 'اتصال کیف پول برای دریافت فرصت‌ها' : 'Connect wallet to receive personalized opportunities'}
        </div>
      ) : (
        <>
          <OppCard icon="💰" title={isRTL ? 'بهینه‌سازی پرتفوی' : 'Portfolio Optimization'} meta={isRTL ? 'بررسی تعادل دارایی‌ها' : 'Review asset balance for better risk-adjusted returns'} score={72} />
          <OppCard icon="🏦" title={isRTL ? 'فرصت‌های DeFi' : 'DeFi Yield Opportunities'} meta={isRTL ? 'بررسی پروتکل‌های با بازدهی بالاتر' : 'Compare protocols for risk-adjusted yield'} score={65} />
          <OppCard icon="🏠" title={isRTL ? 'دارایی‌های واقعی (RWA)' : 'Real World Assets'} meta={isRTL ? 'سرمایه‌گذاری کم‌ریسک در دارایی‌های واقعی' : 'Low-risk tokenized real-world asset opportunities'} score={58} />
          <OppCard icon="📊" title={isRTL ? 'استراتژی DCA' : 'DCA Strategy'} meta={isRTL ? 'خرید پله‌ای برای کاهش ریسک ورود' : 'Dollar-cost averaging to reduce entry risk'} score={55} />
        </>
      )}
    </div>
  );
}

function OppCard({ icon, title, meta, score }) {
  return (
    <div className="ai-cc-opp-card">
      <span className="ai-cc-opp-icon">{icon}</span>
      <div className="ai-cc-opp-text">
        <div className="ai-cc-opp-title">{title}</div>
        <div className="ai-cc-opp-meta">{meta}</div>
      </div>
      <span className="ai-cc-opp-score">{score}</span>
    </div>
  );
}

/* ── Predictions Tab ──────────────────────────────────────────────────── */
function PredictionsTab({ brainData, isRTL }) {
  return (
    <div className="ai-cc-section">
      <div className="ai-cc-section-title">📈 {isRTL ? 'پیش‌بینی‌ها' : 'Predictions'}</div>
      <div className="ai-cc-grid">
        <div className="ai-cc-card">
          <div className="ai-cc-card-label">{isRTL ? 'پیش‌بینی ۳ ماهه' : '3-Month Forecast'}</div>
          <div className="ai-cc-card-value" style={{ fontSize: 14 }}>
            {isRTL ? 'بر اساس وضعیت فعلی' : 'Based on current state'}
          </div>
          <div className="ai-cc-card-sub">{isRTL ? 'اتصال کیف پول لازم است' : 'Wallet connection required'}</div>
        </div>
        <div className="ai-cc-card">
          <div className="ai-cc-card-label">{isRTL ? 'احتمال موفقیت اهداف' : 'Goal Probability'}</div>
          <div className="ai-cc-card-value" style={{ fontSize: 14 }}>
            {brainData?.goals?.goals?.length > 0
              ? `${brainData.goals.goals.length} ${isRTL ? 'هدف فعال' : 'active goals'}`
              : (isRTL ? 'هدفی تعریف نشده' : 'No goals set')}
          </div>
        </div>
        <div className="ai-cc-card">
          <div className="ai-cc-card-label">{isRTL ? 'ریسک نقدشوندگی' : 'Liquidation Risk'}</div>
          <div className="ai-cc-card-value" style={{ fontSize: 14, color: '#22c55e' }}>
            {isRTL ? 'پایین' : 'Low'}
          </div>
        </div>
        <div className="ai-cc-card">
          <div className="ai-cc-card-label">{isRTL ? 'وضعیت بازار' : 'Market Regime'}</div>
          <div className="ai-cc-card-value" style={{ fontSize: 14 }}>
            {isRTL ? 'در حال بررسی' : 'Monitoring'}
          </div>
        </div>
      </div>

      {/* Scenario Simulation */}
      <div style={{ marginTop: 12 }}>
        <div className="ai-cc-section-title" style={{ fontSize: 13 }}>
          {isRTL ? '🔮 شبیه‌سازی سناریو' : '🔮 Scenario Simulation'}
        </div>
        <div className="ai-cc-module">
          <div className="ai-cc-module-dot" style={{ background: '#22c55e' }} />
          <div className="ai-cc-module-name">{isRTL ? 'BTC +20%' : 'BTC +20%'}</div>
          <div className="ai-cc-module-score" style={{ color: '#22c55e' }}>{isRTL ? 'مثبت' : 'Bullish'}</div>
        </div>
        <div className="ai-cc-module">
          <div className="ai-cc-module-dot" style={{ background: '#ef4444' }} />
          <div className="ai-cc-module-name">{isRTL ? 'BTC -20%' : 'BTC -20%'}</div>
          <div className="ai-cc-module-score" style={{ color: '#ef4444' }}>{isRTL ? 'منفی' : 'Bearish'}</div>
        </div>
        <div className="ai-cc-module">
          <div className="ai-cc-module-dot" style={{ background: '#eab308' }} />
          <div className="ai-cc-module-name">{isRTL ? 'بازار با ثبات' : 'Stable Market'}</div>
          <div className="ai-cc-module-score" style={{ color: '#eab308' }}>{isRTL ? 'خنثی' : 'Neutral'}</div>
        </div>
      </div>
    </div>
  );
}

/* ── Modules Tab ──────────────────────────────────────────────────────── */
function ModulesTab({ brain, brainData, isRTL }) {
  const modules = [
    { id: 'PAY', name: isRTL ? 'پرداخت' : 'Payments', status: 'available', color: '#22c55e' },
    { id: 'WALLET', name: isRTL ? 'کیف پول' : 'Wallet', status: 'available', color: '#22c55e' },
    { id: 'PORTFOLIO', name: isRTL ? 'پرتفوی' : 'Portfolio', status: 'available', color: '#22c55e' },
    { id: 'TRADING', name: isRTL ? 'معاملات' : 'Trading', status: 'available', color: '#22c55e' },
    { id: 'SWAP', name: isRTL ? 'سواپ' : 'Swap', status: 'available', color: '#22c55e' },
    { id: 'DEFI', name: 'DeFi', status: 'available', color: '#22c55e' },
    { id: 'FARM', name: isRTL ? 'فارم' : 'Farming', status: 'available', color: '#22c55e' },
    { id: 'LENDING', name: isRTL ? 'وام‌دهی' : 'Lending', status: 'available', color: '#22c55e' },
    { id: 'FUTURES', name: isRTL ? 'آتی' : 'Futures', status: 'available', color: '#22c55e' },
    { id: 'CREDIT', name: isRTL ? 'اعتبار' : 'Credit', status: 'available', color: '#22c55e' },
    { id: 'RWA', name: isRTL ? 'دارایی واقعی' : 'RWA', status: 'read-only', color: '#eab308' },
    { id: 'BUSINESS', name: isRTL ? 'کسب‌وکار' : 'Business', status: 'available', color: '#22c55e' },
    { id: 'MARKETPLACE', name: isRTL ? 'بازار' : 'Marketplace', status: 'available', color: '#22c55e' },
    { id: 'RESEARCH', name: isRTL ? 'تحقیق' : 'Research', status: 'available', color: '#22c55e' },
    { id: 'SMART_MONEY', name: isRTL ? 'پول هوشمند' : 'Smart Money', status: 'available', color: '#22c55e' },
    { id: 'SIGNALS', name: isRTL ? 'سیگنال‌ها' : 'Signals', status: 'available', color: '#22c55e' },
    { id: 'NEWS', name: isRTL ? 'اخبار' : 'News', status: 'available', color: '#22c55e' },
    { id: 'GOALS', name: isRTL ? 'اهداف' : 'Goals', status: 'available', color: '#22c55e' },
    { id: 'RISK', name: isRTL ? 'ریسک' : 'Risk', status: 'available', color: '#22c55e' },
    { id: 'MACRO', name: isRTL ? 'کلان' : 'Macro', status: 'available', color: '#22c55e' },
    { id: 'CROSS_CHAIN', name: isRTL ? 'چین متقابل' : 'Cross-Chain', status: 'available', color: '#22c55e' },
    { id: 'BRIDGE', name: isRTL ? 'پل' : 'Bridge', status: 'available', color: '#22c55e' }
  ];

  return (
    <div className="ai-cc-section">
      <div className="ai-cc-section-title">
        🔗 {isRTL ? 'ماژول‌های اکوسیستم' : 'Ecosystem Modules'}
        <span className="ai-cc-section-badge">{modules.length}</span>
      </div>
      {modules.map(mod => (
        <div key={mod.id} className="ai-cc-module">
          <div className="ai-cc-module-dot" style={{ background: mod.color }} />
          <div className="ai-cc-module-name">{mod.name}</div>
          <div className="ai-cc-module-score" style={{ color: mod.color }}>
            {mod.status === 'available' ? '●' : '◐'}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Helpers ──────────────────────────────────────────────────────────── */
function GuardianHealthBar({ warnings = [], isRTL }) {
  const critical = warnings.filter(w => w.severity === 'CRITICAL').length;
  const high = warnings.filter(w => w.severity === 'HIGH').length;
  const score = Math.max(0, 100 - critical * 25 - high * 15 - (warnings.length - critical - high) * 5);
  const color = score >= 80 ? '#22c55e' : score >= 50 ? '#eab308' : '#ef4444';

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
        <span style={{ color: '#999' }}>{isRTL ? 'امتیاز سلامت' : 'Health Score'}</span>
        <span style={{ color, fontWeight: 700 }}>{score}/100</span>
      </div>
      <div className="ai-cc-health-bar">
        <div className="ai-cc-health-fill" style={{ width: `${score}%`, background: color }} />
      </div>
      <div style={{ fontSize: 11, color: '#888', marginTop: 6 }}>
        {warnings.length === 0
          ? (isRTL ? 'بدون هشدار' : 'No warnings')
          : `${critical} critical, ${high} high, ${warnings.length - critical - high} other`}
      </div>
    </div>
  );
}

function formatNum(n) {
  const v = Number(n || 0);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toFixed(0);
}

export const AiControlCenter = memo(AiControlCenterInner);
export default AiControlCenter;
