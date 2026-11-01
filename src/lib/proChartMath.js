/**
 * PRO CHART MATH — every number the token chart draws, as pure functions.
 * ---------------------------------------------------------------------------
 * The candlestick terminal on the coin page (src/components/ProChart) needs
 * moving averages, Bollinger bands, RSI, MACD, ATR, Fibonacci levels, candle
 * spacing and window statistics. None of those belong inside a React
 * component: they are arithmetic over an array, they are the part most likely
 * to be wrong, and they are the part that can be tested without a browser.
 *
 * So they live here, with three rules that keep them honest:
 *
 *   1. NO FABRICATION. Every value is derived from candles the feed actually
 *      returned. A period with not enough history produces NO point (a
 *      shorter array), never a zero or a copied close. A chart that draws a
 *      flat MA line through the first 25 candles of a 25-candle series is
 *      telling the reader something the data never said.
 *   2. NO LOCALE, NO DOM, NO CLOCK. `toLocaleString` for numbers would make
 *      this module depend on i18n; the components format. Time is taken from
 *      the candles, never from `Date.now()`, so the same input always yields
 *      the same output (and the tests can pin it).
 *   3. DEGENERATE INPUT IS NORMAL INPUT. A stablecoin's candles are all
 *      equal, a two-point 1-day range has one bar of history, a delisted
 *      token has a zero close. Division by a zero range returns 0, not NaN.
 */

/** Milliseconds in one candle, when the feed gives us anything we can measure. */
export function candleSpacingMs(candles) {
  const src = Array.isArray(candles) ? candles : [];
  if (src.length < 2) return 0;
  const diffs = [];
  for (let i = 1; i < src.length; i++) {
    const d = src[i].time - src[i - 1].time;
    if (Number.isFinite(d) && d > 0) diffs.push(d);
  }
  if (!diffs.length) return 0;
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)];
}

/**
 * Human label for the real spacing of the candles on screen.
 *
 * This is measured from the data, not assumed: the CoinGecko OHLC endpoint
 * decides the interval from `days` (30 minutes for one day, four hours for a
 * week or a month, four days beyond that), so hard-coding "4h" beside a
 * request for 90 days would print a number the chart does not have.
 */
export function intervalLabel(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '—';
  const minutes = n / 60000;
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = n / 3600000;
  if (hours < 24) return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
  const days = n / 86400000;
  return `${Number.isInteger(days) ? days : days.toFixed(1)}d`;
}

/**
 * Decimals the price scale should show.
 *
 * A $0.0000012 token and a $64,000 coin cannot share a `minMove`; the library
 * rejects a minMove finer than the precision allows and the axis either
 * collapses to integers or shows float noise.
 */
export function pricePrecision(price) {
  const p = Math.abs(Number(price));
  if (!Number.isFinite(p) || p === 0) return 2;
  if (p < 0.00001) return 8;
  if (p < 0.01) return 6;
  if (p < 1) return 4;
  if (p < 100) return 3;
  return 2;
}

/**
 * Normalise the API's `{ t, o, h, l, c }` rows into what the chart library
 * accepts: seconds (not milliseconds), ascending, unique timestamps.
 *
 * The library THROWS on a duplicate or out-of-order timestamp rather than
 * ignoring it, so one duplicated row from an upstream hiccup would take the
 * whole chart down. Filtering here means a bad row costs a candle, not the
 * screen. Rows whose high is below their low are dropped for the same reason
 * (they draw inverted and read as a rendering bug) — the same rule the server
 * already applies in fetchOhlc.
 */
export function toCandles(raw) {
  const rows = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const out = [];
  for (const d of rows) {
    if (!d || ![d.t, d.o, d.h, d.l, d.c].every(Number.isFinite)) continue;
    if (d.h < d.l || d.l <= 0) continue;
    const time = Math.floor(d.t / 1000);
    if (!Number.isFinite(time) || seen.has(time)) continue;
    seen.add(time);
    out.push({ time, open: d.o, high: d.h, low: d.l, close: d.c });
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}

/**
 * A cheap identity for a candle series.
 *
 * `useOhlc` polls every 60 seconds and returns a NEW array each time, with
 * almost always the same bars. Keying the chart's rebuild on the array
 * identity would throw away the user's zoom and pan once a minute — the exact
 * "it keeps resetting" feel that makes a chart unusable. The signature
 * changes only when the shape changes or the latest close moves, so a poll
 * that brings nothing new costs nothing.
 */
export function candleSignature(raw) {
  const rows = Array.isArray(raw) ? raw : [];
  if (!rows.length) return '0';
  const first = rows[0];
  const last = rows[rows.length - 1];
  return [rows.length, first?.t, last?.t, last?.c].join(':');
}

/** Simple moving average, emitted only once a full window exists. */
export function simpleMovingAverage(candles, period) {
  const src = Array.isArray(candles) ? candles : [];
  const n = Math.max(1, Math.floor(Number(period) || 0));
  if (src.length < n || n < 1) return [];
  const out = [];
  let sum = 0;
  for (let i = 0; i < src.length; i++) {
    sum += src[i].close;
    if (i >= n) sum -= src[i - n].close;
    if (i >= n - 1) out.push({ time: src[i].time, value: sum / n });
  }
  return out;
}

/**
 * Exponential moving average, seeded with the SMA of the first window.
 *
 * Seedling on the first close instead (a common shortcut) biases the first
 * dozens of points toward that single bar; over a 500-bar history the line
 * then takes a visible detour that is an artefact of the formula, not of the
 * price.
 */
export function exponentialMovingAverage(candles, period) {
  const src = Array.isArray(candles) ? candles : [];
  const n = Math.max(1, Math.floor(Number(period) || 0));
  if (src.length < n || n < 1) return [];
  const k = 2 / (n + 1);
  const out = [];
  let sum = 0;
  for (let i = 0; i < n; i++) sum += src[i].close;
  let prev = sum / n;
  out.push({ time: src[n - 1].time, value: prev });
  for (let i = n; i < src.length; i++) {
    prev = src[i].close * k + prev * (1 - k);
    out.push({ time: src[i].time, value: prev });
  }
  return out;
}

/**
 * Bollinger bands: SMA(period) ± mult standard deviations of the CLOSE.
 *
 * Population standard deviation (divide by n), which is what the indicator
 * conventionally uses and what every other chart on the internet shows — a
 * sample deviation would put our bands a hair inside everyone else's and
 * "the bands are slightly different here" is not a conversation worth having.
 */
export function bollingerBands(candles, period = 20, mult = 2) {
  const src = Array.isArray(candles) ? candles : [];
  const n = Math.max(2, Math.floor(Number(period) || 20));
  const m = Number.isFinite(Number(mult)) ? Number(mult) : 2;
  if (src.length < n) return { upper: [], middle: [], lower: [] };

  const middle = [];
  const upper = [];
  const lower = [];

  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i].close;
    sum += c;
    sumSq += c * c;
    if (i >= n) {
      const old = src[i - n].close;
      sum -= old;
      sumSq -= old * old;
    }
    if (i >= n - 1) {
      const mean = sum / n;
      const variance = Math.max(0, sumSq / n - mean * mean);
      const sd = Math.sqrt(variance);
      const time = src[i].time;
      middle.push({ time, value: mean });
      upper.push({ time, value: mean + m * sd });
      lower.push({ time, value: mean - m * sd });
    }
  }
  return { upper, middle, lower };
}

/**
 * RSI (Wilder). Emits its first value after `period + 1` candles, because a
 * change needs two closes and an average needs `period` changes.
 */
export function relativeStrengthIndex(candles, period = 14) {
  const src = Array.isArray(candles) ? candles : [];
  const n = Math.max(2, Math.floor(Number(period) || 14));
  if (src.length <= n) return [];

  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const diff = src[i].close - src[i - 1].close;
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  let avgGain = gain / n;
  let avgLoss = loss / n;

  const out = [];
  const push = (time) => {
    if (avgLoss === 0 && avgGain === 0) out.push({ time, value: 50 });
    else if (avgLoss === 0) out.push({ time, value: 100 });
    else out.push({ time, value: 100 - 100 / (1 + avgGain / avgLoss) });
  };
  push(src[n].time);

  for (let i = n + 1; i < src.length; i++) {
    const diff = src[i].close - src[i - 1].close;
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (n - 1) + g) / n;
    avgLoss = (avgLoss * (n - 1) + l) / n;
    push(src[i].time);
  }
  return out;
}

/** MACD line, signal line and histogram (12/26/9 by default). */
export function macdSeries(candles, fast = 12, slow = 26, signal = 9) {
  const src = Array.isArray(candles) ? candles : [];
  if (src.length < slow + signal) return { macd: [], signal: [], histogram: [] };

  const fastEma = exponentialMovingAverage(src, fast);
  const slowEma = exponentialMovingAverage(src, slow);
  const slowByTime = new Map(slowEma.map((p) => [p.time, p.value]));

  const macd = [];
  for (const point of fastEma) {
    const slowValue = slowByTime.get(point.time);
    if (slowValue == null) continue;
    macd.push({ time: point.time, value: point.value - slowValue });
  }
  if (macd.length < signal) return { macd: [], signal: [], histogram: [] };

  const k = 2 / (signal + 1);
  const signalLine = [];
  let sum = 0;
  for (let i = 0; i < signal; i++) sum += macd[i].value;
  let prev = sum / signal;
  signalLine.push({ time: macd[signal - 1].time, value: prev });
  for (let i = signal; i < macd.length; i++) {
    prev = macd[i].value * k + prev * (1 - k);
    signalLine.push({ time: macd[i].time, value: prev });
  }

  const signalByTime = new Map(signalLine.map((p) => [p.time, p.value]));
  const histogram = [];
  for (const point of macd) {
    const sig = signalByTime.get(point.time);
    if (sig == null) continue;
    histogram.push({ time: point.time, value: point.value - sig, color: point.value - sig >= 0 ? '#26a69a' : '#ef5350' });
  }
  return { macd, signal: signalLine, histogram };
}

/**
 * ATR — average true range, in price and as a share of the last close.
 *
 * "How much does this thing actually move per candle" is the number that
 * makes a volatility percentage comparable between a $0.000001 token and
 * Bitcoin. Returns 0 for a series too short to have a range.
 */
export function averageTrueRange(candles, period = 14) {
  const src = Array.isArray(candles) ? candles : [];
  const n = Math.max(1, Math.floor(Number(period) || 14));
  if (src.length < 2) return { value: 0, pct: 0 };
  const start = Math.max(1, src.length - n);
  let sum = 0;
  let count = 0;
  for (let i = start; i < src.length; i++) {
    const prevClose = src[i - 1].close;
    const tr = Math.max(
      src[i].high - src[i].low,
      Math.abs(src[i].high - prevClose),
      Math.abs(src[i].low - prevClose)
    );
    if (Number.isFinite(tr)) {
      sum += tr;
      count += 1;
    }
  }
  if (!count) return { value: 0, pct: 0 };
  const value = sum / count;
  const lastClose = src[src.length - 1].close;
  return { value, pct: lastClose > 0 ? (value / lastClose) * 100 : 0 };
}

/**
 * Statistics for whatever is on screen.
 *
 * Called with the candles inside the current zoom window, so "high" means
 * "high of what you are looking at" — the number a trader reads off the axis,
 * not the high of a range they scrolled away from.
 */
export function windowStats(candles) {
  const src = Array.isArray(candles) ? candles : [];
  if (!src.length) return null;
  let high = -Infinity;
  let low = Infinity;
  for (const c of src) {
    if (c.high > high) high = c.high;
    if (c.low < low) low = c.low;
  }
  const first = src[0].open;
  const last = src[src.length - 1].close;
  const changePct = first > 0 ? ((last - first) / first) * 100 : 0;
  const rangePct = low > 0 ? ((high - low) / low) * 100 : 0;
  const atr = averageTrueRange(src, Math.min(14, src.length));
  return {
    bars: src.length,
    high,
    low,
    first,
    last,
    changePct,
    rangePct,
    atr: atr.value,
    atrPct: atr.pct,
    from: src[0].time,
    to: src[src.length - 1].time
  };
}

/**
 * Fibonacci retracement levels for a measured move.
 *
 * `high`/`low` are the extremes of the window being annotated — the caller
 * decides the window, this only does the arithmetic. Returned top-down so a
 * legend can list them in the order they appear on the price axis.
 */
export function fibLevels(high, low) {
  const h = Number(high);
  const l = Number(low);
  if (!Number.isFinite(h) || !Number.isFinite(l) || h <= l) return [];
  const span = h - l;
  return [
    { ratio: 0, price: h, label: '0' },
    { ratio: 0.236, price: h - span * 0.236, label: '0.236' },
    { ratio: 0.382, price: h - span * 0.382, label: '0.382' },
    { ratio: 0.5, price: h - span * 0.5, label: '0.5' },
    { ratio: 0.618, price: h - span * 0.618, label: '0.618' },
    { ratio: 0.786, price: h - span * 0.786, label: '0.786' },
    { ratio: 1, price: l, label: '1' }
  ];
}

/**
 * Where a price sits inside its own range — the "% of range" chip in the
 * legend. 0 means the low of the window, 100 the high.
 */
export function rangePosition(price, high, low) {
  const p = Number(price);
  const h = Number(high);
  const l = Number(low);
  if (![p, h, l].every(Number.isFinite) || h <= l) return 0;
  return Math.min(100, Math.max(0, ((p - l) / (h - l)) * 100));
}

/**
 * The slice of candles between two logical indices, for the visible-window
 * statistics. Logical indices are what the chart's time scale reports and can
 * be fractional; -1 means "before the first bar".
 */
export function candlesInLogicalRange(candles, range) {
  const src = Array.isArray(candles) ? candles : [];
  if (!src.length) return [];
  if (!range || !Number.isFinite(range.from) || !Number.isFinite(range.to)) return src;
  const from = Math.max(0, Math.floor(range.from));
  const to = Math.min(src.length - 1, Math.ceil(range.to));
  if (to < from) return [];
  return src.slice(from, to + 1);
}

/**
 * Bucket a rolling volume series onto candle timestamps.
 *
 * CoinGecko's `market_chart.total_volumes` is a ROLLING 24-hour figure per
 * timestamp, not the volume of that bar. Summing it into buckets would
 * multiply the real number by the number of samples per bucket; drawing it as
 * per-candle volume would be flat and wrong. So each candle takes the reading
 * closest to its close, and the pane is labelled "24h volume" — the number
 * that is actually in the feed.
 */
export function alignVolumeToCandles(volume, candles) {
  const vols = Array.isArray(volume) ? volume.filter((v) => Number.isFinite(v?.t) && Number.isFinite(v?.v)) : [];
  const src = Array.isArray(candles) ? candles : [];
  if (!vols.length || !src.length) return [];
  const sorted = [...vols].sort((a, b) => a.t - b.t);
  const out = [];
  let cursor = 0;
  for (const candle of src) {
    const target = candle.time * 1000;
    while (cursor + 1 < sorted.length && sorted[cursor + 1].t <= target) cursor += 1;
    const here = sorted[cursor];
    const next = sorted[cursor + 1];
    const chosen = next && Math.abs(next.t - target) < Math.abs(here.t - target) ? next : here;
    /* A reading from a different window is not this candle's volume. With a
       four-hour candle and a daily feed the nearest sample can be hours away;
       anything beyond one candle is a guess, so it is skipped. */
    const spacing = candleSpacingMs(src) || 0;
    if (spacing && Math.abs(chosen.t - target) > spacing) continue;
    out.push({ time: candle.time, value: chosen.v });
  }
  return out;
}
