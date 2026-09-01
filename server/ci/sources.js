/**
 * FBT CENTRAL INTELLIGENCE OS — real data sources (spec §3, §9, §17, §25).
 * ---------------------------------------------------------------------------
 * §3 says the LLM is never a source of truth and lists the services that ARE.
 * This file is the ONLY place in the Central Intelligence subsystem that touches
 * them. Every adapter calls through here, which buys three things:
 *
 * 1. ONE provider-health ledger for the whole brain. `health.record()` is what
 *    turns "an RPC hiccup" into a `DEGRADED` capability the policy engine sees,
 *    instead of a silent empty panel.
 * 2. ONE timeout + failover discipline (§39). Nothing in `server/ci` may `fetch`
 *    directly; `guarded()` is the wrapper that applies the ladder from
 *    `errors.js` and reports the outcome.
 * 3. A seam the probes can drive. `setCiSource()` swaps an implementation for a
 *    deterministic one — see the honesty note at the bottom of this header.
 *
 * ─── THE INJECTION TRADE-OFF, STATED PLAINLY ───────────────────────────────
 * Tests replace these functions so the CENTRAL PIPELINE (context resolution,
 * plan, policy, dedupe, cascade, verification, reply) can be proven with exact
 * numbers and no network. That proves the WIRING. It does NOT prove that
 * Li.FI answers or that the Aave pool is at the address we think it is — those
 * are covered by the existing live probes elsewhere in this repo
 * (phase153-cross-chain-live, lending-bff-probe, btc-wallet-probe), which is
 * where a change to a real endpoint has to be re-run. A probe that fakes its own
 * dependencies and then claims the integration is verified is the failure mode
 * this comment exists to make visible.
 */
import { createHash } from 'node:crypto';
import { Interface, isAddress, formatUnits } from 'ethers';
import { withCache } from '../cache.js';
import { fetchSimplePrices, fetchGlobal, fetchChart, fetchMarkets } from '../providers.js';
import { fetchYields } from '../yields.js';
import { fetchNews } from '../news.js';
import { fetchPerpMarkets } from '../perp.js';
import { fetchDydxMarkets, fetchDydxAccount } from '../dydx.js';
import { bridgeQuote } from '../bridge.js';
import { proxyKyberRoutes, proxyOoQuote, kyberSlug, ooSlug } from '../swapProxy.js';
import { listGoals, marketSnapshot } from '../financialGoals.js';
import { fetchAvantisEquities } from '../avantis.js';
import { fetchOstiumPrices } from '../ostium.js';
import { fetchDydxMarkets as dydxMarketsReal } from '../dydx.js';
import {
  chainTokens, findToken, rpcWithFailover, readUserAccount, readReserve, oraclePrices
} from '../lending.js';
import { EVM_CHAINS, EVM_CHAIN_ORDER, TOKENS } from '../chainsLite.js';
import { classifyError, nextRecovery } from '../../src/lib/central/errors.js';

const TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 12_000);
const MAX_RPC_CHAINS = 4;

/* ── provider health ledger ────────────────────────────────────────────── */
/*
 * Rolling per-source state. `failures` is the counter a capability manager reads
 * to decide AVAILABLE → DEGRADED → UNAVAILABLE; `lastOkAt` is what proves a
 * source is back so a recovery event is real rather than a timer.
 */
const ledger = new Map();

export function healthRecord(source, ok, detail = null, latencyMs = null) {
  const prev = ledger.get(source) || { source, failures: 0, successes: 0, consecutive: 0, lastAt: 0, lastOkAt: 0, lastError: null };
  const next = ok
    ? { ...prev, failures: 0, successes: prev.successes + 1, consecutive: 0, lastAt: Date.now(), lastOkAt: Date.now(), lastError: null, lastLatencyMs: latencyMs }
    : { ...prev, failures: prev.failures + 1, consecutive: prev.consecutive + 1, lastAt: Date.now(), lastError: String(detail || 'error').slice(0, 160), lastLatencyMs: latencyMs };
  ledger.set(source, next);
  return next;
}

export function healthSnapshot(sources = null) {
  const rows = [...ledger.values()];
  const wanted = sources ? rows.filter((r) => sources.includes(r.source)) : rows;
  return wanted.map((r) => ({
    source: r.source,
    status: r.consecutive >= 3 ? 'DOWN' : r.consecutive >= 1 ? 'DEGRADED' : 'HEALTHY',
    consecutiveFailures: r.consecutive,
    successes: r.successes,
    lastOkAt: r.lastOkAt || null,
    lastAt: r.lastAt || null,
    lastError: r.lastError,
    latencyMs: r.lastLatencyMs ?? null
  }));
}

export function healthReset() { ledger.clear(); }

/** `retryAfterMs` from a 429 body, if the provider was kind enough to say. */
const retryAfter = (detail) => {
  const m = /retry[-_ ]after\D+(\d+)/i.exec(String(detail || ''));
  return m ? Math.min(30_000, Number(m[1]) * 1000) : null;
};

/**
 * `guarded` — the §39 ladder as a wrapper: call, on failure classify, take the
 * next rung, retry or failover, and record the outcome for health. A rung of
 * `SERVE_STALE_WITH_FLAG` returns the cached copy WITH `stale: true`, which the
 * state layer stores and the policy layer refuses to execute on. That chain is
 * why the flag has to be set here rather than in the caller: a caller that
 * forgets it turns a degraded source into a confident lie.
 */
export async function guarded(source, fn, { maxAttempts = 3, staleKey = null, ttlMs = 60_000, producers } = {}) {
  const start = Date.now();
  let attempts = 0;
  let lastError = null;
  while (attempts < maxAttempts) {
    try {
      const value = await fn({ attempt: attempts, providers: producers || [] });
      healthRecord(source, true, null, Date.now() - start);
      if (staleKey) await setStale(staleKey, value);
      return { ok: true, value, attempts, at: Date.now(), latencyMs: Date.now() - start };
    } catch (error) {
      attempts += 1;
      lastError = classifyError(error, { module: source });
      healthRecord(source, false, lastError.technical || lastError.code, Date.now() - start);
      const recovery = nextRecovery(lastError, { attempts, providers: producers || [] });
      if (recovery.done) break;
      const action = recovery.actions?.[0];
      if (action?.type === 'SERVE_STALE_WITH_FLAG' && staleKey) {
        const stale = await getStale(staleKey);
        if (stale !== null) {
          healthRecord(source, false, 'served-stale', Date.now() - start);
          return { ok: true, value: stale, stale: true, staleReason: lastError.code, attempts, at: Date.now() };
        }
        break;
      }
      const wait = action?.delayMs ?? retryAfter(lastError.technical) ?? 250;
      await sleep(Math.min(2_500, wait));
    }
  }
  const stale = staleKey ? await getStale(staleKey) : null;
  if (stale !== null) return { ok: true, value: stale, stale: true, staleReason: lastError?.code || 'SOURCE_FAILED', attempts, at: Date.now() };
  return { ok: false, error: lastError, code: lastError?.code || 'SOURCE_UNAVAILABLE', attempts, at: Date.now() };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Stale fallbacks live in the shared TTL cache so a serverless instance reuses
   what it already fetched instead of keeping a second memory of the same rows. */
async function getStale(key) {
  const hit = await withCache(key, 1, () => null, {});
  return hit?.value ?? null;
}
async function setStale(key, value) {
  // withCache caches on producer success; this mirrors the last good value.
  const holder = value;
  await withCache(key, 24 * 3600_000, () => holder, {});
  return value;
}

/* ── the swappable source registry ─────────────────────────────────────── */
const DEFAULT_SOURCES = {
  walletBalances,
  portfolioSummary,
  marketSnapshot: marketSnapshotReal,
  assetHistory,
  lendingPosition,
  lendingReserve,
  perpMarkets,
  dydxAccount,
  yields,
  news,
  signals,
  goalList,
  goalMarketSnapshot,
  swapQuote,
  bridgeQuoteSource,
  equitiesMarkets,
  rwaMarkets,
  transactionReceipt,
  tokenRisk: tokenRiskReal,
  swapTokenSafety
};

const active = { ...DEFAULT_SOURCES };

/** Used by probes only. Returns the previous implementation so tests can restore. */
export function setCiSource(name, fn) {
  const previous = active[name] || null;
  if (fn === null || fn === undefined) delete active[name];
  else active[name] = fn;
  return { name, replaced: Boolean(previous), previous };
}

export function resetCiSources() {
  for (const key of Object.keys(active)) delete active[key];
  Object.assign(active, DEFAULT_SOURCES);
}

export function ciSource(name) {
  return active[name] || DEFAULT_SOURCES[name];
}

export const CI_SOURCE_NAMES = Object.freeze(Object.keys(DEFAULT_SOURCES));

/* ── wallet: real on-chain reads through the shared multi-RPC failover ──── */
/**
 * Balances are read from the chain, not from a client payload. That is the
 * difference between "the app drew what your browser said" and the brain being
 * able to answer «وضعیت پرتفوی» when the tab that holds the wallet is closed.
 *
 * Only the allowlisted, audited token registry (chainsLite) is read — an
 * arbitrary address would turn this into a data oracle for anyone's token, and a
 * token that is not in the registry is reported in `skipped`, not silently dropped.
 */
async function walletBalances({ addresses = {}, chainIds = null } = {}) {
  const evm = (addresses.evm || []).filter(isAddress).slice(0, 3);
  if (!evm.length) return { ok: false, code: 'NO_WALLET_ADDRESS', balances: [], totalValueUsd: null };
  const chains = (chainIds && chainIds.length ? chainIds : EVM_CHAIN_ORDER).filter((c) => EVM_CHAINS[c]).slice(0, MAX_RPC_CHAINS);
  const perChain = await Promise.all(chains.map(async (chainId) => {
    const chain = EVM_CHAINS[chainId];
    const address = evm[0];
    const nativeRes = await rpcWithFailover(chainId, 'eth_getBalance', [address, 'latest']);
    const tokens = (TOKENS[chainId] || []).filter((t) => !t.native).slice(0, 8);
    const iface = new Interface(['function balanceOf(address) view returns (uint256)']);
    const tokenRes = tokens.length
      ? await Promise.all(tokens.map(async (t) => {
        const r = await rpcWithFailover(chainId, 'eth_call', [{ to: t.address, data: iface.encodeFunctionData('balanceOf', [address]) }, 'latest']);
        if (!r.ok) return { token: t, error: r.code };
        try {
          const raw = BigInt(r.result || '0x0');
          return { token: t, amount: Number(formatUnits(raw, t.decimals)) };
        } catch (error) {
          return { token: t, error: String(error.message).slice(0, 60) };
        }
      }))
      : [];
    const native = nativeRes.ok ? Number(formatUnits(BigInt(nativeRes.result || '0x0'), chain.native.decimals)) : null;
    return { chainId, address, native, nativeError: nativeRes.ok ? null : nativeRes.code, tokens: tokenRes };
  }));

  const ids = new Set();
  const rows = [];
  const skipped = [];
  for (const chain of perChain) {
    const meta = EVM_CHAINS[chain.chainId];
    if (chain.native !== null && chain.native > 0) {
      ids.add(meta.native.coingeckoId);
      rows.push({ symbol: meta.native.symbol, chainId: chain.chainId, amount: chain.native, coingeckoId: meta.native.coingeckoId });
    } else if (chain.nativeError) skipped.push({ chainId: chain.chainId, symbol: meta.native.symbol, reason: chain.nativeError });
    for (const t of chain.tokens) {
      if (t.error) { skipped.push({ chainId: chain.chainId, symbol: t.token.symbol, reason: t.error }); continue; }
      if (t.amount > 0) {
        ids.add(t.token.coingeckoId);
        rows.push({ symbol: t.token.symbol, chainId: chain.chainId, amount: t.amount, coingeckoId: t.token.coingeckoId });
      }
    }
  }
  const priceRes = await guarded('market-data', async () => fetchSimplePrices([...ids], 'usd'), { staleKey: 'ci:prices:snapshot' });
  const prices = priceRes.ok ? (priceRes.value || {}) : {};
  const balances = rows.map((r) => {
    const price = Number(prices?.[r.coingeckoId]?.usd);
    return {
      symbol: r.symbol, chainId: r.chainId, amount: r.amount,
      priceUsd: Number.isFinite(price) && price > 0 ? price : null,
      valueUsd: Number.isFinite(price) && price > 0 ? round(r.amount * price, 4) : null,
      source: 'blockchain'
    };
  });
  const total = balances.reduce((acc, b) => acc + (b.valueUsd ?? 0), 0);
  return {
    ok: true,
    connected: true,
    addresses: { evm: perChain.map((c) => c.address) },
    chainsRead: perChain.map((c) => c.chainId),
    balances,
    totalValueUsd: balances.some((b) => b.valueUsd !== null) ? round(total, 2) : null,
    unpriced: balances.filter((b) => b.valueUsd === null).map((b) => b.symbol),
    skipped: skipped.slice(0, 12),
    stale: priceRes.stale === true,
    priceStaleReason: priceRes.staleReason || null,
    partial: skipped.length > 0 || !priceRes.ok || priceRes.stale === true,
    source: 'wallet-service + blockchain + market-data',
    at: Date.now()
  };
}

/* ── portfolio: composition built from the wallet read, never re-guessed ── */
async function portfolioSummary({ wallet }) {
  if (!wallet?.balances?.length) return { ok: false, code: 'NO_WALLET_READ' };
  const bySymbol = new Map();
  for (const b of wallet.balances) {
    const key = String(b.symbol || '?').toUpperCase();
    const prev = bySymbol.get(key) || { symbol: key, amount: 0, valueUsd: 0, chains: new Set(), priceUsd: b.priceUsd ?? null };
    prev.amount += Number(b.amount) || 0;
    prev.valueUsd += Number(b.valueUsd) || 0;
    if (b.chainId != null) prev.chains.add(b.chainId);
    bySymbol.set(key, prev);
  }
  const total = [...bySymbol.values()].reduce((a, h) => a + h.valueUsd, 0);
  const holdings = [...bySymbol.values()].map((h) => ({
    symbol: h.symbol,
    amount: round(h.amount, 8),
    valueUsd: round(h.valueUsd, 2),
    priceUsd: h.priceUsd,
    chains: [...h.chains],
    sharePct: total > 0 ? round((h.valueUsd / total) * 100, 2) : null,
    category: categoryOf(h.symbol)
  })).sort((a, b) => b.valueUsd - a.valueUsd);
  const stableShare = holdings.filter((h) => h.category === 'stable').reduce((a, h) => a + h.valueUsd, 0);
  return {
    ok: true,
    totalValueUsd: round(total, 2),
    holdings,
    stableSharePct: total > 0 ? round((stableShare / total) * 100, 2) : null,
    positionCount: holdings.length,
    unpriced: wallet.unpriced || [],
    stale: wallet.stale === true,
    source: wallet.source || 'wallet-service',
    at: Date.now()
  };
}

const STABLE_SYMBOLS = new Set(['USDC', 'USDT', 'DAI', 'FDUSD', 'USDE', 'TUSD', 'PYUSD', 'LUSD']);
const categoryOf = (symbol) => (STABLE_SYMBOLS.has(String(symbol).toUpperCase()) ? 'stable' : 'crypto');

/* ── market intelligence (§25) ─────────────────────────────────────────── */
async function marketSnapshotReal({ symbols = [] } = {}) {
  const wanted = Array.from(new Set(symbols.map((s) => String(s).toUpperCase()).filter(Boolean))).slice(0, 12);
  const ids = wanted.map(symbolId).filter(Boolean);
  const [priceRes, breadthRes, marketRes] = await Promise.all([
    guarded('market-data', () => fetchSimplePrices(ids.length ? ids : ['bitcoin', 'ethereum', 'solana'], 'usd'), { staleKey: 'ci:prices:snapshot' }),
    guarded('market-data', () => fetchGlobal(), { staleKey: 'ci:global:snapshot' }),
    guarded('market-data', () => fetchMarkets({ perPage: 50 }), { staleKey: 'ci:markets:top' })
  ]);
  const prices = priceRes.ok ? (priceRes.value || {}) : {};
  const bySymbol = {};
  const idsToSymbol = {};
  for (const id of ids) idsToSymbol[id] = Object.keys(ASSET_IDS).find((k) => ASSET_IDS[k] === id);
  for (const [id, quote] of Object.entries(prices)) {
    const symbol = idsToSymbol[id] || id.toUpperCase();
    const price = Number(quote?.usd);
    if (Number.isFinite(price) && price > 0) bySymbol[symbol] = round(price, 6);
  }
  /* `fetchMarkets` answers the NORMALISED coin list (array), not a paged
     envelope — reading `.markets` off it produced an empty object that looked
     exactly like "the market is flat", which is the worst possible silent
     failure: confident, wrong, and indistinguishable from a real answer. */
  const top = Array.isArray(marketRes.value) ? marketRes.value.slice(0, 40) : [];
  const changes24hPct = {};
  const volatilityPct = {};
  const history = {};
  for (const row of top) {
    const symbol = String(row?.symbol || '').toUpperCase();
    if (!symbol) continue;
    const change = Number(row.change24h);
    if (Number.isFinite(change)) changes24hPct[symbol] = round(change, 3);
    /* The 7-day sparkline the market endpoint already carries: realized
       volatility and a price series for correlations, for free. Deriving vol
       from a fetched series is fine; deriving it from nothing is not. */
    const spark = Array.isArray(row.sparkline) ? row.sparkline.map(Number).filter((n) => Number.isFinite(n) && n > 0) : [];
    if (spark.length >= 20) {
      history[symbol] = spark.map((price, i) => ({ at: row.last_checked ? Number(row.last_checked) - (spark.length - i) * 3600_000 : null, price }));
      const rets = spark.slice(1).map((c, i) => (c - spark[i]) / spark[i]);
      const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
      const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1));
      volatilityPct[symbol] = round(sd * 100, 3);
    }
  }
  const global = globalRes(breadthRes.value);
  const stale = [priceRes, breadthRes, marketRes].some((r) => r.stale === true);
  const failed = [priceRes, breadthRes, marketRes].filter((r) => !r.ok);
  return {
    ok: Object.keys(bySymbol).length > 0 || !!global,
    prices: bySymbol,
    changes24hPct,
    volatilityPct,
    history,
    breadth: global,
    topGainers: top.filter((r) => Number(r?.price_change_percentage_24h) > 0).slice(0, 5).map(compactMarket),
    topLosers: top.filter((r) => Number(r?.price_change_percentage_24h) < 0).slice(0, 5).map(compactMarket),
    stale,
    staleReason: stale ? [priceRes, breadthRes, marketRes].find((r) => r.stale)?.staleReason || 'AGE_OVER_BUDGET' : null,
    failedSources: failed.map((f) => f.code),
    source: 'market-data',
    at: Date.now()
  };
}

/* providers.fetchGlobal() already normalises CoinLore and CoinGecko into ONE
   shape, so the brain reads that shape and inherits both providers — including
   the fallback, which is the entire point of §39 for market breadth. */
const globalRes = (raw) => {
  if (!raw || typeof raw !== 'object') return null;
  const mcap = Number(raw.mcap);
  if (!Number.isFinite(mcap) || mcap <= 0) return null;
  return {
    totalMarketCapUsd: round(mcap, 0),
    totalVolumeUsd: Number.isFinite(Number(raw.volume)) ? round(Number(raw.volume), 0) : null,
    marketCapChange24hPct: Number.isFinite(Number(raw.mcapChange)) ? round(Number(raw.mcapChange), 3) : null,
    activeCryptocurrencies: Number(raw.coins) || null,
    btcDominancePct: Number.isFinite(Number(raw.btcDominance)) ? round(Number(raw.btcDominance), 2) : null,
    provider: raw.source || 'market-data'
  };
};
const compactMarket = (row) => ({
  symbol: String(row?.symbol || '').toUpperCase(), name: row?.name || null, priceUsd: Number(row?.current_price) ?? null,
  change24hPct: Number(row?.price_change_percentage_24h) ?? null, marketCapUsd: Number(row?.market_cap) ?? null
});

async function assetHistory({ id, days = 30 } = {}) {
  const coinId = ASSET_IDS[String(id || '').toUpperCase()] || String(id || '').toLowerCase();
  const res = await guarded('market-data', () => fetchChart(coinId, days, 'usd'), { staleKey: `ci:chart:${coinId}:${days}` });
  if (!res.ok) return { ok: false, code: res.code };
  /* fetchChart already maps [t, p] to { t, p }; expecting raw tuples here would
     read `undefined` for every point and "no history" would look like a market
     that never moved. */
  const prices = Array.isArray(res.value) ? res.value : (Array.isArray(res.value?.prices) ? res.value.prices : []);
  return {
    ok: prices.length > 0,
    series: prices.map((p) => ({ at: Number(p.t ?? p.at ?? p[0]), price: Number(p.p ?? p.price ?? p[1]) })).filter((p) => Number.isFinite(p.price) && p.price > 0),
    stale: res.stale === true,
    source: 'market-data',
    at: Date.now()
  };
}

/* ── signals: computed from real history, labelled as such ──────────────── */
/**
 * This is a technical read computed from fetched prices — SMA cross, momentum,
 * realized vol — NOT a proprietary alpha feed. Saying which it is matters: a
 * user who believes "signal: bullish" came from an analyst weights it differently,
 * and the reply composer carries `method` into the answer on purpose.
 */
async function signals({ symbols = [] } = {}) {
  const wanted = (symbols.length ? symbols : ['BTC', 'ETH']).slice(0, 6).map((s) => String(s).toUpperCase());
  const series = await Promise.all(wanted.map(async (symbol) => {
    const hist = await assetHistory({ id: symbol, days: 30 });
    return { symbol, series: hist.ok ? hist.series : null, failed: !hist.ok };
  }));
  const byAsset = {};
  let failed = 0;
  for (const row of series) {
    if (!row.series || row.series.length < 10) { failed += 1; continue; }
    const closes = row.series.map((p) => p.price);
    const sma = (n) => closes.slice(-n).reduce((a, b) => a + b, 0) / Math.max(1, n);
    const fast = sma(Math.min(7, closes.length));
    const slow = sma(Math.min(21, closes.length));
    const first = closes[0];
    const last = closes[closes.length - 1];
    const returns = closes.slice(1).map((c, i) => (c - closes[i]) / closes[i]);
    const mean = returns.reduce((a, b) => a + b, 0) / Math.max(1, returns.length);
    const vol = Math.sqrt(returns.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, returns.length - 1));
    const trend = slow > 0 ? (fast - slow) / slow : 0;
    byAsset[row.symbol] = {
      direction: trend > 0.015 ? 'bullish' : trend < -0.015 ? 'bearish' : 'neutral',
      strength: round(Math.max(0, Math.min(1, Math.abs(trend) * 12)), 3),
      smaFast: round(fast, 6), smaSlow: round(slow, 6),
      changeWindowPct: round(first > 0 ? ((last - first) / first) * 100 : 0, 2),
      volatilityDailyPct: round(vol * 100, 3),
      samples: closes.length,
      method: 'SMA(7/21) cross + realized volatility over the fetched window',
      source: 'signals-engine (computed from market-data)',
      at: Date.now()
    };
  }
  return {
    ok: Object.keys(byAsset).length > 0,
    byAsset,
    coverage: { requested: wanted.length, computed: Object.keys(byAsset).length, failed },
    stale: false,
    source: 'signals-engine',
    at: Date.now()
  };
}

/* ── lending: the SAME functions the /lending page uses ─────────────────── */
async function lendingPosition({ wallet, chainId = 1 } = {}) {
  if (!wallet || !isAddress(wallet)) return { ok: false, code: 'NO_WALLET_ADDRESS' };
  const account = await guarded('lending-protocol', () => readUserAccount(chainId, wallet), { staleKey: null });
  if (!account.ok) return { ok: false, code: account.error?.code || 'POSITION_READ_FAILED', detail: account.error?.technical || null };
  const reserve = await guarded('lending-protocol', async () => readReserve(chainId, findToken(chainId, 'USDC') || (chainTokens(chainId) || []).find((t) => t.symbol === 'USDC')), {});
  const oracle = await guarded('lending-protocol', () => oraclePrices(chainId), { staleKey: `ci:oracle:${chainId}` });
  const data = account.value;
  const debtUsd = Number(data.totalDebtUsd) || 0;
  const collateralUsd = Number(data.totalCollateralUsd) || 0;
  return {
    ok: true,
    chainId,
    healthFactor: Number.isFinite(data.healthFactor) ? round(data.healthFactor, 4) : null,
    collateralUsd: round(collateralUsd, 2),
    debtUsd: round(debtUsd, 2),
    availableBorrowsUsd: round(Number(data.availableBorrowsUsd) || 0, 2),
    ltvPct: data.ltvPct != null ? round(Number(data.ltvPct) * 100, 2) : null,
    liquidationThresholdPct: data.liquidationThresholdPct != null ? round(Number(data.liquidationThresholdPct) * 100, 2) : null,
    positions: debtUsd > 0 || collateralUsd > 0 ? [{ network: `chain:${chainId}`, collateralUsd: round(collateralUsd, 2), debtUsd: round(debtUsd, 2), healthFactor: Number.isFinite(data.healthFactor) ? round(data.healthFactor, 4) : null, ltv: data.ltvPct != null ? Number(data.ltvPct) : null, liquidationThreshold: data.liquidationThresholdPct != null ? Number(data.liquidationThresholdPct) : null, borrowAprPct: reserve.ok ? round(Number(reserve.value.borrowApy) || 0, 3) : null }] : [],
    reserve: reserve.ok ? { symbol: reserve.value.symbol, supplyApyPct: round(Number(reserve.value.supplyApy) || 0, 3), borrowApyPct: round(Number(reserve.value.borrowApy) || 0, 3), status: reserve.value.status, ltv: reserve.value.ltv, liquidationThreshold: reserve.value.liquidationThreshold } : null,
    oracle: oracle.ok ? { status: oracle.value.status, prices: oracle.value.prices, fresh: !oracle.stale } : { status: 'UNAVAILABLE', reason: oracle.code },
    verifiedOnChain: true,
    stale: account.stale === true,
    source: 'lending-protocol (Aave V3 via multi-RPC failover)',
    at: Date.now()
  };
}

async function lendingReserve({ chainId = 1, asset = 'USDC' } = {}) {
  const token = findToken(chainId, asset) || (chainTokens(chainId) || []).find((t) => t.symbol === String(asset).toUpperCase());
  if (!token) return { ok: false, code: 'ASSET_NOT_ALLOWLISTED', detail: `${asset} is not in the audited reserve registry for chain ${chainId}` };
  const res = await guarded('lending-protocol', () => readReserve(chainId, token), {});
  if (!res.ok) return { ok: false, code: res.error?.code || 'RESERVE_READ_FAILED' };
  const r = res.value;
  return {
    ok: true, chainId, asset: r.symbol, listed: r.listed, status: r.status,
    supplyAprPct: round(Number(r.supplyApy) || 0, 3), borrowAprPct: round(Number(r.borrowApy) || 0, 3),
    ltv: r.ltv, liquidationThreshold: r.liquidationThreshold,
    source: 'lending-protocol', at: Date.now()
  };
}

/* ── derivatives ───────────────────────────────────────────────────────── */
async function perpMarkets() {
  const res = await guarded('futures-engine', () => fetchPerpMarkets(), { staleKey: 'ci:perp:assets' });
  if (!res.ok) return { ok: false, code: res.code };
  const assets = res.value?.assets || {};
  const fundingAprPct = {};
  const openInterestUsd = {};
  for (const [symbol, group] of Object.entries(assets)) {
    const rows = Array.isArray(group?.markets) ? group.markets : (Array.isArray(group) ? group : []);
    const rates = rows.map((m) => Number(m.fundingAprPct ?? m.funding_rate_24h_pct)).filter(Number.isFinite);
    const oi = rows.map((m) => Number(m.openInterestUsd ?? m.oi_value_usd)).filter(Number.isFinite);
    if (rates.length) fundingAprPct[String(symbol).toUpperCase()] = round(rates.reduce((a, b) => a + b, 0) / rates.length, 3);
    if (oi.length) openInterestUsd[String(symbol).toUpperCase()] = round(oi.reduce((a, b) => a + b, 0), 0);
  }
  return {
    ok: true, assets: Object.keys(assets).length, fundingAprPct, openInterestUsd,
    stale: res.stale === true, venues: res.value?.venues || null,
    positions: null, positionsReason: 'venue accounts are custodial to the user; positions arrive from the client wallet session, not from market data',
    source: 'futures-engine', at: Date.now()
  };
}

async function dydxAccount({ address, subaccountNumber = 0 } = {}) {
  if (!address) return { ok: false, code: 'NO_ADDRESS' };
  const [account, markets] = await Promise.all([
    guarded('dydx', () => fetchDydxAccount(address, subaccountNumber), {}),
    guarded('dydx', () => fetchDydxMarkets(), { staleKey: 'ci:dydx:markets' })
  ]);
  if (!account.ok && !markets.ok) return { ok: false, code: account.code || 'DYDX_UNAVAILABLE' };
  const positions = account.ok ? extractDydxPositions(account.value) : [];
  return {
    ok: true,
    positions,
    equityUsd: account.ok ? numOr(account.value?.equity) : null,
    marginUsedUsd: account.ok ? numOr(account.value?.marginEnabled) : null,
    markets: markets.ok ? (Array.isArray(markets.value?.markets) ? markets.value.markets.slice(0, 12) : []) : [],
    partial: !account.ok || !markets.ok,
    unavailable: [!account.ok && `account:${account.code}`, !markets.ok && `markets:${markets.code}`].filter(Boolean),
    source: 'dydx', at: Date.now()
  };
}

function extractDydxPositions(raw) {
  const rows = Array.isArray(raw?.positions) ? raw.positions : (Array.isArray(raw) ? raw : []);
  return rows.slice(0, 10).map((p) => ({
    market: p.market || p.ticker || null,
    side: String(p.side || '').toLowerCase() || null,
    size: numOr(p.size),
    notionalUsd: numOr(p.notional) ?? numOr(p.value),
    entryPrice: numOr(p.entryPrice),
    unrealizedPnlUsd: numOr(p.unrealizedPnl),
    leverage: numOr(p.leverage),
    liquidationPrice: numOr(p.liquidationPrice),
    marginUsd: numOr(p.collateral) ?? numOr(p.marginUsd)
  })).filter((p) => p.market);
}

/* ── yields / news / goals ─────────────────────────────────────────────── */
async function yields() {
  const res = await guarded('yields-engine', () => fetchYields(), { staleKey: 'ci:yields' });
  if (!res.ok) return { ok: false, code: res.code };
  const pools = Array.isArray(res.value?.pools) ? res.value.pools : [];
  return {
    ok: pools.length > 0,
    pools: pools.slice(0, 40).map((p) => ({
      id: p.id || null, project: p.project || null, chain: p.chain || null, symbol: p.symbol || null,
      apy: numOr(p.apy) !== null ? round(numOr(p.apy), 2) : null, tvlUsd: numOr(p.tvlUsd),
      risk: p.risk || p.riskLevel || 'unknown', ilRisk: p.ilRisk === true, poolMeta: p.poolMeta || null
    })),
    considered: pools.length,
    stale: res.stale === true,
    source: 'yields-engine', at: Date.now()
  };
}

async function news() {
  const res = await guarded('news-engine', () => fetchNews(), { staleKey: 'ci:news' });
  if (!res.ok) return { ok: false, code: res.code };
  const items = Array.isArray(res.value?.items) ? res.value.items : [];
  return {
    ok: items.length > 0,
    items: items.slice(0, 24).map((n) => ({
      id: hash(n.url || n.title), title: String(n.title || '').slice(0, 220), url: n.url || null,
      source: n.source || n.sourceId || null, lang: n.lang || 'en', at: Number(n.at) || Date.now(),
      symbols: symbolsIn(n.title)
    })),
    total: items.length,
    stale: res.stale === true,
    source: 'news-engine', at: Date.now()
  };
}

async function goalList({ owner }) {
  if (!owner) return { ok: false, code: 'NO_OWNER' };
  const res = await guarded('goals-engine', () => listGoals(owner), {});
  if (!res.ok) return { ok: false, code: res.code };
  const goals = Array.isArray(res.value?.goals) ? res.value.goals : (Array.isArray(res.value) ? res.value : []);
  return { ok: true, goals: goals.slice(0, 10), count: goals.length, source: 'goals-engine', at: Date.now() };
}

async function goalMarketSnapshot() {
  const res = await guarded('goals-engine', () => marketSnapshot({}), { staleKey: 'ci:goal:market' });
  if (!res.ok) return { ok: false, code: res.code };
  return { ok: true, ...res.value, source: 'goals-engine + market-data', at: Date.now() };
}

/* ── quotes: swap + bridge, with the expiry the policy engine checks ───── */
async function swapQuote({ chainId = 1, from = 'ETH', to = 'USDC', amountUsd = null, fromAmount = null, wallet = null, slippagePct = 0.5 } = {}) {
  const slug = kyberSlug(chainId);
  const o = ooSlug(chainId);
  if (!slug && !o) return { ok: false, code: 'CHAIN_UNSUPPORTED', detail: `no DEX aggregator serves chain ${chainId}` };
  const fromToken = findToken(chainId, from);
  const toToken = findToken(chainId, to);
  if (!fromToken || !toToken) return { ok: false, code: 'TOKEN_NOT_ALLOWLISTED', detail: `${!fromToken ? from : to} is not in the audited token registry for chain ${chainId}` };
  const priceRes = await guarded('market-data', () => fetchSimplePrices([fromToken.coingeckoId, toToken.coingeckoId], 'usd'), { staleKey: 'ci:prices:snapshot' });
  const unit = Number(priceRes.value?.[fromToken.coingeckoId]?.usd);
  const amount = fromAmount !== null ? Number(fromAmount) : (Number.isFinite(unit) && unit > 0 && amountUsd !== null ? Number(amountUsd) / unit : null);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, code: 'AMOUNT_UNDETERMINED', detail: 'neither a token amount nor a USD amount with a live price was available' };
  const candidates = [];
  if (slug) candidates.push('kyber');
  if (o) candidates.push('openocean');
  const tried = [];
  for (const provider of candidates) {
    tried.push(provider);
    const call = provider === 'kyber'
      ? proxyKyberRoutes({ chainId, from: fromToken.address || '0x0000000000000000000000000000000000000000', to: toToken.address, amount: toWei(amount, fromToken.decimals), slippage: slippagePct / 100, fromAddress: wallet || undefined })
      : proxyOoQuote({ chainId, fromTokenAddress: fromToken.address || '0x0000000000000000000000000000000000000000', toTokenAddress: toToken.address, amount: String(toWei(amount, fromToken.decimals)), disableEstimate: true });
    const res = await guarded('dex-aggregator', async () => {
      const out = await call;
      if (out.status >= 400) {
        const err = new Error(out.body?.error || `UPSTREAM_HTTP_${out.status}`);
        err.status = out.status;
        throw err;
      }
      return out.body;
    }, { providers: candidates });
    const parsed = provider === 'kyber' ? parseKyberQuote(res.value, fromToken, toToken) : parseOoQuote(res.value, fromToken, toToken);
    if (res.ok && parsed) {
      return {
        ok: true, provider, chainId,
        fromAsset: fromToken.symbol, toAsset: toToken.symbol,
        amountIn: round(amount, 8), amountUsd: round(amount * (Number.isFinite(unit) ? unit : 0), 2),
        expectedOut: parsed.expectedOut, minOut: parsed.minOut,
        price: parsed.price, priceImpactPct: parsed.priceImpactPct, feeUsd: parsed.feeUsd,
        route: parsed.route, gasUsd: parsed.gasUsd,
        /* The expiry is what makes the policy quote-validity gate real. */
        expiresAt: Date.now() + 45_000, quoteTtlMs: 45_000, at: Date.now(),
        slippagePct,
        partial: parsed.partial === true,
        unsignedOnly: true,
        note: 'the server returns a route and calldata only; it holds no key and signs nothing',
        source: `dex-aggregator:${provider}`,
        tried
      };
    }
  }
  return { ok: false, code: 'NO_QUOTE_FROM_ANY_PROVIDER', detail: `tried ${tried.join(', ')}`, tried };
}

function parseKyberQuote(body, fromToken, toToken) {
  const route = Array.isArray(body?.routes) ? body.routes[0] : body?.data;
  const out = Number(route?.routeSummary?.amountOut ?? route?.amountOut);
  if (!Number.isFinite(out) || out <= 0) return null;
  return {
    expectedOut: round(Number(formatUnits(BigInt(Math.round(out)), toToken.decimals)), 8),
    minOut: null,
    price: round(out / 10 ** toToken.decimals / Math.max(1e-9, Number(formatUnits(BigInt(1), fromToken.decimals))), 8),
    priceImpactPct: numOr(route?.routeSummary?.priceImpactPct) !== null ? round(numOr(route.routeSummary.priceImpactPct) * 100, 4) : (numOr(route?.routeSummary?.percentageGasFeeUsd) !== null ? null : null),
    feeUsd: numOr(route?.routeSummary?.gasPriceUSD) !== null ? round(Number(route.routeSummary.gasPriceUSD) * numOr(route?.routeSummary?.gasCostUSD) , 3) : null,
    gasUsd: numOr(route?.routeSummary?.gasCostUSD),
    route: (Array.isArray(route?.routes) ? route.routes : []).slice(0, 4).map((s) => ({ exchange: s?.name || s?.exchange || null, portion: numOr(s?.portion) })),
    partial: !(numOr(route?.routeSummary?.gasCostUSD) >= 0)
  };
}

function parseOoQuote(body, fromToken, toToken) {
  const out = Number(body?.toAmount ?? body?.data?.toAmount);
  if (!Number.isFinite(out) || out <= 0) return null;
  const extra = body?.extra || body?.data?.extra || {};
  return {
    expectedOut: round(Number(formatUnits(BigInt(Math.round(out)), toToken.decimals)), 8),
    minOut: body?.toAmountMin ? round(Number(formatUnits(BigInt(Math.round(Number(body.toAmountMin))), toToken.decimals)), 8) : null,
    price: null,
    priceImpactPct: numOr(extra.priceImpact) !== null ? round(Math.abs(Number(extra.priceImpact)) * (Math.abs(Number(extra.priceImpact)) < 1 ? 100 : 1), 4) : null,
    feeUsd: null,
    gasUsd: numOr(extra.gasUSD ?? extra.gas),
    route: Array.isArray(body?.route) ? body.route.slice(0, 4).map((s) => ({ exchange: s?.exchanges?.map?.((e) => e.name)?.join('+') || s?.name || null })) : [],
    partial: true
  };
}

async function bridgeQuoteSource({ fromChain, toChain, asset, amountUsd = null, fromAddress = null, toAddress = null } = {}) {
  if (!fromChain || !toChain) return { ok: false, code: 'NETWORKS_REQUIRED' };
  const fromToken = findToken(fromChain, asset);
  const toToken = findToken(toChain, asset);
  if (!fromToken || !toToken) return { ok: false, code: 'ASSET_NOT_ON_BOTH_CHAINS', detail: `${asset} is not allowlisted on ${fromChain} → ${toChain}` };
  const priceRes = await guarded('market-data', () => fetchSimplePrices([fromToken.coingeckoId], 'usd'), { staleKey: 'ci:prices:snapshot' });
  const unit = Number(priceRes.value?.[fromToken.coingeckoId]?.usd);
  if (!Number.isFinite(unit) || unit <= 0) return { ok: false, code: 'PRICE_UNAVAILABLE' };
  const amount = round(Number(amountUsd) / unit, 8);
  const res = await guarded('bridge', () => bridgeQuote({
    fromChain, toChain, fromTokenAddress: fromToken.address || undefined, toTokenAddress: toToken.address || undefined,
    fromAddress: fromAddress || undefined, toAddress: toAddress || fromAddress || undefined,
    fromAmount: String(toWei(amount, fromToken.decimals)), order: 'FAST', slippage: 1
  }), { providers: ['lifi'] });
  if (!res.ok) return { ok: false, code: res.code || 'BRIDGE_QUOTE_FAILED' };
  const q = res.value?.quote || res.value;
  const toAmount = Number(q?.toAmount ?? q?.toAmountMin);
  const fee = (q?.gasCosts || []).reduce((a, g) => a + (Number(g?.amountUsd) || 0), 0) + (q?.fee?.amount ? Number(q.fee.amount) : 0);
  return {
    ok: Number.isFinite(toAmount) && toAmount > 0,
    code: Number.isFinite(toAmount) && toAmount > 0 ? null : 'QUOTE_SHAPE_UNUSABLE',
    provider: res.value?.tool || 'lifi', fromChain, toChain, asset: fromToken.symbol,
    amountIn: amount, amountUsd: round(Number(amountUsd), 2),
    expectedOut: Number.isFinite(toAmount) ? round(Number(formatUnits(BigInt(Math.round(toAmount)), toToken.decimals)), 8) : null,
    minOut: q?.toAmountMin ? round(Number(formatUnits(BigInt(Math.round(Number(q.toAmountMin))), toToken.decimals)), 8) : null,
    feeUsd: fee > 0 ? round(fee, 3) : null,
    estimatedSeconds: numOr(q?.estimate?.executionDuration) !== null ? Math.round(numOr(q.estimate.executionDuration)) : null,
    destinationLiquidityUsd: null,
    expiresAt: Date.now() + 60_000, quoteTtlMs: 60_000,
    stale: res.stale === true,
    unsignedOnly: true,
    source: 'bridge:lifi', at: Date.now(),
    note: 'a quote and unsigned calldata only — the bridge call is signed by the user wallet'
  };
}

async function tokenRiskReal({ chainId = 1, address } = {}) {
  if (!address || !isAddress(address)) return { ok: false, code: 'BAD_ADDRESS' };
  /* The GoPlus-backed risk read lives in server/tokenRisk.js and is used by the
     swap surface; wiring the SAME result into the brain keeps "risk says the
     token is a honeypot" and "the swap page warns" from diverging. */
  const { fetchTokenRisk } = await import('../tokenRisk.js');
  const res = await guarded('token-risk-service', () => fetchTokenRisk(chainId, address), {});
  if (!res.ok) return { ok: false, code: res.code };
  return { ok: true, ...res.value, source: 'token-risk-service', at: Date.now() };
}

/* ── global markets: stocks (Avantis) and RWA/commodities/forex (Ostium) ── */
/**
 * Both of these are READ-ONLY here on purpose. Avantis equity exposure is
 * crypto-collateralised and Ostium is a perp AMM, so the honest statement is
 * "this venue offers this instrument", not "you can buy a stock". §8: the brain
 * may not claim a capability the venue does not give us.
 */
async function equitiesMarkets() {
  const res = await guarded('equities-feed', () => fetchAvantisEquities(), { staleKey: 'ci:equities' });
  if (!res.ok) return { ok: false, code: res.code };
  const rows = Array.isArray(res.value?.rows) ? res.value.rows : [];
  return {
    ok: rows.length > 0,
    venue: 'avantis',
    instruments: rows.slice(0, 25).map((r) => ({
      symbol: String(r?.symbol || r?.name || '').toUpperCase() || null,
      name: r?.name || null,
      priceUsd: numOr(r?.price),
      change24hPct: numOr(r?.change24h) ?? numOr(r?.priceChangePercentage24h),
      marketOpen: r?.marketOpen ?? r?.isOpen ?? null,
      leverageCap: numOr(r?.maxLeverage) ?? numOr(r?.leverageCap),
      settlement: r?.collateralAsset || 'crypto-collateralised synthetic'
    })).filter((r) => r.symbol),
    pricePartial: rows.some((r) => numOr(r?.price) === null),
    stale: res.stale === true,
    readOnly: true,
    source: 'equities-feed:avantis', at: Date.now()
  };
}

async function rwaMarkets() {
  const res = await guarded('rwa-feed', () => fetchOstiumPrices(), { staleKey: 'ci:ostium' });
  if (!res.ok) return { ok: false, code: res.code };
  const rows = Array.isArray(res.value?.prices) ? res.value.prices : (Array.isArray(res.value) ? res.value : []);
  const bucket = (symbol) => {
    const s = String(symbol || '').toUpperCase();
    if (/^(XAU|XAG|COPPER|OIL|WTI|BRENT|NATGAS|PLATINUM)/.test(s)) return 'commodities';
    if (/[A-Z]{3}[A-Z]{3}$/.test(s) && !s.startsWith('STOCK')) return 'forex';
    return 'other';
  };
  return {
    ok: rows.length > 0,
    venue: 'ostium',
    rows: rows.slice(0, 30).map((r) => ({ symbol: String(r?.symbol || r?.asset || '').toUpperCase() || null, priceUsd: numOr(r?.price ?? r?.markPrice), category: bucket(r?.symbol || r?.asset) })).filter((r) => r.symbol),
    stale: res.stale === true,
    readOnly: true,
    source: 'rwa-feed:ostium', at: Date.now()
  };
}

/**
 * The receipt read that makes `verify()` an on-chain fact rather than a hope.
 * `eth_getTransactionReceipt` returns null while a tx is still in the mempool,
 * so `PENDING` is a distinct answer from `NOT_FOUND` — the difference between
 * "keep watching" and "that hash is not on this chain", which a user absolutely
 * needs to hear differently.
 */
/**
 * Destination-token safety for a route the brain is about to propose.
 *
 * This is the wiring that makes «امنیت توکن مقصد» a fact instead of a promise: the
 * allowlist is resolved with the SAME registry the quote used (so an unknown token
 * never reaches an oracle, and no caller can aim this at an arbitrary address),
 * and the verdict is returned as flags the policy engine can hard-stop on.
 * A honeypot is not a warning to be confirmed away — `securityBlock: true` means
 * the plan is dead, and no retry loop may revive it.
 */
async function swapTokenSafety({ chainId = 1, symbol = null, address = null } = {}) {
  const { findToken } = await import('../lending.js');
  const listed = address ? null : findToken(chainId, symbol);
  const target = address || listed?.address || null;
  if (!target || !isAddress(target)) {
    return { ok: false, code: 'TOKEN_NOT_ALLOWLISTED', detail: `${symbol || target || 'unknown'} is not in the audited registry for chain ${chainId}`, chainId };
  }
  const res = await tokenRiskReal({ chainId, address: target });
  if (!res.ok) return { ok: false, code: res.code || 'TOKEN_RISK_UNREADABLE', address: target, symbol: listed?.symbol || symbol || null, chainId };
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const flags = [];
  if (res.isHoneypot === true || res.honeypot === true) flags.push('HONEYPOT_DETECTED');
  if ((num(res.sellTax) ?? 0) > 10 || (num(res.transferTax) ?? 0) > 10) flags.push('HIGH_TRANSFER_TAX');
  if ((num(res.buyTax) ?? 0) > 10) flags.push('HIGH_BUY_TAX');
  if (res.isWhitelisted === true || res.blacklist === true) flags.push('BLACKLIST_FUNCTION');
  if (res.isOpenSource === false) flags.push('CLOSED_SOURCE');
  if (res.ownerChangeBalance === true || res.canTakeBackOwnership === true || res.hiddenOwner === true) flags.push('OWNERSHIP_RISK');
  if (res.isMintable === true) flags.push('MINTABLE');
  if ((num(res.holders) ?? Infinity) < 50) flags.push('THIN_HOLDER_COUNT');
  const blocking = flags.includes('HONEYPOT_DETECTED') || flags.includes('BLACKLIST_FUNCTION') || flags.includes('OWNERSHIP_RISK');
  return {
    ok: true, chainId, address: target, symbol: listed?.symbol || symbol || null,
    riskLevel: blocking ? 'CRITICAL' : flags.length ? 'ELEVATED' : 'LOW',
    flags, securityBlock: blocking,
    holders: num(res.holders), sellTax: num(res.sellTax), buyTax: num(res.buyTax),
    note: 'read from the same risk service the swap page warns with; a blocking flag stops the plan rather than softening it',
    source: 'token-risk-service', at: Date.now()
  };
}

async function transactionReceipt({ chainId = 1, hash } = {}) {
  if (!hash || !/^0x[0-9a-fA-F]{64}$/.test(String(hash))) return { ok: false, code: 'BAD_TX_HASH' };
  const id = Number(chainId);
  if (!EVM_CHAINS[id]) return { ok: false, code: 'UNSUPPORTED_CHAIN' };
  const res = await guarded('blockchain', () => rpcWithFailover(id, 'eth_getTransactionReceipt', [String(hash)]), {});
  if (!res.ok) return { ok: false, code: res.code || 'RPC_ERROR' };
  const r = res.value;
  if (!r) {
    const blockRes = await guarded('blockchain', () => rpcWithFailover(id, 'eth_getTransactionByHash', [String(hash)]), {});
    const inMempool = Boolean(blockRes.ok && blockRes.value);
    return { ok: true, status: inMempool ? 'PENDING' : 'NOT_FOUND', chainId: id, hash, confirmations: 0, at: Date.now(), source: 'blockchain' };
  }
  const status = Number(r.status ?? r.transactionStatus ?? 0);
  const blockNumberHex = r.blockNumber ? Number(BigInt(r.blockNumber)) : null;
  const latest = await guarded('blockchain', () => rpcWithFailover(id, 'eth_blockNumber', []), {});
  const latestBlock = latest.ok && latest.value ? Number(BigInt(latest.value)) : null;
  return {
    ok: true,
    status: status === 1 ? 'CONFIRMED' : status === 0 ? 'FAILED' : 'UNKNOWN',
    chainId: id, hash,
    blockNumber: blockNumberHex,
    confirmations: blockNumberHex !== null && latestBlock !== null ? Math.max(0, latestBlock - blockNumberHex + 1) : null,
    gasUsed: r.gasUsed ? Number(BigInt(r.gasUsed)) : null,
    effectiveGasPriceGwei: r.effectiveGasPrice ? Number(formatUnits(BigInt(r.effectiveGasPrice), 9)) : null,
    from: r.from || null, to: r.to || null,
    logs: Array.isArray(r.logs) ? r.logs.length : 0,
    at: Date.now(), source: 'blockchain'
  };
}

/* ── id utilities ─────────────────────────────────────────────────────── */
export const ASSET_IDS = Object.freeze({
  BTC: 'bitcoin', ETH: 'ethereum', USDT: 'tether', BNB: 'binancecoin', SOL: 'solana',
  USDC: 'usd-coin', XRP: 'ripple', STETH: 'staked-ether', DAI: 'dai', LINK: 'chainlink',
  AVAX: 'avalanche-2', WBTC: 'wrapped-bitcoin', ARB: 'arbitrum', OP: 'optimism',
  POL: 'matic-network', BONK: 'bonk', JUP: 'jupiter-exchange-solana', WIF: 'dogwifcoin',
  RAY: 'raydium', PYTH: 'pyth-network', JTO: 'jito-governance-token', CBBTC: 'coinbase-wrapped-btc',
  ARBUSD: 'usd-coin', FRAX: 'frax'
});
export const CHAIN_ALIASES = Object.freeze({
  ethereum: 1, mainnet: 1, eth: 1, bsc: 56, binance: 56, bnb: 56, polygon: 137, matic: 137,
  arbitrum: 42161, arb: 42161, base: 8453, optimism: 10, op: 10, avalanche: 43114, avax: 43114
});
export const chainIdFor = (v) => {
  if (Number.isFinite(Number(v)) && EVM_CHAINS[Number(v)]) return Number(v);
  return CHAIN_ALIASES[String(v || '').toLowerCase()] ?? null;
};
const symbolId = (symbol) => ASSET_IDS[String(symbol).toUpperCase()] || null;
const toWei = (amount, decimals) => {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return 0n;
  return BigInt(Math.round(n * 10 ** Number(decimals)));
};
const numOr = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const round = (v, d = 2) => { const f = 10 ** d; const n = Number(v); return Number.isFinite(n) ? Math.round(n * f) / f : null; };
const hash = (s) => createHash('sha1').update(String(s)).digest('hex').slice(0, 12);
const symbolsIn = (title) => {
  const text = String(title || '');
  return ['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'DOGE'].filter((s) => new RegExp(`\\b${s}\\b`, 'i').test(text));
};
