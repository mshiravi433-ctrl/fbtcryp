/**
 * FBT CENTRAL INTELLIGENCE OS — Module Adapters (§11, §38).
 * ---------------------------------------------------------------------------
 * Each module keeps its own business logic; the adapter is the ONLY thing the
 * brain sees. Reads go to REAL services (market providers, LI.FI, dYdX,
 * yields, news, goals, the transaction store…). Nothing here invents data:
 * when a provider is down the adapter reports `dataStatus: 'unavailable'`
 * and the capability manager flips the module to DEGRADED.
 *
 * Client-owned truth (wallet balances, positions, lending positions) arrives
 * through the session's clientData — the server never holds a key and never
 * fabricates a balance (§3).
 */
import { withCache } from '../cache.js';
import { fetchMarkets, fetchGlobal, fetchSimplePrices } from '../providers.js';
import { fetchYields } from '../yields.js';
import { fetchPerpMarkets } from '../perp.js';
import { futuresRead, futuresQuote, futuresPrepare, futuresSimulate, futuresHealth, futuresCapabilities } from '../futures/intentAdapter.js';
import { fetchDydxMarkets, fetchDydxAccount } from '../dydx.js';
import { fetchAvantisEquities } from '../avantis.js';
import { fetchOstiumPrices } from '../ostium.js';
import { fetchNews } from '../news.js';
import { listGoals } from '../financialGoals.js';
import { crossChainHealth, getQuote as ccGetQuote, supportedChains } from '../crossChain.js';
import { getTransaction as ccGetTransaction, listTransactions as ccListTransactions, crossChainStoreHealth } from '../crossChainStore.js';
import { registerModule } from './registry.js';
import { publish } from './eventBus.js';
import { withTimeout } from './errorEngine.js';

const live = (data, extra = {}) => ({ ok: true, dataStatus: 'live', ...data, ...extra });
const unavailable = (reason, extra = {}) => ({ ok: false, dataStatus: 'unavailable', reason, ...extra });

/* -------------------------------------------------------------------------- */
/* market data reads (shared, cached)                                          */
/* -------------------------------------------------------------------------- */

const marketsRead = () => withCache('central:markets', 60_000, async () => {
  const rows = await fetchMarkets({ perPage: 50 });
  const coins = (Array.isArray(rows) ? rows : []).map((c) => ({
    symbol: String(c.symbol || '').toUpperCase(),
    name: c.name,
    priceUsd: Number(c.current_price) || null,
    change24hPct: Number.isFinite(Number(c.price_change_percentage_24h)) ? Number(c.price_change_percentage_24h) : null,
    change7dPct: Number.isFinite(Number(c.price_change_percentage_7d_in_currency)) ? Number(c.price_change_percentage_7d_in_currency) : null,
    volumeUsd: Number(c.total_volume) || null,
    marketCapUsd: Number(c.market_cap) || null,
    volatility24hPct: Number.isFinite(Number(c.high_24h)) && Number(c.low_24h) > 0
      ? Number((((Number(c.high_24h) - Number(c.low_24h)) / Number(c.low_24h)) * 100).toFixed(2))
      : null
  })).filter((c) => c.symbol);
  return { coins, at: Date.now() };
});

async function marketsAdapterRead() {
  try {
    const { value, stale } = await withTimeout(marketsRead(), 9000, 'markets');
    if (!value?.coins?.length) return unavailable('EMPTY_MARKET_DATA');
    return live({ coins: value.coins.slice(0, 50), count: value.coins.length }, { stale: stale === true });
  } catch (err) {
    return unavailable(String(err?.message || 'MARKETS_READ_FAILED').slice(0, 120));
  }
}

const priceFor = async (symbol) => {
  const map = { BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', BNB: 'binancecoin', XRP: 'ripple', DOGE: 'dogecoin', TON: 'the-open-network', TRX: 'tron', USDC: 'usd-coin', USDT: 'tether', DAI: 'dai' };
  const id = map[String(symbol || '').toUpperCase()];
  if (!id) return null;
  try {
    const { value } = await withCache(`central:price:${id}`, 60_000, () => fetchSimplePrices([id], 'usd'));
    return Number.isFinite(Number(value?.[id]?.usd)) ? Number(value[id].usd) : null;
  } catch { return null; }
};

/* -------------------------------------------------------------------------- */
/* adapter installation                                                        */
/* -------------------------------------------------------------------------- */

export function installAdapters() {
  /* ── markets / crypto ─────────────────────────────────────────────────── */
  registerModule({
    id: 'markets', label: 'Global Markets', permissionLevel: 'READ',
    declares: ['capability', 'tool', 'state', 'health', 'read', 'events', 'permissions', 'error', 'recovery', 'fallback'],
    operations: {
      read: marketsAdapterRead,
      healthCheck: async () => {
        try { const g = await withTimeout(fetchGlobal(), 7000, 'global'); return g ? { ok: true, status: 'AVAILABLE' } : { ok: false, status: 'DEGRADED', reason: 'EMPTY_GLOBAL' }; }
        catch (err) { return { ok: false, status: 'DEGRADED', reason: String(err?.message || '').slice(0, 120) }; }
      },
      capabilities: () => ({ status: 'AVAILABLE', operations: ['read'] })
    }
  });
  registerModule({
    id: 'crypto', label: 'Crypto Assets', permissionLevel: 'READ',
    declares: ['capability', 'tool', 'state', 'health', 'read'],
    operations: { read: marketsAdapterRead, healthCheck: async () => ({ ok: true, status: 'AVAILABLE' }), capabilities: () => ({ status: 'AVAILABLE', operations: ['read'] }) }
  });

  /* ── wallet (client-owned truth) ──────────────────────────────────────── */
  registerModule({
    id: 'wallet', label: 'Wallet', permissionLevel: 'READ',
    declares: ['capability', 'tool', 'state', 'health', 'read', 'events', 'permissions'],
    operations: {
      read: async (_input, ctx) => {
        const w = ctx?.clientData?.wallet;
        if (!w || (!w.evmAddresses?.length && !w.solanaAddresses?.length && !w.address)) return unavailable('WALLET_NOT_CONNECTED');
        return live({ ...w, connected: true });
      },
      healthCheck: async (_i, ctx) => (ctx?.clientData?.wallet ? { ok: true, status: 'AVAILABLE' } : { ok: true, status: 'READ_ONLY', reason: 'WALLET_NOT_CONNECTED' }),
      capabilities: () => ({ status: 'READ_ONLY', operations: ['read'], note: 'the server never signs; execution is prepared and handed to the user wallet' })
    }
  });

  /* ── portfolio (client holdings + computed analytics) ─────────────────── */
  registerModule({
    id: 'portfolio', label: 'Portfolio', permissionLevel: 'READ', dependsOn: ['wallet', 'markets'],
    declares: ['capability', 'tool', 'state', 'health', 'read', 'events', 'permissions'],
    operations: {
      read: async (_input, ctx) => {
        const p = ctx?.clientData?.portfolio;
        if (!p || !Number(p.totalValueUsd) || !Array.isArray(p.holdings) || !p.holdings.length) {
          return ctx?.clientData?.wallet ? unavailable('PORTFOLIO_EMPTY') : unavailable('WALLET_NOT_CONNECTED');
        }
        return live({ totalValueUsd: Number(p.totalValueUsd), holdings: p.holdings.slice(0, 40), partial: p.partial === true });
      },
      healthCheck: async (_i, ctx) => (ctx?.clientData?.portfolio?.holdings?.length ? { ok: true, status: 'AVAILABLE' } : { ok: true, status: 'READ_ONLY', reason: 'NO_HOLDINGS' }),
      capabilities: () => ({ status: 'AVAILABLE', operations: ['read'] })
    }
  });

  /* ── swap (LI.FI via the cross-chain engine; same-chain quotes included) ─ */
  registerModule({
    id: 'swap', label: 'Swap', permissionLevel: 'EXECUTE', dependsOn: ['markets', 'wallet'],
    declares: ['capability', 'tool', 'state', 'health', 'read', 'quote', 'prepare', 'simulate', 'execute', 'verify', 'error', 'recovery', 'fallback', 'events', 'permissions'],
    operations: {
      read: async () => live({ engine: 'lifi', note: 'use quote/prepare for rates' }),
      quote: async (input) => {
        const res = await ccGetQuote({ ...input }, { record: true });
        if (!res.ok) return { ok: false, status: 'PROVIDER_ERROR', error: res.code || 'QUOTE_FAILED', detail: res.detail || null };
        publish('TOOL_EXECUTED', { module: 'swap', op: 'quote' }, { source: 'adapters' });
        return live({ quote: res.quote }, { latencyMs: res.latencyMs });
      },
      prepare: async (input) => {
        // PREPARE = quote with signing intent: returns unsigned tx params.
        if (!input?.fromAddress) return { ok: false, status: 'POLICY', error: 'WALLET_REQUIRED', detail: 'fromAddress is required to build an unsigned transaction' };
        const res = await ccGetQuote({ ...input }, { record: true });
        if (!res.ok) return { ok: false, status: 'PROVIDER_ERROR', error: res.code || 'QUOTE_FAILED' };
        return live({ prepared: true, quote: res.quote, unsignedTx: res.quote?.transactionRequest || null, signer: 'user-wallet' });
      },
      simulate: async (input) => {
        const q = await ccGetQuote({ ...input }, { record: false });
        if (!q.ok) return { ok: false, status: 'PROVIDER_ERROR', error: q.code };
        const est = q.quote?.estimate || {};
        return live({ simulated: true, expectedOut: est.toAmount ?? null, gasCostUsd: est.gasCosts?.[0]?.amount?.usd ?? null, approvalRequired: true, warnings: [] });
      },
      execute: async () => ({ ok: false, status: 'POLICY', error: 'UNSIGNED_EXECUTION_ATTEMPT', detail: 'FBT server never signs or broadcasts; execution is handed to the user wallet (§33 EXECUTE with confirmation).' }),
      verify: async (input) => {
        const tx = await ccGetTransaction(String(input?.txId || '')).catch(() => null);
        return tx ? live({ verified: true, transaction: tx }) : unavailable('TX_NOT_FOUND');
      },
      healthCheck: async () => {
        try { const h = await withTimeout(crossChainHealth({ deep: false }), 8000, 'cc-health'); return h?.ok === false ? { ok: false, status: 'DEGRADED', reason: h.detail || 'PROVIDER_DOWN' } : { ok: true, status: 'AVAILABLE' }; }
        catch { return { ok: false, status: 'DEGRADED', reason: 'HEALTH_TIMEOUT' }; }
      },
      recover: async (err) => ({ recovered: false, strategy: 'FAILOVER_PROVIDER', error: String(err?.message || '').slice(0, 160) }),
      capabilities: () => ({ status: 'AVAILABLE', operations: ['quote', 'prepare', 'simulate', 'verify'] })
    }
  });

  /* ── bridge ────────────────────────────────────────────────────────────── */
  registerModule({
    id: 'bridge', label: 'Bridge', permissionLevel: 'EXECUTE', dependsOn: ['wallet'],
    declares: ['capability', 'tool', 'state', 'health', 'read', 'quote', 'prepare', 'simulate', 'execute', 'verify', 'error', 'recovery', 'fallback', 'events', 'permissions'],
    operations: {
      read: async () => live({ engine: 'lifi-bridge' }),
      quote: async (input) => {
        const res = await ccGetQuote({ ...input }, { record: true });
        if (!res.ok) return { ok: false, status: 'PROVIDER_ERROR', error: res.code || 'BRIDGE_QUOTE_FAILED' };
        return live({ quote: res.quote });
      },
      prepare: async (input) => {
        if (!input?.fromAddress) return { ok: false, status: 'POLICY', error: 'WALLET_REQUIRED' };
        const res = await ccGetQuote({ ...input }, { record: true });
        if (!res.ok) return { ok: false, status: 'PROVIDER_ERROR', error: res.code };
        return live({ prepared: true, quote: res.quote, unsignedTx: res.quote?.transactionRequest || null, signer: 'user-wallet' });
      },
      execute: async () => ({ ok: false, status: 'POLICY', error: 'UNSIGNED_EXECUTION_ATTEMPT', detail: 'broadcast is performed by the user wallet' }),
      verify: async (input) => {
        const tx = await ccGetTransaction(String(input?.txId || '')).catch(() => null);
        return tx ? live({ verified: true, transaction: tx }) : unavailable('TX_NOT_FOUND');
      },
      healthCheck: async () => {
        try { const chains = await withTimeout(supportedChains(), 8000, 'chains'); return chains?.ok ? { ok: true, status: 'AVAILABLE' } : { ok: false, status: 'DEGRADED', reason: 'CHAINS_UNAVAILABLE' }; }
        catch { return { ok: false, status: 'DEGRADED', reason: 'HEALTH_TIMEOUT' }; }
      },
      capabilities: () => ({ status: 'AVAILABLE', operations: ['quote', 'prepare', 'verify'] })
    }
  });

  /* ── lending & borrowing (client positions + live oracle price check) ─── */
  const lendingRead = async (input, ctx, side) => {
    const rows = (ctx?.clientData?.lendingPositions || []).filter((p) => (side === 'borrow' ? Number(p.borrowedUsd) > 0 : true));
    if (!rows.length) return unavailable(side === 'borrow' ? 'NO_BORROW_POSITION' : 'NO_LENDING_POSITION');
    const [first] = rows;
    const oraclePrice = await priceFor(first.collateralSymbol || 'ETH');
    return live({ positions: rows, primary: { ...first, oraclePriceUsd: oraclePrice }, oracle: oraclePrice == null ? 'unavailable' : 'live' });
  };
  const lendingHealth = async () => ({ ok: true, status: 'AVAILABLE', reason: 'position data is client-sourced; oracle spot-check only' });
  registerModule({
    id: 'lending', label: 'Lending', permissionLevel: 'EXECUTE', dependsOn: ['wallet', 'markets'],
    declares: ['capability', 'tool', 'state', 'health', 'read', 'quote', 'prepare', 'execute', 'verify', 'error', 'recovery', 'events', 'permissions'],
    operations: {
      read: (i, ctx) => lendingRead(i, ctx, 'lend'),
      quote: async (_i, ctx) => live({ position: ctx?.clientData?.lendingPositions?.[0] || null }),
      prepare: async () => ({ ok: false, status: 'READ_ONLY', error: 'OPERATION_NOT_SUPPORTED', detail: 'lending calldata is built by /api/lending/* (BFF); the central brain verifies and routes' }),
      execute: async () => ({ ok: false, status: 'POLICY', error: 'UNSIGNED_EXECUTION_ATTEMPT', detail: 'on-chain lending ops are signed by the user wallet' }),
      verify: async (_i, ctx) => live({ verified: ctx?.clientData?.lendingPositions?.length > 0, positions: ctx?.clientData?.lendingPositions?.length || 0 }),
      healthCheck: lendingHealth,
      capabilities: () => ({ status: 'AVAILABLE', operations: ['read', 'quote', 'verify'] })
    }
  });
  registerModule({
    id: 'borrowing', label: 'Borrowing', permissionLevel: 'EXECUTE', dependsOn: ['lending'],
    declares: ['capability', 'tool', 'state', 'health', 'read', 'quote', 'verify', 'error', 'recovery', 'events', 'permissions'],
    operations: {
      read: (i, ctx) => lendingRead(i, ctx, 'borrow'),
      quote: async (_i, ctx) => {
        const p = ctx?.clientData?.lendingPositions?.[0];
        if (!p) return unavailable('NO_BORROW_POSITION');
        return live({ borrowAprPct: Number(p.borrowAprPct) ?? null, maxAdditionalBorrowUsd: p.maxAdditionalBorrowUsd ?? null });
      },
      verify: async (_i, ctx) => live({ verified: ctx?.clientData?.lendingPositions?.some((p) => Number(p.borrowedUsd) > 0) === true }),
      healthCheck: lendingHealth,
      capabilities: () => ({ status: 'AVAILABLE', operations: ['read', 'quote'] })
    }
  });

  /* ── farming / liquidity / staking (DefiLlama yields) ─────────────────── */
  const yieldsRead = async (filter) => {
    try {
      const { value } = await withCache('central:yields', 5 * 60_000, fetchYields);
      let pools = Array.isArray(value?.pools) ? value.pools : [];
      if (filter === 'staking') pools = pools.filter((p) => /stak/i.test(String(p.symbol || '')));
      if (filter === 'lp') pools = pools.filter((p) => /-/.test(String(p.symbol || '')));
      return live({ pools: pools.slice(0, 25).map((p) => ({ project: p.project, symbol: p.symbol, apyPct: p.apy, apyBasePct: p.apyBase ?? null, tvlUsd: p.tvlUsd, chain: p.chain, riskBand: p.riskBand })) });
    } catch (err) { return unavailable(String(err?.message || 'YIELDS_FAILED').slice(0, 120)); }
  };
  const yieldsHealth = async () => {
    try { const { value } = await withTimeout(withCache('central:yields', 5 * 60_000, fetchYields), 9000, 'yields'); return value?.pools?.length ? { ok: true, status: 'AVAILABLE' } : { ok: false, status: 'DEGRADED', reason: 'EMPTY' }; }
    catch { return { ok: false, status: 'DEGRADED', reason: 'TIMEOUT' }; }
  };
  registerModule({ id: 'farming', label: 'Farming / Yields', permissionLevel: 'READ', declares: ['capability', 'tool', 'state', 'health', 'read', 'events', 'permissions'], operations: { read: () => yieldsRead(), healthCheck: yieldsHealth, capabilities: () => ({ status: 'AVAILABLE', operations: ['read'] }) } });
  registerModule({ id: 'liquidity', label: 'Liquidity Pools', permissionLevel: 'READ', declares: ['capability', 'tool', 'state', 'health', 'read'], operations: { read: () => yieldsRead('lp'), healthCheck: yieldsHealth, capabilities: () => ({ status: 'AVAILABLE', operations: ['read'] }) } });
  registerModule({ id: 'staking', label: 'Staking', permissionLevel: 'READ', declares: ['capability', 'tool', 'state', 'health', 'read'], operations: { read: () => yieldsRead('staking'), healthCheck: yieldsHealth, capabilities: () => ({ status: 'AVAILABLE', operations: ['read'] }) } });

  /* ── futures (Futures Engine v3: registry · router · fee · risk) ───────── */
  /*
   * The quote used to be `amount × leverage` computed here with no market,
   * no fee and no risk — a number that looked like a preview and was not one.
   * It now comes from the Futures Engine's intent adapter: a live market read,
   * the fee breakdown the UI shows, the risk verdict, the route decision and
   * an honest `executable` flag per provider. `prepare` builds the same
   * UNSIGNED calldata the On-Chain tab signs; the server never signs.
   */
  registerModule({
    id: 'futures', label: 'Futures / Perps', permissionLevel: 'EXECUTE', dependsOn: ['markets', 'portfolio'],
    declares: ['capability', 'tool', 'state', 'health', 'read', 'quote', 'prepare', 'simulate', 'execute', 'verify', 'error', 'recovery', 'fallback', 'events', 'permissions'],
    operations: {
      read: async (input) => {
        const engine = await futuresRead(input || {}).catch(() => null);
        if (engine?.ok && engine.rows?.length) return engine;
        /* Fallback: the funding comparison feed (read-only) — labelled as such. */
        try {
          const { value } = await withCache('central:perp', 3 * 60_000, fetchPerpMarkets);
          const rows = Object.entries(value?.assets || {}).flatMap(([symbol, group]) => (Array.isArray(group?.markets) ? group.markets : Array.isArray(group) ? group : []).slice(0, 5).map((t) => ({
            asset: symbol, venue: t.venue, lastPrice: t.price ?? null, fundingAprPct: t.fundingApr ?? null, openInterestUsd: t.openInterestUsd ?? null, volume24hUsd: t.volume24hUsd ?? null, custody: t.custody
          }))).slice(0, 30);
          return rows.length ? live({ rows, providers: engine?.providers || [], executableProviders: engine?.executableProviders || [], source: 'funding-comparison' }) : (engine || unavailable('EMPTY_PERP_DATA'));
        } catch (err) { return engine || unavailable(String(err?.message || 'PERP_FAILED').slice(0, 120)); }
      },
      quote: (input, ctx) => futuresQuote(input || {}, ctx || {}),
      prepare: (input, ctx) => futuresPrepare(input || {}, ctx || {}),
      simulate: (input, ctx) => futuresSimulate(input || {}, ctx || {}),
      execute: async () => ({ ok: false, status: 'POLICY', error: 'UNSIGNED_EXECUTION_ATTEMPT', detail: 'FBT server never signs or broadcasts; the On-Chain tab hands the prepared unsigned transaction to the user wallet.' }),
      verify: async (input) => {
        const id = String(input?.executionId || '');
        if (!id) return live({ verified: false, note: 'pass executionId (from prepare) and txHash to verify on-chain' });
        const { getExecution } = await import('../futures/ledger.js');
        const rec = await getExecution(id);
        return rec ? live({ verified: rec.state === 'COMPLETED', state: rec.state, txHash: rec.txHash, verification: rec.verification }) : unavailable('EXECUTION_NOT_FOUND');
      },
      healthCheck: futuresHealth,
      capabilities: futuresCapabilities
    }
  });

  /* ── dYdX ──────────────────────────────────────────────────────────────── */
  registerModule({
    id: 'dydx', label: 'dYdX', permissionLevel: 'EXECUTE', dependsOn: ['markets'],
    declares: ['capability', 'tool', 'state', 'health', 'read', 'quote', 'verify', 'error', 'recovery', 'events', 'permissions'],
    operations: {
      read: async (input) => {
        try {
          const markets = await withTimeout(fetchDydxMarkets(), 8000, 'dydx');
          const rows = (Array.isArray(markets?.markets) ? markets.markets : []).slice(0, 30).map((m) => ({
            market: m.market || m.symbol, oraclePrice: Number(m.oraclePrice) || null, indexPrice: Number(m.indexPrice) || null,
            nextFundingRatePct: m.nextFundingRate != null ? Number(m.nextFundingRate) * 100 : null, openInterestUsd: Number(m.openInterest) || null
          }));
          if (!rows.length) return unavailable('EMPTY_DYDX_DATA');
          if (input?.address) {
            const account = await fetchDydxAccount(String(input.address)).catch(() => null);
            return live({ rows, account: account || null });
          }
          return live({ rows });
        } catch (err) { return unavailable(String(err?.message || 'DYDX_FAILED').slice(0, 120)); }
      },
      quote: async (input) => live({ market: input?.market || null, side: input?.side || null, note: 'order building happens in the dYdX UI flow' }),
      verify: async () => live({ verified: false, note: 'account verification requires an address' }),
      healthCheck: async () => {
        try { const m = await withTimeout(fetchDydxMarkets(), 8000, 'dydx-health'); return m?.markets?.length ? { ok: true, status: 'AVAILABLE' } : { ok: false, status: 'DEGRADED' }; }
        catch { return { ok: false, status: 'DEGRADED', reason: 'INDEXER_UNREACHABLE' }; }
      },
      capabilities: () => ({ status: 'AVAILABLE', operations: ['read', 'quote'] })
    }
  });

  /* ── stocks / etf / funds (Avantis synthetic equities) ────────────────── */
  const stocksRead = async () => {
    try {
      const { value } = await withCache('central:avantis', 5 * 60_000, fetchAvantisEquities);
      const rows = (value?.rows || []).slice(0, 30);
      return rows.length ? live({ rows, venue: 'avantis', custody: 'synthetic-perp' }) : unavailable('EMPTY_EQUITY_DATA');
    } catch (err) { return unavailable(String(err?.message || 'AVANTIS_FAILED').slice(0, 120)); }
  };
  const stocksHealth = async () => {
    try { const { value } = await withTimeout(withCache('central:avantis', 5 * 60_000, fetchAvantisEquities), 9000, 'avantis'); return value?.rows?.length ? { ok: true, status: 'AVAILABLE' } : { ok: false, status: 'DEGRADED' }; }
    catch { return { ok: false, status: 'DEGRADED', reason: 'TIMEOUT' }; }
  };
  registerModule({ id: 'stocks', label: 'Stocks', permissionLevel: 'READ', declares: ['capability', 'tool', 'state', 'health', 'read', 'events', 'permissions'], operations: { read: stocksRead, healthCheck: stocksHealth, capabilities: () => ({ status: 'READ_ONLY', operations: ['read'] }) } });
  registerModule({ id: 'etf', label: 'ETF', permissionLevel: 'READ', declares: ['capability', 'tool', 'state', 'health', 'read'], operations: { read: stocksRead, healthCheck: stocksHealth, capabilities: () => ({ status: 'READ_ONLY', operations: ['read'] }) } });
  registerModule({ id: 'funds', label: 'Funds', permissionLevel: 'READ', declares: ['capability', 'tool', 'state', 'health', 'read'], operations: { read: () => yieldsRead(), healthCheck: yieldsHealth, capabilities: () => ({ status: 'READ_ONLY', operations: ['read'] }) } });

  /* ── forex / commodities / rwa (Ostium RWAs) ───────────────────────────── */
  const ostiumRead = async (kind) => {
    try {
      const { value } = await withCache('central:ostium', 5 * 60_000, fetchOstiumPrices);
      const rows = Array.isArray(value) ? value : (value?.assets || value?.prices || []);
      const list = Array.isArray(rows) ? rows : [];
      const filtered = kind ? list.filter((r) => String(r.assetType || r.type || '').toLowerCase().includes(kind)) : list;
      return filtered.length ? live({ rows: filtered.slice(0, 30), venue: 'ostium' }) : (list.length ? live({ rows: list.slice(0, 30), venue: 'ostium', note: `no ${kind} rows; showing all` }) : unavailable('EMPTY_OSTIUM_DATA'));
    } catch (err) { return unavailable(String(err?.message || 'OSTIUM_FAILED').slice(0, 120)); }
  };
  const ostiumHealth = async () => {
    try { const { value } = await withTimeout(withCache('central:ostium', 5 * 60_000, fetchOstiumPrices), 9000, 'ostium'); return value ? { ok: true, status: 'AVAILABLE' } : { ok: false, status: 'DEGRADED' }; }
    catch { return { ok: false, status: 'DEGRADED', reason: 'TIMEOUT' }; }
  };
  registerModule({ id: 'forex', label: 'Forex', permissionLevel: 'READ', declares: ['capability', 'tool', 'state', 'health', 'read'], operations: { read: () => ostiumRead('forex'), healthCheck: ostiumHealth, capabilities: () => ({ status: 'READ_ONLY', operations: ['read'] }) } });
  registerModule({ id: 'commodities', label: 'Commodities', permissionLevel: 'READ', declares: ['capability', 'tool', 'state', 'health', 'read'], operations: { read: () => ostiumRead('commodit'), healthCheck: ostiumHealth, capabilities: () => ({ status: 'READ_ONLY', operations: ['read'] }) } });
  registerModule({ id: 'rwa', label: 'RWA', permissionLevel: 'READ', declares: ['capability', 'tool', 'state', 'health', 'read'], operations: { read: () => ostiumRead(''), healthCheck: ostiumHealth, capabilities: () => ({ status: 'READ_ONLY', operations: ['read'] }) } });

  /* ── news ──────────────────────────────────────────────────────────────── */
  registerModule({
    id: 'news', label: 'News', permissionLevel: 'READ',
    declares: ['capability', 'tool', 'state', 'health', 'read', 'events', 'permissions'],
    operations: {
      read: async (input) => {
        try {
          const { value } = await withCache('central:news', 3 * 60_000, fetchNews);
          let items = value?.items || [];
          const q = String(input?.asset || '').toUpperCase();
          if (q) items = items.filter((i) => String(i.title || '').toUpperCase().includes(q));
          return live({ items: items.slice(0, 15).map((i) => ({ title: i.title, source: i.source, url: i.url, at: i.at, lang: i.lang })), filteredByAsset: q || null });
        } catch (err) { return unavailable(String(err?.message || 'NEWS_FAILED').slice(0, 120)); }
      },
      healthCheck: async () => {
        try { const { value } = await withTimeout(withCache('central:news', 3 * 60_000, fetchNews), 9000, 'news'); return value?.items?.length ? { ok: true, status: 'AVAILABLE' } : { ok: false, status: 'DEGRADED' }; }
        catch { return { ok: false, status: 'DEGRADED', reason: 'FEEDS_UNREACHABLE' }; }
      },
      capabilities: () => ({ status: 'AVAILABLE', operations: ['read'] })
    }
  });

  /* ── signals (derived from REAL market + perp data) ────────────────────── */
  registerModule({
    id: 'signals', label: 'Signals', permissionLevel: 'READ', dependsOn: ['markets', 'futures'],
    declares: ['capability', 'tool', 'state', 'health', 'read', 'events', 'permissions'],
    operations: {
      read: async (input) => {
        const mk = await marketsAdapterRead();
        if (!mk.ok) return mk;
        const wanted = input?.asset ? String(input.asset).toUpperCase() : null;
        const rows = mk.coins
          .filter((c) => (wanted ? c.symbol === wanted : true))
          .map((c) => {
            const mom = c.change24hPct == null ? 'NEUTRAL' : c.change24hPct > 3 ? 'BULLISH' : c.change24hPct < -3 ? 'BEARISH' : 'NEUTRAL';
            const vol = c.volatility24hPct == null ? 'UNKNOWN' : c.volatility24hPct > 8 ? 'HIGH' : c.volatility24hPct > 4 ? 'MEDIUM' : 'LOW';
            return { symbol: c.symbol, priceUsd: c.priceUsd, change24hPct: c.change24hPct, momentum: mom, volatility: vol, basis: 'price_change_24h+intraday_range' };
          }).slice(0, 20);
        publish('SIGNAL_CHANGED', { count: rows.length }, { source: 'signals-adapter' });
        return rows.length ? live({ rows }) : unavailable('NO_SIGNAL_ROWS');
      },
      healthCheck: async () => ({ ok: true, status: 'AVAILABLE', reason: 'derived from markets' }),
      capabilities: () => ({ status: 'AVAILABLE', operations: ['read'] })
    }
  });

  /* ── goals ─────────────────────────────────────────────────────────────── */
  registerModule({
    id: 'goals', label: 'Financial Goals', permissionLevel: 'EXECUTE', dependsOn: ['portfolio'],
    declares: ['capability', 'tool', 'state', 'health', 'read', 'events', 'permissions', 'error', 'recovery'],
    operations: {
      read: async (_i, ctx) => {
        try { const res = await listGoals(ctx?.owner || 'anon'); return live({ goals: res?.goals || [] }); }
        catch (err) { return unavailable(String(err?.message || 'GOALS_FAILED').slice(0, 120)); }
      },
      healthCheck: async () => ({ ok: true, status: 'AVAILABLE' }),
      capabilities: () => ({ status: 'AVAILABLE', operations: ['read', 'execute'] })
    }
  });

  /* ── transactions ──────────────────────────────────────────────────────── */
  registerModule({
    id: 'transactions', label: 'Transactions', permissionLevel: 'READ',
    declares: ['capability', 'tool', 'state', 'health', 'read', 'verify', 'events', 'permissions'],
    operations: {
      read: async (input) => {
        try {
          if (input?.id) { const tx = await ccGetTransaction(String(input.id)); return tx ? live({ transaction: tx }) : unavailable('TX_NOT_FOUND'); }
          const rows = input?.wallet ? await ccListTransactions(String(input.wallet)) : [];
          return live({ rows });
        } catch (err) { return unavailable(String(err?.message || 'TX_FAILED').slice(0, 120)); }
      },
      verify: async (input) => {
        const tx = await ccGetTransaction(String(input?.id || '')).catch(() => null);
        return tx ? live({ verified: true, status: tx.status || tx.executionStatus || 'UNKNOWN', transaction: tx }) : unavailable('TX_NOT_FOUND');
      },
      healthCheck: async () => { const h = crossChainStoreHealth(); return { ok: h.ok !== false, status: h.ok === false ? 'DEGRADED' : 'AVAILABLE' }; },
      capabilities: () => ({ status: 'AVAILABLE', operations: ['read', 'verify'] })
    }
  });

  /* ── risk / forecast / events / alerts / lab / prediction / profit-plan ── */
  registerModule({
    id: 'risk', label: 'Central Risk Engine', permissionLevel: 'READ', dependsOn: ['portfolio', 'lending', 'futures'],
    declares: ['capability', 'tool', 'state', 'health', 'read', 'permissions'],
    operations: {
      read: async () => live({ engine: 'central-risk', scope: ['portfolio', 'lending', 'futures', 'swap', 'bridge', 'goals'] }),
      healthCheck: async () => ({ ok: true, status: 'AVAILABLE' }),
      capabilities: () => ({ status: 'AVAILABLE', operations: ['read'] })
    }
  });
  registerModule({
    id: 'forecast', label: 'Forecast', permissionLevel: 'READ', dependsOn: ['markets', 'futures'],
    declares: ['capability', 'tool', 'state', 'health', 'read'],
    operations: {
      read: async (input) => {
        const mk = await marketsAdapterRead();
        if (!mk.ok) return mk;
        const wanted = input?.asset ? String(input.asset).toUpperCase() : 'BTC';
        const coin = mk.coins.find((c) => c.symbol === wanted);
        if (!coin) return unavailable('ASSET_NOT_FOUND');
        // Honest, data-grounded regime read — NOT a price prediction.
        const trend = coin.change7dPct == null ? 'UNKNOWN' : coin.change7dPct > 5 ? 'UP' : coin.change7dPct < -5 ? 'DOWN' : 'FLAT';
        return live({ asset: wanted, trend7d: trend, volatility: coin.volatility24hPct, change7dPct: coin.change7dPct, basis: '7d_change+intraday_range', isPrediction: false });
      },
      healthCheck: async () => ({ ok: true, status: 'AVAILABLE' }),
      capabilities: () => ({ status: 'AVAILABLE', operations: ['read'] })
    }
  });
  registerModule({
    id: 'events', label: 'Events', permissionLevel: 'READ',
    declares: ['capability', 'tool', 'state', 'health', 'read', 'events'],
    operations: {
      read: async () => live({ note: 'live event stream; use /api/system/events for the ring buffer' }),
      healthCheck: async () => ({ ok: true, status: 'AVAILABLE' }),
      capabilities: () => ({ status: 'AVAILABLE', operations: ['read'] })
    }
  });
  registerModule({
    id: 'alerts', label: 'Alerts', permissionLevel: 'READ',
    declares: ['capability', 'tool', 'state', 'health', 'read'],
    operations: {
      read: async (_i, ctx) => live({ rows: ctx?.clientData?.alerts || [], dataStatus: ctx?.clientData?.alerts?.length ? 'client' : 'unavailable' }),
      healthCheck: async () => ({ ok: true, status: 'AVAILABLE' }),
      capabilities: () => ({ status: 'AVAILABLE', operations: ['read'] })
    }
  });
  registerModule({
    id: 'lab', label: 'Lab', permissionLevel: 'READ',
    declares: ['capability', 'tool', 'state', 'health', 'read'],
    operations: {
      read: async () => live({ modules: ['prediction', 'paper-trading', 'investment-simulator', 'strategy-lab', 'risk-trainer', 'defi-simulator', 'what-if'], sharedEngines: ['markets', 'risk'], note: 'Lab consumes the same market data and risk engine as the brain (§29)' }),
      healthCheck: async () => ({ ok: true, status: 'AVAILABLE' }),
      capabilities: () => ({ status: 'AVAILABLE', operations: ['read'] })
    }
  });
  registerModule({
    id: 'prediction', label: 'Prediction (Lab)', permissionLevel: 'READ', dependsOn: ['markets'],
    declares: ['capability', 'tool', 'state', 'health', 'read'],
    operations: { read: async () => live({ game: true, usesLiveMarketData: true }), healthCheck: async () => ({ ok: true, status: 'AVAILABLE' }), capabilities: () => ({ status: 'AVAILABLE', operations: ['read'] }) }
  });
  registerModule({
    id: 'profit-plan', label: 'Profit Plan', permissionLevel: 'READ', dependsOn: ['portfolio', 'markets', 'goals', 'risk'],
    declares: ['capability', 'tool', 'state', 'health', 'read'],
    operations: {
      read: async () => live({ note: 'plan generation runs inside the pipeline (goal + portfolio + markets + risk)' }),
      healthCheck: async () => ({ ok: true, status: 'AVAILABLE' }),
      capabilities: () => ({ status: 'AVAILABLE', operations: ['read'] })
    }
  });
  registerModule({
    id: 'notifications', label: 'Notifications', permissionLevel: 'READ',
    declares: ['capability', 'tool', 'state', 'health', 'read'],
    operations: {
      read: async () => live({ channels: ['push', 'telegram'], note: 'delivery is handled by the push/telegram services' }),
      healthCheck: async () => ({ ok: true, status: 'READ_ONLY' }),
      capabilities: () => ({ status: 'READ_ONLY', operations: ['read'] })
    }
  });
}

export const adapterInternals = { priceFor, marketsRead };
