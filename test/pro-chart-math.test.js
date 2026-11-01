/**
 * PRO CHART MATH — the arithmetic behind the token terminal, pinned.
 * ---------------------------------------------------------------------------
 * These are the numbers a reader makes decisions from: a moving average, a
 * band, an RSI, a Fibonacci level, a volume alignment. They are also the part
 * of a chart that fails silently — an EMA seeded at the wrong point draws a
 * plausible-looking line that is simply not the indicator, and nothing on
 * screen says so.
 *
 * So every case here is either a hand-computable answer or a documented
 * property (a constant series has zero-width bands; a series that only rises
 * has RSI 100; not enough history yields NO points, never a zero).
 *
 * Run: npx vitest run test/pro-chart-math.test.js   (also `npm run test:pro-chart`)
 */
import { expect, it } from 'vitest';
import {
  alignVolumeToCandles,
  averageTrueRange,
  bollingerBands,
  candleSignature,
  candleSpacingMs,
  candlesInLogicalRange,
  exponentialMovingAverage,
  fibLevels,
  intervalLabel,
  macdSeries,
  pricePrecision,
  rangePosition,
  relativeStrengthIndex,
  simpleMovingAverage,
  toCandles,
  windowStats
} from '../src/lib/proChartMath.js';

const bar = (i, close, { high = close + 1, low = close - 1 } = {}) => ({
  t: 1_700_000_000_000 + i * 86_400_000,
  o: close,
  h: high,
  l: low,
  c: close
});

const flat = (values) => values.map((c, i) => ({ time: i + 1, open: c, high: c, low: c, close: c }));

it('toCandles: sorts, dedupes, converts ms to s and drops inverted bars', () => {
  const out = toCandles([
    { t: 3000, o: 3, h: 4, l: 2, c: 3 },
    { t: 1000, o: 1, h: 2, l: 0.5, c: 1 },
    { t: 3000, o: 9, h: 9, l: 9, c: 9 }, // duplicate timestamp
    { t: 2000, o: 2, h: 1.5, l: 2.5, c: 2 }, // high below low
    { t: 4000, o: 4, h: 5, l: 3, c: 4 }
  ]);
  expect(out.map((c) => c.time)).toEqual([1, 3, 4]);
  expect(out[1].close).toBe(3);
});

it('candleSignature: stable for the same bars, changes with the last close', () => {
  const a = [bar(0, 10), bar(1, 11)];
  expect(candleSignature(a)).toBe(candleSignature([...a]));
  const b = [bar(0, 10), bar(1, 12)];
  expect(candleSignature(a)).not.toBe(candleSignature(b));
});

it('candleSpacingMs: median gap, ignoring the odd gap', () => {
  const candles = toCandles([
    { t: 0, o: 1, h: 1, l: 1, c: 1 },
    { t: 900_000, o: 1, h: 1, l: 1, c: 1 },
    { t: 1_800_000, o: 1, h: 1, l: 1, c: 1 },
    { t: 9_000_000, o: 1, h: 1, l: 1, c: 1 }
  ]);
  expect(candleSpacingMs(candles)).toBe(900);
  expect(intervalLabel(900_000)).toBe('15m');
  expect(intervalLabel(4 * 3600_000)).toBe('4h');
  expect(intervalLabel(4 * 86_400_000)).toBe('4d');
  expect(intervalLabel(0)).toBe('—');
});

it('pricePrecision: a meme token and a blue chip do not share decimals', () => {
  expect(pricePrecision(0.0000012)).toBe(8);
  expect(pricePrecision(0.004)).toBe(6);
  expect(pricePrecision(0.42)).toBe(4);
  expect(pricePrecision(42.5)).toBe(3);
  expect(pricePrecision(4200)).toBe(2);
  expect(pricePrecision(0)).toBe(2);
});

it('simpleMovingAverage: exact known answer and no point before a full window', () => {
  const candles = flat([10, 20, 30, 40, 50]);
  expect(simpleMovingAverage(candles, 3)).toEqual([
    { time: 3, value: 20 },
    { time: 4, value: 30 },
    { time: 5, value: 40 }
  ]);
  /* Not enough history is NO data, not a flat line through the first bar. */
  expect(simpleMovingAverage(candles.slice(0, 2), 3)).toEqual([]);
});

it('exponentialMovingAverage: seeds on the SMA of the first window', () => {
  const candles = flat([1, 2, 3, 4, 5]);
  const ema = exponentialMovingAverage(candles, 3);
  expect(ema.length).toBe(3);
  expect(ema[0].time).toBe(3);
  expect(ema[0].value).toBe(2); // SMA(1,2,3)
  /* k = 2/(3+1) = 0.5 → next = 4*0.5 + 2*0.5 */
  expect(ema[1].value).toBe(3);
  expect(ema[2].value).toBe(4);
});

it('bollingerBands: a constant series has zero-width bands', () => {
  const candles = flat(Array.from({ length: 25 }, () => 5));
  const { upper, middle, lower } = bollingerBands(candles, 20, 2);
  expect(middle.length).toBe(6);
  expect(upper.every((p) => Math.abs(p.value - 5) < 1e-12)).toBe(true);
  expect(lower.every((p) => Math.abs(p.value - 5) < 1e-12)).toBe(true);
});

it('bollingerBands: middle is the SMA and the bands are symmetric', () => {
  const closes = [10, 12, 11, 13, 12, 14, 13, 15, 14, 16, 15, 17, 16, 18, 17, 19, 18, 20, 19, 21];
  const candles = flat(closes);
  const { upper, middle, lower } = bollingerBands(candles, 5, 2);
  const sma = simpleMovingAverage(candles, 5);
  expect(middle.length).toBe(sma.length);
  middle.forEach((p, i) => expect(Math.abs(p.value - sma[i].value) < 1e-9).toBe(true));
  upper.forEach((p, i) => {
    const spread = p.value - middle[i].value;
    expect(Math.abs((middle[i].value - lower[i].value) - spread) < 1e-9).toBe(true);
  });
});

it('relativeStrengthIndex: only-up is 100, only-down is 0, flat is 50', () => {
  const up = flat(Array.from({ length: 20 }, (_, i) => i));
  const down = flat(Array.from({ length: 20 }, (_, i) => -i));
  const still = flat(Array.from({ length: 20 }, () => 5));
  expect(relativeStrengthIndex(up, 14).at(-1).value).toBe(100);
  expect(relativeStrengthIndex(down, 14).at(-1).value).toBe(0);
  expect(relativeStrengthIndex(still, 14).at(-1).value).toBe(50);
  /* 14 periods of change need 15 closes; shorter input emits nothing. */
  expect(relativeStrengthIndex(up.slice(0, 14), 14)).toEqual([]);
});

it('relativeStrengthIndex: known 14-period answer', () => {
  const closes = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28];
  const candles = flat(closes);
  const value = relativeStrengthIndex(candles, 14)[0].value;
  /* Wilder's canonical example lands at ~70.5 for this series. */
  expect(value > 69.5 && value < 71.5).toBe(true);
});

it('macdSeries: refuses to draw without enough history, and obeys the identity', () => {
  const short = flat(Array.from({ length: 20 }, (_, i) => i));
  expect(macdSeries(short).macd).toEqual([]);

  const long = flat(Array.from({ length: 80 }, (_, i) => i + (i % 3)));
  const { macd, signal, histogram } = macdSeries(long);
  expect(macd.length > 0 && signal.length > 0).toBe(true);
  const lastMacd = macd.at(-1);
  const lastSignal = signal.at(-1);
  const lastHist = histogram.at(-1);
  expect(lastHist.time).toBe(lastSignal.time);
  expect(Math.abs(lastHist.value - (lastMacd.value - lastSignal.value)) < 1e-9).toBe(true);
});

it('averageTrueRange: measured in price and as a share of the last close', () => {
  const candles = [
    { time: 1, open: 10, high: 12, low: 9, close: 11 },
    { time: 2, open: 11, high: 13, low: 10, close: 12 }
  ];
  const atr = averageTrueRange(candles, 14);
  /* TR of the second bar: max(3, |13-11|, |10-11|) = 3 */
  expect(atr.value).toBe(3);
  expect(Math.abs(atr.pct - (3 / 12) * 100) < 1e-9).toBe(true);
});

it('windowStats: stats describe the window it was given', () => {
  const candles = [
    { time: 1, open: 10, high: 12, low: 9, close: 11 },
    { time: 2, open: 11, high: 15, low: 8, close: 14 }
  ];
  const stats = windowStats(candles);
  expect(stats.high).toBe(15);
  expect(stats.low).toBe(8);
  expect(stats.bars).toBe(2);
  expect(stats.changePct).toBe(40); // 10 → 14
  expect(stats.rangePct).toBe(87.5); // 8 → 15
  expect(windowStats([])).toBe(null);
});

it('fibLevels: top-down, 0 = high, 1 = low, symmetric around 0.5', () => {
  const levels = fibLevels(200, 100);
  expect(levels[0].price).toBe(200);
  expect(levels.at(-1).price).toBe(100);
  expect(levels.find((l) => l.ratio === 0.5).price).toBe(150);
  expect(fibLevels(100, 100)).toEqual([]);
});

it('rangePosition: where a price sits inside its own range', () => {
  expect(rangePosition(150, 200, 100)).toBe(50);
  expect(rangePosition(100, 200, 100)).toBe(0);
  expect(rangePosition(200, 200, 100)).toBe(100);
  expect(rangePosition(500, 200, 100)).toBe(100); // clamped
  expect(rangePosition(150, 100, 100)).toBe(0); // zero range, no NaN
});

it('candlesInLogicalRange: fractional logical indices resolve to real bars', () => {
  const candles = Array.from({ length: 10 }, (_, i) => ({ time: i + 1 }));
  /* Partial bars at both edges are INCLUDED: a half-visible candle is still
     on screen, and dropping it would contradict the high the axis shows. */
  expect(candlesInLogicalRange(candles, { from: 2.4, to: 5.2 }).length).toBe(5);
  expect(candlesInLogicalRange(candles, null).length).toBe(10);
  expect(candlesInLogicalRange(candles, { from: 8, to: 2 })).toEqual([]);
  /* A window running past either end is clamped, not extended with nulls. */
  expect(candlesInLogicalRange(candles, { from: -5, to: 50 }).length).toBe(10);
});

it('alignVolumeToCandles: takes the reading at the candle, not a sum of samples', () => {
  const candles = toCandles([
    { t: 0, o: 1, h: 1, l: 1, c: 1 },
    { t: 3_600_000, o: 1, h: 1, l: 1, c: 1 },
    { t: 7_200_000, o: 1, h: 1, l: 1, c: 1 }
  ]);
  const volume = [
    { t: 0, v: 100 },
    { t: 1_800_000, v: 180 },
    { t: 3_600_000, v: 200 },
    { t: 5_400_000, v: 260 },
    { t: 7_200_000, v: 300 },
    /* Four candles away from any bar — a guess, so it is skipped. */
    { t: 90_000_000, v: 999 }
  ];
  expect(alignVolumeToCandles(volume, candles)).toEqual([
    { time: 0, value: 100 },
    { time: 3600, value: 200 },
    { time: 7200, value: 300 }
  ]);
});
