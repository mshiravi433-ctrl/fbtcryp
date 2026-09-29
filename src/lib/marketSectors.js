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
  solana: 'solana-ecosystem'
});

const MEMBERS = Object.freeze({
  gold: ['tether-gold', 'pax-gold', 'kinesis-gold'],
  meme: ['dogecoin', 'shiba-inu', 'pepe', 'bonk', 'dogwifcoin', 'floki', 'brett', 'official-trump'],
  rwa: ['chainlink', 'ondo-finance', 'mantra-dao', 'pendle', 'pax-gold', 'tether-gold', 'polymesh', 'centrifuge', 'maple', 'origintrail'],
  ai: ['bittensor', 'artificial-superintelligence-alliance', 'fetch-ai', 'render-token', 'the-graph', 'virtual-protocol', 'near', 'aixbt', 'akash-network', 'ai16z'],
  gaming: ['immutable-x', 'the-sandbox', 'axie-infinity', 'gala', 'beam-2', 'ronin', 'enjincoin', 'decentraland', 'illuvium'],
  solana: ['solana', 'jupiter-exchange-solana', 'jito-governance-token', 'bonk', 'dogwifcoin', 'pyth-network', 'raydium', 'orca', 'helium', 'jito-staked-sol', 'marinade-staked-sol', 'render-token']
});

export function sectorFromRows(sector, rows = []) {
  const allowed = new Set(MEMBERS[sector] || []);
  return (Array.isArray(rows) ? rows : []).filter((row) => allowed.has(row?.id));
}
