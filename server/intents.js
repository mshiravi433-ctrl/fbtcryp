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
const PARTIAL_FILL_POLICIES = new Set(['full-only', 'partial-allowed']);

const positiveIntegerString = (value, maxLength = 78) =>
  typeof value === 'string'
  && new RegExp(`^[0-9]{1,${maxLength}}$`).test(value)
  && BigInt(value) > 0n;

/** Strict bounded validation of the outcome sub-object (Outcome Marketplace). */
function validateOutcomeSpec(body, now) {
  const outcome = body.outcome;
  if (!outcome || typeof outcome !== 'object' || Array.isArray(outcome)) {
    return { ok: false, code: 'BAD_OUTCOME' };
  }
  if (Object.keys(outcome).some((key) => !['guaranteedMinimum', 'totalMaxCost', 'expiry', 'settlementChainId', 'partialFillPolicy'].includes(key))) {
    return { ok: false, code: 'BAD_OUTCOME' };
  }
  if (!positiveIntegerString(outcome.guaranteedMinimum)) return { ok: false, code: 'BAD_OUTCOME' };
  if (!positiveIntegerString(outcome.totalMaxCost)) return { ok: false, code: 'BAD_OUTCOME' };
  if (!PARTIAL_FILL_POLICIES.has(outcome.partialFillPolicy)) return { ok: false, code: 'BAD_OUTCOME' };
  if (!Number.isInteger(outcome.settlementChainId) || !CHAINS.includes(outcome.settlementChainId)) {
    return { ok: false, code: 'BAD_OUTCOME' };
  }
  const expiry = Number(outcome.expiry);
  const nowSeconds = Math.floor(now / 1000);
  if (!Number.isSafeInteger(expiry) || expiry <= nowSeconds || expiry > nowSeconds + 30 * 86400) {
    return { ok: false, code: 'BAD_OUTCOME' };
  }
  return {
    ok: true,
    value: {
      guaranteedMinimum: outcome.guaranteedMinimum,
      totalMaxCost: outcome.totalMaxCost,
      expiry,
      settlementChainId: outcome.settlementChainId,
      partialFillPolicy: outcome.partialFillPolicy
    }
  };
}

export const INTENT_CAPABILITIES = Object.freeze({
  protocol: 'fbt-intent/1.0',
  schema: 'fbt.intent.v1',
  proofSchema: 'fbt.execution-proof.v1',
  commitmentSchema: 'fbt.solver-quote.v1',
  outcomeBidSchema: 'fbt.outcome-bid.v1',
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
    crossChainStates: '/api/intents/v1/cross-chain/states',
    crossChainState: '/api/intents/v1/cross-chain/states/{stateId}',
    crossChainReceipts: '/api/intents/v1/cross-chain/states/{stateId}/receipts',
    crossChainAccountBindings: '/api/intents/v1/cross-chain/states/{stateId}/account-bindings',
    crossChainVerificationReports: '/api/intents/v1/cross-chain/states/{stateId}/verification-reports',
    operators: '/api/intents/v1/operators',
    merkleAnchorNetworks: '/api/intents/v1/merkle-anchor-networks',
    merkleRootAnchorCalldata: '/api/intents/v1/log/{intentHash}/root-anchor-calldata/{chainId}',
    submitMerkleRootAnchor: '/api/intents/v1/log/{intentHash}/root-anchor',
    /* Outcome Marketplace (Phase 5) — authenticated signed outcome bids and
       their own auction lifecycle. The PUBLIC bid path stays closed. */
    outcomeBids: '/api/intents/v1/outcome/bids',
    outcomeAuction: '/api/intents/v1/outcome/auctions/{intentHash}',
    outcomeClose: '/api/intents/v1/outcome/auctions/{intentHash}/close',
    outcomeAdmissions: '/api/intents/v1/outcome/admissions/{intentHash}/{entryHash}',
    outcomeWatcherReports: '/api/intents/v1/outcome/auctions/{intentHash}/watcher-reports',
    /* Phase 5 — confidential intent transport. */
    intentCommitments: '/api/intents/v1/confidential/commit',
    intentReveals: '/api/intents/v1/confidential/reveal',
    operatorKeys: '/api/intents/v1/confidential/operators',
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
      id: 'fbt-cross-chain-state',
      status: 'live-evidence-only',
      kinds: ['workflow'],
      settlement: 'sequential-user-signed-transfers',
      quoteCommitments: false,
      atomic: false,
      custody: false,
      automaticSettlement: false,
      note: 'Phase 4b stores verifiable source/destination/refund signatures. The intent envelope remains draft-only with ATOMIC_CROSS_CHAIN_UNAVAILABLE.'
    },
    {
      id: 'fbt-outcome-market',
      status: 'live',
      kinds: ['outcome'],
      settlement: 'user-signed-bonded-outcome',
      quoteCommitments: false,
      note: 'Single-chain outcomes are reviewable; the user signs settlement. Cross-chain outcomes stay draft-only.'
    },
    {
      id: 'fbt-commit-reveal',
      status: 'live',
      kinds: ['swap'],
      settlement: 'user-signed-after-reveal',
      quoteCommitments: false,
      note: 'Commit-reveal hides the intent until bidding closes (Phase 5). Threshold/TEE claims stay blocked.'
    },
    {
      id: 'fbt-threshold-encryption',
      status: 'partial',
      kinds: ['swap'],
      settlement: 'user-signed-after-close-decrypt',
      quoteCommitments: false,
      note: 'Enabled only when INTENT_CONFIDENTIAL_OPERATOR_KEYS is configured with real operator keys.'
    }
  ],
  protocolSecurity: {
    solverSignatures: 'Ed25519',
    immutableCommitmentEntries: true,
    merkleLogRoots: true,
    signedAuctionCloseReceipts: true,
    deterministicSelectionPolicy: 'MAX_OUTPUT_WITHIN_SIGNED_LIMITS_V1',
    outcomeSelectionPolicy: 'MAX_GUARANTEED_MINIMUM_V1',
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
    workflowLiveRouterCalldata: false,
    crossChainState: 'fbt.cross-chain-state.v1',
    crossChainLegReceipts: 'fbt.cross-chain-leg-receipt.v1',
    crossChainSequentialUserSignatures: true,
    crossChainAtomicity: false,
    crossChainCustody: false,
    /* Phase 4c: per-leg multi-RPC verification is a derived layer. It can
       prove one transaction was mined with exact facts; it cannot make two
       transactions atomic and it never grants custody or settlement power. */
    crossChainAccountBindings: 'fbt.cross-chain-account-binding.v1',
    crossChainTxVerification: 'fbt.cross-chain-tx-verification.v1',
    crossChainVerifiedLegsRemainNonAtomic: true,
    crossChainWalletSignatureVerification: false,
    crossChainRpcProviderIndependenceProven: false,
    independentOperatorAttestations: 'fbt.operator-attestation.v1',
    operatorKeyControlCryptographicallyBound: true,
    organizationalIndependenceProvenByRegistry: false,
    coordinatorKeyRotation: 'fbt.coordinator-key-rotation.v1',
    coordinatorRotationDualSigned: true,
    historicalCoordinatorReceiptsUseEmbeddedKeys: true,
    optionalMerkleRootAnchors: 'fbt.merkle-root-manifest.v1',
    merkleRootAnchoredByDefault: false,
    /* Outcome Marketplace specifics (honesty pinned). */
    outcomeAdmissionReceipts: 'fbt.outcome-admission-receipt.v1',
    outcomeCompletenessReports: 'fbt.outcome-completeness-report.v1',
    outcomeBondedOnlyAdmission: true,
    outcomeAutomaticSettlement: false,
    outcomeCustody: false
  },
  standards: {
    canonicalization: 'recursive-lexicographic-json-v1',
    signatures: 'Ed25519-strict-base64url',
    crossChainStateSchema: 'fbt.cross-chain-state.v1',
    crossChainReceiptSchema: 'fbt.cross-chain-leg-receipt.v1',
    crossChainAccountBindingSchema: 'fbt.cross-chain-account-binding.v1',
    crossChainTxVerificationSchema: 'fbt.cross-chain-tx-verification.v1',
    operatorAttestationSchema: 'fbt.operator-attestation.v1',
    coordinatorRotationSchema: 'fbt.coordinator-key-rotation.v1',
    coordinatorKeyringSchema: 'fbt.coordinator-keyring.v1',
    merkleRootManifestSchema: 'fbt.merkle-root-manifest.v1',
    merkleRootAnchorClaimSchema: 'fbt.merkle-root-anchor-claim.v1'
  },
  unavailable: {
    atomicCrossChainWorkflows: true,
    cexOtcInventoryBids: true,
    autonomousAiSpending: true,
    onChainBondEscrow: true,
    automaticPenaltyCollection: true,
    /* Phase 5: commit-reveal covers single-chain confidential swaps, but
       threshold-encrypted confidential compute and TEE attestation are NOT
       claimed. teeConfidentialCompute is always false here. */
    thresholdEncryptedIntents: true,
    teeConfidentialCompute: true,
    atomicCrossChainOutcomes: true
  },
  privacy: {
    modes: ['standard', 'confidential'],
    note: 'confidential (single-chain) means the commit-reveal transport hides intent details until bidding closes. Private RPC recommendations are not represented as confidential intents, and no TEE attestation is claimed.'
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
    const spec = validateOutcomeSpec(body, now);
    if (!spec.ok) return { ok: false, code: spec.code, executable: false };
    /* Outcome Marketplace (Phase 5): a SINGLE-CHAIN outcome (funding chain
       equals settlement chain) is reviewable by the user and settled with the
       user's own signature. FBT never settles automatically and never holds
       funds. A CROSS-CHAIN outcome (settlement on another chain) stays
       draft-only — there is no atomic cross-chain outcome adapter. */
    const singleChain = Number(body.chainId) === spec.value.settlementChainId;
    return {
      ok: true,
      executable: false,
      status: singleChain ? 'ready-for-review' : 'draft-only',
      code: singleChain ? 'VALID' : 'OUTCOME_CROSS_CHAIN_UNAVAILABLE',
      singleChainAtomic: singleChain,
      outcome: spec.value
    };
  }

  return {
    ok: true,
    executable: body.kind === 'swap',
    status: body.kind === 'swap' ? 'ready-for-client-review' : 'manual-signature-required',
    code: 'VALID'
  };
}
