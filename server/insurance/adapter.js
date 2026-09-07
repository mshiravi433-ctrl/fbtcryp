/**
 * FBT Insurance OS — Provider Adapter interface (§7, §17).
 *
 * The frontend and every engine talk to this interface ONLY. Adding a provider
 * means shipping one adapter that conforms; nothing else in the codebase is
 * rewritten. Every method is async. Adapters are pure by contract: they may
 * call a remote provider API, a local sandbox bookkeeper, or an RPC — but they
 * must never throw untyped errors (return typed results below) and must never
 * fabricate terms/coverage they cannot honour.
 *
 * The server never signs and never broadcasts: purchase paths end at
 * `buildPurchaseTransaction` which returns a PREPARED (unsigned) payload the
 * user's wallet signs and submits (or settles directly to the provider). The
 * adapter also reports the settlement model so the router and UI know whether
 * premiums go straight to the provider contract (DIRECT) or through the FBT
 * router (ROUTED) — see §54 no-custody principle.
 */

export const CHAIN_KIND = { EVM: 'evm', SOLANA: 'solana' };

export class InsuranceAdapterError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'InsuranceAdapterError';
    this.code = code;
    Object.assign(this, extra);
  }
}

/** Structured "not supported / not available" answers — never throw for these. */
export const unsupported = (operation) => ({
  ok: false,
  error: 'OPERATION_NOT_SUPPORTED',
  detail: `adapter does not implement ${operation}`
});

/** The abstract shape every provider adapter must implement. */
export class InsuranceProviderAdapter {
  getProviderInfo() { throw new InsuranceAdapterError('NOT_IMPLEMENTED', `${this.constructor?.name} must implement getProviderInfo`); }
  getProducts() { throw new InsuranceAdapterError('NOT_IMPLEMENTED', `${this.constructor?.name} must implement getProducts`); }
  getQuote(params) { throw new InsuranceAdapterError('NOT_IMPLEMENTED', `${this.constructor?.name} must implement getQuote`); }
  checkEligibility(params) { throw new InsuranceAdapterError('NOT_IMPLEMENTED', `${this.constructor?.name} must implement checkEligibility`); }
  createPurchaseIntent(params) { throw new InsuranceAdapterError('NOT_IMPLEMENTED', `${this.constructor?.name} must implement createPurchaseIntent`); }
  buildPurchaseTransaction(params) { throw new InsuranceAdapterError('NOT_IMPLEMENTED', `${this.constructor?.name} must implement buildPurchaseTransaction`); }
  getCoverage(params) { throw new InsuranceAdapterError('NOT_IMPLEMENTED', `${this.constructor?.name} must implement getCoverage`); }
  submitClaim(params) { throw new InsuranceAdapterError('NOT_IMPLEMENTED', `${this.constructor?.name} must implement submitClaim`); }
  getClaimStatus(params) { throw new InsuranceAdapterError('NOT_IMPLEMENTED', `${this.constructor?.name} must implement getClaimStatus`); }
  getPayout(params) { throw new InsuranceAdapterError('NOT_IMPLEMENTED', `${this.constructor?.name} must implement getPayout`); }
  cancelCoverage(params) { throw new InsuranceAdapterError('NOT_IMPLEMENTED', `${this.constructor?.name} must implement cancelCoverage`); }
  health() { return { ok: true, status: 'HEALTHY', at: Date.now() }; }
}

/** Structural conformance check used by the registry when a provider loads. */
export function assertAdapterShape(adapter, providerId) {
  const required = [
    'getProviderInfo', 'getProducts', 'getQuote', 'checkEligibility',
    'createPurchaseIntent', 'buildPurchaseTransaction', 'getCoverage',
    'submitClaim', 'getClaimStatus', 'getPayout', 'cancelCoverage', 'health'
  ];
  const missing = required.filter((m) => typeof adapter?.[m] !== 'function');
  if (missing.length) {
    throw new InsuranceAdapterError(
      'ADAPTER_INCOMPLETE',
      `provider ${providerId} is missing adapter methods: ${missing.join(', ')}`
    );
  }
  return true;
}
