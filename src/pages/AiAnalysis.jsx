/**
 * FBT AI INTELLIGENCE — the analysis centre
 * ---------------------------------------------------------------------------
 * «بخش AI Analysis را از یک صفحه ساده نمایش قیمت به یک مرکز تحلیل حرفه‌ای
 *  بازار تبدیل کن»
 *
 * Eight rooms, one data spine:
 *
 *   Overview · Screener · Token · Portfolio · Opportunities · Compare · Report · Scenario
 *
 * ─── THE SPINE ──────────────────────────────────────────────────────────────
 * Every number on every tab comes from a pure engine in lib/intelligence and
 * from feeds the app already polls — no second market API, no placeholder price
 * and no generated number:
 *
 *   /api/markets + /api/global  →  buildMarketPulse()      (Overview)
 *                               →  scanOpportunities()      (Opportunities)
 *   /api/ohlc/:id               →  computeIndicators()      (Token)
 *                               →  scoreToken()             (Token score)
 *   wallet balances + lots      →  buildIntelligence()      (Portfolio)
 *   /api/ohlc per holding       →  correlationMatrix()      (Portfolio risk)
 *
 * ─── WHAT IT WILL NOT DO ────────────────────────────────────────────────────
 * · It never prints a feed it does not have (Fear & Greed, open interest,
 *   funding, liquidations, exchange net-flow are named as missing instead).
 * · It never converts a missing value to 0 — tables show an em dash.
 * · It never turns a wallet balance into a P&L without a recorded cost basis.
 * · It never renders a recommendation; suggestions are labelled with horizon,
 *   risk, confidence and "not investment advice".
 */
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition from '../components/PageTransition';
import { IconChevronLeft, IconInfo, IconRefresh, IconSparkle } from '../components/Icons';
import { useHideBalances } from '../hooks/useHideBalances';
import { fmtTimeAgo, t as ct } from '../lib/intelligence/copy';
import {
  useMarketRoom,
  usePortfolioRoom,
  useTokenRoom
} from '../hooks/useIntelligenceRooms';
import OverviewTab from '../components/ai/analysis/OverviewTab';
import ScreenerTab from '../components/ai/analysis/ScreenerTab';
import TokenTab from '../components/ai/analysis/TokenTab';
import PortfolioTab from '../components/ai/analysis/PortfolioTab';
import OpportunitiesTab from '../components/ai/analysis/OpportunitiesTab';
import CompareTab from '../components/ai/analysis/CompareTab';
import ReportTab from '../components/ai/analysis/ReportTab';
import AnalysisTabs from '../components/ai/analysis/AnalysisTabs';
import ScenarioTab from '../components/ai/analysis/ScenarioTab';
import '../styles/ai-analysis.css';
import '../styles/ai-analysis-modern.css';
import '../styles/ai-analysis-refined.css';

const TABS = [
  { id: 'overview', key: 'tab.overview' },
  { id: 'screener', key: 'tab.screener' },
  { id: 'token', key: 'tab.token' },
  { id: 'portfolio', key: 'tab.portfolio' },
  { id: 'opportunities', key: 'tab.opportunities' },
  { id: 'compare', key: 'tab.compare' },
  { id: 'report', key: 'tab.report' },
  { id: 'scenario', key: 'tab.scenario' }
];

const PROV_KEY = { live: 'page.live', stale: 'page.stale', offline: 'page.offline', unknown: 'page.unknown' };

export default function AiAnalysis() {
  useHideBalances();
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const locale = i18n.language?.startsWith('fa') ? 'fa' : 'en';
  const isRTL = locale === 'fa';

  const [tab, setTab] = useState('overview');
  const [tokenId, setTokenId] = useState('bitcoin');
  const [days, setDays] = useState(90);
  const [sourcesOpen, setSourcesOpen] = useState(false);

  /* The spine lives in hooks/useIntelligenceRooms so the chat rooms and this
     page can never disagree about a number. */
  const {
    markets, pulse, scan, analysis, updatedAt, loading: marketLoading, error: marketError, refresh: refreshMarket
  } = useMarketRoom();

  const {
    pack, coin, score, loading: ohlcLoading, refresh: refreshOhlc
  } = useTokenRoom({ tokenId, days, markets });

  const {
    connected, intel, analysis: portfolioAnalysis, review: portfolioReview,
    performance: portfolioPerformance, coverage, rows,
    loading: portfolioLoading, correlationStatus
  } = usePortfolioRoom();

  const openToken = useCallback((id) => {
    if (!id) return;
    setTokenId(id);
    setTab('token');
  }, []);

  const refreshAll = useCallback(() => {
    refreshMarket?.();
    refreshOhlc?.();
  }, [refreshMarket, refreshOhlc]);

  const sourceLabel = markets[0]?.marketProvider === 'coingecko' ? 'CoinGecko' : 'FBT market API';

  const renderTab = () => {
    if (tab !== 'scenario' && !pulse && (marketLoading || !markets.length)) {
      return <p className="aix-loading">{ct(locale, 'page.loading')}</p>;
    }
    switch (tab) {
      case 'screener':
        return (
          <ScreenerTab
            markets={markets}
            locale={locale}
            updatedAt={updatedAt}
            provenance={pulse?.provenance}
            onOpenToken={openToken}
          />
        );
      case 'token':
        return (
          <TokenTab
            markets={markets}
            locale={locale}
            selectedId={tokenId}
            onSelect={setTokenId}
            pack={pack}
            score={score}
            coin={coin}
            loading={ohlcLoading}
            days={days}
            onDays={setDays}
            onOpenFull={(id) => navigate(`/coin/${id}`)}
          />
        );
      case 'portfolio':
        return (
          <PortfolioTab
            connected={connected}
            intel={intel}
            analysis={portfolioAnalysis}
            review={portfolioReview}
            performance={portfolioPerformance}
            locale={locale}
            onConnect={(path) => navigate(path)}
            loading={portfolioLoading}
            coverage={coverage}
            onOpenToken={(symbol) => {
              if (!symbol) return;
              const hit = markets.find((m) => String(m.symbol).toUpperCase() === String(symbol).toUpperCase());
              if (hit) openToken(hit.id);
            }}
          />
        );
      case 'opportunities':
        return <OpportunitiesTab scan={scan} locale={locale} onOpenToken={openToken} />;
      case 'compare':
        return (
          <CompareTab
            markets={markets}
            locale={locale}
            initial={[tokenId, 'ethereum', 'solana'].filter(Boolean)}
          />
        );
      case 'scenario':
        return <ScenarioTab locale={locale} markets={markets} tokenId={tokenId} updatedAt={updatedAt} connected={connected} holdings={rows} />;
      case 'report':
        return <ReportTab pulse={pulse} scan={scan} locale={locale} markets={markets} sourceLabel={sourceLabel} />;
      default:
        return <OverviewTab pulse={pulse} analysis={analysis} locale={locale} onOpenToken={openToken} />;
    }
  };

  return (
    <PageTransition>
      <div className="aix-page" dir={isRTL ? 'rtl' : 'ltr'}>
        <header className="aix-header">
          <div className="aix-header-line">
            <button type="button" className="icon-btn aix-back" onClick={() => navigate(-1)} aria-label={ct(locale, 'page.close')}>
              <IconChevronLeft width={18} height={18} />
            </button>
            <div className="aix-head-main">
              <span className="aix-eyebrow" aria-hidden="true">
                <span>FBT</span>
                <i />
                <span>AI INTELLIGENCE</span>
              </span>
              <h1 className="aix-title">
                <span className="aix-title-mark"><IconSparkle width={19} height={19} /></span>
                <span>{ct(locale, 'page.title')}</span>
              </h1>
            </div>
            <div className="aix-head-actions">
              <button type="button" className="aix-cta aix-cta-ghost aix-head-action" onClick={refreshAll} aria-label={ct(locale, 'page.refresh')} title={ct(locale, 'page.refresh')}>
                <IconRefresh width={16} height={16} />
                <span>{ct(locale, 'page.refresh')}</span>
              </button>
              <button type="button" className="aix-cta aix-cta-ghost aix-head-action" onClick={() => setSourcesOpen(true)} aria-label={ct(locale, 'page.sources')} title={ct(locale, 'page.sources')}>
                <IconInfo width={16} height={16} />
                <span>{ct(locale, 'page.sources')}</span>
              </button>
            </div>
          </div>
          <p className="aix-subtitle">{ct(locale, 'page.subtitle')}</p>
        </header>

        <div className={`aix-statusbar aix-status-${pulse?.provenance || 'unknown'}`}>
          <span className="aix-status-primary">
            <span className="aix-status-dot" aria-hidden="true" />
            <b>{ct(locale, PROV_KEY[pulse?.provenance || 'unknown'])}</b>
          </span>
          <span className="aix-status-item">{ct(locale, 'page.updated', { time: fmtTimeAgo(updatedAt, locale) })}</span>
          <span className="aix-status-sep" aria-hidden="true">·</span>
          <span className="aix-status-item">{pulse ? ct(locale, 'page.rowsCounted', { counted: pulse.breadth.counted, total: pulse.breadth.total }) : '—'}</span>
          <span className="aix-status-item aix-status-currency">{ct(locale, 'page.usdNote')}</span>
        </div>

        {marketError && !markets.length ? (
          <div className="aix-error" role="alert">{ct(locale, 'page.error')}</div>
        ) : null}

        <AnalysisTabs
          tabs={TABS}
          active={tab}
          onChange={setTab}
          locale={locale}
          id="aix-analysis-tabs"
          panelId="aix-analysis-panel"
          label={ct(locale, 'page.title')}
        />

        <main
          className="aix-main"
          id="aix-analysis-panel"
          role="tabpanel"
          aria-labelledby={`aix-analysis-tabs-${tab}`}
          tabIndex={0}
          key={tab}
        >
          {pulse ? renderTab() : (
            marketError ? <p className="aix-loading">{ct(locale, 'page.error')}</p> : <p className="aix-loading">{ct(locale, 'page.loading')}</p>
          )}
        </main>

        <p className="aix-disclaimer">{ct(locale, 'page.notAdvice')}</p>

        {sourcesOpen ? (
          <div className="aix-sources-backdrop" role="dialog" aria-modal="true" aria-label={ct(locale, 'page.sources')} onClick={() => setSourcesOpen(false)}>
            <div className="aix-sources" onClick={(e) => e.stopPropagation()}>
              <header>
                <h2>{ct(locale, 'page.sources')}</h2>
                <button type="button" className="icon-btn" onClick={() => setSourcesOpen(false)} aria-label={ct(locale, 'page.close')}>✕</button>
              </header>
              <div className="aix-src-row">
                <span>{isRTL ? 'بازار و ارزش کل' : 'Markets & global stats'}</span>
                <b>{sourceLabel}</b>
                <em>{pulse ? `${pulse.breadth.counted}/${pulse.breadth.total}` : '—'}</em>
              </div>
              <div className="aix-src-row">
                <span>{isRTL ? 'کندل توکن انتخابی' : 'Selected token candles'}</span>
                <b>{isRTL ? 'CoinGecko OHLC' : 'CoinGecko OHLC'}</b>
                <em>{pack?.bars ?? 0}</em>
              </div>
              <div className="aix-src-row">
                <span>{isRTL ? 'پرتفوی' : 'Portfolio'}</span>
                <b>{isRTL ? 'خواندن مستقیم از شبکه' : 'Direct on-chain read'}</b>
                <em>{coverage ? `${coverage.readChains}/${coverage.totalChains}` : rows.length}</em>
              </div>
              <div className="aix-src-row">
                <span>{isRTL ? 'همبستگی' : 'Correlation'}</span>
                <b>{isRTL ? 'کندل روزانه ۳۰ روز' : '30d daily candles'}</b>
                <em>{correlationStatus === 'done' ? (analysis?.correlation?.computedOn?.length ?? '…') : '…'}</em>
              </div>

              <h3>{ct(locale, 'unavailable.title')}</h3>
              <p className="aix-card-hint">{ct(locale, 'unavailable.note')}</p>
              <div className="aix-sources-missing">
                {(pulse?.unavailable || []).map((key) => (
                  <span key={key}>{ct(locale, `unavailable.${key}`)}</span>
                ))}
              </div>

              <p className="aix-foot-note">{ct(locale, 'page.notAdvice')}</p>
            </div>
          </div>
        ) : null}
      </div>
    </PageTransition>
  );
}
