/**
 * FBT Insurance OS — Nexus Mutual adapter (STUB, NOT CONFIGURED).
 *
 * Nexus Mutual is the canonical external DeFi protection protocol we want to
 * support first. Per the spec's honesty rule we do NOT invent its API, cover
 * product schema, contract addresses, rates, exclusions or commission terms.
 * Until real, verified Nexus Mutual documentation + programmatic access is
 * integrated, this adapter conforms to the interface but returns
 * `notConfigured` and contributes no products, so the registry keeps it
 * disabled and the marketplace never offers fabricated Nexus cover.
 *
 * To go live: implement each method against the real cover-buying flow
 * (basket/cover products, gbp/usd, product ids, cover period, incident
 * definitions) and flip `configured` only after verification + security review.
 */
import { InsuranceProviderAdapter } from '../adapter.js';

const NOT_CONFIGURED = {
  ok: false,
  notConfigured: true,
  error: 'PROVIDER_NOT_CONFIGURED',
  detail: 'Nexus Mutual adapter is a stub. Real cover products, terms and APIs must be verified before this provider is enabled (§ do-not-invent).'
};

export class NexusMutualAdapter extends InsuranceProviderAdapter {
  constructor(opts = {}) {
    super();
    this.configured = false;
    this.meta = opts;
  }
  getProviderInfo() {
    return {
      providerId: 'nexus-mutual',
      name: 'Nexus Mutual',
      displayName: 'Nexus Mutual',
      status: 'SANDBOX_STUB',
      configured: false,
      supportedChains: [],
      disclaimer: 'Not yet integrated. No live Nexus Mutual cover is offered.'
    };
  }
  async getProducts() { return []; }
  getQuote() { return { ...NOT_CONFIGURED }; }
  checkEligibility() { return { eligible: false, ...NOT_CONFIGURED }; }
  createPurchaseIntent() { return { ...NOT_CONFIGURED }; }
  buildPurchaseTransaction() { return { ...NOT_CONFIGURED }; }
  getCoverage() { return { ...NOT_CONFIGURED }; }
  submitClaim() { return { ...NOT_CONFIGURED }; }
  getClaimStatus() { return { ...NOT_CONFIGURED }; }
  getPayout() { return { ...NOT_CONFIGURED }; }
  cancelCoverage() { return { ...NOT_CONFIGURED }; }
  health() { return { ok: true, status: 'HEALTHY', note: 'stub healthy (no live integration)', at: Date.now() }; }
}
