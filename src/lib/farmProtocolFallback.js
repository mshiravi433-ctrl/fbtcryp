import { AAVE_V3_BASE, getReserveStatus as getAaveBaseStatus } from './defi/aaveV3Base.js';
import { AAVE_V3_ARBITRUM, getReserveStatus as getAaveArbitrumStatus } from './defi/aaveV3Arbitrum.js';
import { COMPOUND_V3_BASE, getMarketStatus as getCompoundBaseStatus } from './defi/compoundV3Base.js';
import { MORPHO_BLUE_BASE } from './defi/morphoBlueBase.js';

export const MORPHO_FARM_API = 'https://api.morpho.org/graphql';
export const LIDO_STETH_APR_API = 'https://eth-api.lido.fi/v1/protocol/steth/apr/sma';
export const FARM_PROTOCOL_FALLBACK_TIMEOUT_MS = 8_000;

const MORPHO_FARM_QUERY = `query FarmPinnedMarket($marketId: String!, $chainId: Int!) {
  marketById(marketId: $marketId, chainId: $chainId) {
    marketId
    chain { id }
    loanAsset { address symbol }
    collateralAsset { address symbol }
    state { supplyApy supplyAssetsUsd }
  }
}`;

const finitePercent = (value, max = 500) => {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= max ? n : null;
};

const finiteUsd = (value) => {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

function makeVenue({ id, project, chain, symbol, apy = null, apr = null, apyMean30d = null, tvlUsd = null, source, now }) {
  const safeApy = finitePercent(apy);
  const safeApr = finitePercent(apr);
  if (safeApy == null && safeApr == null) return null;
  const baseFields = safeApy == null
    ? {}
    : { apy: safeApy, apyBase: safeApy, apyReward: 0 };
  const mean = finitePercent(apyMean30d);
  return {
    id,
    project,
    chain,
    symbol,
    ...(project === 'morpho-blue' ? { pool: MORPHO_BLUE_BASE.defiLlamaPoolId } : {}),
    ...baseFields,
    ...(safeApr == null ? {} : { apr: safeApr }),
    ...(mean == null ? {} : { apyMean30d: mean }),
    tvlUsd: finiteUsd(tvlUsd),
    volumeUsd1d: null,
    stablecoin: symbol.toUpperCase() === 'USDC',
    ilRisk: false,
    exposure: 'single',
    risk: 'unknown',
    source,
    sourceType: 'protocol-direct',
    updatedAt: now,
    freshness: 'FRESH',
    historyAvailable: false
  };
}

function withTimeout(promise, signal, timeout = FARM_PROTOCOL_FALLBACK_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      callback(value);
    };
    const onAbort = () => {
      const error = new Error('ABORTED');
      error.name = 'AbortError';
      finish(reject, error);
    };
    const timer = setTimeout(() => finish(reject, new Error('PROTOCOL_READ_TIMEOUT')), timeout);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then((value) => finish(resolve, value), (error) => finish(reject, error));
  });
}

async function fetchJson(url, { signal, method = 'GET', body, timeout = FARM_PROTOCOL_FALLBACK_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeout);
  try {
    const response = await fetch(url, {
      method,
      signal: controller.signal,
      cache: 'no-store',
      headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const value = await response.json();
    if (!value || typeof value !== 'object') throw new Error('BAD_PROTOCOL_RESPONSE');
    return value;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

function readLidoApr(payload) {
  const data = payload?.data ?? payload;
  const apr = finitePercent(data?.smaApr ?? data?.apr, 100);
  return apr == null ? null : apr;
}

function readMorphoMarket(payload) {
  if (Array.isArray(payload?.errors) && payload.errors.length) return null;
  const market = payload?.data?.marketById;
  if (!market) return null;
  if (String(market.marketId ?? '').toLowerCase() !== MORPHO_BLUE_BASE.marketId.toLowerCase()) return null;
  if (Number(market.chain?.id) !== MORPHO_BLUE_BASE.chainId) return null;
  if (String(market.loanAsset?.address ?? '').toLowerCase() !== MORPHO_BLUE_BASE.loanToken.toLowerCase()) return null;
  if (String(market.collateralAsset?.address ?? '').toLowerCase() !== MORPHO_BLUE_BASE.collateralToken.toLowerCase()) return null;

  // Morpho documents these API fields as decimal APY fractions (0.05 = 5%).
  // Reject values outside that representation instead of guessing the unit.
  const apyFraction = market.state?.supplyApy == null ? null : Number(market.state.supplyApy);
  if (!Number.isFinite(apyFraction) || apyFraction < 0 || apyFraction > 1) return null;
  return {
    apy: apyFraction * 100,
    tvlUsd: finiteUsd(market.state?.supplyAssetsUsd)
  };
}

/**
 * Read live rates from the protocol endpoints/contracts used by Farm's five
 * existing execution adapters. No wallet signer is requested or used.
 * Partial successes are returned; an unverified venue is simply omitted.
 */
export async function getFarmProtocolFallback({ getReadProvider, signal, now = Date.now() } = {}) {
  if (typeof getReadProvider !== 'function' || signal?.aborted) return null;

  const providerPromises = new Map();
  const providerFor = (chainId) => {
    if (!providerPromises.has(chainId)) providerPromises.set(chainId, Promise.resolve().then(() => getReadProvider(chainId)));
    return providerPromises.get(chainId);
  };

  const reads = await Promise.allSettled([
    withTimeout(providerFor(AAVE_V3_BASE.chainId).then((provider) => getAaveBaseStatus(provider)), signal),
    withTimeout(providerFor(COMPOUND_V3_BASE.chainId).then((provider) => getCompoundBaseStatus(provider)), signal),
    withTimeout(providerFor(AAVE_V3_ARBITRUM.chainId).then((provider) => getAaveArbitrumStatus(provider)), signal),
    fetchJson(MORPHO_FARM_API, {
      signal,
      method: 'POST',
      body: { query: MORPHO_FARM_QUERY, variables: { marketId: MORPHO_BLUE_BASE.marketId, chainId: MORPHO_BLUE_BASE.chainId } }
    }),
    fetchJson(LIDO_STETH_APR_API, { signal })
  ]);
  if (signal?.aborted) return null;

  const pools = [];
  const push = (row) => { if (row) pools.push(row); };
  const [aaveBase, compoundBase, aaveArbitrum, morphoResponse, lidoResponse] = reads;

  if (aaveBase.status === 'fulfilled') {
    push(makeVenue({
      id: 'aave-base-usdc-direct', project: 'aave-v3', chain: 'Base', symbol: AAVE_V3_BASE.usdcSymbol,
      apy: aaveBase.value?.supplyApyPct, source: 'aaveBaseOnchain', now
    }));
  }
  if (compoundBase.status === 'fulfilled') {
    push(makeVenue({
      id: 'compound-base-usdc-direct', project: 'compound-v3', chain: 'Base', symbol: COMPOUND_V3_BASE.usdcSymbol,
      apy: compoundBase.value?.supplyApyPct, apr: compoundBase.value?.supplyAprPct,
      source: 'compoundBaseOnchain', now
    }));
  }
  if (aaveArbitrum.status === 'fulfilled') {
    push(makeVenue({
      id: 'aave-arbitrum-usdc-direct', project: 'aave-v3', chain: 'Arbitrum', symbol: AAVE_V3_ARBITRUM.usdcSymbol,
      apy: aaveArbitrum.value?.supplyApyPct, source: 'aaveArbitrumOnchain', now
    }));
  }
  if (morphoResponse.status === 'fulfilled') {
    const market = readMorphoMarket(morphoResponse.value);
    if (market) {
      push(makeVenue({
        id: MORPHO_BLUE_BASE.defiLlamaPoolId, project: 'morpho-blue', chain: 'Base', symbol: MORPHO_BLUE_BASE.loanSymbol,
        ...market, source: 'morphoPinnedMarket', now
      }));
    }
  }
  if (lidoResponse.status === 'fulfilled') {
    const apr = readLidoApr(lidoResponse.value);
    push(makeVenue({
      id: 'lido-steth-apr-direct', project: 'lido', chain: 'Ethereum', symbol: 'STETH',
      apr, source: 'lidoSevenDayApr', now
    }));
  }

  if (pools.length === 0) return null;
  return {
    pools: [],
    venues: pools,
    at: now,
    freshness: 'FRESH',
    source: 'protocolDirect',
    considered: pools.length,
    passed: pools.length,
    fallback: true
  };
}

export const __farmProtocolFallbackInternals = Object.freeze({
  finitePercent,
  readLidoApr,
  readMorphoMarket,
  makeVenue
});
