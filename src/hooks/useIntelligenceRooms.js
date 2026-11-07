/**
 * THE INTELLIGENCE ROOMS — one data spine, shared by the page and the chat
 * ---------------------------------------------------------------------------
 * «هوش بازار» used to be a page you had to go to. The owner's ask was the
 * opposite: the AI's answers should *be* those rooms — ask for a bitcoin
 * analysis and the token room opens in the bubble; ask what is happening today
 * and the market overview opens there; ask about portfolio risk and the
 * portfolio room does.
 *
 * That is only honest if both surfaces read the SAME numbers. So the data
 * spine moved here, out of the page component, and both consumers call these
 * hooks:
 *
 *   useMarketRoom()      /api/markets + /api/global → buildMarketPulse()
 *                        → scanOpportunities()
 *   useTokenRoom()       /api/ohlc/:id → computeIndicators() → scoreToken()
 *   usePortfolioRoom()   wallet balances + lots → buildIntelligence()
 *                        → buildPerformance()   (measured price return + attribution)
 *                        → correlationMatrix() → buildPortfolioAnalysis()
 *                        → buildPortfolioReview() (the review, its findings and
 *                                                  its ordered actions)
 *
 * The rules from the page travel with them and are unchanged:
 *   · a feed that did not answer is named, never replaced by a number;
 *   · `null` is an em dash, never a zero;
 *   · provenance (live / stale / offline) is carried on every pulse.
 *
 * `enabled: false` mounts the same hooks but touches no network — that is how a
 * long conversation can hold twenty collapsed cards and still make one request.
 */
import { useEffect, useMemo, useState } from 'react';
import { getGlobal, getMarkets, getOhlc, normalizeGlobal } from '../lib/api';
import { usePoll } from './useMarket';
import { useWallet } from '../context/WalletContext';
import { useWalletBalances } from './useWalletBalances';
import { useMultiChainPortfolio } from './useMultiChainPortfolio';
import { buildIntelligence } from '../lib/portfolioIntel';
import { EVM_CHAIN_ORDER } from '../lib/chains';
import { buildMarketPulse, pickRow } from '../lib/intelligence/marketPulse';
import { scanOpportunities } from '../lib/intelligence/opportunities';
import { computeIndicators } from '../lib/intelligence/indicators';
import { scoreToken } from '../lib/intelligence/tokenScore';
import { buildPortfolioAnalysis, correlationMatrix } from '../lib/intelligence/portfolioAnalysis';
import { buildPerformance } from '../lib/intelligence/performance';
import { buildPortfolioReview } from '../lib/intelligence/portfolioReview';
import { buildMarketAnalysis } from '../lib/intelligence/marketAnalysis';

/* 250 rows is the widest page the market API serves without a second request;
   the screener and the scanner both work on exactly this set. */
export const MARKET_ROOM_PAGE_SIZE = 250;
export const CORRELATION_SYMBOLS = 4;

export function useMarketRoom({ perPage = MARKET_ROOM_PAGE_SIZE, enabled = true } = {}) {
  const market = usePoll(async () => {
    if (!enabled) return { markets: [], global: null };
    const [markets, global] = await Promise.all([
      getMarkets({ perPage, vs: 'usd' }),
      getGlobal().catch(() => null)
    ]);
    return { markets: Array.isArray(markets) ? markets : [], global };
  }, [enabled, perPage], 45000);

  const markets = useMemo(() => market.data?.markets ?? [], [market.data]);

  /* /api/global answers in the provider's RAW shape (`data.total_market_cap…`).
     normalizeGlobal() is what every other screen uses; skipping it made every
     market-cap tile read `—` while the rows beside them were live, so the
     normaliser is applied at the edge. `dataProvenance` is carried through
     because normalizeGlobal() only knows numbers. */
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

  /* The deeper read: ranked relative strength, divergence against the tape,
     dispersion, and the thresholds that would move the regime. Same feed, no
     second request — see marketAnalysis.js for why each number exists. */
  const analysis = useMemo(
    () => buildMarketAnalysis({ markets, pulse }),
    [markets, pulse]
  );

  return {
    markets,
    global,
    pulse,
    scan,
    analysis,
    updatedAt: market.updatedAt,
    loading: market.loading,
    error: market.error,
    refresh: market.refresh
  };
}

/**
 * One token's technical file: candles → indicators → composite score.
 * `tokenId` may be a CoinGecko id (`bitcoin`) or a symbol (`BTC`); the caller
 * resolves it against the market feed when it only has the symbol.
 */
export function useTokenRoom({ tokenId = null, days = 90, markets = [], enabled = true } = {}) {
  const ohlc = usePoll(
    () => (enabled && tokenId ? getOhlc(tokenId, days) : Promise.resolve([])),
    [enabled, tokenId, days],
    120000
  );

  const pack = useMemo(() => computeIndicators(ohlc.data || []), [ohlc.data]);

  const rawCoin = useMemo(() => {
    if (!tokenId) return null;
    const needle = String(tokenId).toLowerCase();
    return markets.find((r) => String(r.id).toLowerCase() === needle)
      || markets.find((r) => String(r.symbol).toLowerCase() === needle)
      || null;
  }, [markets, tokenId]);

  const coin = useMemo(() => (rawCoin ? pickRow(rawCoin) : null), [rawCoin]);

  const score = useMemo(
    () => (coin ? scoreToken({ coin, pack, universe: markets }) : null),
    [coin, pack, markets]
  );

  return {
    pack,
    coin,
    score,
    loading: ohlc.loading,
    error: ohlc.error,
    refresh: ohlc.refresh
  };
}

/**
 * The portfolio room: the SAME `buildIntelligence()` the wealth screens trust,
 * plus allocation, concentration, return correlation and a risk band whose
 * causes are measured.
 *
 * A wallet read that failed or is stale is carried through as such; the room
 * never promotes a partial snapshot to "live".
 */
export function usePortfolioRoom({ enabled = true } = {}) {
  const ctx = useWallet();
  /*
   * `useWallet()` answers `{}` when no provider is above the tree, and that
   * fallback is a NEW object on every render. Handing it to useWalletBalances
   * would re-create its `load` callback each render, re-run the effect, set a
   * fresh `[]`, and loop — a render storm with no network activity to blame.
   * So the hooks only ever see a real wallet, or `null`.
   */
  const wallet = enabled && ctx?.address ? ctx : null;
  const connected = Boolean(wallet?.address);
  const useMulti = Boolean(connected && typeof wallet.getReadProvider === 'function');

  const single = useWalletBalances(useMulti || !connected ? null : wallet);
  const multi = useMultiChainPortfolio(useMulti ? wallet : null);
  const source = useMulti ? multi : single;

  /* One identity for the rows: buildIntelligence writes a portfolio snapshot
     when it runs, so it must not run once per render. */
  const rows = useMemo(() => source.rows ?? [], [source.rows]);

  const intel = useMemo(
    () => buildIntelligence({
      holdings: rows.map((r) => ({ ...r, chainId: r.chainId ?? wallet?.chainId ?? null }))
    }),
    [rows, wallet?.chainId]
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
    if (!enabled || !correlationTargets.length) {
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
  }, [enabled, targetsKey]);

  const correlation = useMemo(
    () => (Object.keys(seriesBySymbol).length >= 2 ? correlationMatrix(seriesBySymbol) : null),
    [seriesBySymbol]
  );

  /*
   * MEASURED PERFORMANCE — «سود، زیان، بهترین و ضعیف‌ترین عملکرد».
   *
   * The market feed already polled by useMultiChainPortfolio carries each
   * asset's own 24h/7d move, so the portfolio's return can be computed for the
   * mix the wallet holds RIGHT NOW — without a cost basis, and without
   * inventing an entry price. `performance.js` owns the arithmetic and the
   * refusals (a holding with no quote is excluded, never counted as 0%).
   */
  const marketRows = useMemo(
    () => (Array.isArray(source.marketRows) ? source.marketRows : []),
    [source.marketRows]
  );

  const performance = useMemo(
    () => (intel && intel.total > 0
      ? buildPerformance({ rows: intel.rows || [], markets: marketRows })
      : null),
    [intel, marketRows]
  );

  const analysis = useMemo(
    () => buildPortfolioAnalysis({
      intel, correlation, seriesUsed: Object.keys(seriesBySymbol), performance
    }),
    [intel, correlation, seriesBySymbol, performance]
  );

  const review = useMemo(
    () => buildPortfolioReview({ intel, analysis, performance }),
    [intel, analysis, performance]
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

  return {
    connected,
    intel,
    analysis,
    review,
    performance,
    markets: marketRows,
    correlation,
    correlationStatus,
    coverage,
    rows,
    chains: source.chains ?? [],
    loading: source.loading,
    useMulti
  };
}
