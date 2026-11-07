/**
 * MARKET ANALYSIS / PERFORMANCE / PORTFOLIO REVIEW — contract tests
 * ---------------------------------------------------------------------------
 * These tests exist to lock the three properties a reader is trusting:
 *
 *   1. NOTHING IS INVENTED. A row without an input is excluded from that
 *      metric and the metric says so; a missing value is `null`, never 0, and
 *      never a `0` dressed as a number (`Number(null) === 0` is not evidence).
 *   2. A SCORE TRAVELS WITH ITS COVERAGE. `relativeStrength` renormalises over
 *      the inputs it actually has and reports how much of the model that is;
 *      a ranking below MIN_RANKED refuses to exist.
 *   3. PERFORMANCE IS NOT P&L. Both engines report the price return of today's
 *      mix and label the realised figure separately, and the review's caveats
 *      always carry `performance-is-not-realised-pnl`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMarketAnalysis, relativeStrength, MIN_RANKED, MARKET_ANALYSIS_VERSION
} from '../src/lib/intelligence/marketAnalysis.js';
import { buildPerformance, MIN_COVERED_WEIGHT_PCT } from '../src/lib/intelligence/performance.js';
import { buildPortfolioReview } from '../src/lib/intelligence/portfolioReview.js';

/* A feed wide enough to rank, with deliberate edge cases baked in. */
function feed(n = 14) {
  return Array.from({ length: n }, (_, i) => ({
    id: `coin-${i}`,
    symbol: `C${i}`,
    name: `Coin ${i}`,
    price: 10 + i,
    /* Alternating sign so the median sits near zero and the dispersion is
       non-trivial — a feed where everything is green would make breadth and
       divergence structurally untestable. */
    change24h: i % 2 === 0 ? 1 + i * 0.5 : -1 - i * 0.5,
    change7d: i % 3 === 0 ? -4 : 6,
    volume: 1e6 * (i + 1),
    mcap: 5e7 * (i + 1),
    high24h: 20 + i,
    low24h: 5 + i,
    dataProvenance: 'live'
  }));
}

test('market analysis: ranks the feed and reports its version and scan size', () => {
  const out = buildMarketAnalysis({ markets: feed(), pulse: null });
  assert.equal(out.version, MARKET_ANALYSIS_VERSION);
  assert.equal(out.scanned, 14);
  assert.ok(out.ranked >= MIN_RANKED, 'a 14-row feed must be rankable');
  assert.ok(out.shortlist.length > 0);
  assert.ok(out.shortlist.length <= 8);
  /* Descending by score, always. */
  for (let i = 1; i < out.shortlist.length; i += 1) {
    assert.ok(out.shortlist[i - 1].rs >= out.shortlist[i].rs);
  }
  assert.equal(out.caveat, 'not-a-signal');
});

test('market analysis: a row with no 24h change is never ranked and never counted as flat', () => {
  const rows = feed();
  rows.push({ id: 'ghost', symbol: 'GHOST', price: 3, volume: 1e6, mcap: 1e6 });
  const out = buildMarketAnalysis({ markets: rows, pulse: null });
  const ids = out.shortlist.concat(out.weakest).map((r) => r.id);
  assert.ok(!ids.includes('ghost'), 'a row without change24h must not appear in a ranking');
});

test('market analysis: a thin feed refuses to rank rather than printing coincidence', () => {
  const out = buildMarketAnalysis({ markets: feed(3), pulse: null });
  assert.ok(out.ranked < MIN_RANKED);
  assert.deepEqual(out.shortlist, []);
  assert.ok(out.unavailable.includes('ranking'));
});

test('market analysis: missing cap data names cap-concentration unavailable instead of 0%', () => {
  const rows = feed().map(({ mcap, ...rest }) => rest);
  const out = buildMarketAnalysis({ markets: rows, pulse: null });
  assert.equal(out.top10Share, null);
  assert.ok(out.unavailable.includes('cap-concentration'));
});

test('relativeStrength: renormalises over available inputs and reports coverage', () => {
  const full = relativeStrength({}, { change24hRank: 90, change7dRank: 80, turnoverRatio: 1 });
  assert.equal(full.coverage, 100);
  const partial = relativeStrength({}, { change24hRank: 90, change7dRank: null, turnoverRatio: null });
  assert.equal(partial.coverage, 45);
  /* With only the 24h input, the score IS that input — no dilution to 50. */
  assert.equal(partial.score, 90);
  assert.deepEqual(partial.parts.map((p) => p.key), ['rs-24h']);
  /* No usable input at all: null, not 0. */
  assert.equal(relativeStrength({}, { change24hRank: null, change7dRank: null, turnoverRatio: null }), null);
});

test('market analysis: vsTape is measured against the universe median, not zero', () => {
  const out = buildMarketAnalysis({ markets: feed(), pulse: null });
  for (const row of out.shortlist) {
    if (row.vsTape == null) continue;
    assert.equal(row.vsTape, Math.round((row.change24h - out.universeReturn) * 100) / 100);
  }
});

/* ── performance ─────────────────────────────────────────────────────────── */

const MARKETS = [
  { id: 'bitcoin', symbol: 'BTC', price: 60000, change24h: 2, change7d: 5 },
  { id: 'ethereum', symbol: 'ETH', price: 3000, change24h: -1, change7d: 2 },
  { id: 'solana', symbol: 'SOL', price: 150, change24h: 4, change7d: 9 }
];

/* `buildPerformance` reads the same row shape `buildIntelligence` emits:
   `value` + `weight`, and `coingeckoId` for the quote lookup. */
function rows() {
  return [
    { symbol: 'BTC', value: 60000, weight: 50, coingeckoId: 'bitcoin' },
    { symbol: 'ETH', value: 30000, weight: 25, coingeckoId: 'ethereum' },
    { symbol: 'SOL', value: 30000, weight: 25, coingeckoId: 'solana' }
  ];
}

test('performance: weighted return of the current mix, with P&L kept separate', () => {
  const perf = buildPerformance({ rows: rows(), markets: MARKETS });
  assert.equal(perf.status, 'complete');
  /* .5(2) + .25(−1) + .25(4) = 1 + (−.25) + 1 = 1.75 */
  assert.equal(perf.returns.d1, 1.75);
  assert.equal(perf.basis, 'current-weights-times-asset-return');
  /* The 7d leg is measured from the same quotes and must be a real number. */
  assert.ok(Number.isFinite(perf.returns.d7));
  /* The performance object must not carry a realised P&L number at all. */
  assert.equal(perf.pnl, undefined);
});

test('performance: an unpriced holding is excluded and named, never counted as 0%', () => {
  const perf = buildPerformance({
    rows: [...rows(), { symbol: 'ZZZ', value: 10000, weight: 10, coingeckoId: 'unknown-coin' }],
    markets: MARKETS
  });
  assert.equal(perf.status, 'partial');
  assert.ok(perf.missing.map(String).includes('ZZZ'), 'the unpriced holding must be named');
  /* The weighted math must not have absorbed a phantom flat holding: the
     covered return is identical to the three priced rows alone. */
  assert.equal(perf.returns.d1, 1.75);
  assert.ok(perf.coverage.coveredSharePct < 100);
});

test('performance: fully unpriced book is unavailable and refuses a number', () => {
  const perf = buildPerformance({
    rows: [{ symbol: 'ZZZ', value: 1000, weight: 100, coingeckoId: 'nope' }],
    markets: MARKETS
  });
  assert.equal(perf.status, 'unavailable');
  assert.equal(perf.returns.d1, null);
});

test('performance: coverage below the threshold downgrades rather than guesses', () => {
  const perf = buildPerformance({
    rows: [
      { symbol: 'BTC', value: 100, weight: 20, coingeckoId: 'bitcoin' },
      { symbol: 'ZZZ', value: 400, weight: 80, coingeckoId: 'nope' }
    ],
    markets: MARKETS
  });
  assert.ok(perf.coverage.coveredSharePct < MIN_COVERED_WEIGHT_PCT);
  assert.notEqual(perf.status, 'complete');
});

/* ── review ──────────────────────────────────────────────────────────────── */

/* buildIntelligence() emits `total` + `rows[]` with `value`/`weight`; the
   review reads exactly those keys. */
function review(overrides = {}) {
  /* `topShare` is a separate measured field on buildIntelligence()'s output —
     the review reads it rather than re-deriving a max, so the fixture supplies
     the value the real engine would have produced. */
  const intel = {
    total: 1000,
    topShare: 70,
    rows: [
      { symbol: 'BTC', value: 700, weight: 70, chainId: 1 },
      { symbol: 'ETH', value: 300, weight: 30, chainId: 1 }
    ],
    ...overrides.intel
  };
  return buildPortfolioReview({
    intel,
    analysis: overrides.analysis ?? { risk: { unavailable: [], reasons: [], score: null }, correlation: null },
    performance: overrides.performance ?? null,
    locale: 'en'
  });
}

test('review: always carries the not-advice and not-realised-P&L caveats', () => {
  const out = review();
  assert.ok(out.caveats.includes('not-advice'));
  assert.ok(out.caveats.includes('performance-is-not-realised-pnl'));
});

test('review: concentration is found from weights and evidenced with the share', () => {
  const out = review();
  const conc = out.findings.find((f) => f.kind === 'concentration');
  assert.ok(conc, 'a 70% top weight must be flagged');
  assert.ok(conc.evidence.some((e) => e.key != null && e.value != null));
});

test('review: missing cost basis is a caveat, never a fabricated P&L', () => {
  const out = review();
  assert.ok(out.caveats.includes('cost-basis-unknown'));
  assert.equal(out.verdict === 'gain' && out.findings.some((f) => f.kind === 'negative-pnl'), false);
});

test('review: an empty book refuses the review instead of returning zeros', () => {
  const out = buildPortfolioReview({
    intel: { total: 0, rows: [] },
    analysis: { risk: { unavailable: [] }, correlation: null },
    performance: null,
    locale: 'en'
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'no-priced-holdings');
});

test('review: actions never include the positive/neutral performance findings', () => {
  const out = review();
  const actionKinds = out.actions.map((a) => a.kind);
  assert.ok(!actionKinds.includes('positive-performance'));
  assert.ok(!actionKinds.includes('unmeasured-performance'));
});

test('review: findings are ordered by severity, worst first', () => {
  const out = review({
    intel: {
      total: 1000,
      topShare: 90,
      rows: [
        { symbol: 'BTC', value: 900, weight: 90, chainId: 1 },
        { symbol: 'ETH', value: 100, weight: 10, chainId: 1 }
      ]
    }
  });
  const rank = { critical: 0, high: 1, medium: 2, low: 3, none: 4 };
  for (let i = 1; i < out.findings.length; i += 1) {
    assert.ok(
      (rank[out.findings[i - 1].severity] ?? 9) <= (rank[out.findings[i].severity] ?? 9),
      'findings must not put a low above a high'
    );
  }
});
