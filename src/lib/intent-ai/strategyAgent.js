/**
 * FBT INTENT AI — AGENT 1: STRATEGY AGENT
 * ---------------------------------------------------------------------------
 * The Strategy Agent researches, analyses the market & the user's intent,
 * and proposes candidate strategies. It never executes, never signs, and
 * never holds credentials. Its output is a structured StrategyProposal that
 * the Execution Orchestrator independently reviews before any action.
 *
 * Identity (used in Agent Social Protocol):
 *   id:          "fbt.strategy"
 *   role:        "STRATEGY_AGENT"
 *   authority:   "research, analysis, opportunity discovery, scenario planning"
 *   notAllowed:  ["sign", "execute", "hold_keys", "bypass_guardian",
 *                 "disable_audit", "exceed_policy"]
 */

/**
 * Technical-analysis is injected so this module stays import-safe in pure
 * Node (the ai.js module chain pulls backtest which uses extensionless
 * imports that don't resolve under Node ESM). In production the caller
 * passes analyze/projectRange from lib/ai; in tests a stub works fine.
 */

export const STRATEGY_AGENT_ID = 'fbt.strategy';

export const STRATEGY_AGENT_IDENTITY = Object.freeze({
  id: STRATEGY_AGENT_ID,
  role: 'STRATEGY_AGENT',
  authority: [
    'research', 'market_analysis', 'news_analysis', 'onchain_analysis',
    'technical_analysis', 'opportunity_discovery', 'strategy_creation',
    'goal_optimization', 'scenario_analysis'
  ],
  notAllowed: [
    'sign', 'execute', 'hold_keys', 'bypass_guardian',
    'disable_audit', 'exceed_policy', 'approve_final_outcome'
  ]
});

const DEFAULT_OPTIONAL_CAPS = Object.freeze({
  futures: true,
  dydx: true,
  cex: true,
  bridge: true,
  defi: true,
  smartWallet: true,
  externalAgent: true,
  investment: true,
  rwa: false
});

/**
 * Build candidate strategies for a structured intent + context.
 *
 * @param {object} intent   structured intent from the parser
 * @param {object} [ctx]    { prices:[], coin:{}, portfolio:{}, news:[],
 *                           disabledCapabilities:{...}, maxLossUsd,
 *                           timeHorizonHrs, externalAgents:[] }
 * @returns {{proposals: StrategyProposal[], evidence: object[], agentId}}
 */
export function formulateStrategies(intent, ctx = {}) {
  const proposals = [];
  const evidence = [];
  const disabled = { ...DEFAULT_OPTIONAL_CAPS, ...(ctx.disabledCapabilities || {}) };
  const analyzer = ctx.analyzer || null;
  const ranger = ctx.ranger || null;

  if (!intent || !intent.action) {
    return { proposals, evidence, agentId: STRATEGY_AGENT_ID, error: 'NO_INTENT' };
  }

  // --- evidence collection ---
  const prices = Array.isArray(ctx.prices) ? ctx.prices.slice() : [];
  const ta = (prices.length >= 30 && typeof analyzer === 'function') ? analyzer(prices, ctx.coin || {}) : null;
  if (ta) evidence.push({ type: 'technical_analysis', summary: ta.label, confidence: ta.confidence });
  if (Array.isArray(ctx.news) && ctx.news.length) {
    evidence.push({ type: 'news_sample', count: ctx.news.length });
  }
  if (ctx.portfolio && typeof ctx.portfolio === 'object') {
    evidence.push({ type: 'portfolio_snapshot', totalUsd: ctx.totalPortfolioUsd || null });
  }

  const from = intent.fromSymbol;
  const to = intent.toSymbol;
  const chainId = intent.chainId;
  const action = intent.action;

  // --- strategy builders, each gated by capability availability ---

  // 1. Same-chain spot swap (always available base case)
  if (from && to && from !== to) {
    proposals.push({
      id: `spot_${from}_${to}_${chainId || 'any'}`,
      strategy: 'spot_swap',
      description: `Swap ${from} → ${to} on a single chain via aggregated DEX liquidity.`,
      uses: ['swap'],
      chainId,
      from,
      to,
      leverage: 1,
      requiresBridge: false,
      risk: 'low',
      estimatedCostBps: 30,
      confidence: ta ? ta.confidence : 40,
      timeHorizon: 'minutes',
      canSucceedWithout: ['futures', 'bridge', 'cex', 'defi']
    });
  }

  // 2. Smart-routed swap across DEXes (same chain)
  if (from && to && disabled.smartWallet !== false) {
    proposals.push({
      id: `smartroute_${from}_${to}`,
      strategy: 'smart_routed_spot',
      description: `Route ${from} → ${to} across multiple DEX aggregators for best price.`,
      uses: ['swap', 'smartWallet'],
      chainId,
      from,
      to,
      leverage: 1,
      requiresBridge: false,
      risk: 'low',
      estimatedCostBps: 20,
      confidence: ta ? Math.min(80, ta.confidence + 5) : 45,
      timeHorizon: 'minutes',
      canSucceedWithout: ['futures', 'bridge', 'cex', 'defi']
    });
  }

  // 3. Leveraged perp via dYdX (if enabled and intent implies speculation)
  if (disabled.dydx !== false && disabled.futures !== false && to && (intent.direction === 'buy' || intent.direction === 'sell')) {
    const lev = Math.min(intent.leverage || 2, 5);
    proposals.push({
      id: `perp_dydx_${to}_${lev}x`,
      strategy: 'perpetual_dydx',
      description: `Open a ${lev}x ${intent.direction} position on ${to} via dYdX.`,
      uses: ['futures', 'dydx'],
      chainId: chainId || 42161, // dYdX lives on Arbitrum (simplified)
      asset: to,
      leverage: lev,
      direction: intent.direction,
      requiresBridge: chainId !== 42161,
      risk: 'high',
      estimatedCostBps: 8,
      confidence: ta ? Math.max(15, ta.confidence - 20) : 25,
      timeHorizon: intent.durationHrs ? `${intent.durationHrs}h` : 'intraday',
      canSucceedWithout: ['bridge', 'cex', 'defi', 'externalAgent']
    });
  }

  // 4. Bridge-and-swap (cross-chain) if the requested chain differs
  if (disabled.bridge !== false && from && to && ctx.targetChainId && ctx.targetChainId !== chainId) {
    proposals.push({
      id: `bridge_swap_${from}_${to}_${ctx.targetChainId}`,
      strategy: 'bridge_then_swap',
      description: `Bridge ${from} to chain ${ctx.targetChainId}, then swap to ${to}.`,
      uses: ['bridge', 'swap'],
      chainId,
      targetChainId: ctx.targetChainId,
      from,
      to,
      leverage: 1,
      requiresBridge: true,
      risk: 'medium',
      estimatedCostBps: 60,
      confidence: ta ? Math.max(20, ta.confidence - 10) : 30,
      timeHorizon: '10-30 minutes',
      canSucceedWithout: ['futures', 'cex', 'defi']
    });
  }

  // 5. Goal-based scenario projection. Always produced when kind === 'goal' so
  // the user sees the honest probability/risk projection even without a live
  // price feed. No TA data → conservative probability estimate (never >45%).
  if (intent.kind === 'goal' && intent.goalPct > 0) {
    const horizonDays = Math.max(1, (intent.durationHrs || 24) / 24);
    let range = null;
    let probabilityOfHit = 15;
    if (ta && typeof ranger === 'function') {
      range = ranger(ta, horizonDays);
      const pctToTarget = intent.goalPct;
      probabilityOfHit = range
        ? Math.max(2, Math.min(45, (range.probability || 50) * (1 - Math.abs(pctToTarget - 50) / 100)))
        : 15;
    } else {
      // Without price data, be explicitly conservative: <50% and target-agnostic.
      probabilityOfHit = Math.max(2, Math.min(20, 50 / Math.max(1, intent.goalPct / 10)));
    }
    const targetAsset = to || (from ? null : null);
    proposals.push({
      id: `goal_${intent.goalPct}pct_${from || 'capital'}`,
      strategy: 'goal_based_spot',
      description: `Target +${intent.goalPct}% from ${from || 'capital'} over ${intent.durationHrs || 24}h. NOT guaranteed. Spot-only, with explicit stop-loss.`,
      uses: ['swap'],
      chainId,
      from: from || 'USD',
      to: targetAsset,
      goalPct: intent.goalPct,
      durationHrs: intent.durationHrs || 24,
      estimatedHitProbability: Math.round(probabilityOfHit),
      projectedLossPct: Math.min(25, Math.round(intent.goalPct * 0.5)),
      risk: 'high',
      leverage: 1,
      projectedRange: range,
      requiresBridge: false,
      confidence: Math.round(probabilityOfHit),
      disclaimers: [
        'NOT_GUARANTEED', 'MARKETS_CAN_MOVE_AGAINST_YOU',
        'PARTIAL_LOSS_POSSIBLE', 'SLIPPAGE_MAY_ERODE_TARGET'
      ],
      canSucceedWithout: ['futures', 'bridge', 'cex', 'defi', 'externalAgent']
    });
  }

  // 6. DeFi yield (if intent asks for passive/yield/farm)
  if (disabled.defi !== false && /farm|yield|stake|passive|earn/i.test(intent.raw || '')) {
    proposals.push({
      id: `defi_supply_${from || 'USDC'}`,
      strategy: 'defi_lending',
      description: `Supply ${from || 'stablecoin'} to a vetted lending market for variable yield.`,
      uses: ['defi'],
      chainId: chainId || 42161,
      asset: from || 'USDC',
      leverage: 1,
      risk: 'medium',
      estimatedCostBps: 0,
      estimatedApyPct: ctx.defiApy || 5,
      confidence: 50,
      timeHorizon: 'days-weeks',
      canSucceedWithout: ['futures', 'bridge', 'cex', 'externalAgent']
    });
  }

  // 7. External-specialist (deferred — labelled as candidate; never auto-selected)
  if (disabled.externalAgent !== false && Array.isArray(ctx.externalAgents) && ctx.externalAgents.length) {
    proposals.push({
      id: 'external_specialist_pending',
      strategy: 'external_specialist_referral',
      description: 'A verified external specialist agent may offer a specialised strategy (e.g. hedging, liquid-staking routing). Requires explicit user opt-in.',
      uses: ['externalAgent'],
      risk: 'varies',
      confidence: 0,
      requiresExternalDiscovery: true,
      canSucceedWithout: ['futures', 'bridge', 'cex', 'defi', 'dydx', 'smartWallet']
    });
  }

  // --- REPLAN: if a capability was rejected, the agent still returns the
  // best remaining option, never "STOP". The base spot-swap proposal above is
  // the universal fallback. ---

  // Tag each proposal with its "replanner" (which alternative to switch to if a
  // required capability is rejected at confirmation time).
  for (const p of proposals) {
    if (p.strategy === 'perpetual_dydx') {
      p.replanOnReject = { futures: 'spot_swap', dydx: 'spot_swap', leverage: 'spot_swap' };
    } else if (p.strategy === 'bridge_then_swap') {
      p.replanOnReject = { bridge: 'spot_swap' };
    } else if (p.strategy === 'defi_lending') {
      p.replanOnReject = { defi: 'spot_swap' };
    } else {
      p.replanOnReject = {};
    }
  }

  return {
    proposals: proposals.map((p) => ({ ...p, agentId: STRATEGY_AGENT_ID })),
    evidence,
    agentId: STRATEGY_AGENT_ID,
    researchNotes: {
      disclaimer: 'Proposals are analysis, not guaranteed profit. Guardian approves every action.'
    }
  };
}

/** Social protocol message factory. */
export function strategySocial(type, detail = {}) {
  const allowed = ['greeting', 'acknowledge', 'thank', 'politely-disagree', 'request-evidence', 'apologize', 'recalculate', 'approve', 'reject', 'goodbye'];
  if (!allowed.includes(type)) throw new Error(`SOCIAL_PROTOCOL_UNKNOWN:${type}`);
  return {
    from: STRATEGY_AGENT_ID,
    type,
    detail: typeof detail === 'string' ? { message: detail } : detail,
    ts: Date.now(),
    isSocial: true,
    isCommand: false
  };
}
