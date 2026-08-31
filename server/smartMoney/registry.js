/**
 * CURATED ON-CHAIN ADDRESS REGISTRY
 * ---------------------------------------------------------------------------
 * Three labelled address classes, every row carrying a `source` and a
 * `confidence` so nothing is presented as more certain than it is:
 *
 *   1. EXCHANGE WALLETS (CEX hot/cold wallets). These are the ONLY addresses
 *      we ever label as exchange inflow/outflow. They are taken from the
 *      exchanges' own public disclosures and the persistent name-tags on the
 *      major block explorers (Etherscan/BscScan/Polygonscan name-tags). We do
 *      NOT infer an exchange from heuristics. An unlabelled counterparty stays
 *      "Unknown" — the exact discipline of server/whales.js.
 *
 *   2. DEX ROUTERS / AGGREGATORS. A transfer whose counterparty is a known
 *      router in the same tx as a swap is classified as DEX buy/sell flow.
 *
 *   3. DEX FACTORIES + event topics. Used to detect liquidity events
 *      (LP added / removed / pool created / pool drained) from real logs.
 *
 * Confidence levels:
 *   'high'   — officially disclosed or persistent verified explorer name-tag
 *   'medium' — widely documented but not re-verified by an exchange page
 *
 * To extend: add rows here. Never fabricate an address to make a stat look
 * bigger — a wrong label turns an honest flow chart into a misleading one.
 */

/* A `chain` of -1 means "address on every EVM chain at the same deploy" (some
   routers and factories share addresses across chains). Solana is 'solana'. */

export const EXCHANGE_WALLETS = [
  /* ── Ethereum (1) ── */
  { chain: 1, address: '0x28c6c06298d514db089934071355e5743bf21d60', exchange: 'Binance', label: 'Binance 14 Hot Wallet', source: 'etherscan-nametag', confidence: 'high' },
  { chain: 1, address: '0x21a31ee1afc51d94c2efccaa2092ad1028285549', exchange: 'Binance', label: 'Binance 7 Hot Wallet', source: 'etherscan-nametag', confidence: 'high' },
  { chain: 1, address: '0xdfd5293d8e347dfe59e90efd55b2956a1343963d', exchange: 'Binance', label: 'Binance 16 Hot Wallet', source: 'etherscan-nametag', confidence: 'high' },
  { chain: 1, address: '0xf977814e90da44bfa03b6295a0616a897441acec', exchange: 'Binance', label: 'Binance 8 Hot Wallet', source: 'etherscan-nametag', confidence: 'high' },
  { chain: 1, address: '0x56eddb7aa87536c09ccc2793473599fd21a8b17f', exchange: 'Binance', label: 'Binance Cold Wallet', source: 'etherscan-nametag', confidence: 'medium' },
  { chain: 1, address: '0x503828976d22510a86e57001a05606c71022b16e', exchange: 'Coinbase', label: 'Coinbase Hot Wallet', source: 'etherscan-nametag', confidence: 'high' },
  { chain: 1, address: '0xddfabcdc4d8ffc6d5beaf154f18b778f892a0740', exchange: 'Coinbase', label: 'Coinbase 2 Hot Wallet', source: 'etherscan-nametag', confidence: 'high' },
  { chain: 1, address: '0x71660c4005ba85c37ccec55d7d9e6695f1c0e301', exchange: 'Coinbase', label: 'Coinbase Wallet', source: 'etherscan-nametag', confidence: 'medium' },
  { chain: 1, address: '0x2910543af39aba0cd09dbb2d50200b3e800a63d2', exchange: 'Kraken', label: 'Kraken 5 Hot Wallet', source: 'etherscan-nametag', confidence: 'high' },
  { chain: 1, address: '0x0a869d79a7052c7f1b55a8ebabbea3420f0d1e13', exchange: 'Kraken', label: 'Kraken Hot Wallet', source: 'etherscan-nametag', confidence: 'medium' },
  { chain: 1, address: '0x6cc14824ea2918f5de5c2f69a38cc950d99d4585', exchange: 'OKX', label: 'OKX Hot Wallet', source: 'etherscan-nametag', confidence: 'high' },
  { chain: 1, address: '0xa7fb49a0b6e2ec33704533b09d22b5160040ad97', exchange: 'OKX', label: 'OKX Hot Wallet 2', source: 'etherscan-nametag', confidence: 'medium' },
  { chain: 1, address: '0xf89c7b475821ec3fdc2dc8099032f0caad6cad93', exchange: 'Bybit', label: 'Bybit Hot Wallet', source: 'etherscan-nametag', confidence: 'high' },
  { chain: 1, address: '0x9c726677e2903170a4720b9d2f50531d08cdbaee', exchange: 'Bybit', label: 'Bybit Hot Wallet 2', source: 'etherscan-nametag', confidence: 'medium' },
  { chain: 1, address: '0x7713974908be4c7a7060f809415f00a742552184', exchange: 'Bitfinex', label: 'Bitfinex Hot Wallet', source: 'etherscan-nametag', confidence: 'high' },

  /* ── BNB Smart Chain (56) ── */
  { chain: 56, address: '0x8894e0a0c962cb723c1976a4421c95949be2d4e3', exchange: 'Binance', label: 'Binance: Binance 1', source: 'bscscan-nametag', confidence: 'high' },
  { chain: 56, address: '0xf977814e90da44bfa03b6295a0616a897441acec', exchange: 'Binance', label: 'Binance 8 Hot Wallet', source: 'bscscan-nametag', confidence: 'high' },
  { chain: 56, address: '0x56eddb7aa87536c09ccc2793473599fd21a8b17f', exchange: 'Binance', label: 'Binance Cold Wallet', source: 'bscscan-nametag', confidence: 'medium' },
  { chain: 56, address: '0x28c6c06298d514db089934071355e5743bf21d60', exchange: 'Binance', label: 'Binance 14 Hot Wallet', source: 'bscscan-nametag', confidence: 'high' },

  /* ── Polygon (137) ── */
  { chain: 137, address: '0x28c6c06298d514db089934071355e5743bf21d60', exchange: 'Binance', label: 'Binance Hot Wallet', source: 'polygonscan-nametag', confidence: 'medium' },

  /* ── Solana ── */
  { chain: 'solana', address: '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9', exchange: 'Binance', label: 'Binance Hot Wallet', source: 'solscan-nametag', confidence: 'high' }
];

/* DEX routers / aggregators per EVM chain. kind: 'router' (a swap lands in
   the same tx) — used to classify buy vs sell. */
export const DEX_ROUTERS = [
  /* Ethereum */
  { chain: 1, address: '0x7a250d5630b4cf539739df2c5dacb4c659f2488d', name: 'Uniswap V2 Router', dex: 'Uniswap' },
  { chain: 1, address: '0xe592427a0aece92de3edee1f18e0157c05861564', name: 'Uniswap V3 Router', dex: 'Uniswap' },
  { chain: 1, address: '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45', name: 'Uniswap V3 Router 2', dex: 'Uniswap' },
  { chain: 1, address: '0xef1c6e67703c7bd7107eed8303fbe6ec2554bf6b', name: 'Uniswap Universal Router', dex: 'Uniswap' },
  { chain: 1, address: '0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f', name: 'SushiSwap Router', dex: 'SushiSwap' },
  { chain: 1, address: '0x1111111254eeb25477b68fb85ed929f73a960582', name: '1inch Aggregation Router v5', dex: '1inch' },
  /* BNB Smart Chain */
  { chain: 56, address: '0x10ed43c718714eb63d5aa57b78b54704e256024e', name: 'PancakeSwap V2 Router', dex: 'PancakeSwap' },
  { chain: 56, address: '0x13f4ea83d0bd40e75c8222255bc855a974568dd4', name: 'PancakeSwap V3 Smart Router', dex: 'PancakeSwap' },
  { chain: 56, address: '0x3a6d8ca21d1cf76f653a67577fa0d27453350dd8', name: 'Biswap Router', dex: 'Biswap' },
  /* Polygon */
  { chain: 137, address: '0xa5e0829caced8ffdd4de3c43696c57f7d7a678ff', name: 'QuickSwap Router', dex: 'QuickSwap' },
  { chain: 137, address: '0xe592427a0aece92de3edee1f18e0157c05861564', name: 'Uniswap V3 Router', dex: 'Uniswap' },
  /* Arbitrum */
  { chain: 42161, address: '0xe592427a0aece92de3edee1f18e0157c05861564', name: 'Uniswap V3 Router', dex: 'Uniswap' },
  { chain: 42161, address: '0x1b02da8cb0d097eb8d57a175b88c7d8b47997506', name: 'SushiSwap Router', dex: 'SushiSwap' },
  /* Base */
  { chain: 8453, address: '0x2626664c2603336e57b271c5c0b26f421741e481', name: 'Uniswap V3 Router (Base)', dex: 'Uniswap' },
  /* Optimism */
  { chain: 10, address: '0xe592427a0aece92de3edee1f18e0157c05861564', name: 'Uniswap V3 Router', dex: 'Uniswap' }
];

/* Uniswap-V2-fork factories, for pairing Mint/Burn logs to a liquidity event. */
export const DEX_FACTORIES = [
  { chain: 1, address: '0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f', name: 'Uniswap V2 Factory', dex: 'Uniswap', kind: 'univ2' },
  { chain: 1, address: '0xc0aee478e3658e2610c5f7a4a2e1777ce9e4f2ac', name: 'SushiSwap Factory', dex: 'SushiSwap', kind: 'univ2' },
  { chain: 56, address: '0xca143ce32fe78f1f7019d7d551a6402fc5350c73', name: 'PancakeSwap V2 Factory', dex: 'PancakeSwap', kind: 'univ2' },
  { chain: 137, address: '0x5757371414417b8c6caad45baef941abc7d3ab32', name: 'QuickSwap Factory', dex: 'QuickSwap', kind: 'univ2' },
  { chain: 42161, address: '0xc35dadb65012ec5796536bd9864ed8773abc74c4', name: 'SushiSwap Factory (Arbitrum)', dex: 'SushiSwap', kind: 'univ2' },
  { chain: 8453, address: '0x8909dc15e40173ff4699343b6eb8132c65e18ec6', name: 'BaseSwap Factory', dex: 'BaseSwap', kind: 'univ2' }
];

/* V2 pair event topics. Mint = liquidity added; Burn = liquidity removed.
   PairCreated = pool created. The pool address that emits them is the pair. */
export const PAIR_TOPICS = {
  Mint: '0x4c209b5fc8ad50758f13e2e1088ba56a560dff690a1c6fef26394f4c03821c4f',
  Burn: '0xdccd412f17b19f892684a3eb00d1fe7f84e912a5b6cb4eb4df9d3b0f5a4fbdb5',
  PairCreated: '0x0d3648bd0f6ba80134a33ba9275ac585d9d315f0ad8355cddefde31afa28d0e9'
};

/* ── Indexes (built once) ─────────────────────────────────────────────── */

const exchangeIndex = new Map();
for (const row of EXCHANGE_WALLETS) {
  if (row.confidence === 'low') continue; // never label from an unverified row
  exchangeIndex.set(`${row.chain}:${String(row.address).toLowerCase()}`, row);
}

const routerIndex = new Map();
for (const row of DEX_ROUTERS) {
  routerIndex.set(`${row.chain}:${String(row.address).toLowerCase()}`, row);
}

const factoryByChain = new Map();
for (const row of DEX_FACTORIES) {
  const set = factoryByChain.get(row.chain) || new Set();
  set.add(row.address.toLowerCase());
  factoryByChain.set(row.chain, set);
}

/** Look up a CEX label for a chain+address. Returns null when unknown. */
export function exchangeFor(chain, address) {
  if (address == null) return null;
  return exchangeIndex.get(`${chain}:${String(address).toLowerCase()}`) || null;
}

/** Look up a DEX router for a chain+address. Returns null when unknown. */
export function routerFor(chain, address) {
  if (address == null) return null;
  return routerIndex.get(`${chain}:${String(address).toLowerCase()}`) || null;
}

/** True when an address is a known V2-style factory on that chain. */
export function isFactory(chain, address) {
  const set = factoryByChain.get(chain);
  return !!set && set.has(String(address || '').toLowerCase());
}

/** Registry metadata for the /exchanges endpoint — transparent sourcing. */
export function registryManifest() {
  return {
    exchanges: [...new Set(EXCHANGE_WALLETS.filter((r) => r.confidence !== 'low').map((r) => r.exchange))].sort(),
    count: EXCHANGE_WALLETS.filter((r) => r.confidence !== 'low').length,
    dexes: [...new Set(DEX_ROUTERS.map((r) => r.dex))].sort(),
    sources: ['etherscan-nametag', 'bscscan-nametag', 'polygonscan-nametag', 'solscan-nametag', 'exchange-disclosure'],
    note: 'Only addresses with a credible public source and high/medium confidence are labelled. Unrecognised counterparties remain "Unknown".'
  };
}
