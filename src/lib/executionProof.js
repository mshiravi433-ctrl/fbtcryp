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
export const WORKFLOW_EXECUTION_PROOF_SCHEMA = 'fbt.workflow-execution-proof.v1';
const STORAGE_KEY = 'fbt-execution-proofs-v1';
const MAX_PROOFS = 50;
const KNOWN_PROOF_SCHEMAS = new Set([EXECUTION_PROOF_SCHEMA, WORKFLOW_EXECUTION_PROOF_SCHEMA]);

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
  createdAt = Date.now()
}) {
  if (!/^0x[a-fA-F0-9]{64}$/.test(String(txHash ?? ''))) throw new Error('BAD_TX_HASH');
  if (!quote || quote.error || quote.amountOutWei == null) throw new Error('BAD_QUOTE');

  const trace = normaliseTrace(quote);
  const selected = quoteEvidence({
    ...quote,
    solver: quote.selectedSolver || quote.executionTrace?.selectedSolver || quote.source || 'direct-router',
    status: 'quoted'
  });
  const payload = canonicalValue({
    schema: EXECUTION_PROOF_SCHEMA,
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
    }
  });

  const digest = await sha256Hex(payload);
  const proof = {
    schema: EXECUTION_PROOF_SCHEMA,
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
    const digest = await sha256Hex(proof.payload);
    return {
      ok: digest === proof.integrity.digest,
      code: digest === proof.integrity.digest ? 'DIGEST_MATCH' : 'DIGEST_MISMATCH',
      digest,
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
