/**
 * DYDX OFFLINE FEED — the futures engine stays alive without egress.
 * ---------------------------------------------------------------------------
 * Same contract as lib/dydx.js: markets keep the exact shape the page reads
 * (ticker/status/oraclePrice/openInterest/nextFundingRate/…), candles keep
 * { startedAt, close, … }. Used ONLY when the indexer proxy is unreachable,
 * every surface that renders it says OFFLINE, and demo fills never touch the
 * chain. When the live indexer returns, this disappears.
 */

const mk = (ticker, price, change24H, volume24H, oi, funding, clob) => ({
  ticker,
  status: 'ACTIVE',
  oraclePrice: price,
  priceChange24H: change24H,
  volume24H: volume24H,
  openInterest: oi,
  nextFundingRate: funding,
  atomicResolution: -8,
  quantumConversionExponent: -9,
  stepBaseQuantums: 1000,
  subticksPerTick: 100,
  clobPairId: clob,
  raw: { ticker, status: 'ACTIVE' }
});

export function offlineDydxMarkets() {
  return {
    live: false,
    offline: true,
    markets: [
      mk('BTC-USD', 118500, 2.14, 4285000000, 24500, 0.0001, 0),
      mk('ETH-USD', 3855, 1.32, 2150000000, 182000, 0.00005, 1),
      mk('SOL-USD', 188.6, 4.05, 890000000, 9800000, 0.0002, 2),
      mk('XRP-USD', 2.345, -0.8, 420000000, 152000000, -0.0001, 3),
      mk('DOGE-USD', 0.3215, 1.9, 310000000, 8900000000, 0.0004, 4),
      mk('LINK-USD', 19.0, 3.1, 88000000, 2400000, 0.0003, 5),
      mk('AVAX-USD', 41.35, 1.1, 54000000, 3100000, 0.0001, 6),
      mk('TON-USD', 6.06, -1.2, 95000000, 18500000, -0.0002, 7),
      mk('ATOM-USD', 9.84, 0.5, 21000000, 6800000, 0.0001, 8),
      mk('LTC-USD', 142.8, 0.7, 62000000, 940000, 0.0001, 9),
      mk('ADA-USD', 0.925, 0.4, 180000000, 120000000, 0.0002, 10),
      mk('ARB-USD', 0.785, 0.8, 29000000, 42000000, -0.0001, 11),
      mk('OP-USD', 1.86, 1.5, 26000000, 38000000, 0.0001, 12),
      mk('SUI-USD', 4.13, 5.4, 140000000, 19000000, 0.0003, 13),
      mk('APT-USD', 11.25, -2.2, 41000000, 4200000, -0.0002, 14)
    ]
  };
}

const RES_MS = { '15MINS': 900_000, '1HOUR': 3_600_000, '4HOURS': 14_400_000, '1DAY': 86_400_000 };

/** Deterministic OHLCV candles. Only used when the indexer is unreachable. */
export function offlineDydxCandles(ticker, resolution = '4HOURS', limit = 96) {
  const step = RES_MS[String(resolution).toUpperCase()] || 3_600_000;
  const base = offlineDydxMarkets().markets.find((m) => m.ticker === ticker)?.oraclePrice || 100;
  let seed = 0;
  for (let i = 0; i < ticker.length; i += 1) seed = (seed * 33 + ticker.charCodeAt(i)) % 99991;
  const candles = [];
  let v = base * 0.97;
  const now = Date.now();
  for (let i = 0; i < limit; i += 1) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const wave = Math.sin(i / 5 + (seed % 12)) * 0.003;
    const drift = ((seed / 2147483648) - 0.5) * 0.006 + wave;
    const open = v;
    const close = Math.max(base * 0.7, open * (1 + drift));
    const high = Math.max(open, close) * (1 + ((seed % 50) / 1000) * 0.05);
    const low = Math.min(open, close) * (1 - (((seed / 2147483648) % 0.5) * 0.04));
    candles.push({
      startedAt: new Date(now - (limit - i) * step).toISOString(),
      open: Number(open.toFixed(4)),
      close: Number(close.toFixed(4)),
      high: Number(high.toFixed(4)),
      low: Number(low.toFixed(4)),
      volume: Number(((seed % 1000) + 50).toFixed(2)),
      offline: true
    });
    v = close;
  }
  return candles;
}
