/**
 * FBT Insurance OS — Claim engine (§21, §23, §24, §25).
 *
 * draft → submitted → provider review → decision → payout (independently
 * verified) → PAID. Evidence stored by cryptographic hash; no unnecessary
 * personal data. A claim is never marked PAID merely because an API says so.
 */
import * as store from './store.js';
import { emit } from './events.js';
import { providerAdapter } from './provider-registry.js';
import { toMicro, fromMicro, CLAIM_STATUS, COVERAGE_STATUS } from './constants.js';
import { sha256, newId } from './quote-engine.js';
import { verifyReceipt, receiptAlreadyProcessed } from './indexer.js';
import { getCoverage, now } from './coverage.js';

export async function createClaim({ coverageId, owner, incidentType, description, affectedAmountMicro, evidence = {}, evidenceHash }) {
  const cov = await getCoverage(coverageId, owner);
  if (!cov) throw Object.assign(new Error('COVERAGE_NOT_FOUND'), { code: 'COVERAGE_NOT_FOUND' });
  if (cov.status !== COVERAGE_STATUS.ACTIVE) throw Object.assign(new Error('COVERAGE_NOT_ACTIVE'), { code: 'COVERAGE_NOT_ACTIVE' });

  const amountMicro = affectedAmountMicro != null ? (typeof affectedAmountMicro === 'bigint' ? affectedAmountMicro : toMicro(affectedAmountMicro)) : cov.coverageAmountMicro;
  const alreadyPaid = BigInt(cov.claimedMicro || 0n);
  const remaining = BigInt(cov.coverageAmountMicro) - alreadyPaid;
  const requestMicro = amountMicro > remaining ? remaining : amountMicro;
  if (requestMicro <= 0n) throw Object.assign(new Error('COVERAGE_EXHAUSTED'), { code: 'COVERAGE_EXHAUSTED' });

  const claimId = newId('clm');
  const evidenceH = evidenceHash || sha256(evidence || {});
  const claim = {
    claimId,
    coverageId,
    owner: String(owner).toLowerCase(),
    providerId: cov.providerId,
    providerName: cov.providerName,
    chainId: cov.chainId,
    protectionType: cov.protectionType,
    contractAddress: cov.contractAddress,
    incidentType,
    description: String(description || '').slice(0, 2000),
    affectedAmountMicro: amountMicro,
    requestedPayoutMicro: requestMicro,
    requestedPayoutUsd: fromMicro(requestMicro),
    currency: cov.currency,
    claimNumber: `FBT-${claimId.slice(-8).toUpperCase()}`,
    status: CLAIM_STATUS.DRAFT,
    evidenceHash: evidenceH,
    providerClaimStatus: null,
    incidentTimestamp: null,
    transactionHash: null,
    createdAt: now(),
    updatedAt: now(),
    timeline: [{ at: now(), status: CLAIM_STATUS.DRAFT, note: 'draft created' }]
  };
  await store.set('claims', claimId, claim);
  await store.addToOwnerList('claims', claim.owner, claimId);
  await emit({ type: 'ClaimCreated', wallet: claim.owner, claimId, coverageId, providerId: cov.providerId, payload: { claimId, coverageId } });
  return claim;
}

export async function updateClaim({ claimId, owner, patch, actor = owner }) {
  const claim = await store.get('claims', claimId);
  if (!claim) throw Object.assign(new Error('CLAIM_NOT_FOUND'), { code: 'CLAIM_NOT_FOUND' });
  if (owner && claim.owner !== String(owner).toLowerCase()) throw Object.assign(new Error('UNAUTHORIZED'), { code: 'UNAUTHORIZED' });
  Object.assign(claim, patch);
  claim.updatedAt = now();
  claim.timeline = [...(claim.timeline || []), { at: now(), status: claim.status, note: patch.note || 'updated' }];
  await store.set('claims', claimId, claim);
  await emit({ type: 'ClaimUpdated', wallet: claim.owner, claimId, coverageId: claim.coverageId, payload: { claimId, status: claim.status } });
  return claim;
}

export async function submitClaim({ claimId, owner, evidenceHash, incidentTimestamp }) {
  const claim = await store.get('claims', claimId);
  if (!claim) throw Object.assign(new Error('CLAIM_NOT_FOUND'), { code: 'CLAIM_NOT_FOUND' });
  if (owner && claim.owner !== String(owner).toLowerCase()) throw Object.assign(new Error('UNAUTHORIZED'), { code: 'UNAUTHORIZED' });
  if (claim.status === CLAIM_STATUS.DRAFT || claim.status === CLAIM_STATUS.ADDITIONAL_INFORMATION_REQUIRED) {
    if (evidenceHash) claim.evidenceHash = evidenceHash;
    if (incidentTimestamp) claim.incidentTimestamp = incidentTimestamp;
    claim.status = CLAIM_STATUS.SUBMITTED;
    claim.updatedAt = now();
    claim.timeline = [...(claim.timeline || []), { at: now(), status: CLAIM_STATUS.SUBMITTED, note: 'submitted' }];
    await store.set('claims', claimId, claim);
    // provider review (sandbox returns UNDER_REVIEW)
    const res = await providerAdapter(claim.providerId).submitClaim({ claimId, coverageId: claim.coverageId }).catch(() => ({ ok: false }));
    if (res?.ok) claim.status = CLAIM_STATUS.UNDER_REVIEW;
    claim.providerClaimStatus = res?.providerClaimStatus || res?.status || null;
    claim.updatedAt = now();
    claim.timeline = [...(claim.timeline || []), { at: now(), status: claim.status, note: 'under provider review' }];
    await store.set('claims', claimId, claim);
    await emit({ type: 'ClaimSubmitted', wallet: claim.owner, claimId, coverageId: claim.coverageId, payload: { claimId, status: claim.status } });
  }
  return claim;
}

/** Admin/provider decision endpoint (role-gated in router). */
export async function decideClaim({ claimId, decision, payoutAmountMicro, note, actor }) {
  const claim = await store.get('claims', claimId);
  if (!claim) throw Object.assign(new Error('CLAIM_NOT_FOUND'), { code: 'CLAIM_NOT_FOUND' });
  const map = { APPROVED: CLAIM_STATUS.APPROVED, REJECTED: CLAIM_STATUS.REJECTED, PARTIALLY_APPROVED: CLAIM_STATUS.PARTIALLY_APPROVED, ADDITIONAL_INFORMATION_REQUIRED: CLAIM_STATUS.ADDITIONAL_INFORMATION_REQUIRED, DISPUTED: CLAIM_STATUS.DISPUTED };
  const next = map[decision];
  if (!next) throw Object.assign(new Error('INVALID_DECISION'), { code: 'INVALID_DECISION' });
  const prev = claim.status;
  claim.status = next;
  if (next === CLAIM_STATUS.APPROVED) {
    const cap = BigInt(claim.requestedPayoutMicro || 0n);
    claim.approvedPayoutMicro = payoutAmountMicro != null ? (typeof payoutAmountMicro === 'bigint' ? payoutAmountMicro : toMicro(payoutAmountMicro)) : cap;
    if (BigInt(claim.approvedPayoutMicro) > cap) claim.approvedPayoutMicro = cap;
    claim.approvedPayoutUsd = fromMicro(claim.approvedPayoutMicro);
  } else if (next === CLAIM_STATUS.PARTIALLY_APPROVED) {
    claim.approvedPayoutMicro = payoutAmountMicro != null ? (typeof payoutAmountMicro === 'bigint' ? payoutAmountMicro : toMicro(payoutAmountMicro)) : 0n;
    claim.approvedPayoutUsd = fromMicro(claim.approvedPayoutMicro);
  } else if (next === CLAIM_STATUS.REJECTED) {
    claim.approvedPayoutMicro = 0n;
    claim.approvedPayoutUsd = '0';
    claim.rejectReason = note || null;
  }
  claim.updatedAt = now();
  claim.timeline = [...(claim.timeline || []), { at: now(), from: prev, status: claim.status, note: note || decision }];
  await store.set('claims', claimId, claim);
  await emit({
    type: claim.status === CLAIM_STATUS.REJECTED ? 'ClaimRejected' : 'ClaimApproved',
    wallet: claim.owner, claimId, coverageId: claim.coverageId,
    payload: { claimId, status: claim.status, approvedPayoutMicro: claim.approvedPayoutMicro }
  });
  return claim;
}

/**
 * Record a payout only after independent on-chain verification (§25). Idempotent.
 */
export async function recordPayout({ claimId, txHash, amountMicro, recipient, chainId, owner, idempotencyKey }) {
  const claim = await store.get('claims', claimId);
  if (!claim) throw Object.assign(new Error('CLAIM_NOT_FOUND'), { code: 'CLAIM_NOT_FOUND' });
  const key = idempotencyKey || `payout-${claimId}-${txHash}`;
  const claimOwner = owner || claim.owner;
  const claimRes = await store.claimIdempotent({
    operation: 'payout', owner: claimOwner, key, fingerprint: `${claimId}:${txHash}`,
    commit: async () => {
      if (![CLAIM_STATUS.APPROVED, CLAIM_STATUS.PARTIALLY_APPROVED].includes(claim.status)) {
        throw Object.assign(new Error('CLAIM_NOT_APPROVED'), { code: 'CLAIM_NOT_APPROVED' });
      }
      const amt = amountMicro != null ? (typeof amountMicro === 'bigint' ? amountMicro : toMicro(amountMicro)) : claim.approvedPayoutMicro;
      if (await receiptAlreadyProcessed(txHash, 'payout')) throw Object.assign(new Error('RECEIPT_ALREADY_PROCESSED'), { code: 'RECEIPT_ALREADY_PROCESSED' });
      const receipt = await verifyReceipt({
        kind: 'payout', providerId: claim.providerId, txHash, chainId: chainId ?? claim.chainId,
        owner: claim.owner, recipient, amountMicro: amt, claimId
      });
      if (!receipt.verified) throw Object.assign(new Error('PAYOUT_NOT_VERIFIED'), { code: 'PAYOUT_NOT_VERIFIED' });

      claim.status = CLAIM_STATUS.PAID;
      claim.payoutMicro = amt;
      claim.payoutUsd = fromMicro(amt);
      claim.payoutTxHash = txHash;
      claim.payoutRecipient = recipient || claim.owner;
      claim.paidAt = now();
      claim.timeline = [...(claim.timeline || []), { at: now(), status: CLAIM_STATUS.PAID, note: 'payout verified on chain' }];
      await store.set('claims', claimId, claim);

      // update coverage claimed total
      const cov = await store.get('coverage', claim.coverageId);
      if (cov) {
        cov.claimedMicro = (BigInt(cov.claimedMicro || 0n) + BigInt(amt)).toString();
        cov.status = BigInt(cov.claimedMicro) >= BigInt(cov.coverageAmountMicro) ? COVERAGE_STATUS.CLAIMED : cov.status;
        await store.set('coverage', claim.coverageId, cov);
      }
      await store.set('payouts', claimId, { claimId, coverageId: claim.coverageId, txHash, amountMicro: amt, recipient: claim.owner, verifiedAt: now() });
      await emit({ type: 'PayoutVerified', wallet: claim.owner, claimId, coverageId: claim.coverageId, providerId: claim.providerId, payload: { claimId, txHash, amountMicro: String(amt) } });
      return { claim, payout: claim.payoutUsd };
    }
  });
  if (!claimRes.ok) throw Object.assign(new Error(claimRes.code), { code: claimRes.code });
  return claimRes.result;
}

export async function listClaims(owner) {
  return store.listByOwner('claims', owner);
}

export async function getClaim(claimId, owner) {
  const claim = await store.get('claims', claimId);
  if (!claim) return null;
  if (owner && claim.owner !== String(owner).toLowerCase()) return null;
  return claim;
}
