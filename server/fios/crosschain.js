/**
 * FBT FINANCIAL INTELLIGENCE OS — Cross-chain Reasoner (§19) + Route Optimizer (§20).
 * ---------------------------------------------------------------------------
 * The user says "swap my USDC to ETH" and never has to think about chains. This
 * module works out the source wallet, the source chain, the destination, and
 * then asks the EXISTING router infrastructure for quotes:
 *
 *   server/crossChain.js#getRoutes / #getQuote  (LI.FI, already scored by
 *   src/services/cross-chain/core.js#rankRoutes for output, gas, fees, time,
 *   slippage and reliability)
 *
 * What this adds on top of that scorer:
 *   · resolution of source chain/wallet from the world model and preferences
 *   · a route risk score (hop count, tool reputation, protocol exposure)
 *   · failure probability from reliability + hops
 *   · explicit confirmation data: chain, asset, amount, fees, slippage, route,
 *     destination — the fields §19 says the user MUST be shown
 *
 * Fail-closed: no quote, no plan. An unroutable request is an error naming what
 * is missing, never a guess about where the funds would go.
 */
import { rankRoutes } from '../../src/services/cross-chain/core.js';
import { round } from '../../src/lib/central/schema.js';

export const CROSSCHAIN_SCHEMA = 'fbt.fi.crosschain-reasoner.v1';

/** Known chain names → the ids the wallet layer signs for. */
export const CHAIN_BY_NAME = Object.freeze({
  ethereum: '1', mainnet: '1', base: '8453', arbitrum: '42161',
  optimism: '10', polygon: '137', bsc: '56', binance: '56', avalanche: '43114'
});

const STABLES = new Set(['USDC', 'USDT', 'DAI', 'FDUSD', 'USDE']);

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * Resolve what the user actually asked for, from the intent plus the world
 * model. Missing pieces are NAMED, not defaulted.
 */
export function resolveCrossChainRequest({ intent = {}, world = null, preferences = null, now = Date.now() } = {}) {
  const entities = intent?.entities || {};
  const text = String(intent?.text || intent?.message || '');
  const missing = [];

  const fromAsset = String(entities.fromAsset || entities.asset || '').toUpperCase()
    || (text.match(/\b(usdc|usdt|dai|btc|eth|sol)\b/i)?.[1] || '').toUpperCase() || null;
  const toAsset = String(entities.toAsset || entities.destinationAsset || '').toUpperCase()
    || (text.match(/\b(?:to|into|به)\s+([a-z0-9]{2,10})\b/i)?.[1] || '').toUpperCase() || null;
  if (!fromAsset) missing.push('source asset');
  if (!toAsset) missing.push('destination asset');

  const amount = num(entities.amount ?? entities.amountUsd);
  if (amount === null) missing.push('amount');

  const chainName = (n) => (n ? (CHAIN_BY_NAME[String(n).toLowerCase()] || String(n)) : null);
  const fromChain = chainName(entities.fromChain || entities.chain)
    || (preferences?.preferredChains?.length ? chainName(preferences.preferredChains[0]) : null);
  const toChain = chainName(entities.toChain || entities.destinationChain);

  /* The wallet the value would leave from: the first connected address that
     actually holds the asset, otherwise the first connected chain. */
  const wallet = world?.domains?.user?.wallets?.value || null;
  const holdings = world?.domains?.user?.holdings?.value?.holdings || world?.domains?.user?.positions?.spot?.value?.holdings || [];
  const holdingRows = Array.isArray(holdings) ? holdings : [];
  const holdingFor = fromAsset ? holdingRows.find((h) => String(h.symbol || '').toUpperCase() === fromAsset) : null;
  const sourceChainGuess = holdingFor?.network || holdingFor?.chain || null;
  const sourceWallet = wallet?.address || wallet?.evmAddresses?.[0] || null;

  if (!fromChain && !sourceChainGuess) missing.push('source chain (no wallet holding found and no chain given)');

  return {
    schema: CROSSCHAIN_SCHEMA,
    at: now,
    fromAsset,
    toAsset,
    amount,
    amountIsUsd: entities.amountIsUsd !== false && (entities.amountUsd !== undefined || STABLES.has(fromAsset)),
    fromChain: fromChain || chainName(sourceChainGuess),
    toChain,
    sourceWallet,
    destination: entities.destination || sourceWallet || null,
    sameChainSwap: Boolean(fromChain && toChain && fromChain === toChain),
    missing,
    ok: missing.length === 0,
    note: !toChain ? 'no destination chain was stated; the quote step must resolve it or ask' : null
  };
}

/**
 * Route risk + failure probability. Deliberately separate from the price
 * score: a route can be the cheapest and still be the one you should not take
 * with money you cannot afford to lose.
 */
export function scoreRouteRisk(route = {}) {
  const hops = Array.isArray(route.steps) ? route.steps.length : 1;
  const tools = [...new Set((route.steps || []).map((s) => s.tool || s.toolName).filter(Boolean))];
  /* More hops = more places to fail. Each hop is a separate protocol call. */
  const hopRisk = Math.min(0.6, (hops - 1) * 0.15);
  const reliability = num(route.reliability?.score ?? route.reliability);
  const reliabilityRisk = reliability !== null ? Math.max(0, (100 - reliability) / 200) : 0.2;
  const slippage = num(route.slippage);
  const slippageRisk = slippage !== null ? Math.min(0.25, slippage / 40) : 0.1;
  const failureProbabilityPct = round(Math.min(95, (hopRisk + reliabilityRisk + slippageRisk) * 100), 1);
  return {
    hops,
    tools,
    protocolExposure: tools.length,
    failureProbabilityPct,
    riskLevel: failureProbabilityPct > 25 ? 'HIGH' : failureProbabilityPct > 12 ? 'MODERATE' : 'LOW',
    note: hops > 2 ? `${hops} hops: each one is a separate protocol that can fail or pause mid-transfer` : null
  };
}

export function createCrossChainReasoner({ router = null, evidence = null, observability = null, log = () => {}, now = () => Date.now() } = {}) {
  const R = router || {};

  /**
   * Ask the real router for routes and score them. `router` is injectable so the
   * probes can drive it with provider-shaped rows; in production it is
   * `server/crossChain.js`.
   */
  async function planRoutes(request, { order = 'RECOMMENDED', correlationId = null, owner = null } = {}) {
    if (!request?.ok) {
      return { ok: false, code: 'INCOMPLETE_REQUEST', missing: request?.missing || ['request'], detail: 'refusing to guess a route for an unresolved request' };
    }
    if (!request.toChain) {
      return { ok: false, code: 'DESTINATION_CHAIN_REQUIRED', detail: 'the destination chain must be resolved (or asked for) before quoting a bridge' };
    }
    const getRoutes = R.getRoutes || (async () => {
      const mod = await import('../crossChain.js').catch(() => null);
      return mod ? mod.getRoutes({ ...quoteParams(request), order }) : { ok: false, code: 'ROUTER_UNAVAILABLE' };
    });

    let out;
    try {
      out = await (typeof getRoutes === 'function' ? getRoutes({ ...quoteParams(request), order }) : null);
    } catch (err) {
      return { ok: false, code: 'ROUTER_FAILED', detail: String(err?.message || err).slice(0, 160) };
    }
    if (!out?.ok) return { ok: false, code: out?.code || 'NO_ROUTE_QUOTE', detail: out?.detail || 'the router returned no quote' };

    const rows = Array.isArray(out.routes) ? out.routes : (out.quote ? [out.quote] : []);
    if (!rows.length) return { ok: false, code: 'NO_ROUTES_RETURNED' };

    const ranked = rankRoutes(rows);
    const scored = ranked.map((r) => {
      const riskScore = scoreRouteRisk(r);
      const toUsd = num(r.toAmountUsd);
      const costUsd = num(r.totalCostUsd) ?? ((num(r.gasCostUsd) || 0) + (num(r.payableFeeUsd) || 0));
      return {
        routeId: r.routeId || r.quoteId || null,
        tool: r.tool || null,
        toolName: r.toolName || null,
        fromChain: r.fromChain, toChain: r.toChain,
        fromToken: r.fromTokenDetail?.symbol || r.fromToken || null,
        toToken: r.toTokenDetail?.symbol || r.toToken || null,
        toAmount: r.toAmount || null,
        toAmountMin: r.toAmountMin || null,
        toAmountUsd: toUsd,
        gasCostUsd: num(r.gasCostUsd),
        bridgeFeeUsd: num(r.bridgeFeeUsd),
        protocolFeeUsd: num(r.protocolFeeUsd),
        payableFeeUsd: num(r.payableFeeUsd),
        totalCostUsd: costUsd,
        effectiveUsd: toUsd !== null && costUsd !== null ? round(toUsd - costUsd, 4) : null,
        slippagePct: num(r.slippage),
        estimatedSeconds: num(r.estimatedTime),
        hops: riskScore.hops,
        reliability: r.reliability || null,
        priceScore: num(r.score),
        risk: riskScore,
        rank: r.rank,
        executable: r.executable !== false
      };
    });

    /* Rank by effective value after costs; a route with no USD leg cannot be
       compared and is reported, not silently dropped. */
    scored.sort((a, b) => ((b.effectiveUsd ?? -Infinity) - (a.effectiveUsd ?? -Infinity)) || ((a.risk.failureProbabilityPct ?? 100) - (b.risk.failureProbabilityPct ?? 100)));
    const best = scored.find((r) => r.effectiveUsd !== null && r.executable) || null;

    if (evidence && best) {
      await evidence.record(owner, [{
        type: 'quote', source: `crosschain:${best.tool || 'router'}`,
        value: { routeId: best.routeId, toAmountUsd: best.toAmountUsd, totalCostUsd: best.totalCostUsd, slippagePct: best.slippagePct, hops: best.hops },
        at: now(), ttlMs: 90_000
      }], { correlationId });
    }
    if (observability) observability.emit({ type: 'state.built', owner, correlationId, payload: { engine: 'crosschain', routes: scored.length, best: best?.routeId || null } });

    return {
      ok: true,
      schema: CROSSCHAIN_SCHEMA,
      request,
      routes: scored,
      best,
      /* §19: the exact fields the confirmation must display. */
      confirmation: best ? {
        chain: `${best.fromChain} → ${best.toChain}`,
        asset: `${best.fromToken} → ${best.toToken}`,
        amount: request.amount,
        amountIsUsd: request.amountIsUsd,
        feesUsd: best.totalCostUsd,
        slippagePct: best.slippagePct,
        route: [best.toolName || best.tool, ...scored[0].risk.tools].filter(Boolean).join(' → '),
        destination: request.destination,
        expectedReceive: best.toAmount,
        minReceive: best.toAmountMin,
        estimatedSeconds: best.estimatedSeconds,
        failureProbabilityPct: best.risk.failureProbabilityPct
      } : null,
      at: now(),
      quoteTtlMs: 90_000
    };
  }

  return { schema: CROSSCHAIN_SCHEMA, planRoutes, resolveCrossChainRequest, scoreRouteRisk };
}

function quoteParams(request) {
  return {
    fromChain: request.fromChain,
    toChain: request.toChain,
    fromToken: request.fromAsset,
    toToken: request.toAsset,
    amount: request.amount,
    fromAddress: request.sourceWallet || undefined,
    slippage: request.slippage ?? undefined
  };
}
