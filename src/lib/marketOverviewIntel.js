/**
 * Client-side resilient loader for Market Overview Phase-2 Intelligence:
 *   1. Primary: `GET ${apiBase()}/market/overview-intel` (server-cached SWR)
 *   2. Direct CORS fallback: public keyless DefiLlama + parallel read-only RPC
 *      probes across FBT Swap's 19 networks (keeps static/preview builds live)
 *   3. Honest offline fallback: `emptyOfflineOverviewIntel()` (`offline: true`,
 *      zero fabricated numbers)
 *
 * Module-level SWR cache ensures switching between `مرور` and `توکن` tabs
 * renders synchronously from memory without re-fetching.
 */

import { apiBase } from './apiBase.js';
import { probeAllFbtSwapNetworks, mergeNetworkTelemetry } from './fbtSwapNetworks.js';
import {
  normalizeChainsPayload,
  normalizeHistoricalTvlPayload,
  normalizeProtocolsPayload,
  normalizeDexOverviewPayload,
  normalizeFeesOverviewPayload,
  normalizeStablecoinsPayload,
  assembleDefiIntel,
  emptyOfflineOverviewIntel
} from './defiIntelNormalizer.js';

const FRESH_TTL_MS = 60_000;
const OFFLINE_TTL_MS = 8_000;

let cachedSnapshot = null;
let cachedAt = 0;
let inflightPromise = null;

async function fetchJson(url, timeoutMs = 6000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: ctrl.signal
    });
    if (!res.ok) throw new Error(`HTTP_${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchDirectBrowserIntel() {
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
    fetchJson('https://api.llama.fi/v2/chains', 5500),
    fetchJson('https://api.llama.fi/v2/historicalChainTvl', 5500),
    fetchJson('https://api.llama.fi/protocols', 7500),
    fetchJson('https://api.llama.fi/overview/dexs?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true', 5500),
    fetchJson('https://api.llama.fi/overview/fees?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true', 5500),
    fetchJson('https://stablecoins.llama.fi/stablecoins?includePrices=false', 6500),
    probeAllFbtSwapNetworks({ timeoutMs: 2800 }),
    fetchJson('https://mempool.space/api/v1/fees/recommended', 2800)
  ]);

  const rawChainsFull = chainsRes.status === 'fulfilled' && Array.isArray(chainsRes.value)
    ? chainsRes.value
    : [];
  const chains = normalizeChainsPayload(rawChainsFull);
  const historical = histRes.status === 'fulfilled'
    ? normalizeHistoricalTvlPayload(histRes.value)
    : normalizeHistoricalTvlPayload([]);
  const protocols = protocolsRes.status === 'fulfilled'
    ? normalizeProtocolsPayload(protocolsRes.value)
    : { categories: [], topProtocols: [] };
  const dexs = dexsRes.status === 'fulfilled'
    ? normalizeDexOverviewPayload(dexsRes.value)
    : normalizeDexOverviewPayload(null);
  const fees = feesRes.status === 'fulfilled'
    ? normalizeFeesOverviewPayload(feesRes.value)
    : normalizeFeesOverviewPayload(null);
  const stablecoins = stablesRes.status === 'fulfilled'
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
    throw new Error('DIRECT_INTEL_UNAVAILABLE');
  }

  const rawChains = rawChainsFull
    .filter((c) => c?.name && Number(c?.tvl) > 0)
    .slice(0, 60)
    .map((c) => ({ name: c.name, tvl: Math.round(Number(c.tvl)) }));

  return {
    ok: true,
    offline: false,
    partial: !(anyDefiOk && anyRpcOk),
    source: 'direct',
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

function attachHydratedNetworks(payload) {
  const safe = payload || emptyOfflineOverviewIntel();
  const swapNetworks = mergeNetworkTelemetry({
    probes: safe.networkProbes,
    chainTvls: safe.rawChains || safe.defi?.topChains || [],
    loading: false
  });
  return {
    ...safe,
    swapNetworks
  };
}

export function peekCachedOverviewIntel() {
  return cachedSnapshot;
}

export function __resetOverviewIntelCacheForTests() {
  cachedSnapshot = null;
  cachedAt = 0;
  inflightPromise = null;
}

export async function getMarketOverviewIntel({ force = false } = {}) {
  const now = Date.now();
  if (!force && cachedSnapshot) {
    const ttl = cachedSnapshot.offline ? OFFLINE_TTL_MS : FRESH_TTL_MS;
    if (now - cachedAt < ttl) return cachedSnapshot;
  }

  if (!force && inflightPromise) return inflightPromise;

  inflightPromise = (async () => {
    try {
      const serverPayload = await fetchJson(`${apiBase()}/market/overview-intel`, 6500);
      if (serverPayload && serverPayload.ok) {
        // If server had restricted RPC egress, opportunistically enrich RPC probes in browser
        const hasOnlineRpc =
          serverPayload.networkProbes &&
          Object.values(serverPayload.networkProbes).some((p) => p && p.ok);
        if (!hasOnlineRpc) {
          try {
            const clientProbes = await probeAllFbtSwapNetworks({ timeoutMs: 2400 });
            if (Object.values(clientProbes).some((p) => p && p.ok)) {
              serverPayload.networkProbes = clientProbes;
            }
          } catch {
            // keep server payload as-is
          }
        }
        const hydrated = attachHydratedNetworks(serverPayload);
        cachedSnapshot = hydrated;
        cachedAt = Date.now();
        return hydrated;
      }
      throw new Error('INVALID_SERVER_INTEL');
    } catch {
      try {
        const directPayload = await fetchDirectBrowserIntel();
        const hydrated = attachHydratedNetworks(directPayload);
        cachedSnapshot = hydrated;
        cachedAt = Date.now();
        return hydrated;
      } catch {
        if (cachedSnapshot && !cachedSnapshot.offline) {
          return { ...cachedSnapshot, stale: true };
        }
        const offline = attachHydratedNetworks(emptyOfflineOverviewIntel());
        cachedSnapshot = offline;
        cachedAt = Date.now();
        return offline;
      }
    } finally {
      inflightPromise = null;
    }
  })();

  return inflightPromise;
}
