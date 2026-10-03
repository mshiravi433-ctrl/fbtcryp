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
    color: '#f0b90b',
    router: '0x10ED43C718714eb63d5aA57B78B54704E256024E', // PancakeSwap V2
    wrapped: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB
    dexName: 'PancakeSwap'
  },
  1: {
    id: 1, short: 'ETH', name: 'Ethereum',
    native: { symbol: 'ETH', decimals: 18, coingeckoId: 'ethereum' },
    rpc: ['https://eth.llamarpc.com', 'https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org'],
    explorer: 'https://etherscan.io',
    color: '#627eea',
    router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', // Uniswap V2
    wrapped: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
    dexName: 'Uniswap'
  },
  137: {
    id: 137, short: 'POL', name: 'Polygon',
    native: { symbol: 'POL', decimals: 18, coingeckoId: 'matic-network' },
    rpc: ['https://polygon-rpc.com', 'https://polygon-bor-rpc.publicnode.com', 'https://polygon.drpc.org'],
    explorer: 'https://polygonscan.com',
    color: '#8247e5',
    router: '0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff', // QuickSwap
    wrapped: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', // WMATIC
    dexName: 'QuickSwap'
  },
  42161: {
    id: 42161, short: 'ARB', name: 'Arbitrum One',
    native: { symbol: 'ETH', decimals: 18, coingeckoId: 'ethereum' },
    rpc: ['https://arb1.arbitrum.io/rpc', 'https://arbitrum-one-rpc.publicnode.com', 'https://arbitrum.drpc.org'],
    explorer: 'https://arbiscan.io',
    color: '#28a0f0',
    router: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506', // SushiSwap
    wrapped: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // WETH
    dexName: 'SushiSwap'
  },
  8453: {
    id: 8453, short: 'BASE', name: 'Base',
    native: { symbol: 'ETH', decimals: 18, coingeckoId: 'ethereum' },
    rpc: ['https://mainnet.base.org', 'https://base-rpc.publicnode.com', 'https://base.drpc.org'],
    explorer: 'https://basescan.org',
    color: '#0052ff',
    router: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24', // Uniswap V2 on Base
    wrapped: '0x4200000000000000000000000000000000000006', // WETH
    dexName: 'Uniswap'
  },
  10: {
    id: 10, short: 'OP', name: 'Optimism',
    native: { symbol: 'ETH', decimals: 18, coingeckoId: 'ethereum' },
    rpc: ['https://mainnet.optimism.io', 'https://optimism-rpc.publicnode.com', 'https://optimism.drpc.org'],
    explorer: 'https://optimistic.etherscan.io',
    color: '#ff0420',
    router: '0x9c12939390052919aF3155f41Bf4160Fd3666A6f', // Velodrome-compatible
    wrapped: '0x4200000000000000000000000000000000000006', // WETH
    dexName: 'Velodrome'
  },
  43114: {
    id: 43114, short: 'AVAX', name: 'Avalanche',
    native: { symbol: 'AVAX', decimals: 18, coingeckoId: 'avalanche-2' },
    rpc: ['https://api.avax.network/ext/bc/C/rpc', 'https://avalanche-c-chain-rpc.publicnode.com', 'https://avalanche.drpc.org'],
    explorer: 'https://snowtrace.io',
    color: '#e84142',
    router: '0x60aE616a2155Ee3d9A68541Ba4544862310933d4', // TraderJoe
    wrapped: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7', // WAVAX
    dexName: 'Trader Joe'
  },
  /*
   * Linea and Sonic mirror src/lib/chains.js — the same two chains the swap
   * layer routes through KyberSwap. They were absent here only because the
   * server feeds (whales, liquidity scanner) had not needed them yet; the
   * explorer and the approval scanner read the full nine, so this registry
   * now matches the client one. Keep them in sync when either changes.
   */
  59144: {
    id: 59144, short: 'LINEA', name: 'Linea',
    native: { symbol: 'ETH', decimals: 18, coingeckoId: 'ethereum' },
    rpc: ['https://rpc.linea.build', 'https://linea-rpc.publicnode.com', 'https://linea.drpc.org'],
    explorer: 'https://lineascan.build',
    color: '#61dfff',
    router: '0x80e38291e06339d10AAB483C65695D004dBD5C69', // SyncSwap V2-compatible
    wrapped: '0xe5D7C2a44FfDDf6b295A15c148167daaAf5Cf34f', // WETH
    dexName: 'KyberSwap'
  },
  146: {
    id: 146, short: 'S', name: 'Sonic',
    native: { symbol: 'S', decimals: 18, coingeckoId: 'sonic-3' },
    rpc: ['https://rpc.soniclabs.com', 'https://sonic-rpc.publicnode.com', 'https://sonic.drpc.org'],
    explorer: 'https://sonicscan.org',
    color: '#fe9a4d',
    router: '0x1D368773735ee1E678950B7A97bcA2CafB330CDc',
    wrapped: '0x039e2fB66102314Ce7b64Ce5Ce3E5183bc94aD38', // wS
    dexName: 'KyberSwap'
  },
  /*
   * ─── NEW EVM CHAINS ADDED 2026-09 ─────────────────────────────────────────
   * Mantle, Berachain, Unichain, Monad, Scroll, zkSync Era, Robinhood Chain
   * All verified against official chain documentation and live RPC endpoints.
   */
  5000: {
    id: 5000, short: 'MNT', name: 'Mantle',
    native: { symbol: 'MNT', decimals: 18, coingeckoId: 'mantle' },
    rpc: ['https://rpc.mantle.xyz', 'https://mantle-rpc.publicnode.com', 'https://mantle.drpc.org'],
    explorer: 'https://explorer.mantle.xyz',
    color: '#f0b90b',
    router: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
    wrapped: '0x78c1b0C915c4FAA5FffA6CAbf0219DA63d7f4cb8',
    dexName: 'LI.FI'
  },
  80094: {
    id: 80094, short: 'BERA', name: 'Berachain',
    native: { symbol: 'BERA', decimals: 18, coingeckoId: 'berachain' },
    rpc: ['https://rpc.berachain.com', 'https://berachain-rpc.publicnode.com', 'https://berachain.drpc.org'],
    explorer: 'https://berascan.com',
    color: '#a855f7',
    router: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
    wrapped: '0x6969696969696969696969696969696969696969',
    dexName: 'KyberSwap'
  },
  130: {
    id: 130, short: 'UNI', name: 'Unichain',
    native: { symbol: 'ETH', decimals: 18, coingeckoId: 'ethereum' },
    rpc: ['https://mainnet.unichain.org', 'https://unichain.llamarpc.com', 'https://unichain.drpc.org'],
    explorer: 'https://uniscan.xyz',
    color: '#ff007a',
    router: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
    wrapped: '0x4200000000000000000000000000000000000006',
    dexName: 'KyberSwap'
  },
  143: {
    id: 143, short: 'MON', name: 'Monad',
    native: { symbol: 'MON', decimals: 18, coingeckoId: 'monad' },
    rpc: ['https://rpc.monad.xyz', 'https://monad-rpc.publicnode.com', 'https://monad.drpc.org'],
    explorer: 'https://monadvision.com',
    color: '#7c3aed',
    router: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
    wrapped: '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A',
    dexName: 'KyberSwap'
  },
  534352: {
    id: 534352, short: 'SCR', name: 'Scroll',
    native: { symbol: 'ETH', decimals: 18, coingeckoId: 'ethereum' },
    rpc: ['https://rpc.scroll.io', 'https://scroll-rpc.publicnode.com', 'https://scroll.drpc.org'],
    explorer: 'https://scrollscan.com',
    color: '#f1c27d',
    router: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
    wrapped: '0x5300000000000000000000000000000000000004',
    dexName: 'LI.FI'
  },
  324: {
    id: 324, short: 'ZK', name: 'zkSync Era',
    native: { symbol: 'ETH', decimals: 18, coingeckoId: 'ethereum' },
    rpc: ['https://mainnet.era.zksync.io', 'https://zksync.drpc.org', 'https://zksync-era-rpc.publicnode.com'],
    explorer: 'https://era.zksync.network',
    color: '#8c8dfc',
    router: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
    wrapped: '0x5aea5775959fbc2557cc8789bc1bf90a239d9a91',
    dexName: 'LI.FI'
  },
  4663: {
    id: 4663, short: 'HOOD', name: 'Robinhood Chain',
    native: { symbol: 'ETH', decimals: 18, coingeckoId: 'ethereum' },
    rpc: ['https://rpc.mainnet.chain.robinhood.com', 'https://robinhood-rpc.publicnode.com'],
    explorer: 'https://robinhoodchain.blockscout.com',
    color: '#00c805',
    router: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
    wrapped: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
    dexName: 'KyberSwap'
  }
};

export const EVM_CHAIN_ORDER = [56, 1, 137, 42161, 8453, 10, 43114, 59144, 146, 5000, 80094, 130, 143, 534352, 324, 4663];

/**
 * Solana — the one non-EVM network with first-class reads in the explorer.
 * A single public RPC is used for balance/token-account reads only; nothing
 * is ever signed or broadcast through it. Rate limits degrade the feature to
 * "unavailable", never to fake zeros.
 */
export const SOLANA = {
  id: 'solana',
  name: 'Solana',
  short: 'SOL',
  native: { symbol: 'SOL', decimals: 9, coingeckoId: 'solana' },
  rpc: String(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'),
  explorer: 'https://solscan.io',
  color: '#9945ff',
  tokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
};

export const SOLANA_CHAINS = { solana: SOLANA };

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
  ],
  59144: [
    T('ETH', 'Ethereum', null, 18, 'ethereum', { native: true }),
    T('USDC', 'USD Coin', '0x176211869cA2b568f2A7D4EE941E073a821EE1ff', 6, 'usd-coin'),
    T('USDT', 'Tether USD', '0xA219439258ca9da29E9Cc4cE5596924745e12B93', 6, 'tether'),
    T('WETH', 'Wrapped Ether', '0xe5D7C2a44FfDDf6b295A15c148167daaAf5Cf34f', 18, 'ethereum')
  ],
  146: [
    T('S', 'Sonic', null, 18, 'sonic-3', { native: true }),
    T('USDC', 'USD Coin', '0x29219dd400f2Bf60E5a23d13Be72B486D4038894', 6, 'usd-coin'),
    T('wS', 'Wrapped Sonic', '0x039e2fB66102314Ce7b64Ce5Ce3E5183bc94aD38', 18, 'sonic-3'),
    T('stS', 'Staked Sonic', '0xE5DA20F15420aD15DE0fa650600aFc998bbE3955', 18, 'sonic-3')
  ],
  5000: [
    T('MNT', 'Mantle', null, 18, 'mantle', { native: true }),
    T('WMNT', 'Wrapped Mantle', '0x78c1b0C915c4FAA5FffA6CAbf0219DA63d7f4cb8', 18, 'mantle'),
    T('USDT', 'Tether USD', '0x201EBa5CC46D216Ce6DC03F6a759e8E766e956aE', 6, 'tether'),
    T('USDC', 'USD Coin', '0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9', 6, 'usd-coin'),
    T('WETH', 'Wrapped Ether', '0xdeaddeaddeaddeaddeaddeaddeaddeaddead1111', 18, 'ethereum')
  ],
  80094: [
    T('BERA', 'Berachain', null, 18, 'berachain', { native: true }),
    T('WBERA', 'Wrapped BERA', '0x6969696969696969696969696969696969696969', 18, 'berachain'),
    T('WETH', 'Wrapped Ether', '0x2F6F07CDcf3588944Bf4C42aC74ff24bF56e7590', 18, 'ethereum'),
    T('USDC', 'USD Coin', '0x549943e04f40284185054145c6E4e9568C1D3241', 6, 'usd-coin'),
    T('HONEY', 'Honey', '0xfcbd14dc51f0a4d49d5e53c2e0950e0bc26d0dce', 18, 'honey'),
    T('WBTC', 'Wrapped Bitcoin', '0x0555E30da8f98308EdB960aa94C0Db47230d2B9c', 8, 'bitcoin')
  ],
  130: [
    T('ETH', 'Ethereum', null, 18, 'ethereum', { native: true }),
    T('WETH', 'Wrapped Ether', '0x4200000000000000000000000000000000000006', 18, 'ethereum'),
    T('USDC', 'USD Coin', '0x078D782b760474a361dDA0AF3839290b0EF57AD6', 6, 'usd-coin')
  ],
  143: [
    T('MON', 'Monad', null, 18, 'monad', { native: true }),
    T('WMON', 'Wrapped MON', '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A', 18, 'monad'),
    T('USDC', 'USD Coin', '0x754704Bc059F8c67012feD69BC8a327a5aafb603', 6, 'usd-coin'),
    T('WETH', 'Wrapped Ether', '0xEe8C0E9f1bFfB4Eb878d8f15f368a02A35481242', 18, 'ethereum')
  ],
  534352: [
    T('ETH', 'Ethereum', null, 18, 'ethereum', { native: true }),
    T('WETH', 'Wrapped Ether', '0x5300000000000000000000000000000000000004', 18, 'ethereum'),
    T('USDC', 'USD Coin', '0x06efdbff2a14a7c8e15944d1f4a48f9f95f663a4', 6, 'usd-coin'),
    T('USDT', 'Tether USD', '0xf55bec9cafdbe8730f096aa55dad6d22d44099df', 6, 'tether'),
    T('ZK', 'ZKsync', '0x5A7d6b2F92C77FAD6CCaBd7EE0624E64907Eaf3E', 18, 'zksync')
  ],
  324: [
    T('ETH', 'Ethereum', null, 18, 'ethereum', { native: true }),
    T('WETH', 'Wrapped Ether', '0x5aea5775959fbc2557cc8789bc1bf90a239d9a91', 18, 'ethereum'),
    T('USDC', 'USD Coin', '0x1d17cbcf0d6d143135ae902365d2e5e2a16538d4', 6, 'usd-coin'),
    T('USDT', 'Tether USD', '0x493257fD37EDB34451f62EDf8D2a0C418852bA4C', 6, 'tether'),
    T('DAI', 'Dai', '0x4b9eb6c0b6ea15176bbf62841c6b2a8a398cb656', 18, 'zksync-erc20-bridged-dai-zksync'),
    T('ZK', 'ZKsync', '0x5A7d6b2F92C77FAD6CCaBd7EE0624E64907Eaf3E', 18, 'zksync')
  ],
  4663: [
    T('ETH', 'Ethereum', null, 18, 'ethereum', { native: true }),
    T('WETH', 'Wrapped Ether', '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73', 18, 'ethereum'),
    T('USDG', 'Global Dollar', '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168', 6, 'global-dollar')
  ]
};
