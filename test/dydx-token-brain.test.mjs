/**
 * dYdX TOKEN BRAIN — the engine behind the desk box.
 * ===========================================================================
 * These tests exist for one reason: the panels under the dYdX chart make
 * claims about a leveraged position, so every number in them has to be a
 * CONSEQUENCE of the bars the indexer sent, and every absent field has to be
 * reported as absent. The suite pins:
 *
 *   · honesty      — no candles → no read, no setups, and a reason, never a
 *                    zero dressed up as a measurement;
 *   · arithmetic   — an uptrend reads bullish, a flat market reads chop, a
 *                    breakout is a breakout only when the last bar closed
 *                    outside the window's own extremes;
 *   · fabrication  — every evidence value is a finite number that came from
 *                    the input, and a feed with no volume produces no volume
 *                    claim;
 *   · determinism  — the same bars give the same output, every time.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DYDXT_TOKEN_BRAIN_VERSION, MIN_BARS,
  analyseMarket, fundingAprPct, normaliseCandles, scanTokenSetups
} from '../src/lib/futures/dydxTokenBrain.js';

/* ─── fixtures ────────────────────────────────────────────────────────────── */

/** A deterministic PRNG so a failing test is reproducible by eye. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Candles in the SHAPE the dYdX indexer sends (startedAt/open/high/low/close
 * plus a volume field), so normalisation is exercised too — a test that feeds
 * the engine its own output shape would not catch a field-name regression.
 */
function candles({ bars = 60, start = 100, drift = 0.6, noise = 0.4, volume = true, seed = 7, endJump = 0 } = {}) {
  const rnd = mulberry32(seed);
  const out = [];
  let price = start;
  const t0 = Date.UTC(2026, 10, 1, 0, 0, 0);
  for (let i = 0; i < bars; i += 1) {
    const open = price;
    const wobble = (rnd() - 0.5) * noise;
    const close = open + drift + wobble + (i === bars - 1 ? endJump : 0);
    const high = Math.max(open, close) + rnd() * noise;
    const low = Math.min(open, close) - rnd() * noise;
    out.push({
      startedAt: t0 + i * 3600_000,
      open: String(open), high: String(high), low: String(low), close: String(close),
      ...(volume ? { baseTokenVolume: String(1000 + rnd() * 200) } : {})
    });
    price = close;
  }
  return out;
}

const market = (over = {}) => ({
  ticker: 'TEST-USD',
  status: 'ACTIVE',
  oraclePrice: 100,
  priceChange24H: 1,
  openInterest: 5000,
  nextFundingRate: 0.0000125,
  initialMarginFraction: 0.05,
  maintenanceMarginFraction: 0.03,
  maxLeverage: 20,
  ...over
});

/* ─── normalisation ───────────────────────────────────────────────────────── */

describe('normaliseCandles', () => {
  it('keeps only well-formed bars and sorts them by time', () => {
    const rows = [
      { startedAt: 200, open: '2', high: '3', low: '1', close: '2.5' },
      { startedAt: 100, open: '1', high: '2', low: '0.5', close: '1.5' },
      { startedAt: 300, open: '3', high: '1', low: '9', close: '2' }, // high < low
      { startedAt: 400, open: 'x', high: '4', low: '3', close: '3.5' },
      null
    ];
    const out = normaliseCandles(rows);
    assert.equal(out.length, 2);
    assert.deepEqual(out.map((b) => b.t), [100, 200]);
  });

  it('leaves volume ABSENT when the feed did not send it', () => {
    const withVolume = normaliseCandles([{ startedAt: 1, open: '1', high: '2', low: '0.5', close: '1.5', baseTokenVolume: '12' }]);
    const withoutVolume = normaliseCandles([{ startedAt: 1, open: '1', high: '2', low: '0.5', close: '1.5' }]);
    assert.equal(withVolume[0].v, 12);
    assert.equal('v' in withoutVolume[0], false, 'an absent volume must not become 0');
  });
});

/* ─── the read ────────────────────────────────────────────────────────────── */

describe('analyseMarket', () => {
  it('refuses to read a market it has no candles for', () => {
    const a = analyseMarket({ candles: [], market: market() });
    assert.equal(a.ready, false);
    assert.equal(a.reason, 'NO_CANDLES');
    assert.equal(a.bars, 0);
    /* The oracle price is a real read, so it may be echoed; nothing else
       about the market may be invented. */
    assert.equal(a.price, 100);
    assert.equal(a.read, undefined);
  });

  it('says "short history" instead of reading a handful of bars', () => {
    const a = analyseMarket({ candles: candles({ bars: MIN_BARS - 5 }), market: market() });
    assert.equal(a.ready, false);
    assert.equal(a.reason, 'SHORT_HISTORY');
    assert.equal(a.minBars, MIN_BARS);
  });

  it('reads a rising market as bullish and puts the stop below the entry', () => {
    const a = analyseMarket({ candles: candles({ drift: 0.8, noise: 0.6 }), market: market() });
    assert.equal(a.ready, true);
    assert.equal(a.version, DYDXT_TOKEN_BRAIN_VERSION);
    assert.ok(a.read.bullScore > 50, `expected a bullish read, got ${a.read.bullScore}`);
    assert.ok(a.changePct > 0, 'the window change must be positive');
    assert.ok(a.levels.long.stop < a.price, 'a long stop must sit below the entry');
    assert.ok(a.levels.long.target > a.price, 'a long target must sit above the entry');
    assert.equal(a.levels.long.rr, 1.5);
  });

  it('reads a falling market as bearish', () => {
    const a = analyseMarket({ candles: candles({ drift: -0.8, noise: 0.6, seed: 11 }), market: market() });
    assert.equal(a.ready, true);
    assert.ok(a.read.bullScore < 50, `expected a bearish read, got ${a.read.bullScore}`);
    assert.ok(a.levels.short.stop > a.price, 'a short stop must sit above the entry');
  });

  it('reports a feed without volume as missing rather than zero', () => {
    const a = analyseMarket({ candles: candles({ volume: false }), market: market() });
    assert.equal(a.volume.present, false);
    assert.equal(a.volume.ratio, null);
    assert.ok(a.caveats.includes('NO_VOLUME'));
    /* The volume clause must drop out of the score rather than contribute a
       fabricated 1.0× — coverage is how the UI says so. */
    assert.equal(a.read.clauses.some((c) => c.id === 'volume'), false);
  });

  it('reports an unpublished funding rate as missing', () => {
    const a = analyseMarket({ candles: candles(), market: market({ nextFundingRate: null }) });
    assert.equal(a.funding.aprPct, null);
    assert.ok(a.caveats.includes('NO_FUNDING'));
  });

  it('converts dYdX hourly funding into APR the way the rest of the app does', () => {
    assert.equal(Math.round(fundingAprPct(0.0000125)), 11); // 0.0000125 × 100 × 24 × 365
    assert.equal(fundingAprPct(null), null);
  });

  it('is deterministic', () => {
    const rows = candles({ seed: 21 });
    const m = market();
    assert.deepEqual(analyseMarket({ candles: rows, market: m }), analyseMarket({ candles: rows, market: m }));
  });

  it('never prints a number it did not compute', () => {
    const a = analyseMarket({ candles: candles(), market: market() });
    for (const [k, v] of Object.entries({ ...a.ma, ...a.momentum, ...a.volatility })) {
      if (k === 'zone') continue;
      assert.ok(v === null || Number.isFinite(v), `${k} must be a number or null, got ${v}`);
    }
    assert.ok(a.read.coverage > 0 && a.read.coverage <= 1);
  });
});

/* ─── the opportunity engine ──────────────────────────────────────────────── */

describe('scanTokenSetups', () => {
  it('scans nothing when it has nothing to scan', () => {
    const s = scanTokenSetups({ candles: [], market: market() });
    assert.equal(s.ready, false);
    assert.deepEqual(s.setups, []);
    assert.equal(s.scanned, 0);
  });

  it('calls a close above the whole window a breakout — and only then', () => {
    const flat = candles({ drift: 0, noise: 0.5, endJump: 0, seed: 3 });
    const before = scanTokenSetups({ candles: flat, market: market() });
    const after = scanTokenSetups({ candles: candles({ drift: 0, noise: 0.5, endJump: 12, seed: 3 }), market: market() });
    assert.equal(before.setups.some((x) => x.id === 'breakout'), false);
    const brk = after.setups.find((x) => x.id === 'breakout');
    assert.ok(brk, 'the last bar closed above the window high; a breakout must be reported');
    assert.ok(brk.score > 55);
    assert.ok(brk.evidence.some((e) => e.k === 'priorHigh' && Number.isFinite(e.v)));
  });

  it('calls a close below the whole window a breakdown', () => {
    const s = scanTokenSetups({ candles: candles({ drift: 0, noise: 0.5, endJump: -12, seed: 5 }), market: market() });
    const brk = s.setups.find((x) => x.id === 'breakdown');
    assert.ok(brk, 'a close under the window low must be reported');
    assert.equal(brk.tone, 'down');
  });

  it('reads a flat, quiet market as chop — the honest answer on most days', () => {
    const s = scanTokenSetups({ candles: candles({ bars: 60, start: 100, drift: 0, noise: 0.05, seed: 9 }), market: market() });
    assert.equal(s.ready, true);
    assert.ok(s.setups.some((x) => x.id === 'chop'), 'a market that cannot pay its own costs is not an opportunity');
  });

  it('flags crowded funding from the venue’s own rate, as a risk not a direction', () => {
    const s = scanTokenSetups({ candles: candles(), market: market({ nextFundingRate: 0.0001 }) }); // ≈ 87.6% APR
    const crowded = s.setups.find((x) => x.id === 'funding-crowded-long');
    assert.ok(crowded, 'longs paying 87% APR must be reported as crowded');
    assert.equal(crowded.tone, 'watch');
    assert.ok(crowded.evidence.some((e) => e.k === 'fundingApr' && e.v > 30));
  });

  it('never invents an open-interest trend — the indexer sends a snapshot only', () => {
    const s = scanTokenSetups({ candles: candles(), market: market() });
    assert.equal(s.setups.some((x) => /open.?interest/i.test(x.id)), false);
  });

  it('gives every setup finite evidence, a bounded score and a caveat', () => {
    const s = scanTokenSetups({ candles: candles({ drift: 1.2, noise: 1.1, seed: 13 }), market: market() });
    assert.ok(s.setups.length > 0);
    for (const x of s.setups) {
      assert.ok(x.score >= 0 && x.score <= 100, `${x.id} score out of range: ${x.score}`);
      assert.ok(x.confidence >= 0 && x.confidence <= 100);
      assert.ok(x.evidence.length > 0, `${x.id} has no evidence`);
      for (const e of x.evidence) {
        assert.ok(e.v === null || Number.isFinite(e.v), `${x.id}.${e.k} is not a number: ${e.v}`);
      }
    }
    assert.ok(s.caveats.includes('notASignal'), 'the scanner must always say it is not a signal');
  });

  it('sorts by score and is deterministic', () => {
    const rows = candles({ seed: 17, endJump: 6 });
    const m = market();
    const a = scanTokenSetups({ candles: rows, market: m });
    const b = scanTokenSetups({ candles: rows, market: m });
    assert.deepEqual(a, b);
    const scores = a.setups.map((x) => x.score);
    assert.deepEqual(scores, [...scores].sort((x, y) => y - x));
  });
});

describe('volume and early watch regressions', () => {
  it('uses the last candle volume, and never borrows a previous candle when missing', () => {
    const rows = candles({ bars: 60 });
    rows[59].baseTokenVolume = '5000';
    assert.ok(analyseMarket({ candles: rows }).volume.ratio > 3);
    assert.ok(scanTokenSetups({ candles: rows }).setups.some((s) => s.id === 'volume-spike'));
    delete rows[59].baseTokenVolume;
    assert.equal(analyseMarket({ candles: rows }).volume.ratio, null);
    assert.ok(!scanTokenSetups({ candles: rows }).setups.some((s) => s.id === 'volume-spike'));
  });
  it('accepts indexer ISO timestamps', () => {
    const rows = candles({ bars: 30 });
    rows[0].startedAt = new Date(rows[0].startedAt).toISOString();
    assert.equal(normaliseCandles(rows).length, 30);
  });
});
