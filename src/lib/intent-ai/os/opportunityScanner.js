/**
 * OpportunityScanner — evidence-backed yield, LP-farm and lending reads.
 * Catalog entries are never promoted to live rates; missing values stay null.
 */

import { tokenKey } from './tokenResolver.js';
import { normalizeChainId } from '../contextResolver.js';

export const OPPORTUNITY_SCANNER_SCHEMA = 'fbt.opportunity-scanner.v2';

const num = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const timestamp = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const timestampSeconds = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric < 1e12 ? numeric * 1000 : numeric;
  return timestamp(value);
};

function normalizeStatus(value, fallback = 'unavailable') {
  const status = String(value || '').trim().toLowerCase();
  return status || fallback;
}

function isReadableStatus(status) {
  return ['live', 'partial', 'empty'].includes(normalizeStatus(status));
}

function riskFor(pool, apy, tvlUsd) {
  const reported = String(pool?.risk || '').trim().toLowerCase();
  if (['low', 'medium', 'high'].includes(reported)) {
    return { risk: reported, riskBasis: 'source-reported' };
  }
  if (apy != null && apy > 40) return { risk: 'high', riskBasis: 'apy-threshold-heuristic' };
  if (tvlUsd != null && tvlUsd < 1_000_000) return { risk: 'high', riskBasis: 'tvl-threshold-heuristic' };
  if (apy != null && apy > 15) return { risk: 'medium', riskBasis: 'apy-threshold-heuristic' };
  return { risk: null, riskBasis: null };
}

function isLpPool(pool = {}) {
  return pool.exposure === 'multi' || /[-/]/.test(String(pool.symbol || ''));
}

function poolIdentity(pool = {}) {
  const id = pool.id || pool.pool || pool.poolId || pool.address || pool.url;
  if (id) return String(id).trim().toLowerCase();
  return [pool.chainId || pool.chain || pool.network || '', pool.project || pool.protocol || '', pool.symbol || pool.asset || '']
    .map((part) => String(part).trim().toLowerCase())
    .join(':');
}

function mapPool(pool, kind = 'yield', source = {}) {
  const apy = num(pool.apy ?? pool.apyPct ?? pool.supplyApyPct);
  const supplyApyPct = num(pool.supplyApyPct ?? (kind === 'lending' ? apy : null));
  const borrowApyPct = num(pool.borrowApyPct);
  const tvlUsd = num(pool.tvlUsd ?? pool.tvl);
  const risk = riskFor(pool, apy, tvlUsd);
  const dataStatus = normalizeStatus(pool.dataStatus || source.dataStatus, 'unavailable');
  const fetchedAt = timestamp(pool.fetchedAt ?? pool.updatedAt ?? source.fetchedAt ?? source.updatedAt);
  const chainId = pool.chainId ?? pool.chain ?? null;
  const rateStatus = normalizeStatus(pool.rateStatus, apy != null && ['live', 'partial'].includes(dataStatus) ? dataStatus : 'unavailable');
  const borrowRateStatus = normalizeStatus(pool.borrowRateStatus, borrowApyPct != null ? rateStatus : 'unavailable');
  const lastUpdateTimestamp = num(pool.lastUpdateTimestamp);
  return {
    id: pool.id || pool.pool || `${kind}:${pool.protocol || pool.project || 'unknown'}:${pool.symbol || ''}`,
    kind,
    protocol: pool.project || pool.protocol || pool.symbol || 'unknown',
    symbol: pool.symbol || pool.asset || null,
    address: pool.address || null,
    decimals: num(pool.decimals),
    chain: pool.chainName || pool.chain || pool.network || null,
    chainName: pool.chainName || null,
    chainId,
    venue: pool.venue || null,
    apy,
    supplyApyPct: kind === 'lending' ? supplyApyPct : null,
    borrowApyPct: kind === 'lending' ? borrowApyPct : null,
    tvlUsd,
    risk: risk.risk,
    riskBasis: pool.riskBasis || risk.riskBasis,
    ilRisk: pool.ilRisk ?? null,
    utilizationPct: num(pool.utilizationPct),
    ltvPct: num(pool.ltvPct ?? pool.ltv),
    liquidationThresholdPct: num(pool.liquidationThresholdPct),
    reserveStatus: pool.reserveStatus || pool.status || null,
    available: pool.available !== false,
    borrowAvailable: pool.borrowAvailable === true,
    priceUsd: num(pool.priceUsd),
    priceStatus: normalizeStatus(pool.priceStatus),
    priceSource: pool.priceSource || null,
    reserveAddress: pool.reserveAddress || pool.address || null,
    poolAddress: pool.poolAddress || null,
    availableLiquidityWei: pool.availableLiquidityWei ?? null,
    totalDebtWei: pool.totalDebtWei ?? null,
    supplyCapWhole: pool.supplyCapWhole ?? null,
    borrowCapWhole: pool.borrowCapWhole ?? null,
    url: pool.url || null,
    source: pool.source || source.source || null,
    dataStatus,
    rateStatus,
    borrowRateStatus,
    fetchedAt,
    lastUpdateTimestamp,
    reserveUpdatedAt: timestampSeconds(pool.reserveUpdatedAt ?? pool.lastUpdateTimestamp),
    tokenKey: tokenKey({ chainId, symbol: pool.symbol, address: pool.address || pool.pool }),
    basis: apy == null ? null : 'observed-annualized-rate',
    guaranteed: false
  };
}

async function readSource(sources, errors, name, run) {
  const startedAt = Date.now();
  try {
    const result = await run();
    const dataStatus = normalizeStatus(result?.dataStatus, result?.ok === false ? 'unavailable' : 'live');
    const record = {
      name,
      ok: result?.ok !== false,
      dataStatus,
      source: result?.source || null,
      fetchedAt: timestamp(result?.fetchedAt ?? result?.updatedAt),
      rows: Array.isArray(result?.pools || result?.markets || result?.opportunities)
        ? (result.pools || result.markets || result.opportunities).length
        : 0,
      latencyMs: Date.now() - startedAt
    };
    sources.push(record);
    return result || null;
  } catch (error) {
    const reason = String(error?.message || error || 'FAILED').slice(0, 160);
    sources.push({ name, ok: false, dataStatus: 'unavailable', source: null, fetchedAt: null, latencyMs: Date.now() - startedAt, error: reason });
    errors.push({ name, error: reason });
    return null;
  }
}

/**
 * @param {'all'|'farm'|'lending'} scope Limit reads to the requested domain.
 * @param {number|string|null} chainId Chain being reviewed, not a default guess.
 */
export async function scanOpportunities({
  services = {},
  portfolio = null,
  riskTolerance = 'medium',
  asset = null,
  chainId = null,
  scope = 'all',
  operation = 'supply',
  limit = 5
} = {}) {
  const started = Date.now();
  const sources = [];
  const errors = [];
  const found = [];
  const supportedLendingMarkets = [];
  const lendingMarkets = [];
  let lendingDataStatus = 'unavailable';
  let lendingFetchedAt = null;
  let lendingSource = null;

  const requestedScope = ['farm', 'lending'].includes(String(scope).toLowerCase())
    ? String(scope).toLowerCase()
    : 'all';
  const requestedOperation = String(operation || 'supply').toLowerCase() === 'borrow' ? 'borrow' : 'supply';
  const want = asset ? String(asset).trim().toUpperCase() : null;
  /* A chain given by name ("base") resolves to its id; an unrecognised value
     stays null and therefore filters nothing — it never silently becomes a
     different chain. */
  const wantedChain = normalizeChainId(chainId);

  if (requestedScope === 'farm') {
    const farmResult = await readSource(sources, errors, 'farm.list', async () => {
      if (services.farmService?.list) return services.farmService.list({ chainId: wantedChain });
      return { ok: false, dataStatus: 'unavailable', reason: 'NO_FARM_SERVICE', pools: [] };
    });
    const poolRows = farmResult?.pools || farmResult?.opportunities || [];
    const seen = new Set();
    for (const pool of Array.isArray(poolRows) ? poolRows : []) {
      if (!isLpPool(pool)) continue;
      const identity = poolIdentity(pool);
      if (identity && seen.has(identity)) continue;
      if (identity) seen.add(identity);
      const row = mapPool(pool, 'farm', farmResult || {});
      if (want && !String(row.symbol || '').toUpperCase().includes(want)) continue;
      if (wantedChain != null && row.chainId != null && Number(row.chainId) !== wantedChain) continue;
      found.push(row);
    }
  } else if (requestedScope === 'lending') {
    const lendingResult = await readSource(sources, errors, 'lending.markets', async () => {
      const input = { asset: want, chainId: wantedChain };
      if (services.lendingService?.getLiveMarkets) return services.lendingService.getLiveMarkets(input);
      if (services.lendingService?.getMarkets) return services.lendingService.getMarkets(input);
      return { ok: false, dataStatus: 'unavailable', reason: 'NO_LENDING_SERVICE', markets: [] };
    });
    lendingDataStatus = normalizeStatus(lendingResult?.dataStatus, 'unavailable');
    lendingFetchedAt = timestamp(lendingResult?.fetchedAt ?? lendingResult?.updatedAt);
    lendingSource = lendingResult?.source || null;
    supportedLendingMarkets.push(...(Array.isArray(lendingResult?.supportedMarkets)
      ? lendingResult.supportedMarkets
      : (Array.isArray(lendingResult?.markets) ? lendingResult.markets : [])));

    const markets = Array.isArray(lendingResult?.markets) ? lendingResult.markets : [];
    for (const market of markets) {
      const details = mapPool({
        ...market,
        protocol: market.protocol || 'Aave V3',
        chainId: market.chainId ?? market.chain,
        apy: market.supplyApyPct,
        dataStatus: market.dataStatus || lendingDataStatus,
        source: market.source || lendingSource,
        fetchedAt: market.fetchedAt ?? lendingFetchedAt
      }, 'lending', lendingResult || {});
      if (want && String(details.symbol || '').toUpperCase() !== want) continue;
      if (wantedChain != null && details.chainId != null && Number(details.chainId) !== wantedChain) continue;
      lendingMarkets.push(details);

      const selectedRate = requestedOperation === 'borrow' ? details.borrowApyPct : details.supplyApyPct;
      const selectedStatus = requestedOperation === 'borrow' ? details.borrowRateStatus : details.rateStatus;
      const selectedAvailable = requestedOperation === 'borrow' ? details.borrowAvailable : details.available;
      /* The catalog is not a live quote. Only the requested side's observed
         rate, explicitly fresh from the reserve read, enters ranking. */
      if (!['live', 'partial'].includes(normalizeStatus(selectedStatus))
        || selectedRate == null || selectedAvailable !== true) continue;
      found.push({ ...details, apy: selectedRate, rateStatus: selectedStatus, available: true, rateKind: requestedOperation });
    }
  } else {
    const yieldResult = await readSource(sources, errors, 'yield.discover', async () => {
      if (services.yieldService?.discover) return services.yieldService.discover({ asset: want, riskTolerance, chainId: wantedChain });
      return { ok: false, dataStatus: 'unavailable', reason: 'NO_YIELD_SERVICE', opportunities: [] };
    });
    const pools = yieldResult?.opportunities || yieldResult?.pools || [];
    const seen = new Set();
    for (const pool of Array.isArray(pools) ? pools : []) {
      const identity = poolIdentity(pool);
      if (identity && seen.has(identity)) continue;
      if (identity) seen.add(identity);
      const row = mapPool(pool, isLpPool(pool) ? 'farm' : 'yield', yieldResult || {});
      if (want && !String(row.symbol || '').toUpperCase().includes(want)) continue;
      if (wantedChain != null && row.chainId != null && Number(row.chainId) !== wantedChain) continue;
      found.push(row);
    }

    const lendingResult = await readSource(sources, errors, 'lending.markets', async () => {
      const input = { asset: want, chainId: wantedChain };
      if (services.lendingService?.getLiveMarkets) return services.lendingService.getLiveMarkets(input);
      if (services.lendingService?.getMarkets) return services.lendingService.getMarkets(input);
      return { ok: false, dataStatus: 'unavailable', reason: 'NO_LENDING_SERVICE', markets: [] };
    });
    lendingDataStatus = normalizeStatus(lendingResult?.dataStatus, 'unavailable');
    lendingFetchedAt = timestamp(lendingResult?.fetchedAt ?? lendingResult?.updatedAt);
    lendingSource = lendingResult?.source || null;
    supportedLendingMarkets.push(...(Array.isArray(lendingResult?.supportedMarkets)
      ? lendingResult.supportedMarkets
      : (Array.isArray(lendingResult?.markets) ? lendingResult.markets : [])));
    for (const market of Array.isArray(lendingResult?.markets) ? lendingResult.markets : []) {
      const details = mapPool({
        ...market,
        protocol: market.protocol || 'Aave V3',
        chainId: market.chainId ?? market.chain,
        apy: market.supplyApyPct,
        dataStatus: market.dataStatus || lendingDataStatus,
        source: market.source || lendingSource,
        fetchedAt: market.fetchedAt ?? lendingFetchedAt
      }, 'lending', lendingResult || {});
      if (want && String(details.symbol || '').toUpperCase() !== want) continue;
      if (wantedChain != null && details.chainId != null && Number(details.chainId) !== wantedChain) continue;
      lendingMarkets.push(details);
      const selectedRate = requestedOperation === 'borrow' ? details.borrowApyPct : details.supplyApyPct;
      const selectedStatus = requestedOperation === 'borrow' ? details.borrowRateStatus : details.rateStatus;
      const selectedAvailable = requestedOperation === 'borrow' ? details.borrowAvailable : details.available;
      if (!['live', 'partial'].includes(normalizeStatus(selectedStatus))
        || selectedRate == null || selectedAvailable !== true) continue;
      found.push({ ...details, apy: selectedRate, rateStatus: selectedStatus, available: true, rateKind: requestedOperation });
    }
  }

  let ranked = found.filter((row) => row.apy != null && row.available !== false);
  if (String(riskTolerance).toLowerCase() === 'low') ranked = ranked.filter((row) => row.risk !== 'high');
  ranked.sort((a, b) => requestedScope === 'lending' && requestedOperation === 'borrow'
    ? (a.apy || 0) - (b.apy || 0)
    : (b.apy || 0) - (a.apy || 0));
  const opportunities = ranked.slice(0, Math.max(0, Number(limit) || 0));

  const dataSources = sources.filter((source) => source.ok && isReadableStatus(source.dataStatus));
  const dataQuality = opportunities.length
    ? (opportunities.every((row) => row.dataStatus === 'live') ? 'HIGH' : 'MEDIUM')
    : dataSources.length ? 'LOW' : 'NONE';
  const dataStatus = opportunities.length
    ? (opportunities.some((row) => row.dataStatus === 'partial') ? 'partial' : 'live')
    : dataSources.length ? 'empty' : 'unavailable';
  const fetchedTimes = sources.map((source) => source.fetchedAt).filter((value) => value != null);

  return {
    schema: OPPORTUNITY_SCANNER_SCHEMA,
    ok: true,
    scope: requestedScope,
    chainId: wantedChain,
    opportunities,
    scanned: found.length,
    supportedLendingMarkets,
    lendingMarkets,
    lendingOperation: requestedOperation,
    lendingDataStatus,
    lendingFetchedAt,
    lendingSource,
    dataFreshness: opportunities.length ? (dataStatus === 'partial' ? 'PARTIAL' : 'FRESH') : (dataSources.length ? 'EMPTY' : 'NONE'),
    dataStatus,
    dataQuality,
    confidence: opportunities.length ? Math.min(0.9, 0.4 + opportunities.length * 0.1) : (dataSources.length ? 0.35 : 0),
    sources,
    errors,
    portfolioHint: portfolio?.totalValueUsd ?? null,
    guaranteed: false,
    latencyMs: Date.now() - started,
    updatedAt: fetchedTimes.length ? Math.max(...fetchedTimes) : null
  };
}
