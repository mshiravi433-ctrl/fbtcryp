/**
 * «گذشته چه می‌گوید» — the new measurements, and the strings that name them.
 * ---------------------------------------------------------------------------
 * Asked for: «گذشته چه می‌گوید را باکس را مدرن‌تر و اطلاعات را بهتر و باهوش‌تر و
 * درست‌تر کن و با تحلیل‌های به‌روز و درست‌تر کن».
 *
 * Three things had to be true for that to be an improvement rather than a
 * redecorated box:
 *
 *   1. THE NEW NUMBERS ARE MEASUREMENTS. A typical day, a streak, how much of
 *      the window sat above its own average, how far the fall was given back,
 *      how close the nearest level is — each one is arithmetic over closes that
 *      already printed, and each reports the sample it came from. Nothing here
 *      forecasts, and `kind` still has no buy/sell value.
 *   2. THE PANEL CAN SAY EVERYTHING IT MEASURES. A fact whose id has no
 *      translation prints ITS OWN KEY on screen — the same class of defect as
 *      the loan screen's `loan.healthFactorNow`, and the same fix: assert it.
 *   3. THE EQUITY BOXES STOPPED PRINTING KEYS TOO. GoldHistoryBox and
 *      EquityAnalysis format every fact with the `history.equity.` prefix, but
 *      only three ids live there — so levelSupport, rangePosition, maxDrawdown
 *      and baseRate were rendered as `history.equity.levelSupport`, literally,
 *      on the gold box. `historyFactKey()` is the single answer to "where does
 *      this fact live", and it is pinned here.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  dailyMoves, aboveAverage, currentStreak, drawdownShape, nearestLevelDistance,
  levelLadder, historyOverview, historyFacts, historyFactKey, EQUITY_ONLY_FACTS,
  rangePosition, maxDrawdown
} from '../src/lib/history.js';
import en from '../src/i18n/locales/en.json';
import fa from '../src/i18n/locales/fa.json';
import ar from '../src/i18n/locales/ar.json';

/** A wavy series with repeated levels, a drawdown and a recovery in it. */
const wave = (() => {
  const out = [];
  let p = 100;
  for (let i = 0; i < 200; i += 1) {
    p *= 1 + Math.sin(i / 9) * 0.012 + Math.sin(i / 37) * 0.008;
    out.push(p);
  }
  return out;
})();

const resolveKey = (bundle, path) => path
  .split('.')
  .reduce((node, part) => (node && typeof node === 'object' ? node[part] : undefined), bundle);

/* ═══════════════ 1. the measurements ═══════════════ */

describe('how the days actually moved', () => {
  it('reports a mean AND a median, so one spike cannot describe the market', () => {
    const spiky = [100, 100, 100, 100, 100, 100, 100, 200];
    const moves = dailyMoves(spiky);
    expect(moves.bestPct).toBeCloseTo(100, 6);
    expect(moves.medianAbsPct).toBe(0);
    expect(moves.avgAbsPct).toBeGreaterThan(0);
    /* Seven flat days out of seven moves — the median is the honest "typical". */
    expect(moves.samples).toBe(7);
  });

  it('counts days in each direction', () => {
    const up = Array.from({ length: 30 }, (_, i) => 100 + i);
    const moves = dailyMoves(up);
    expect(moves.upDays).toBe(29);
    expect(moves.downDays).toBe(0);
    expect(moves.insideTwoAvgPct).toBe(100);
  });

  it('returns nothing for a series too short to describe', () => {
    expect(dailyMoves([100, 101])).toBeNull();
    expect(dailyMoves(null)).toBeNull();
  });
});

describe('how much of the window sat above its own average', () => {
  it('counts the days above the average OF THE SAME WINDOW', () => {
    const rising = Array.from({ length: 60 }, (_, i) => 100 + i * 2);
    const above = aboveAverage(rising, { window: 20 });
    /* Every bar after the first window is above a trailing average of a rising
       series — the count is a description of the shape, not a signal. */
    expect(above.pct).toBeGreaterThan(90);
    expect(above.total).toBe(rising.length - 19);
  });

  it('needs a full window plus a sample before it answers', () => {
    expect(aboveAverage([1, 2, 3], { window: 20 })).toBeNull();
  });
});

describe('the current run', () => {
  it('counts the run, and does not call an alternation a streak', () => {
    expect(currentStreak([5, 4, 3, 2, 1])).toEqual({ dir: 'down', days: 4 });
    /* Two days that merely alternate are not a run — the box says "no streak"
       rather than dressing up a zig-zag as a trend. */
    expect(currentStreak([1, 2, 1, 2])).toBeNull();
    expect(currentStreak([1, 2])).toBeNull();
  });
});

describe('the shape of the worst fall', () => {
  it('measures where the peak and trough were, and the share given back', () => {
    const shape = drawdownShape([100, 200, 120, 180]);
    expect(shape.drawdownPct).toBeCloseTo(40, 6);
    expect(shape.recoveredPct).toBeCloseTo(75, 6);
  });

  it('says nothing when there was no fall', () => {
    expect(drawdownShape([1, 2, 3, 4])).toBeNull();
  });
});

describe('the levels within reach', () => {
  it('names the nearest level with its distance and its record', () => {
    const ladder = levelLadder(wave, { limit: 3 });
    expect(Array.isArray(ladder)).toBe(true);
    for (const level of ladder) {
      expect(level.distancePct).toBeGreaterThanOrEqual(0);
      expect(['above', 'below']).toContain(level.side);
      expect(level.tested).toBeGreaterThanOrEqual(level.held);
    }
  });

  it('reports the distance the same way the facts do', () => {
    const distance = nearestLevelDistance(wave);
    if (distance) {
      expect(distance.distancePct).toBeGreaterThanOrEqual(0);
      expect(['support', 'resistance']).toContain(distance.kind);
    }
  });

  it('a series with no repeated levels yields no ladder rather than a guess', () => {
    const straight = Array.from({ length: 40 }, (_, i) => 100 + i);
    expect(levelLadder(straight)).toEqual([]);
  });
});

describe('the window, described', () => {
  it('states the sample size and the range it came from', () => {
    const overview = historyOverview(wave);
    expect(overview.samples).toBe(wave.length);
    expect(overview.high).toBeGreaterThanOrEqual(overview.low);
    expect(overview.rangePct).toBeGreaterThanOrEqual(0);
  });

  it('withholds itself for a series with nothing to describe', () => {
    expect(historyOverview([1, 2, 3])).toBeNull();
  });
});

/* ═══════════════ 2. the facts, and the keys that name them ═══════════════ */

describe('the fact list', () => {
  const facts = historyFacts(wave, { days: 90, volume: 500, volumeHistory: Array(60).fill(100) });

  it('is longer and deeper than it used to be, from the same series', () => {
    const ids = facts.map((f) => f.id);
    expect(ids).toContain('volatility');
    expect(ids).toContain('levelDistance');
    expect(ids.length).toBeGreaterThan(4);
  });

  it('still carries no verdict beyond the three allowed kinds', () => {
    for (const fact of facts) {
      expect(['neutral', 'caution', 'notable']).toContain(fact.kind);
      expect(typeof fact.id).toBe('string');
      expect(fact.values).toBeTypeOf('object');
    }
  });

  it('never throws, whatever it is handed', () => {
    for (const bad of [null, undefined, [], [NaN], ['a'], [0], [-1, -2, -3]]) {
      expect(historyFacts(bad)).toEqual([]);
    }
  });

  it('EVERY fact id it can emit has a sentence in all three complete locales', () => {
    /* The longest series the panel will ever see, with volume, so every
       conditional branch above has had its chance to emit. */
    const long = Array.from({ length: 400 }, (_, i) => 100 + Math.sin(i / 5) * 8 + Math.sin(i / 23) * 4 + i * 0.05);
    const all = [
      ...historyFacts(long, { days: 365, volume: 900, volumeHistory: Array(90).fill(100) }),
      { id: 'drawdownRecovered', values: {} },
      { id: 'streak', values: {} },
      { id: 'aboveAverage', values: {} },
      { id: 'volumeLow', values: {} },
      { id: 'levelResistance', values: {} }
    ];
    for (const fact of all) {
      for (const [name, bundle] of [['en', en], ['fa', fa], ['ar', ar]]) {
        const value = resolveKey(bundle, `history.${fact.id}`);
        expect(typeof value, `history.${fact.id} is missing from ${name}.json — it would render as its own key`).toBe('string');
      }
    }
  });

  it('the equity boxes resolve every fact they render to a real sentence', () => {
    /* GoldHistoryBox / EquityAnalysis render historyFacts() PLUS three ids of
       their own, so all of them are checked with the equity flag. */
    const all = [
      ...historyFacts(wave, { days: 90 }),
      { id: 'windowChange' }, { id: 'avgDailyMove' }, { id: 'extremes' }
    ];
    for (const fact of all) {
      const path = historyFactKey(fact.id, { equity: true });
      for (const [name, bundle] of [['en', en], ['fa', fa], ['ar', ar]]) {
        const value = resolveKey(bundle, path);
        expect(typeof value, `${path} is missing from ${name}.json — the gold box would print it`).toBe('string');
      }
    }
  });
});

describe('which namespace a fact lives in', () => {
  it('the three equity-only ids go under history.equity', () => {
    for (const id of EQUITY_ONLY_FACTS) {
      expect(historyFactKey(id, { equity: true })).toBe(`history.equity.${id}`);
    }
    expect(historyFactKey('windowChange')).toBe('history.windowChange');
  });

  it('every shared fact is history.* — this is the raw-key bug that was shipped', () => {
    for (const id of ['levelSupport', 'levelResistance', 'rangePosition', 'maxDrawdown',
      'volumeHigh', 'volumeLow', 'baseRate', 'volatility', 'streak', 'aboveAverage',
      'levelDistance', 'drawdownRecovered']) {
      expect(historyFactKey(id, { equity: true })).toBe(`history.${id}`);
    }
  });
});

/* ═══════════════ 2b. the panel's own chrome, in every complete locale ═══ */

describe('the box around the facts', () => {
  /* Every static t('history...') key in the panel, listed rather than grepped:
     the source also builds `history.${id}` and `history.equity.${id}` at
     runtime, and those two are covered by the tests above. */
  const CHROME = [
    'title', 'subtitle', 'notAdvice', 'thin',
    'chipSample', 'chipSampleValue', 'chipLevels', 'chipLevelsValue',
    'chipTypicalDay', 'chipTypicalDayValue',
    'gaugeNow', 'levelsTitle', 'levelDistanceChip', 'footSample',
    'sideAbove', 'sideBelow', 'dirUp', 'dirDown',
    'equity.windowChange', 'equity.avgDailyMove', 'equity.extremes'
  ];

  it('names itself in all three complete locales — never a raw key', () => {
    for (const key of CHROME) {
      for (const [name, bundle] of [['en', en], ['fa', fa], ['ar', ar]]) {
        const value = resolveKey(bundle, `history.${key}`);
        expect(typeof value, `history.${key} missing from ${name}.json`).toBe('string');
        expect(value.length).toBeGreaterThan(0);
      }
    }
  });

  it('the complete locales carry the SAME history key set — no partial translations', () => {
    const flatten = (node, prefix = '') => Object.entries(node).flatMap(([key, value]) => (
      value && typeof value === 'object'
        ? flatten(value, `${prefix}${key}.`)
        : [`${prefix}${key}`]
    ));
    const enKeys = flatten(en.history).sort();
    expect(flatten(fa.history).sort()).toEqual(enKeys);
    expect(flatten(ar.history).sort()).toEqual(enKeys);
  });

  it('the panel itself only ever asks for keys this list covers', () => {
    const source = readFileSync(resolve(__dirname, '../src/components/HistoryPanel.jsx'), 'utf8');
    const asked = new Set();
    const pattern = /t\(\s*'history\.([A-Za-z0-9_]+)'/g;
    let match = pattern.exec(source);
    while (match) { asked.add(match[1]); match = pattern.exec(source); }
    expect(asked.size).toBeGreaterThan(4);
    for (const key of asked) {
      expect(CHROME, `${key} is rendered by HistoryPanel but not asserted above`).toContain(key);
      expect(en.history[key], `history.${key} has no English string`).toBeTypeOf('string');
    }
  });
});

/* ═══════════════ 3. the numbers must agree with each other ═══════════════ */

describe('cross-checks between the measurements', () => {
  it('the range position sits inside the range the facts report', () => {
    const position = rangePosition(wave);
    expect(position.pct).toBeGreaterThanOrEqual(0);
    expect(position.pct).toBeLessThanOrEqual(100);
    expect(position.high).toBeGreaterThan(position.low);
  });

  it('the drawdown shape can never exceed the max drawdown', () => {
    const shape = drawdownShape(wave);
    const worst = maxDrawdown(wave);
    expect(shape.drawdownPct).toBeLessThanOrEqual(worst + 1e-9);
  });
});
