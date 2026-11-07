/**
 * FBT AI INTELLIGENCE — the analysis centre
 * ---------------------------------------------------------------------------
 * «بخش AI Analysis را از یک صفحه ساده نمایش قیمت به یک مرکز تحلیل حرفه‌ای
 *  بازار تبدیل کن»
 *
 * Seven rooms, one data spine:
 *
 *   Overview · Screener · Token · Portfolio · Opportunities · Compare · Report
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
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition from '../components/PageTransition';
import { IconChevronLeft, IconRefresh, IconSparkle } from '../components/Icons';
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
import '../styles/ai-analysis.css';

const TABS = [
  { id: 'overview', key: 'tab.overview' },
  { id: 'screener', key: 'tab.screener' },
  { id: 'token', key: 'tab.token' },
  { id: 'portfolio', key: 'tab.portfolio' },
  { id: 'opportunities', key: 'tab.opportunities' },
  { id: 'compare', key: 'tab.compare' },
  { id: 'report', key: 'tab.report' }
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
    markets, pulse, scan, updatedAt, loading: marketLoading, error: marketError, refresh: refreshMarket
  } = useMarketRoom();

  const {
    pack, coin, score, loading: ohlcLoading, refresh: refreshOhlc
  } = useTokenRoom({ tokenId, days, markets });

  const {
    connected, intel, analysis: portfolioAnalysis, coverage, rows,
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
    if (!pulse && (marketLoading || !markets.length)) {
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
            locale={locale}
            onConnect={(path) => navigate(path)}
            loading={portfolioLoading}
            coverage={coverage}
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
      case 'report':
        return <ReportTab pulse={pulse} scan={scan} locale={locale} markets={markets} sourceLabel={sourceLabel} />;
      default:
        return <OverviewTab pulse={pulse} locale={locale} onOpenToken={openToken} />;
    }
  };

  return (
    <PageTransition>
      <div className="aix-page" dir={isRTL ? 'rtl' : 'ltr'}>
        <header className="aix-header">
          <button type="button" className="icon-btn" onClick={() => navigate(-1)} aria-label={ct(locale, 'page.close')}>
            <IconChevronLeft width={18} height={18} />
          </button>
          <div className="aix-head-main">
            <h1 className="aix-title">
              <IconSparkle width={18} height={18} />
              {ct(locale, 'page.title')}
            </h1>
            <p className="aix-subtitle">{ct(locale, 'page.subtitle')}</p>
          </div>
          <div className="aix-head-actions">
            <button type="button" className="aix-cta aix-cta-ghost" onClick={refreshAll} aria-label={ct(locale, 'page.refresh')}>
              <IconRefresh width={15} height={15} />
              <span>{ct(locale, 'page.refresh')}</span>
            </button>
            <button type="button" className="aix-cta aix-cta-ghost" onClick={() => setSourcesOpen(true)}>
              {ct(locale, 'page.sources')}
            </button>
          </div>
        </header>

        <div className={`aix-statusbar aix-status-${pulse?.provenance || 'unknown'}`}>
          <span className="aix-status-dot" aria-hidden="true" />
          <span>{ct(locale, PROV_KEY[pulse?.provenance || 'unknown'])}</span>
          <span className="aix-status-sep">·</span>
          <span>{ct(locale, 'page.updated', { time: fmtTimeAgo(updatedAt, locale) })}</span>
          <span className="aix-status-sep">·</span>
          <span>{pulse ? ct(locale, 'page.rowsCounted', { counted: pulse.breadth.counted, total: pulse.breadth.total }) : '—'}</span>
          <span className="aix-status-sep">·</span>
          <span>{ct(locale, 'page.usdNote')}</span>
        </div>

        {marketError && !markets.length ? (
          <div className="aix-error" role="alert">{ct(locale, 'page.error')}</div>
        ) : null}

        <nav className="aix-tabs" aria-label={ct(locale, 'page.title')}>
          {TABS.map((x) => (
            <button
              key={x.id}
              type="button"
              className={`aix-tab${tab === x.id ? ' is-active' : ''}`}
              onClick={() => setTab(x.id)}
              aria-current={tab === x.id ? 'page' : undefined}
            >
              {ct(locale, x.key)}
            </button>
          ))}
        </nav>

        <main className="aix-main">
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
