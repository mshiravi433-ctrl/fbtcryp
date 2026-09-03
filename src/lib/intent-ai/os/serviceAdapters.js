/**
 * FBT INTENT OS — Service Adapters
 * ---------------------------------------------------------------------------
 * The bridge between the tool registry and the app's REAL service libraries.
 * Every tool in toolRegistry.js is `ctx.<something>Service?.<method>?.()` — if
 * the adapter below does not answer, the tool returns NO_*_SERVICE and the
 * assistant says it has no data. So this file decides whether the assistant is
 * actually connected to the app or only pretending to be.
 *
 * ─── WHY THIS FILE WAS REWRITTEN ────────────────────────────────────────────
 * It used to import functions that DO NOT EXIST in this codebase:
 *
 *   marketInsights.fetchMarketOverview   ← never exported
 *   marketInsights.fetchTokenDetail      ← never exported
 *   marketInsights.fetchSignals          ← never exported
 *   news.searchNews                      ← never exported
 *   smartMoneyAI.fetchSmartMoney         ← never exported
 *   smartMoneyClient.trackSmartMoney     ← never exported
 *   orders.listOrders                    ← never exported (it is loadOrders)
 *   audio.playAudio                      ← never exported
 *   bestQuote.getBestQuote               ← never exported (it is pickBestQuote)
 *   swap.fetchQuote                      ← never exported (it is getQuote)
 *   ../rebalanceEngine.js                ← lives at ../rebalanceEngine relative
 *                                          to intent-ai/, not to intent-ai/os/
 *
 * A failing dynamic import rejects, the `catch` swallowed it, and the adapter
 * returned `dataStatus: 'unavailable'` — every single time, for every user.
 * That is the "connectivity to all sections is not working" report: the
 * assistant was structurally incapable of reading market data, news, signals,
 * smart money, whales or orders, and it reported that as a data outage.
 *
 * ─── THE RULE THIS FILE NOW FOLLOWS ─────────────────────────────────────────
 * Every import below names an export that exists (verified against the module
 * source). An import that cannot resolve is a BUG, not a data condition, so
 * failures are reported with the reason attached instead of being flattened
 * into a generic "unavailable". No adapter invents a number: when the upstream
 * has nothing, the caller is told it has nothing.
 */

/** Uniform failure shape — the reason survives so the UI can show it. */
function failed(error, extra = {}) {
  const reason = String(error?.message || error || 'FAILED').slice(0, 160);
  return { ok: false, dataStatus: 'unavailable', reason, ...extra };
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/** Symbol → CoinGecko id for the handful of coins users name in chat. */
const COIN_IDS = Object.freeze({
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', BNB: 'binancecoin',
  USDT: 'tether', USDC: 'usd-coin', ARB: 'arbitrum', MATIC: 'matic-network',
  AVAX: 'avalanche-2', OP: 'optimism', DAI: 'dai', LINK: 'chainlink',
  ADA: 'cardano', XRP: 'ripple', DOGE: 'dogecoin', TON: 'the-open-network'
});

export function createRealServices({ wallet = null, portfolio = null } = {}) {
  return {
    walletService: {
      getBalances: async () => {
        try {
          if (wallet?.balances) return { ok: true, balances: wallet.balances, dataStatus: 'live' };
          if (portfolio?.balances) return { ok: true, balances: portfolio.balances, dataStatus: 'live' };
          return { ok: true, balances: [], dataStatus: 'unavailable', reason: 'NO_WALLET_SNAPSHOT' };
        } catch (e) {
          return failed(e, { balances: [] });
        }
      },
      getContext: async () => wallet || { connected: false },
      send: async (input) => ({ ok: true, requiresSignature: true, input })
    },

    portfolioService: {
      getSummary: async () => portfolio || { dataStatus: 'unavailable', holdings: [], totalValueUsd: null },
      analyze: async ({ holdings } = {}) => {
        const h = holdings || portfolio?.holdings || [];
        const priced = h.filter((x) => Number.isFinite(Number(x.valueUsd)));
        const total = priced.reduce((s, x) => s + Number(x.valueUsd), 0);
        const sorted = [...h].sort((a, b) => (Number(b.valueUsd) || 0) - (Number(a.valueUsd) || 0));
        return {
          ok: true,
          totalValueUsd: priced.length ? total : null,
          holdings: h,
          largest: sorted[0] || null,
          allocation: sorted.map((x) => ({
            symbol: x.symbol,
            pct: priced.length && Number.isFinite(Number(x.valueUsd)) ? (Number(x.valueUsd) / total) * 100 : null
          })),
          // Concentration is the only risk statement this data supports. It is
          // an observation about the allocation, not a forecast.
          riskLevel: sorted[0] && total > 0 ? (Number(sorted[0].valueUsd) / total > 0.6 ? 'high' : 'medium') : 'low',
          // Priced vs unpriced is stated so a partly-unreadable portfolio is
          // never summarised as if it were complete.
          pricedCount: priced.length,
          unpricedCount: h.length - priced.length,
          dataStatus: h.length ? 'live' : 'unavailable'
        };
      },
      rebalance: async ({ holdings, target, balances }) => {
        try {
          // rebalanceEngine lives one level up, in intent-ai/, not in os/.
          const { planRebalance } = await import('../rebalanceEngine.js');
          return planRebalance({ holdings: holdings || portfolio?.holdings || [], balances, target });
        } catch (e) {
          return failed(e);
        }
      }
    },

    swapService: {
      getQuote: async ({ fromSymbol, toSymbol, amount, chainId, slippage }) => {
        try {
          // lib/swap.getQuote is the real single-route quote (the aggregator
          // path is inside it). bestQuote.pickBestQuote only RANKS quotes that
          // are already fetched, so it cannot be the entry point.
          const { getQuote } = await import('../../swap.js');
          const quote = await getQuote({
            chainId: chainId || 42161,
            fromToken: fromSymbol,
            toToken: toSymbol,
            amountIn: amount,
            ...(slippage ? { slippage } : {})
          });
          if (!quote) return { ok: false, dataStatus: 'unavailable', reason: 'NO_ROUTE' };
          return { ok: true, quote, dataStatus: 'live' };
        } catch (e) {
          return failed(e);
        }
      },
      // Signing happens on the swap page, never in the chat.
      execute: async (input) => ({ ok: true, requiresSignature: true, input, handoffRoute: '/swap' })
    },

    bridgeService: {
      getQuote: async ({ fromChain, toChain, token, amount }) => {
        try {
          const { getBridgeQuote } = await import('../../bridge.js');
          const q = await getBridgeQuote({ fromChain, toChain, token, amount });
          return { ok: true, quote: q, dataStatus: 'live' };
        } catch (e) {
          return failed(e);
        }
      },
      execute: async (input) => ({ ok: true, requiresSignature: true, input, handoffRoute: '/bridge' })
    },

    marketService: {
      /**
       * Global stats + the top of the market, read through lib/api's resilient
       * layer (backend → public CoinGecko → offline snapshot), then summarised
       * with deriveMarketInsights — the same function the market header uses,
       * so the chat and the page cannot disagree.
       */
      getOverview: async () => {
        try {
          const [{ getGlobal, getMarkets }, { deriveMarketInsights }] = await Promise.all([
            import('../../api.js'),
            import('../../marketInsights.js')
          ]);
          const [global, markets] = await Promise.all([
            getGlobal().catch(() => null),
            getMarkets({ page: 1, perPage: 50 }).catch(() => [])
          ]);
          const rows = Array.isArray(markets) ? markets : [];
          if (!global && !rows.length) {
            return { ok: false, dataStatus: 'unavailable', reason: 'NO_MARKET_DATA' };
          }
          const insights = deriveMarketInsights({ markets: rows });
          return {
            ok: true,
            dataStatus: 'live',
            overview: {
              totalMarketCapUsd: num(global?.mcap),
              volume24hUsd: num(global?.volume),
              btcDominancePct: num(global?.btcDominance),
              marketCapChange24hPct: num(global?.mcapChange)
            },
            leaders: {
              gainer: insights.cryptoLeader || null,
              laggard: insights.cryptoLaggard || null,
              byVolume: insights.volumeLeader || null
            },
            top: rows.slice(0, 10).map((r) => ({
              symbol: String(r.symbol || '').toUpperCase(),
              name: r.name,
              priceUsd: num(r.price),
              change24hPct: num(r.change24h)
            })),
            // Provenance travels with the data so the reply can be honest
            // about reading a cached snapshot rather than the live market.
            source: rows[0]?.dataProvenance || 'api'
          };
        } catch (e) {
          return failed(e);
        }
      },
      getRelevantData: async function getRelevantData() {
        return this.getOverview();
      },
      /**
       * One coin, with the indicator read the app already trusts (lib/ai's
       * backtested analyze) rather than a second opinion invented here.
       */
      getToken: async ({ symbol }) => {
        const sym = String(symbol || '').toUpperCase();
        if (!sym) return { ok: false, dataStatus: 'unavailable', reason: 'NO_SYMBOL' };
        try {
          const { getCoin, getChart } = await import('../../api.js');
          const id = COIN_IDS[sym] || sym.toLowerCase();
          const coin = await getCoin(id).catch(() => null);
          if (!coin) return { ok: false, symbol: sym, dataStatus: 'unavailable', reason: 'COIN_NOT_FOUND' };

          let analysis = null;
          try {
            const [{ analyze }, chart] = await Promise.all([
              import('../../ai.js'),
              getChart(id, 90).catch(() => null)
            ]);
            const prices = (chart?.prices || []).map((p) => (Array.isArray(p) ? p[1] : p?.price)).filter(Number.isFinite);
            // analyze() returns null below 30 bars — that is a real answer
            // ("not enough history"), not an error to paper over.
            analysis = prices.length >= 30 ? analyze(prices, coin) : null;
          } catch { /* the price read already succeeded; indicators are a bonus */ }

          return {
            ok: true,
            dataStatus: 'live',
            symbol: sym,
            name: coin.name || null,
            priceUsd: num(coin.price),
            change24hPct: num(coin.change24h),
            marketCapUsd: num(coin.mcap),
            volume24hUsd: num(coin.volume),
            analysis: analysis
              ? {
                  signal: analysis.signal || null,
                  score: num(analysis.score),
                  // Confidence is backtested (lib/backtest), capped at 75 —
                  // it is a hit-rate, never a probability of being right.
                  confidence: num(analysis.confidence),
                  rsi: num(analysis.rsi)
                }
              : null,
            analysisUnavailableReason: analysis ? null : 'INSUFFICIENT_HISTORY'
          };
        } catch (e) {
          return failed(e, { symbol: sym });
        }
      }
    },

    newsService: {
      /**
       * lib/news has no `searchNews`. It has getNews({force,coins,lang}) which
       * returns {items,at,stale}; filtering by query happens here, on the
       * items that came back, instead of pretending the API can search.
       */
      list: async ({ limit = 10, lang } = {}) => {
        try {
          const { getNews } = await import('../../news.js');
          const res = await getNews(lang ? { lang } : {});
          const items = Array.isArray(res?.items) ? res.items : [];
          return {
            ok: true,
            news: items.slice(0, limit),
            at: res?.at || null,
            stale: res?.stale === true,
            dataStatus: items.length ? 'live' : 'empty'
          };
        } catch (e) {
          return failed(e, { news: [] });
        }
      },
      search: async ({ query, limit = 10, lang } = {}) => {
        try {
          const { getNews } = await import('../../news.js');
          const res = await getNews(lang ? { lang } : {});
          const items = Array.isArray(res?.items) ? res.items : [];
          const q = String(query || '').trim().toLowerCase();
          const hits = q
            ? items.filter((n) => `${n.title || ''} ${n.summary || ''} ${n.source || ''}`.toLowerCase().includes(q))
            : items;
          return {
            ok: true,
            news: hits.slice(0, limit),
            query: q || null,
            at: res?.at || null,
            stale: res?.stale === true,
            // "no story matches your query" is different from "the feed is
            // down", and the reply needs to be able to tell them apart.
            dataStatus: hits.length ? 'live' : (items.length ? 'empty' : 'unavailable')
          };
        } catch (e) {
          return failed(e, { news: [] });
        }
      }
    },

    yieldService: {
      discover: async ({ asset, riskTolerance } = {}) => {
        try {
          const { getYields } = await import('../../yields.js');
          const res = await getYields();
          const pools = Array.isArray(res?.pools) ? res.pools : [];
          let filtered = pools;
          if (asset) {
            const want = String(asset).toUpperCase();
            filtered = filtered.filter((p) => String(p.symbol || '').toUpperCase().includes(want));
          }
          if (riskTolerance === 'low') filtered = filtered.filter((p) => (p.risk || 'medium') !== 'high');
          return {
            ok: true,
            opportunities: filtered.slice(0, 12),
            scanned: pools.length,
            dataStatus: filtered.length ? 'live' : (pools.length ? 'empty' : 'unavailable'),
            // The upstream timestamp only — never `new Date()`, which would
            // relabel a stale pool list as fresh.
            updatedAt: res?.updatedAt || res?.at || null
          };
        } catch (e) {
          return failed(e, { opportunities: [] });
        }
      }
    },

    farmService: {
      list: async ({ chainId } = {}) => {
        try {
          const { getYields } = await import('../../yields.js');
          const res = await getYields();
          const all = Array.isArray(res?.pools) ? res.pools : [];
          // A farm is a multi-asset position: an LP pair, not a single-asset
          // deposit. `SYM1-SYM2` in the symbol is how this dataset marks it.
          const pools = all.filter((p) => p.exposure === 'multi' || /[-/]/.test(String(p.symbol || '')));
          return {
            ok: true,
            pools: pools.slice(0, 20),
            chainId: chainId ?? null,
            dataStatus: pools.length ? 'live' : (all.length ? 'empty' : 'unavailable'),
            updatedAt: res?.updatedAt || res?.at || null
          };
        } catch (e) {
          return failed(e, { pools: [] });
        }
      }
    },

    lendingService: {
      getMarkets: async ({ asset } = {}) => {
        try {
          const { lendingAssetsFor, lendingChains } = await import('../../lending.js');
          let markets = lendingChains().flatMap((cid) =>
            lendingAssetsFor(cid).map((m) => ({ ...m, chainId: cid })));
          if (asset) {
            const want = String(asset).toUpperCase();
            markets = markets.filter((m) => String(m.symbol || '').toUpperCase() === want);
          }
          // 'catalog', not 'live': this is the supported-asset list, not rates.
          return { ok: true, markets, dataStatus: 'catalog' };
        } catch (e) {
          return failed(e, { markets: [] });
        }
      },
      getPositions: async ({ address, chainId } = {}) => {
        if (!address) return { ok: false, dataStatus: 'unavailable', reason: 'WALLET_REQUIRED', lending: [], borrowing: [] };
        try {
          const { readUserAccount } = await import('../../lending.js');
          const account = await readUserAccount({ user: address, chainId });
          return { ok: true, dataStatus: 'live', ...account };
        } catch (e) {
          return failed(e, { lending: [], borrowing: [] });
        }
      }
    },

    signalsService: {
      /**
       * There is no lib/signals.js and marketInsights has no fetchSignals —
       * pages/Signals.jsx COMPOSES its signals from macro + ai + the chart.
       * The same composition is done here so the chat and the page agree.
       */
      list: async ({ asset } = {}) => {
        try {
          const { getGlobal, getChart, getMarkets } = await import('../../api.js');
          const [{ marketRegime }, global, btcChart] = await Promise.all([
            import('../../macro.js'),
            getGlobal().catch(() => null),
            getChart('bitcoin', 90).catch(() => null)
          ]);
          const btcSeries = (btcChart?.prices || [])
            .map((p) => (Array.isArray(p) ? p[1] : p?.price))
            .filter(Number.isFinite);
          const regime = global || btcSeries.length ? marketRegime({ global, btcSeries }) : null;

          const signals = [];
          const sym = String(asset || '').toUpperCase();
          if (sym) {
            const { analyze } = await import('../../ai.js');
            const id = COIN_IDS[sym] || sym.toLowerCase();
            const [coin, chart] = await Promise.all([
              (await import('../../api.js')).getCoin(id).catch(() => null),
              getChart(id, 90).catch(() => null)
            ]);
            const prices = (chart?.prices || []).map((p) => (Array.isArray(p) ? p[1] : p?.price)).filter(Number.isFinite);
            const a = prices.length >= 30 ? analyze(prices, coin || {}) : null;
            if (a) {
              signals.push({
                symbol: sym,
                signal: a.signal || null,
                score: num(a.score),
                confidence: num(a.confidence),
                basis: 'technical-indicators-backtested'
              });
            }
          } else {
            const markets = await getMarkets({ page: 1, perPage: 20 }).catch(() => []);
            for (const row of (Array.isArray(markets) ? markets : []).slice(0, 5)) {
              signals.push({
                symbol: String(row.symbol || '').toUpperCase(),
                change24hPct: num(row.change24h),
                basis: 'price-move-only'
              });
            }
          }

          return {
            ok: true,
            signals,
            regime: regime ? { label: regime.label ?? regime.regime ?? null, note: regime.note ?? null } : null,
            dataStatus: signals.length || regime ? 'live' : 'unavailable'
          };
        } catch (e) {
          return failed(e, { signals: [] });
        }
      }
    },

    smartMoneyService: {
      overview: async ({ window = '24h', minUsd = 100000 } = {}) => {
        try {
          const { smartMoneyContext } = await import('../../smartMoneyAI.js');
          const ctx = await smartMoneyContext({ window, minUsd });
          const points = Array.isArray(ctx?.dataPoints) ? ctx.dataPoints : [];
          return {
            ok: true,
            overview: ctx?.overview || null,
            evidence: ctx?.evidence || null,
            // Every data point carries its own source + observation time. That
            // is the contract the evidence layer relies on; do not flatten it.
            dataPoints: points,
            dataStatus: points.length ? 'live' : 'unavailable'
          };
        } catch (e) {
          return failed(e);
        }
      },
      track: async ({ token, window = '24h' } = {}) => {
        try {
          const { whaleTokenRanking } = await import('../../smartMoneyAI.js');
          const ranking = await whaleTokenRanking({ window });
          const rows = Array.isArray(ranking) ? ranking : [];
          const want = String(token || '').toUpperCase();
          const hits = want ? rows.filter((r) => String(r.symbol || '').toUpperCase() === want) : rows;
          return {
            ok: true,
            tokens: hits.slice(0, 10),
            window,
            dataStatus: hits.length ? 'live' : (rows.length ? 'empty' : 'unavailable')
          };
        } catch (e) {
          return failed(e, { tokens: [] });
        }
      }
    },

    whaleService: {
      track: async ({ token, minUsd = 100000, limit = 40 } = {}) => {
        try {
          const { fetchWhales } = await import('../../whales.js');
          // fetchWhales validates schema fbt.whales.v1 and never fabricates an
          // event — an empty list means nothing crossed the threshold.
          const res = await fetchWhales({ minUsd, limit });
          const events = Array.isArray(res?.events) ? res.events : [];
          const want = String(token || '').toUpperCase();
          const hits = want
            ? events.filter((e) => String(e?.token?.symbol || e?.symbol || '').toUpperCase() === want)
            : events;
          return {
            ok: true,
            events: hits.slice(0, 20),
            total: events.length,
            minUsd,
            dataStatus: hits.length ? 'live' : (events.length ? 'empty' : 'unavailable')
          };
        } catch (e) {
          return failed(e, { events: [] });
        }
      }
    },

    ordersService: {
      /**
       * Orders are LOCAL — lib/orders keeps them in localStorage, there is no
       * listOrders() and no server list. Reading them is synchronous.
       */
      list: async ({ status } = {}) => {
        try {
          const { loadOrders } = await import('../../orders.js');
          const all = loadOrders();
          const rows = status ? all.filter((o) => o.status === status) : all;
          return {
            ok: true,
            orders: rows,
            total: all.length,
            dataStatus: rows.length ? 'live' : 'empty'
          };
        } catch (e) {
          return failed(e, { orders: [] });
        }
      }
    },

    /**
     * Audio is owned by RadioDock via the radio store — it holds the app's only
     * <audio> element and must never unmount. lib/audio has no playAudio(); it
     * exposes getCalm() which returns the catalogue. The adapter therefore
     * RESOLVES a track and hands it back; the caller drives the store. Starting
     * a second <audio> here would play two things at once.
     */
    audioService: {
      resolve: async ({ mood, category } = {}) => {
        try {
          const { getCalm } = await import('../../audio.js');
          const feed = await getCalm();
          const tracks = Array.isArray(feed?.items) ? feed.items : (Array.isArray(feed) ? feed : []);
          if (!tracks.length) return { ok: false, dataStatus: 'unavailable', reason: 'NO_TRACKS' };
          const want = String(category || mood || '').toLowerCase();
          const match = want
            ? tracks.find((t) => `${t.category || ''} ${t.mood || ''} ${t.title || ''}`.toLowerCase().includes(want))
            : null;
          return { ok: true, track: match || tracks[0], total: tracks.length, dataStatus: 'live' };
        } catch (e) {
          return failed(e);
        }
      },
      play: async function play(input = {}) {
        // Kept for the tool registry's `calm.play` contract. It returns the
        // track for the caller to hand to the radio store — it does not, and
        // must not, start playback from inside a service adapter.
        const resolved = await this.resolve(input);
        return resolved.ok
          ? { ok: true, track: resolved.track, requiresStoreDispatch: true, dataStatus: 'live' }
          : resolved;
      },
      pause: async () => ({ ok: true, requiresStoreDispatch: true }),
      stop: async () => ({ ok: true, requiresStoreDispatch: true })
    }
  };
}
