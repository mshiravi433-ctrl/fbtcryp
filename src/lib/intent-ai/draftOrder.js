/**
 * FBT INTENT AI — DRAFT ORDER (LEVEL 2 PREPARE)
 * ---------------------------------------------------------------------------
 * A DraftOrder is a quote + proposed transaction plan. It is NOT executable
 * until:
 *   1. Guardian approves it for the current policy,
 *   2. The user passes the Confirmation Gate (or L3 policy authorizes it),
 *   3. The lifecycle reaches AWAITING_SIGNATURE with a matching terms hash.
 *
 * The draft is fully serialisable and safe to persist in local storage (no
 * secrets, no calldata, no signer handles).
 */

export const DRAFT_ORDER_SCHEMA = 'fbt.draft-order.v1';

const ALLOWED_KINDS = new Set([
  'swap', 'bridge', 'send', 'deposit', 'withdraw',
  'futures_open', 'futures_close', 'farm_deposit', 'farm_withdraw',
  'lend_supply', 'lend_withdraw', 'borrow', 'repay', 'custom'
]);

function uid(prefix = 'draft') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function num(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Create a DraftOrder from an execution plan step (or standalone input).
 *
 * @param {object} input
 * @param {string} input.kind        e.g. 'swap'
 * @param {number} input.chainId
 * @param {string} input.fromSymbol
 * @param {string} input.toSymbol
 * @param {number} input.amountIn
 * @param {string} [input.amountInSymbol]
 * @param {number} [input.amountOutEstimate]
 * @param {string} [input.amountOutSymbol]
 * @param {number} [input.amountUsd]
 * @param {number} [input.slippagePct]
 * @param {number} [input.feeBps]
 * @param {number} [input.deadlineSec]
 * @param {string} [input.protocol]
 * @param {string} [input.recipientRef]
 * @param {number} [input.leverage]
 * @param {number} [input.maxLossUsd]
 * @param {object} [input.route]
 * @param {string} [input.note]
 * @param {string} [input.agentId]
 * @param {string} [input.policyId]
 */
export function createDraftOrder(input = {}) {
  const kind = String(input.kind || 'custom').toLowerCase();
  if (!ALLOWED_KINDS.has(kind)) {
    return { error: 'UNSUPPORTED_KIND', kind };
  }

  const chainId = num(input.chainId);
  const amountIn = num(input.amountIn);
  if (!chainId) return { error: 'MISSING_CHAIN_ID' };
  if (amountIn == null || amountIn <= 0) return { error: 'MISSING_AMOUNT_IN' };

  const fromSymbol = String(input.fromSymbol || '').toUpperCase().slice(0, 12);
  const toSymbol = input.toSymbol ? String(input.toSymbol).toUpperCase().slice(0, 12) : null;
  if (!fromSymbol) return { error: 'MISSING_FROM_ASSET' };

  const order = {
    schema: DRAFT_ORDER_SCHEMA,
    id: input.id || uid('order'),
    kind,
    chainId,
    fromSymbol,
    toSymbol,
    amountIn,
    amountInSymbol: String(input.amountInSymbol || fromSymbol).toUpperCase(),
    amountOutEstimate: num(input.amountOutEstimate),
    amountOutSymbol: input.amountOutSymbol ? String(input.amountOutSymbol).toUpperCase() : toSymbol,
    amountUsd: num(input.amountUsd),
    priceImpactPct: num(input.priceImpactPct) ?? 0,
    slippagePct: num(input.slippagePct) ?? 0.5,
    feeBps: num(input.feeBps) ?? 30,
    deadlineAt: input.deadlineAt
      ? num(input.deadlineAt)
      : Date.now() + (num(input.deadlineSec) || 600) * 1000,
    protocol: input.protocol ? String(input.protocol).slice(0, 32) : null,
    recipientRef: input.recipientRef ? String(input.recipientRef).slice(0, 64) : null,
    leverage: Math.max(1, num(input.leverage) || 1),
    maxLossUsd: num(input.maxLossUsd),
    route: input.route && typeof input.route === 'object' ? input.route : null,
    agentInvolved: input.agentId ? String(input.agentId).slice(0, 48) : null,
    policyId: input.policyId ? String(input.policyId).slice(0, 64) : null,
    note: String(input.note || '').slice(0, 200),
    status: 'DRAFT',
    createdAt: Date.now(),
    warnings: [],
    risks: []
  };

  // basic risk markers
  if (order.slippagePct > 1) order.risks.push('HIGH_SLIPPAGE');
  if (order.priceImpactPct > 2) order.risks.push('HIGH_PRICE_IMPACT');
  if (order.leverage > 3) order.risks.push('HIGH_LEVERAGE');
  if (!order.amountUsd) order.warnings.push('USD_VALUE_UNKNOWN');

  return { ok: true, order };
}

/**
 * Convert a transaction-plan step (from executionOrchestrator.buildExecutionPlan)
 * into a DraftOrder.
 */
export function draftOrderFromPlanStep(step, plan, ctx = {}) {
  return createDraftOrder({
    kind: mapActionToKind(step.action),
    chainId: step.chainId || step.fromChain,
    fromSymbol: step.fromSymbol || step.asset,
    toSymbol: step.toSymbol || step.asset,
    amountIn: ctx.amountIn || ctx.amountUsd || 0,
    amountInSymbol: step.fromSymbol || (step.asset === 'USDC' ? 'USDC' : null),
    amountUsd: ctx.amountUsd || null,
    slippagePct: step.slippagePct || ctx.slippagePct || 0.5,
    deadlineSec: step.deadlineSec || 600,
    protocol: step.protocol,
    leverage: step.leverage,
    maxLossUsd: ctx.maxLossUsd,
    agentId: plan.agentId,
    policyId: ctx.policyId,
    route: { planId: plan.planId, stepSeq: step.seq },
    note: `${plan.strategy} / step ${step.seq}`
  });
}

function mapActionToKind(action) {
  switch (action) {
    case 'swap': return 'swap';
    case 'bridge': return 'bridge';
    case 'send': return 'send';
    case 'futures': return 'futures_open';
    case 'deposit': return 'deposit';
    case 'withdraw': return 'withdraw';
    default: return 'custom';
  }
}

/**
 * Final summary shape for the Confirmation Gate UI.
 * Returns the immutable summary block the user must review.
 */
export function confirmationSummary(order) {
  if (!order || order.schema !== DRAFT_ORDER_SCHEMA) return null;
  return Object.freeze({
    asset_pair: `${order.fromSymbol} → ${order.toSymbol || order.fromSymbol}`,
    amount_in: `${order.amountIn} ${order.amountInSymbol}`,
    amount_out_estimate: order.amountOutEstimate
      ? `${order.amountOutEstimate} ${order.amountOutSymbol || ''}`.trim()
      : 'quoted at execution time',
    usd_value: order.amountUsd != null ? `$${order.amountUsd.toFixed(2)}` : 'unknown',
    chain_id: order.chainId,
    protocol: order.protocol || 'aggregator-best',
    recipient: order.recipientRef || 'self',
    slippage_pct: `${order.slippagePct}%`,
    fee_bps: `${order.feeBps} bps`,
    leverage: order.leverage > 1 ? `${order.leverage}x` : '1x (spot)',
    deadline_iso: new Date(order.deadlineAt).toISOString(),
    max_loss_usd: order.maxLossUsd != null ? `$${order.maxLossUsd.toFixed(2)}` : 'n/a',
    agent_involved: order.agentInvolved || 'fbt-core',
    policy_id: order.policyId || 'none',
    risks: order.risks,
    warnings: order.warnings
  });
}
