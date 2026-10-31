// Deterministic QA data, used ONLY by the browser runner's network interception.
const assets = [
  ['bitcoin', 'BTC', 'Bitcoin', 92450],
  ['ethereum', 'ETH', 'Ethereum', 3420],
  ['tether', 'USDT', 'Tether', 1],
  ['solana', 'SOL', 'Solana', 174.32],
  ['binancecoin', 'BNB', 'BNB', 608.71],
  ['ripple', 'XRP', 'XRP', 1.42],
  ['usd-coin', 'USDC', 'USDC', 1],
  ['cardano', 'ADA', 'Cardano', .4281],
  ['dogecoin', 'DOGE', 'Dogecoin', .1829],
  ['chainlink', 'LINK', 'Chainlink', 15.82],
  ['avalanche-2', 'AVAX', 'Avalanche', 28.73],
  ['shiba-inu', 'SHIB', 'Shiba Inu', .0000182]
];
export const marketGlassCoins = Array.from({ length: 75 }, (_, i) => {
  const [id, symbol, name, price] = assets[i] ?? [`qa-coin-${i}`, `Q${i}`, `Long token name ${i}`, .13 * i];
  const change24h = i % 3 === 0 ? 2.41 : i % 3 === 1 ? -1.82 : .02;
  return {
    id, symbol, name, price, change24h,
    rank: i + 1,
    image: `https://fixture.invalid/${id}.png`,
    volume: 4e10 / (i + 1),
    mcap: 1.83e12 / (i + 1),
    supply: (1.83e12 / (i + 1)) / price,
    high24h: price * 1.025,
    low24h: price * .965,
    sparklineStepHours: 4,
    sparkline: Array.from({ length: 42 }, (_, j) => price * (.96 + .035 * j / 42 + .008 * Math.sin(j * .9 + i) + .004 * Math.sin(j * 2.3)))
  };
});
export const marketGlassGlobal = {
  mcap: 3.152e12, volume: 1.42e11, btcDominance: 56.4, ethDominance: 13.8,
  coins: 14820, markets: 1124, avgChange: 2.35, mcapChange: 2.84
};
