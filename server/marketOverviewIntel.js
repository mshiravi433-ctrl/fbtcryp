/**
 * Market Overview Phase-2 Intelligence aggregator (`GET /api/market/overview-intel`).
 *
 * Combines two live, read-only, keyless intelligence domains in one compact
 * (< 12 KB) payload for the Market Overview (`مرور`) tab:
 *   1. DeFi & Network Intelligence (DefiLlama `/v2/chains`, `/v2/historicalChainTvl`,
 *      `/protocols`, `/overview/dexs`, `/overview/fees`, plus `rankStablecoinFlows`).
 *   2. FBT Swap Supported Networks live RPC telemetry across all 19 FBT Swap
 *      networks (16 EVM chains + Solana + Bitcoin + Tron).
 *
 * Uses `Promise.allSettled` + per-feed SWR caches so one slow upstream never
 * blocks the rest, and throws only when EVERY upstream fails (allowing `serve()`
 * to return 502 so the client's `resilient()` layer can try direct CORS or show
 * an honest offline state).
 */

import { withCache } from './cache.js';
import { rankStablecoinFlows } from './capitalFlows.js';
import { probeAllFbtSwapNetworks } from '../src/lib/fbtSwapNetworks.js';
import {
  normalizeChainsPayload,
  normalizeHistoricalTvlPayload,
  normalizeProtocolsPayload,
  normalizeDexOverviewPayload,
  normalizeFeesOverviewPayload,
  normalizeStablecoinsPayload,
  assembleDefiIntel
} from '../src/lib/defiIntelNormalizer.js';

const LLAMA_API = 'https://api.llama.fi';
const UA = 'FBTCryp-MarketIntel/2.0';

async function fetchJsonWithTimeout(url, timeoutMs = 5500, fetchImpl = globalThis.fetch) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      headers: { accept: 'application/json', 'user-agent': UA },
      signal: ctrl.signal
    });
    if (!res.ok) throw new Error(`HTTP_${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function cachedSubfeed(key, ttlMs, fn) {
  const { value } = await withCache(key, ttlMs, fn, { swr: true });
  return value;
}

export async function fetchMarketOverviewIntel({ fetchImpl = globalThis.fetch } = {}) {
  const [
    chainsRes,
    histRes,
    protocolsRes,
    dexsRes,
    feesRes,
    stablesRes,
    probesRes,
    btcFeeRes
  ] = await Promise.allSettled([
    cachedSubfeed('moi:llama:chains', 5 * 60_000, () =>
      fetchJsonWithTimeout(`${LLAMA_API}/v2/chains`, 5500, fetchImpl)
    ),
    cachedSubfeed('moi:llama:hist-tvl', 15 * 60_000, () =>
      fetchJsonWithTimeout(`${LLAMA_API}/v2/historicalChainTvl`, 5500, fetchImpl)
    ),
    cachedSubfeed('moi:llama:protocols', 15 * 60_000, async () => {
      const raw = await fetchJsonWithTimeout(`${LLAMA_API}/protocols`, 7000, fetchImpl);
      return normalizeProtocolsPayload(raw);
    }),
    cachedSubfeed('moi:llama:dexs', 10 * 60_000, () =>
      fetchJsonWithTimeout(
        `${LLAMA_API}/overview/dexs?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true`,
        5500,
        fetchImpl
      )
    ),
    cachedSubfeed('moi:llama:fees', 10 * 60_000, () =>
      fetchJsonWithTimeout(
        `${LLAMA_API}/overview/fees?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true`,
        5500,
        fetchImpl
      )
    ),
    cachedSubfeed('moi:llama:stables', 10 * 60_000, () => rankStablecoinFlows()),
    cachedSubfeed('moi:fbt:rpc-probes', 45_000, () =>
      probeAllFbtSwapNetworks({ fetchImpl, timeoutMs: 2800 })
    ),
    cachedSubfeed('moi:btc:fee-hint', 60_000, () =>
      fetchJsonWithTimeout('https://mempool.space/api/v1/fees/recommended', 2800, fetchImpl)
    )
  ]);

  const rawChainsFull = chainsRes.status === 'fulfilled' && Array.isArray(chainsRes.value)
    ? chainsRes.value
    : [];
  const chains = normalizeChainsPayload(rawChainsFull);
  const historical = histRes.status === 'fulfilled'
    ? normalizeHistoricalTvlPayload(histRes.value)
    : normalizeHistoricalTvlPayload([]);
  const protocols = protocolsRes.status === 'fulfilled' && protocolsRes.value
    ? protocolsRes.value
    : { categories: [], topProtocols: [] };
  const dexs = dexsRes.status === 'fulfilled'
    ? normalizeDexOverviewPayload(dexsRes.value)
    : normalizeDexOverviewPayload(null);
  const fees = feesRes.status === 'fulfilled'
    ? normalizeFeesOverviewPayload(feesRes.value)
    : normalizeFeesOverviewPayload(null);
  const stablecoins = stablesRes.status === 'fulfilled' && stablesRes.value?.available
    ? normalizeStablecoinsPayload(stablesRes.value)
    : normalizeStablecoinsPayload(null);

  const networkProbes = probesRes.status === 'fulfilled' && probesRes.value
    ? { ...probesRes.value }
    : {};

  if (
    btcFeeRes.status === 'fulfilled' &&
    Number.isFinite(Number(btcFeeRes.value?.halfHourFee)) &&
    networkProbes.bitcoin
  ) {
    networkProbes.bitcoin = {
      ...networkProbes.bitcoin,
      feeHint: `${Math.round(Number(btcFeeRes.value.halfHourFee))} sat/vB`
    };
  }

  const anyDefiOk =
    chains.topChains.length > 0 ||
    historical.latestTvlUsd != null ||
    protocols.topProtocols.length > 0 ||
    dexs.dexVolume24hUsd != null ||
    stablecoins.stablecoinTotalUsd != null;

  const anyRpcOk = Object.values(networkProbes).some((p) => p && p.ok);

  if (!anyDefiOk && !anyRpcOk) {
    throw new Error('MARKET_OVERVIEW_INTEL_UNAVAILABLE');
  }

  // Compact chain TVL list (< 1.5 KB) so client can join all 19 FBT Swap chains
  const rawChains = rawChainsFull
    .filter((c) => c?.name && Number(c?.tvl) > 0)
    .slice(0, 60)
    .map((c) => ({ name: c.name, tvl: Math.round(Number(c.tvl)) }));

  return {
    ok: true,
    offline: false,
    partial: !(anyDefiOk && anyRpcOk),
    source: 'server',
    updatedAt: new Date().toISOString(),
    defi: assembleDefiIntel({
      chains,
      historical,
      protocols,
      dexs,
      fees,
      stablecoins
    }),
    rawChains,
    networkProbes
  };
}
