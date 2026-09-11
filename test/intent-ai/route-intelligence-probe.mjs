#!/usr/bin/env node
/**
 * PHASE 214 — CROSS-CHAIN ROUTE INTELLIGENCE probe.
 * ────────────────────────────────────────────────────────────────────────────
 * The route plan RANKS the candidate routes the quote step produced on the
 * five real dimensions (total cost, liquidity/impact, time, historical
 * success, bridge risk), says WHY the best route wins and WHY the others were
 * rejected or stayed unranked — and is wired into the EXECUTE_BRIDGE decision
 * path (the decision record carries the verdict) and the why engine
 * (whyNetwork cites it: «این شبکه چون گاز کمتر و نقدینگی عمیق‌تر»).
 *
 * The honesty law is the point of the probe:
 *   - the CHEAPER route wins when everything else is equal;
 *   - a liquidity-DRAINED route loses to a deeper one even when it is cheaper;
 *   - missing data is UNKNOWN (value null), never 0 — and a route whose
 *     dimensions are unread is DISCOUNTED, not ranked as if verified;
 *   - the adapter gates hold: >3 hops and unsignedable chains are EXCLUDED,
 *     never ranked;
 *   - the verdict persists, the decision record carries it, and whyNetwork
 *     reads it back.
 *
 * Run: node test/intent-ai/route-intelligence-probe.mjs
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
delete process.env.BLOB_READ_WRITE_TOKEN;

const rows = [];
const t = (name, ok) => rows.push([name, Boolean(ok)]);

const { createFinancialIntelligence } = await import('../../server/fios/index.js');
const { explainDecision } = await import('../../server/fios/whyEngine.js');

const OWNER = 'dev:phase214';
const now = Date.now();

const stateStore = { peek: () => ({ sections: {} }) };
const bus = {
  publish: () => ({ ok: true, delivered: 1 }),
  subscribe: () => () => {}
};
const fi = createFinancialIntelligence({ stateStore, events: bus, brain: null, log: () => {} });

/* ── fixture 1: equal routes, different cost — the cheaper one must win ── */
const equalRoutes = [
  {
    routeId: 'rA', tool: 'bridge-direct', fromChain: 'base', toChain: 'ethereum', hops: 1,
    totalCostUsd: 2.0, liquidityUsd: 50000, estimatedSeconds: 60,
    historicalSuccessPct: 99, reliability: 98
  },
  {
    routeId: 'rB', tool: 'bridge-slow', fromChain: 'base', toChain: 'ethereum', hops: 1,
    totalCostUsd: 5.0, liquidityUsd: 50000, estimatedSeconds: 60,
    historicalSuccessPct: 99, reliability: 98
  }
];

const p1 = await fi.routeIntelligence.plan(OWNER, {
  request: { fromChain: 'base', toChain: 'ethereum', fromToken: 'USDC', toToken: 'USDC', amountUsd: 1000 },
  routes: equalRoutes
});
t('the route plan completes over the candidate routes', p1.ok === true && p1.result.routeCount === 2);
t('the cheaper route wins when every other dimension is equal',
  p1.result.bestRoute?.routeId === 'rA');
t('the cost dimension scores relative to the cheapest candidate (1.0 vs <1.0)',
  (() => {
    const a = p1.result.ranked.find((r) => r.routeId === 'rA');
    const b = p1.result.ranked.find((r) => r.routeId === 'rB');
    const costOf = (r) => r.dimensions.find((d) => d.dimension === 'totalCost').score;
    return costOf(a) === 1.0 && costOf(b) < 1.0;
  })());
t('the verdict carries per-dimension scores, a why, and the estimate label',
  p1.result.bestRoute?.dimensions?.length === 5 && p1.result.bestRouteReasons.length > 0 && p1.result.estimate === true);

/* ── fixture 2: a drained book must lose even when it is the cheaper leg ── */
const drainedRoutes = [
  {
    routeId: 'deep', tool: 'deep-book', fromChain: 'base', toChain: 'ethereum', hops: 1,
    totalCostUsd: 2.0, liquidityUsd: 200000, estimatedSeconds: 60,
    historicalSuccessPct: 99, reliability: 98
  },
  {
    routeId: 'drained', tool: 'thin-book', fromChain: 'base', toChain: 'ethereum', hops: 1,
    totalCostUsd: 1.5, liquidityUsd: 800, estimatedSeconds: 60,
    historicalSuccessPct: 99, reliability: 98
  }
];
const p2 = await fi.routeIntelligence.plan(OWNER, {
  request: { fromChain: 'base', toChain: 'ethereum', amountUsd: 1000 },
  routes: drainedRoutes
});
t('the liquidity-drained route LOSES to the deeper book even when cheaper',
  p2.result.bestRoute?.routeId === 'deep');
t('the drained book carries its honest impact number (125% on an $800 book)',
  (() => {
    const d = p2.result.ranked.find((r) => r.routeId === 'drained');
    return d?.priceImpactPctEstimate === 125;
  })());
t('the drained route sits LAST in the ranking',
  p2.result.ranked[p2.result.ranked.length - 1]?.routeId === 'drained');

/* ── fixture 3: no data → UNKNOWN, never 0; unread dimensions discount ── */
const noDataRoutes = [
  {
    routeId: 'rich', tool: 'verified', fromChain: 'base', toChain: 'ethereum', hops: 1,
    totalCostUsd: 2.0, liquidityUsd: 50000, estimatedSeconds: 60,
    historicalSuccessPct: 99, reliability: 98
  },
  { routeId: 'ghost', tool: 'dark', fromChain: 'base', toChain: 'ethereum', hops: 1 }
];
const p3 = await fi.routeIntelligence.plan(OWNER, {
  request: { fromChain: 'base', toChain: 'ethereum', amountUsd: 1000 },
  routes: noDataRoutes
});
t('a data-less route names every unread dimension UNKNOWN — the verified route still wins',
  p3.result.bestRoute?.routeId === 'rich'
  && (() => {
    const g = p3.result.ranked.find((r) => r.routeId === 'ghost');
    return g && ['totalCost', 'liquidity', 'time', 'historicalSuccess'].every((d) => g.unknownDimensions.includes(d));
  })());
t('an unread dimension is null-valued, not zero',
  (() => {
    const g = p3.result.ranked.find((r) => r.routeId === 'ghost');
    if (!g) return false;
    const dims = g.dimensions.filter((d) => ['totalCost', 'liquidity', 'time', 'historicalSuccess'].includes(d.dimension));
    return dims.length === 4 && dims.every((d) => d.status === 'UNKNOWN' && d.value === null && d.score === null);
  })());
t('the data-less route is CONSERVATIVELY discounted, not ranked as verified',
  (() => {
    const g = p3.result.ranked.find((r) => r.routeId === 'ghost');
    const r = p3.result.ranked.find((r) => r.routeId === 'rich');
    return g && r && g.score < r.score && g.score < 0.5;
  })());

/* ── the adapter gates: hops and unsignedable chains are EXCLUDED ───────── */
const gatedRoutes = [
  {
    routeId: 'long', tool: 'hopper', fromChain: 'base', toChain: 'ethereum', hops: 4,
    totalCostUsd: 1.0, liquidityUsd: 90000, estimatedSeconds: 120, historicalSuccessPct: 99, reliability: 99
  },
  {
    routeId: 'foreign', tool: 'offchain', fromChain: 'base', toChain: '999999', hops: 1,
    totalCostUsd: 1.0, liquidityUsd: 90000, estimatedSeconds: 120, historicalSuccessPct: 99, reliability: 99
  },
  {
    routeId: 'good', tool: 'direct', fromChain: 'base', toChain: 'ethereum', hops: 1,
    totalCostUsd: 3.0, liquidityUsd: 90000, estimatedSeconds: 90, historicalSuccessPct: 97, reliability: 95
  }
];
const p4 = await fi.routeIntelligence.plan(OWNER, {
  request: { fromChain: 'base', toChain: 'ethereum', amountUsd: 1000 },
  routes: gatedRoutes
});
t('a 4-hop route is rejected with HOP_LIMIT_EXCEEDED — never ranked',
  p4.result.rejected.some((r) => r.routeId === 'long' && r.code === 'HOP_LIMIT_EXCEEDED')
  && !p4.result.ranked.some((r) => r.routeId === 'long'));
t('an unsignedable destination chain is rejected with UNSUPPORTED_CHAIN',
  p4.result.rejected.some((r) => r.routeId === 'foreign' && r.code === 'UNSUPPORTED_CHAIN')
  && !p4.result.ranked.some((r) => r.routeId === 'foreign'));
t('the surviving in-gate route is still ranked and named best',
  p4.result.bestRoute?.routeId === 'good');

/* ── no candidates → NO_CANDIDATE_ROUTES, not an empty success ──────────── */
const pEmpty = await fi.routeIntelligence.plan(OWNER, { request: { amountUsd: 100 }, routes: [] });
t('zero candidate routes → NO_CANDIDATE_ROUTES (the intelligence layer does not dial providers)',
  pEmpty.ok === false && pEmpty.code === 'NO_CANDIDATE_ROUTES');

/* ── persistence: the plan is stored and readable ───────────────────────── */
const recent = await fi.routeIntelligence.recent(OWNER, { limit: 10 });
t('route plans persist per owner and come back', recent.ok === true && recent.plans.length >= 4);
const one = recent.plans[0];
const got = await fi.routeIntelligence.get(OWNER, one.id);
t('a stored plan is retrievable by id', got.ok === true && got.row?.id === one.id);

/* ── the decision record carries the verdict; whyNetwork cites it ───────── */
const verdict = p1.result;
const decision = {
  schema: 'fbt.fi.decision.v1', id: 'dec_probe214', at: now,
  decision: { type: 'EXECUTE_BRIDGE', strategyId: 'stg_bridge', name: 'USDC base→ethereum', expectedReturnPct: null, riskLevel: 'LOW', amountUsd: 1000, horizonMonths: 1 },
  status: 'RECOMMENDED',
  netWorthUsd: 10020,
  reason: ['bridge-direct ranked first on route intelligence.'],
  confidence: { overall: 0.8 },
  alternatives: [],
  invalidationConditions: [],
  nextReviewAt: now + 86400000,
  routeIntelligence: {
    routeCount: verdict.routeCount,
    bestRoute: {
      routeId: verdict.bestRoute.routeId,
      tool: verdict.bestRoute.tool,
      score: verdict.bestRoute.score,
      unknownDimensions: verdict.bestRoute.unknownDimensions || [],
      totalCostUsd: verdict.bestRoute.totalCostUsd,
      priceImpactPctEstimate: verdict.bestRoute.priceImpactPctEstimate,
      estimatedSeconds: verdict.bestRoute.estimatedSeconds,
      failureProbabilityPct: verdict.bestRoute.failureProbabilityPct,
      dimensions: (verdict.bestRoute.dimensions || []).map((d) => ({ dimension: d.dimension, status: d.status, value: d.value, score: d.score }))
    },
    ranked: verdict.ranked.slice(0, 5).map((r) => ({ routeId: r.routeId, tool: r.tool, score: r.score })),
    rejected: verdict.rejected,
    bestRouteReasons: verdict.bestRouteReasons,
    estimate: true
  }
};
const why = explainDecision({
  decision,
  strategies: [{ id: 'stg_bridge', name: 'USDC base→ethereum' }],
  preferences: { riskTolerance: 'MODERATE', preferredChains: ['base'] },
  goal: { maxDrawdownPct: 10 },
  now
});
t('whyNetwork cites the route intelligence («این شبکه چون …»)',
  why.why?.whyNetwork?.some((l) => /route intelligence ranked/i.test(l)));
t('whyNetwork carries the cost + liquidity lines with their real numbers',
  why.why?.whyNetwork?.some((l) => /total route cost 2 USD/i.test(l))
  && why.why?.whyNetwork?.some((l) => /liquidity depth 50000 USD/i.test(l)));

/* ── report ────────────────────────────────────────────────────────── */
const failed = rows.filter(([, ok]) => !ok);
console.log(`\n${rows.length - failed.length}/${rows.length} passed`);
if (failed.length) {
  console.error('\nFAILED checks:');
  for (const [name] of failed) console.error(`  ✗ ${name}`);
  process.exit(1);
}
console.log('route intelligence probe passed (Phase 214)');
process.exit(0);
