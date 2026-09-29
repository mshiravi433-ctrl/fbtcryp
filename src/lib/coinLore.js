/*
 * Pure adapter for CoinLore's public ticker rows. Shared by the server and the
 * browser fallback so field normalization, canonical IDs and fail-closed
 * handling never drift between the two paths.
 */
const COINLORE_ID_ALIASES = Object.freeze({
  'binance-coin': 'binancecoin',
  avalanche: 'avalanche-2',
  polygon: 'matic-network',
  'near-protocol': 'near',
  injective: 'injective-protocol',
  pancakeswap: 'pancakeswap-token',
  render: 'render-token',
  worldcoin: 'worldcoin-wld',
  jupiter: 'jupiter-exchange-solana',
  'floki-inu': 'floki',
  hedera: 'hedera-hashgraph',
  immutable: 'immutable-x',
  sei: 'sei-network'
});

function finiteOrNull(value) {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Normalize a real CoinLore ticker; unavailable fields remain null/empty. */
export function normalizeCoinLoreMarket(c = {}) {
  const nameid = typeof c.nameid === 'string' ? c.nameid.trim().toLowerCase() : '';
  const id = COINLORE_ID_ALIASES[nameid] || nameid || (c.id != null ? `coinlore-${c.id}` : '');
  const symbol = String(c.symbol || '').trim().toUpperCase();
  const name = String(c.name || '').trim();
  const price = finiteOrNull(c.price_usd);
  if (!id || !symbol || !name || price == null || price <= 0) return null;

  return {
    id,
    symbol,
    name,
    image: null,
    price,
    change1h: finiteOrNull(c.percent_change_1h),
    change24h: finiteOrNull(c.percent_change_24h),
    change7d: finiteOrNull(c.percent_change_7d),
    mcap: finiteOrNull(c.market_cap_usd),
    volume: finiteOrNull(c.volume24),
    rank: finiteOrNull(c.rank),
    /* CoinLore's ticker endpoint does not provide these historical extrema. */
    high24h: null,
    low24h: null,
    ath: null,
    athChange: null,
    supply: finiteOrNull(c.csupply),
    /* A ticker is not a historical series; never synthesize a sparkline. */
    sparkline: [],
    marketProvider: 'coinlore',
    coinLoreId: c.id == null ? null : String(c.id)
  };
}
