/**
 * A DETERMINISTIC MARKET FEED FOR VISUAL REVIEW — NOT SHIPPED.
 * ---------------------------------------------------------------------------
 * The sandbox has no outbound access to CoinGecko/CoinLore, so `/api/markets`
 * answers UPSTREAM_FAILED and the redesigned market screen would only ever be
 * reviewed as eight skeleton rows. This module fabricates a plausible feed with
 * the same shape the server returns, so the layout can be looked at and
 * measured while the design is being worked on.
 *
 * It is imported ONLY by `scripts/preview-market-demo.mjs`, which serves these
 * rows from a throwaway HTTP API on :8799 so the Vite dev server can proxy to
 * it. Nothing in `src/` imports it, so it cannot reach the bundle and cannot
 * be mistaken for real price data.
 */

const SYMBOLS = [
  ['bitcoin', 'BTC', 'Bitcoin', 92150.32, 2.41, 1.82e12, 3.9e10],
  ['ethereum', 'ETH', 'Ethereum', 3128.74, 1.18, 3.76e11, 1.9e10],
  ['tether', 'USDT', 'Tether', 1.0002, 0.01, 1.12e11, 6.1e10],
  ['bnb', 'BNB', 'BNB', 612.4, -0.84, 8.9e10, 1.6e9],
  ['solana', 'SOL', 'Solana', 187.63, 4.62, 8.4e10, 4.2e9],
  ['xrp', 'XRP', 'XRP', 2.31, -1.92, 1.3e11, 3.1e9],
  ['usd-coin', 'USDC', 'USDC', 0.9998, -0.02, 4.1e10, 5.4e9],
  ['cardano', 'ADA', 'Cardano', 0.9124, -2.34, 3.2e10, 8.2e8],
  ['dogecoin', 'DOGE', 'Dogecoin', 0.3182, 5.71, 4.7e10, 2.9e9],
  ['tron', 'TRX', 'TRON', 0.2641, 0.42, 2.3e10, 7.7e8],
  ['avalanche-2', 'AVAX', 'Avalanche', 34.18, -1.14, 1.4e10, 4.1e8],
  ['chainlink', 'LINK', 'Chainlink', 22.94, 3.08, 1.4e10, 6.3e8],
  ['shiba-inu', 'SHIB', 'Shiba Inu', 0.0000212, 6.12, 1.2e10, 5.1e8],
  ['toncoin', 'TON', 'Toncoin', 5.12, -0.66, 1.3e10, 2.2e8],
  ['sui', 'SUI', 'Sui', 3.41, 7.28, 9.6e9, 9.1e8],
  ['pepe', 'PEPE', 'Pepe', 0.0000184, 8.94, 7.7e9, 1.4e9],
  ['polkadot', 'DOT', 'Polkadot', 6.74, -1.31, 1.0e10, 2.9e8],
  ['litecoin', 'LTC', 'Litecoin', 108.42, 0.94, 8.2e9, 3.4e8],
  ['bitcoin-cash', 'BCH', 'Bitcoin Cash', 512.3, 1.62, 1.0e10, 4.2e8],
  ['uniswap', 'UNI', 'Uniswap', 12.84, 2.24, 7.7e9, 2.7e8],
  ['near', 'NEAR', 'NEAR Protocol', 4.62, -2.02, 5.6e9, 2.1e8],
  ['aptos', 'APT', 'Aptos', 8.91, 1.42, 5.2e9, 1.8e8],
  ['internet-computer', 'ICP', 'Internet Computer', 9.28, -0.92, 4.4e9, 1.1e8],
  ['render-token', 'RENDER', 'Render', 6.14, 3.52, 3.2e9, 1.4e8],
  ['arbitrum', 'ARB', 'Arbitrum', 0.842, -1.74, 3.6e9, 2.4e8],
  ['injective-protocol', 'INJ', 'Injective', 21.42, 4.18, 2.1e9, 1.9e8],
  ['the-graph', 'GRT', 'The Graph', 0.1924, 1.08, 1.8e9, 8.2e7],
  ['aave', 'AAVE', 'Aave', 248.6, 2.86, 3.7e9, 2.6e8],
  ['maker', 'MKR', 'Maker', 1842.5, 0.62, 1.7e9, 1.1e8],
  ['immutable-x', 'IMX', 'Immutable', 1.284, -2.44, 1.6e9, 7.1e7],
  ['ondo-finance', 'ONDO', 'Ondo', 0.9421, 5.24, 3.0e9, 1.9e8],
  ['jupiter-exchange-solana', 'JUP', 'Jupiter', 0.8241, 3.16, 1.2e9, 1.4e8],
  ['pax-gold', 'PAXG', 'PAX Gold', 2418.6, 0.82, 6.4e8, 3.2e7],
  ['tether-gold', 'XAUT', 'Tether Gold', 2394.2, 0.74, 5.1e8, 2.6e7],
  ['axie-infinity', 'AXS', 'Axie Infinity', 4.82, -1.12, 7.2e8, 4.4e7],
  ['the-sandbox', 'SAND', 'The Sandbox', 0.3182, 2.08, 7.4e8, 5.1e7],
  ['decentraland', 'MANA', 'Decentraland', 0.3412, -0.42, 6.5e8, 4.2e7],
  ['gala', 'GALA', 'GALA', 0.02142, 3.84, 7.8e8, 6.4e7],
  ['floki', 'FLOKI', 'FLOKI', 0.000124, 4.62, 1.2e9, 8.2e7],
  ['bonk', 'BONK', 'Bonk', 0.0000282, 9.14, 1.9e9, 2.4e8]
];

/** A sparkline that ends at the live price, shaped by the coin's 24h move. */
function series(price, changePct, points = 42, seed = 0) {
  const start = price / (1 + changePct / 100);
  const out = [];
  for (let i = 0; i < points; i += 1) {
    const k = i / (points - 1);
    const drift = start + (price - start) * k;
    const wave = Math.sin((k + seed) * Math.PI * 2.4) * (price * 0.006);
    out.push(Number(Math.max(drift + wave, price * 0.0001).toPrecision(7)));
  }
  out[points - 1] = price;
  return out;
}

export const DEMO_COINS = SYMBOLS.map(([id, symbol, name, price, change, mcap, volume], index) => {
  const changePct = change;
  return {
    id,
    symbol,
    name,
    image: '',
    price,
    change24h: changePct,
    mcap,
    volume,
    high24h: price * 1.035,
    low24h: price * 0.962,
    rank: index + 1,
    supply: mcap / price,
    sparkline: series(price, changePct, 42, index / 8)
  };
});

export const DEMO_GLOBAL = {
  mcap: 3.152e12,
  mcapChange: 2.84,
  volume: 1.42e11,
  btcDominance: 56.4,
  ethDominance: 13.8,
  coins: 14820,
  markets: 1124,
  avgChange: 2.35
};

export const DEMO_TRENDING = DEMO_COINS.slice(0, 8).map((coin, i) => ({
  id: coin.id,
  symbol: coin.symbol,
  name: coin.name,
  image: '',
  rank: coin.rank,
  score: 90 - i * 6
}));

/** The fetch shim the preview script installs. */
export function makeDemoFetch(realFetch = globalThis.fetch) {
  return async function demoFetch(input, init) {
    const url = typeof input === 'string' ? input : input?.url ?? '';
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    if (path.startsWith('/api/markets')) {
      const page = Number(new URL(url, 'http://x').searchParams.get('page') || 1);
      const rows = page === 1 ? DEMO_COINS : [];
      return new Response(JSON.stringify(rows), { headers: { 'content-type': 'application/json' } });
    }
    if (path.startsWith('/api/trending')) {
      return new Response(JSON.stringify(DEMO_TRENDING), { headers: { 'content-type': 'application/json' } });
    }
    if (path.startsWith('/api/global')) {
      return new Response(JSON.stringify(DEMO_GLOBAL), { headers: { 'content-type': 'application/json' } });
    }
    if (path.startsWith('/api/search')) {
      return new Response(JSON.stringify([]), { headers: { 'content-type': 'application/json' } });
    }
    if (path.startsWith('/api/category')) {
      return new Response(JSON.stringify(DEMO_COINS.slice(0, 12)), { headers: { 'content-type': 'application/json' } });
    }
    return realFetch(input, init);
  };
}
