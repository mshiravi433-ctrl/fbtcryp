/**
 * FBT Insurance OS — Coverage lifecycle (§3, §14, §44, §54).
 *
 * purchase-intent → prepared (unsigned) tx → (wallet signs + settles directly
 * to provider) → on-chain verification → ACTIVE → monitoring/expiry → renew /
 * cancel / claim. Non-custodial: FBT never holds the premium.
 */
import * as store from './store.js';
import { emit } from './events.js';
import { getProvider, providerAdapter } from './provider-registry.js';
import { isQuoteValid } from './quote-engine.js';
import { toMicro, fromMicro, COVERAGE_STATUS, CHAIN_IDS } from './constants.js';
import { verifyReceipt, receiptAlreadyProcessed } from './indexer.js';
import { getQuote } from './service.js';

export function now() { return Date.now(); }

/** Automatic expiry sweep used by listing/getters. */
export function applyExpiry(cov) {
  if (cov && cov.status === COVERAGE_STATUS.ACTIVE && cov.expiresAt && now() > cov.expiresAt) {
    cov.status = COVERAGE_STATUS.EXPIRED;
    cov.expiredAt = now();
    store.set('coverage', cov.coverageId, cov).catch(() => {});
    emit({ type: 'CoverageExpired', wallet: cov.owner, coverageId: cov.coverageId, providerId: cov.providerId, payload: { coverageId: cov.coverageId } }).catch(() => {});
  }
  return cov;
}

/**
 * Create a purchase intent from a valid quote. Returns the persisted PENDING
 * coverage + the prepared unsigned transaction payload for the wallet.
 */
export async function createPurchaseIntent({ quoteId, walletAddress, idempotencyKey, recipient }) {
  const owner = String(walletAddress || '').toLowerCase();
  if (!owner || !/^0x[a-f0-9]{40}$/.test(owner)) throw Object.assign(new Error('VALID_WALLET_REQUIRED'), { code: 'BAD_WALLET' });

  const key = idempotencyKey || `default-purchase-${quoteId}`;
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(key)) throw Object.assign(new Error('IDEMPOTENCY_KEY_REQUIRED'), { code: 'IDEMPOTENCY_KEY_REQUIRED' });

  const claim = await store.claimIdempotent({
    operation: 'purchase', owner, key, fingerprint: `${owner}:${quoteId}`,
    commit: async () => {
      const res = await getQuote(quoteId);
      if (!res.ok) throw Object.assign(new Error(res.error), { code: res.error });
      const quote = res.quote;
      if (quote.walletAddress && quote.walletAddress !== owner) throw Object.assign(new Error('QUOTE_WALLET_MISMATCH'), { code: 'QUOTE_WALLET_MISMATCH' });
      const provider = getProvider(quote.provider);
      if (!provider) throw Object.assign(new Error('PROVIDER_UNKNOWN'), { code: 'PROVIDER_UNKNOWN' });

      const coverageId = `cov-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const reference = {
        quoteId, providerId: quote.provider, chainId: quote.chainId,
        owner, recipient: recipient || quote.contractAddress || null,
        amountMicro: quote.premiumMicro, termsHash: quote.termsHash
      };
      await store.set('provider-ledger', `reference-${coverageId}`, { ...reference, txHash: null });

      const cov = {
        coverageId,
        owner,
        providerId: quote.provider,
        providerName: quote.providerName,
        quoteId: quote.quoteId,
        termsHash: quote.termsHash,
        protectionType: quote.protectionType,
        productId: quote.productId,
        chainId: quote.chainId,
        asset: quote.asset,
        protocol: quote.protocol,
        coverageAmountMicro: quote.coverageAmountMicro,
        coverageAmountUsd: quote.coverageAmountUsd,
        premiumMicro: quote.premiumMicro,
        premiumUsd: quote.premiumUsd,
        fbtFeeMicro: quote.fbtFeeMicro,
        totalCostMicro: quote.totalCostMicro,
        totalCostUsd: quote.totalCostUsd,
        currency: quote.currency,
        durationDays: quote.durationDays,
        deductibleMicro: quote.deductibleMicro,
        exclusions: quote.exclusions,
        conditions: quote.conditions,
        claimMethod: quote.claimMethod,
        contractAddress: quote.contractAddress,
        settlementModel: quote.settlementModel,
        status: COVERAGE_STATUS.PENDING,
        createdAt: now(),
        startedAt: null,
        expiresAt: null,
        cancelledAt: null,
        txHash: null,
        events: [{ at: now(), to: COVERAGE_STATUS.PENDING, note: 'purchase intent created' }]
      };
      await store.set('coverage', coverageId, cov);
      await store.addToOwnerList('coverage', owner, coverageId);

      const intent = await providerAdapter(quote.provider).createPurchaseIntent({ ...quote, quoteId, coverageAmountMicro: quote.coverageAmountMicro, coverageId, recipient: reference.recipient });
      const tx = await providerAdapter(quote.provider).buildPurchaseTransaction({
        quoteId, termsHash: quote.termsHash, coverageAmountMicro: quote.coverageAmountMicro,
        premiumMicro: quote.premiumMicro, recipient: reference.recipient
      });
      await store.createTx({ owner, type: 'PURCHASE', quoteId, providerId: quote.provider, chainId: quote.chainId, state: 'QUOTE_VALID', payload: { coverageId } });

      await emit({ type: 'CoveragePurchaseStarted', wallet: owner, providerId: quote.provider, quoteId: quote.quoteId, coverageId, payload: { coverageId, quoteId } });
      return { coverageId, quote, prepared: tx, intent };
    }
  });
  if (!claim.ok) throw Object.assign(new Error(claim.code), { code: claim.code });
  return claim.replay ? { coverageId: claim.result.coverageId, replayed: true } : claim.result;
}

/**
 * Mark coverage ACTIVE after independent on-chain verification (§25). In v1
 * sandbox, `txHash` is the simulated receipt and verification is sandbox-mode.
 * Real EVM providers would pass a mined tx hash here.
 */
export async function activateCoverage({ coverageId, owner, txHash, chainId, idempotencyKey }) {
  const cov = await store.get('coverage', coverageId);
  if (!cov) throw Object.assign(new Error('COVERAGE_NOT_FOUND'), { code: 'COVERAGE_NOT_FOUND' });
  if (owner && cov.owner !== String(owner).toLowerCase()) throw Object.assign(new Error('UNAUTHORIZED'), { code: 'UNAUTHORIZED' });
  if (cov.status !== COVERAGE_STATUS.PENDING) return { coverage: applyExpiry(cov), already: cov.status !== COVERAGE_STATUS.PENDING };

  const key = idempotencyKey || `activate-${coverageId}-${txHash}`;
  const claim = await store.claimIdempotent({
    operation: 'activate', owner: cov.owner, key,
    fingerprint: `${coverageId}:${txHash}`,
    commit: async () => {
      if (await receiptAlreadyProcessed(txHash, 'coverage-activation')) {
        // Already verified earlier — do not double-activate.
        cov.status = COVERAGE_STATUS.ACTIVE;
      } else {
        const receipt = await verifyReceipt({
          kind: 'coverage-activation', providerId: cov.providerId, txHash,
          chainId: chainId ?? cov.chainId, owner: cov.owner, recipient: cov.contractAddress,
          amountMicro: cov.premiumMicro, coverageId
        });
        if (!receipt.verified) throw Object.assign(new Error('COVERAGE_NOT_VERIFIED'), { code: 'COVERAGE_NOT_VERIFIED' });
      }
      cov.status = COVERAGE_STATUS.ACTIVE;
      cov.startedAt = now();
      cov.expiresAt = now() + cov.durationDays * 86400000;
      cov.txHash = txHash;
      cov.events = [...(cov.events || []), { at: now(), to: COVERAGE_STATUS.ACTIVE, note: 'on-chain verified' }];
      await store.set('coverage', coverageId, cov);
      await store.set('provider-ledger', `coverage-${coverageId}`, { ...cov, status: 'ACTIVE' });
      // Track in the global active set so incident detection can match it (§22).
      try { const { trackCoverageForIncidents } = await import('./monitoring.js'); await trackCoverageForIncidents(coverageId); } catch { /* non-fatal */ }
      await emit({ type: 'CoverageActivated', wallet: cov.owner, providerId: cov.providerId, coverageId, payload: { coverageId, txHash } });
      return { coverage: cov };
    }
  });
  if (!claim.ok) throw Object.assign(new Error(claim.code), { code: claim.code });
  return claim.replay ? claim.result : claim.result;
}

export async function listCoverages(owner) {
  const rows = await store.listByOwner('coverage', owner);
  rows.forEach(applyExpiry);
  return rows;
}

export async function getCoverage(coverageId, owner) {
  const cov = await store.get('coverage', coverageId);
  if (!cov) return null;
  applyExpiry(cov);
  if (owner && cov.owner !== String(owner).toLowerCase()) return null;
  return cov;
}

export async function cancelCoverage({ coverageId, owner }) {
  const cov = await getCoverage(coverageId, owner);
  if (!cov) throw Object.assign(new Error('COVERAGE_NOT_FOUND'), { code: 'COVERAGE_NOT_FOUND' });
  if (![COVERAGE_STATUS.ACTIVE, COVERAGE_STATUS.PENDING].includes(cov.status)) {
    throw Object.assign(new Error('COVERAGE_NOT_CANCELLABLE'), { code: 'COVERAGE_NOT_CANCELLABLE' });
  }
  cov.status = COVERAGE_STATUS.CANCELLED;
  cov.cancelledAt = now();
  cov.events = [...(cov.events || []), { at: now(), to: COVERAGE_STATUS.CANCELLED, note: 'user cancelled' }];
  await store.set('coverage', coverageId, cov);
  await providerAdapter(cov.providerId).cancelCoverage({ coverageId }).catch(() => {});
  return cov;
}

export async function renewCoverage({ coverageId, owner, durationDays, idempotencyKey }) {
  const cov = await getCoverage(coverageId, owner);
  if (!cov) throw Object.assign(new Error('COVERAGE_NOT_FOUND'), { code: 'COVERAGE_NOT_FOUND' });
  const key = idempotencyKey || `renew-${coverageId}`;
  const claim = await store.claimIdempotent({
    operation: 'renew', owner: cov.owner, key, fingerprint: `${coverageId}:${durationDays}`,
    commit: async () => {
      cov.status = COVERAGE_STATUS.ACTIVE;
      cov.startedAt = now();
      cov.expiresAt = now() + Number(durationDays) * 86400000;
      cov.events = [...(cov.events || []), { at: now(), to: COVERAGE_STATUS.ACTIVE, note: 'renewed' }];
      await store.set('coverage', coverageId, cov);
      return { coverage: cov };
    }
  });
  if (!claim.ok) throw Object.assign(new Error(claim.code), { code: claim.code });
  return claim.result;
}

/** Dashboard aggregates used by UI header (§ dashboard mock numbers replaced by real data). */
export async function dashboard(owner) {
  const rows = await listCoverages(owner);
  const active = rows.filter((c) => c.status === COVERAGE_STATUS.ACTIVE);
  const totalProtected = active.reduce((a, c) => a + BigInt(c.coverageAmountMicro || 0), 0n);
  const totalPremium = rows.filter((c) => c.status !== COVERAGE_STATUS.CANCELLED)
    .reduce((a, c) => a + BigInt(c.totalCostMicro || c.premiumMicro || 0), 0n);
  return {
    owner,
    totalProtectedUsd: fromMicro(totalProtected),
    activeCovers: active.length,
    totalPremiumUsd: fromMicro(totalPremium),
    active
  };
}
