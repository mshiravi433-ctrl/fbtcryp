/**
 * Public Intent/Solver protocol discovery.
 *
 * This module does not accept money or executable calldata. The API publishes
 * capabilities, validates the outer envelope, and accepts only authenticated
 * Ed25519 quote commitments from a configured public-key registry. Commitments
 * enter an immutable transparency log; they are not settlement instructions,
 * bonded guarantees, or permission for autonomous execution.
 */

const CHAINS = [1, 10, 56, 137, 146, 8453, 42161, 43114, 59144];
const KINDS = new Set(['swap', 'outcome', 'automation', 'workflow']);
const PRIVACY = new Set(['standard', 'relay', 'confidential']);

export const INTENT_CAPABILITIES = Object.freeze({
  protocol: 'fbt-intent/1.0',
  schema: 'fbt.intent.v1',
  proofSchema: 'fbt.execution-proof.v1',
  commitmentSchema: 'fbt.solver-quote.v1',
  generatedBy: 'FBT Intent OS',
  operatingMode: 'validation-discovery-and-signed-commitments',
  custody: false,
  chains: CHAINS,
  endpoints: {
    capabilities: '/api/intents/v1/capabilities',
    validate: '/api/intents/v1/validate',
    solvers: '/api/intents/v1/solvers',
    commitments: '/api/intents/v1/commitments',
    log: '/api/intents/v1/log/{intentHash}',
    bids: null
  },
  stages: ['intent', 'risk', 'solver-market', 'simulation', 'execution', 'verification'],
  adapters: [
    {
      id: 'fbt-evm-aggregator',
      status: 'live',
      kinds: ['swap'],
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
    externalRootAnchor: false,
    auctionCompletenessProof: false,
    executionFromCommitments: false,
    bondedSettlement: false
  },
  unavailable: {
    confidentialIntents: true,
    atomicComposableWorkflows: true,
    cexOtcInventoryBids: true,
    autonomousAiSpending: true
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
    if (!Array.isArray(body.steps) || body.steps.length < 2 || body.steps.length > 8) {
      return { ok: false, code: 'BAD_WORKFLOW' };
    }
    return { ok: true, executable: false, status: 'draft-only', code: 'ATOMIC_WORKFLOW_UNAVAILABLE' };
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
