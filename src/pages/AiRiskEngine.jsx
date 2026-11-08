/**
 * FBT AI RISK ENGINE — THE PAGE
 * ===========================================================================
 * «موتور ریسک FBT فقط یک درصد ریسک یا سیگنال خرید و فروش نباشد؛ سیستمی هوشمند
 *  برای مدیریت، پیش‌بینی، شبیه‌سازی و کنترل ریسک در کل اکوسیستم FBT.»
 *
 * Seven rooms, one evidence spine, and one number that is allowed to be
 * missing:
 *
 *   Overview · Heatmap · Live monitor · Alerts · Stress test · Actions
 *
 * ─── THE THREE PHASES THE REQUIREMENT ASKS FOR ──────────────────────────────
 * The engine serves all three, and the page shows which one you are in:
 *
 *   BEFORE      the score, the families, the heat map and the stress centre all
 *               answer "what could happen to this capital, and how likely".
 *               <RiskTradeGate> is the pre-trade form of the same question.
 *   DURING      the live monitor compares readings and names the family that
 *               moved; the alerts explain a measured change with its cause.
 *   AFTER       <RiskPostTradeAudit> puts the prediction next to the measured
 *               outcome, so the tool is accountable to its own advice.
 *
 * ─── WHAT THIS PAGE REFUSES TO DO ───────────────────────────────────────────
 *   · It does not print a score it could not derive. No wallet → no portfolio
 *     score; insufficient coverage → no green band.
 *   · It does not paint red unless the engine's own band says `serious`.
 *   · It does not execute, sign, or move funds. `report.laws` is printed, not
 *     implied.
 *   · It does not poll anything faster than the rest of the app already does.
 */
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition from '../components/PageTransition.jsx';
import { IconChevronLeft, IconInfo, IconRefresh, IconShield, IconAlertTriangle } from '../components/Icons.jsx';
import { useHideBalances } from '../hooks/useHideBalances.js';
import { useRiskEngine } from '../hooks/useRiskEngine.js';
import { useMarketRoom } from '../hooks/useIntelligenceRooms.js';
import { RISK_BANDS, RISK_TAXONOMY_VERSION } from '../lib/risk/taxonomy.js';
import { RISK_ENGINE_VERSION } from '../lib/risk/riskEngine.js';
import { rt, fmtUsdShort } from '../lib/risk/copy.js';
import { fmtTimeAgo } from '../lib/intelligence/copy.js';
import OverviewTab from '../components/ai/risk/OverviewTab.jsx';
import HeatmapTab from '../components/ai/risk/HeatmapTab.jsx';
import MonitorTab from '../components/ai/risk/MonitorTab.jsx';
import AlertsTab from '../components/ai/risk/AlertsTab.jsx';
import StressTab from '../components/ai/risk/StressTab.jsx';
import ActionsTab from '../components/ai/risk/ActionsTab.jsx';
import '../styles/ai-analysis.css';
import '../styles/ai-analysis-modern.css';
import '../styles/ai-analysis-refined.css';
import '../styles/risk-engine.css';

const TABS = [
  { id: 'overview', key: 'tab.overview', icon: IconShield },
  { id: 'heatmap', key: 'tab.heatmap', icon: IconInfo },
  { id: 'monitor', key: 'tab.monitor', icon: IconRefresh },
  { id: 'alerts', key: 'tab.alerts', icon: IconAlertTriangle },
  { id: 'stress', key: 'tab.stress', icon: IconAlertTriangle },
  { id: 'actions', key: 'tab.actions', icon: IconShield }
];

/** The tab rail — same contract as AnalysisTabs, without its icon table. */
function RiskTabs({ tabs, active, onChange, locale, label }) {
  return (
    <nav className="aix-tabs rk-tabs" aria-label={label} role="tablist">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`rk-tab-${tab.id}`}
            aria-selected={isActive}
            aria-controls="rk-panel"
            tabIndex={isActive ? 0 : -1}
            className={`aix-tab${isActive ? ' is-active' : ''}`}
            onClick={() => onChange(tab.id)}
          >
            {Icon ? <Icon width={15} height={15} /> : null}
            <span>{rt(locale, tab.key)}</span>
          </button>
        );
      })}
    </nav>
  );
}

export default function AiRiskEngine() {
  useHideBalances();
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const locale = i18n.language?.startsWith('fa') ? 'fa' : 'en';
  const isRTL = locale === 'fa';

  const [tab, setTab] = useState('overview');
  const [sourcesOpen, setSourcesOpen] = useState(false);

  const {
    connected, loading, report, stress, monitor, evidence, resetMonitor, refresh, coverage, performance
  } = useRiskEngine({ enabled: true });

  /* The market pulse is the intelligence page's own read — the risk page does
     not open a second market feed. `useMarketRoom` polls at 45s, which is the
     cadence the whole app already runs at. */
  const { pulse } = useMarketRoom({ enabled: true });

  const bands = useMemo(() => RISK_BANDS, []);
  const severityCount = useMemo(
    () => (report.alerts || []).filter((a) => a.severity === 'critical').length,
    [report.alerts]
  );

  const refreshAll = useCallback(() => {
    refresh?.();
  }, [refresh]);

  const renderTab = () => {
    switch (tab) {
      case 'heatmap':
        return <HeatmapTab locale={locale} report={report} bands={bands} />;
      case 'monitor':
        return <MonitorTab locale={locale} monitor={monitor} report={report} onReset={resetMonitor} />;
      case 'alerts':
        return <AlertsTab locale={locale} report={report} />;
      case 'stress':
        return <StressTab locale={locale} stress={stress} report={report} />;
      case 'actions':
        return <ActionsTab locale={locale} report={report} />;
      default:
        return (
          <OverviewTab
            locale={locale}
            report={report}
            pulse={pulse}
            performance={performance}
            stress={stress}
            bands={bands}
          />
        );
    }
  };

  const statusTone = report.score.tone;

  return (
    <PageTransition>
      <div className="aix-page rk-page" dir={isRTL ? 'rtl' : 'ltr'}>
        <header className="aix-header">
          <div className="aix-header-line">
            <button type="button" className="icon-btn aix-back" onClick={() => navigate(-1)} aria-label={rt(locale, 'page.close')}>
              <IconChevronLeft width={18} height={18} />
            </button>
            <div className="aix-head-main">
              <span className="aix-eyebrow" aria-hidden="true">
                <span>FBT</span>
                <i />
                <span>{rt(locale, 'page.eyebrow')}</span>
              </span>
              <h1 className="aix-title">
                <span className="aix-title-mark"><IconShield width={19} height={19} /></span>
                <span>{rt(locale, 'page.title')}</span>
              </h1>
            </div>
            <div className="aix-head-actions">
              <button type="button" className="aix-cta aix-cta-ghost aix-head-action" onClick={refreshAll} aria-label={rt(locale, 'page.refresh')} title={rt(locale, 'page.refresh')}>
                <IconRefresh width={16} height={16} />
                <span>{rt(locale, 'page.refresh')}</span>
              </button>
              <button type="button" className="aix-cta aix-cta-ghost aix-head-action" onClick={() => setSourcesOpen(true)} aria-label={rt(locale, 'page.sources')} title={rt(locale, 'page.sources')}>
                <IconInfo width={16} height={16} />
                <span>{rt(locale, 'page.sources')}</span>
              </button>
            </div>
          </div>
          <p className="aix-subtitle">{rt(locale, 'page.subtitle')}</p>
        </header>

        <div className={`aix-statusbar rk-statusbar rk-t-${statusTone}`}>
          <span className="aix-status-primary">
            <span className="aix-status-dot" aria-hidden="true" />
            <b>{connected ? rt(locale, 'page.wallet') : rt(locale, 'page.noWallet')}</b>
          </span>
          <span className="aix-status-sep" aria-hidden="true">·</span>
          <span className="aix-status-item">
            {rt(locale, 'page.total')}: <b>{connected ? fmtUsdShort(report.totalUsd) : '—'}</b>
          </span>
          <span className="aix-status-item">
            {rt(locale, 'page.coverage')}: <b>{report.score.coverage == null ? '—' : `${Math.round(report.score.coverage * 100)}%`}</b>
          </span>
          <span className="aix-status-item">
            {rt(locale, 'page.confidence')}: <b>{`${report.score.confidence ?? 0}%`}</b>
          </span>
          <span className="aix-status-item aix-status-currency">
            {rt(locale, 'page.updated', { time: fmtTimeAgo(report.generatedAt, locale) })}
          </span>
        </div>

        {severityCount > 0 ? (
          <div className="rk-banner" role="status">
            <IconAlertTriangle width={16} height={16} />
            <span>{rt(locale, 'alerts.count.critical', { n: severityCount })}</span>
            <button type="button" className="rk-banner-link" onClick={() => setTab('alerts')}>
              {rt(locale, 'alerts.title')}
            </button>
          </div>
        ) : null}

        <RiskTabs tabs={TABS} active={tab} onChange={setTab} locale={locale} label={rt(locale, 'page.title')} />

        <main
          className="aix-main rk-main"
          id="rk-panel"
          role="tabpanel"
          aria-labelledby={`rk-tab-${tab}`}
          tabIndex={0}
          key={tab}
        >
          {loading && report.score.value == null ? (
            <p className="aix-loading">{rt(locale, 'page.loading')}</p>
          ) : renderTab()}
        </main>

        <p className="aix-disclaimer">{rt(locale, 'page.notAdvice')}</p>

        {sourcesOpen ? (
          <div className="aix-sources-backdrop" role="dialog" aria-modal="true" aria-label={rt(locale, 'page.sources')} onClick={() => setSourcesOpen(false)}>
            <div className="aix-sources rk-sources" onClick={(e) => e.stopPropagation()}>
              <header>
                <h2>{rt(locale, 'page.sources')}</h2>
                <button type="button" className="icon-btn" onClick={() => setSourcesOpen(false)} aria-label={rt(locale, 'page.close')}>✕</button>
              </header>

              <div className="aix-src-row">
                <span>{rt(locale, 'sources.market')}</span>
                <b>{locale === 'fa' ? 'بازار FBT / CoinGecko' : 'FBT market API / CoinGecko'}</b>
                <em>{`${evidence?.marketRows ?? 0}`}</em>
              </div>
              <div className="aix-src-row">
                <span>{rt(locale, 'sources.portfolio')}</span>
                <b>{locale === 'fa' ? 'خواندن مستقیم از شبکه' : 'Direct on-chain read'}</b>
                <em>{coverage ? `${coverage.readChains}/${coverage.totalChains}` : '—'}</em>
              </div>
              <div className="aix-src-row">
                <span>{rt(locale, 'sources.contracts')}</span>
                <b>GoPlus</b>
                <em>{`${evidence?.contractsScanned ?? 0}/${evidence?.contractTargets ?? 0}`}</em>
              </div>
              <div className="aix-src-row">
                <span>{rt(locale, 'sources.lending')}</span>
                <b>{locale === 'fa' ? 'BFF وام' : 'Lending BFF'}</b>
                <em>{evidence?.lending ?? 'idle'}</em>
              </div>
              <div className="aix-src-row">
                <span>{rt(locale, 'sources.providers')}</span>
                <b>/api/providers/status</b>
                <em>{evidence?.providers ? `${evidence.providers}` : '—'}</em>
              </div>

              <h3>{rt(locale, 'sources.missing')}</h3>
              <p className="aix-card-hint">{rt(locale, 'sources.missingNote')}</p>
              <div className="aix-sources-missing">
                {(report.unavailable || []).map((key) => (
                  <span key={key}>{rt(locale, `unavailable.${key}`) === `unavailable.${key}` ? key : rt(locale, `unavailable.${key}`)}</span>
                ))}
              </div>

              <h3>{locale === 'fa' ? 'قانون‌های این موتور' : 'This engine’s laws'}</h3>
              <ul className="rk-laws">
                <li>{locale === 'fa' ? 'اجرا نمی‌کند' : 'Does not execute'}</li>
                <li>{locale === 'fa' ? 'امضا نمی‌کند' : 'Does not sign'}</li>
                <li>{locale === 'fa' ? 'وجهی جابه‌جا نمی‌کند' : 'Does not move funds'}</li>
                <li>{locale === 'fa' ? 'توصیهٔ سرمایه‌گذاری نیست' : 'Not investment advice'}</li>
                <li>{locale === 'fa' ? 'قیمت نمی‌سازد' : 'Invents no price'}</li>
                <li>{locale === 'fa' ? 'شبیه‌سازی با بذر ثابت' : 'Seeded simulation'}</li>
              </ul>
              <p className="aix-foot-note">
                {`${RISK_ENGINE_VERSION} · ${RISK_TAXONOMY_VERSION}`}
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </PageTransition>
  );
}
