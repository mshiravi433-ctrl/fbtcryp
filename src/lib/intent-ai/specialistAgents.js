/**
 * FBT INTENT AI — Spec 65 items 6–20: Specialist agent contracts.
 *
 * Today only Strategy and Execution are real internal engines; the remaining
 * Council roles are votes. These contracts make every role explicit: bounded
 * inputs, bounded outputs, and an explicit CANNOT list. No specialist signs or
 * executes. Guardian keeps an independent STOP that no vote, personality or
 * support flow can override.
 *
 * A specialist contract is a specification with a deterministic check — it is
 * NOT a live engine. `live: false` stays until a real runtime is attached.
 */

import { bounded, containsRawSecret, fail, finite, noExecutionPermission, safeId, safeString } from './phaseBoundary.js';

export const SPECIALIST_AGENTS_SCHEMA = 'fbt.specialist-agents.v1';

export const SPECIALIST_ROLES = Object.freeze([
  'strategy', 'execution', 'risk', 'guardian', 'research',
  'market', 'liquidity', 'bridge', 'fee', 'gas',
  'portfolio', 'hedge', 'exit', 'learning', 'auditor'
]);

const CANNOT_COMMON = Object.freeze([
  'sign-transactions',
  'execute-financial-orders',
  'hold-custody',
  'receive-seed-or-private-key',
  'bypass-guardian',
  'bypass-risk-policy',
  'override-stop-or-pause',
  'authorize-execution'
]);

function spec(role, fields) {
  return { role, cannot: [...CANNOT_COMMON], live: false, ...fields };
}

/**
 * Deterministic per-role checks. Each receives a bounded proposal/context and
 * returns an observation: status + findings + advisory value. They never
 * produce permissions.
 */
const ROLE_CHECKS = {
  strategy: ({ proposal }) => {
    const hasEvidence = Array.isArray(proposal?.evidence) && proposal.evidence.length > 0;
    return { status: hasEvidence ? 'observed' : 'insufficient-evidence', findings: hasEvidence ? [] : ['PROPOSAL_HAS_NO_EVIDENCE'], advisory: { guaranteed: false } };
  },
  execution: ({ proposal, context }) => {
    const route = Array.isArray(proposal?.route) ? proposal.route : [];
    return {
      status: route.length ? 'routable' : 'no-route',
      findings: route.length ? [] : ['NO_ROUTE_STEPS'],
      advisory: { planOnly: true, signedByExecution: false, simulatorConnected: typeof context?.simulator === 'function' }
    };
  },
  risk: ({ context }) => {
    const riskPct = bounded(context?.riskPct);
    const maxRiskPct = bounded(context?.maxRiskPct);
    if (riskPct === null || maxRiskPct === null) return { status: 'insufficient-evidence', findings: ['RISK_LIMITS_UNKNOWN'], advisory: { block: false } };
    const within = riskPct <= maxRiskPct;
    return { status: within ? 'within-policy' : 'above-policy', findings: within ? [] : ['RISK_ABOVE_POLICY'], advisory: { within, block: !within } };
  },
  guardian: ({ context }) => ({
    status: 'independent',
    findings: [],
    advisory: { independentStop: true, nonDisableable: true, canHaltAnything: true, replacesNothing: false }
  }),
  research: ({ context }) => {
    const sources = Array.isArray(context?.evidence) ? context.evidence.length : 0;
    return { status: sources ? 'observed' : 'insufficient-evidence', findings: sources ? [] : ['NO_RESEARCH_EVIDENCE'], advisory: { sourceCount: sources, guaranteed: false } };
  },
  market: ({ context }) => {
    const regime = safeString(String(context?.regime || ''), 32);
    return { status: regime ? regime : 'unavailable', findings: regime ? [] : ['REGIME_EVIDENCE_MISSING'], advisory: { regime, changesStrategyByItself: false } };
  },
  liquidity: ({ context }) => {
    const liquidityUsd = finite(context?.liquidityUsd);
    const amountUsd = finite(context?.amountUsd);
    if (liquidityUsd === null || amountUsd === null) return { status: 'insufficient-evidence', findings: ['LIQUIDITY_OR_AMOUNT_UNKNOWN'], advisory: { sufficient: null } };
    const sufficient = liquidityUsd >= amountUsd * 2;
    return { status: sufficient ? 'sufficient' : 'insufficient', findings: sufficient ? [] : ['LIQUIDITY_BUFFER_TOO_LOW'], advisory: { sufficient, liquidityUsd, amountUsd } };
  },
  bridge: ({ context }) => {
    const hasQuote = context?.bridgeQuote != null;
    const executable = context?.bridgeExecutable === true;
    return {
      status: hasQuote ? (executable ? 'executable' : 'quote-only') : 'unavailable',
      findings: hasQuote ? (executable ? [] : ['BRIDGE_QUOTE_IS_NOT_EXECUTION']) : ['NO_BRIDGE_QUOTE'],
      advisory: { quoteOnly: !executable }
    };
  },
  fee: ({ context }) => {
    const feeUsd = finite(context?.feeUsd);
    return { status: feeUsd === null ? 'unavailable' : 'observed', findings: feeUsd === null ? ['FEE_UNEVIDENCED'] : [], advisory: { feeUsd, zeroRiskWithUnknownFee: false } };
  },
  gas: ({ context }) => {
    const gasUsd = finite(context?.gasUsd);
    return { status: gasUsd === null ? 'unavailable' : 'observed', findings: gasUsd === null ? ['GAS_UNEVIDENCED'] : [], advisory: { gasUsd, estimateNotPromise: true } };
  },
  portfolio: ({ context }) => {
    const attested = context?.balanceAttested === true;
    return { status: attested ? 'attested' : 'unattested', findings: attested ? [] : ['BALANCE_NOT_ATTESTED'], advisory: { progressComputable: attested } };
  },
  hedge: ({ context }) => {
    const hedgeEnabled = context?.hedgeEnabled === true;
    return { status: hedgeEnabled ? 'configured' : 'not-configured', findings: hedgeEnabled ? [] : ['NO_HEDGE_CONFIGURED'], advisory: { reducesButDoesNotRemoveRisk: true } };
  },
  exit: ({ context }) => {
    const exitPolicy = context?.exitPolicy != null;
    return { status: exitPolicy ? 'configured' : 'missing', findings: exitPolicy ? [] : ['NO_EXIT_POLICY'], advisory: { guaranteesFillPrice: false } };
  },
  learning: ({ context }) => {
    const optedIn = context?.learningOptIn === true;
    return { status: optedIn ? 'opted-in' : 'opt-out', findings: [], advisory: { storesPrivateChatText: false, weakensGuardian: false } };
  },
  auditor: ({ context }) => {
    const timeline = Array.isArray(context?.timeline) ? context.timeline.length : 0;
    return { status: timeline ? 'traceable' : 'untraceable', findings: timeline ? [] : ['NO_AUDIT_TIMELINE'], advisory: { independentOfCouncil: true } };
  }
};

export const SPECIALIST_SPECS = Object.freeze({
  strategy: spec('strategy', { specItem: 6, engine: 'internal-real', title: 'Strategy', inputs: ['intent', 'evidence', 'policy'], outputs: ['bounded-proposals', 'comparison', 'simulation-request'] }),
  execution: spec('execution', { specItem: 7, engine: 'internal-real', title: 'Execution Orchestrator', inputs: ['proposal', 'limits', 'authorization'], outputs: ['execution-plan', 'draft-orders', 'monitor-hooks'] }),
  risk: spec('risk', { specItem: 8, title: 'Risk', inputs: ['proposal', 'riskPolicy'], outputs: ['risk-label', 'block-or-pass-advisory'] }),
  guardian: spec('guardian', { specItem: 9, title: 'Guardian', inputs: ['proposal', 'controls', 'evidence'], outputs: ['independent-review', 'stop-decision'], independentStop: true }),
  research: spec('research', { specItem: 10, title: 'Research', inputs: ['question', 'sources'], outputs: ['evidence-rows', 'confidence'] }),
  market: spec('market', { specItem: 11, title: 'Market', inputs: ['regime-evidence', 'signals'], outputs: ['regime-label', 'availability'] }),
  liquidity: spec('liquidity', { specItem: 12, title: 'Liquidity', inputs: ['venue-data', 'amountUsd'], outputs: ['sufficiency', 'depth-advisory'] }),
  bridge: spec('bridge', { specItem: 13, title: 'Bridge', inputs: ['bridgeQuote', 'route'], outputs: ['quote-status', 'executability'] }),
  fee: spec('fee', { specItem: 14, title: 'Fee', inputs: ['feeSheet', 'costEvidence'], outputs: ['fee-breakdown', 'unavailable-list'] }),
  gas: spec('gas', { specItem: 15, title: 'Gas', inputs: ['gasEvidence'], outputs: ['gas-estimate', 'uncertainty'] }),
  portfolio: spec('portfolio', { specItem: 16, title: 'Portfolio', inputs: ['attested-balances'], outputs: ['progress-input', 'exposure-label'] }),
  hedge: spec('hedge', { specItem: 17, title: 'Hedge', inputs: ['hedgeConfig'], outputs: ['hedge-status', 'residual-risk-label'] }),
  exit: spec('exit', { specItem: 18, title: 'Exit', inputs: ['exitPolicy', 'position'], outputs: ['exit-plan', 'no-fill-guarantee'] }),
  learning: spec('learning', { specItem: 19, title: 'Learning', inputs: ['session-events', 'optIn'], outputs: ['structured-lessons', 'no-chat-text'] }),
  auditor: spec('auditor', { specItem: 20, title: 'Auditor', inputs: ['timeline', 'receipts'], outputs: ['traceability', 'independent-findings'] })
});

/**
 * Run one specialist's bounded check. Output is an observation with explicit
 * canExecute=false. Unknown inputs produce insufficient-evidence, never a
 * guessed green.
 */
export function runSpecialist(role, { proposal = null, context = {} } = {}) {
  if (!SPECIALIST_ROLES.includes(role)) return fail('UNKNOWN_SPECIALIST_ROLE', String(role));
  if (containsRawSecret({ proposal, context })) return fail('RAW_CREDENTIAL_FORBIDDEN');
  const check = ROLE_CHECKS[role]({ proposal, context });
  const s = SPECIALIST_SPECS[role];
  return noExecutionPermission({
    ok: true,
    schema: SPECIALIST_AGENTS_SCHEMA,
    role,
    specItem: s.specItem,
    engine: s.engine,
    live: s.live,
    status: check.status,
    findings: check.findings,
    advisory: check.advisory,
    cannot: [...s.cannot],
    canExecute: false,
    signsTransactions: false,
    executesOrders: false,
    guardianStopRespected: true,
    evaluatedAt: Date.now()
  });
}

/**
 * Spec 65 item 21 — for important trades the council must include at least
 * research, strategy, risk, liquidity and guardian. A council without them is
 * incomplete and cannot even reach the authorization screen recommendation.
 */
export const IMPORTANT_TRADE_MIN_ROLES = Object.freeze(['research', 'strategy', 'risk', 'liquidity', 'guardian']);

export function assertCouncilQuorum(roles = []) {
  const present = new Set((Array.isArray(roles) ? roles : []).filter((role) => SPECIALIST_ROLES.includes(role)));
  const missing = IMPORTANT_TRADE_MIN_ROLES.filter((role) => !present.has(role));
  return {
    ok: missing.length === 0,
    schema: SPECIALIST_AGENTS_SCHEMA,
    present: [...present],
    missing,
    quorumForImportantTrade: missing.length === 0,
    councilExecutes: false,
    guardianRequiredRole: true
  };
}

/**
 * Spec 65 item 22 — votes are only "permission to approach the authorization
 * screen". APPROVE/REJECT/REVISE thresholds come from policy; Guardian ❌ is
 * always REJECT regardless of the tally.
 */
export function tallyVotes(votes = [], { approveThreshold = 0.6, rejectThreshold = 0.34, guardianVeto = true } = {}) {
  const rows = (Array.isArray(votes) ? votes : []).filter((row) => row && typeof row === 'object' && ['APPROVE', 'REJECT', 'REVISE'].includes(row.decision));
  if (!rows.length) return { ok: false, schema: SPECIALIST_AGENTS_SCHEMA, code: 'NO_VOTES', canProceedToAuthorizationScreen: false };
  const total = rows.length;
  const counts = {
    approve: rows.filter((row) => row.decision === 'APPROVE').length,
    reject: rows.filter((row) => row.decision === 'REJECT').length,
    revise: rows.filter((row) => row.decision === 'REVISE').length
  };
  const guardianRejected = guardianVeto && rows.some((row) => row.role === 'guardian' && row.decision === 'REJECT');
  const decision = guardianRejected || (counts.reject / total) >= rejectThreshold
    ? 'REJECT'
    : (counts.approve / total) >= approveThreshold
      ? 'APPROVE'
      : 'REVISE';
  return noExecutionPermission({
    ok: true,
    schema: SPECIALIST_AGENTS_SCHEMA,
    decision,
    counts,
    total,
    thresholds: { approveThreshold, rejectThreshold, guardianVeto },
    guardianVetoApplied: guardianRejected,
    canProceedToAuthorizationScreen: decision === 'APPROVE',
    proceedsTo: decision === 'APPROVE' ? 'authorization-screen-review' : 'none',
    executesNothing: true,
    talliedAt: Date.now()
  });
}
