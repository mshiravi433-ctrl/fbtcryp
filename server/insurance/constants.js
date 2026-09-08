/**
 * FBT Insurance OS — shared constants.
 *
 * Amounts are integer base-6 micro-units (1e6) of the settlement token. Never
 * use floating point for money (§46). Base-6 matches USDC/USDT on most EVM
 * chains; the adapter/coverage layer stores `tokenAddress` and per-chain
 * decimals separately and normalises to integer units of that token.
 */

export const MICRO = 1_000_000n; // 1 token == 1e6 micro-units (USDC-style)

/** Normalise a human decimal amount string/number to integer micro-units. */
export function toMicro(value) {
  if (value === null || value === undefined || value === '') return null;
  const s = typeof value === 'bigint' ? value.toString() : String(value).trim();
  if (!/^[+]?(\d+(\.\d{0,6})?|\.\d{1,6})$/.test(s)) return null;
  const [intPart, frac = ''] = s.split('.');
  const fracPadded = frac.padEnd(6, '0');
  return BigInt(intPart) * MICRO + BigInt(fracPadded || '0');
}

/** Format integer micro-units back to a human decimal string. */
export function fromMicro(bigint) {
  const n = typeof bigint === 'bigint' ? bigint : BigInt(bigint);
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const intPart = abs / MICRO;
  const frac = (abs % MICRO).toString().padStart(6, '0').replace(/0+$/, '');
  const body = frac ? `${intPart}.${frac}` : `${intPart}`;
  return (neg ? '-' : '') + body;
}

/**
 * Parse a value that is ALREADY in micro-units (bigint, integer number, or
 * integer string). Human decimals ("12.50") still go through `toMicro`.
 * Named *Micro fields must never be re-scaled as dollars.
 */
export function parseMicro(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    if (Number.isInteger(value)) return BigInt(value);
    return toMicro(value);
  }
  const s = String(value).trim();
  if (/^[+-]?\d+$/.test(s)) return BigInt(s);
  return toMicro(s);
}

/**
 * Recursively convert BigInt money values to decimal strings so the object is
 * JSON-serialisable. Durable store, HTTP, and sha256 all go through JSON and
 * Node throws "Do not know how to serialize a BigInt" otherwise.
 */
export function jsonSafe(value) {
  if (typeof value === 'bigint') return value.toString();
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) out[k] = jsonSafe(value[k]);
    return out;
  }
  return value;
}

/** JSON.stringify that never throws on BigInt (strings the integer). */
export function jsonStringify(value) {
  return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
}

/** Protection / exposure categories exposed to users & providers. */
export const PROTECTION_TYPES = [
  { id: 'smart-contract', label: 'Smart Contract', riskKind: 'smartContract' },
  { id: 'bridge', label: 'Bridge', riskKind: 'bridge' },
  { id: 'stablecoin', label: 'Stablecoin / Depeg', riskKind: 'stablecoin' },
  { id: 'lending', label: 'Lending', riskKind: 'lending' },
  { id: 'lp', label: 'LP Position', riskKind: 'lp' },
  { id: 'wallet', label: 'Wallet / Custody', riskKind: 'wallet' },
  { id: 'oracle', label: 'Oracle', riskKind: 'oracle' },
  { id: 'defi-protocol', label: 'DeFi Protocol', riskKind: 'protocol' }
];

export const CHAIN_IDS = {
  ethereum: 1,
  bsc: 56,
  polygon: 137,
  arbitrum: 42161,
  optimism: 10,
  base: 8453,
  avalanche: 43114,
  linea: 59144,
  solana: 900 // FBT-internal id for Solana cluster
};

/** Risk bands (human labels + numeric weight for ranking). */
export const RISK_BANDS = { LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH', CRITICAL: 'CRITICAL' };

export const COVERAGE_STATUS = {
  PENDING: 'PENDING', // purchase intent created, awaiting signature/confirmation
  ACTIVE: 'ACTIVE',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
  CLAIMED: 'CLAIMED',
  PARTIALLY_PAID: 'PARTIALLY_PAID',
  FAILED: 'FAILED'
};

export const CLAIM_STATUS = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  UNDER_REVIEW: 'UNDER_REVIEW',
  ADDITIONAL_INFORMATION_REQUIRED: 'ADDITIONAL_INFORMATION_REQUIRED',
  APPROVED: 'APPROVED',
  PARTIALLY_APPROVED: 'PARTIALLY_APPROVED',
  REJECTED: 'REJECTED',
  PAID: 'PAID',
  CANCELLED: 'CANCELLED',
  DISPUTED: 'DISPUTED'
};

export const TX_STATE = {
  CREATED: 'CREATED',
  QUOTE_VALID: 'QUOTE_VALID',
  AWAITING_SIGNATURE: 'AWAITING_SIGNATURE',
  SIGNED: 'SIGNED',
  SUBMITTED: 'SUBMITTED',
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  FAILED: 'FAILED',
  EXPIRED: 'EXPIRED',
  REPLACED: 'REPLACED'
};

export const PROVIDER_STATUS = { HEALTHY: 'HEALTHY', DEGRADED: 'DEGRADED', UNAVAILABLE: 'UNAVAILABLE', UNKNOWN: 'UNKNOWN' };

export const INCIDENT_SEVERITY = { INFO: 'INFO', LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH', CRITICAL: 'CRITICAL' };

export const PAYMENT_METHODS = ['usdc', 'usdt', 'native', 'fbt-token'];

/** Insurance event names (§37). */
export const INSURANCE_EVENTS = Object.freeze([
  'InsuranceQuoteCreated',
  'InsuranceQuoteExpired',
  'CoveragePurchaseStarted',
  'CoverageActivated',
  'CoverageExpired',
  'IncidentDetected',
  'ClaimCreated',
  'ClaimSubmitted',
  'ClaimUpdated',
  'ClaimApproved',
  'ClaimRejected',
  'PayoutDetected',
  'PayoutVerified',
  'ProviderHealthChanged',
  'InsuranceFeeCollected',
  'CommissionRecorded'
]);
