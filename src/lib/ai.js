/**
 * AI market analysis.
 *
 * WHAT THIS ACTUALLY IS — read before trusting a single number it outputs.
 *
 * These are classical technical indicators (RSI, MACD, Bollinger, moving
 * averages, momentum, volatility) computed on real price history and combined
 * into a weighted score. That is genuinely useful for summarising what a chart
 * is doing right now, and it is what most "AI trading signal" products are
 * underneath.
 *
 * It is NOT a price oracle and cannot see the future. Markets are close to a
 * random walk at short horizons and no indicator set predicts them reliably.
 * Every output carries a confidence figure derived from how much the
 * indicators agree — when they disagree, confidence drops and the UI says so
 * instead of inventing certainty.
 */

/* -------------------------------------------------------------------------- */
/* Indicators                                                                 */
/* -------------------------------------------------------------------------- */

export function sma(values, period) {
  if (values.length < period) return null;
  return values.slice(-period).reduce((a, b) => a + b, 0) / period;
}

export function ema(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

/** Relative Strength Index, Wilder's smoothing. */
export function rsi(values, period = 14) {
  if (values.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gains += d;
    else losses -= d;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(0, d)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -d)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

/** Full EMA series (one value per input point after the seed window). */
function emaSeries(values, period) {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const out = [e];
  for (let i = period; i < values.length; i++) {
    e = values[i] * k + e * (1 - k);
    out.push(e);
  }
  return out;
}

/**
 * MACD line, signal line and histogram.
 *
 * Both EMAs are advanced over the same series so the fast/slow pair stays
 * aligned in time. An earlier version recomputed each EMA from scratch per
 * step, which made the signal line converge onto the MACD line and left the
 * histogram permanently at ~0 — the indicator silently contributed nothing.
 */
export function macd(values, fast = 12, slow = 26, signalPeriod = 9) {
  if (values.length < slow + signalPeriod) return null;

  const fastSeries = emaSeries(values, fast);
  const slowSeries = emaSeries(values, slow);
  if (!fastSeries.length || !slowSeries.length) return null;

  // align: the slow EMA starts later, so trim the fast one from the front
  const offset = fastSeries.length - slowSeries.length;
  const macdLine = slowSeries.map((sv, i) => fastSeries[i + offset] - sv);

  if (macdLine.length < signalPeriod) return null;
  const signalSeries = emaSeries(macdLine, signalPeriod);

  const line = macdLine[macdLine.length - 1];
  const signal = signalSeries[signalSeries.length - 1];
  return { line, signal, histogram: line - signal };
}

/** Bollinger Bands plus %B position within them. */
export function bollinger(values, period = 20, mult = 2) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const sd = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
  const upper = mean + mult * sd;
  const lower = mean - mult * sd;
  const price = values[values.length - 1];
  return {
    upper,
    lower,
    mean,
    width: ((upper - lower) / mean) * 100,
    percentB: upper === lower ? 0.5 : (price - lower) / (upper - lower)
  };
}

/** Annualised volatility from log returns. */
export function volatility(values, periodsPerYear = 365) {
  if (values.length < 3) return null;
  const rets = [];
  for (let i = 1; i < values.length; i++) {
    if (values[i - 1] > 0) rets.push(Math.log(values[i] / values[i - 1]));
  }
  if (rets.length < 2) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(periodsPerYear) * 100;
}

/** Support and resistance from local extrema. */
export function levels(values, lookback = 5) {
  if (values.length < lookback * 2 + 1) return { support: null, resistance: null };
  const highs = [];
  const lows = [];
  for (let i = lookback; i < values.length - lookback; i++) {
    const w = values.slice(i - lookback, i + lookback + 1);
    const v = values[i];
    if (v === Math.max(...w)) highs.push(v);
    if (v === Math.min(...w)) lows.push(v);
  }
  const price = values[values.length - 1];
  return {
    resistance: highs.filter((h) => h > price).sort((a, b) => a - b)[0] ?? Math.max(...values),
    support: lows.filter((l) => l < price).sort((a, b) => b - a)[0] ?? Math.min(...values)
  };
}

/* -------------------------------------------------------------------------- */
/* Composite signal                                                           */
/* -------------------------------------------------------------------------- */

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Combine indicators into one score in [-100, +100].
 *
 * Weights are fixed and hand-chosen, deliberately NOT fitted to historical
 * data — fitting them produces impressive backtests and useless live results.
 */
export function analyze(prices, coin = {}) {
  const values = (prices ?? []).filter((n) => Number.isFinite(n) && n > 0);
  if (values.length < 30) return null;

  const price = values[values.length - 1];
  const r = rsi(values, 14);
  const m = macd(values);
  const bb = bollinger(values);
  const vol = volatility(values);
  const lv = levels(values);
  const ma20 = sma(values, 20);
  const ma50 = values.length >= 50 ? sma(values, 50) : null;

  const signals = [];

  if (r != null) {
    let score = 0;
    if (r < 30) score = 70;
    else if (r < 45) score = 25;
    else if (r > 70) score = -70;
    else if (r > 55) score = -25;
    signals.push({ key: 'rsi', score, weight: 1.1, value: r });
  }

  if (m) {
    signals.push({
      key: 'macd',
      score: clamp((m.histogram / price) * 8000, -100, 100),
      weight: 1.2,
      value: m.histogram
    });
  }

  if (bb) {
    signals.push({
      key: 'bollinger',
      score: clamp((0.5 - bb.percentB) * 180, -100, 100),
      weight: 0.9,
      value: bb.percentB
    });
  }

  if (ma20) {
    const dev = ((price - ma20) / ma20) * 100;
    signals.push({ key: 'ma20', score: clamp(dev * 8, -100, 100), weight: 1.0, value: dev });
  }

  if (ma50 && ma20) {
    const cross = ((ma20 - ma50) / ma50) * 100;
    signals.push({ key: 'cross', score: clamp(cross * 10, -100, 100), weight: 1.3, value: cross });
  }

  const change24h = Number(coin.change24h) || 0;
  const change7d = Number(coin.change7d) || 0;
  signals.push({
    key: 'momentum',
    score: clamp(change7d * 3 + change24h * 2, -100, 100),
    weight: 0.8,
    value: change7d
  });

  const totalWeight = signals.reduce((a, s) => a + s.weight, 0);
  const raw = signals.reduce((a, s) => a + s.score * s.weight, 0) / totalWeight;

  // Confidence = indicator agreement. Wide disagreement means the chart isn't
  // saying anything clear, and we report that rather than faking conviction.
  const mean = signals.reduce((a, s) => a + s.score, 0) / signals.length;
  const spread = Math.sqrt(signals.reduce((a, s) => a + (s.score - mean) ** 2, 0) / signals.length);
  const agreement = clamp(100 - spread, 0, 100);
  const volPenalty = vol ? clamp(vol / 4, 0, 35) : 0;
  const confidence = clamp(agreement * 0.75 + Math.abs(raw) * 0.25 - volPenalty, 5, 88);

  const label =
    raw > 40 ? 'strongBuy' : raw > 12 ? 'buy' : raw < -40 ? 'strongSell' : raw < -12 ? 'sell' : 'neutral';

  return {
    score: Math.round(raw),
    label,
    confidence: Math.round(confidence),
    price,
    indicators: {
      rsi: r,
      macd: m,
      bollinger: bb,
      volatility: vol,
      ma20,
      ma50,
      support: lv.support,
      resistance: lv.resistance
    },
    signals: signals.map((s) => ({ ...s, score: Math.round(s.score) }))
  };
}

/**
 * Projected range for a horizon, derived from realised volatility.
 *
 * This is a VOLATILITY CONE, not a forecast: it says "if this asset keeps
 * moving as it has been, roughly 68% of outcomes land inside this band". The
 * honest content is the width of the range, not the direction of the midpoint.
 */
export function projectRange(analysis, days = 7) {
  if (!analysis?.indicators?.volatility) return null;
  const { price } = analysis;
  const horizonVol = (analysis.indicators.volatility / 100) * Math.sqrt(days / 365);
  const drift = (analysis.score / 100) * horizonVol * 0.35;
  const mid = price * (1 + drift);

  return {
    days,
    low: mid * (1 - horizonVol),
    mid,
    high: mid * (1 + horizonVol),
    probability: 68
  };
}

/** Fear & Greed style gauge from global market stats. */
export function marketSentiment(global) {
  if (!global) return null;
  const score = clamp(
    50 + (Number(global.mcapChange) || 0) * 6 + (Number(global.avgChange) || 0) * 3 + (Number(global.volumeChange) || 0) * 0.4,
    0,
    100
  );
  const label =
    score > 75 ? 'extremeGreed' : score > 58 ? 'greed' : score < 25 ? 'extremeFear' : score < 42 ? 'fear' : 'neutral';
  return { score: Math.round(score), label };
}
