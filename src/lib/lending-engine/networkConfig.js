/**
 * LENDING ENGINE — network registry with feature flags (§5 of the spec).
 * ---------------------------------------------------------------------------
 * Networks are NOT hardcoded in the UI. This registry is the single source of
 * truth: the chain rail on the Lending page renders `enabledNetworks()`, so a
 * chain with a broken RPC or a paused protocol can be disabled here — or at
 * runtime by the server's circuit breaker — without a frontend deploy and
 * without taking the whole Lending page down.
 *
 *   · enabled:false with a reason — listed for integrators, hidden in the UI
 *   · rpcs: ordered fallback list (§26) — first healthy endpoint wins
 *   · protocols: what the router may route to on this chain
 *   · oracle: the price source feeding the Oracle Aggregator
 *
 * Keep `enabled` in sync with the adapters actually wired in
 * src/lib/lending-engine/adapter.js. Phase 216: Base carries Compound III and
 * Morpho Blue alongside Aave, and Solana carries the (pool-registry) Solana
 * lending adapter — both now have code to drive them, so the networks are
 * enabled. Linea and Sonic remain disabled: no adapter, and a market that
 * cannot execute must not be shown as one (§6's honesty rule).
 */

export const LENDING_NETWORKS = Object.freeze([
  {
    chainId: 1, key: 'ethereum', name: 'Ethereum', nativeToken: 'ETH',
    rpcs: ['https://eth.llamarpc.com', 'https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org'],
    explorer: 'https://etherscan.io', explorerTx: (h) => `https://etherscan.io/tx/${h}`,
    protocols: ['aave-v3'], oracle: 'aave-oracle',
    enabled: true, testnet: false, color: '#627eea'
  },
  {
    chainId: 56, key: 'bsc', name: 'BNB Chain', nativeToken: 'BNB',
    rpcs: ['https://bsc-rpc.publicnode.com', 'https://bsc.drpc.org', 'https://binance.llamarpc.com'],
    explorer: 'https://bscscan.com', explorerTx: (h) => `https://bscscan.com/tx/${h}`,
    protocols: ['aave-v3'], oracle: 'aave-oracle',
    enabled: true, testnet: false, color: '#f0b90b'
  },
  {
    chainId: 137, key: 'polygon', name: 'Polygon', nativeToken: 'POL',
    rpcs: ['https://polygon-bor-rpc.publicnode.com', 'https://polygon.drpc.org', 'https://1rpc.io/matic'],
    explorer: 'https://polygonscan.com', explorerTx: (h) => `https://polygonscan.com/tx/${h}`,
    protocols: ['aave-v3'], oracle: 'aave-oracle',
    enabled: true, testnet: false, color: '#8247e5'
  },
  {
    chainId: 42161, key: 'arbitrum', name: 'Arbitrum', nativeToken: 'ETH',
    rpcs: ['https://arbitrum-one-rpc.publicnode.com', 'https://arbitrum.drpc.org', 'https://arb1.arbitrum.io/rpc'],
    explorer: 'https://arbiscan.io', explorerTx: (h) => `https://arbiscan.io/tx/${h}`,
    protocols: ['aave-v3'], oracle: 'aave-oracle',
    enabled: true, testnet: false, color: '#28a0f0'
  },
  {
    chainId: 8453, key: 'base', name: 'Base', nativeToken: 'ETH',
    rpcs: ['https://base-rpc.publicnode.com', 'https://base.drpc.org', 'https://mainnet.base.org'],
    explorer: 'https://basescan.org', explorerTx: (h) => `https://basescan.org/tx/${h}`,
    /* Phase 216 — Base is the deepest lending chain in this deployment:
       Aave v3 + Compound III (Comet USDC) + Morpho Blue (USDC/cbBTC), each
       with a real adapter in src/lib/lending-engine/adapter.js. */
    protocols: ['aave-v3', 'compound-v3', 'morpho'], oracle: 'aave-oracle',
    enabled: true, testnet: false, color: '#0052ff'
  },
  {
    chainId: 10, key: 'optimism', name: 'Optimism', nativeToken: 'ETH',
    rpcs: ['https://optimism-rpc.publicnode.com', 'https://optimism.drpc.org', 'https://mainnet.optimism.io'],
    explorer: 'https://optimistic.etherscan.io', explorerTx: (h) => `https://optimistic.etherscan.io/tx/${h}`,
    protocols: ['aave-v3'], oracle: 'aave-oracle',
    enabled: true, testnet: false, color: '#ff0420'
  },
  {
    chainId: 43114, key: 'avalanche', name: 'Avalanche', nativeToken: 'AVAX',
    rpcs: ['https://avalanche-c-chain-rpc.publicnode.com', 'https://avalanche.drpc.org', 'https://api.avax.network/ext/bc/C/rpc'],
    explorer: 'https://snowtrace.io', explorerTx: (h) => `https://snowtrace.io/tx/${h}`,
    protocols: ['aave-v3'], oracle: 'aave-oracle',
    enabled: true, testnet: false, color: '#e84142'
  },
  {
    chainId: 59144, key: 'linea', name: 'Linea', nativeToken: 'ETH',
    rpcs: ['https://rpc.linea.build', 'https://linea.drpc.org'],
    explorer: 'https://lineascan.build', explorerTx: (h) => `https://lineascan.build/tx/${h}`,
    protocols: ['aave-v3'], oracle: 'aave-oracle',
    enabled: false, disabledReason: 'POOL_NOT_WIRED', testnet: false, color: '#61dfff'
  },
  {
    chainId: 146, key: 'sonic', name: 'Sonic', nativeToken: 'S',
    rpcs: ['https://rpc.soniclabs.com', 'https://sonic.drpc.org'],
    explorer: 'https://sonicscan.org', explorerTx: (h) => `https://sonicscan.org/tx/${h}`,
    protocols: ['aave-v3'], oracle: 'aave-oracle',
    enabled: false, disabledReason: 'POOL_NOT_WIRED', testnet: false, color: '#7b5cff'
  },
  {
    chainId: 900001, key: 'solana', name: 'Solana', nativeToken: 'SOL',
    rpcs: ['https://api.mainnet-beta.solana.com', 'https://solana-rpc.publicnode.com'],
    explorer: 'https://solscan.io', explorerTx: (h) => `https://solscan.io/tx/${h}`,
    protocols: ['solana-lending'], oracle: 'pyth',
    /* Phase 216 — enabled: the solana-lending adapter exists and is
       registered. Its pools come from the adapter's pool registry; with an
       empty registry every quote answers NO_POOL_REGISTERED (a code, never a
       fake success), so enabling the network advertises a real, refuse-
       honestly capability — not a dead end. */
    enabled: true, testnet: false, color: '#9945ff'
  }
]);

/** Networks the UI may render and the router may use, in display order. */
export function enabledNetworks() {
  return LENDING_NETWORKS.filter((n) => n.enabled === true);
}

export function networkFor(chainId) {
  return LENDING_NETWORKS.find((n) => Number(n.chainId) === Number(chainId)) ?? null;
}

export function isNetworkEnabled(chainId) {
  return networkFor(chainId)?.enabled === true;
}

/** Ordered RPC endpoints for a chain — the §26 failover list. */
export function rpcFallbackOrder(chainId) {
  return networkFor(chainId)?.rpcs ?? [];
}

/** Explorer URL for a transaction hash on a chain (null when unknown). */
export function txExplorerUrl(chainId, hash) {
  const network = networkFor(chainId);
  if (!network || !hash) return null;
  return network.explorerTx(String(hash));
}

/** The networks that BOTH exist in the registry AND are flagged on. */
export function lendingNetworkIds() {
  return enabledNetworks().map((n) => Number(n.chainId));
}
