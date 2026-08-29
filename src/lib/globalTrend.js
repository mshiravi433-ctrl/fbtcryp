/**
 * GLOBAL MARKET TREND
 * ---------------------------------------------------------------------------
 * The market screen's "global market" card had a total market cap, a 24h
 * change, and two dominance figures — every one of them a single number about
 * right now, and nothing showing how the total got there.
 *
 * There is no free historical endpoint for TOTAL market cap: the one that
 * serves it is an enterprise CoinGecko plan. So this does not invent one. It
 * rebuilds a 7-day series from data the page has already loaded:
 *
 *     market_cap(t) ≈ price(t) × circulating_supply
 *
 * summed across the top N coins, using each coin's own 7-day hourly sparkline
 * for price(t) and its current circulating supply (or market cap ÷ price when
 * the supply field is missing) as the weight.
 *
 * WHAT THIS IS NOT: it is not the whole market. It is the top N coins, whose
 * combined cap is reported alongside the series so the reader can see the
 * coverage, and it treats supply as constant across the window — which is true
 * for most large caps over seven days and approximately true for the rest.
 * The caption on the card says exactly this. A chart that looks authoritative
 * and quietly covers 60% of the market is worse than no chart.
 */
export const GLOBAL_TREND_SCHEMA = 'fbt.global-trend.v1';

const HOURS_7D = 168;

/**
 * @returns {null | {schema, points: Array<{x:number,y:number}>, coins:number,
 *   coverage:number, changePct:number, first:number, last:number, spanMs:number}}
 */
export function marketCapSeries(coins = [], { maxCoins = 60, maxPoints = 84, now = Date.now() } = {}) {
  if (!Array.isArray(coins) || coins.length === 0) return null;

  const usable = coins
    .filter((c) => Array.isArray(c?.sparkline) && c.sparkline.length > 2)
    .map((c) => {
      const price = Number(c.price);
      const mcap = Number(c.mcap);
      const supply = Number(c.supply);
      /* Supply is the weight. Prefer the reported circulating supply; fall back
         to market cap ÷ price. Neither is available for every row, and a row
         with neither cannot be weighted, so it is dropped rather than guessed. */
      const weight = supply > 0
        ? supply
        : (mcap > 0 && price > 0 ? mcap / price : 0);
      return { price, mcap, weight, spark: c.sparkline };
    })
    .filter((c) => c.weight > 0 && Number.isFinite(c.weight) && c.mcap > 0)
    .sort((a, b) => b.mcap - a.mcap)
    .slice(0, maxCoins);

  if (usable.length < 5) return null;

  /* Align every series to the END: sparklines are 7d hourly, but a coin
     listed mid-window can return a shorter array. Truncating from the front
     keeps "now" at the same index for every coin. */
  const len = Math.min(HOURS_7D, ...usable.map((c) => c.spark.length));
  if (!(len > 2)) return null;

  const totals = new Array(len).fill(0);
  for (const c of usable) {
    const offset = c.spark.length - len;
    for (let i = 0; i < len; i += 1) {
      const p = Number(c.spark[offset + i]);
      if (Number.isFinite(p) && p > 0) totals[i] += p * c.weight;
    }
  }

  /* Bucket-average down to a drawable count. Averaging rather than sampling
     keeps a single hour's wick from becoming the shape of the week. */
  const bucket = Math.max(1, Math.floor(len / maxPoints));
  const points = [];
  const spanMs = 7 * 24 * 3600 * 1000;
  const stepMs = spanMs / (len - 1);
  for (let i = 0; i < len; i += bucket) {
    let sum = 0;
    let n = 0;
    for (let j = i; j < Math.min(i + bucket, len); j += 1) {
      sum += totals[j];
      n += 1;
    }
    if (n === 0) continue;
    points.push({ x: now - spanMs + i * stepMs, y: sum / n });
  }
  if (points.length < 3) return null;

  const first = points[0].y;
  const last = points[points.length - 1].y;
  const totalNow = usable.reduce((sum, c) => sum + c.mcap, 0);

  return {
    schema: GLOBAL_TREND_SCHEMA,
    points,
    coins: usable.length,
    /* Coverage is measured against the loaded list, NOT against the real total
       market cap: comparing a top-60 sum to a 10,000-coin global figure would
       report ~65% coverage and flatter the number. */
    coverage: totalNow > 0 ? Math.min(1, last / totalNow) : 0,
    changePct: first > 0 ? ((last - first) / first) * 100 : 0,
    first,
    last,
    spanMs
  };
}
