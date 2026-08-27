/**
 * FBT INTENT AI — PHASE 84: SIMULATION BEFORE SIGNATURE
 * ---------------------------------------------------------------------------
 * Phase 24 built the simulator seam and proved it would never report a missing
 * simulator as a zero-risk quote. This phase attaches it to a real provider and
 * makes it a precondition of signing rather than a panel decoration.
 *
 * The rule is one sentence: the wallet is not asked to sign a transaction that
 * has not been run first.
 *
 *   · a detected revert means NO signature request, plus the decoded reason
 *     in the user's language — not a wallet popup the user rejects blind
 *   · a provider that is missing, busy or timed out is `unavailable`, and
 *     unavailable is NOT clean. Signing without a simulation requires an
 *     explicit, separate user override, and the override is recorded.
 *   · a simulation is bound to the exact transaction it ran: change the
 *     calldata, the value, the sender or the chain and the result no longer
 *     applies, so it is refused as `TX_CHANGED`.
 *   · the outcome carries the gas estimate and the reason it can be checked
 *     against, so it can be shown next to the confirm button.
 */

import { classifyFailure } from './failureModes.js';

export const PRESIGN_SCHEMA = 'fbt.presign-gate.v1';
/** A simulation older than this describes a chain state that has moved on. */
export const SIMULATION_MAX_AGE_MS = 60_000;
export const SIMULATION_STATUSES = Object.freeze(['clean', 'revert', 'unavailable', 'stale', 'mismatched']);

export const REVERT_REASON_KEYS = Object.freeze({
  INSUFFICIENT_BALANCE: 'intentAI.presign.revert.insufficientBalance',
  INSUFFICIENT_ALLOWANCE: 'intentAI.presign.revert.insufficientAllowance',
  SLIPPAGE: 'intentAI.presign.revert.slippage',
  DEADLINE: 'intentAI.presign.revert.deadline',
  TRANSFER_FAILED: 'intentAI.presign.revert.transferFailed',
  UNKNOWN: 'intentAI.presign.revert.unknown'
});

// Number(null) === 0 and Number('') === 0, so an absent value must be
// rejected BEFORE the finite check or "missing" silently reads as zero.
const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean'
  ? null
  : (Number.isFinite(Number(v)) ? Number(v) : null));
const str = (v, n = 120) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);

/** A stable identity for the exact transaction that was simulated. */
export function txFingerprint(tx = {}) {
  const parts = [
    String(tx?.from || '').toLowerCase(),
    String(tx?.to || '').toLowerCase(),
    String(tx?.data || '0x').toLowerCase(),
    String(tx?.value ?? '0'),
    String(tx?.chainId ?? '')
  ];
  if (!parts[0] || !parts[1]) return null;
  return parts.join('|');
}

/** Map a raw revert string onto a translatable reason. */
export function classifyRevert(reason) {
  const text = String(reason || '').toLowerCase();
  if (!text) return { code: 'UNKNOWN', i18nKey: REVERT_REASON_KEYS.UNKNOWN };
  if (/allowance|approv/.test(text)) return { code: 'INSUFFICIENT_ALLOWANCE', i18nKey: REVERT_REASON_KEYS.INSUFFICIENT_ALLOWANCE };
  if (/balance|insufficient funds|exceeds balance/.test(text)) return { code: 'INSUFFICIENT_BALANCE', i18nKey: REVERT_REASON_KEYS.INSUFFICIENT_BALANCE };
  if (/slippage|insufficient_output|min.?amount|too little received/.test(text)) return { code: 'SLIPPAGE', i18nKey: REVERT_REASON_KEYS.SLIPPAGE };
  if (/deadline|expired/.test(text)) return { code: 'DEADLINE', i18nKey: REVERT_REASON_KEYS.DEADLINE };
  if (/transfer.?failed|st.?f\b/.test(text)) return { code: 'TRANSFER_FAILED', i18nKey: REVERT_REASON_KEYS.TRANSFER_FAILED };
  return { code: 'UNKNOWN', i18nKey: REVERT_REASON_KEYS.UNKNOWN };
}

/**
 * Run the transaction against a real provider before anyone is asked to sign.
 * @param {object}   tx        { from, to, data, value, chainId }
 * @param {function} simulate  async (tx) → { status, revertReason, gasLimit, ... }
 *                             at the call site this is `simulateUnsignedTransaction`
 */
export async function simulateBeforeSign({ tx = {}, simulate, now = Date.now() } = {}) {
  const fingerprint = txFingerprint(tx);
  if (!fingerprint) {
    return {
      ok: false, schema: PRESIGN_SCHEMA, status: 'unavailable', signAllowed: false,
      provenSafe: false, fingerprint: null,
      i18nKey: 'intentAI.presign.noTransaction',
      error: classifyFailure('MISSING_DATA', { detail: 'INCOMPLETE_TRANSACTION' })
    };
  }
  if (typeof simulate !== 'function') {
    return unavailableSimulation(fingerprint, 'NO_SIMULATOR', now);
  }

  let raw = null;
  try {
    raw = await simulate(tx);
  } catch {
    return unavailableSimulation(fingerprint, 'SIMULATOR_FAILED', now);
  }
  if (!raw || typeof raw !== 'object') return unavailableSimulation(fingerprint, 'SIMULATOR_EMPTY', now);

  const status = String(raw.status || '').toLowerCase();
  if (status === 'revert-detected' || raw.reverted === true) {
    const revert = classifyRevert(raw.revertReason);
    return {
      ok: false,
      schema: PRESIGN_SCHEMA,
      status: 'revert',
      // The point of the phase: no signature request at all.
      signAllowed: false,
      provenSafe: false,
      fingerprint,
      revertCode: revert.code,
      revertReason: str(raw.revertReason, 200),
      i18nKey: revert.i18nKey,
      i18nParams: { reason: str(raw.revertReason, 80) },
      gasLimit: raw.gasLimit == null ? null : String(raw.gasLimit),
      error: classifyFailure('SIMULATION_REVERT', { detail: revert.code }),
      simulatedAt: now
    };
  }
  if (status !== 'simulated-clean' && raw.provenSafe !== true) {
    return unavailableSimulation(fingerprint, status ? status.toUpperCase().replace(/[^A-Z0-9]/g, '_') : 'SIMULATOR_UNKNOWN', now);
  }

  return {
    ok: true,
    schema: PRESIGN_SCHEMA,
    status: 'clean',
    signAllowed: true,
    provenSafe: true,
    fingerprint,
    gasLimit: raw.gasLimit == null ? null : String(raw.gasLimit),
    gasCostUsd: num(raw.gasCostUsd),
    mempoolPath: str(raw.mempoolPath, 24) || 'unknown',
    i18nKey: 'intentAI.presign.clean',
    i18nParams: { gas: raw.gasLimit == null ? null : String(raw.gasLimit) },
    // Clean now, not clean forever.
    expiresAt: now + SIMULATION_MAX_AGE_MS,
    simulatedAt: now
  };
}

function unavailableSimulation(fingerprint, detail, now) {
  return {
    ok: false,
    schema: PRESIGN_SCHEMA,
    status: 'unavailable',
    // Unavailable is not clean, and it is not a silent pass either.
    signAllowed: false,
    provenSafe: false,
    overrideAvailable: true,
    fingerprint,
    i18nKey: 'intentAI.presign.unavailable',
    i18nParams: {},
    error: classifyFailure('SIMULATION_UNAVAILABLE', { detail }),
    simulatedAt: now
  };
}

/**
 * The gate the signing button reads.
 * @param {object} simulation result of simulateBeforeSign
 * @param {object} tx         the transaction about to be signed, re-checked
 * @param {object} opts       { userOverride, now }
 */
export function assertSimulatedBeforeSign(simulation, tx = {}, { userOverride = false, now = Date.now() } = {}) {
  if (!simulation || simulation.schema !== PRESIGN_SCHEMA) {
    return { ok: false, status: 'unavailable', error: classifyFailure('SIMULATION_UNAVAILABLE', { detail: 'NOT_SIMULATED' }) };
  }
  const fingerprint = txFingerprint(tx);
  if (fingerprint && simulation.fingerprint && fingerprint !== simulation.fingerprint) {
    // A simulation of a different transaction is worth nothing.
    return { ok: false, status: 'mismatched', error: classifyFailure('TERMS_CHANGED', { detail: 'TX_CHANGED_AFTER_SIMULATION' }) };
  }
  if (simulation.status === 'revert') {
    // There is no override for a proven revert. It would only burn gas.
    return { ok: false, status: 'revert', revertCode: simulation.revertCode, i18nKey: simulation.i18nKey, error: simulation.error };
  }
  if (simulation.status === 'clean') {
    if (num(simulation.expiresAt) !== null && now > simulation.expiresAt) {
      return { ok: false, status: 'stale', error: classifyFailure('SIMULATION_UNAVAILABLE', { detail: 'SIMULATION_EXPIRED' }) };
    }
    return { ok: true, status: 'clean', provenSafe: true, overridden: false };
  }
  if (userOverride === true) {
    // Allowed, but never silently: the record says the user chose this.
    return {
      ok: true,
      status: 'unavailable',
      provenSafe: false,
      overridden: true,
      i18nKey: 'intentAI.presign.overrideAccepted',
      record: Object.freeze({ overriddenAt: now, reason: 'USER_ACCEPTED_UNSIMULATED', provenSafe: false })
    };
  }
  return { ok: false, status: 'unavailable', error: classifyFailure('SIMULATION_UNAVAILABLE', { detail: 'NO_OVERRIDE' }) };
}

/** The one-line summary shown next to the confirm button. */
export function describeSimulation(simulation) {
  if (!simulation || simulation.schema !== PRESIGN_SCHEMA) {
    return { available: false, tone: 'warn', i18nKey: 'intentAI.presign.unavailable', params: {} };
  }
  if (simulation.status === 'revert') {
    return { available: true, tone: 'block', i18nKey: simulation.i18nKey, params: simulation.i18nParams || {} };
  }
  if (simulation.status === 'clean') {
    return { available: true, tone: 'ok', i18nKey: 'intentAI.presign.clean', params: simulation.i18nParams || {} };
  }
  return { available: false, tone: 'warn', i18nKey: 'intentAI.presign.unavailable', params: {} };
}
