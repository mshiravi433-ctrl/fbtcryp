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
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition from '../components/PageTransition';
import { IconChevronLeft, IconRefresh, IconSparkle } from '../components/Icons';
import { usePoll } from '../hooks/useMarket';
import { getGlobal, getMarkets, getOhlc, normalizeGlobal } from '../lib/api';
import { useWallet } from '../context/WalletContext';
import { useWalletBalances } from '../hooks/useWalletBalances';
import { useMultiChainPortfolio } from '../hooks/useMultiChainPortfolio';
import { useHideBalances } from '../hooks/useHideBalances';
import { buildIntelligence } from '../lib/portfolioIntel';
import { EVM_CHAIN_ORDER } from '../lib/chains';
import { buildMarketPulse, pickRow } from '../lib/intelligence/marketPulse';
import { scanOpportunities } from '../lib/intelligence/opportunities';
import { computeIndicators } from '../lib/intelligence/indicators';
import { scoreToken } from '../lib/intelligence/tokenScore';
import { buildPortfolioAnalysis, correlationMatrix } from '../lib/intelligence/portfolioAnalysis';
import { fmtTimeAgo, t as ct } from '../lib/intelligence/copy';
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

/* 250 rows is the widest page the market API serves without a second request;
   the scanner and the screener both work on exactly this set. */
const MARKET_PAGE_SIZE = 250;
const CORRELATION_SYMBOLS = 4;

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

  /* ── Market feed ─────────────────────────────────────────────────────── */
  const market = usePoll(async () => {
    const [markets, global] = await Promise.all([
      getMarkets({ perPage: MARKET_PAGE_SIZE, vs: 'usd' }),
      getGlobal().catch(() => null)
    ]);
    return { markets: Array.isArray(markets) ? markets : [], global };
  }, [], 45000);

  const markets = market.data?.markets ?? [];
  /* /api/global answers in the provider's RAW shape (`data.total_market_cap…`).
     normalizeGlobal() is what every other screen uses; skipping it here made
     every market-cap tile read `—` while the rows beside them were live — the
     normaliser is the contract, so it is applied at the edge. `dataProvenance`
     is carried through because normalizeGlobal() only knows numbers. */
  const global = useMemo(() => {
    const raw = market.data?.global;
    if (!raw) return null;
    return { ...normalizeGlobal(raw), dataProvenance: raw.dataProvenance ?? 'unknown' };
  }, [market.data?.global]);

  const pulse = useMemo(() => {
    if (!markets.length && !global) return null;
    return buildMarketPulse({
      global,
      markets,
      updatedAt: market.updatedAt,
      provider: markets[0]?.marketProvider ?? null
    });
  }, [markets, global, market.updatedAt]);

  const scan = useMemo(() => scanOpportunities({ markets, pulse }), [markets, pulse]);

  /* ── Selected token ──────────────────────────────────────────────────── */
  const ohlc = usePoll(
    () => (tokenId ? getOhlc(tokenId, days) : Promise.resolve([])),
    [tokenId, days],
    120000
  );

  const pack = useMemo(() => computeIndicators(ohlc.data || []), [ohlc.data]);
  const rawCoin = useMemo(() => markets.find((r) => r.id === tokenId) || null, [markets, tokenId]);
  const coin = useMemo(() => (rawCoin ? pickRow(rawCoin) : null), [rawCoin]);
  const score = useMemo(
    () => (coin ? scoreToken({ coin, pack, universe: markets }) : null),
    [coin, pack, markets]
  );

  /* ── Portfolio ───────────────────────────────────────────────────────── */
  const wallet = useWallet();
  const walletReady = Boolean(wallet?.address);
  const useMulti = Boolean(walletReady && typeof wallet.getReadProvider === 'function');
  /*
   * `useWallet()` answers `{}` when no provider is above the tree, and that
   * fallback is a NEW object on every render. Handing it to useWalletBalances
   * would re-create its `load` callback each render, re-run the effect, set a
   * fresh `[]`, and loop — a render storm with no network activity to blame.
   * So the hook only ever sees a real wallet, or `null`.
   */
  const single = useWalletBalances(useMulti || !walletReady ? null : wallet);
  const multi = useMultiChainPortfolio(useMulti ? wallet : null);
  const source = useMulti ? multi : single;
  /* One identity for the rows: buildIntelligence writes a portfolio snapshot
     when it runs, so it must not run once per render. */
  const rows = useMemo(() => source.rows ?? [], [source.rows]);

  const intel = useMemo(
    () => buildIntelligence({
      holdings: rows.map((r) => ({ ...r, chainId: r.chainId ?? wallet.chainId ?? null }))
    }),
    [rows, wallet.chainId]
  );

  /* Daily candles for the largest holdings, ONLY to measure how they move
     together. Bounded to four symbols and re-read only when the symbol set
     changes — not on every 30-second price tick. */
  const correlationTargets = useMemo(
    () => (intel.rows || [])
      .filter((r) => r.coingeckoId && Number(r.value) > 0)
      .slice(0, CORRELATION_SYMBOLS)
      .map((r) => ({ symbol: r.symbol, id: r.coingeckoId })),
    [intel.rows]
  );
  const targetsKey = correlationTargets.map((x) => `${x.symbol}:${x.id}`).join('|');
  const [seriesBySymbol, setSeriesBySymbol] = useState({});
  const [correlationStatus, setCorrelationStatus] = useState('idle');

  useEffect(() => {
    if (!correlationTargets.length) {
      setSeriesBySymbol({});
      setCorrelationStatus('idle');
      return undefined;
    }
    let cancelled = false;
    setCorrelationStatus('loading');
    (async () => {
      const results = await Promise.allSettled(
        correlationTargets.map((x) => getOhlc(x.id, 30).then((bars) => ({
          symbol: x.symbol,
          closes: (bars || []).map((b) => Number(b.c)).filter(Number.isFinite)
        })))
      );
      if (cancelled) return;
      const next = {};
      for (const res of results) {
        if (res.status === 'fulfilled' && res.value.closes.length) next[res.value.symbol] = res.value.closes;
      }
      setSeriesBySymbol(next);
      setCorrelationStatus('done');
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetsKey]);

  const correlation = useMemo(
    () => (Object.keys(seriesBySymbol).length >= 2 ? correlationMatrix(seriesBySymbol) : null),
    [seriesBySymbol]
  );

  const portfolioAnalysis = useMemo(
    () => buildPortfolioAnalysis({ intel, correlation, seriesUsed: Object.keys(seriesBySymbol) }),
    [intel, correlation, seriesBySymbol]
  );

  const coverage = useMemo(() => {
    if (!useMulti) return null;
    return {
      readChains: (source.chains ?? []).filter((c) => !c.error).length,
      totalChains: EVM_CHAIN_ORDER.length,
      pricedRows: rows.filter((r) => r.value != null).length,
      totalRows: rows.length
    };
  }, [useMulti, source.chains, rows]);

  const openToken = useCallback((id) => {
    if (!id) return;
    setTokenId(id);
    setTab('token');
  }, []);

  const refreshAll = useCallback(() => {
    market.refresh?.();
    ohlc.refresh?.();
  }, [market, ohlc]);

  const sourceLabel = markets[0]?.marketProvider === 'coingecko' ? 'CoinGecko' : 'FBT market API';

  const renderTab = () => {
    if (!pulse && (market.loading || !market.data)) {
      return <p className="aix-loading">{ct(locale, 'page.loading')}</p>;
    }
    switch (tab) {
      case 'screener':
        return (
          <ScreenerTab
            markets={markets}
            locale={locale}
            updatedAt={market.updatedAt}
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
            loading={ohlc.loading}
            days={days}
            onDays={setDays}
            onOpenFull={(id) => navigate(`/coin/${id}`)}
          />
        );
      case 'portfolio':
        return (
          <PortfolioTab
            connected={Boolean(wallet?.address)}
            intel={intel}
            analysis={portfolioAnalysis}
            locale={locale}
            onConnect={(path) => navigate(path)}
            loading={source.loading}
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
          <span>{ct(locale, 'page.updated', { time: fmtTimeAgo(market.updatedAt, locale) })}</span>
          <span className="aix-status-sep">·</span>
          <span>{pulse ? ct(locale, 'page.rowsCounted', { counted: pulse.breadth.counted, total: pulse.breadth.total }) : '—'}</span>
          <span className="aix-status-sep">·</span>
          <span>{ct(locale, 'page.usdNote')}</span>
        </div>

        {market.error && !market.data ? (
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
            market.error ? <p className="aix-loading">{ct(locale, 'page.error')}</p> : <p className="aix-loading">{ct(locale, 'page.loading')}</p>
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
                <em>{correlationStatus === 'done' ? Object.keys(seriesBySymbol).length : '…'}</em>
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
