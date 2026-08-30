/**
 * FBT INTENT OS — deterministic intent compiler and local preference memory.
 * ---------------------------------------------------------------------------
 * This is deliberately NOT an AI agent with spending authority. The compiler
 * accepts a small, explicit schema, validates every money-relevant field, and
 * returns either a reviewable hand-off or a blocked/draft-only plan. Natural
 * language may be stored as a note, but it is never the source of truth for an
 * execution.
 *
 * The current product can execute a same-chain swap, prepare a bridge, create
 * locally watched orders, and compile a same-chain workflow into a
 * user-signed review (planned batch envelope — outputs are not verified
 * on-chain). It cannot yet guarantee an outcome across CEX/OTC/inventory
 * solvers, atomically execute a CROSS-CHAIN workflow, or hide a full intent
 * from every participant. Those capabilities are described as unavailable
 * rather than simulated with invented quotes.
 */

export const INTENT_SCHEMA = 'fbt.intent.v1';
export const INTENT_KINDS = ['swap', 'outcome', 'automation', 'workflow'];
export const PRIVACY_MODES = ['standard', 'relay', 'confidential'];
export const WORKFLOW_ACTIONS = ['swap', 'bridge', 'deposit', 'borrow', 'send', 'approve'];
export const WORKFLOW_REVERT_POLICIES = ['abort-all', 'continue', 'skip-remaining'];

const MEMORY_KEY = 'fbt-intent-memory-v1';
const INTENTS_KEY = 'fbt-intents-v1';
const MAX_RECORDS = 40;

const SUPPORTED_CHAINS = new Set([1, 10, 56, 137, 146, 8453, 42161, 43114, 59144]);
const STABLES = new Set(['USDT', 'USDC', 'DAI', 'BUSD', 'FDUSD', 'TUSD', 'USDP', 'USDD', 'USD₮0']);

export const DEFAULT_INTENT_MEMORY = Object.freeze({
  preferredChainId: 42161,
  maxSlippagePct: 0.5,
  privateAboveUsd: 10000,
  maxPerIntentUsd: 5000,
  quietHoursEnabled: false,
  quietStart: 23,
  quietEnd: 7,
  requireExecutionProof: true
});

/**
 * Public capability manifest. It is also mirrored by
 * GET /api/intents/v1/capabilities so a DEX or market maker can discover the
 * protocol without scraping the UI.
 */
export const SOLVER_CAPABILITIES = Object.freeze([
  {
    id: 'fbt-evm-aggregator',
    role: 'solver',
    modes: ['swap', 'workflow'],
    settlement: 'user-signed-onchain',
    custody: false,
    live: true,
    detail: 'Parallel executable quotes; winner is selected under explicit fee and slippage constraints.'
  },
  {
    id: 'fbt-order-watcher',
    role: 'watcher',
    modes: ['automation'],
    settlement: 'notification-then-user-signature',
    custody: false,
    live: true,
    detail: 'Conditions are watched, but the user still reviews and signs every real transaction.'
  },
  {
    id: 'fbt-single-chain-workflow',
    role: 'solver',
    modes: ['workflow'],
    settlement: 'user-signed-batch',
    custody: false,
    live: true,
    detail: 'Same-chain planned batch: the user signs one review. Outputs are not verified on-chain and the batcher never holds funds.'
  },
  {
    id: 'fbt-cross-chain-adapter',
    role: 'solver',
    modes: ['workflow'],
    settlement: 'user-signed-bridge-handoff',
    custody: false,
    live: true,
    detail: 'A bridge can be prepared as a separate signed action; a cross-chain atomic workflow is not available.'
  },
  {
    id: 'external-outcome-market',
    role: 'solver-network',
    modes: ['outcome', 'workflow'],
    settlement: 'user-signed-bonded-outcome',
    custody: false,
    live: true,
    detail: 'Single-chain outcomes are reviewable via signed bonded bids; the user signs settlement. Cross-chain outcomes stay draft-only.'
  },
  {
    id: 'confidential-intent-transport',
    role: 'privacy-transport',
    modes: ['swap'],
    settlement: 'none',
    custody: false,
    live: false,
    detail: 'Unavailable: requester authentication, durable private storage, close-bound reveal and frontend orchestration are not operational. Commit-reveal would not hide plaintext from FBT or provide metadata privacy, threshold encryption, TEE, or attestation.'
  }
]);

const clamp = (value, min, max, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

function safeRead(key, fallback) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || 'null');
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function safeWrite(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function cleanSymbol(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.$₮_-]/g, '')
    .slice(0, 16);
}

function cleanNote(value) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 500);
}

export function sanitizeIntentMemory(input = {}) {
  const chain = Number(input.preferredChainId);
  return {
    preferredChainId: SUPPORTED_CHAINS.has(chain) ? chain : DEFAULT_INTENT_MEMORY.preferredChainId,
    maxSlippagePct: clamp(input.maxSlippagePct, 0.05, 5, DEFAULT_INTENT_MEMORY.maxSlippagePct),
    privateAboveUsd: clamp(input.privateAboveUsd, 0, 10_000_000, DEFAULT_INTENT_MEMORY.privateAboveUsd),
    maxPerIntentUsd: clamp(input.maxPerIntentUsd, 1, 10_000_000, DEFAULT_INTENT_MEMORY.maxPerIntentUsd),
    quietHoursEnabled: Boolean(input.quietHoursEnabled),
    quietStart: Math.round(clamp(input.quietStart, 0, 23, DEFAULT_INTENT_MEMORY.quietStart)),
    quietEnd: Math.round(clamp(input.quietEnd, 0, 23, DEFAULT_INTENT_MEMORY.quietEnd)),
    requireExecutionProof: input.requireExecutionProof !== false
  };
}

export function loadIntentMemory() {
  return sanitizeIntentMemory(safeRead(MEMORY_KEY, DEFAULT_INTENT_MEMORY));
}

export function saveIntentMemory(input) {
  const memory = sanitizeIntentMemory(input);
  safeWrite(MEMORY_KEY, memory);
  return memory;
}

/** True inside the user's local quiet-hours interval, including overnight. */
export function isQuietTime(memory, now = new Date()) {
  const m = sanitizeIntentMemory(memory);
  if (!m.quietHoursEnabled || m.quietStart === m.quietEnd) return false;
  const hour = now.getHours();
  return m.quietStart < m.quietEnd
    ? hour >= m.quietStart && hour < m.quietEnd
    : hour >= m.quietStart || hour < m.quietEnd;
}

function makeId(prefix = 'in') {
  const random = globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 12)
    || Math.random().toString(36).slice(2, 14);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

/**
 * Validate and normalise the user's declared outcome. Error codes, never
 * English sentences, so the UI remains translatable.
 */
export function normalizeIntent(input = {}, memory = loadIntentMemory(), now = Date.now()) {
  const kind = INTENT_KINDS.includes(input.kind) ? input.kind : null;
  if (!kind) return { error: 'BAD_KIND' };

  const chainId = Number(input.chainId || memory.preferredChainId);
  if (!SUPPORTED_CHAINS.has(chainId)) return { error: 'BAD_CHAIN' };

  const fromSymbol = cleanSymbol(input.fromSymbol);
  const toSymbol = cleanSymbol(input.toSymbol);
  if (!fromSymbol || !toSymbol) return { error: 'BAD_TOKENS' };
  /*
   * SAME_TOKEN is a swap-shaped rule: USDT → USDT is a meaningless TRADE.
   * A workflow is not its envelope — the steps are the trade, and a lending
   * workflow legitimately moves one asset through approve → deposit (supply)
   * or deposit → borrow (borrow). Rejecting USDT → USDT there is what made
   * the Loan page hand-off die with the "input and output tokens must differ"
   * error before the user could review a single check. The envelope pair still
   * gates the /swap hand-off in compileIntent: a same-token workflow never
   * lands on the swap screen, because the swap screen can only review a pair.
   */
  if (fromSymbol === toSymbol && kind !== 'workflow') return { error: 'SAME_TOKEN' };

  const amountIn = Number(input.amountIn);
  if (!Number.isFinite(amountIn) || amountIn <= 0) return { error: 'BAD_AMOUNT' };

  const maxSlippagePct = clamp(input.maxSlippagePct, 0.05, 50, memory.maxSlippagePct);
  const privacy = PRIVACY_MODES.includes(input.privacy) ? input.privacy : 'standard';

  const amountUsdInput = Number(input.amountUsd);
  const declaredAmountUsd = Number.isFinite(amountUsdInput) && amountUsdInput > 0 ? amountUsdInput : null;
  /*
   * A number typed by the user is useful context, but it is not a price oracle
   * and must never AUTHORISE a spend-limit or privacy-threshold check. Only a
   * dollar-pegged input can be valued deterministically in this offline
   * compiler. Other assets stay unknown until the live execution screen can
   * price them from a sourced quote.
   */
  const amountUsd = STABLES.has(fromSymbol) ? amountIn : null;

  let deadlineAt = Number(input.deadlineAt);
  if (!Number.isFinite(deadlineAt) || deadlineAt <= now) {
    deadlineAt = now + 2 * 60 * 60 * 1000;
  }
  // A local draft may live for up to 30 days. Beyond that, quotes, policies
  // and even token contracts can change too much for the original plan to be
  // meaningfully reviewable.
  deadlineAt = Math.min(deadlineAt, now + 30 * 24 * 60 * 60 * 1000);

  const minReceiveInput = Number(input.minReceive);
  const minReceive = Number.isFinite(minReceiveInput) && minReceiveInput > 0 ? minReceiveInput : null;
  if (kind === 'outcome' && minReceive == null) return { error: 'BAD_OUTCOME' };

  let outcome = null;
  if (kind === 'outcome') {
    const spec = input.outcome;
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return { error: 'BAD_OUTCOME' };
    const guaranteedMinimum = String(spec.guaranteedMinimum || '').trim().slice(0, 40);
    const totalMaxCost = String(spec.totalMaxCost || '').trim().slice(0, 40);
    const settlementChainId = Number(spec.settlementChainId) || chainId;
    const partialFillPolicy = ['full-only', 'partial-allowed'].includes(spec.partialFillPolicy)
      ? spec.partialFillPolicy : 'full-only';
    const expiry = Number.isSafeInteger(Number(spec.expiry)) ? Number(spec.expiry) : Math.floor(deadlineAt / 1000);
    if (!/^[0-9]{1,40}$/.test(guaranteedMinimum) || BigInt(guaranteedMinimum) <= 0n) {
      return { error: 'BAD_OUTCOME' };
    }
    if (!/^[0-9]{1,40}$/.test(totalMaxCost) || BigInt(totalMaxCost) <= 0n) {
      return { error: 'BAD_OUTCOME' };
    }
    if (!SUPPORTED_CHAINS.has(settlementChainId)) return { error: 'BAD_OUTCOME' };
    outcome = { guaranteedMinimum, totalMaxCost, settlementChainId, partialFillPolicy, expiry };
  }

  let condition = null;
  if (kind === 'automation') {
    const type = ['priceAbove', 'priceBelow', 'daily', 'weekly', 'monthly'].includes(input.conditionType)
      ? input.conditionType : null;
    const value = Number(input.conditionValue);
    if (!type) return { error: 'BAD_CONDITION' };
    if ((type === 'priceAbove' || type === 'priceBelow') && (!Number.isFinite(value) || value <= 0)) {
      return { error: 'BAD_CONDITION' };
    }
    condition = {
      type,
      value: type === 'priceAbove' || type === 'priceBelow' ? value : null,
      requiresFreshPrice: type === 'priceAbove' || type === 'priceBelow'
    };
  }

  let steps = [];
  if (kind === 'workflow') {
    const deadlineSeconds = Math.floor(deadlineAt / 1000);
    steps = (Array.isArray(input.steps) ? input.steps : [])
      .slice(0, 8)
      .map((step, index) => ({
        id: String(step?.id || `step-${index + 1}`).slice(0, 32),
        action: WORKFLOW_ACTIONS.includes(step?.action) ? step.action : null,
        chainId: SUPPORTED_CHAINS.has(Number(step?.chainId)) ? Number(step.chainId) : chainId,
        asset: cleanSymbol(step?.asset || (index === 0 ? fromSymbol : toSymbol)),
        target: cleanNote(step?.target),
        precondition: cleanNote(step?.precondition),
        postcondition: cleanNote(step?.postcondition),
        minOutput: String(step?.minOutput || '').trim().slice(0, 40),
        maxInput: String(step?.maxInput || '').trim().slice(0, 40),
        deadline: Number.isSafeInteger(Number(step?.deadline)) ? Number(step.deadline) : deadlineSeconds,
        revertPolicy: WORKFLOW_REVERT_POLICIES.includes(step?.revertPolicy) ? step.revertPolicy : 'abort-all',
        allowedContracts: Array.isArray(step?.allowedContracts) ? step.allowedContracts.slice(0, 8) : []
      }));
    if (steps.length < 2 || steps.some((s) => !s.action)) return { error: 'BAD_WORKFLOW' };
  }

  return {
    intent: {
      schema: INTENT_SCHEMA,
      id: String(input.id || makeId()),
      kind,
      createdAt: Number(input.createdAt) || now,
      deadlineAt,
      chainId,
      fromSymbol,
      toSymbol,
      amountIn: String(input.amountIn),
      amountUsd,
      declaredAmountUsd,
      minReceive,
      note: cleanNote(input.note),
      constraints: {
        maxSlippagePct,
        privacy,
        requireExecutionProof: input.requireExecutionProof ?? memory.requireExecutionProof,
        requireUserSignature: true,
        custodyAllowed: false
      },
      condition,
      steps,
      outcome
    }
  };
}

function check(id, level, detail = null) {
  return { id, level, detail };
}

/** Same-chain atomic candidate: one chainId and no bridge action. */
export function isSingleChainWorkflowSteps(steps, envelopeChainId) {
  if (!Array.isArray(steps) || steps.length < 2) return false;
  if (steps.some((step) => step.action === 'bridge')) return false;
  const chain = Number(steps[0]?.chainId || envelopeChainId);
  return steps.every((step) => Number(step.chainId || envelopeChainId) === chain);
}

function solverRows(intent) {
  const singleChain = intent.kind === 'workflow' && isSingleChainWorkflowSteps(intent.steps, intent.chainId);
  return SOLVER_CAPABILITIES.map((solver) => {
    if (!solver.live) return { ...solver, status: 'unavailable' };
    if (!solver.modes.includes(intent.kind)) return { ...solver, status: 'ineligible' };

    if (intent.kind === 'workflow') {
      if (solver.id === 'fbt-single-chain-workflow' || solver.id === 'fbt-evm-aggregator') {
        return { ...solver, status: singleChain ? 'eligible' : 'ineligible' };
      }
      if (solver.id === 'fbt-cross-chain-adapter') {
        return { ...solver, status: singleChain ? 'ineligible' : 'partial' };
      }
      return { ...solver, status: 'partial' };
    }
    if (intent.kind === 'automation') {
      return { ...solver, status: 'manual-signature' };
    }
    return { ...solver, status: 'eligible' };
  });
}

/**
 * Compile an intent into explicit risk checks and candidate solver adapters.
 * This function never sends, signs, quotes or mutates balances.
 */
export function compileIntent(input, memoryInput = loadIntentMemory(), now = Date.now(), runtime = {}) {
  const memory = sanitizeIntentMemory(memoryInput);
  const normalized = normalizeIntent(input, memory, now);
  if (normalized.error) return { error: normalized.error, checks: [], solvers: [] };

  const { intent } = normalized;
  const checks = [
    check('SELF_CUSTODY', 'pass'),
    check('USER_SIGNATURE_REQUIRED', 'pass'),
    check('PROOF_REQUESTED', intent.constraints.requireExecutionProof ? 'pass' : 'warn')
  ];

  if (intent.constraints.maxSlippagePct > memory.maxSlippagePct) {
    checks.push(check('SLIPPAGE_ABOVE_MEMORY', 'block', {
      requested: intent.constraints.maxSlippagePct,
      maximum: memory.maxSlippagePct
    }));
  } else {
    checks.push(check('SLIPPAGE_WITHIN_MEMORY', 'pass', { maximum: memory.maxSlippagePct }));
  }

  if (intent.amountUsd == null) {
    checks.push(check('USD_VALUE_UNKNOWN', 'warn'));
  } else if (intent.amountUsd > memory.maxPerIntentUsd) {
    checks.push(check('OVER_SPEND_LIMIT', 'block', {
      amountUsd: intent.amountUsd,
      maximum: memory.maxPerIntentUsd
    }));
  } else {
    checks.push(check('SPEND_WITHIN_LIMIT', 'pass', { amountUsd: intent.amountUsd }));
  }

  if (isQuietTime(memory, new Date(now))) checks.push(check('QUIET_HOURS', 'block'));
  else checks.push(check('OUTSIDE_QUIET_HOURS', 'pass'));

  const memoryWantsPrivacy = intent.amountUsd != null
    && memory.privateAboveUsd > 0
    && intent.amountUsd >= memory.privateAboveUsd;
  const confidentialRequired = intent.constraints.privacy === 'confidential' || memoryWantsPrivacy;

  if (confidentialRequired) {
    /* Runtime capability is required in addition to intent shape. Missing or
       stale capability data blocks; it can never mean "probably supported". */
    if (intent.kind === 'swap' && runtime.confidentialAvailable === true) {
      checks.push(check('CONFIDENTIAL_COMMIT_REVEAL', 'pass'));
      checks.push(check('PRIVACY_NOT_THRESHOLD_TEE', 'warn'));
    } else if (intent.kind === 'swap') {
      checks.push(check('CONFIDENTIAL_TRANSPORT_UNAVAILABLE', 'block'));
      checks.push(check('PRIVACY_NOT_THRESHOLD_TEE', 'warn'));
    } else {
      checks.push(check('THRESHOLD_TEE_UNAVAILABLE', 'block'));
    }
  } else if (intent.constraints.privacy === 'relay') {
    /* An external wallet does not return proof of which broadcaster it used.
       Never relabel the ordinary Swap handoff as a verified private relay. */
    checks.push(check('PRIVATE_RELAY_NOT_ATTESTED', 'block'));
  } else {
    checks.push(check('STANDARD_BROADCAST_DISCLOSED', 'warn'));
  }

  if (intent.kind === 'outcome') {
    /* Outcome Marketplace (Phase 5): a SINGLE-CHAIN outcome (funding chain ===
       settlement chain) is reviewable by the user and settled with their own
       signature; a CROSS-CHAIN outcome stays draft-only. */
    const singleChain = intent.outcome
      && Number(intent.outcome.settlementChainId) === Number(intent.chainId);
    if (singleChain) {
      checks.push(check('OUTCOME_SINGLE_CHAIN_ATOMIC', 'pass'));
    } else {
      checks.push(check('OUTCOME_CROSS_CHAIN_UNAVAILABLE', 'block'));
    }
  }
  if (intent.kind === 'workflow') {
    const single = isSingleChainWorkflowSteps(intent.steps, intent.chainId);
    if (single) {
      checks.push(check('WORKFLOW_SINGLE_CHAIN_ATOMIC', 'pass', { steps: intent.steps.length }));
    } else {
      checks.push(check('ATOMIC_CROSS_CHAIN_UNAVAILABLE', 'block', { steps: intent.steps.length }));
    }
  }
  if (intent.kind === 'automation') {
    checks.push(check('AUTOMATION_REQUIRES_FINAL_SIGNATURE', 'warn'));
  }

  const blocked = checks.some((row) => row.level === 'block');
  let handoff = null;
  if (!blocked && intent.kind === 'swap') {
    const params = new URLSearchParams({
      from: intent.fromSymbol,
      to: intent.toSymbol,
      amount: intent.amountIn,
      chain: String(intent.chainId),
      intent: intent.id
    });
    if (confidentialRequired) params.set('privacy', 'confidential');
    handoff = `/swap?${params.toString()}`;
  } else if (!blocked && intent.kind === 'outcome') {
    const params = new URLSearchParams({
      from: intent.fromSymbol,
      to: intent.toSymbol,
      amount: intent.amountIn,
      chain: String(intent.chainId),
      intent: intent.id,
      outcome: '1'
    });
    handoff = `/swap?${params.toString()}`;
  } else if (!blocked && intent.kind === 'workflow') {
    /*
     * The swap screen can only review a swap PAIR. A lending workflow's
     * envelope is same-token by construction (approve USDT → deposit USDT,
     * deposit collateral → borrow USDT): handing that to /swap would prefill
     * USDT → USDT, a pair no router can quote — the user would land on a dead
     * quote screen after a successful compile. Same-token workflows stay
     * reviewable local drafts instead, which is what the result screen says.
     */
    if (intent.fromSymbol !== intent.toSymbol) {
      const params = new URLSearchParams({
        from: intent.fromSymbol,
        to: intent.toSymbol,
        amount: intent.amountIn,
        chain: String(intent.chainId),
        intent: intent.id,
        workflow: '1'
      });
      handoff = `/swap?${params.toString()}`;
    }
  } else if (!blocked && intent.kind === 'automation') {
    handoff = '/orders';
  }

  return {
    intent,
    memory,
    checks,
    solvers: solverRows(intent),
    blocked,
    status: blocked ? 'draft-only' : handoff ? 'ready-for-review' : 'draft-only',
    handoff
  };
}

export function loadIntents() {
  const rows = safeRead(INTENTS_KEY, []);
  return Array.isArray(rows) ? rows.filter((r) => r?.intent?.schema === INTENT_SCHEMA).slice(0, MAX_RECORDS) : [];
}

export function saveCompiledIntent(compiled) {
  if (!compiled?.intent || compiled.intent.schema !== INTENT_SCHEMA) return { error: 'BAD_INTENT' };
  const record = {
    intent: compiled.intent,
    status: compiled.status,
    checks: compiled.checks,
    savedAt: Date.now()
  };
  const rows = [record, ...loadIntents().filter((r) => r.intent.id !== record.intent.id)].slice(0, MAX_RECORDS);
  safeWrite(INTENTS_KEY, rows);
  return { record, rows };
}

export function removeIntent(id) {
  const rows = loadIntents().filter((r) => r.intent.id !== id);
  safeWrite(INTENTS_KEY, rows);
  return rows;
}
