/**
 * AI INTELLIGENCE — MATH, HONESTY AND COPY PARITY
 * ---------------------------------------------------------------------------
 * These tests exist because every number on the analysis screen is quoted back
 * to the user as a measurement. A silent NaN, a mean over a hole, or a
 * confidence computed on no data would look exactly like a real reading once it
 * is rendered, so the arithmetic is asserted here rather than inspected on a
 * screenshot.
 *
 * Run: npm run test:ai-analysis
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  sanitizeCandles,
  sma,
  ema,
  rsi,
  macd,
  bollinger,
  atr,
  maxDrawdown,
  trendFit,
  percentileRank,
  rangePosition,
  supportResistance,
  nearestLevels,
  computeIndicators
} from '../src/lib/intelligence/indicators.js';

import {
  buildMarketPulse,
  volumeSurges,
  weakestProvenance,
  regimeLabel,
  volatilityLabel
} from '../src/lib/intelligence/marketPulse.js';

import {
  scoreToken,
  scoreBand,
  SCORE_WEIGHTS,
  missingForScore
} from '../src/lib/intelligence/tokenScore.js';

import {
  scanOpportunities,
  changePercentile,
  OPPORTUNITY_KINDS
} from '../src/lib/intelligence/opportunities.js';

import {
  pearson,
  dailyReturns,
  correlationMatrix,
  buildAllocation,
  assessRisk,
  buildPortfolioAnalysis,
  bucketOf
} from '../src/lib/intelligence/portfolioAnalysis.js';

import { COPY, copyKeyParity, t, fmtPct, fmtMoney } from '../src/lib/intelligence/copy.js';
import { marketNarrative, tokenNarrative, reasonText, suggestionText } from '../src/lib/intelligence/narrative.js';
import { buildDailyReport, reportFileName } from '../src/lib/intelligence/report.js';

/* ── fixtures ─────────────────────────────────────────────────────────────── */

function candleSeries(closes, start = Date.UTC(2026, 0, 1)) {
  /* A real OHLC bar contains its open and its close: h >= max(o, c) and
     l <= min(o, c). The fixture obeys that, because a fixture that does not
     would be testing the sanitizer's rejection path instead of the pivot
     detector. */
  return closes.map((c, i) => {
    const o = i === 0 ? c : closes[i - 1];
    return {
      t: start + i * 86_400_000,
      o,
      h: Math.max(o, c) * 1.02,
      l: Math.min(o, c) * 0.98,
      c
    };
  });
}

const uptrend = candleSeries(Array.from({ length: 240 }, (_, i) => 100 + i * 0.8));

function marketRow(overrides = {}) {
  return {
    id: 'bitcoin',
    symbol: 'BTC',
    name: 'Bitcoin',
    price: 60000,
    change1h: 0.2,
    change24h: 1.4,
    change7d: 4.2,
    volume: 30_000_000_000,
    mcap: 1_200_000_000_000,
    rank: 1,
    high24h: 61_000,
    low24h: 58_000,
    ath: 73_000,
    athChange: -17.8,
    sparkline: [],
    dataProvenance: 'live',
    ...overrides
  };
}

function universe(n = 40) {
  return Array.from({ length: n }, (_, i) => marketRow({
    id: `c${i}`,
    symbol: `C${i}`,
    change1h: (i % 7) - 3,
    change24h: ((i * 37) % 41) / 4 - 5,
    change7d: ((i * 53) % 61) / 3 - 8,
    volume: 1_000_000 * (i + 1),
    mcap: 50_000_000 * (i + 1),
    rank: i + 2
  }));
}

/* ── indicators ───────────────────────────────────────────────────────────── */

test('sanitizeCandles drops malformed bars and sorts by time', () => {
  const rows = [
    { t: 3, o: 1, h: 2, l: 0.5, c: 1.5 },
    { t: 1, o: 1, h: 1, l: 1, c: 1 },
    { t: 2, o: 1, h: 0.5, l: 1, c: 1 }, // high below low — dropped
    { t: 4, o: 1, h: 2, l: 0.5, c: null }, // missing close — dropped
    null
  ];
  const clean = sanitizeCandles(rows);
  assert.deepEqual(clean.map((c) => c.t), [1, 3]);
});

test('sma returns an aligned series with a null warm-up', () => {
  assert.deepEqual(sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
  assert.deepEqual(sma([1, 2], 3), [null, null]);
  assert.deepEqual(sma([], 3), []);
});

test('ema is seeded by the SMA of the first window', () => {
  const out = ema([1, 2, 3, 4, 5], 3);
  assert.deepEqual(out.slice(0, 3), [null, null, 2]);
  assert.equal(out[3], 3);
  assert.equal(out[4], 4);
});

test('rsi saturates at 100 for a monotonic rise and reads 50 on a flat series', () => {
  const rising = Array.from({ length: 40 }, (_, i) => 100 + i);
  const lastRising = rising.map((_, i) => i).length;
  assert.equal(rsi(rising, 14)[lastRising - 1], 100);
  const flat = new Array(40).fill(42);
  assert.equal(rsi(flat, 14)[39], 50);
  /* A series shorter than the period has no RSI at all — not a 50. */
  assert.ok(rsi([1, 2, 3], 14).every((v) => v === null));
});

test('macd histogram is exactly line minus signal where both exist', () => {
  const closes = Array.from({ length: 120 }, (_, i) => 100 + Math.sin(i / 5) * 10 + i * 0.2);
  const m = macd(closes);
  let checked = 0;
  for (let i = 0; i < closes.length; i += 1) {
    if (m.line[i] != null && m.signal[i] != null) {
      assert.ok(Math.abs(m.hist[i] - (m.line[i] - m.signal[i])) < 1e-9);
      checked += 1;
    }
  }
  assert.ok(checked > 50);
});

test('bollinger collapses to the price on a flat series without dividing by zero', () => {
  const flat = new Array(30).fill(5);
  const bb = bollinger(flat, 20, 2);
  assert.equal(bb.middle[29], 5);
  assert.equal(bb.upper[29], 5);
  assert.equal(bb.lower[29], 5);
  assert.equal(bb.percentB[29], 0.5);
  assert.equal(bb.bandwidth[29], 0);
});

test('atr needs a prior close and stays positive', () => {
  assert.ok(atr(uptrend.slice(0, 5), 14).every((v) => v === null));
  const series = atr(uptrend, 14).filter((v) => v != null);
  assert.ok(series.length > 200);
  assert.ok(series.every((v) => v > 0));
});

test('drawdown is peak-to-trough, not first-to-last', () => {
  assert.equal(maxDrawdown([100, 120, 60, 80]), -50);
  assert.equal(maxDrawdown([100]), null);
});

test('trendFit recovers a perfect line', () => {
  const fit = trendFit(Array.from({ length: 30 }, (_, i) => 10 + i * 2), 30);
  assert.ok(fit.slopePct > 0);
  assert.ok(fit.r2 > 0.999);
});

test('percentileRank and rangePosition refuse undefined input', () => {
  assert.equal(percentileRank([], 5), null);
  assert.equal(rangePosition(10, 10, 10), null);
  assert.equal(rangePosition(0, 10, 5), 0.5);
});

test('support/resistance finds the pivots and the nearest levels', () => {
  const closes = [10, 11, 12, 11, 10, 9, 10, 11, 12.2, 11, 10, 9.5, 10, 11, 12, 11, 10, 9.8, 10.5, 11.5, 12, 11, 10, 9.9, 10.6, 11.2, 11.9, 11.1, 10.4, 10.0];
  const levels = supportResistance(candleSeries(closes), { lookback: 2, tolerancePct: 2 });
  assert.ok(levels.length > 0);
  const nearest = nearestLevels(levels, 10.0);
  assert.ok(nearest.support === null || nearest.support.price < 10.0);
  assert.ok(nearest.resistance === null || nearest.resistance.price > 10.0);
});

test('computeIndicators never throws on empty input and reports why it is empty', () => {
  const pack = computeIndicators([]);
  assert.equal(pack.bars, 0);
  assert.equal(pack.close, null);
  assert.equal(pack.values.rsi14, null);
  assert.equal(pack.values.trend.label, 'unknown');
  assert.equal(pack.nearest.support, null);
});

/* ── market pulse ─────────────────────────────────────────────────────────── */

test('weakest provenance wins', () => {
  assert.equal(weakestProvenance(['live', 'live']), 'live');
  assert.equal(weakestProvenance(['live', 'stale']), 'stale');
  assert.equal(weakestProvenance(['stale', 'offline']), 'offline');
  assert.equal(weakestProvenance([]), 'unknown');
});

test('breadth counts only rows that actually reported a 24h change', () => {
  const rows = [
    marketRow({ id: 'a', change24h: 2 }),
    marketRow({ id: 'b', change24h: -1 }),
    marketRow({ id: 'c', change24h: null }),
    marketRow({ id: 'd', change24h: 0.01 })
  ];
  const pulse = buildMarketPulse({
    global: { mcap: 2e12, volume: 1e11, mcapChange: 1.2, volumeChange: 8, btcDominance: 52, ethDominance: 17, avgChange: null },
    markets: rows,
    updatedAt: 1000
  });
  assert.equal(pulse.breadth.counted, 3);
  assert.equal(pulse.breadth.total, 4);
  assert.equal(pulse.breadth.advancers, 1);
  assert.equal(pulse.breadth.decliners, 1);
  assert.equal(pulse.breadth.flat, 1);
  assert.equal(pulse.performance.avgChangeSource, 'derived-median');
  assert.ok(pulse.regime.score >= -100 && pulse.regime.score <= 100);
  assert.ok(pulse.regime.confidence >= 5 && pulse.regime.confidence <= 92);
});

test('an offline snapshot can never look confident', () => {
  const rows = Array.from({ length: 60 }, (_, i) => marketRow({
    id: `x${i}`,
    change24h: 2,
    dataProvenance: 'offline'
  }));
  const pulse = buildMarketPulse({
    global: { mcap: 1e12, volume: 1e10, mcapChange: 3 },
    markets: rows
  });
  assert.equal(pulse.provenance, 'offline');
  assert.ok(pulse.regime.confidence <= 20);
  assert.equal(pulse.regime.label, 'bullish');
});

test('the pulse names the feeds it does not have instead of faking them', () => {
  const pulse = buildMarketPulse({ global: null, markets: [marketRow()] });
  for (const key of ['fear-greed', 'open-interest', 'funding-rates', 'liquidations', 'net-exchange-flow']) {
    assert.ok(pulse.unavailable.includes(key));
  }
  assert.ok(COPY.fa['unavailable.fear-greed'], 'every unavailable feed has a Persian label');
});

test('volume surge uses the median, so one huge pair cannot hide the rest', () => {
  const rows = [
    marketRow({ id: 'huge', volume: 9e10, mcap: 1e11 }), // 90% turnover outlier
    marketRow({ id: 'a', volume: 1e6, mcap: 1e8 }), // 1%
    marketRow({ id: 'b', volume: 1e6, mcap: 1e8 }),
    marketRow({ id: 'c', volume: 1e6, mcap: 1e8 }),
    marketRow({ id: 'boom', volume: 4e6, mcap: 1e8 }) // 4%
  ];
  const { baseline, rows: surges } = volumeSurges(rows, { multiplier: 2.5 });
  assert.ok(baseline > 0);
  assert.ok(surges.some((r) => r.id === 'boom'));
});

test('regime and volatility labels cover their boundaries', () => {
  assert.equal(regimeLabel(30), 'bullish');
  assert.equal(regimeLabel(29.9), 'mildly-bullish');
  assert.equal(regimeLabel(0), 'neutral');
  assert.equal(regimeLabel(-30), 'bearish');
  assert.equal(regimeLabel(null), 'unknown');
  assert.equal(volatilityLabel(2.9), 'low');
  assert.equal(volatilityLabel(5), 'normal');
  assert.equal(volatilityLabel(12), 'extreme');
});

/* ── token score ──────────────────────────────────────────────────────────── */

test('score weights are declared and sum to one', () => {
  const sum = Object.values(SCORE_WEIGHTS).reduce((s, w) => s + w, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
});

test('a token with no data gets no score, and says which evidence is missing', () => {
  const result = scoreToken({ coin: null, pack: null, universe: [] });
  assert.equal(result.composite, null);
  assert.equal(result.band, null);
  assert.equal(result.coverage, 0);
  assert.ok(result.caveats.includes('not-a-recommendation'));
  assert.ok(result.caveats.includes('insufficient-coverage'));
  const missing = missingForScore(result).map((m) => m.key);
  assert.deepEqual(missing.sort(), ['liquidity', 'momentum', 'risk', 'structure', 'technical'].sort());
});

test('with candles and a market row the composite is bounded and every component is scored', () => {
  const pack = computeIndicators(uptrend);
  const coin = marketRow();
  const result = scoreToken({ coin, pack, universe: universe(40) });
  assert.ok(result.composite >= 0 && result.composite <= 100);
  assert.equal(result.coverage, 100);
  assert.equal(result.components.filter((c) => c.available).length, 5);
  for (const c of result.components) {
    assert.ok(c.score >= 0 && c.score <= 100, `${c.key} in range`);
  }
});

test('an uptrend scores higher than the same tape crashing', () => {
  const up = computeIndicators(candleSeries(Array.from({ length: 240 }, (_, i) => 100 + i * 0.8)));
  const down = computeIndicators(candleSeries(Array.from({ length: 240 }, (_, i) => 300 - i * 0.8)));
  const a = scoreToken({ coin: marketRow({ change24h: 3, change7d: 9, price: 300, high24h: 302, low24h: 280, ath: 320, athChange: -6 }), pack: up, universe: universe(40) });
  const b = scoreToken({ coin: marketRow({ change24h: -3, change7d: -9, price: 110, high24h: 130, low24h: 108, ath: 320, athChange: -66 }), pack: down, universe: universe(40) });
  assert.ok(a.composite > b.composite, `${a.composite} should beat ${b.composite}`);
});

test('the risk component is inverted: calmer tape scores higher', () => {
  const calm = scoreToken({
    coin: marketRow({ high24h: 60100, low24h: 59900, price: 60000 }),
    pack: computeIndicators(candleSeries(new Array(240).fill(100))),
    universe: universe(40)
  });
  const wild = scoreToken({
    coin: marketRow({ high24h: 90000, low24h: 30000, price: 60000 }),
    pack: computeIndicators(candleSeries(new Array(240).fill(100))),
    universe: universe(40)
  });
  const riskOf = (r) => r.components.find((c) => c.key === 'risk').score;
  assert.ok(riskOf(calm) > riskOf(wild));
});

test('scoreBand boundaries', () => {
  assert.equal(scoreBand(75), 'strong');
  assert.equal(scoreBand(74), 'constructive');
  assert.equal(scoreBand(45), 'neutral');
  assert.equal(scoreBand(30), 'cautious');
  assert.equal(scoreBand(29), 'weak');
  assert.equal(scoreBand(null), null);
});

/* ── scanner ──────────────────────────────────────────────────────────────── */

test('the scanner finds a breakout and keeps its arithmetic', () => {
  const rows = [
    marketRow({ id: 'breakout', price: 100, high24h: 100.3, low24h: 80, change24h: 9, change7d: 14, volume: 5e6, mcap: 5e7 }),
    ...universe(30)
  ];
  const scan = scanOpportunities({ markets: rows });
  const hit = scan.opportunities.find((o) => o.kind === 'breakout' && o.coin.id === 'breakout');
  assert.ok(hit, 'breakout detected');
  assert.ok(hit.confidence > 0 && hit.confidence <= 95);
  assert.ok(hit.reasons.some((r) => r.key === 'range-position'));
  assert.ok(hit.caveats.includes('not-a-signal'));
});

test('scanning is deterministic and deduped per token and kind', () => {
  const rows = [marketRow({ id: 'm', change24h: 8, change7d: 20, high24h: 61000, low24h: 58000, price: 60000 }), ...universe(35)];
  const a = scanOpportunities({ markets: rows, now: 1 });
  const b = scanOpportunities({ markets: rows, now: 1 });
  assert.deepEqual(a.opportunities.map((o) => `${o.kind}:${o.coin.id}`), b.opportunities.map((o) => `${o.kind}:${o.coin.id}`));
  const keys = a.opportunities.map((o) => `${o.kind}:${o.coin.id}`);
  assert.equal(new Set(keys).size, keys.length);
});

test('offline data lowers scanner confidence', () => {
  const live = scanOpportunities({ markets: [marketRow({ id: 'm', change24h: 9, change7d: 20, price: 100, high24h: 100.3, low24h: 80 })] });
  const offline = scanOpportunities({ markets: [marketRow({ id: 'm', change24h: 9, change7d: 20, price: 100, high24h: 100.3, low24h: 80, dataProvenance: 'offline' })] });
  assert.ok(offline.opportunities[0].confidence < live.opportunities[0].confidence);
});

test('an empty universe scans to nothing, not to a guess', () => {
  const scan = scanOpportunities({ markets: [] });
  assert.equal(scan.opportunities.length, 0);
  assert.ok(scan.caveats.includes('no-market-data'));
});

test('changePercentile ranks against the rows that have a change', () => {
  const rows = [marketRow({ id: 'a', change24h: -5 }), marketRow({ id: 'b', change24h: 0 }), marketRow({ id: 'c', change24h: 5 })];
  assert.equal(changePercentile(rows, 'c'), 100);
  assert.ok(Math.abs(changePercentile(rows, 'a') - 100 / 3) < 1e-9);
  assert.equal(changePercentile(rows, 'missing'), null);
});

test('every scanner kind has copy in both languages', () => {
  for (const kind of OPPORTUNITY_KINDS) {
    assert.ok(COPY.fa[`opp.kind.${kind.id}`]);
    assert.ok(COPY.en[`opp.kind.${kind.id}`]);
  }
});

/* ── portfolio ────────────────────────────────────────────────────────────── */

test('pearson refuses tiny samples and reads perfect correlation as 1', () => {
  assert.equal(pearson([1, 2], [2, 4]), null);
  const a = Array.from({ length: 20 }, (_, i) => i + Math.sin(i));
  assert.ok(Math.abs(pearson(a, a, 10) - 1) < 1e-9);
  assert.ok(Math.abs(pearson(a, a.map((v) => -v), 10) + 1) < 1e-9);
});

test('correlation is computed on returns, and lists what it could not use', () => {
  /* A perfectly linear series has ZERO return variance, so its correlation is
     undefined — which is why this fixture is noisy instead of linear. */
  const a = Array.from({ length: 40 }, (_, i) => 100 + i + (i % 4) * 1.7);
  const b = a.map((v, i) => v * 2 + (i % 3) * 0.9);
  const flipped = a.map((v) => 400 - v);
  const matrix = correlationMatrix({ A: a, B: b, C: [1, 2, 3] }, { minSamples: 10 });
  assert.equal(matrix.sufficient.sort().join(','), 'A,B');
  assert.deepEqual(matrix.insufficient, ['C']);
  assert.ok(matrix.pairs[0].r > 0.9);
  const inverted = correlationMatrix({ A: a, B: flipped }, { minSamples: 10 });
  assert.ok(inverted.pairs[0].r < -0.9);
  assert.equal(dailyReturns([100, 110, 99]).length, 2);
});

test('allocation buckets known symbols and keeps the rest in "other"', () => {
  assert.equal(bucketOf('wbtc'), 'btc');
  assert.equal(bucketOf('usdc'), 'stable');
  assert.equal(bucketOf('aave'), 'defi');
  assert.equal(bucketOf('zzz'), 'other');
  const allocation = buildAllocation([
    { symbol: 'BTC', value: 600 },
    { symbol: 'ETH', value: 300 },
    { symbol: 'USDC', value: 100 },
    { symbol: 'NOPE', value: null }
  ], 1000);
  assert.equal(allocation[0].id, 'btc');
  assert.equal(Math.round(allocation[0].weight), 60);
  assert.equal(allocation.reduce((s, b) => s + b.weight, 0), 100);
});

test('a portfolio with no recorded cost basis reports P&L as unknown', () => {
  const intel = {
    total: 1000,
    rows: [
      { symbol: 'BTC', value: 700, weight: 70, cost: null, pnl: null, pnlPct: null, amount: 0.01 },
      { symbol: 'ETH', value: 300, weight: 30, cost: null, pnl: null, pnlPct: null, amount: 0.1 }
    ],
    topShare: 70,
    chainAllocation: [{ chainId: 1, value: 1000 }],
    riskScore: 55,
    partial: true,
    realised: 0,
    unrealised: 0,
    cost: null
  };
  const analysis = buildPortfolioAnalysis({ intel });
  assert.equal(analysis.pnl.status, 'unknown');
  assert.ok(analysis.caveats.includes('cost-basis-unknown'));
  assert.ok(analysis.suggestions.some((s) => s.action === 'record-cost-basis'));
  assert.ok(analysis.suggestions.every((s) => s.confidence > 0 && s.confidence <= 100));
  assert.ok(analysis.risk.unavailable.includes('sharpe-ratio'));
});

test('risk rises when the assets are correlated and falls when they are not', () => {
  const intel = {
    total: 1000,
    rows: [{ symbol: 'BTC', value: 1000, weight: 100, cost: 800 }],
    topShare: 100,
    chainAllocation: [],
    riskScore: 50,
    partial: false
  };
  const high = assessRisk({ intel, allocation: [{ id: 'btc', weight: 100 }], correlation: { average: 0.92, pairs: [1], sufficient: [], insufficient: [] } });
  const low = assessRisk({ intel, allocation: [{ id: 'btc', weight: 100 }], correlation: { average: 0.1, pairs: [1], sufficient: [], insufficient: [] } });
  assert.ok(high.score > low.score);
  assert.ok(high.reasons.some((r) => r.key === 'correlated-assets'));
});

test('suggestion text renders its measured numbers', () => {
  const text = suggestionText('fa', { action: 'reduce-concentration', params: { topShare: 72.345, symbol: 'BTC' } });
  assert.ok(text.includes('72.3'));
  assert.ok(text.includes('BTC'));
});

/* ── copy + narrative + report ────────────────────────────────────────────── */

test('both dictionaries carry exactly the same keys', () => {
  const { onlyFa, onlyEn } = copyKeyParity();
  assert.deepEqual(onlyFa, []);
  assert.deepEqual(onlyEn, []);
  assert.ok(Object.keys(COPY.fa).length > 100);
});

test('interpolation leaves unknown placeholders visible', () => {
  assert.equal(t('fa', 'page.updated', { time: '12:00' }), 'آخرین به‌روزرسانی: 12:00');
});

test('formatters refuse missing numbers instead of printing a zero', () => {
  assert.equal(fmtPct(null), '—');
  assert.equal(fmtMoney(undefined), '—');
  assert.equal(fmtPct(1.234), '+1.23%');
  assert.equal(fmtMoney(2.45e12), '$2.45T');
});

test('the market paragraph quotes the numbers it was given', () => {
  const pulse = buildMarketPulse({
    global: { mcap: 2.4e12, volume: 8.6e10, volumeChange: -4.2, mcapChange: 1.1, btcDominance: 58.2, ethDominance: 12.4 },
    markets: [marketRow({ id: 'a', change24h: 2 }), marketRow({ id: 'b', change24h: 1 }), marketRow({ id: 'c', change24h: -3 })],
    updatedAt: Date.now()
  }, {});
  const nav = marketNarrative(pulse, 'fa');
  assert.ok(nav.lines[0].includes('1.00'), 'the median it measured is printed');
  assert.ok(nav.lines[0].includes('١') === false);
  assert.ok(nav.lines.some((l) => l.includes('58.2')));
  assert.ok(nav.lines.some((l) => l.includes('4.2') && l.includes('کمتر')), 'a falling volume prints its direction and size');
  assert.equal(nav.drivers.length, 4);
  assert.ok(nav.confidence > 0);
});

test('the token paragraph withholds the technical read instead of inventing one', () => {
  const nav = tokenNarrative({ coin: marketRow(), pack: computeIndicators([]), score: scoreToken({ coin: marketRow(), pack: null }), locale: 'fa' });
  assert.equal(nav.lines.length, 1);
  assert.ok(nav.lines[0].includes('کندل'));
  assert.ok(nav.verdict.includes('·'), 'the verdict is the band plus the composite');
});

test('the daily report carries a source line and every section', () => {
  const pulse = buildMarketPulse({
    global: { mcap: 2.4e12, volume: 8.6e10, volumeChange: 3, mcapChange: 1 },
    markets: [marketRow(), ...universe(12)],
    updatedAt: Date.now()
  });
  const scan = scanOpportunities({ markets: [marketRow({ change24h: 8, change7d: 20 }), ...universe(20)] });
  const report = buildDailyReport({ pulse, scan, locale: 'fa', now: Date.UTC(2026, 10, 6) });
  assert.equal(report.sections.length, 6);
  assert.ok(report.text.includes('منبع:'));
  assert.ok(report.text.includes('—'));
  assert.ok(reportFileName(report.generatedAt).endsWith('.txt'));
  assert.ok(report.sections.every((s) => s.lines.length > 0));
});

test('scanner reason text formats ratios and prices from the reason object', () => {
  assert.ok(reasonText('en', { key: 'range-position', params: { value: 0.98 } }).includes('98'));
  assert.ok(reasonText('en', { key: 'turnover-vs-median', params: { ratio: 3.14 } }).includes('3.1'));
});
