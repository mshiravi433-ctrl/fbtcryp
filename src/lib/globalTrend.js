/**
 * GLOBAL MARKET TREND
 * ---------------------------------------------------------------------------
 * The market screen's "global market" card had a total market cap, a 24h
 * change, and two dominance figures — every one of them a single number about
 * right now, and nothing showing how the total got there.
 *
 * There is no free historical endpoint for TOTAL market cap: the one that
 * serves it is an enterprise CoinGecko plan. So this does not invent one. It
 * rebuilds a series from data the page has already loaded:
 *
 *     market_cap(t) ≈ price(t) × circulating_supply
 *
 * summed across the top N coins, using each coin's own hourly sparkline for
 * price(t) and its current circulating supply (or market cap ÷ price when the
 * supply field is missing) as the weight.
 *
 * WHAT THIS IS NOT: it is not the whole market. It is the top N coins, whose
 * combined cap is reported alongside the series so the reader can see the
 * coverage, and it treats supply as constant across the window — true for most
 * large caps over a week, approximately true for the rest. The caption on the
 * card says exactly this. A chart that looks authoritative and quietly covers
 * 60% of the market is worse than no chart.
 *
 * HONEST FAILURE: every degenerate input returns null rather than a flat line.
 * A flat line at zero reads as "the market has not moved", which is a claim
 * about the market — not about whether our data arrived.
 */
export const GLOBAL_TREND_SCHEMA = 'fbt.global-trend.v1';

/** CoinGecko's `sparkline_in_7d.price` is hourly. */
const STEP_MS = 60 * 60 * 1000;
const FULL_WINDOW_POINTS = 168; // 7 days × 24h

/**
 * @returns {null | {schema, points: Array<{x:number,y:number}>, coins:number,
 *   coverage:number, changePct:number, first:number, last:number,
 *   spanMs:number, days:number}}
 */
export function marketCapSeries(coins = [], { maxCoins = 60, maxPoints = 84, now = Date.now() } = {}) {
  if (!Array.isArray(coins) || coins.length === 0) return null;

  const usable = coins
    .map((c) => {
      const price = Number(c?.price);
      const mcap = Number(c?.mcap);
      const supply = Number(c?.supply);
      /* Supply is the weight. Prefer the reported circulating supply; fall
         back to market cap ÷ price. A row with neither cannot be weighted, so
         it is dropped rather than guessed at. */
      const weight = supply > 0 ? supply : (mcap > 0 && price > 0 ? mcap / price : 0);
      /* Validated up front: a sparkline of junk strings must not silently
         become a run of zeros (see the note above). */
      const spark = Array.isArray(c?.sparkline)
        ? c.sparkline.map((p) => Number(p)).filter((p) => Number.isFinite(p) && p > 0)
        : [];
      return { price, mcap, weight, spark };
    })
    .filter((c) => c.weight > 0 && Number.isFinite(c.weight) && c.mcap > 0 && c.spark.length > 2)
    .sort((a, b) => b.mcap - a.mcap)
    .slice(0, maxCoins);

  if (usable.length < 5) return null;

  /* Align every series to the END: a coin listed mid-window returns a shorter
     array, and truncating from the front keeps "now" at the same index for
     every coin. The window is therefore as long as the SHORTEST series, and
     `days` reports that honestly rather than stretching 5 days of data across
     a 7-day axis. */
  const len = Math.min(FULL_WINDOW_POINTS, ...usable.map((c) => c.spark.length));
  if (!(len > 2)) return null;

  const totals = new Array(len).fill(0);
  let filled = 0;
  for (const c of usable) {
    const offset = c.spark.length - len;
    for (let i = 0; i < len; i += 1) totals[i] += c.spark[offset + i] * c.weight;
  }
  for (let i = 0; i < len; i += 1) if (totals[i] > 0) filled += 1;
  /* Most of the window has to be real, or there is no series to show. */
  if (filled < Math.max(3, Math.ceil(len * 0.5))) return null;

  /* Bucket-average down to a drawable count. Averaging rather than sampling
     keeps a single hour's wick from becoming the shape of the week. */
  const bucket = Math.max(1, Math.floor(len / maxPoints));
  const spanMs = (len - 1) * STEP_MS;
  const points = [];
  for (let i = 0; i < len; i += bucket) {
    let sum = 0;
    let n = 0;
    for (let j = i; j < Math.min(i + bucket, len); j += 1) {
      sum += totals[j];
      n += 1;
    }
    if (!n) continue;
    const avg = sum / n;
    if (!(avg > 0)) continue;
    /* x is the real timestamp of this bucket: STEP_MS per input point, counted
       back from `now` — not a 7-day span divided by however many points
       happened to arrive. */
    points.push({ x: now - (len - 1 - i) * STEP_MS, y: avg });
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
    spanMs,
    days: Math.max(1, Math.round(spanMs / (24 * STEP_MS)))
  };
}
