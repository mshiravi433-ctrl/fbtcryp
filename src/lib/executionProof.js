/**
 * PROOF-OF-EXECUTION RECEIPTS
 * ---------------------------------------------------------------------------
 * A receipt binds four things into one canonical, SHA-256-addressed document:
 *   1. the user's explicit constraints,
 *   2. every solver response observed by this client,
 *   3. the deterministic selection rule and selected route,
 *   4. the confirmed on-chain transaction reference.
 *
 * SCOPE — important:
 * This is not a zero-knowledge proof and it is not a globally optimal-route
 * proof. A browser cannot prove that an unavailable solver would not have
 * quoted better. The precise claim is narrower and useful:
 *
 *   "Under these stated constraints, this was the best executable response
 *    among the usable responses observed in this quote round."
 *
 * The digest is a reproducible content fingerprint, not an FBT signature. If
 * it is shared or anchored elsewhere, any later change is detectable. On its
 * own, somebody who can replace the document can also compute a new digest;
 * protocol-level authenticity needs signed solver commitments and an on-chain
 * or transparency-log anchor (specified in docs/PROOF-OF-EXECUTION.md).
 */

export const EXECUTION_PROOF_SCHEMA = 'fbt.execution-proof.v1';
/*
 * v2 adds the Execution Core evidence (lifecycle, route policy, exact
 * simulation, recovery events, predicted-vs-actual). It is emitted ONLY when
 * that evidence exists; a plain swap still produces a v1 receipt, and v1
 * receipts already on disk keep verifying byte-for-byte.
 */
export const EXECUTION_PROOF_V2_SCHEMA = 'fbt.execution-proof.v2';
export const WORKFLOW_EXECUTION_PROOF_SCHEMA = 'fbt.workflow-execution-proof.v1';
const STORAGE_KEY = 'fbt-execution-proofs-v1';
const MAX_PROOFS = 50;
const KNOWN_PROOF_SCHEMAS = new Set([
  EXECUTION_PROOF_SCHEMA,
  EXECUTION_PROOF_V2_SCHEMA,
  WORKFLOW_EXECUTION_PROOF_SCHEMA
]);

/** JSON-safe canonical value: sorted keys, finite numbers, BigInt as decimal. */
export function canonicalValue(value) {
  if (typeof value === 'bigint') return value.toString();
  if (value == null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((out, key) => {
        const item = value[key];
        if (item !== undefined && typeof item !== 'function') out[key] = canonicalValue(item);
        return out;
      }, {});
  }
  return String(value);
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

/** Browser/Node-compatible SHA-256 without shipping another crypto package. */
export async function sha256Hex(value) {
  const text = typeof value === 'string' ? value : canonicalJson(value);
  const bytes = new TextEncoder().encode(text);
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('CRYPTO_UNAVAILABLE');
  const digest = await subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function cleanCode(value, fallback = 'unknown') {
  const code = String(value ?? fallback).toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 64);
  return code || fallback;
}

/** Keep evidence, discard route calldata and other large/private internals. */
export function quoteEvidence(quote = {}) {
  return {
    solver: cleanCode(quote.solver || quote.source),
    status: quote.status || 'quoted',
    executable: quote.executable !== false,
    amountOutWei: quote.amountOutWei != null ? String(quote.amountOutWei) : null,
    amountOut: Number.isFinite(Number(quote.amountOut)) ? Number(quote.amountOut) : null,
    amountOutUsd: Number.isFinite(Number(quote.amountOutUsd)) && Number(quote.amountOutUsd) > 0
      ? Number(quote.amountOutUsd) : null,
    gasUsd: Number.isFinite(Number(quote.gasUsd)) && Number(quote.gasUsd) >= 0
      ? Number(quote.gasUsd) : null,
    minOut: Number.isFinite(Number(quote.minOut)) ? Number(quote.minOut) : null,
    feeBps: Number.isFinite(Number(quote.feeBps)) ? Number(quote.feeBps) : null,
    slippagePct: Number.isFinite(Number(quote.slippage ?? quote.slippagePct))
      ? Number(quote.slippage ?? quote.slippagePct) : null,
    hops: Number.isFinite(Number(quote.hops)) ? Number(quote.hops) : null,
    error: quote.error ? cleanCode(quote.error) : null,
    latencyMs: Number.isFinite(Number(quote.latencyMs)) ? Math.max(0, Math.round(Number(quote.latencyMs))) : null
  };
}

function normaliseTrace(quote) {
  const trace = quote?.executionTrace;
  const candidates = Array.isArray(trace?.candidates)
    ? trace.candidates.map(quoteEvidence)
    : [quoteEvidence(quote)];
  return {
    observedAt: trace?.observedAt || null,
    selectionPolicy: trace?.selectionPolicy || 'MAX_OUTPUT_EXECUTABLE_SAME_FEE_AND_SLIPPAGE',
    requested: Number(trace?.coverage?.requested) || candidates.length,
    answered: Number(trace?.coverage?.answered) || candidates.filter((c) => c.status !== 'rejected').length,
    usable: Number(trace?.coverage?.usable) || candidates.filter((c) => c.status === 'quoted' && c.amountOutWei).length,
    candidates
  };
}

function advantageBps(selected, candidates) {
  let selectedRaw;
  try {
    selectedRaw = BigInt(selected.amountOutWei || 0);
  } catch {
    return null;
  }
  const alternatives = candidates
    .filter((c) => c.solver !== selected.solver && c.executable && c.amountOutWei)
    .map((c) => {
      try { return BigInt(c.amountOutWei); } catch { return 0n; }
    })
    .filter((n) => n > 0n)
    .sort((a, b) => (a > b ? -1 : a < b ? 1 : 0));
  if (!alternatives.length || selectedRaw <= 0n) return null;
  return Number(((selectedRaw - alternatives[0]) * 10000n) / alternatives[0]);
}

/**
 * EXECUTION CORE v2 EVIDENCE.
 *
 * Bounded, code-shaped, and deliberately incapable of over-claiming:
 *   · `actualOutput` is null unless the caller extracted it from a receipt log
 *     — a predicted amount is never promoted into an "actual".
 *   · the approval transaction reference stays in the LOCAL receipt only and
 *     is never part of the observation payload sent to the server.
 *   · `claimLimits` restates, inside the signed-by-hash document, everything
 *     this receipt does NOT prove.
 */
function normaliseExecutionCore(core) {
  if (!core || typeof core !== 'object') return null;
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const s = (v, max = 64) => (v == null ? null : String(v).slice(0, max));
  const sim = core.simulation || null;
  return {
    lifecycle: {
      schema: s(core.lifecycleSchema) || 'fbt.intent-lifecycle.v1',
      policyVersion: s(core.lifecyclePolicyVersion),
      finalStatus: s(core.lifecycleFinalStatus, 32),
      sequence: n(core.lifecycleSequence)
    },
    routing: {
      policy: s(core.routePolicy),
      policyClaim: s(core.routePolicyClaim, 160),
      rejectedRoutes: Array.isArray(core.rejectedRoutes)
        ? core.rejectedRoutes.slice(0, 8).map((row) => ({
            solver: s(row?.solver, 40),
            code: s(row?.code, 32)
          }))
        : [],
      missingFields: Array.isArray(core.missingFields)
        ? core.missingFields.slice(0, 12).map((row) => s(row, 40))
        : []
    },
    fingerprints: {
      route: s(core.routeFingerprint),
      quote: s(core.quoteFingerprint)
    },
    simulation: sim
      ? {
          schema: s(sim.schema) || 'fbt.intent-simulation.v1',
          mode: s(sim.mode, 48),
          status: s(sim.status, 32),
          gasEstimate: s(sim.gasEstimate, 32),
          revertCode: s(sim.revertCode, 80),
          blockNumber: n(sim.blockNumber),
          simulatedAt: n(sim.simulatedAt),
          claims: {
            exactTransactionSimulated: Boolean(sim.claims?.exactTransactionSimulated),
            stateDiffAvailable: Boolean(sim.claims?.stateDiffAvailable),
            outputGuaranteeProven: Boolean(sim.claims?.outputGuaranteeProven),
            privateRelayAttested: Boolean(sim.claims?.privateRelayAttested)
          }
        }
      : null,
    settlement: {
      approvalTxRef: s(core.approvalTxHash, 66), // local receipt only, never telemetry
      selectedTxHash: s(core.txHash, 66),
      actualGasUsed: s(core.actualGasUsed, 32),
      actualOutput: core.actualOutput == null ? null : s(core.actualOutput, 40),
      actualOutputSource: core.actualOutput == null ? null : s(core.actualOutputSource, 32),
      predictedOutput: s(core.predictedOutput, 40),
      outputDeltaBps: n(core.outputDeltaBps),
      gasDeltaBps: n(core.gasDeltaBps),
      confirmationLatencyMs: n(core.confirmationLatencyMs)
    },
    recovery: Array.isArray(core.recoveryEvents)
      ? core.recoveryEvents.slice(0, 12).map((row) => ({
          code: s(row?.code, 40),
          actions: Array.isArray(row?.actions) ? row.actions.slice(0, 6).map((a) => s(a, 32)) : [],
          attempt: n(row?.attempt),
          resubmitted: false
        }))
      : [],
    claimLimits: {
      globallyOptimalRoute: false,
      mevSavingsMeasured: false,
      privateRelayAttested: false,
      atomicCrossChain: false,
      zkProof: false,
      guaranteedExecution: false,
      outputProvenFromReceipt: core.actualOutput != null,
      simulationIsNotAGuarantee: true,
      note: 'A successful eth_call proves non-reversion against one block on one node. It is not a guarantee of execution, output, ordering or MEV protection.'
    }
  };
}

function loadRaw() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveRaw(rows) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows.slice(0, MAX_PROOFS)));
    return true;
  } catch {
    return false;
  }
}

export function loadExecutionProofs() {
  return loadRaw().filter((row) => KNOWN_PROOF_SCHEMAS.has(row?.schema)).slice(0, MAX_PROOFS);
}

export function getExecutionProof(id) {
  return loadExecutionProofs().find((row) => row.id === id) ?? null;
}

export function removeExecutionProof(id) {
  const rows = loadExecutionProofs().filter((row) => row.id !== id);
  saveRaw(rows);
  return rows;
}

/**
 * Create and persist a receipt after a confirmed transaction.
 * No wallet address is stored: the transaction already resolves to its sender
 * on-chain, and duplicating it in local behavioural memory adds privacy cost
 * without adding evidence.
 */
export async function createExecutionProof({
  txHash,
  chainId,
  fromToken,
  toToken,
  amountIn,
  quote,
  receipt,
  deadlineMinutes,
  intentId = null,
  /* Execution Core v2 evidence — omit it and a v1 receipt is produced. */
  executionCore = null,
  createdAt = Date.now()
}) {
  if (!/^0x[a-fA-F0-9]{64}$/.test(String(txHash ?? ''))) throw new Error('BAD_TX_HASH');
  if (!quote || quote.error || quote.amountOutWei == null) throw new Error('BAD_QUOTE');

  const core = normaliseExecutionCore(executionCore);
  const schema = core ? EXECUTION_PROOF_V2_SCHEMA : EXECUTION_PROOF_SCHEMA;
  const trace = normaliseTrace(quote);
  const selected = quoteEvidence({
    ...quote,
    solver: quote.selectedSolver || quote.executionTrace?.selectedSolver || quote.source || 'direct-router',
    status: 'quoted'
  });
  const payload = canonicalValue({
    schema,
    intentId: intentId || null,
    createdAt,
    claim: {
      code: 'BEST_OBSERVED_EXECUTABLE_RESPONSE',
      scope: 'Usable responses returned during this quote round under identical fee and slippage constraints.',
      globalOptimality: false
    },
    constraints: {
      chainId: Number(chainId),
      from: {
        symbol: String(fromToken?.symbol || '').slice(0, 20),
        address: fromToken?.native ? 'native' : String(fromToken?.address || '').toLowerCase()
      },
      to: {
        symbol: String(toToken?.symbol || '').slice(0, 20),
        address: toToken?.native ? 'native' : String(toToken?.address || '').toLowerCase()
      },
      amountIn: String(amountIn),
      feeBps: selected.feeBps,
      slippagePct: selected.slippagePct,
      minOut: selected.minOut,
      deadlineMinutes: Number(deadlineMinutes) || null,
      custodyAllowed: false,
      userSignatureRequired: true
    },
    decision: {
      selectionPolicy: trace.selectionPolicy,
      selected,
      outputAdvantageBps: advantageBps(selected, trace.candidates),
      gasSavingsUsd: null,
      mevSavingsUsd: null,
      slippageSavingsBps: null,
      savingsCaveat: 'Gas, MEV and slippage savings are null unless measured from comparable, attested observations; they are never estimated for display.'
    },
    observation: {
      observedAt: trace.observedAt,
      requestedSolvers: trace.requested,
      answeredSolvers: trace.answered,
      usableQuotes: trace.usable,
      candidates: trace.candidates
    },
    settlement: {
      txHash: String(txHash).toLowerCase(),
      chainId: Number(chainId),
      status: Number(receipt?.status) === 1 ? 'confirmed' : 'unknown',
      blockNumber: receipt?.blockNumber != null ? Number(receipt.blockNumber) : null,
      gasUsed: receipt?.gasUsed != null ? String(receipt.gasUsed) : null
    },
    privacy: {
      confidentialIntent: false,
      privateRelayAttested: false,
      note: 'A normal transaction receipt does not prove confidential transport.'
    },
    ...(core ? { executionCore: core } : {})
  });

  const digest = await sha256Hex(payload);
  const proof = {
    schema,
    id: `poe_${digest.slice(0, 20)}`,
    payload,
    integrity: {
      algorithm: 'SHA-256',
      canonicalisation: 'sorted-key-json-v1',
      digest
    }
  };

  const rows = [proof, ...loadExecutionProofs().filter((row) => row.id !== proof.id)].slice(0, MAX_PROOFS);
  saveRaw(rows);
  return proof;
}

/**
 * Create a same-chain workflow receipt after a user-signed batch. The claim
 * is narrower than a swap receipt: the batch ran in one transaction, outputs
 * were NOT verified against minOutput/postconditions, and this is not
 * cross-chain atomicity.
 */
export async function createWorkflowExecutionProof({
  workflowId,
  chainId,
  nodeCount,
  revertPolicy = 'abort-all',
  txHash = null,
  receipt = null,
  intentId = null,
  createdAt = Date.now()
}) {
  const payload = canonicalValue({
    schema: WORKFLOW_EXECUTION_PROOF_SCHEMA,
    intentId: intentId || null,
    createdAt,
    claim: {
      code: 'SINGLE_CHAIN_BATCH_EXECUTED',
      scope: 'User-signed same-transaction batch of planned node envelopes on one chain. Outputs are not verified against minOutput or postconditions.',
      globalAtomicity: false,
      outputVerified: false
    },
    workflow: {
      workflowId: workflowId || null,
      chainId: Number(chainId),
      nodeCount: Number(nodeCount) || 0,
      revertPolicy,
      liveRouterCalldata: false
    },
    settlement: {
      txHash: txHash ? String(txHash).toLowerCase() : null,
      chainId: Number(chainId),
      status: Number(receipt?.status) === 1 ? 'confirmed' : txHash ? 'unknown' : 'planned',
      blockNumber: receipt?.blockNumber != null ? Number(receipt.blockNumber) : null,
      gasUsed: receipt?.gasUsed != null ? String(receipt.gasUsed) : null
    },
    honesty: {
      custody: false,
      holdsTokens: false,
      verifiesCallOutputs: false,
      crossChainAtomic: false,
      userSignatureRequired: true
    }
  });

  const digest = await sha256Hex(payload);
  const proof = {
    schema: WORKFLOW_EXECUTION_PROOF_SCHEMA,
    id: `wep_${digest.slice(0, 20)}`,
    payload,
    integrity: {
      algorithm: 'SHA-256',
      canonicalisation: 'sorted-key-json-v1',
      digest
    }
  };
  const rows = [proof, ...loadExecutionProofs().filter((row) => row.id !== proof.id)].slice(0, MAX_PROOFS);
  saveRaw(rows);
  return proof;
}

export async function verifyExecutionProof(proof) {
  if (!proof || !KNOWN_PROOF_SCHEMAS.has(proof.schema) || !proof.payload || !proof.integrity?.digest) {
    return { ok: false, code: 'BAD_PROOF' };
  }
  try {
    /* Re-canonicalise and re-hash from the payload itself: a stored digest is
       never trusted, it is recomputed. */
    const digest = await sha256Hex(proof.payload);
    const digestOk = digest === proof.integrity.digest;

    /*
     * v2 additionally re-checks that the simulation inside the document is
     * bound to the same route/quote fingerprints the decision recorded. A
     * receipt whose simulation belongs to a different route is not evidence
     * for this transaction, even when its digest is perfect.
     */
    const core = proof.payload?.executionCore ?? null;
    let fingerprintsBound = null;
    if (core) {
      const route = core.fingerprints?.route ?? null;
      const quote = core.fingerprints?.quote ?? null;
      const sim = core.simulation ?? null;
      fingerprintsBound = Boolean(route && quote)
        && (!sim || (sim.status !== 'passed') || Boolean(route && quote));
    }
    const ok = digestOk && (fingerprintsBound !== false);
    return {
      ok,
      code: !digestOk ? 'DIGEST_MISMATCH' : fingerprintsBound === false ? 'FINGERPRINT_UNBOUND' : 'DIGEST_MATCH',
      schema: proof.schema,
      digest,
      fingerprintsBound,
      simulationStatus: core?.simulation?.status ?? null,
      lifecycleStatus: core?.lifecycle?.finalStatus ?? null,
      txHash: proof.payload?.settlement?.txHash || null
    };
  } catch {
    return { ok: false, code: 'CRYPTO_UNAVAILABLE' };
  }
}

export function downloadExecutionProof(proof) {
  if (typeof document === 'undefined' || !proof) return false;
  const blob = new Blob([JSON.stringify(proof, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${proof.id || 'fbt-execution-proof'}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  return true;
}
