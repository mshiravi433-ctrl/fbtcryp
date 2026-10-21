import { useEffect, useState } from 'react';
import { EVM_CHAINS } from '../lib/chains';

/**
 * Estimate gas cost in USD for a farm pool.
 * - Tries live provider gas price when wallet is connected
 * - Falls back to static estimates per chain
 * - Returns { gasUsd, loading, error }
 */

const STATIC_GAS_USD = {
  Ethereum: 1.8,
  'Arbitrum': 0.25,
  'Arbitrum One': 0.25,
  Base: 0.12,
  BSC: 0.15,
  'BNB Chain': 0.15,
  Polygon: 0.04,
  Optimism: 0.18,
  Avalanche: 0.25,
  Linea: 0.18,
  Sonic: 0.1,
  Mantle: 0.12,
  Berachain: 0.18,
  Scroll: 0.2,
  'zkSync Era': 0.15,
  zkSync: 0.15,
  'Robinhood Chain': 0.12,
  Unichain: 0.2,
  Monad: 0.12,
};

// Map chain display name -> chainId by searching EVM_CHAINS
function chainNameToId(chainName) {
  if (!chainName) return null;
  const normalized = String(chainName).trim().toLowerCase();
  for (const [id, info] of Object.entries(EVM_CHAINS)) {
    if (info.name.toLowerCase() === normalized) return Number(id);
    if (info.short?.toLowerCase() === normalized) return Number(id);
    // handle aliases
    if (normalized === 'bsc' && info.name === 'BNB Smart Chain') return Number(id);
    if (normalized === 'avalanche' && info.name === 'Avalanche') return Number(id);
    if (normalized === 'polygon' && info.name === 'Polygon') return Number(id);
  }
  // manual fallback for feed naming differences
  const aliasMap = {
    'ethereum': 1,
    'bnb chain': 56,
    'bnb smart chain': 56,
    'bsc': 56,
    'arbitrum': 42161,
    'arbitrum one': 42161,
    'base': 8453,
    'optimism': 10,
    'avalanche': 43114,
    'polygon': 137,
    'linea': 59144,
    'sonic': 146,
    'mantle': 5000,
    'berachain': 80094,
    'scroll': 534352,
    'zksync era': 324,
    'zksync': 324,
    'unichain': 130,
    'monad': 143,
    'robinhood chain': 4663,
    'robinhood': 4663,
  };
  return aliasMap[normalized] ?? null;
}

// Fetch native token price in USD via simple cache
const priceCache = new Map();
async function fetchNativePrice(coingeckoId) {
  if (!coingeckoId) return null;
  const cached = priceCache.get(coingeckoId);
  if (cached && Date.now() - cached.at < 5 * 60_000) return cached.price;
  try {
    const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coingeckoId)}&vs_currencies=usd`);
    if (!res.ok) throw new Error('coingecko fail');
    const json = await res.json();
    const price = json?.[coingeckoId]?.usd;
    if (price != null && Number.isFinite(price)) {
      priceCache.set(coingeckoId, { price, at: Date.now() });
      return price;
    }
  } catch {}
  return cached?.price ?? null;
}

export function useFarmGasEstimate({ pool, walletConnected, getReadProvider }) {
  const [gasUsd, setGasUsd] = useState(() => {
    // immediate fallback for SSR / initial
    const fallback = STATIC_GAS_USD[pool?.chain] ?? 0.5;
    return walletConnected ? fallback : null;
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const chainName = pool?.chain;
    const staticFallback = STATIC_GAS_USD[chainName] ?? 0.5;

    // When wallet not connected, show nothing (requirement: "for estimate, connect wallet")
    // But spec in code expects gasUsd = null when not connected -> shows —
    // We return null when not connected so Metric shows — with helper text
    if (!walletConnected) {
      setGasUsd(null);
      return;
    }

    // Start with fallback immediately so user sees something even before live fetch
    setGasUsd(staticFallback);

    const chainId = chainNameToId(chainName);
    if (!chainId || typeof getReadProvider !== 'function') {
      // no chain mapping or provider util, keep fallback
      return;
    }

    let provider;
    try {
      provider = getReadProvider(chainId);
    } catch {
      return;
    }
    if (!provider || typeof provider.getFeeData !== 'function') return;

    (async () => {
      setLoading(true);
      try {
        const feeData = await provider.getFeeData();
        const gasPrice = feeData?.gasPrice ?? feeData?.maxFeePerGas;
        if (!gasPrice) {
          if (!cancelled) setGasUsd(staticFallback);
          return;
        }
        // Estimate gas units: staking ~120k, LP ~180k
        const isStaking = pool?.exposure === 'single';
        const gasUnits = isStaking ? 140000n : 180000n;
        // gasPrice may be BigNumber or bigint
        const priceBN = typeof gasPrice === 'bigint' ? gasPrice : BigInt(gasPrice.toString());
        const costWei = gasUnits * priceBN; // in wei
        const costEth = Number(costWei) / 1e18;

        const chainInfo = EVM_CHAINS[chainId];
        const coingeckoId = chainInfo?.native?.coingeckoId;
        let nativePrice = null;
        if (coingeckoId) nativePrice = await fetchNativePrice(coingeckoId);

        let usd = null;
        if (nativePrice != null && Number.isFinite(costEth)) {
          usd = costEth * nativePrice;
        } else {
          // fallback to static if price unavailable
          usd = staticFallback;
        }
        // clamp to reasonable range: at least 0.01, at most 10x fallback or 20
        if (usd != null && Number.isFinite(usd)) {
          // prevent insanely low/high due to bad feed
          usd = Math.max(0.01, Math.min(usd, staticFallback * 8 || 20));
          if (!cancelled) setGasUsd(Math.round(usd * 100) / 100);
        } else if (!cancelled) {
          setGasUsd(staticFallback);
        }
      } catch {
        if (!cancelled) setGasUsd(staticFallback);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [pool?.chain, pool?.exposure, pool?.id, walletConnected, getReadProvider]);

  return { gasUsd, loading };
}

export function farmStaticGasEstimate(chainName) {
  return STATIC_GAS_USD[chainName] ?? 0.5;
}
