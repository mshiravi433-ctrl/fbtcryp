/**
 * Canonical catalog and telemetry merger for every network FBT Swap trades.
 *
 * Single-sourced from `src/lib/chains.js` and `src/lib/executionSources.js`
 * for the 16 EVM chains, plus the three non-EVM execution rails wired in
 * `server/solana.js` (Solana Jupiter V2), `server/btcChain.js` + `src/lib/thorswap.js`
 * (Native Bitcoin L1 via THORChain), and `server/xchain.js` (Tron via 0x Cross-Chain).
 *
 * Honesty contract:
 *   - Static metadata (chain ID, native gas symbol, primary router, fee bps,
 *     block cadence, explorer, swap deep-link) is always known from code.
 *   - Live telemetry (`latencyMs`, `latestBlock`, `feeHint`, `tvlUsd`) is NEVER
 *     invented: until a real RPC or DefiLlama response arrives, those fields
 *     remain `null` and `status` reflects `'checking'` or `'offline'`.
 */

import {
  EVM_CHAINS,
  EVM_CHAIN_ORDER,
  TOKENS,
  FEE_BPS,
  feeRouterFor
} from './chains.js';
import { executionPlanFor } from './executionSources.js';

const CHAIN_CADENCE_MS = Object.freeze({
  1: 12000,
  56: 750,
  137: 2100,
  42161: 250,
  8453: 2000,
  10: 2000,
  43114: 2000,
  59144: 2000,
  146: 500,
  5000: 2000,
  80094: 2000,
  130: 1000,
  143: 500,
  534352: 3000,
  324: 1000,
  4663: 250
});

const PROBE_DUMMY_ADDRESS = '0x0000000000000000000000000000000000000001';

const EXECUTOR_LABELS = Object.freeze({
  kyberswap: 'KyberSwap',
  openocean: 'OpenOcean',
  lifi: 'LI.FI',
  velora: 'Velora',
  jupiter: 'Jupiter V2',
  thorchain: 'THORChain',
  zerox: '0x Cross-Chain'
});

const L2_CHAIN_IDS = new Set([
  42161, // Arbitrum One
  8453,  // Base
  10,    // Optimism
  59144, // Linea
  5000,  // Mantle
  130,   // Unichain
  534352,// Scroll
  324,   // zkSync Era
  4663   // Robinhood Chain (Arbitrum Orbit L2)
]);

const LLAMA_CHAIN_ALIASES = Object.freeze({
  1: ['ethereum'],
  56: ['bsc', 'binance', 'bnb chain'],
  137: ['polygon', 'polygon pos'],
  42161: ['arbitrum', 'arbitrum one'],
  8453: ['base'],
  10: ['op mainnet', 'optimism'],
  43114: ['avalanche'],
  59144: ['linea'],
  146: ['sonic'],
  5000: ['mantle'],
  80094: ['berachain'],
  130: ['unichain'],
  143: ['monad'],
  534352: ['scroll'],
  324: ['zksync era', 'era', 'zksync'],
  4663: ['robinhood chain', 'robinhood'],
  solana: ['solana'],
  bitcoin: ['bitcoin'],
  tron: ['tron']
});

export const FBT_NETWORK_FAMILIES = Object.freeze(['all', 'l1', 'l2', 'non-evm']);

export const SLOW_RPC_THRESHOLD_MS = 950;

function formatCadenceLabel(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 1000) return `${(n / 1000).toFixed(2).replace(/0$/, '')}s`;
  if (n >= 60000) return `${Math.round(n / 60000)}m`;
  const secs = n / 1000;
  return Number.isInteger(secs) ? `${secs}s` : `${secs.toFixed(1)}s`;
}

function buildEvmEntry(chainId) {
  const cfg = EVM_CHAINS[chainId];
  if (!cfg) return null;
  const plan = executionPlanFor(chainId, { fromAddress: PROBE_DUMMY_ADDRESS });
  const executors = plan.feeExecutors.map((id) => EXECUTOR_LABELS[id] || id);
  const primaryExecutor = EXECUTOR_LABELS[plan.primaryId] || cfg.dexName || 'Aggregator';
  const defaultFrom = TOKENS?.[chainId]?.[0]?.symbol || cfg.native?.symbol || 'ETH';
  const blockTimeMs = CHAIN_CADENCE_MS[chainId] || 2000;

  return Object.freeze({
    key: `evm:${chainId}`,
    chainId,
    isEvm: true,
    family: L2_CHAIN_IDS.has(chainId) ? 'l2' : 'l1',
    name: cfg.name,
    short: cfg.short || cfg.name,
    nativeSymbol: cfg.native?.symbol || defaultFrom,
    color: cfg.color || '#2EE6A6',
    dexName: cfg.dexName,
    primaryExecutor,
    executors: Object.freeze(executors.length ? executors : [primaryExecutor]),
    redundancy: Math.max(1, plan.redundancy || executors.length),
    feeBps: FEE_BPS,
    hasOnChainFeeRouter: Boolean(feeRouterFor(chainId)),
    blockTimeMs,
    cadence: formatCadenceLabel(blockTimeMs),
    explorer: cfg.explorer,
    swapHref: `/swap?chain=${chainId}&from=${encodeURIComponent(defaultFrom)}`,
    rpcUrls: Object.freeze(Array.isArray(cfg.rpc) ? cfg.rpc.slice(0, 3) : []),
    llamaAliases: Object.freeze(LLAMA_CHAIN_ALIASES[chainId] || [cfg.name.toLowerCase()])
  });
}

const NON_EVM_ENTRIES = Object.freeze([
  Object.freeze({
    key: 'solana',
    chainId: 'solana',
    isEvm: false,
    family: 'non-evm',
    name: 'Solana',
    short: 'SOL',
    nativeSymbol: 'SOL',
    color: '#14F195',
    dexName: 'Jupiter V2',
    primaryExecutor: 'Jupiter V2',
    executors: Object.freeze(['Jupiter V2', 'LI.FI', 'THORChain']),
    redundancy: 3,
    feeBps: 70,
    hasOnChainFeeRouter: true,
    blockTimeMs: 400,
    cadence: '0.4s',
    explorer: 'https://solscan.io',
    swapHref: '/swap?chain=solana',
    rpcUrls: Object.freeze([
      'https://solana-rpc.publicnode.com',
      'https://api.mainnet-beta.solana.com'
    ]),
    llamaAliases: Object.freeze(LLAMA_CHAIN_ALIASES.solana)
  }),
  Object.freeze({
    key: 'bitcoin',
    chainId: 'bitcoin',
    isEvm: false,
    family: 'non-evm',
    name: 'Bitcoin',
    short: 'BTC',
    nativeSymbol: 'BTC',
    color: '#F7931A',
    dexName: 'THORChain L1',
    primaryExecutor: 'THORChain',
    executors: Object.freeze(['THORChain']),
    redundancy: 1,
    feeBps: 50,
    hasOnChainFeeRouter: false,
    blockTimeMs: 600000,
    cadence: '10m',
    explorer: 'https://mempool.space',
    swapHref: '/bridge',
    rpcUrls: Object.freeze([
      'https://mempool.space/api/blocks/tip/height',
      'https://blockstream.info/api/blocks/tip/height'
    ]),
    llamaAliases: Object.freeze(LLAMA_CHAIN_ALIASES.bitcoin)
  }),
  Object.freeze({
    key: 'tron',
    chainId: 'tron',
    isEvm: false,
    family: 'non-evm',
    name: 'Tron',
    short: 'TRX',
    nativeSymbol: 'TRX',
    color: '#FF060A',
    dexName: '0x Cross-Chain',
    primaryExecutor: '0x Cross-Chain',
    executors: Object.freeze(['0x Cross-Chain']),
    redundancy: 1,
    feeBps: 30,
    hasOnChainFeeRouter: false,
    blockTimeMs: 3000,
    cadence: '3s',
    explorer: 'https://tronscan.org',
    swapHref: '/bridge',
    rpcUrls: Object.freeze(['https://api.trongrid.io/wallet/getnowblock']),
    llamaAliases: Object.freeze(LLAMA_CHAIN_ALIASES.tron)
  })
]);

export const FBT_SWAP_NETWORKS = Object.freeze([
  // Flagship order: top liquidity EVM + Solana + Bitcoin + remaining L1/L2 + Tron
  buildEvmEntry(1),
  buildEvmEntry(56),
  NON_EVM_ENTRIES[0], // Solana
  buildEvmEntry(42161),
  buildEvmEntry(8453),
  NON_EVM_ENTRIES[1], // Bitcoin
  buildEvmEntry(137),
  buildEvmEntry(10),
  buildEvmEntry(43114),
  NON_EVM_ENTRIES[2], // Tron
  ...EVM_CHAIN_ORDER
    .filter((id) => ![1, 56, 42161, 8453, 137, 10, 43114].includes(id))
    .map(buildEvmEntry)
].filter(Boolean));

/**
 * Index a DefiLlama `/v2/chains` array by lowercase name / gecko_id / tokenSymbol
 * for O(1) lookup without false-positive substring matches.
 */
export function indexChainTvls(chainRows = []) {
  const byName = new Map();
  if (!Array.isArray(chainRows)) return byName;
  for (const row of chainRows) {
    const tvl = Number(row?.tvl ?? row?.tvlUsd);
    if (!Number.isFinite(tvl) || tvl <= 0) continue;
    const nameKey = String(row?.name || '').trim().toLowerCase();
    if (nameKey && (!byName.has(nameKey) || byName.get(nameKey) < tvl)) {
      byName.set(nameKey, tvl);
    }
  }
  return byName;
}

/**
 * Merge live RPC probe results and optional DefiLlama chain TVL figures onto
 * the canonical 19-network FBT Swap registry.
 *
 * @param {object} opts
 * @param {Record<string, object>|Array<object>|null} [opts.probes]
 * @param {Array<object>} [opts.chainTvls]
 * @param {boolean} [opts.loading]
 */
export function mergeNetworkTelemetry({ probes = null, chainTvls = [], loading = false } = {}) {
  const probeMap = new Map();
  if (Array.isArray(probes)) {
    for (const p of probes) {
      if (p?.key) probeMap.set(String(p.key), p);
      else if (p?.chainId != null) probeMap.set(typeof p.chainId === 'number' ? `evm:${p.chainId}` : String(p.chainId), p);
    }
  } else if (probes && typeof probes === 'object') {
    for (const [k, v] of Object.entries(probes)) {
      if (v && typeof v === 'object') probeMap.set(k, v);
    }
  }

  const tvlMap = indexChainTvls(chainTvls);

  const networks = FBT_SWAP_NETWORKS.map((net) => {
    const probe = probeMap.get(net.key) || probeMap.get(String(net.chainId)) || null;
    let tvlUsd = Number.isFinite(Number(probe?.tvlUsd)) && Number(probe.tvlUsd) > 0
      ? Number(probe.tvlUsd)
      : null;
    if (tvlUsd == null) {
      for (const alias of net.llamaAliases) {
        if (tvlMap.has(alias)) {
          tvlUsd = tvlMap.get(alias);
          break;
        }
      }
    }

    const ok = probe ? Boolean(probe.ok) : null;
    const latencyMs = ok && Number.isFinite(Number(probe?.latencyMs)) && Number(probe.latencyMs) >= 0
      ? Math.round(Number(probe.latencyMs))
      : null;
    const latestBlock = ok && Number.isFinite(Number(probe?.latestBlock)) && Number(probe.latestBlock) > 0
      ? Math.floor(Number(probe.latestBlock))
      : null;
    const feeHint = probe?.feeHint && typeof probe.feeHint === 'string' ? probe.feeHint : null;

    let status = 'checking';
    if (!loading && probe) {
      if (ok) {
        status = latencyMs != null && latencyMs >= SLOW_RPC_THRESHOLD_MS ? 'slow' : 'online';
      } else {
        status = 'offline';
      }
    } else if (!loading && !probe) {
      status = 'offline';
    }

    return {
      ...net,
      status,
      ok: Boolean(ok),
      latencyMs,
      latestBlock,
      feeHint,
      tvlUsd
    };
  });

  const online = networks.filter((n) => n.status === 'online' || n.status === 'slow');
  const latencies = online.map((n) => n.latencyMs).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const medianLatencyMs = latencies.length
    ? latencies[Math.floor(latencies.length / 2)]
    : null;
  const totalFbtTvlUsd = networks.reduce((sum, n) => sum + (Number.isFinite(n.tvlUsd) ? n.tvlUsd : 0), 0);
  const distinctExecutors = new Set();
  for (const n of networks) {
    for (const ex of n.executors) distinctExecutors.add(ex);
  }

  return {
    totalCount: networks.length,
    evmCount: networks.filter((n) => n.isEvm).length,
    nonEvmCount: networks.filter((n) => !n.isEvm).length,
    onlineCount: online.length,
    medianLatencyMs,
    executorCount: distinctExecutors.size,
    executors: [...distinctExecutors],
    totalFbtTvlUsd: totalFbtTvlUsd > 0 ? totalFbtTvlUsd : null,
    networks
  };
}

async function probeSingleRpc(net, fetchImpl, timeoutMs) {
  const urls = net.rpcUrls || [];
  for (const url of urls.slice(0, 2)) {
    const started = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      if (net.isEvm) {
        const res = await fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}',
          signal: ctrl.signal
        });
        if (!res.ok) continue;
        const json = await res.json();
        const block = typeof json?.result === 'string' ? parseInt(json.result, 16) : NaN;
        if (Number.isFinite(block) && block > 0) {
          return { key: net.key, ok: true, latencyMs: Date.now() - started, latestBlock: block };
        }
      } else if (net.key === 'solana') {
        const res = await fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{"jsonrpc":"2.0","id":1,"method":"getSlot","params":[]}',
          signal: ctrl.signal
        });
        if (!res.ok) continue;
        const json = await res.json();
        const slot = Number(json?.result);
        if (Number.isFinite(slot) && slot > 0) {
          return { key: net.key, ok: true, latencyMs: Date.now() - started, latestBlock: slot };
        }
      } else if (net.key === 'bitcoin') {
        const res = await fetchImpl(url, { signal: ctrl.signal });
        if (!res.ok) continue;
        const txt = (await res.text()).trim();
        const height = Number(txt);
        if (Number.isFinite(height) && height > 100000) {
          return { key: net.key, ok: true, latencyMs: Date.now() - started, latestBlock: height };
        }
      } else if (net.key === 'tron') {
        const res = await fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
          signal: ctrl.signal
        });
        if (!res.ok) continue;
        const json = await res.json();
        const num = Number(json?.block_header?.raw_data?.number);
        if (Number.isFinite(num) && num > 0) {
          return { key: net.key, ok: true, latencyMs: Date.now() - started, latestBlock: num };
        }
      }
    } catch {
      // Try next configured public RPC endpoint
    } finally {
      clearTimeout(timer);
    }
  }
  return { key: net.key, ok: false, latencyMs: null, latestBlock: null };
}

/**
 * Parallel read-only RPC probe across all 19 FBT Swap networks.
 * Safe in both Node 20+ and modern browsers.
 */
export async function probeAllFbtSwapNetworks({ fetchImpl = globalThis.fetch, timeoutMs = 3200 } = {}) {
  if (typeof fetchImpl !== 'function') {
    return Object.fromEntries(FBT_SWAP_NETWORKS.map((n) => [n.key, { key: n.key, ok: false, latencyMs: null, latestBlock: null }]));
  }
  const settled = await Promise.all(
    FBT_SWAP_NETWORKS.map((net) => probeSingleRpc(net, fetchImpl, timeoutMs))
  );
  const out = {};
  for (const item of settled) {
    out[item.key] = item;
  }
  return out;
}
