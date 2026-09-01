/**
 * Lightweight chain + token registry for server-side use.
 *
 * Duplicates the curated subset of src/lib/chains.js that server routes need
 * (native coin metadata, per-chain token list, explorer base URLs) so the
 * server never imports code that references `import.meta.env` (a Vite-ism
 * unavailable under Node). Keep this list in sync with src/lib/chains.js when
 * adding new chains or well-known tokens.
 */

/*
 * RPC ENDPOINT FALLBACKS
 * ---------------------------------------------------------------------------
 * Each chain lists MORE THAN ONE public endpoint, tried in order. A single
 * public RPC is a single point of failure: when that one host rate-limits
 * (429) or drops, `eth_blockNumber`/`eth_getLogs` throw and the WHOLE chain
 * disappears from the whale feed and the liquidity scanner — which is how
 * «خیلی از داده‌های صفحهٔ پول هوشمند کار نمی‌کند» happened in the field.
 * With a fallback list, one dead host costs us nothing: the next endpoint
 * answers and the chain stays in the feed.
 *
 * All entries are long-lived, keyless public endpoints (official chain
 * endpoints first, then PublicNode and dRPC). Adding a new chain? Add at
 * least two endpoints, official first.
 */
export const EVM_CHAINS = {
  56: {
    id: 56, short: 'BSC', name: 'BNB Smart Chain',
    native: { symbol: 'BNB', decimals: 18, coingeckoId: 'binancecoin' },
    rpc: ['https://bsc-rpc.publicnode.com', 'https://bsc.drpc.org', 'https://binance.llamarpc.com'],
    explorer: 'https://bscscan.com',
    color: '#f0b90b'
  },
  1: {
    id: 1, short: 'ETH', name: 'Ethereum',
    native: { symbol: 'ETH', decimals: 18, coingeckoId: 'ethereum' },
    rpc: ['https://eth.llamarpc.com', 'https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org'],
    explorer: 'https://etherscan.io',
    color: '#627eea'
  },
  137: {
    id: 137, short: 'POL', name: 'Polygon',
    native: { symbol: 'POL', decimals: 18, coingeckoId: 'matic-network' },
    rpc: ['https://polygon-rpc.com', 'https://polygon-bor-rpc.publicnode.com', 'https://polygon.drpc.org'],
    explorer: 'https://polygonscan.com',
    color: '#8247e5'
  },
  42161: {
    id: 42161, short: 'ARB', name: 'Arbitrum One',
    native: { symbol: 'ETH', decimals: 18, coingeckoId: 'ethereum' },
    rpc: ['https://arb1.arbitrum.io/rpc', 'https://arbitrum-one-rpc.publicnode.com', 'https://arbitrum.drpc.org'],
    explorer: 'https://arbiscan.io',
    color: '#28a0f0'
  },
  8453: {
    id: 8453, short: 'BASE', name: 'Base',
    native: { symbol: 'ETH', decimals: 18, coingeckoId: 'ethereum' },
    rpc: ['https://mainnet.base.org', 'https://base-rpc.publicnode.com', 'https://base.drpc.org'],
    explorer: 'https://basescan.org',
    color: '#0052ff'
  },
  10: {
    id: 10, short: 'OP', name: 'Optimism',
    native: { symbol: 'ETH', decimals: 18, coingeckoId: 'ethereum' },
    rpc: ['https://mainnet.optimism.io', 'https://optimism-rpc.publicnode.com', 'https://optimism.drpc.org'],
    explorer: 'https://optimistic.etherscan.io',
    color: '#ff0420'
  },
  43114: {
    id: 43114, short: 'AVAX', name: 'Avalanche',
    native: { symbol: 'AVAX', decimals: 18, coingeckoId: 'avalanche-2' },
    rpc: ['https://api.avax.network/ext/bc/C/rpc', 'https://avalanche-c-chain-rpc.publicnode.com', 'https://avalanche.drpc.org'],
    explorer: 'https://snowtrace.io',
    color: '#e84142'
  }
};

export const EVM_CHAIN_ORDER = [56, 1, 137, 42161, 8453, 10, 43114];

const T = (symbol, name, address, decimals, coingeckoId, extra = {}) => ({
  symbol, name, address: address ? address.toLowerCase() : null,
  decimals, coingeckoId, native: !!extra.native, verified: true
});

export const TOKENS = {
  1: [
    T('ETH', 'Ethereum', null, 18, 'ethereum', { native: true }),
    T('USDT', 'Tether USD', '0xdAC17F958D2ee523a2206206994597C13D831ec7', 6, 'tether'),
    T('USDC', 'USD Coin', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 6, 'usd-coin'),
    T('DAI', 'Dai', '0x6B175474E89094C44Da98b954EedeAC495271d0F', 18, 'dai'),
    T('WBTC', 'Wrapped Bitcoin', '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', 8, 'bitcoin'),
    T('stETH', 'Lido Staked ETH', '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84', 18, 'staked-ether')
  ],
  56: [
    T('BNB', 'BNB', null, 18, 'binancecoin', { native: true }),
    T('USDT', 'Tether USD', '0x55d398326f99059fF775485246999027B3197955', 18, 'tether'),
    T('USDC', 'USD Coin', '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', 18, 'usd-coin'),
    T('CAKE', 'PancakeSwap', '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', 18, 'pancakeswap-token'),
    T('BTCB', 'Bitcoin BEP20', '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c', 18, 'bitcoin')
  ],
  137: [
    T('POL', 'Polygon', null, 18, 'matic-network', { native: true }),
    T('USDT', 'Tether USD', '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', 6, 'tether'),
    T('USDC', 'USD Coin', '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', 6, 'usd-coin'),
    T('WETH', 'Wrapped Ether', '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', 18, 'ethereum')
  ],
  42161: [
    T('ETH', 'Ethereum', null, 18, 'ethereum', { native: true }),
    T('USDT', 'Tether USD', '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', 6, 'tether'),
    T('USDC', 'USD Coin', '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', 6, 'usd-coin'),
    T('ARB', 'Arbitrum', '0x912CE59144191C1204E64559FE8253a0e49E6548', 18, 'arbitrum')
  ],
  8453: [
    T('ETH', 'Ethereum', null, 18, 'ethereum', { native: true }),
    T('USDC', 'USD Coin', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 6, 'usd-coin')
  ],
  10: [
    T('ETH', 'Ethereum', null, 18, 'ethereum', { native: true }),
    T('USDT', 'Tether USD', '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', 6, 'tether'),
    T('USDC', 'USD Coin', '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', 6, 'usd-coin'),
    T('OP', 'Optimism', '0x4200000000000000000000000000000000000042', 18, 'optimism')
  ],
  43114: [
    T('AVAX', 'Avalanche', null, 18, 'avalanche-2', { native: true }),
    T('USDT', 'Tether USD', '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7', 6, 'tether'),
    T('USDC', 'USD Coin', '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', 6, 'usd-coin')
  ]
};
