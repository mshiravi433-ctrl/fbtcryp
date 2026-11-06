/**
 * Pure normalizers for DeFi & Network Intelligence payloads (DefiLlama + FBT).
 *
 * Shared between `server/marketOverviewIntel.js` and the browser's direct
 * fallback in `src/lib/marketOverviewIntel.js` so server-cached responses and
 * direct CORS responses produce the exact same schema.
 */

import { FBT_SWAP_NETWORKS } from './fbtSwapNetworks.js';

const EXCLUDED_PROTOCOL_CATEGORIES = new Set([
  'cex',
  'chain',
  'canonical bridge'
]);

const CATEGORY_MAP = Object.freeze({
  'liquid staking': { id: 'liquid_staking', fbtRoute: '/farm' },
  'liquid restaking': { id: 'restaking', fbtRoute: '/farm' },
  restaking: { id: 'restaking', fbtRoute: '/farm' },
  lending: { id: 'lending', fbtRoute: '/loan' },
  dexs: { id: 'dexs', fbtRoute: '/swap' },
  dex: { id: 'dexs', fbtRoute: '/swap' },
  'dex aggregator': { id: 'dexs', fbtRoute: '/swap' },
  bridge: { id: 'bridge', fbtRoute: '/bridge' },
  'cross chain': { id: 'bridge', fbtRoute: '/bridge' },
  'cross-chain': { id: 'bridge', fbtRoute: '/bridge' },
  rwa: { id: 'rwa', fbtRoute: '/stocks' },
  'rwa lending': { id: 'rwa', fbtRoute: '/stocks' },
  yield: { id: 'yield', fbtRoute: '/farm' },
  'yield aggregator': { id: 'yield', fbtRoute: '/farm' },
  farm: { id: 'yield', fbtRoute: '/farm' },
  cdp: { id: 'cdp_derivatives', fbtRoute: '/loan' },
  derivatives: { id: 'cdp_derivatives', fbtRoute: '/swap' },
  perps: { id: 'cdp_derivatives', fbtRoute: '/swap' }
});

const FBT_INTEGRATED_MATCHERS = Object.freeze([
  { match: 'lido', route: '/farm' },
  { match: 'aave', route: '/loan' },
  { match: 'uniswap', route: '/swap' },
  { match: 'pancakeswap', route: '/swap' },
  { match: 'curve', route: '/swap' },
  { match: 'compound', route: '/loan' },
  { match: 'morpho', route: '/loan' },
  { match: 'pendle', route: '/farm' },
  { match: 'eigenlayer', route: '/farm' },
  { match: 'ether.fi', route: '/farm' },
  { match: 'rocket pool', route: '/farm' },
  { match: 'jito', route: '/farm' },
  { match: 'kamino', route: '/loan' },
  { match: 'jupiter', route: '/swap?chain=solana' },
  { match: 'raydium', route: '/swap?chain=solana' },
  { match: 'aerodrome', route: '/swap?chain=8453&from=ETH' },
  { match: 'velodrome', route: '/swap?chain=10&from=ETH' },
  { match: 'quickswap', route: '/swap?chain=137&from=POL' },
  { match: 'sushiswap', route: '/swap?chain=42161&from=ETH' },
  { match: 'trader joe', route: '/swap?chain=43114&from=AVAX' },
  { match: 'kyberswap', route: '/swap' },
  { match: 'thorchain', route: '/bridge' },
  { match: 'sky', route: '/loan' },
  { match: 'maker', route: '/loan' },
  { match: 'ondo', route: '/stocks' }
]);

function finiteNum(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function matchFbtChain(chainName) {
  const clean = String(chainName || '').trim().toLowerCase();
  if (!clean) return null;
  return (
    FBT_SWAP_NETWORKS.find((n) => n.llamaAliases.includes(clean) || n.name.toLowerCase() === clean) ||
    null
  );
}

function matchFbtProtocol(name, slug) {
  const hay = `${String(name || '')} ${String(slug || '')}`.toLowerCase();
  for (const item of FBT_INTEGRATED_MATCHERS) {
    if (hay.includes(item.match)) return item.route;
  }
  return null;
}

export function normalizeChainsPayload(chainsRaw = []) {
  if (!Array.isArray(chainsRaw) || !chainsRaw.length) {
    return { totalChainTvlUsd: null, ethSharePct: null, topChains: [] };
  }
  const valid = chainsRaw
    .map((c) => ({
      name: String(c?.name || '').trim(),
      symbol: String(c?.tokenSymbol || '').trim().toUpperCase() || null,
      tvlUsd: finiteNum(c?.tvl)
    }))
    .filter((c) => c.name && c.tvlUsd != null && c.tvlUsd > 0)
    .sort((a, b) => b.tvlUsd - a.tvlUsd);

  const totalChainTvlUsd = valid.reduce((s, c) => s + c.tvlUsd, 0);
  if (totalChainTvlUsd <= 0) {
    return { totalChainTvlUsd: null, ethSharePct: null, topChains: [] };
  }

  const ethRow = valid.find((c) => c.name.toLowerCase() === 'ethereum');
  const ethSharePct = ethRow ? (ethRow.tvlUsd / totalChainTvlUsd) * 100 : null;

  const topChains = valid.slice(0, 8).map((c) => {
    const fbtMatch = matchFbtChain(c.name);
    return {
      name: c.name,
      symbol: c.symbol || fbtMatch?.nativeSymbol || null,
      tvlUsd: c.tvlUsd,
      sharePct: (c.tvlUsd / totalChainTvlUsd) * 100,
      fbtSupported: Boolean(fbtMatch),
      swapHref: fbtMatch?.swapHref || null,
      color: fbtMatch?.color || null
    };
  });

  return { totalChainTvlUsd, ethSharePct, topChains };
}

export function normalizeHistoricalTvlPayload(histRaw = []) {
  if (!Array.isArray(histRaw) || histRaw.length < 2) {
    return {
      latestTvlUsd: null,
      tvlChange24hPct: null,
      tvlChange30dPct: null,
      tvlChange90dPct: null,
      tvlHistory90d: []
    };
  }
  const points = histRaw
    .map((p) => ({
      date: finiteNum(p?.date),
      tvl: finiteNum(p?.tvl)
    }))
    .filter((p) => p.tvl != null && p.tvl > 0);

  if (points.length < 2) {
    return {
      latestTvlUsd: null,
      tvlChange24hPct: null,
      tvlChange30dPct: null,
      tvlChange90dPct: null,
      tvlHistory90d: []
    };
  }

  const tail = points.slice(-90);
  const latest = tail[tail.length - 1].tvl;
  const prev1d = tail.length >= 2 ? tail[tail.length - 2].tvl : null;
  const prev30d = tail.length >= 31 ? tail[tail.length - 31].tvl : tail[0]?.tvl;
  const prev90d = tail[0]?.tvl;

  const pct = (now, prev) => (prev && prev > 0 ? ((now - prev) / prev) * 100 : null);

  // Downsample to ~45 points so sparkline rendering stays razor-fast
  const step = tail.length > 48 ? 2 : 1;
  const tvlHistory90d = [];
  for (let i = 0; i < tail.length; i += step) {
    tvlHistory90d.push(Math.round(tail[i].tvl));
  }
  if (tvlHistory90d[tvlHistory90d.length - 1] !== Math.round(latest)) {
    tvlHistory90d.push(Math.round(latest));
  }

  return {
    latestTvlUsd: latest,
    tvlChange24hPct: pct(latest, prev1d),
    tvlChange30dPct: pct(latest, prev30d),
    tvlChange90dPct: pct(latest, prev90d),
    tvlHistory90d
  };
}

export function normalizeProtocolsPayload(protocolsRaw = []) {
  if (!Array.isArray(protocolsRaw) || !protocolsRaw.length) {
    return { categories: [], topProtocols: [] };
  }

  const buckets = new Map();
  const cleanProtocols = [];

  for (const p of protocolsRaw) {
    const rawCat = String(p?.category || '').trim();
    const lowerCat = rawCat.toLowerCase();
    if (!rawCat || EXCLUDED_PROTOCOL_CATEGORIES.has(lowerCat)) continue;
    if (p?.parentProtocol && String(p?.name || '').toLowerCase().includes('v1')) continue;

    const tvl = finiteNum(p?.tvl);
    if (tvl == null || tvl <= 0) continue;

    const name = String(p?.name || '').trim();
    const slug = String(p?.slug || '').trim();
    if (!name) continue;

    const fbtRoute = p?.fbtIntegrated?.route || matchFbtProtocol(name, slug);
    const chainsArr = Array.isArray(p?.chains) ? p.chains : [];

    cleanProtocols.push({
      name,
      slug: slug || name.toLowerCase().replace(/\s+/g, '-'),
      symbol: p?.symbol && p.symbol !== '-' ? String(p.symbol).toUpperCase() : null,
      category: rawCat,
      tvlUsd: tvl,
      change1d: finiteNum(p?.change_1d ?? p?.change1d),
      change7d: finiteNum(p?.change_7d ?? p?.change7d),
      chainsCount: chainsArr.length || (finiteNum(p?.chainsCount) ?? 1),
      logo: typeof p?.logo === 'string' && p.logo.startsWith('https://') ? p.logo : null,
      fbtIntegrated: Boolean(fbtRoute || p?.fbtIntegrated),
      fbtRoute: fbtRoute || null
    });

    const mapped = CATEGORY_MAP[lowerCat];
    if (mapped) {
      const prev = buckets.get(mapped.id) || {
        id: mapped.id,
        fbtRoute: mapped.fbtRoute,
        tvlUsd: 0,
        protocolCount: 0,
        leaderName: name,
        leaderTvl: 0
      };
      prev.tvlUsd += tvl;
      prev.protocolCount += 1;
      if (tvl > prev.leaderTvl) {
        prev.leaderTvl = tvl;
        prev.leaderName = name;
      }
      buckets.set(mapped.id, prev);
    }
  }

  cleanProtocols.sort((a, b) => b.tvlUsd - a.tvlUsd);

  // Deduplicate protocol families by normalized prefix if parent+child both appear
  const seenNames = new Set();
  const topProtocols = [];
  for (const item of cleanProtocols) {
    const key = item.name.toLowerCase();
    if (seenNames.has(key)) continue;
    seenNames.add(key);
    topProtocols.push(item);
    if (topProtocols.length >= 8) break;
  }

  const bucketList = [...buckets.values()].sort((a, b) => b.tvlUsd - a.tvlUsd);
  const bucketTotal = bucketList.reduce((s, b) => s + b.tvlUsd, 0);
  const categories = bucketList.map((b) => ({
    id: b.id,
    tvlUsd: b.tvlUsd,
    sharePct: bucketTotal > 0 ? (b.tvlUsd / bucketTotal) * 100 : 0,
    protocolCount: b.protocolCount,
    leaderName: b.leaderName,
    fbtRoute: b.fbtRoute
  }));

  return { categories, topProtocols };
}

export function normalizeDexOverviewPayload(raw = null) {
  if (!raw || typeof raw !== 'object') {
    return { dexVolume24hUsd: null, dexVolume7dUsd: null, dexChange24hPct: null, topDexs: [] };
  }
  const dexVolume24hUsd = finiteNum(raw.total24h);
  const dexVolume7dUsd = finiteNum(raw.total7d);
  const dexChange24hPct = finiteNum(raw.change_1d);
  const protocols = Array.isArray(raw.protocols) ? raw.protocols : [];

  const sorted = protocols
    .map((p) => ({
      name: String(p?.displayName || p?.name || '').trim(),
      volume24hUsd: finiteNum(p?.total24h),
      change1d: finiteNum(p?.change_1d)
    }))
    .filter((p) => p.name && p.volume24hUsd != null && p.volume24hUsd > 0)
    .sort((a, b) => b.volume24hUsd - a.volume24hUsd)
    .slice(0, 5);

  const denom = dexVolume24hUsd && dexVolume24hUsd > 0
    ? dexVolume24hUsd
    : sorted.reduce((s, p) => s + p.volume24hUsd, 0);

  const topDexs = sorted.map((p) => ({
    ...p,
    sharePct: denom > 0 ? (p.volume24hUsd / denom) * 100 : 0,
    fbtRoute: matchFbtProtocol(p.name, p.name)
  }));

  return { dexVolume24hUsd, dexVolume7dUsd, dexChange24hPct, topDexs };
}

export function normalizeFeesOverviewPayload(raw = null) {
  if (!raw || typeof raw !== 'object') {
    return { fees24hUsd: null, revenue24hUsd: null, feesChange24hPct: null };
  }
  return {
    fees24hUsd: finiteNum(raw.total24h),
    revenue24hUsd: finiteNum(raw.totalRevenue24h ?? raw.dailyRevenue),
    feesChange24hPct: finiteNum(raw.change_1d)
  };
}

export function normalizeStablecoinsPayload(stableData = null) {
  if (!stableData || typeof stableData !== 'object') {
    return {
      stablecoinTotalUsd: null,
      stablecoinNet24hUsd: null,
      stablecoinNet7dUsd: null,
      topStablecoins: [],
      chainInflows: [],
      chainOutflows: []
    };
  }

  // Case A: Already normalized by server/capitalFlows.js `rankStablecoinFlows()`
  if ('totalCirculatingUsd' in stableData && Array.isArray(stableData.topAssets)) {
    const total = finiteNum(stableData.totalCirculatingUsd);
    return {
      stablecoinTotalUsd: total,
      stablecoinNet24hUsd: finiteNum(stableData.net24hUsd),
      stablecoinNet7dUsd: finiteNum(stableData.net7dUsd),
      topStablecoins: stableData.topAssets.slice(0, 6).map((a) => ({
        symbol: a.symbol,
        name: a.name,
        circulatingUsd: finiteNum(a.circulatingUsd),
        delta24hUsd: finiteNum(a.delta24hUsd),
        delta24hPct: finiteNum(a.delta24hPct),
        sharePct: total && total > 0 && finiteNum(a.circulatingUsd) ? (Number(a.circulatingUsd) / total) * 100 : 0
      })),
      chainInflows: Array.isArray(stableData.chainInflows) ? stableData.chainInflows.slice(0, 4) : [],
      chainOutflows: Array.isArray(stableData.chainOutflows) ? stableData.chainOutflows.slice(0, 4) : []
    };
  }

  // Case B: Raw `stablecoins.llama.fi/stablecoins?includePrices=false` payload
  const assets = Array.isArray(stableData.peggedAssets) ? stableData.peggedAssets : [];
  if (!assets.length) {
    return {
      stablecoinTotalUsd: null,
      stablecoinNet24hUsd: null,
      stablecoinNet7dUsd: null,
      topStablecoins: [],
      chainInflows: [],
      chainOutflows: []
    };
  }

  let total = 0;
  let totalPrevDay = 0;
  let totalPrevWeek = 0;
  const byChain = new Map();
  const parsedAssets = [];

  for (const a of assets) {
    const cur = finiteNum(a?.circulating?.peggedUSD);
    if (!cur || cur <= 0) continue;
    const d1 = finiteNum(a?.circulatingPrevDay?.peggedUSD) ?? cur;
    const d7 = finiteNum(a?.circulatingPrevWeek?.peggedUSD) ?? cur;
    total += cur;
    totalPrevDay += d1;
    totalPrevWeek += d7;
    parsedAssets.push({
      symbol: String(a?.symbol || '').toUpperCase(),
      name: String(a?.name || a?.symbol || ''),
      circulatingUsd: cur,
      delta24hUsd: cur - d1,
      delta24hPct: d1 > 0 ? ((cur - d1) / d1) * 100 : 0
    });

    const chainMap = a?.chainCirculating && typeof a.chainCirculating === 'object' ? a.chainCirculating : {};
    for (const [chainName, entry] of Object.entries(chainMap)) {
      const cNow = finiteNum(entry?.current?.peggedUSD);
      if (!cNow || cNow <= 0) continue;
      const cPrev = finiteNum(entry?.circulatingPrevDay?.peggedUSD) ?? cNow;
      const rec = byChain.get(chainName) || { chain: chainName, supplyUsd: 0, prevDayUsd: 0 };
      rec.supplyUsd += cNow;
      rec.prevDayUsd += cPrev;
      byChain.set(chainName, rec);
    }
  }

  parsedAssets.sort((a, b) => b.circulatingUsd - a.circulatingUsd);
  const topStablecoins = parsedAssets.slice(0, 6).map((a) => ({
    ...a,
    sharePct: total > 0 ? (a.circulatingUsd / total) * 100 : 0
  }));

  const chainRows = [...byChain.values()]
    .filter((c) => c.supplyUsd >= 25_000_000)
    .map((c) => ({
      chain: c.chain,
      supplyUsd: Math.round(c.supplyUsd),
      delta24hUsd: Math.round(c.supplyUsd - c.prevDayUsd),
      delta24hPct: c.prevDayUsd > 0 ? ((c.supplyUsd - c.prevDayUsd) / c.prevDayUsd) * 100 : 0
    }));

  return {
    stablecoinTotalUsd: total > 0 ? total : null,
    stablecoinNet24hUsd: total > 0 ? total - totalPrevDay : null,
    stablecoinNet7dUsd: total > 0 ? total - totalPrevWeek : null,
    topStablecoins,
    chainInflows: chainRows.filter((c) => c.delta24hUsd > 0).sort((a, b) => b.delta24hUsd - a.delta24hUsd).slice(0, 4),
    chainOutflows: chainRows.filter((c) => c.delta24hUsd < 0).sort((a, b) => a.delta24hUsd - b.delta24hUsd).slice(0, 4)
  };
}

/**
 * Assemble the complete `defi` intelligence block from normalized sub-parts.
 */
export function assembleDefiIntel({
  chains,
  historical,
  protocols,
  dexs,
  fees,
  stablecoins
} = {}) {
  const totalTvlUsd = historical?.latestTvlUsd ?? chains?.totalChainTvlUsd ?? null;
  return {
    totalTvlUsd,
    tvlChange24hPct: historical?.tvlChange24hPct ?? null,
    tvlChange30dPct: historical?.tvlChange30dPct ?? null,
    tvlChange90dPct: historical?.tvlChange90dPct ?? null,
    tvlHistory90d: historical?.tvlHistory90d ?? [],
    ethSharePct: chains?.ethSharePct ?? null,
    topChains: chains?.topChains ?? [],
    categories: protocols?.categories ?? [],
    topProtocols: protocols?.topProtocols ?? [],
    dexVolume24hUsd: dexs?.dexVolume24hUsd ?? null,
    dexVolume7dUsd: dexs?.dexVolume7dUsd ?? null,
    dexChange24hPct: dexs?.dexChange24hPct ?? null,
    topDexs: dexs?.topDexs ?? [],
    fees24hUsd: fees?.fees24hUsd ?? null,
    revenue24hUsd: fees?.revenue24hUsd ?? null,
    feesChange24hPct: fees?.feesChange24hPct ?? null,
    stablecoinTotalUsd: stablecoins?.stablecoinTotalUsd ?? null,
    stablecoinNet24hUsd: stablecoins?.stablecoinNet24hUsd ?? null,
    stablecoinNet7dUsd: stablecoins?.stablecoinNet7dUsd ?? null,
    topStablecoins: stablecoins?.topStablecoins ?? [],
    chainInflows: stablecoins?.chainInflows ?? [],
    chainOutflows: stablecoins?.chainOutflows ?? []
  };
}

/**
 * Offline fallback structure when BOTH the server endpoint and direct browser
 * DefiLlama egress are unreachable (e.g. airplane mode or isolated test runner).
 *
 * Notice: NO live numbers are fabricated. `defi` carries `null` metrics and
 * `offline: true` so the UI renders an honest offline/unavailable state, while
 * `swapNetworks` exposes the exact static 19-network FBT Swap registry with
 * `status: 'offline'` and `latencyMs: null`.
 */
export function emptyOfflineOverviewIntel() {
  return {
    ok: false,
    offline: true,
    source: 'offline',
    updatedAt: null,
    defi: assembleDefiIntel({}),
    rawChains: [],
    networkProbes: null
  };
}
