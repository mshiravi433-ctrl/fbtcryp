/**
 * FBT Insurance OS — Sandbox EVM provider adapter (SIMULATION, §§63/64).
 *
 * NOT a real underwriter. It exercises the full provider-agnostic pipeline
 * (quote → purchase-intent → prepared tx → activation → coverage → claim →
 * payout-verification) against a sandbox ledger in the insurance store, and
 * returns PREPARED (unsigned) EVM payloads. Payout verification is simulated:
 * an independent "indexer" confirms the sandbox tx. No real provider terms,
 * addresses or contracts are invented. Everything this adapter returns is
 * labelled sandbox so no caller can mistake it for a live offer.
 */
import { InsuranceProviderAdapter } from '../adapter.js';
import { fromMicro, toMicro } from '../constants.js';
import { catalogueFor } from '../product-catalog.js';
import { sha256 } from '../quote-engine.js';

const BPS_DIVISOR = 10000n;

export class SandboxEVMProviderAdapter extends InsuranceProviderAdapter {
  constructor({ providerInfo, supportedProducts, supportedChains, opts = {} }) {
    super();
    this.info = providerInfo;
    this.supportedProducts = supportedProducts;
    this.supportedChains = supportedChains;
    this.store = opts.store; // insurance store module
    this.defaultChainId = opts.chainId || supportedChains[0];
  }

  resolveChain(params) { return Number(params.chainId ?? this.defaultChainId); }

  getProviderInfo() { return { ...this.info, sandbox: true, disclaimer: 'Simulated sandbox provider — not a real underwriter.' }; }

  async getProducts() {
    return catalogueFor({ configured: true, supportedChains: this.supportedChains, supportedProducts: this.supportedProducts });
  }

  /** Deterministic sandbox premium. */
  quoteMicro(product, coverageAmountMicro, days) {
    const amt = typeof coverageAmountMicro === 'bigint' ? coverageAmountMicro : toMicro(coverageAmountMicro);
    const rate = BigInt(product?.rateBpsPerDay ?? 3);
    const d = BigInt(days);
    return (amt * rate * d) / BPS_DIVISOR;
  }

  chainProduct(products, params) {
    const chainId = this.resolveChain(params);
    const byId = products.find((p) => p.id === params.productId);
    const byKind = products.filter((p) => p.kind === params.protectionType);
    return (
      (byId && (byId.supportedChains || []).includes(chainId) ? byId : null) ||
      byKind.find((p) => (p.supportedChains || []).includes(chainId)) ||
      byId ||
      byKind[0] ||
      null
    );
  }

  async getQuote(params) {
    const chainId = this.resolveChain(params);
    const products = await this.getProducts();
    const product = this.chainProduct(products, params);
    if (!product) return { ok: false, error: 'PRODUCT_UNAVAILABLE' };
    if (!product.supportedChains.includes(chainId)) return { ok: false, error: 'CHAIN_UNSUPPORTED' };
    const amount = params.coverageAmountMicro ?? params.coverageAmount;
    if (!amount) return { ok: false, error: 'COVERAGE_AMOUNT_REQUIRED' };
    const days = Number(params.durationDays ?? params.duration ?? 30);
    if (!(days >= 1 && days <= 365)) return { ok: false, error: 'DURATION_OUT_OF_RANGE' };
    const premiumMicro = this.quoteMicro(product, amount, days);
    return {
      ok: true,
      premiumMicro,
      productId: product.id,
      estimatedGas: { value: '0x', gasEstimate: 210000, note: 'sandbox estimate' },
      deductibleMicro: params.deductibleMicro ?? null,
      cover: { amountMicro: amount, amountUsd: fromMicro(amount), days }
    };
  }

  async checkEligibility(params) {
    const chainId = this.resolveChain(params);
    const products = await this.getProducts();
    const product = this.chainProduct(products, params);
    if (!product) return { eligible: false, reason: 'PRODUCT_UNAVAILABLE', sandbox: true };
    if (!product.supportedChains.includes(chainId)) return { eligible: false, reason: 'CHAIN_UNSUPPORTED', sandbox: true };
    return { eligible: true, reason: 'OK', sandbox: true, product: product.id };
  }

  async createPurchaseIntent(params) {
    const q = await this.getQuote(params);
    if (!q.ok) return { ok: false, error: q.error };
    const intentId = `sandbox-intent-${params.quoteId}`;
    await this.store.set('provider-ledger', intentId, { kind: 'purchase-intent', params, quote: q, status: 'OPEN', at: Date.now() });
    return { ok: true, intentId, providerReference: sha256({ intentId, provider: this.info.id }) };
  }

  async buildPurchaseTransaction(params) {
    const chainId = this.resolveChain(params);
    const recipientAddress = params.recipient || this.info.sandboxRecipient;
    return {
      ok: true,
      sandbox: true,
      unsigned: true,
      chainId,
      kind: 'erc20-transfer',
      tokenAddress: this.info.sandboxToken || '0x0000000000000000000000000000000000000000',
      recipient: recipientAddress,
      valueMicro: String(params.premiumMicro ?? '0'),
      calldata: '0x',
      to: recipientAddress,
      note: 'Sandbox: simulated premium transfer prepared for wallet signature.',
      reference: { quoteId: params.quoteId, termsHash: params.termsHash, coverageAmountMicro: params.coverageAmountMicro }
    };
  }

  async getCoverage(params) {
    const cov = await this.store.get('coverage', params.coverageId || (params.owner ? `${params.owner}:${params.coverageRef || ''}` : ''));
    if (!cov) return { ok: false, error: 'COVERAGE_NOT_FOUND' };
    return { ok: true, status: cov.status, sandbox: true };
  }

  async submitClaim(params) {
    const claimId = params.claimId;
    await this.store.set('provider-ledger', `claim-${claimId}`, { kind: 'claim', params, status: 'UNDER_REVIEW', at: Date.now() });
    return { ok: true, providerClaimStatus: 'UNDER_REVIEW', sandbox: true };
  }

  async getClaimStatus(params) {
    const row = await this.store.get('provider-ledger', `claim-${params.claimId}`);
    if (!row) return { ok: false, error: 'CLAIM_NOT_FOUND' };
    return { ok: true, status: row.status, sandbox: true };
  }

  async getPayout(params) {
    return { ok: true, sandbox: true, verified: params.payoutVerified === true, note: 'sandbox payout lookup' };
  }

  async cancelCoverage(params) {
    const row = await this.store.get('provider-ledger', `coverage-${params.coverageId}`);
    if (row) { row.status = 'CANCELLED'; await this.store.set('provider-ledger', `coverage-${params.coverageId}`, row); }
    return { ok: true, sandbox: true };
  }

  async health() {
    return { ok: true, status: 'HEALTHY', sandbox: true, at: Date.now() };
  }
}
