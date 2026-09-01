/**
 * Market data for Lab — hybrid: real prices when the network is up, deterministic
 * mock prices when it is not.
 *
 * ─── WHY THIS SHAPE ─────────────────────────────────────────────────────────
 * The rest of the app already has a price pipeline (`useMarkets`, `getMarkets`).
 * Lab needs the same numbers so that a Paper Trade on BTC settles at the same
 * price the Market screen shows. But Lab also runs offline (the free hosting
 * tier has spotty uptime and the APK is used on flaky mobile networks), so
 * when the network drops we fall back to a deterministic walk seeded from the
 * current timestamp's hour bucket — close enough to "the market right now" to
 * be useful, and stable enough that two back-to-back views show the same
 * number.
 */

const ENDPOINTS = {
  simple: 'https://api.coingecko.com/api/v3/simple/price',
  markets: 'https://api.coingecko.com/api/v3/coins/markets'
};

const FALLBACK_PRICES = {
  bitcoin: 104820,
  ethereum: 3920,
  solana: 218,
  ripple: 2.41,
  cardano: 1.08,
  dogecoin: 0.38,
  'avalanche-2': 35.2,
  polkadot: 7.4,
  chainlink: 22.1,
  'matic-network': 0.71
};

const coinGeckoIds = Object.keys(FALLBACK_PRICES);

/**
 * Get current prices for a set of coins. Tries the live API first; on any
 * failure returns the deterministic fallback.
 */
export async function getPrices(ids = coinGeckoIds, vs = 'usd') {
  try {
    const url = `${ENDPOINTS.simple}?ids=${ids.join(',')}&vs_currencies=${vs}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) throw new Error(`http ${r.status}`);
    const data = await r.json();
    const out = {};
    for (const id of ids) {
      out[id] = data[id]?.[vs] ?? mockPrice(id);
    }
    return out;
  } catch {
    // Network down / API rate-limited / CORS blocked. Use mock.
    const out = {};
    for (const id of ids) out[id] = mockPrice(id);
    return out;
  }
}

function mockPrice(id) {
  const base = FALLBACK_PRICES[id] ?? 100;
  // Tiny random walk to simulate a live tick. Seeded by the minute so it
  // does not flicker every render.
  const minute = Math.floor(Date.now() / 60000);
  const seed = hashStr(id) + minute;
  const wobble = (rand(seed) - 0.5) * 0.02; // ±1%
  return +(base * (1 + wobble)).toFixed(base < 1 ? 5 : 2);
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) || 1;
}

function rand(seed) {
  let s = (seed | 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    return ((s >>> 0) % 100000) / 100000;
  };
}

export const COINS = [
  { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', color: '#f7931a' },
  { id: 'ethereum', symbol: 'ETH', name: 'Ethereum', color: '#627eea' },
  { id: 'solana', symbol: 'SOL', name: 'Solana', color: '#14f195' },
  { id: 'ripple', symbol: 'XRP', name: 'XRP', color: '#23292f' },
  { id: 'cardano', symbol: 'ADA', name: 'Cardano', color: '#0033ad' },
  { id: 'dogecoin', symbol: 'DOGE', name: 'Dogecoin', color: '#c2a633' },
  { id: 'avalanche-2', symbol: 'AVAX', name: 'Avalanche', color: '#e84142' },
  { id: 'polkadot', symbol: 'DOT', name: 'Polkadot', color: '#e6007a' },
  { id: 'chainlink', symbol: 'LINK', name: 'Chainlink', color: '#2a5ada' },
  { id: 'matic-network', symbol: 'MATIC', name: 'Polygon', color: '#8247e5' }
];

/**
 * Generate a "live-ish" price tick for the coin over the next N seconds.
 * Used to animate an open position's P&L while the user is watching.
 */
export function tickPrice(symbol, basePrice, seconds = 0) {
  if (!basePrice) basePrice = FALLBACK_PRICES[symbol] ?? 100;
  const seed = hashStr(symbol) + Math.floor(Date.now() / 1000) + seconds;
  const r = rand(seed);
  return +(basePrice * (1 + (r() - 0.5) * 0.015)).toFixed(basePrice < 1 ? 5 : 2);
}
