#!/usr/bin/env node
/**
 * THE DESK CHART — volume, VWAP and Heikin Ashi, pinned.
 * ---------------------------------------------------------------------------
 * PROBE (`node --test test/perp-chart-source-probe.mjs`).
 *
 * The terminal's chart is the one place on the desk where "we have the data"
 * and "we drew something" can drift apart without an error. Three things are
 * asserted here, and each of them is a place where the easy code is the lying
 * code:
 *
 *   1. BAR VOLUME IS CARRIED, NOT RECOVERED. `/api/dydx/candles` puts
 *      `baseTokenVolume` in `volume`; the spot fallback's `v` used to be
 *      dropped on the floor. A VWAP needs that number, so the mapping is
 *      checked at the source (the component), not assumed.
 *   2. VWAP REFUSES rather than approximates. No volume, or a bar whose
 *      nearest reading is outside one candle's spacing → no line. A VWAP
 *      stitched across a gap is a line that means nothing.
 *   3. HEIKIN ASHI IS A SOURCE, NOT A TINT. It has its own transform, it keeps
 *      the timestamps (so overlays and the crosshair still line up), and the
 *      chart re-mounts when it is toggled — which is only correct if the
 *      transform itself is pure and total.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  toHeikinAshi, volumeWeightedAveragePrice, alignVolumeToCandles, candleSpacingMs
} from '../src/lib/proChartMath.js';

const read = (p) => fs.readFileSync(`${process.cwd()}/${p}`, 'utf8');

/* ─────────────────── 1 · THE VOLUME MAPPING ─────────────────────────────── */

test('the chart component carries bar volume through, and does not invent one', () => {
  const src = read('src/components/FuturesMarketChart.jsx');
  /* spot fallback: the market feed sends `v`, and it must survive the map */
  assert.match(src, /startedAt: d\.t.*close: d\.c, volume: d\.v/s, 'spot bar volume is dropped');
  /* futures bars: only a POSITIVE, finite volume becomes `v` */
  assert.match(src, /Number\.isFinite\(v\) && v > 0 \? \{ v \} : \{\}/, 'a zero volume is written as if it were a reading');
  /* the count is passed to the chart so it can disable VWAP honestly */
  assert.match(src, /barsWithVolume=\{barsWithVolume\}/);
  /* and the api route really does fill `volume` from the venue field */
  const app = read('server/app.js');
  assert.match(app, /volume: Number\(c\.baseTokenVolume\)/, 'the dYdX route stopped emitting volume');
});

/* ─────────────────── 2 · VWAP REFUSES ───────────────────────────────────── */

const bar = (i, o = 100, h = 101, l = 99, c = 100) => ({ time: 1_700_000_000 + i * 3600, open: o, high: h, low: l, close: c });

test('VWAP needs one volume per candle, in the same order', () => {
  const candles = [bar(0), bar(1), bar(2)];
  assert.equal(volumeWeightedAveragePrice(candles, []).length, 0, 'no volume → no line');
  assert.equal(volumeWeightedAveragePrice(candles, [1, 2]).length, 0, 'short array → no line, not a partial one');
  assert.equal(volumeWeightedAveragePrice([], []).length, 0);

  const full = volumeWeightedAveragePrice(candles, [1, 1, 1]);
  assert.equal(full.length, 3);
  /* every bar identical → the VWAP is the typical price, exactly */
  const typical = (101 + 99 + 100) / 3;
  for (const p of full) assert.ok(Math.abs(p.value - typical) < 1e-9);
});

test('VWAP weights by volume instead of averaging the closes', () => {
  /* two bars, hugely unequal volume: the answer must sit next to the heavy one */
  const candles = [
    { time: 1_700_000_000, open: 90, high: 91, low: 89, close: 90 },
    { time: 1_700_003_600, open: 200, high: 201, low: 199, close: 200 }
  ];
  const out = volumeWeightedAveragePrice(candles, [1, 99]);
  const last = out[out.length - 1].value;
  const avgOfCloses = (90 + 200) / 2;
  assert.ok(last > 150, `VWAP ${last} is not weighted`);
  assert.notEqual(last, avgOfCloses, 'a plain average was returned');
  /* and it is a weighted mean of the TYPICAL prices, computed independently */
  const w = (90 * 1 + 200 * 99) / 100;
  assert.ok(Math.abs(last - w) < 1e-9, `${last} != ${w}`);
});

test('VWAP skips a bar with no volume rather than treating it as zero', () => {
  const candles = [bar(0, 100, 101, 99, 100), bar(1, 100, 101, 99, 100), bar(2, 100, 101, 99, 100)];
  const out = volumeWeightedAveragePrice(candles, [5, 0, 5]);
  /* the zero-volume bar contributes no point of its own once a value exists,
     and the running VWAP is unchanged by it */
  const prices = new Set(out.map((p) => p.value.toFixed(6)));
  assert.equal(prices.size, 1, 'a zero-volume bar moved the average');
});

test('alignVolumeToCandles refuses a reading from another window', () => {
  const candles = [bar(0), bar(1), bar(2)];
  const spacing = candleSpacingMs(candles);
  assert.equal(spacing, 3600, 'spacing is seconds');
  /* one reading per bar → full alignment */
  const aligned = alignVolumeToCandles(candles.map((c) => ({ t: c.time * 1000, v: 7 })), candles);
  assert.equal(aligned.length, 3);
  /* a single reading, hours away, must NOT be smeared across every bar */
  const far = alignVolumeToCandles([{ t: candles[0].time * 1000 - 5 * 3600 * 1000, v: 7 }], candles);
  assert.equal(far.length, 0, 'a mismatched window was aligned anyway');
});

/* ─────────────────── 3 · HEIKIN ASHI IS A SOURCE ────────────────────────── */

test('Heikin Ashi keeps the timestamps and starts from the real first bar', () => {
  const candles = [
    { time: 100, open: 10, high: 12, low: 9, close: 11 },
    { time: 200, open: 11, high: 13, low: 10, close: 12 }
  ];
  const ha = toHeikinAshi(candles);
  assert.equal(ha.length, 2);
  assert.deepEqual(ha.map((c) => c.time), [100, 200], 'the crosshair and overlays would drift');
  /* first bar: open = (o+c)/2, close = (o+h+l+c)/4 */
  assert.equal(ha[0].open, 10.5);
  assert.equal(ha[0].close, (10 + 12 + 9 + 11) / 4);
  /* second bar: open = average of the previous HA bar, not of the raw one */
  assert.equal(ha[1].open, (ha[0].open + ha[0].close) / 2);
  /* the HA high/low always CONTAIN the HA open and close, by construction */
  for (const c of ha) {
    assert.ok(c.high >= Math.max(c.open, c.close));
    assert.ok(c.low <= Math.min(c.open, c.close));
  }
});

test('Heikin Ashi drops a bar it cannot read instead of guessing it', () => {
  const ha = toHeikinAshi([
    { time: 1, open: 10, high: 12, low: 9, close: 11 },
    { time: 2, open: null, high: 13, low: 10, close: 12 },
    { time: 3, open: 12, high: 14, low: 11, close: 13 }
  ]);
  assert.deepEqual(ha.map((c) => c.time), [1, 3]);
  /* the unreadable bar is skipped, and the NEXT bar's open comes from the last
     bar that was actually read — not from a half-filled placeholder */
  assert.equal(ha[1].open, (ha[0].open + ha[0].close) / 2, 'the chain was contaminated by a missing bar');
});

test('the chart toggles off by default and says when it cannot offer VWAP', () => {
  const src = read('src/components/TradingChart.jsx');
  assert.match(src, /const \[heikin, setHeikin\] = useState\(false\)/, 'HA must be opt-in');
  assert.match(src, /const \[showVwap, setShowVwap\] = useState\(false\)/, 'VWAP must be opt-in');
  /* the drawn series is the transformed one, and the MAs follow it */
  assert.match(src, /toHeikinAshi\(candles\)/);
  assert.match(src, /candle\.setData\(drawn\)/);
  assert.match(src, /ma7\.setData\(ma\(drawn, 7\)\)/);
  assert.match(src, /ma25\.setData\(ma\(drawn, 25\)\)/);
  /* the toggle is disabled, not hidden, when there is no volume to average */
  assert.match(src, /disabled=\{vwap\.length < 2\}/);
  /* and a re-mount is triggered by the source change */
  assert.match(src, /\}, \[heikin\]\);/);
});
