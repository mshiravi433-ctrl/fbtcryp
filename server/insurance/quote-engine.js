/**
 * FBT Insurance OS — Quote Engine (§6, §4).
 *
 * Wraps an adapter's raw quote into a canonical, expiring quote with a full
 * fee breakdown (§18) and a content-hash of the terms. Quotes are stored and
 * never honoured after `expiresAt`; purchasing always re-validates.
 *
 * quoteId / termsHash use cryptographic hashes for integrity (§46).
 */
import { createHash, randomBytes } from 'node:crypto';
import { fromMicro } from './constants.js';
import { computeFees } from './fee-engine.js';

export const QUOTE_TTL_MS = 15 * 60 * 1000; // 15 min default

export function newId(prefix) {
  return `${prefix}-${randomBytes(6).toString('hex')}`;
}

export function sha256(obj) {
  return createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

/**
 * eligibilityAnswer(provider, products, params) — returns whether a provider
 * will quote a (kind, chain, protocol, asset) with a reason.
 */
export function productEligible(products, params) {
  const chain = params.chainId != null ? Number(params.chainId) : null;
  const byId = (products || []).find((p) => p.id === params.productId);
  const byKind = (products || []).filter((p) => p.kind === params.protectionType);
  // Prefer the product on the requested chain so a matching kind on another
  // chain is never mistaken for coverage here (§6 chainId is part of the quote).
  const product =
    (byId && chain && (byId.supportedChains || []).includes(chain) ? byId : null) ||
    byKind.find((p) => !chain || (p.supportedChains || []).includes(chain)) ||
    byId ||
    (chain ? null : byKind[0]);
  if (!product) return { eligible: false, reason: 'PRODUCT_UNAVAILABLE', product: null };
  if (chain && !(product.supportedChains || []).includes(chain)) {
    return { eligible: false, reason: 'CHAIN_UNSUPPORTED', product };
  }
  return { eligible: true, reason: 'OK', product };
}

/**
 * buildQuote({ provider, product, params, premiumMicro, network, currency,
 *              productTerms }) -> canonical quote.
 */
export function buildQuote({ provider, product, params, premiumMicro, network, currency = 'usdc', productTerms }) {
  const now = Date.now();
  const expiresAt = now + QUOTE_TTL_MS;
  const coverageAmount = params.coverageAmountMicro ?? params.coverageAmount;
  const durationDays = Number(params.durationDays ?? params.duration ?? 30);

  const termsObj = {
    providerId: provider.providerId,
    productId: product?.id || params.productId,
    protectionType: params.protectionType,
    chainId: Number(params.chainId),
    coverageAmountMicro: String(coverageAmount),
    durationDays,
    deductibleMicro: params.deductibleMicro != null ? String(params.deductibleMicro) : undefined,
    exclusions: productTerms?.exclusions || product?.exclusions || [],
    conditions: productTerms?.conditions || product?.conditions || [],
    claimMethod: product?.claimMethod || productTerms?.claimMethod || 'on-chain-proof',
    settlementModel: provider.settlementModel || 'DIRECT'
  };

  const fees = computeFees({ premiumMicro, provider, network });

  return {
    quoteId: newId('q'),
    createdAt: now,
    expiresAt,
    provider: provider.providerId,
    providerName: provider.name,
    providerHealth: provider.healthStatus,
    chainId: Number(params.chainId),
    productId: product?.id || params.productId,
    product: product ? { id: product.id, name: product.name, kind: product.kind, label: product.label } : { id: params.productId },
    protectionType: params.protectionType,
    protocol: params.protocol || null,
    asset: params.asset || null,
    walletAddress: String(params.walletAddress || '').toLowerCase(),
    coverageAmountMicro: coverageAmount,
    coverageAmountUsd: fromMicro(coverageAmount),
    currency,
    durationDays,
    deductibleMicro: params.deductibleMicro ?? null,
    premiumMicro,
    premiumUsd: fromMicro(premiumMicro),
    ...fees,
    exclusions: termsObj.exclusions,
    conditions: termsObj.conditions,
    claimMethod: termsObj.claimMethod,
    estimatedGas: params.estimatedGas ?? null,
    contractAddress: provider.contractAddresses?.[Number(params.chainId)] || provider.contractAddresses?.default || null,
    settlementModel: provider.settlementModel || 'DIRECT',
    termsHash: sha256(termsObj),
    terms: termsObj
  };
}

export function isQuoteValid(quote, now = Date.now()) {
  return !!quote && Number(quote.expiresAt) > now && Number(quote.createdAt) <= now;
}
