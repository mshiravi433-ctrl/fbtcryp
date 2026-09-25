/**
 * Market pages show a bundled offline snapshot. Strategy Brain only accepts
 * explicitly live prices, and only recommends positions whose identity also
 * matches a curated token on a supported swap chain. A CoinGecko category is
 * not itself a trade venue or a quote.
 */
const finite = (v) => v == null || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null);

export function liveMarketRows(rows, {
  requireProvenance = true, family = 'crypto', limit = 40,
  registry = null, preferredChainId = null
} = {}) {
  if (!Array.isArray(rows)) return [];
  const tokens = registry ? Object.entries(registry).flatMap(([chainId, list]) =>
    (Array.isArray(list) ? list : []).map((token) => ({ ...token, chainId: Number(chainId) }))) : null;
  const match = (coin) => {
    if (!tokens) return null;
    const compatible = tokens.filter((token) =>
      token.coingeckoId === coin.id && String(token.symbol).toUpperCase() === String(coin.symbol).toUpperCase()
      && (family !== 'rwa' || Boolean(token.rwa)));
    return compatible.find((token) => token.chainId === Number(preferredChainId)) || compatible[0] || null;
  };
  return rows
    // Our API and the direct provider both return normalizeCoin's price /
    // change24h / mcap / volume shape. Accept raw CoinGecko rows too (e.g.
    // injected by a probe), but never treat a missing 24h change as zero.
    .filter((c) => (!requireProvenance || c?.dataProvenance === 'live')
      && finite(c?.price ?? c?.current_price) > 0
      && finite(c?.change24h ?? c?.price_change_percentage_24h_in_currency ?? c?.price_change_percentage_24h) != null
      && String(c?.symbol || '').trim())
    .map((c) => {
      const token = match(c);
      if (tokens && !token) return null;
      return {
        id: c.id,
        symbol: String(c.symbol).toUpperCase(), family,
        chainId: token?.chainId ?? null,
        price: finite(c.price ?? c.current_price),
        volatilityPct: Math.abs(finite(c.change24h ?? c.price_change_percentage_24h_in_currency ?? c.price_change_percentage_24h)),
        priceChange7dPct: finite(c.change7d ?? c.price_change_percentage_7d_in_currency ?? c.price_change_percentage_7d),
        marketCap: finite(c.mcap ?? c.market_cap),
        tvlUsd: finite(c.volume ?? c.total_volume) ?? finite(c.mcap ?? c.market_cap),
        dataProvenance: 'live',
        executable: Boolean(token),
        risk: family === 'crypto'
          ? (['BTC', 'ETH'].includes(String(c.symbol).toUpperCase()) ? 'medium' : 'high')
          : 'medium'
      };
    })
    .filter(Boolean)
    .slice(0, limit);
}
