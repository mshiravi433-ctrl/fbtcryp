/**
 * WEB3 DISCOVERY REGISTRY — curated, verified dApp directory for FBT Swap.
 *
 * Maintainable source of truth for the Explore > Discover tab. Each entry
 * carries the data the spec requires:
 *   name, official domain, category, supported chains, logo, description,
 *   docs, verification status and data-source reference.
 *
 * No TVL / volume is stored here — those arrive live from DefiLlama via
 * exploreApi.trending() / protocolList(). Fields that have no live source
 * render as N/A in the UI and never as zero.
 */

export const DISCOVERY_CATEGORIES = [
  { id: 'all', label: 'All', labelFa: 'همه' },
  { id: 'defi', label: 'DeFi', labelFa: 'دیفای' },
  { id: 'dex', label: 'DEX', labelFa: 'صرافی' },
  { id: 'lending', label: 'Lending', labelFa: 'وام‌دهی' },
  { id: 'yield', label: 'Yield', labelFa: 'سود' },
  { id: 'bridges', label: 'Bridges', labelFa: 'پل‌ها' },
  { id: 'analytics', label: 'Analytics', labelFa: 'تحلیل' },
  { id: 'rwa', label: 'RWA', labelFa: 'دارایی واقعی' },
  { id: 'nft', label: 'NFT', labelFa: 'NFT' },
  { id: 'dev', label: 'Developer Tools', labelFa: 'ابزار توسعه' },
];

export const NETWORK_FILTERS = [
  { id: 'all', label: 'All Networks', short: 'All', hue: '#7c4dff' },
  { id: 'bsc', label: 'BNB Smart Chain', short: 'BSC', chainId: 56, hue: '#f0b90b' },
  { id: 'eth', label: 'Ethereum', short: 'ETH', chainId: 1, hue: '#627eea' },
  { id: 'arbitrum', label: 'Arbitrum One', short: 'ARB', chainId: 42161, hue: '#28a0f0' },
  { id: 'base', label: 'Base', short: 'BASE', chainId: 8453, hue: '#0052ff' },
  { id: 'polygon', label: 'Polygon', short: 'POL', chainId: 137, hue: '#8247e5' },
  { id: 'optimism', label: 'Optimism', short: 'OP', chainId: 10, hue: '#ff0420' },
  { id: 'avalanche', label: 'Avalanche', short: 'AVAX', chainId: 43114, hue: '#e84142' },
  { id: 'sonic', label: 'Sonic', short: 'Sonic', chainId: 146, hue: '#fe9a4d' },
  { id: 'linea', label: 'Linea', short: 'Linea', chainId: 59144, hue: '#61dfff' },
  { id: 'solana', label: 'Solana', short: 'SOL', hue: '#9945ff' },
];

// Map network filter id -> possible chain names used in DefiLlama data
export const CHAIN_ALIASES = {
  bsc: ['bsc', 'bnb', 'binance', 'bnb smart chain'],
  eth: ['ethereum', 'eth'],
  arbitrum: ['arbitrum'],
  base: ['base'],
  polygon: ['polygon'],
  optimism: ['optimism'],
  avalanche: ['avalanche', 'avax'],
  sonic: ['sonic'],
  linea: ['linea'],
  solana: ['solana'],
};

/**
 * Curated protocol directory.
 * Every url is https and pinned to its official domain. Add only origins you
 * have verified yourself (see Discover.jsx header comment — same rule applies).
 *
 * Fields:
 *  id, name, domain, url, category, chains[], chainIds[], hue, description,
 *  docs, twitter, audits, auditLinks, verified, featured, dataSource, riskNote
 */
export const DISCOVERY_PROTOCOLS = [
  // ── DEX ──────────────────────────────────────────────────────────────
  {
    id: 'uniswap', name: 'Uniswap', domain: 'app.uniswap.org', url: 'https://app.uniswap.org',
    category: 'dex', chains: ['Ethereum','Arbitrum','Base','Polygon','Optimism'], chainIds: [1,42161,8453,137,10],
    hue: '#ff007a', description: 'The largest decentralized exchange on Ethereum and its L2s.', docs: 'https://docs.uniswap.org', twitter: 'https://twitter.com/Uniswap',
    audits: 4, auditLinks: ['https://docs.uniswap.org/protocol/reference/audits'], verified: true, featured: true, dataSource: 'defillama', slug: 'uniswap'
  },
  {
    id: 'pancakeswap', name: 'PancakeSwap', domain: 'pancakeswap.finance', url: 'https://pancakeswap.finance',
    category: 'dex', chains: ['BNB Smart Chain','Ethereum','Arbitrum','Base'], chainIds: [56,1,42161,8453],
    hue: '#d18800', description: 'Leading DEX on BNB Chain — swaps, liquidity and farms.', docs: 'https://docs.pancakeswap.finance', twitter: 'https://twitter.com/PancakeSwap',
    audits: 3, auditLinks: ['https://docs.pancakeswap.finance/code/security'], verified: true, featured: true, dataSource: 'defillama', slug: 'pancakeswap'
  },
  {
    id: 'curve', name: 'Curve Finance', domain: 'curve.fi', url: 'https://curve.fi',
    category: 'dex', chains: ['Ethereum','Arbitrum','Polygon','Avalanche'], chainIds: [1,42161,137,43114],
    hue: '#ff6d00', description: 'Efficient stablecoin and pegged-asset swapping at low slippage.', docs: 'https://docs.curve.fi', twitter: 'https://twitter.com/CurveFinance',
    audits: 5, auditLinks: ['https://curve.fi/audits'], verified: true, featured: false, dataSource: 'defillama', slug: 'curve-dex'
  },
  {
    id: 'balancer', name: 'Balancer', domain: 'balancer.fi', url: 'https://balancer.fi',
    category: 'dex', chains: ['Ethereum','Arbitrum','Base','Polygon'], chainIds: [1,42161,8453,137],
    hue: '#1e5af5', description: 'Programmable liquidity — custom pools and weighted portfolios.', docs: 'https://docs.balancer.fi', audits: 3, auditLinks: ['https://docs.balancer.fi/security/audits'], verified: true, featured: false, dataSource: 'defillama', slug: 'balancer'
  },
  {
    id: 'sushiswap', name: 'SushiSwap', domain: 'sushi.com', url: 'https://sushi.com',
    category: 'dex', chains: ['Ethereum','Arbitrum','Base','BSC'], chainIds: [1,42161,8453,56],
    hue: '#0e0f23', description: 'Multi-chain DEX with cross-chain swaps via SushiXSwap.', docs: 'https://docs.sushi.com', audits: 2, auditLinks: ['https://docs.sushi.com/security'], verified: true, featured: false, dataSource: 'defillama', slug: 'sushiswap'
  },
  {
    id: 'aerodrome', name: 'Aerodrome', domain: 'aerodrome.finance', url: 'https://aerodrome.finance',
    category: 'dex', chains: ['Base'], chainIds: [8453],
    hue: '#0052ff', description: 'Central liquidity hub on Base — ve(3,3) DEX.', docs: 'https://aerodrome.finance/docs', audits: 2, verified: true, featured: false, dataSource: 'defillama', slug: 'aerodrome'
  },
  {
    id: 'kyberswap', name: 'KyberSwap', domain: 'kyberswap.com', url: 'https://kyberswap.com',
    category: 'dex', chains: ['Ethereum','BSC','Arbitrum','Polygon','Avalanche'], chainIds: [1,56,42161,137,43114],
    hue: '#00ff9d', description: 'Multi-chain aggregator — finds best rates across DEXs.', docs: 'https://docs.kyberswap.com', audits: 2, verified: true, featured: false, dataSource: 'defillama', slug: 'kyberswap'
  },
  {
    id: 'oneinch', name: '1inch', domain: '1inch.io', url: 'https://1inch.io',
    category: 'dex', chains: ['Ethereum','BSC','Arbitrum','Polygon','Base'], chainIds: [1,56,42161,137,8453],
    hue: '#1140ff', description: 'DEX aggregator routing across hundreds of liquidity sources.', docs: 'https://docs.1inch.io', audits: 4, auditLinks: ['https://1inch.io/security'], verified: true, featured: true, dataSource: 'defillama', slug: '1inch-network'
  },

  // ── Lending ──────────────────────────────────────────────────────────
  {
    id: 'aave', name: 'Aave', domain: 'aave.com', url: 'https://aave.com',
    category: 'lending', chains: ['Ethereum','Arbitrum','Polygon','Base','Optimism','Avalanche'], chainIds: [1,42161,137,8453,10,43114],
    hue: '#b6509e', description: 'Leading lending protocol — supply, borrow and earn interest.', docs: 'https://docs.aave.com', twitter: 'https://twitter.com/aave',
    audits: 6, auditLinks: ['https://docs.aave.com/developers/security/audits'], verified: true, featured: true, dataSource: 'defillama', slug: 'aave'
  },
  {
    id: 'compound', name: 'Compound', domain: 'compound.finance', url: 'https://compound.finance',
    category: 'lending', chains: ['Ethereum','Arbitrum','Base','Polygon'], chainIds: [1,42161,8453,137],
    hue: '#00d395', description: 'Algorithmic money markets — borrow and lend at dynamic rates.', docs: 'https://docs.compound.finance', audits: 4, verified: true, featured: false, dataSource: 'defillama', slug: 'compound-v3'
  },
  {
    id: 'morpho', name: 'Morpho', domain: 'morpho.org', url: 'https://morpho.org',
    category: 'lending', chains: ['Ethereum','Base'], chainIds: [1,8453],
    hue: '#1a1aff', description: 'Permissionless lending with curated vaults and isolated markets.', docs: 'https://docs.morpho.org', audits: 5, auditLinks: ['https://docs.morpho.org/security/audits'], verified: true, featured: true, dataSource: 'defillama', slug: 'morpho'
  },
  {
    id: 'spark', name: 'Spark', domain: 'spark.fi', url: 'https://spark.fi',
    category: 'lending', chains: ['Ethereum'], chainIds: [1],
    hue: '#f5ac37', description: 'MakerDAO-aligned lending — DAI savings and borrowing.', docs: 'https://docs.spark.fi', audits: 3, verified: true, featured: false, dataSource: 'defillama', slug: 'spark'
  },
  {
    id: 'venus', name: 'Venus Protocol', domain: 'venus.io', url: 'https://venus.io',
    category: 'lending', chains: ['BNB Smart Chain'], chainIds: [56],
    hue: '#f0b90b', description: 'Lending and synthetic stablecoins on BSC.', docs: 'https://docs.venus.io', audits: 2, verified: true, featured: false, dataSource: 'defillama', slug: 'venus'
  },
  {
    id: 'kamino', name: 'Kamino Finance', domain: 'kamino.finance', url: 'https://kamino.finance',
    category: 'lending', chains: ['Solana'], chainIds: [],
    hue: '#8b5cf6', description: 'Automated vaults and lending on Solana.', docs: 'https://docs.kamino.finance', audits: 2, verified: true, featured: false, dataSource: 'defillama', slug: 'kamino'
  },

  // ── Yield ────────────────────────────────────────────────────────────
  {
    id: 'yearn', name: 'Yearn Finance', domain: 'yearn.fi', url: 'https://yearn.fi',
    category: 'yield', chains: ['Ethereum','Arbitrum','Base'], chainIds: [1,42161,8453],
    hue: '#0657f9', description: 'Yield aggregator — auto-compounding vaults across DeFi.', docs: 'https://docs.yearn.fi', audits: 5, verified: true, featured: false, dataSource: 'defillama', slug: 'yearn-finance'
  },
  {
    id: 'beefy', name: 'Beefy', domain: 'beefy.com', url: 'https://beefy.com',
    category: 'yield', chains: ['BSC','Ethereum','Arbitrum','Polygon','Base'], chainIds: [56,1,42161,137,8453],
    hue: '#ff4e28', description: 'Multi-chain yield optimizer — auto-compounding vaults.', docs: 'https://docs.beefy.finance', audits: 4, verified: true, featured: false, dataSource: 'defillama', slug: 'beefy'
  },
  {
    id: 'pendle', name: 'Pendle', domain: 'pendle.finance', url: 'https://pendle.finance',
    category: 'yield', chains: ['Ethereum','Arbitrum','BSC'], chainIds: [1,42161,56],
    hue: '#e843ff', description: 'Yield trading — tokenize and trade future yield.', docs: 'https://docs.pendle.finance', audits: 3, auditLinks: ['https://docs.pendle.finance/security/audits'], verified: true, featured: true, dataSource: 'defillama', slug: 'pendle'
  },
  {
    id: 'lido', name: 'Lido', domain: 'lido.fi', url: 'https://lido.fi',
    category: 'yield', chains: ['Ethereum'], chainIds: [1],
    hue: '#00a3ff', description: 'Liquid staking — stake ETH and keep liquidity via stETH.', docs: 'https://docs.lido.fi', audits: 6, verified: true, featured: true, dataSource: 'defillama', slug: 'lido'
  },
  {
    id: 'convex', name: 'Convex Finance', domain: 'convexfinance.com', url: 'https://convexfinance.com',
    category: 'yield', chains: ['Ethereum'], chainIds: [1],
    hue: '#ff3b30', description: 'Boosted rewards for Curve LPs — maximize CRV earnings.', docs: 'https://docs.convexfinance.com', audits: 3, verified: true, featured: false, dataSource: 'defillama', slug: 'convex-finance'
  },
  {
    id: 'jito', name: 'Jito', domain: 'jito.network', url: 'https://jito.network',
    category: 'yield', chains: ['Solana'], chainIds: [],
    hue: '#9945ff', description: 'Liquid staking and MEV rewards on Solana.', docs: 'https://docs.jito.network', audits: 2, verified: true, featured: false, dataSource: 'defillama', slug: 'jito'
  },

  // ── Bridges ──────────────────────────────────────────────────────────
  {
    id: 'stargate', name: 'Stargate', domain: 'stargate.finance', url: 'https://stargate.finance',
    category: 'bridges', chains: ['Ethereum','BSC','Arbitrum','Base','Polygon','Avalanche'], chainIds: [1,56,42161,8453,137,43114],
    hue: '#00d4ff', description: 'Omnichain liquidity transport — bridge assets across chains.', docs: 'https://stargate.finance/docs', audits: 3, verified: true, featured: false, dataSource: 'defillama', slug: 'stargate'
  },
  {
    id: 'across', name: 'Across', domain: 'across.to', url: 'https://across.to',
    category: 'bridges', chains: ['Ethereum','Arbitrum','Base','Optimism','Polygon'], chainIds: [1,42161,8453,10,137],
    hue: '#6b38ff', description: 'Fast, cheap cross-chain bridge powered by UMA oracles.', docs: 'https://docs.across.to', audits: 3, verified: true, featured: false, dataSource: 'defillama', slug: 'across'
  },
  {
    id: 'wormhole', name: 'Wormhole', domain: 'wormhole.com', url: 'https://wormhole.com',
    category: 'bridges', chains: ['Ethereum','BSC','Solana','Arbitrum','Base'], chainIds: [1,56,42161,8453],
    hue: '#003bff', description: 'Interoperability protocol — messaging and token bridges.', docs: 'https://docs.wormhole.com', audits: 4, verified: true, featured: false, dataSource: 'defillama', slug: 'wormhole'
  },
  {
    id: 'synapse', name: 'Synapse', domain: 'synapseprotocol.com', url: 'https://synapseprotocol.com',
    category: 'bridges', chains: ['Ethereum','BSC','Arbitrum','Polygon','Avalanche'], chainIds: [1,56,42161,137,43114],
    hue: '#ff5a00', description: 'Cross-chain bridge and swaps — move assets between networks.', docs: 'https://docs.synapseprotocol.com', audits: 2, verified: true, featured: false, dataSource: 'defillama', slug: 'synapse'
  },
  {
    id: 'hop', name: 'Hop Protocol', domain: 'hop.exchange', url: 'https://hop.exchange',
    category: 'bridges', chains: ['Ethereum','Arbitrum','Optimism','Base','Polygon'], chainIds: [1,42161,10,8453,137],
    hue: '#ff8ccf', description: 'Rollup-to-rollup bridge — fast L2 transfers.', docs: 'https://docs.hop.exchange', audits: 2, verified: true, featured: false, dataSource: 'defillama', slug: 'hop-protocol'
  },
  {
    id: 'layerzero', name: 'LayerZero', domain: 'layerzero.network', url: 'https://layerzero.network',
    category: 'bridges', chains: ['Ethereum','BSC','Arbitrum','Avalanche'], chainIds: [1,56,42161,43114],
    hue: '#2d1b69', description: 'Omnichain interoperability — messaging for cross-chain dApps.', docs: 'https://docs.layerzero.network', audits: 4, verified: true, featured: false, dataSource: 'defillama', slug: 'layerzero'
  },

  // ── Analytics ────────────────────────────────────────────────────────
  {
    id: 'defillama', name: 'DefiLlama', domain: 'defillama.com', url: 'https://defillama.com',
    category: 'analytics', chains: ['Ethereum','BSC','Arbitrum','Base','Polygon','Solana'], chainIds: [1,56,42161,8453,137],
    hue: '#7c4dff', description: 'TVL, revenue and bridge stats — open transparent DeFi data.', docs: 'https://defillama.com/docs/api', audits: null, verified: true, featured: true, dataSource: 'internal'
  },
  {
    id: 'dune', name: 'Dune Analytics', domain: 'dune.com', url: 'https://dune.com',
    category: 'analytics', chains: ['Ethereum','BSC','Arbitrum','Base','Solana'], chainIds: [],
    hue: '#ff6b35', description: 'Custom dashboards and queries over decoded blockchain data.', docs: 'https://docs.dune.com', audits: null, verified: true, featured: false, dataSource: 'internal'
  },
  {
    id: 'nansen', name: 'Nansen', domain: 'nansen.ai', url: 'https://nansen.ai',
    category: 'analytics', chains: ['Ethereum','BSC','Arbitrum','Polygon'], chainIds: [],
    hue: '#0a0e1a', description: 'Wallet labeling and smart-money tracking.', docs: 'https://docs.nansen.ai', audits: null, verified: true, featured: false, dataSource: 'internal'
  },
  {
    id: 'dexscreener', name: 'DEX Screener', domain: 'dexscreener.com', url: 'https://dexscreener.com',
    category: 'analytics', chains: ['Ethereum','BSC','Base','Solana','Arbitrum'], chainIds: [1,56,8453],
    hue: '#ffb300', description: 'Live charts and price tracker for DEX pairs.', docs: 'https://dexscreener.com/api', audits: null, verified: true, featured: true, dataSource: 'internal'
  },
  {
    id: 'coingecko', name: 'CoinGecko', domain: 'coingecko.com', url: 'https://www.coingecko.com',
    category: 'analytics', chains: ['Ethereum','BSC','Solana','Base'], chainIds: [],
    hue: '#00e5ff', description: 'Prices, market caps and volume for thousands of tokens.', docs: 'https://www.coingecko.com/en/api', audits: null, verified: true, featured: false, dataSource: 'internal'
  },
  {
    id: 'arkham', name: 'Arkham', domain: 'arkhamintelligence.com', url: 'https://arkhamintelligence.com',
    category: 'analytics', chains: ['Ethereum','BSC','Arbitrum'], chainIds: [],
    hue: '#1a1a2e', description: 'On-chain intelligence — entity-linked wallet tracking.', docs: 'https://arkhamintelligence.com/docs', audits: null, verified: true, featured: false, dataSource: 'internal'
  },
  {
    id: 'geckoterminal', name: 'GeckoTerminal', domain: 'geckoterminal.com', url: 'https://www.geckoterminal.com',
    category: 'analytics', chains: ['Ethereum','BSC','Base','Solana','Arbitrum'], chainIds: [1,56,8453],
    hue: '#00ff9d', description: 'Real-time DeFi pool charts from CoinGecko family.', docs: 'https://www.geckoterminal.com/api', audits: null, verified: true, featured: false, dataSource: 'internal'
  },

  // ── RWA ──────────────────────────────────────────────────────────────
  {
    id: 'ondo', name: 'Ondo Finance', domain: 'ondo.finance', url: 'https://ondo.finance',
    category: 'rwa', chains: ['Ethereum'], chainIds: [1],
    hue: '#0a4d8c', description: 'Tokenized US Treasuries and institutional-grade RWA.', docs: 'https://docs.ondo.finance', audits: 3, verified: true, featured: true, dataSource: 'defillama', slug: 'ondo-finance'
  },
  {
    id: 'centrifuge', name: 'Centrifuge', domain: 'centrifuge.io', url: 'https://centrifuge.io',
    category: 'rwa', chains: ['Ethereum'], chainIds: [1],
    hue: '#082037', description: 'Real-world asset financing on-chain — invoices to pools.', docs: 'https://docs.centrifuge.io', audits: 3, verified: true, featured: false, dataSource: 'defillama', slug: 'centrifuge'
  },
  {
    id: 'maple', name: 'Maple Finance', domain: 'maple.finance', url: 'https://maple.finance',
    category: 'rwa', chains: ['Ethereum'], chainIds: [1],
    hue: '#4a00e0', description: 'Institutional lending pools backed by real-world collateral.', docs: 'https://docs.maple.finance', audits: 3, verified: true, featured: false, dataSource: 'defillama', slug: 'maple'
  },
  {
    id: 'goldfinch', name: 'Goldfinch', domain: 'goldfinch.finance', url: 'https://goldfinch.finance',
    category: 'rwa', chains: ['Ethereum'], chainIds: [1],
    hue: '#c19a5b', description: 'Decentralized credit for real-world businesses.', docs: 'https://docs.goldfinch.finance', audits: 2, verified: true, featured: false, dataSource: 'defillama', slug: 'goldfinch'
  },
  {
    id: 'backed', name: 'Backed Finance', domain: 'backed.fi', url: 'https://backed.fi',
    category: 'rwa', chains: ['Ethereum','Base'], chainIds: [1,8453],
    hue: '#0d7377', description: 'Tokenized stocks and ETFs — bTokens backed 1:1.', docs: 'https://docs.backed.fi', audits: 2, verified: true, featured: false, dataSource: 'defillama', slug: 'backed'
  },

  // ── NFT ──────────────────────────────────────────────────────────────
  {
    id: 'opensea', name: 'OpenSea', domain: 'opensea.io', url: 'https://opensea.io',
    category: 'nft', chains: ['Ethereum','Polygon','Base','Arbitrum'], chainIds: [1,137,8453,42161],
    hue: '#2081e2', description: 'Largest NFT marketplace across multiple networks.', docs: 'https://docs.opensea.io', audits: 2, verified: true, featured: true, dataSource: 'internal'
  },
  {
    id: 'blur', name: 'Blur', domain: 'blur.io', url: 'https://blur.io',
    category: 'nft', chains: ['Ethereum'], chainIds: [1],
    hue: '#ff6d00', description: 'Professional NFT marketplace focused on speed and pro trading.', docs: 'https://docs.blur.io', audits: 1, verified: true, featured: false, dataSource: 'internal'
  },
  {
    id: 'magiceden', name: 'Magic Eden', domain: 'magiceden.io', url: 'https://magiceden.io',
    category: 'nft', chains: ['Solana','Ethereum','Base'], chainIds: [],
    hue: '#e6007e', description: 'Multi-chain NFT marketplace — strongest on Solana and Bitcoin.', docs: 'https://docs.magiceden.io', audits: 1, verified: true, featured: false, dataSource: 'internal'
  },
  {
    id: 'tensor', name: 'Tensor', domain: 'tensor.trade', url: 'https://tensor.trade',
    category: 'nft', chains: ['Solana'], chainIds: [],
    hue: '#00ff99', description: 'Pro NFT trading on Solana — fastest aggregator.', docs: 'https://docs.tensor.trade', audits: 1, verified: true, featured: false, dataSource: 'internal'
  },
  {
    id: 'element', name: 'Element', domain: 'element.market', url: 'https://element.market',
    category: 'nft', chains: ['Ethereum','BSC'], chainIds: [1,56],
    hue: '#7c4dff', description: 'Multi-chain NFT marketplace with EVM support.', docs: 'https://docs.element.market', audits: 1, verified: true, featured: false, dataSource: 'internal'
  },
  {
    id: 'looksrare', name: 'LooksRare', domain: 'looksrare.org', url: 'https://looksrare.org',
    category: 'nft', chains: ['Ethereum'], chainIds: [1],
    hue: '#00ff9d', description: 'Community-first NFT marketplace with rewards.', docs: 'https://docs.looksrare.org', audits: 2, verified: true, featured: false, dataSource: 'defillama', slug: 'looksrare'
  },

  // ── Developer Tools ─────────────────────────────────────────────────
  {
    id: 'etherscan', name: 'Etherscan', domain: 'etherscan.io', url: 'https://etherscan.io',
    category: 'dev', chains: ['Ethereum'], chainIds: [1],
    hue: '#21325b', description: 'Ethereum block explorer — verify contracts and transactions.', docs: 'https://docs.etherscan.io', audits: null, verified: true, featured: true, dataSource: 'internal'
  },
  {
    id: 'bscscan', name: 'BscScan', domain: 'bscscan.com', url: 'https://bscscan.com',
    category: 'dev', chains: ['BNB Smart Chain'], chainIds: [56],
    hue: '#f0b90b', description: 'BNB Chain explorer — addresses, transactions and tokens.', docs: 'https://docs.bscscan.com', audits: null, verified: true, featured: false, dataSource: 'internal'
  },
  {
    id: 'arbiscan', name: 'Arbiscan', domain: 'arbiscan.io', url: 'https://arbiscan.io',
    category: 'dev', chains: ['Arbitrum One'], chainIds: [42161],
    hue: '#28a0f0', description: 'Arbitrum explorer — from the Etherscan family.', docs: 'https://docs.arbiscan.io', audits: null, verified: true, featured: false, dataSource: 'internal'
  },
  {
    id: 'alchemy', name: 'Alchemy', domain: 'alchemy.com', url: 'https://alchemy.com',
    category: 'dev', chains: ['Ethereum','Polygon','Arbitrum','Base','Optimism'], chainIds: [1,137,42161,8453,10],
    hue: '#0a0a2a', description: 'Web3 developer platform — nodes, APIs and tooling.', docs: 'https://docs.alchemy.com', audits: null, verified: true, featured: false, dataSource: 'internal'
  },
  {
    id: 'chainlink', name: 'Chainlink', domain: 'chain.link', url: 'https://chain.link',
    category: 'dev', chains: ['Ethereum','BSC','Arbitrum','Polygon'], chainIds: [1,56,42161,137],
    hue: '#375bd2', description: 'Decentralized oracle network — price feeds and automation.', docs: 'https://docs.chain.link', audits: 3, verified: true, featured: false, dataSource: 'internal'
  },
  {
    id: 'thegraph', name: 'The Graph', domain: 'thegraph.com', url: 'https://thegraph.com',
    category: 'dev', chains: ['Ethereum','Polygon','Arbitrum'], chainIds: [1,137,42161],
    hue: '#6747ed', description: 'Indexing protocol for blockchain data — subgraphs for dApps.', docs: 'https://thegraph.com/docs', audits: 2, verified: true, featured: false, dataSource: 'internal'
  },
  {
    id: 'tenderly', name: 'Tenderly', domain: 'tenderly.co', url: 'https://tenderly.co',
    category: 'dev', chains: ['Ethereum','BSC','Polygon','Arbitrum'], chainIds: [1,56,137,42161],
    hue: '#ff2d95', description: 'Smart contract monitoring, debugging and simulation.', docs: 'https://docs.tenderly.co', audits: null, verified: true, featured: false, dataSource: 'internal'
  },
  {
    id: 'thirdweb', name: 'Thirdweb', domain: 'thirdweb.com', url: 'https://thirdweb.com',
    category: 'dev', chains: ['Ethereum','Polygon','Base','Arbitrum'], chainIds: [1,137,8453,42161],
    hue: '#f213a4', description: 'Full-stack Web3 development — SDKs, contracts and dashboards.', docs: 'https://portal.thirdweb.com', audits: null, verified: true, featured: false, dataSource: 'internal'
  },
  {
    id: 'l2beat', name: 'L2BEAT', domain: 'l2beat.com', url: 'https://l2beat.com',
    category: 'dev', chains: ['Ethereum'], chainIds: [1],
    hue: '#00e5ff', description: 'L2 risk and TVL analytics — transparent layer-2 data.', docs: 'https://l2beat.com/api', audits: null, verified: true, featured: false, dataSource: 'internal'
  },
];

export const CATEGORY_MAP = Object.fromEntries(DISCOVERY_CATEGORIES.map(c => [c.id, c]));

/**
 * Resolve a protocol's official domain to a favicon URL via Google's favicon service.
 */
export function faviconFor(domain, size = 64) {
  if (!domain) return null;
  const host = String(domain).replace(/^www\./, '');
  return `https://www.google.com/s2/favicons?sz=${size}&domain=${encodeURIComponent(host)}`;
}

/**
 * Host helper — strips www and lowercases.
 */
export function hostOf(url) {
  try { return new URL(url).host.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}

/**
 * Find a registry entry by id or domain.
 */
export function findProtocol(idOrDomain) {
  const needle = String(idOrDomain || '').toLowerCase().trim();
  if (!needle) return null;
  return DISCOVERY_PROTOCOLS.find(p => p.id === needle || p.domain === needle || hostOf(p.url) === needle) || null;
}
