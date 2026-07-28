/**
 * Deterministic offline snapshot.
 *
 * Used only when both the backend and the public CoinGecko endpoints are
 * unreachable (airplane mode, rate limit, sanctioned IP, sandbox with no
 * egress...). Values drift slowly with the clock so charts still animate and
 * the app never looks frozen — but every screen marks the data as "offline".
 */

const SEED_COINS = [
  ['bitcoin', 'BTC', 'Bitcoin', 67450, 1.32e12, 3.1e10],
  ['ethereum', 'ETH', 'Ethereum', 3520, 4.23e11, 1.6e10],
  ['tether', 'USDT', 'Tether', 1.0, 1.12e11, 4.5e10],
  ['binancecoin', 'BNB', 'BNB', 612, 8.9e10, 1.9e9],
  ['solana', 'SOL', 'Solana', 168, 7.6e10, 3.2e9],
  ['ripple', 'XRP', 'XRP', 0.62, 3.4e10, 1.4e9],
  ['usd-coin', 'USDC', 'USDC', 1.0, 3.3e10, 6.1e9],
  ['cardano', 'ADA', 'Cardano', 0.45, 1.6e10, 4.2e8],
  ['dogecoin', 'DOGE', 'Dogecoin', 0.128, 1.85e10, 9.8e8],
  ['avalanche-2', 'AVAX', 'Avalanche', 34.2, 1.34e10, 4.6e8],
  ['tron', 'TRX', 'TRON', 0.126, 1.1e10, 3.9e8],
  ['chainlink', 'LINK', 'Chainlink', 16.4, 9.6e9, 5.1e8],
  ['polkadot', 'DOT', 'Polkadot', 6.85, 9.1e9, 2.4e8],
  ['matic-network', 'MATIC', 'Polygon', 0.72, 7.1e9, 3.3e8],
  ['litecoin', 'LTC', 'Litecoin', 84.5, 6.3e9, 4.4e8],
  ['shiba-inu', 'SHIB', 'Shiba Inu', 0.0000186, 1.1e10, 3.8e8],
  ['uniswap', 'UNI', 'Uniswap', 8.9, 5.3e9, 1.6e8],
  ['pepe', 'PEPE', 'Pepe', 0.0000102, 4.3e9, 8.9e8],
  ['aptos', 'APT', 'Aptos', 8.4, 3.9e9, 1.7e8],
  ['near', 'NEAR', 'NEAR Protocol', 5.1, 5.5e9, 2.6e8],
  ['internet-computer', 'ICP', 'Internet Computer', 10.3, 4.8e9, 1.1e8],
  ['cosmos', 'ATOM', 'Cosmos Hub', 7.4, 2.9e9, 1.3e8],
  ['stellar', 'XLM', 'Stellar', 0.108, 3.1e9, 8.7e7],
  ['filecoin', 'FIL', 'Filecoin', 4.6, 2.6e9, 1.9e8],
  ['arbitrum', 'ARB', 'Arbitrum', 0.83, 2.9e9, 2.4e8],
  ['optimism', 'OP', 'Optimism', 1.72, 2.1e9, 1.8e8],
  ['injective-protocol', 'INJ', 'Injective', 22.6, 2.2e9, 1.5e8],
  ['sui', 'SUI', 'Sui', 1.28, 3.3e9, 3.1e8],
  ['the-graph', 'GRT', 'The Graph', 0.166, 1.6e9, 6.2e7],
  ['aave', 'AAVE', 'Aave', 96.4, 1.4e9, 1.2e8],
  ['pancakeswap-token', 'CAKE', 'PancakeSwap', 2.31, 6.4e8, 4.9e7],
  ['maker', 'MKR', 'Maker', 2410, 2.2e9, 8.1e7],
  ['render-token', 'RNDR', 'Render', 7.35, 2.8e9, 1.4e8],
  ['fantom', 'FTM', 'Fantom', 0.51, 1.4e9, 1.1e8],
  ['algorand', 'ALGO', 'Algorand', 0.148, 1.2e9, 5.4e7],
  ['vechain', 'VET', 'VeChain', 0.026, 1.9e9, 4.1e7],
  ['hedera-hashgraph', 'HBAR', 'Hedera', 0.071, 2.5e9, 6.8e7],
  ['immutable-x', 'IMX', 'Immutable', 1.42, 2.1e9, 5.9e7],
  ['sei-network', 'SEI', 'Sei', 0.39, 1.3e9, 7.7e7],
  ['bonk', 'BONK', 'Bonk', 0.0000212, 1.4e9, 1.6e8],
  ['floki', 'FLOKI', 'FLOKI', 0.000151, 1.4e9, 9.4e7],
  ['thorchain', 'RUNE', 'THORChain', 3.9, 1.3e9, 8.8e7],
  ['kaspa', 'KAS', 'Kaspa', 0.113, 2.7e9, 5.2e7],
  ['celestia', 'TIA', 'Celestia', 6.2, 1.2e9, 1.3e8],
  ['ethereum-classic', 'ETC', 'Ethereum Classic', 21.4, 3.2e9, 1.5e8],
  ['monero', 'XMR', 'Monero', 158, 2.9e9, 6.6e7],
  ['stacks', 'STX', 'Stacks', 1.65, 2.4e9, 7.2e7],
  ['worldcoin-wld', 'WLD', 'Worldcoin', 1.94, 1.7e9, 2.1e8],
  ['jupiter-exchange-solana', 'JUP', 'Jupiter', 0.79, 1.1e9, 8.3e7],
  ['ondo-finance', 'ONDO', 'Ondo', 0.88, 1.2e9, 9.1e7]
];

/** Cheap deterministic hash -> [0,1). */
function hash01(str, salt = 0) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/** Slow, smooth oscillation so the "market" breathes between renders. */
function wave(id, periodMs, amp) {
  const phase = hash01(id, 7) * Math.PI * 2;
  return Math.sin((Date.now() / periodMs) * Math.PI * 2 + phase) * amp;
}

export function offlineMarkets(limit = 50) {
  return SEED_COINS.slice(0, limit).map(([id, symbol, name, base, mcap, vol], i) => {
    const drift = wave(id, 9e5, 0.035); // ±3.5% over 15 min
    const price = base * (1 + drift);
    const change24h = wave(id, 1.4e6, 6.5) + (hash01(id, 3) - 0.5) * 3;
    return {
      id,
      symbol,
      name,
      image: null,
      price,
      change1h: change24h / 6 + (hash01(id, 11) - 0.5),
      change24h,
      change7d: change24h * 1.8 + (hash01(id, 13) - 0.5) * 6,
      mcap,
      volume: vol,
      rank: i + 1,
      high24h: price * 1.035,
      low24h: price * 0.967,
      ath: base * (1 + hash01(id, 5) * 3),
      athChange: -(hash01(id, 5) * 65),
      supply: mcap / base,
      sparkline: offlineChart(id, 7).map((d) => d.p),
      offline: true
    };
  });
}

export function offlineChart(id, days = 1) {
  const seed = SEED_COINS.find((c) => c[0] === id);
  const base = seed ? seed[3] : 100;
  const points = days <= 1 ? 48 : days <= 7 ? 84 : 90;
  const stepMs = (days * 86400000) / points;
  const now = Date.now();
  const vol = 0.012 + hash01(id, 17) * 0.03;

  let p = base * (1 - wave(id, 1.4e6, 0.05));
  const out = [];
  for (let i = points; i >= 0; i--) {
    const t = now - i * stepMs;
    const n = Math.sin(i * (1 + hash01(id, i % 7))) + Math.cos(i * 0.37 + hash01(id, 23) * 6);
    p = Math.max(base * 0.4, p * (1 + n * vol * 0.35));
    out.push({ t, p });
  }
  // pin the last point to the current "live" price for visual consistency
  out[out.length - 1].p = base * (1 + wave(id, 9e5, 0.035));
  return out;
}

export function offlineGlobal() {
  const t = Date.now();
  return {
    coins: 14832,
    markets: 43120,
    mcap: 2451835872033 * (1 + Math.sin(t / 1.2e6) * 0.012),
    volume: 89342519012 * (1 + Math.sin(t / 8e5) * 0.06),
    btcDominance: 52.31 + Math.sin(t / 3e6) * 0.4,
    ethDominance: 14.62 + Math.cos(t / 3e6) * 0.25,
    mcapChange: 1.24 + Math.sin(t / 9e5) * 1.1,
    volumeChange: -8.33 + Math.cos(t / 9e5) * 4,
    avgChange: 0.87 + Math.sin(t / 7e5) * 0.9,
    offline: true
  };
}

export function offlineTrending() {
  return ['solana', 'pepe', 'sui', 'celestia', 'bonk', 'ondo-finance', 'render-token']
    .map((id) => SEED_COINS.find((c) => c[0] === id))
    .filter(Boolean)
    .map(([id, symbol, name], i) => ({ id, symbol, name, image: null, rank: i + 1, score: i, offline: true }));
}

export const OFFLINE_SYMBOLS = SEED_COINS.map(([id, symbol, name]) => ({ id, symbol, name }));
