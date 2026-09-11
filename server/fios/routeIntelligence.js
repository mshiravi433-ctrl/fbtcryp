/**
 * FBT FINANCIAL INTELLIGENCE OS — Cross-Chain Route Intelligence (Phase 214).
 * ---------------------------------------------------------------------------
 * For every cross-chain bridge/swap request the OS ranks the CANDIDATE routes
 * (direct / multi-hop / via an intermediate network) on FIVE real dimensions:
 *
 *   totalCost          total gas + bridge + protocol fees of the WHOLE path
 *   liquidity          liquidity depth of the route → ESTIMATED price impact
 *   time               estimated in-flight time of the whole path
 *   historicalSuccess  the route's historical success rate (provider data ONLY)
 *   bridgeRisk         hop count + reliability + slippage (the §19 risk score,
 *                      the same formula crosschain.js#scoreRouteRisk uses)
 *
 * THE HONESTY LAW (Phase 212 policy, applied per dimension):
 *   - a dimension the data does not carry is UNKNOWN, never 0 and never 1 —
 *     a route with no readable cost is not "free", it is unread;
 *   - a route whose dimensions are all UNKNOWN is UNRANKED, not ranked last —
 *     printing a zero would make it look the worst when we do not know;
 *   - the total score is CONSERVATIVE: every unread dimension discounts the
 *     score (`score = weightedKnownMean × knownWeight/totalWeight`), so a
 *     route nobody could fully verify can never claim a full score;
 *   - the price impact is a FIRST-ORDER constant-product estimate
 *     (impact ≈ amount/depth) and is labelled `estimate: true` everywhere;
 *   - `historicalSuccessPct` is NEVER derived or imputed — the provider says
 *     it or the dimension is UNKNOWN.
 *
 * THE ADAPTER GATES ARE NOT BYPASSED:
 *   - a route on a chain the wallet cannot sign (WALLET_SUPPORTED_CHAIN_IDS
 *     from server/crossChain.js — the same set the LI.FI adapter quotes
 *     against) is EXCLUDED, never ranked;
 *   - a route longer than MAX_ROUTE_HOPS is EXCLUDED with a named reason. The
 *     execution path (server/crossChain.js + scoreRouteRisk) already penalises
 *     every hop; this layer refuses to recommend paths it cannot defend.
 *
 * The engine ADVISES: it ranks, explains and records. It never quotes against
 * a provider here (the quote step is the existing cross-chain reasoner), never
 * signs, never executes.
 */

import { randomUUID } from 'node:crypto';
import { requireFlag } from './flags.js';
import { WALLET_SUPPORTED_CHAIN_IDS } from '../crossChain.js';

export const ROUTE_INTELLIGENCE_SCHEMA = 'fbt.fi.route-intelligence.v1';

/** The execution adapters' own ceiling for a defensible path: more hops than
 *  this and the §19 hop-risk term saturates (scoreRouteRisk caps it at 0.6
 *  for 5 hops) while each extra hop is another protocol that can pause. */
export const MAX_ROUTE_HOPS = 3;

export const ROUTE_DIMENSIONS = Object.freeze([
  'totalCost', 'liquidity', 'time', 'historicalSuccess', 'bridgeRisk'
]);

/** Weights of the five dimensions in the total score. Cost and liquidity
 *  decide money; bridge risk decides survival; time is real but cheap. */
export const ROUTE_DIMENSION_WEIGHTS = Object.freeze({
  totalCost: 1.4,
  liquidity: 1.3,
  bridgeRisk: 1.2,
  historicalSuccess: 1.0,
  time: 0.7
});

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const round = (v, d = 3) => (num(v) === null ? null : Number(Number(v).toFixed(d)));

/** Chain name → id (the same table the cross-chain reasoner resolves with). */
const CHAIN_NAME_TO_ID = Object.freeze({
  ethereum: '1', mainnet: '1', base: '8453', arbitrum: '42161', 'arbitrum one': '42161',
  optimism: '10', polygon: '137', matic: '137', bsc: '56', 'bnb chain': '56', binance: '56',
  avalanche: '43114', solana: '1151111081099710'
});
const SUPPORTED_CHAIN_IDS = new Set(WALLET_SUPPORTED_CHAIN_IDS.map((id) => String(id)));

function chainIdOf(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || /^\d+$/.test(String(value).trim())) return String(value);
  return CHAIN_NAME_TO_ID[String(value).trim().toLowerCase()] || null;
}

/** The §19 route-risk formula, verbatim from crosschain.js#scoreRouteRisk, so
 *  the intelligence layer and the execution layer score the same risk. */
export function routeRiskProfile({ hops = 1, reliability = null, slippagePct = null } = {}) {
  const hopCount = Math.max(1, Math.round(num(hops) ?? 1));
  const hopRisk = Math.min(0.6, (hopCount - 1) * 0.15);
  const rel = num(reliability);
  const reliabilityRisk = rel !== null ? Math.max(0, (100 - rel) / 200) : 0.2;
  const slip = num(slippagePct);
  const slippageRisk = slip !== null ? Math.min(0.25, slip / 40) : 0.1;
  const failureProbabilityPct = round(Math.min(95, (hopRisk + reliabilityRisk + slippageRisk) * 100), 1);
  return {
    hops: hopCount,
    failureProbabilityPct,
    riskLevel: failureProbabilityPct > 25 ? 'HIGH' : failureProbabilityPct > 12 ? 'MODERATE' : 'LOW'
  };
}

/**
 * Score ONE candidate route on the five dimensions. Pure.
 *
 * Every dimension returns `{ status: 'KNOWN'|'UNKNOWN', value, score, detail }`
 * where score ∈ [0,1] is null whenever the status is UNKNOWN.
 */
export function scoreRouteDimensions(route = {}, { amountUsd = null } = {}) {
  const moveUsd = num(amountUsd) ?? num(route.toAmountUsd);

  /* 1 — total cost of the whole path: the provider's explicit total, or the
       sum of the fee legs it names. An explicit totalCostUsd IS a read number
       (LI.FI quotes the whole-path cost), so the dimension is KNOWN with it
       even when the legs are not broken out. */
  const legs = {
    gasUsd: num(route.gasCostUsd ?? route.gasUsd),
    bridgeFeeUsd: num(route.bridgeFeeUsd),
    protocolFeeUsd: num(route.protocolFeeUsd),
    payableFeeUsd: num(route.payableFeeUsd)
  };
  const explicitTotal = num(route.totalCostUsd);
  const legsKnown = Object.values(legs).some((v) => v !== null);
  const costKnown = explicitTotal !== null || legsKnown;
  const totalCostUsd = explicitTotal !== null
    ? explicitTotal
    : (legsKnown ? Object.values(legs).reduce((a, v) => a + (v || 0), 0) : null);
  const dims = {
    totalCost: costKnown
      ? {
          status: 'KNOWN', value: round(totalCostUsd, 4), score: null,
          detail: explicitTotal !== null
            ? `provider-quoted total path cost ${round(totalCostUsd, 4)} USD`
            : `total path cost ${round(totalCostUsd, 4)} USD (gas ${legs.gasUsd ?? '—'} / bridge ${legs.bridgeFeeUsd ?? '—'} / protocol ${legs.protocolFeeUsd ?? '—'} / payable ${legs.payableFeeUsd ?? '—'})`
        }
      : { status: 'UNKNOWN', value: null, score: null, detail: 'no cost figure was readable for this route — not treated as free' }
  };

  /* 2 — liquidity depth → estimated price impact (constant product, 1st order). */
  const depth = num(route.liquidityUsd ?? route.liquidityDepthUsd);
  const impactPct = depth !== null && moveUsd !== null && depth > 0 ? round((moveUsd / depth) * 100, 4) : null;
  dims.liquidity = depth !== null && moveUsd !== null
    ? { status: 'KNOWN', value: depth, score: null, impactPct, detail: `depth ${depth} USD vs ${moveUsd} USD moved → estimated impact ${impactPct}% (constant-product, 1st order, ESTIMATE)` }
    : { status: 'UNKNOWN', value: null, score: null, impactPct: null, detail: 'liquidity depth (or the moved amount) unread — impact is UNKNOWN, not zero' };

  /* 3 — time in flight for the whole path. */
  const seconds = num(route.estimatedSeconds ?? route.estimatedTime);
  dims.time = seconds !== null
    ? { status: 'KNOWN', value: seconds, score: null, detail: `estimated ${seconds}s in flight` }
    : { status: 'UNKNOWN', value: null, score: null, detail: 'no time estimate from the provider' };

  /* 4 — historical success: provider data ONLY. Never imputed. */
  const success = num(route.historicalSuccessPct);
  dims.historicalSuccess = success !== null
    ? { status: 'KNOWN', value: success, score: success / 100, detail: `${success}% historical success (provider-reported)` }
    : { status: 'UNKNOWN', value: null, score: null, detail: 'no historical success rate was supplied — UNKNOWN, never imputed' };

  /* 5 — bridge risk (the §19 formula; hops are always known, default 1). */
  const relRaw = route.reliabilityScore ?? (route.reliability && typeof route.reliability === 'object' ? route.reliability.score : route.reliability);
  const risk = routeRiskProfile({
    hops: route.hops ?? (Array.isArray(route.steps) ? route.steps.length : 1),
    reliability: relRaw,
    slippagePct: route.slippagePct ?? route.slippage
  });
  dims.bridgeRisk = {
    status: 'KNOWN',
    value: risk.failureProbabilityPct,
    score: round(1 - risk.failureProbabilityPct / 100, 4),
    detail: `${risk.hops} hop(s), ${risk.failureProbabilityPct}% modelled failure probability → risk ${risk.riskLevel}`
  };

  return { dims, totalCostUsd, impactPct, risk };
}

/**
 * Rank the candidates. Returns `{ ranked, rejected, unranked, best, weights }`.
 *
 *   ranked    every route that has ≥1 KNOWN dimension (scored, conservative)
 *   rejected  routes excluded by the adapter gates (hops / unsupported chain)
 *   unranked  routes with no KNOWN dimension at all — reported, never faked
 *   best      the top of `ranked`, or null when nothing could be scored
 */
export function rankRouteCandidates(routes = [], { amountUsd = null } = {}) {
  const rows = (Array.isArray(routes) ? routes : []).slice(0, 24);
  const rejected = [];
  const scoreable = [];

  for (const route of rows) {
    if (!route || typeof route !== 'object') continue;
    const fromId = chainIdOf(route.fromChain);
    const toId = chainIdOf(route.toChain);
    const hops = Math.max(1, Math.round(num(route.hops) ?? (Array.isArray(route.steps) ? route.steps.length : 1)));
    const id = route.routeId || route.quoteId || route.tool || `route_${scoreable.length + rejected.length + 1}`;
    const tool = route.toolName || route.tool || null;
    if (hops > MAX_ROUTE_HOPS) {
      rejected.push({ routeId: id, tool, code: 'HOP_LIMIT_EXCEEDED', detail: `${hops} hops exceeds the adapter ceiling of ${MAX_ROUTE_HOPS}; the execution path cannot defend a longer path` });
      continue;
    }
    for (const [label, cid] of [['fromChain', fromId], ['toChain', toId]]) {
      if (cid !== null && !SUPPORTED_CHAIN_IDS.has(cid)) {
        rejected.push({ routeId: id, tool, code: 'UNSUPPORTED_CHAIN', detail: `${label} ${label === 'fromChain' ? fromId : toId} is not a chain the wallet adapter can sign for` });
        break;
      }
    }
    if (rejected.some((r) => r.routeId === id)) continue;
    scoreable.push({ route, fromId, toId, id, tool });
  }

  /* Per-dimension cross-route reference values (only over KNOWN entries). */
  const withDims = scoreable.map((s) => {
    const { dims, totalCostUsd, impactPct, risk } = scoreRouteDimensions(s.route, { amountUsd });
    return { ...s, dims, totalCostUsd, impactPct, risk };
  });
  const bestOf = (get) => Math.min(...withDims.map(get).filter((v) => v !== null && v !== undefined && v > 0));

  for (const s of withDims) {
    const cheapest = bestOf((x) => x.totalCostUsd);
    if (s.dims.totalCost.status === 'KNOWN' && cheapest !== undefined && cheapest > 0) {
      s.dims.totalCost.score = round(Math.min(1, cheapest / s.totalCostUsd), 4);
      s.dims.totalCost.cheapestUsd = round(cheapest, 4);
    }
    const minImpact = Math.min(...withDims.map((x) => x.impactPct).filter((v) => v !== null && v >= 0));
    if (s.dims.liquidity.status === 'KNOWN' && Number.isFinite(minImpact) && s.impactPct >= 0) {
      s.dims.liquidity.score = s.impactPct === 0 ? 1 : round(Math.min(1, Math.min(minImpact, s.impactPct) / Math.max(s.impactPct, 1e-9)), 4);
      s.dims.liquidity.shallowestImpactPct = round(minImpact, 4);
    }
    const minTime = bestOf((x) => num(x.dims.time.value));
    if (s.dims.time.status === 'KNOWN' && minTime !== undefined && minTime > 0) {
      s.dims.time.score = round(Math.min(1, minTime / s.dims.time.value), 4);
      s.dims.time.fastestSeconds = minTime;
    }
  }

  const ranked = [];
  const unranked = [];
  for (const s of withDims) {
    const known = ROUTE_DIMENSIONS.filter((d) => s.dims[d].status === 'KNOWN' && s.dims[d].score !== null);
    const unknown = ROUTE_DIMENSIONS.filter((d) => !(s.dims[d].status === 'KNOWN' && s.dims[d].score !== null));
    if (!known.length) {
      unranked.push({
        routeId: s.id, tool: s.tool, code: 'UNRANKED_UNKNOWN',
        unknownDimensions: unknown,
        detail: 'no dimension was readable — the route is reported, not ranked (a zero would be a lie)'
      });
      continue;
    }
    const knownWeight = known.reduce((a, d) => a + ROUTE_DIMENSION_WEIGHTS[d], 0);
    const totalWeight = ROUTE_DIMENSIONS.reduce((a, d) => a + ROUTE_DIMENSION_WEIGHTS[d], 0);
    const raw = known.reduce((a, d) => a + ROUTE_DIMENSION_WEIGHTS[d] * s.dims[d].score, 0) / knownWeight;
    /* Conservative: unread weight discounts the total, so a half-verified
       route can never score as well as a fully verified one. */
    const score = round(raw * (knownWeight / totalWeight), 4);
    ranked.push({
      routeId: s.id,
      tool: s.tool,
      fromChain: s.fromId,
      toChain: s.toId,
      hops: s.risk.hops,
      score,
      status: 'RANKED',
      unknownDimensions: unknown,
      dimensions: ROUTE_DIMENSIONS.map((d) => ({
        dimension: d,
        weight: ROUTE_DIMENSION_WEIGHTS[d],
        status: s.dims[d].status,
        value: s.dims[d].value,
        score: s.dims[d].score,
        detail: s.dims[d].detail
      })),
      totalCostUsd: s.totalCostUsd,
      priceImpactPctEstimate: s.impactPct,
      estimatedSeconds: num(s.dims.time.value),
      failureProbabilityPct: s.risk.failureProbabilityPct,
      riskLevel: s.risk.riskLevel
    });
  }

  ranked.sort((a, b) => ((b.score ?? -1) - (a.score ?? -1)) || ((a.failureProbabilityPct ?? 100) - (b.failureProbabilityPct ?? 100)));
  const best = ranked.length ? ranked[0] : null;

  return {
    ranked: ranked.map((r, i) => ({ ...r, rank: i + 1 })),
    rejected,
    unranked,
    best,
    weights: { ...ROUTE_DIMENSION_WEIGHTS },
    maxHops: MAX_ROUTE_HOPS,
    supportedChainCount: SUPPORTED_CHAIN_IDS.size
  };
}

/**
 * The full intelligence pass: rank + the WHY of the best route + the WHY of
 * the rejections. Pure. `request` is the resolved cross-chain request.
 */
export function buildRouteIntelligence(request = {}, { routes = [], now = Date.now() } = {}) {
  const ranked = rankRouteCandidates(routes, { amountUsd: num(request.amountUsd) });
  const best = ranked.best;
  const reasons = [];
  if (best) {
    for (const d of best.dimensions) {
      if (d.status === 'KNOWN') reasons.push(`[${d.dimension}] ${d.detail}`);
    }
    const runnerUp = ranked.ranked.find((r) => r.routeId !== best.routeId);
    if (runnerUp) {
      if (runnerUp.totalCostUsd !== null && best.totalCostUsd !== null) {
        reasons.push(`runner-up ${runnerUp.tool || runnerUp.routeId} costs ${runnerUp.totalCostUsd} USD vs ${best.totalCostUsd} USD for this route`);
      }
      if (runnerUp.priceImpactPctEstimate !== null && best.priceImpactPctEstimate !== null) {
        reasons.push(`runner-up price-impact estimate ${runnerUp.priceImpactPctEstimate}% vs ${best.priceImpactPctEstimate}%`);
      }
      reasons.push(`this route is chosen over ${runnerUp.tool || runnerUp.routeId} (score ${best.score} vs ${runnerUp.score}); the margin is ${best.score - runnerUp.score >= 0.05 ? 'meaningful' : 'thin — treat the choice as a near-tie'}`);
    }
    if (best.unknownDimensions.length) {
      reasons.push(`conservative: ${best.unknownDimensions.length} of ${ROUTE_DIMENSIONS.length} dimensions unread (${best.unknownDimensions.join(', ')}); the score is discounted by their weights and the margin over the runner-up is unverified`);
    }
  } else if (!routes.length) {
    reasons.push('no candidate route was supplied');
  } else if (!best) {
    reasons.push('no candidate route had a single readable dimension — nothing is recommended and nothing is faked');
  }

  return {
    ok: true,
    schema: ROUTE_INTELLIGENCE_SCHEMA,
    at: now,
    request: {
      fromChain: chainIdOf(request.fromChain) || null,
      toChain: chainIdOf(request.toChain) || null,
      fromToken: request.fromToken ? String(request.fromToken).toUpperCase() : null,
      toToken: request.toToken ? String(request.toToken).toUpperCase() : null,
      amountUsd: num(request.amountUsd)
    },
    routeCount: Array.isArray(routes) ? routes.length : 0,
    ranked: ranked.ranked,
    rejected: ranked.rejected,
    unranked: ranked.unranked,
    bestRoute: best,
    bestRouteReasons: reasons,
    executionPermission: false,
    signs: false,
    estimate: true,
    note: 'advisory ranking over provider-reported numbers; unread dimensions stay UNKNOWN and discount the score; the execution path keeps its own gates'
  };
}

/**
 * The whyEngine's whyNetwork lines, from a stored routeIntelligence block on
 * the decision record. Every line points at a number in the block.
 */
export function routeIntelligenceWhyLines(ri) {
  if (!ri || typeof ri !== 'object') return [];
  const best = ri.bestRoute || null;
  const lines = [];
  if (!best) {
    lines.push(ri.routeCount
      ? `route intelligence ranked ${ri.routeCount} candidate route(s) but none carried a readable dimension — the network choice rests on the quote step alone`
      : 'no route intelligence was available for this decision');
    return lines;
  }
  const dim = (name) => (Array.isArray(best.dimensions) ? best.dimensions.find((d) => d.dimension === name) : null);
  lines.push(`route intelligence ranked ${ri.routeCount || best.rank || 'several'} candidate route(s); recommended ${best.tool || best.routeId} ${best.fromChain}→${best.toChain} over ${best.hops} hop(s), score ${best.score}`);
  const cost = dim('totalCost');
  if (cost && cost.status === 'KNOWN') {
    const next = Array.isArray(ri.ranked) ? ri.ranked.find((r) => r.routeId !== best.routeId) : null;
    lines.push(`total route cost ${cost.value} USD${next && next.totalCostUsd != null ? ` — the lowest of the candidates (runner-up ${next.totalCostUsd} USD)` : ''}: this network because the whole path is cheaper`);
  }
  const liq = dim('liquidity');
  if (liq && liq.status === 'KNOWN' && liq.value != null) {
    lines.push(`liquidity depth ${liq.value} USD → estimated price impact ${best.priceImpactPctEstimate}% (constant-product, 1st order, ESTIMATE): this network because the book is deeper than the alternatives`);
  }
  const time = dim('time');
  if (time && time.status === 'KNOWN') lines.push(`estimated ${time.value}s in flight for the whole path`);
  const success = dim('historicalSuccess');
  if (success && success.status === 'KNOWN') lines.push(`historical success ${success.value}% (provider-reported) for this path`);
  const risk = dim('bridgeRisk');
  if (risk && risk.status === 'KNOWN') lines.push(`modelled failure probability ${risk.value}% over ${best.hops} hop(s) (risk ${best.riskLevel})`);
  if ((best.unknownDimensions || []).length) {
    lines.push(`route intelligence: ${best.unknownDimensions.length} dimension(s) unread (${best.unknownDimensions.join(', ')}) — the ranking is conservative and the margin over the runner-up is unverified`);
  }
  return lines;
}

/** The engine wrapper: flag + persistence (capped history per owner). */
export function createRouteIntelligenceEngine({ collections = null, observability = null, log = () => {}, now = () => Date.now() } = {}) {
  async function plan(owner, { request = {}, routes = [], correlationId = null, persist = true } = {}) {
    const gate = requireFlag('ROUTE_INTELLIGENCE_ENABLED');
    if (!gate.ok) return { ok: false, code: gate.code, flag: gate.flag };
    const result = buildRouteIntelligence(request, { routes, now: now() });
    if (!Array.isArray(routes) || !routes.length) {
      return { ok: false, code: 'NO_CANDIDATE_ROUTES', detail: 'a route plan needs candidate routes from the quote step; the intelligence layer does not dial providers itself', result };
    }
    if (persist && collections) {
      try {
        const id = `ri_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
        await collections.put('route_plans', owner, { ...result, id, owner }, { idKey: 'id' });
        result.id = id;
      } catch (err) {
        log(`route-intelligence:persist-failed:${String(err?.message || err).slice(0, 80)}`);
      }
    }
    if (observability) {
      observability.emit({
        type: 'route-intelligence.planned',
        owner,
        correlationId,
        payload: {
          routes: result.routeCount,
          best: result.bestRoute?.routeId || null,
          rejected: result.rejected.length,
          unranked: result.unranked.length
        }
      });
    }
    return { ok: true, result };
  }

  async function get(owner, id) {
    if (!collections) return { ok: false, code: 'STORE_NOT_WIRED', row: null };
    try {
      const out = await collections.get('route_plans', owner, String(id));
      return out.ok ? { ok: true, row: out.row } : { ok: false, code: out.code || 'NOT_FOUND', row: null };
    } catch { return { ok: false, code: 'STORE_READ_FAILED', row: null }; }
  }

  async function recent(owner, { limit = 10 } = {}) {
    if (!collections) return { ok: false, code: 'STORE_NOT_WIRED', plans: [] };
    try {
      const { rows } = await collections.read('route_plans', owner);
      return { ok: true, plans: rows.filter((r) => r?.schema === ROUTE_INTELLIGENCE_SCHEMA).slice(0, Math.max(1, limit)) };
    } catch { return { ok: false, code: 'STORE_READ_FAILED', plans: [] }; }
  }

  return {
    schema: ROUTE_INTELLIGENCE_SCHEMA,
    plan, get, recent,
    buildRouteIntelligence,
    rankRouteCandidates,
    scoreRouteDimensions,
    routeRiskProfile,
    routeIntelligenceWhyLines,
    MAX_HOPS: MAX_ROUTE_HOPS,
    DIMENSIONS: ROUTE_DIMENSIONS,
    WEIGHTS: { ...ROUTE_DIMENSION_WEIGHTS }
  };
}
