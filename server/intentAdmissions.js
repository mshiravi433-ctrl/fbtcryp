/**
 * Transactional admission receipts for the FBT signed-commitment log.
 * ---------------------------------------------------------------------------
 * Phase 2c turns quote admission into a two-sided transaction: a commitment
 * either lands in the immutable transparency log AND yields a coordinator-
 * signed admission receipt, or it is rejected outright. There is no silent
 * middle state in which the coordinator remembers a quote the solver cannot
 * prove it delivered.
 *
 * A receipt binds exactly four facts the coordinator observed and signed:
 *
 *   intentHash · entryHash · acceptedAt · solverId
 *
 * plus the coordinator identity. That is deliberately all a receipt promises:
 * it does NOT promise the quote was executable, that the sealed close will
 * include it, or that anyone may spend user funds. Its evidentiary force
 * appears only when compared with a signed auction close:
 *
 *   receipt.acceptedAt <= close.sealedAt  AND  entryHash missing from the
 *   sealed set  →  provable coordinator censorship (misconduct evidence).
 *
 * Receipts are deterministic: the core is a pure function of the stored log
 * row and Ed25519 signatures are deterministic for a given key, so re-issuing
 * the receipt for the same entry reproduces the same bytes. That makes the
 * receipt RECLAIMABLE — a solver that received 201 but lost the HTTP response
 * can fetch the identical receipt from the public admissions endpoint, and a
 * watchtower can re-derive receipts for any logged entry while the same
 * coordinator key serves. Derivation after a key rotation signs with the NEW
 * coordinator only; originally issued receipts keep their own signer pinned
 * and remain fully verifiable.
 */

import { createHash } from 'node:crypto';
import { coordinatorConfig } from './intentAuctions.js';
import {
  canonicalValue,
  signCanonicalPayload,
  verifyCanonicalSignature
} from './intentSignatures.js';

export const ADMISSION_RECEIPT_SCHEMA = 'fbt.admission-receipt.v1';
export const ADMISSION_SIGNING_DOMAIN = 'fbt.admission-receipt.v1/signature';
const RECEIPT_ID_DOMAIN = 'fbt.admission-receipt.v1/id';
const TX_RE_64 = /^0x[a-fA-F0-9]{64}$/;
const SOLVER_RE = /^[a-z0-9][a-z0-9._-]{1,47}$/;

const sha256Hex = (value) => `0x${createHash('sha256').update(value).digest('hex')}`;

export function admissionReceiptsConfigured() {
  return Boolean(coordinatorConfig());
}

/**
 * Issue (or re-derive) the deterministic receipt for an admitted log entry.
 * Returns null when no coordinator key is configured or the facts are not
 * well-formed — callers fail loudly instead of emitting a half-truth.
 */
export function issueAdmissionReceipt({
  intentHash,
  entryHash,
  acceptedAt,
  solverId
}, { coordinator = coordinatorConfig() } = {}) {
  if (!coordinator) return null;
  const intent = TX_RE_64.test(String(intentHash || '')) ? String(intentHash).toLowerCase() : null;
  const entry = TX_RE_64.test(String(entryHash || '')) ? String(entryHash).toLowerCase() : null;
  if (!intent || !entry || !Number.isSafeInteger(acceptedAt) || acceptedAt <= 0) return null;
  if (!SOLVER_RE.test(String(solverId || ''))) return null;

  const core = {
    schema: ADMISSION_RECEIPT_SCHEMA,
    intentHash: intent,
    entryHash: entry,
    acceptedAt,
    solverId: String(solverId),
    coordinator: {
      id: coordinator.id,
      publicKey: coordinator.publicKey,
      algorithm: 'Ed25519'
    },
    binding: 'immutable-transparency-entry',
    claims: {
      entryStoredImmutably: true,
      coordinatorClockOnly: true,
      closeInclusionGuaranteed: false,
      executionAuthorised: false,
      fundsAccess: false
    }
  };
  const receiptId = sha256Hex(`${RECEIPT_ID_DOMAIN}\n${JSON.stringify(canonicalValue(core))}`);
  return {
    ...core,
    receiptId,
    signature: signCanonicalPayload(ADMISSION_SIGNING_DOMAIN, { ...core, receiptId }, coordinator.privateKey)
  };
}

function receiptIdFor(core) {
  return sha256Hex(`${RECEIPT_ID_DOMAIN}\n${JSON.stringify(canonicalValue(core))}`);
}

/**
 * Full structural + signature verification. No registry is consulted: the
 * receipt pins its own coordinator public key, exactly like a signed auction
 * close. Correlation (this receipt was signed by the same coordinator that
 * signed the close) is the watcher's job, not this function's.
 *
 * `expected.intentHash` optionally refuses receipts minted for another intent.
 */
export function verifyAdmissionReceipt(receipt, { intentHash } = {}) {
  if (!receipt
    || typeof receipt !== 'object'
    || Array.isArray(receipt)
    || receipt.schema !== ADMISSION_RECEIPT_SCHEMA
    || !TX_RE_64.test(String(receipt.receiptId || ''))) return false;
  if (!TX_RE_64.test(String(receipt.intentHash || ''))
    || !TX_RE_64.test(String(receipt.entryHash || ''))
    || (intentHash !== undefined && String(receipt.intentHash).toLowerCase() !== String(intentHash).toLowerCase())) {
    return false;
  }
  if (!Number.isSafeInteger(receipt.acceptedAt)
    || receipt.acceptedAt <= 0
    || receipt.acceptedAt > Date.now() + 30 * 86400000) return false;
  if (!SOLVER_RE.test(String(receipt.solverId || ''))) return false;
  const coordinator = receipt.coordinator;
  if (!coordinator
    || !SOLVER_RE.test(String(coordinator.id || ''))
    || coordinator.algorithm !== 'Ed25519'
    || typeof coordinator.publicKey !== 'string') return false;
  if (receipt.binding !== 'immutable-transparency-entry') return false;
  const claims = receipt.claims;
  if (!claims
    || claims.entryStoredImmutably !== true
    || claims.coordinatorClockOnly !== true
    || claims.closeInclusionGuaranteed !== false
    || claims.executionAuthorised !== false
    || claims.fundsAccess !== false) return false;

  const { signature, receiptId, ...core } = receipt;
  if (receiptIdFor(core) !== receiptId) return false;
  return verifyCanonicalSignature(
    ADMISSION_SIGNING_DOMAIN,
    { ...core, receiptId },
    signature,
    coordinator.publicKey
  );
}

export function admissionReceiptStatus() {
  return {
    configured: admissionReceiptsConfigured(),
    schema: ADMISSION_RECEIPT_SCHEMA,
    algorithm: 'Ed25519',
    transactionalAdmission: 'receipt-iff-logged-entry',
    deterministicReclaim: true,
    reclaimEndpoint: '/api/intents/v1/admissions/{intentHash}/{entryHash}',
    provesExecution: false,
    provesCloseInclusion: false
  };
}
