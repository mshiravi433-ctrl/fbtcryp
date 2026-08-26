/**
 * FBT INTENT AI — AGENT 2: EXECUTION ORCHESTRATOR
 * ---------------------------------------------------------------------------
 * The Execution Orchestrator is the ONLY agent allowed to interact with
 * wallets, broker accounts, routers and bridges. It receives candidate
 * strategies from the Strategy Agent, reviews them independently against
 * policy, requests Guardian approval, and (if approved) builds an execution
 * plan. It never invents quotes; it never approves its own work; it never
 * holds raw credentials.
 *
 * Identity:
 *   id:          "fbt.exec"
 *   role:        "EXECUTION_ORCHESTRATOR"
 *   authority:   "wallet, smart_wallet, broker, swap, dex, router, bridge,
 *                 defi, farm, futures, dydx, cex, stablecoin, portfolio,
 *                 execution, monitoring, exit"
 *   governedBy:  policy (sanitizePolicy) + guardian (guardianReview)
 */

import { guardianReview } from './guardian.js';
import { termsFingerprint } from '../intentLifecycle.js';

export const EXECUTION_ORCHESTRATOR_ID = 'fbt.exec';

export const EXECUTION_ORCHESTRATOR_IDENTITY = Object.freeze({
  id: EXECUTION_ORCHESTRATOR_ID,
  role: 'EXECUTION_ORCHESTRATOR',
  authority: [
    'wallet', 'smart_wallet', 'broker_account', 'swap', 'dex',
    'liquidity_router', 'bridge', 'defi', 'farm', 'futures', 'dydx', 'cex',
    'stablecoin_conversion', 'portfolio_management', 'execution',
    'monitoring', 'exit'
  ],
  notAllowed: [
    'hold_private_key', 'hold_raw_credential', 'disable_guardian',
    'disable_audit', 'approve_own_execution', 'fabricate_receipt'
  ]
});

/* ---------- helpers ---------- */

function clone(p) { return JSON.parse(JSON.stringify(p)); }

/**
 * Independently review a strategy proposal against policy & runtime context.
 * Returns a list of issues (each either 'block' or 'warn').
 */
export function reviewProposal(proposal, policy, ctx = {}) {
  const issues = [];
  if (!proposal || !proposal.strategy) {
    issues.push({ level: 'block', code: 'MISSING_PROPOSAL' });
    return issues;
  }

  // Capability checks
  const disabled = ctx.disabledCapabilities || {};
  for (const u of proposal.uses || []) {
    if (disabled[u] === false) {
      issues.push({ level: 'block', code: `CAPABILITY_DISABLED:${u}`, detail: u });
    }
  }

  // Leverage
  if (proposal.leverage && proposal.leverage > 1) {
    if (Number(policy.maxLeverage) < Number(proposal.leverage)) {
      issues.push({ level: 'block', code: 'LEVERAGE_ABOVE_POLICY', detail: proposal.leverage });
    }
  }

  // Capital sanity
  const amountUsd = Number(ctx.amountUsd) || Number(proposal.amountUsd) || 0;
  if (amountUsd <= 0) issues.push({ level: 'warn', code: 'AMOUNT_USD_UNKNOWN' });

  if (Number(policy.level) < 3 && proposal.strategy !== 'spot_swap' && proposal.strategy !== 'smart_routed_spot') {
    issues.push({ level: 'block', code: 'LEVEL_TOO_LOW_FOR_STRATEGY' });
  }

  // Risk label sanity
  if (proposal.risk === 'high' && Number(policy.maxLossUsd) <= 0) {
    issues.push({ level: 'block', code: 'HIGH_RISK_REQUIRES_LOSS_CAP' });
  }

  // Bridge checks
  if (proposal.requiresBridge && disabled.bridge === false) {
    issues.push({ level: 'block', code: 'BRIDGE_DISABLED' });
  }

  // External agent
  if (proposal.requiresExternalDiscovery && disabled.externalAgent === false) {
    issues.push({ level: 'block', code: 'EXTERNAL_AGENT_DISABLED' });
  }

  return issues;
}

/**
 * Build a transaction plan from an accepted proposal. This is a PLAN, not
 * a signed transaction — it contains step-by-step actions that will each be
 * passed back through Guardian before being sent to any adapter.
 */
export function buildExecutionPlan(proposal, ctx = {}) {
  const steps = [];
  const planId = `plan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  const base = {
    planId,
    proposalId: proposal.id,
    strategy: proposal.strategy,
    agentId: EXECUTION_ORCHESTRATOR_ID,
    createdAt: Date.now(),
    requiresSignature: true,
    requiresGuardianPerStep: true
  };

  switch (proposal.strategy) {
    case 'spot_swap':
    case 'smart_routed_spot':
      steps.push({
        seq: 1,
        action: 'swap',
        chainId: proposal.chainId,
        fromSymbol: proposal.from,
        toSymbol: proposal.to,
        amountUsd: ctx.amountUsd || null,
        protocol: 'dex_aggregator',
        slippagePct: ctx.slippagePct || 0.5,
        deadlineSec: 600,
        expectsGuardian: true
      });
      break;

    case 'bridge_then_swap':
      steps.push({
        seq: 1,
        action: 'bridge',
        fromChain: proposal.chainId,
        toChain: proposal.targetChainId,
        asset: proposal.from,
        protocol: 'bridge_router',
        deadlineSec: 1800,
        expectsGuardian: true
      });
      steps.push({
        seq: 2,
        action: 'swap',
        chainId: proposal.targetChainId,
        fromSymbol: proposal.from,
        toSymbol: proposal.to,
        protocol: 'dex_aggregator',
        slippagePct: ctx.slippagePct || 0.5,
        deadlineSec: 600,
        expectsGuardian: true,
        dependsOnStep: 1
      });
      break;

    case 'perpetual_dydx':
      steps.push({
        seq: 1,
        action: 'swap',
        chainId: proposal.chainId,
        fromSymbol: proposal.from || 'USDC',
        toSymbol: 'USDC',
        protocol: 'dex_aggregator',
        expectsGuardian: true
      });
      steps.push({
        seq: 2,
        action: 'futures',
        chainId: 42161,
        protocol: 'dydx',
        asset: proposal.asset,
        direction: proposal.direction,
        leverage: proposal.leverage,
        stopLossPct: 5,
        takeProfitPct: proposal.goalPct || 5,
        deadlineSec: 3600 * 24,
        expectsGuardian: true,
        dependsOnStep: 1
      });
      break;

    case 'defi_lending':
      steps.push({
        seq: 1,
        action: 'deposit',
        chainId: proposal.chainId,
        asset: proposal.asset,
        protocol: 'lending_market',
        expectsGuardian: true
      });
      break;

    case 'goal_based_spot':
      steps.push({
        seq: 1,
        action: 'swap',
        chainId: proposal.chainId,
        fromSymbol: proposal.from,
        toSymbol: proposal.to,
        protocol: 'dex_aggregator',
        slippagePct: ctx.slippagePct || 0.5,
        deadlineSec: 600,
        expectsGuardian: true
      });
      steps.push({
        seq: 2,
        action: 'monitor_exit',
        chainId: proposal.chainId,
        asset: proposal.to,
        takeProfitPct: proposal.goalPct,
        stopLossPct: proposal.projectedLossPct || 10,
        durationHrs: proposal.durationHrs || 24,
        expectsGuardian: true
      });
      break;

    case 'external_specialist_referral':
      steps.push({
        seq: 1,
        action: 'discover_external_agent',
        requiredCapabilities: ['specialized_execution'],
        expectsGuardian: true
      });
      break;

    default:
      steps.push({
        seq: 1,
        action: 'draft_only',
        strategy: proposal.strategy,
        expectsGuardian: true
      });
  }

  return { ...base, steps };
}

/**
 * Full orchestration flow: handshake → review → Guardian gate → plan.
 *
 * @param {object} strategyOutput  output of formulateStrategies()
 * @param {object} policy          a sanitized policy (permissions.js)
 * @param {object} ctx             { selectedProposalId, amountUsd, slippagePct,
 *                                   sessionStartAt, now, disabledCapabilities,
 *                                   executionAuthorized }
 */
export function orchestrate(strategyOutput, policy, ctx = {}) {
  const handshake = [
    {
      from: STRATEGY_HANDSHAKE.agent,
      announce: STRATEGY_HANDSHAKE
    },
    {
      from: EXECUTION_ORCHESTRATOR_ID,
      announce: EXECUTION_ORCHESTRATOR_IDENTITY
    }
  ];

  if (!strategyOutput || !Array.isArray(strategyOutput.proposals)) {
    return {
      ok: false,
      handshake,
      selected: null,
      review: [{ level: 'block', code: 'NO_STRATEGY' }],
      guardian: { approved: false, reasons: ['NO_STRATEGY'] },
      plan: null
    };
  }

  // select proposal
  let selected = strategyOutput.proposals.find((p) => p.id === ctx.selectedProposalId)
    || strategyOutput.proposals[0];

  // independent review
  let issues = reviewProposal(selected, policy, ctx);
  const blocked = issues.some((i) => i.level === 'block');

  // REPLAN: if blocked, try to find a fallback that does not use the rejected capability
  if (blocked) {
    const rejectedCaps = new Set(
      issues.filter((i) => i.code && i.code.startsWith('CAPABILITY_DISABLED:'))
        .map((i) => i.detail)
    );
    // try each proposal in confidence order
    const ranked = [...strategyOutput.proposals].sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
    for (const candidate of ranked) {
      const usesAnyRejected = (candidate.uses || []).some((u) => rejectedCaps.has(u));
      if (usesAnyRejected) continue;
      const candidateIssues = reviewProposal(candidate, policy, ctx);
      if (!candidateIssues.some((i) => i.level === 'block')) {
        selected = candidate;
        issues = candidateIssues;
        break;
      }
    }
  }

  // build plan (provisional)
  const plan = buildExecutionPlan(selected, ctx);

  // Guardian: check each sensitive step.
  // - L3 policy (autonomousExecution=true) → steps that truly execute carry execution:true.
  // - L2 (PREPARE)                       → NO step is marked as executing; we are only building
  //                                        quotes and drafts, and Guardian's L2 gate allows that.
  // - L1 (ANALYSIS)                      → no execution.
  const isExec = policy.level >= 3 && policy.autonomousExecution === true;
  const guardianResults = plan.steps.map((step) => {
    const action = {
      action: step.action,
      chainId: step.chainId || step.fromChain,
      protocol: step.protocol,
      asset: step.asset || step.toSymbol,
      toSymbol: step.toSymbol,
      fromSymbol: step.fromSymbol,
      amountUsd: ctx.amountUsd,
      leverage: step.leverage,
      slippagePct: step.slippagePct,
      feeBps: selected.estimatedCostBps,
      // Only real, user-confirmed L3 submissions count as execution. Quote/draft
      // steps (draft_only, monitor_exit, discover_*) are never executable.
      execution: isExec
        && ['swap', 'bridge', 'send', 'futures', 'deposit', 'withdraw'].includes(step.action)
    };
    return {
      stepSeq: step.seq,
      ...guardianReview(action, policy, {
        sessionStartAt: ctx.sessionStartAt,
        currentLossUsd: ctx.currentLossUsd || 0,
        now: ctx.now || Date.now()
      })
    };
  });

  const allApproved = guardianResults.every((g) => g.approved);
  const blockingIssues = issues.filter((i) => i.level === 'block').map((i) => i.code);
  const blockingReasons = guardianResults
    .filter((g) => !g.approved)
    .flatMap((g) => g.reasons);

  const ok = allApproved && blockingIssues.length === 0;

  // Terms fingerprint for the confirmation gate
  const terms = {
    chainId: selected.chainId || plan.steps[0]?.chainId,
    amountIn: ctx.amountUsd || 0,
    fromSymbol: selected.from,
    toSymbol: selected.to || selected.asset,
    slippagePct: ctx.slippagePct || 0.5,
    routeFingerprint: plan.planId
  };
  const termsHash = termsFingerprint(terms);

  return {
    ok,
    handshake,
    selected,
    review: issues,
    guardian: {
      perStep: guardianResults,
      approved: allApproved,
      reasons: [...blockingIssues, ...blockingReasons]
    },
    plan: ok ? plan : null,
    terms,
    termsHash,
    requiresConfirmation: true,
    agentId: EXECUTION_ORCHESTRATOR_ID
  };
}

const STRATEGY_HANDSHAKE = { agent: 'fbt.strategy', role: 'STRATEGY_AGENT' };

/** Social protocol message factory for the orchestrator. */
export function orchestratorSocial(type, detail = {}) {
  const allowed = ['greeting', 'acknowledge', 'thank', 'politely-disagree', 'request-evidence', 'apologize', 'recalculate', 'approve', 'reject', 'goodbye'];
  if (!allowed.includes(type)) throw new Error(`SOCIAL_PROTOCOL_UNKNOWN:${type}`);
  return {
    from: EXECUTION_ORCHESTRATOR_ID,
    type,
    detail: typeof detail === 'string' ? { message: detail } : detail,
    ts: Date.now(),
    isSocial: true,
    isCommand: false
  };
}
