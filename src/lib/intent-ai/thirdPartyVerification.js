/**
 * FBT INTENT AI — PHASE 78: INDEPENDENT THIRD-PARTY RECEIPT VERIFICATION
 * ---------------------------------------------------------------------------
 * Self-attestation is the weakest form of proof. A receipt is only credible
 * once parties who do not run this app can check it and agree — which is what
 * the phase-29 assurance network exists for.
 *
 *   · a verification PACKET is published: hashes, the anchor, the proof path.
 *     Never the terms, never an address, never a signature.
 *   · verifiers are independent only if they are distinct operators; the same
 *     operator answering twice counts once
 *   · QUORUM (≥2 independent agreements, no disagreement) is required. One
 *     verifier is "unverified", not "verified".
 *   · any disagreement fails the whole verification — majority does not win
 *     when the question is "did this actually happen"
 */

import { classifyFailure } from './failureModes.js';
import { digest } from './onchainReceipt.js';

export const VERIFICATION_SCHEMA = 'fbt.third-party-verification.v1';
export const MIN_INDEPENDENT_VERIFIERS = 2;
export const VERIFICATION_TIMEOUT_MS = 15_000;
export const VERDICTS = Object.freeze(['verified', 'unverified', 'disputed', 'unavailable']);

const TX_HASH = /^0x[a-f0-9]{64}$/i;
const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean'
  ? null
  : (Number.isFinite(Number(v)) ? Number(v) : null));

const LEAKY_KEYS = ['terms', 'outcome', 'recipient', 'address', 'signature', 'calldata', 'amount'];

/** The packet a stranger needs — and nothing more. */
export function buildVerificationPacket({ receiptLeaf = null, anchor = null, proof = null, now = Date.now() } = {}) {
  if (!receiptLeaf?.ok) {
    return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_RECEIPT_LEAF' }) };
  }
  const packet = {
    schema: VERIFICATION_SCHEMA,
    intentId: receiptLeaf.intentId,
    termsHash: receiptLeaf.termsHash,
    outcomeHash: receiptLeaf.outcomeHash,
    leaf: receiptLeaf.leaf,
    executionTxHash: TX_HASH.test(String(receiptLeaf.executionTxHash || '')) ? receiptLeaf.executionTxHash : null,
    anchorRoot: typeof anchor?.root === 'string' ? anchor.root : null,
    anchorTxHash: TX_HASH.test(String(anchor?.txHash || '')) ? anchor.txHash : null,
    anchorChainId: num(anchor?.chainId),
    proofPath: Array.isArray(proof?.path) ? proof.path.map((s) => ({ hash: s.hash, right: Boolean(s.right) })) : [],
    publishedAt: now
  };
  const leaks = Object.keys(packet).filter((k) => LEAKY_KEYS.includes(k));
  return {
    ok: leaks.length === 0,
    packet: Object.freeze(packet),
    packetHash: digest(packet),
    // Hashes only. A verifier learns that something happened, not what.
    revealsTerms: false,
    leaks
  };
}

function normalizeVerdict(raw) {
  const v = String(raw?.verdict || '').toLowerCase();
  return VERDICTS.includes(v) ? v : 'unavailable';
}

/**
 * Ask the assurance network. Each verifier is a function; a verifier that
 * throws, times out or answers about a different packet is discarded, never
 * counted as agreement.
 */
export async function requestIndependentVerification({
  packet = null, verifiers = [], timeoutMs = VERIFICATION_TIMEOUT_MS, now = Date.now()
} = {}) {
  const built = packet?.ok ? packet : { ok: false };
  if (!built.ok) {
    return { ok: false, verdict: 'unavailable', verifiedBy: [], i18nKey: 'intentAI.verify.unavailable', error: classifyFailure('MISSING_DATA', { detail: 'NO_PACKET' }) };
  }
  const list = (Array.isArray(verifiers) ? verifiers : []).slice(0, 16);
  const responses = await Promise.all(list.map(async (v) => {
    const operatorId = typeof v?.operatorId === 'string' ? v.operatorId : null;
    if (!operatorId || typeof v?.verify !== 'function') return { operatorId, verdict: 'unavailable', discarded: 'NOT_A_VERIFIER' };
    try {
      const raced = await Promise.race([
        Promise.resolve(v.verify(built.packet)),
        new Promise((resolve) => {
          const timer = setTimeout(() => resolve({ verdict: 'unavailable', timedOut: true }), Math.max(1, num(timeoutMs) ?? VERIFICATION_TIMEOUT_MS));
          // Never hold the event loop open just to wait out a verifier.
          if (typeof timer?.unref === 'function') timer.unref();
        })
      ]);
      if (raced?.timedOut) return { operatorId, verdict: 'unavailable', discarded: 'TIMEOUT' };
      if (raced?.leaf && raced.leaf !== built.packet.leaf) {
        return { operatorId, verdict: 'unavailable', discarded: 'ANSWERED_ABOUT_ANOTHER_RECEIPT' };
      }
      return { operatorId, verdict: normalizeVerdict(raced), evidence: typeof raced?.evidence === 'string' ? raced.evidence.slice(0, 256) : null };
    } catch {
      return { operatorId, verdict: 'unavailable', discarded: 'VERIFIER_ERROR' };
    }
  }));

  // Independence: one voice per operator, first answer only.
  const seen = new Set();
  const independent = [];
  for (const r of responses) {
    if (!r.operatorId || seen.has(r.operatorId)) continue;
    seen.add(r.operatorId);
    independent.push(r);
  }
  const agree = independent.filter((r) => r.verdict === 'verified');
  const disagree = independent.filter((r) => r.verdict === 'disputed');
  const duplicates = responses.length - independent.length;

  if (disagree.length) {
    return {
      ok: false, schema: VERIFICATION_SCHEMA, verdict: 'disputed',
      verifiedBy: agree.map((r) => r.operatorId), disputedBy: disagree.map((r) => r.operatorId),
      independentCount: independent.length, duplicates,
      i18nKey: 'intentAI.verify.disputed', checkedAt: now,
      error: classifyFailure('MISSING_DATA', { detail: 'VERIFIER_DISAGREEMENT' })
    };
  }
  if (agree.length < MIN_INDEPENDENT_VERIFIERS) {
    return {
      ok: false, schema: VERIFICATION_SCHEMA, verdict: 'unverified',
      verifiedBy: agree.map((r) => r.operatorId), disputedBy: [],
      independentCount: independent.length, duplicates,
      required: MIN_INDEPENDENT_VERIFIERS,
      i18nKey: 'intentAI.verify.unverified', checkedAt: now
    };
  }
  return {
    ok: true, schema: VERIFICATION_SCHEMA, verdict: 'verified',
    verifiedBy: agree.map((r) => r.operatorId), disputedBy: [],
    independentCount: independent.length, duplicates,
    i18nKey: 'intentAI.verify.verified', i18nParams: { count: agree.length }, checkedAt: now
  };
}

/** Would the assurance network's own gate let this result be published? */
export function assurancePlaneReady({ assurance = null } = {}) {
  const ok = assurance?.ok === true && Array.isArray(assurance?.gaps) ? assurance.gaps.length === 0 : assurance?.ok === true;
  return {
    ok: Boolean(ok),
    i18nKey: ok ? 'intentAI.verify.networkReady' : 'intentAI.verify.networkDegraded'
  };
}

/** The badge the panel is allowed to show. Nothing else may claim proof. */
export function assertVerificationHonest(result) {
  const reasons = [];
  if (!result || result.schema !== VERIFICATION_SCHEMA) reasons.push('NOT_A_VERIFICATION');
  const verified = result?.verdict === 'verified';
  const by = Array.isArray(result?.verifiedBy) ? result.verifiedBy : [];
  if (verified && by.length < MIN_INDEPENDENT_VERIFIERS) reasons.push('QUORUM_NOT_MET');
  if (verified && new Set(by).size !== by.length) reasons.push('VERIFIERS_NOT_INDEPENDENT');
  if (verified && (result?.disputedBy || []).length) reasons.push('CLAIMED_VERIFIED_WHILE_DISPUTED');
  if (result?.ok === true && !verified) reasons.push('OK_WITHOUT_VERDICT');
  const unique = [...new Set(reasons)];
  return unique.length
    ? { ok: false, mayShowVerifiedBadge: false, reasons: unique, error: classifyFailure('MISSING_DATA', { detail: unique[0] }) }
    : { ok: true, mayShowVerifiedBadge: verified };
}
