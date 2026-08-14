/**
 * Public Intent/Solver protocol discovery.
 *
 * This module does not accept money or executable calldata. The API publishes
 * capabilities, validates the outer envelope, and accepts only authenticated
 * Ed25519 quote commitments from a configured public-key registry. Commitments
 * enter an immutable transparency log; they are not settlement instructions,
 * bonded guarantees, or permission for autonomous execution.
 */

import {
  isSingleChainWorkflow,
  validateWorkflow,
  workflowFromLegacySteps
} from './intentWorkflow.js';

const CHAINS = [1, 10, 56, 137, 146, 8453, 42161, 43114, 59144];
const KINDS = new Set(['swap', 'outcome', 'automation', 'workflow']);
const PRIVACY = new Set(['standard', 'relay', 'confidential']);

export const INTENT_CAPABILITIES = Object.freeze({
  protocol: 'fbt-intent/1.0',
  schema: 'fbt.intent.v1',
  proofSchema: 'fbt.execution-proof.v1',
  commitmentSchema: 'fbt.solver-quote.v1',
  generatedBy: 'FBT Intent OS',
  operatingMode: 'validation-signed-commitments-and-coordinator-signed-auction-close',
  custody: false,
  chains: CHAINS,
  endpoints: {
    capabilities: '/api/intents/v1/capabilities',
    validate: '/api/intents/v1/validate',
    solvers: '/api/intents/v1/solvers',
    commitments: '/api/intents/v1/commitments',
    log: '/api/intents/v1/log/{intentHash}',
    coordinator: '/api/intents/v1/coordinator',
    auction: '/api/intents/v1/auctions/{intentHash}',
    closeAuction: '/api/intents/v1/auctions/{intentHash}/close',
    anchorNetworks: '/api/intents/v1/anchor-networks',
    anchorCalldata: '/api/intents/v1/auctions/{intentHash}/anchor-calldata/{chainId}',
    submitAnchor: '/api/intents/v1/auctions/{intentHash}/anchor',
    admissionReceipt: '/api/intents/v1/admissions/{intentHash}/{entryHash}',
    watcherReports: '/api/intents/v1/auctions/{intentHash}/watcher-reports',
    bonds: '/api/intents/v1/bonds',
    executionClaim: '/api/intents/v1/auctions/{intentHash}/execution-claim',
    submitExecutionClaim: '/api/intents/v1/auctions/{intentHash}/execution-claims',
    disputes: '/api/intents/v1/auctions/{intentHash}/disputes',
    adjudication: '/api/intents/v1/auctions/{intentHash}/adjudication',
    adjudicate: '/api/intents/v1/auctions/{intentHash}/adjudicate',
    settlementReports: '/api/intents/v1/auctions/{intentHash}/settlement-reports',
    bids: null
  },
  stages: ['intent', 'risk', 'solver-market', 'simulation', 'execution', 'settlement', 'verification'],
  adapters: [
    {
      id: 'fbt-evm-aggregator',
      status: 'live',
      kinds: ['swap', 'workflow'],
      settlement: 'user-signed-onchain',
      quoteCommitments: false
    },
    {
      id: 'fbt-order-watcher',
      status: 'live',
      kinds: ['automation'],
      settlement: 'notification-then-user-signature',
      quoteCommitments: false
    },
    {
      id: 'fbt-single-chain-workflow',
      status: 'live',
      kinds: ['workflow'],
      settlement: 'user-signed-batch',
      quoteCommitments: false
    },
    {
      id: 'fbt-cross-chain-adapter',
      status: 'partial',
      kinds: ['workflow'],
      settlement: 'separate-user-signed-bridge',
      quoteCommitments: false
    }
  ],
  protocolSecurity: {
    solverSignatures: 'Ed25519',
    immutableCommitmentEntries: true,
    merkleLogRoots: true,
    signedAuctionCloseReceipts: true,
    deterministicSelectionPolicy: 'MAX_OUTPUT_WITHIN_SIGNED_LIMITS_V1',
    optionalVerifiedEvmAnchors: true,
    externalRootAnchorByDefault: false,
    /* A close receipt still never claims completeness at signing time; the
       claim only ever exists per auction, as verified watcher evidence. */
    auctionCompletenessProof: false,
    crossInstanceTransactionalClose: false,
    signedAdmissionReceipts: 'fbt.admission-receipt.v1',
    transactionalAdmission: 'receipt-iff-logged-entry',
    completenessWatcherReports: 'fbt.completeness-report.v1',
    omissionAccountability: 'signed-receipt-before-seal-vs-signed-close',
    admissionReceiptReclaim: true,
    watcherReportsServerRecomputed: true,
    executionFromCommitments: false,
    bondedSettlement: false,
    solverBonds: 'fbt.solver-bond.v1',
    executionClaims: 'fbt.execution-claim.v1',
    failureDisputes: 'fbt.dispute.v1',
    outcomeAdjudication: 'fbt.adjudication.v1',
    settlementReports: 'fbt.settlement-report.v1',
    settlementReportsServerRecomputed: true,
    adjudicationCrossCheck: true,
    deterministicPenaltyGrading: true,
    bondPenaltyEnforcement: 'out-of-protocol',
    onChainBondCustody: false,
    onChainTxVerification: false,
    singleChainWorkflows: 'fbt.workflow.v1',
    workflowBatchVerifiesOutputs: false,
    workflowLiveRouterCalldata: false
  },
  unavailable: {
    confidentialIntents: true,
    atomicCrossChainWorkflows: true,
    cexOtcInventoryBids: true,
    autonomousAiSpending: true,
    onChainBondEscrow: true,
    automaticPenaltyCollection: true
  },
  privacy: {
    modes: ['standard'],
    note: 'Private RPC recommendations are not represented as confidential intents or attested private settlement.'
  }
});

const symbol = (value) => /^[A-Za-z0-9.$₮_-]{1,16}$/.test(String(value || ''));

/** Strict outer-envelope validation; execution adapters validate tokens again. */
export function validateIntentEnvelope(body, now = Date.now()) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, code: 'BAD_BODY' };
  if (body.schema !== 'fbt.intent.v1') return { ok: false, code: 'BAD_SCHEMA' };
  if (!KINDS.has(body.kind)) return { ok: false, code: 'BAD_KIND' };
  if (!CHAINS.includes(Number(body.chainId))) return { ok: false, code: 'BAD_CHAIN' };
  if (!symbol(body.fromSymbol) || !symbol(body.toSymbol) || body.fromSymbol === body.toSymbol) {
    return { ok: false, code: 'BAD_TOKENS' };
  }

  const amount = Number(body.amountIn);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, code: 'BAD_AMOUNT' };

  const deadline = Number(body.deadlineAt);
  if (!Number.isFinite(deadline) || deadline <= now || deadline > now + 30 * 86400000) {
    return { ok: false, code: 'BAD_DEADLINE' };
  }

  const constraints = body.constraints;
  if (!constraints || constraints.custodyAllowed !== false || constraints.requireUserSignature !== true) {
    return { ok: false, code: 'UNSAFE_AUTHORITY' };
  }
  if (!PRIVACY.has(constraints.privacy)) return { ok: false, code: 'BAD_PRIVACY' };
  if (constraints.privacy !== 'standard') return { ok: false, code: 'PRIVACY_UNAVAILABLE' };

  const slip = Number(constraints.maxSlippagePct);
  if (!Number.isFinite(slip) || slip < 0.05 || slip > 5) return { ok: false, code: 'BAD_SLIPPAGE' };

  if (body.kind === 'automation') {
    const condition = body.condition;
    const validType = ['priceAbove', 'priceBelow', 'daily', 'weekly', 'monthly'].includes(condition?.type);
    const needsValue = condition?.type === 'priceAbove' || condition?.type === 'priceBelow';
    if (!validType || (needsValue && !(Number(condition.value) > 0))) {
      return { ok: false, code: 'BAD_CONDITION' };
    }
  }

  if (body.kind === 'workflow') {
    const deadlineSeconds = Math.floor(deadline / 1000);
    const source = body.workflow && typeof body.workflow === 'object' && !Array.isArray(body.workflow)
      ? body.workflow
      : workflowFromLegacySteps(body.steps, { chainId: body.chainId, deadline: deadlineSeconds });
    const checked = validateWorkflow(source);
    if (!checked.ok) return { ok: false, code: checked.code || 'BAD_WORKFLOW', executable: false };
    const single = isSingleChainWorkflow(checked.workflow);
    return {
      ok: true,
      executable: false,
      status: single ? 'ready-for-review' : 'draft-only',
      code: single ? 'VALID' : 'ATOMIC_CROSS_CHAIN_UNAVAILABLE',
      singleChainAtomic: single,
      workflow: checked.workflow
    };
  }
  if (body.kind === 'outcome') {
    return { ok: true, executable: false, status: 'draft-only', code: 'OUTCOME_MARKET_UNAVAILABLE' };
  }

  return {
    ok: true,
    executable: body.kind === 'swap',
    status: body.kind === 'swap' ? 'ready-for-client-review' : 'manual-signature-required',
    code: 'VALID'
  };
}
