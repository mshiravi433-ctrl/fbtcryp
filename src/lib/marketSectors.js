/* Verified CoinGecko IDs for the degraded-provider sector view.
 * This is an inclusion list, not a substitute for live prices. Only rows that
 * actually exist in a live (or explicitly offline-labelled) market feed render.
 * Never classify by ticker alone: tickers are not unique identifiers.
 */
export const MARKET_CATEGORIES = Object.freeze({
  gold: 'tokenized-gold',
  meme: 'meme-token',
  rwa: 'real-world-assets-rwa',
  ai: 'artificial-intelligence',
  gaming: 'gaming',
  solana: 'solana-ecosystem',
  // Binance's risk tags are NOT CoinGecko category IDs. The server reads the
  // exchange's current tags and verifies the market identity separately.
  monitoring: 'binance-monitoring',
  seed: 'binance-seed',
  defi: 'decentralized-finance-defi',
  storage: 'storage',
  nft: 'non-fungible-tokens-nft',
  fanToken: 'fan-token',
  megadrop: 'binance-megadrop',
  launchpool: 'binance-launchpool',
  infrastructure: 'infrastructure',
  bsc: 'binance-smart-chain',
  payment: 'payment-solutions',
  launchpad: 'binance-launchpad'
});

const MEMBERS = Object.freeze({
  gold: ['tether-gold', 'pax-gold', 'kinesis-gold'],
  meme: ['dogecoin', 'shiba-inu', 'pepe', 'bonk', 'dogwifcoin', 'floki', 'brett', 'official-trump'],
  rwa: ['chainlink', 'ondo-finance', 'mantra-dao', 'pendle', 'pax-gold', 'tether-gold', 'polymesh', 'centrifuge', 'maple', 'origintrail'],
  ai: ['bittensor', 'artificial-superintelligence-alliance', 'fetch-ai', 'render-token', 'the-graph', 'virtual-protocol', 'near', 'aixbt', 'akash-network', 'ai16z'],
  gaming: ['immutable-x', 'the-sandbox', 'axie-infinity', 'gala', 'beam-2', 'ronin', 'enjincoin', 'decentraland', 'illuvium'],
  solana: ['solana', 'jupiter-exchange-solana', 'jito-governance-token', 'bonk', 'dogwifcoin', 'pyth-network', 'raydium', 'orca', 'helium', 'jito-staked-sol', 'marinade-staked-sol', 'render-token'],
  // Small, explicitly partial outage fallbacks, verified against CoinGecko's
  // actual category responses on 2026-11-01. Never substitute these for the
  // live category feed; they do not contain prices. No static fallback is safe
  // for Monitoring/Seed because Binance can remove a risk tag at any time.
  defi: ['staked-ether', 'hyperliquid', 'wrapped-steth', 'chainlink'],
  storage: ['filecoin', 'bittorrent', 'arweave', 'aioz-network', 'walrus-2', 'holotoken', 'siacoin'],
  nft: ['render-token', 'fetch-ai', 'beam-2', 'apenft', 'floki'],
  fanToken: ['croatian-ff-fan-token', 'og-fan-token', 'atletico-madrid', 'galatasaray-fan-token', 'fc-barcelona-fan-token', 'paris-saint-germain-fan-token', 'santos-fc-fan-token', 'as-roma-fan-token', 'lazio-fan-token'],
  megadrop: ['lista', 'solv-protocol', 'bouncebit'],
  launchpool: ['sui', 'ethena', 'ether-fi', 'beam-2', 'redstone-oracles', 'io', 'bio-protocol', 'venus', 'altlayer'],
  infrastructure: ['chainlink', 'litecoin', 'quant-network', 'internet-computer', 'filecoin', 'blockstack', 'beldex', 'pyth-network', 'starknet'],
  bsc: ['binancecoin', 'binance-bridged-usdt-bnb-smart-chain', 'wrapped-bitcoin', 'chainlink', 'wrapped-beacon-eth'],
  payment: ['dash', 'stable-2', 'zebec-network', 'ultima', 'amp-token'],
  launchpad: ['injective-protocol', 'fetch-ai', 'bittorrent', 'axie-infinity', 'the-sandbox']
});

export const isBinanceRiskSector = (sector) => sector === 'monitoring' || sector === 'seed';

export function sectorFromRows(sector, rows = []) {
  const allowed = new Set(MEMBERS[sector] || []);
  return (Array.isArray(rows) ? rows : []).filter((row) => allowed.has(row?.id));
}
