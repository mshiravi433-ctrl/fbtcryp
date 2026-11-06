/**
 * FBT AI INTELLIGENCE — TECHNICAL INDICATORS (pure, dependency-free)
 * ---------------------------------------------------------------------------
 * Everything here is arithmetic on numbers the market feed actually returned.
 * No random numbers, no smoothing that pretends to be a measurement, and no
 * value invented to fill a warm-up window: an indicator that cannot be
 * computed from the bars it was given returns `null`, and the screen prints
 * «داده کافی نیست» instead of a confident 50.
 *
 * ─── WHY THIS IS A LIBRARY AND NOT CODE INSIDE THE PAGE ─────────────────────
 * These are the numbers the AI narrative is allowed to quote. If they live in
 * a component they can only be observed by rendering it; here they are pure
 * functions that the test file calls directly (test/ai-analysis-intel.test.mjs),
 * including the edge cases — a flat series, a one-bar series, a candle set with
 * gaps — where a silent NaN would otherwise reach the UI and render as "--".
 *
 * ─── CONVENTIONS ────────────────────────────────────────────────────────────
 *   · Every series function returns an array ALIGNED to its input: index `i`
 *     holds the value at bar `i`, or `null` during warm-up.
 *   · `period` is always in bars and must be >= 1.
 *   · Nothing mutates its input.
 *   · Internationalization never happens here — callers format.
 */

export const INDICATOR_VERSION = 'fbt.indicators.1';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Clamp a number into a range. Shared by the scoring and risk engines. */
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Keep only well-formed OHLC bars and sort them by time.
 *
 * A malformed bar is dropped rather than patched: `h >= l` is a fact the feed
 * either supplies or does not. Dropping keeps time order intact, which every
 * windowed indicator depends on.
 */
export function sanitizeCandles(rows = []) {
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const t = Number(r?.t);
    const o = Number(r?.o);
    const h = Number(r?.h);
    const l = Number(r?.l);
    const c = Number(r?.c);
    if (![t, o, h, l, c].every(Number.isFinite)) continue;
    if (h < l || h < Math.max(o, c) || l > Math.min(o, c)) continue;
    out.push({ t, o, h, l, c });
  }
  return out.sort((a, b) => a.t - b.t);
}

export const closesOf = (candles = []) => (Array.isArray(candles) ? candles.map((c) => c.c) : []);

/** Simple moving average. */
export function sma(values, period) {
  const src = Array.isArray(values) ? values : [];
  const n = src.length;
  const out = new Array(n).fill(null);
  const p = Math.trunc(Number(period));
  if (!Number.isFinite(p) || p < 1 || n < p) return out;
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    const v = Number(src[i]);
    if (!Number.isFinite(v)) return out; // refuse to average a hole
    sum += v;
    if (i >= p) sum -= Number(src[i - p]);
    if (i >= p - 1) out[i] = sum / p;
  }
  return out;
}

/** Exponential moving average, seeded with the SMA of the first window. */
export function ema(values, period) {
  const src = Array.isArray(values) ? values : [];
  const n = src.length;
  const out = new Array(n).fill(null);
  const p = Math.trunc(Number(period));
  if (!Number.isFinite(p) || p < 1 || n < p) return out;
  const seed = src.slice(0, p).map(Number);
  if (!seed.every(Number.isFinite)) return out;
  const k = 2 / (p + 1);
  let prev = seed.reduce((s, v) => s + v, 0) / p;
  out[p - 1] = prev;
  for (let i = p; i < n; i += 1) {
    const v = Number(src[i]);
    if (!Number.isFinite(v)) return out;
    prev = v * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Simple average of an array (null when empty). */
export function mean(values = []) {
  const nums = (Array.isArray(values) ? values : []).map(Number).filter(Number.isFinite);
  if (!nums.length) return null;
  return nums.reduce((s, v) => s + v, 0) / nums.length;
}

/** Population standard deviation. */
export function stdev(values = []) {
  const nums = (Array.isArray(values) ? values : []).map(Number).filter(Number.isFinite);
  if (nums.length < 2) return null;
  const m = nums.reduce((s, v) => s + v, 0) / nums.length;
  const varr = nums.reduce((s, v) => s + (v - m) ** 2, 0) / nums.length;
  return Math.sqrt(varr);
}

export function median(values = []) {
  const nums = (Array.isArray(values) ? values : []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = nums.length >> 1;
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

/** Wilder's RSI. */
export function rsi(values, period = 14) {
  const src = Array.isArray(values) ? values.map(Number) : [];
  const n = src.length;
  const out = new Array(n).fill(null);
  const p = Math.trunc(Number(period));
  if (!Number.isFinite(p) || p < 1 || n <= p) return out;
  if (!src.every(Number.isFinite)) return out;

  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= p; i += 1) {
    const d = src[i] - src[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / p;
  let avgLoss = loss / p;
  out[p] = rsiFrom(avgGain, avgLoss);
  for (let i = p + 1; i < n; i += 1) {
    const d = src[i] - src[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgGain = (avgGain * (p - 1) + g) / p;
    avgLoss = (avgLoss * (p - 1) + l) / p;
    out[i] = rsiFrom(avgGain, avgLoss);
  }
  return out;
}

function rsiFrom(avgGain, avgLoss) {
  /* No loss in the window is 100, no gain is 0, and a perfectly flat series is
     50 — the neutral reading, not a division by zero rendered as Infinity. */
  if (avgLoss === 0 && avgGain === 0) return 50;
  if (avgLoss === 0) return 100;
  if (avgGain === 0) return 0;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** MACD line, signal line and histogram, all aligned to the input. */
export function macd(values, fast = 12, slow = 26, signalPeriod = 9) {
  const src = Array.isArray(values) ? values : [];
  const n = src.length;
  const line = new Array(n).fill(null);
  const signal = new Array(n).fill(null);
  const hist = new Array(n).fill(null);
  const fastEma = ema(src, fast);
  const slowEma = ema(src, slow);
  const compact = [];
  const compactIdx = [];
  for (let i = 0; i < n; i += 1) {
    if (isNum(fastEma[i]) && isNum(slowEma[i])) {
      line[i] = fastEma[i] - slowEma[i];
      compact.push(line[i]);
      compactIdx.push(i);
    }
  }
  const sigCompact = ema(compact, signalPeriod);
  for (let j = 0; j < compactIdx.length; j += 1) {
    if (isNum(sigCompact[j])) {
      const i = compactIdx[j];
      signal[i] = sigCompact[j];
      hist[i] = line[i] - sigCompact[j];
    }
  }
  return { line, signal, hist };
}

/** Bollinger Bands with %B and bandwidth. */
export function bollinger(values, period = 20, mult = 2) {
  const src = Array.isArray(values) ? values : [];
  const n = src.length;
  const middle = sma(src, period);
  const upper = new Array(n).fill(null);
  const lower = new Array(n).fill(null);
  const percentB = new Array(n).fill(null);
  const bandwidth = new Array(n).fill(null);
  const p = Math.trunc(Number(period));
  if (!Number.isFinite(p) || p < 2) return { middle, upper, lower, percentB, bandwidth };
  for (let i = p - 1; i < n; i += 1) {
    if (!isNum(middle[i])) continue;
    const sd = stdev(src.slice(i - p + 1, i + 1));
    if (!isNum(sd)) continue;
    upper[i] = middle[i] + mult * sd;
    lower[i] = middle[i] - mult * sd;
    const span = upper[i] - lower[i];
    percentB[i] = span > 0 ? (src[i] - lower[i]) / span : 0.5;
    bandwidth[i] = middle[i] > 0 ? (span / middle[i]) * 100 : null;
  }
  return { middle, upper, lower, percentB, bandwidth };
}

/** Average True Range (Wilder), plus ATR as a percentage of the last close. */
export function atr(candles, period = 14) {
  const bars = sanitizeCandles(candles);
  const n = bars.length;
  const out = new Array(n).fill(null);
  const p = Math.trunc(Number(period));
  if (!Number.isFinite(p) || p < 1 || n < p + 1) return out;
  const tr = new Array(n).fill(null);
  for (let i = 1; i < n; i += 1) {
    const { h, l } = bars[i];
    const prevClose = bars[i - 1].c;
    tr[i] = Math.max(h - l, Math.abs(h - prevClose), Math.abs(l - prevClose));
  }
  let sum = 0;
  for (let i = 1; i <= p; i += 1) sum += tr[i];
  out[p] = sum / p;
  for (let i = p + 1; i < n; i += 1) out[i] = (out[i - 1] * (p - 1) + tr[i]) / p;
  return out;
}

/** Peak-to-trough drawdown of a series, as a negative percentage. */
export function maxDrawdown(values = []) {
  const nums = (Array.isArray(values) ? values : []).map(Number).filter((v) => Number.isFinite(v) && v > 0);
  if (nums.length < 2) return null;
  let peak = nums[0];
  let worst = 0;
  for (const v of nums) {
    if (v > peak) peak = v;
    const dd = (v - peak) / peak;
    if (dd < worst) worst = dd;
  }
  return worst * 100;
}

/** Drawdown from the running peak to the latest value. */
export function currentDrawdown(values = []) {
  const nums = (Array.isArray(values) ? values : []).map(Number).filter((v) => Number.isFinite(v) && v > 0);
  if (nums.length < 2) return null;
  const peak = Math.max(...nums);
  return peak > 0 ? ((nums[nums.length - 1] - peak) / peak) * 100 : null;
}

/**
 * Least-squares trend over a window.
 * `slopePct` is the change per bar as a percentage of the mean level, so the
 * number is comparable across a $0.0002 token and a $90,000 one. `r2` says how
 * much of the variance the line explains — a steep slope with r2 0.1 is noise.
 */
export function trendFit(values = [], lookback = 30) {
  const nums = (Array.isArray(values) ? values : []).map(Number).filter(Number.isFinite);
  if (nums.length < 3) return null;
  const y = nums.slice(-Math.max(3, Math.trunc(lookback)));
  const n = y.length;
  const meanX = (n - 1) / 2;
  const meanY = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i += 1) {
    sxy += (i - meanX) * (y[i] - meanY);
    sxx += (i - meanX) ** 2;
  }
  if (sxx === 0) return { slopePct: 0, r2: 0, samples: n };
  const slope = sxy / sxx;
  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < n; i += 1) {
    const pred = meanY + slope * (i - meanX);
    ssRes += (y[i] - pred) ** 2;
    ssTot += (y[i] - meanY) ** 2;
  }
  const r2 = ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 0;
  return {
    slopePct: meanY !== 0 ? (slope / meanY) * 100 : 0,
    r2,
    samples: n
  };
}

/** Percentile rank of `value` inside `values` (0..100). */
export function percentileRank(values = [], value) {
  const nums = (Array.isArray(values) ? values : []).map(Number).filter(Number.isFinite);
  if (!nums.length || !Number.isFinite(Number(value))) return null;
  let below = 0;
  for (const v of nums) if (v <= Number(value)) below += 1;
  return (below / nums.length) * 100;
}

/** Where price sits inside a low..high band, 0..1 (null when the band is flat). */
export function rangePosition(low, high, price) {
  const lo = Number(low);
  const hi = Number(high);
  const px = Number(price);
  if (![lo, hi, px].every(Number.isFinite) || hi <= lo) return null;
  return Math.min(1, Math.max(0, (px - lo) / (hi - lo)));
}

export const lastValue = (series = []) => {
  for (let i = series.length - 1; i >= 0; i -= 1) if (isNum(series[i])) return series[i];
  return null;
};

/**
 * Swing pivots → support/resistance levels.
 *
 * A pivot high is a bar whose high is the highest in a ±`lookback` window.
 * Levels closer together than `tolerancePct` are one level (weighted by how
 * many pivots landed there), because "two resistances 0.3% apart" is one price
 * the market rejected twice, not two.
 */
export function supportResistance(candles, { lookback = 3, tolerancePct = 1.5, maxLevels = 8 } = {}) {
  const bars = sanitizeCandles(candles);
  if (bars.length < lookback * 2 + 3) return [];
  const raw = [];
  for (let i = lookback; i < bars.length - lookback; i += 1) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - lookback; j <= i + lookback; j += 1) {
      if (j === i) continue;
      if (bars[j].h > bars[i].h) isHigh = false;
      if (bars[j].l < bars[i].l) isLow = false;
    }
    if (isHigh) raw.push({ price: bars[i].h, kind: 'high', t: bars[i].t });
    if (isLow) raw.push({ price: bars[i].l, kind: 'low', t: bars[i].t });
  }
  const tol = Math.max(0.1, Number(tolerancePct)) / 100;
  const clusters = [];
  for (const pivot of raw.sort((a, b) => a.price - b.price)) {
    const hit = clusters.find((c) => Math.abs(pivot.price - c.price) / c.price <= tol);
    if (hit) {
      hit.touches += 1;
      hit.price = (hit.price * (hit.touches - 1) + pivot.price) / hit.touches;
      hit.lastTouchedAt = Math.max(hit.lastTouchedAt, pivot.t);
      hit.kinds.add(pivot.kind);
    } else {
      clusters.push({
        price: pivot.price,
        touches: 1,
        lastTouchedAt: pivot.t,
        kinds: new Set([pivot.kind])
      });
    }
  }
  const close = bars[bars.length - 1].c;
  return clusters
    .map((c) => ({
      price: c.price,
      touches: c.touches,
      lastTouchedAt: c.lastTouchedAt,
      /* A level that held as both support and resistance is the stronger one;
         say so instead of picking whichever pivot landed first. */
      kind: c.kinds.size > 1 ? 'both' : [...c.kinds][0],
      distancePct: close > 0 ? ((c.price - close) / close) * 100 : null
    }))
    .sort((a, b) => b.touches - a.touches || a.price - b.price)
    .slice(0, Math.max(1, Math.trunc(maxLevels)))
    .sort((a, b) => b.price - a.price);
}

/** Nearest level above / below the current price, from supportResistance(). */
export function nearestLevels(levels = [], price) {
  const px = Number(price);
  if (!Number.isFinite(px)) return { support: null, resistance: null };
  const above = levels.filter((l) => l.price > px).sort((a, b) => a.price - b.price);
  const below = levels.filter((l) => l.price < px).sort((a, b) => b.price - a.price);
  return { support: below[0] ?? null, resistance: above[0] ?? null };
}

/** Fibonacci retracement of the last `lookback` bars' swing. */
export function fibonacci(candles, lookback = 90) {
  const bars = sanitizeCandles(candles).slice(-Math.max(3, Math.trunc(lookback)));
  if (bars.length < 3) return null;
  const high = Math.max(...bars.map((b) => b.h));
  const low = Math.min(...bars.map((b) => b.l));
  if (!(high > low)) return null;
  const span = high - low;
  const ratios = [0.236, 0.382, 0.5, 0.618, 0.786];
  const levels = {};
  for (const r of ratios) levels[r] = high - span * r;
  return { high, low, levels, spanPct: (span / low) * 100 };
}

/**
 * One call that returns everything the token screen and the scoring engine
 * need, computed from the same bar set so the chart and the score can never
 * disagree about which candle was last.
 */
export function computeIndicators(rawCandles, { atrPeriod = 14, rsiPeriod = 14 } = {}) {
  const candles = sanitizeCandles(rawCandles);
  const closes = closesOf(candles);
  const n = candles.length;
  const last = n ? candles[n - 1] : null;
  const close = last ? last.c : null;
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const rsi14 = rsi(closes, rsiPeriod);
  const macdPack = macd(closes);
  const bb = bollinger(closes, 20, 2);
  const atr14 = atr(candles, atrPeriod);
  const atrLast = lastValue(atr14);
  const levels = supportResistance(candles);
  const nearest = nearestLevels(levels, close);
  const fit = trendFit(closes, Math.min(30, n));

  const above = (series) => {
    const v = lastValue(series);
    if (!isNum(v) || !isNum(close)) return null;
    return close >= v;
  };
  const trend = (() => {
    if (!fit || n < 20) return { label: 'unknown', strength: 0, slopePct: null, r2: null };
    const slope = fit.slopePct;
    const strength = Math.round(Math.min(100, Math.abs(slope) * 22 * (0.4 + fit.r2 * 0.6) * 10) / 10);
    if (Math.abs(slope) < 0.02 || fit.r2 < 0.08) {
      return { label: 'sideways', strength: Math.min(strength, 35), slopePct: slope, r2: fit.r2 };
    }
    return {
      label: slope > 0 ? 'uptrend' : 'downtrend',
      strength: Math.min(100, strength),
      slopePct: slope,
      r2: fit.r2
    };
  })();

  return {
    version: INDICATOR_VERSION,
    bars: n,
    firstAt: n ? candles[0].t : null,
    lastAt: last ? last.t : null,
    close,
    series: {
      candles,
      sma20,
      sma50,
      sma200,
      ema21: ema(closes, 21),
      bollinger: bb,
      rsi14,
      macd: macdPack
    },
    values: {
      sma20: lastValue(sma20),
      sma50: lastValue(sma50),
      sma200: lastValue(sma200),
      rsi14: lastValue(rsi14),
      macd: lastValue(macdPack.line),
      macdSignal: lastValue(macdPack.signal),
      macdHist: lastValue(macdPack.hist),
      bbPercentB: lastValue(bb.percentB),
      bbBandwidth: lastValue(bb.bandwidth),
      atr14: atrLast,
      atrPct: isNum(atrLast) && isNum(close) && close > 0 ? (atrLast / close) * 100 : null,
      drawdown: maxDrawdown(closes),
      trend
    },
    position: {
      aboveSma20: above(sma20),
      aboveSma50: above(sma50),
      aboveSma200: above(sma200)
    },
    levels,
    nearest,
    fibonacci: fibonacci(candles),
    closeSeries: closes
  };
}
