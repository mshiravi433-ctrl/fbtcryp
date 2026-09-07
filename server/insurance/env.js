/**
 * FBT Insurance OS — Production environment & feature flags (§3 of the
 * production activation spec).
 *
 * Single source of truth for provider enablement, fee configuration and the
 * hard production-safety switches. Rules enforced here:
 *
 *  - Secrets (INSURACE_API_CODE, RPC URLs, admin keys) are read from the
 *    environment ONLY. They are never baked into source, never sent to the
 *    frontend, never logged.
 *  - Sandbox providers exist ONLY outside production. Asking for one in
 *    production throws SANDBOX_PROVIDER_DISABLED_IN_PRODUCTION.
 *  - Fees default to EXACT ZERO. A non-zero FBT fee must be configured
 *    deliberately by the operator and is always displayed before signing.
 *  - Custody, auto-purchase and the internal protection pool are hard-disabled
 *    defaults; enabling them requires an explicit env decision (and the pool
 *    additionally requires its legal/audit milestones, so it stays inert).
 */

const bool = (v, dflt = false) => {
  if (v === undefined || v === null || v === '') return dflt;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
};

const list = (v) => String(v || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const int = (v, dflt = 0) => {
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : dflt;
};

export const NODE_ENV = String(process.env.NODE_ENV || 'development').toLowerCase();
export const isProduction = NODE_ENV === 'production';
export const isTest = NODE_ENV === 'test' || bool(process.env.FBT_TEST);

/* ------------------------------ Nexus Mutual ------------------------------ */
export const NEXUS_ENABLED = bool(process.env.NEXUS_ENABLED, true);
export const NEXUS_API_BASE_URL = (process.env.NEXUS_API_BASE_URL || 'https://api.nexusmutual.io').replace(/\/+$/, '');
/** EVM chain ids Nexus cover may be bought on (allowlist; default: Ethereum mainnet only). */
export const NEXUS_CHAIN_ALLOWLIST = list(process.env.NEXUS_CHAIN_ALLOWLIST || '1').map(Number);
/** Restrict discovery to these Nexus product ids when set (operator allowlist). */
export const NEXUS_PRODUCT_IDS = list(process.env.NEXUS_PRODUCT_IDS).map(Number).filter(Number.isFinite);
/** Terms acceptance is mandatory before purchase preparation. */
export const NEXUS_TERMS_REQUIRED = bool(process.env.NEXUS_TERMS_REQUIRED, true);
/** Proof-of-Stake (whitelisted validator) cover — off until separately reviewed. */
export const NEXUS_POS_ENABLED = bool(process.env.NEXUS_POS_ENABLED, false);

/* -------------------------------- InsurAce -------------------------------- */
export const INSURACE_ENABLED = bool(process.env.INSURACE_ENABLED, false);
export const INSURACE_API_BASE_URL = (process.env.INSURACE_API_BASE_URL || 'https://api.insurace.io/ops/v1').replace(/\/+$/, '');
/**
 * InsurAce access key. SECRET: environment only — never source, never bundle,
 * never logs. The docs' public key may be used for low-volume integration
 * testing; request a dedicated key before production traffic.
 */
export const INSURACE_API_CODE = process.env.INSURACE_API_CODE || '';
export const INSURACE_CHAIN_ALLOWLIST = list(process.env.INSURACE_CHAIN_ALLOWLIST || 'ETH,BSC,POLYGON,AVALANCHE');
/**
 * InsurAce Cover contract addresses per chain. The official docs require
 * integrators to obtain these from the InsurAce team — they are NOT published
 * constants, so FBT reads them from operator-verified env configuration and
 * keeps purchase NOT_CONFIGURED until then.
 */
export const INSURACE_COVER_CONTRACTS = {
  ETH: process.env.INSURACE_COVER_CONTRACT_ADDRESS_ETH || '',
  BSC: process.env.INSURACE_COVER_CONTRACT_ADDRESS_BSC || '',
  POLYGON: process.env.INSURACE_COVER_CONTRACT_ADDRESS_POLYGON || '',
  AVALANCHE: process.env.INSURACE_COVER_CONTRACT_ADDRESS_AVALANCHE || ''
};

/* -------------------------- OpenCover registry ---------------------------- */
export const OPENCOVER_REGISTRY_ENABLED = bool(process.env.OPENCOVER_REGISTRY_ENABLED, true);

/* ---------------------------------- Fees ---------------------------------- */
/**
 * FBT marketplace fee. DEFAULT ZERO — displayed to the user as "FBT
 * Marketplace Fee: $0". A non-zero value is a deliberate operator decision
 * (e.g. after a real distribution agreement) and is always shown pre-signature.
 */
export const FBT_INSURANCE_FEE_BPS = Math.max(0, int(process.env.FBT_INSURANCE_FEE_BPS, 0));
/** Optional flat fee in micro-units (1e6) charged on top, default zero. */
export const FBT_INSURANCE_FLAT_FEE_MICRO = BigInt(process.env.FBT_INSURANCE_FLAT_FEE_MICRO || '0');
/**
 * Provider commission. NEVER assumed: recorded only when a real agreement
 * exists (env-configured per provider), otherwise exactly zero/none.
 */
export const FBT_PROVIDER_COMMISSION_BPS = Math.max(0, int(process.env.FBT_PROVIDER_COMMISSION_BPS, 0));

/* --------------------- Hard production-safety switches -------------------- */
export const FBT_PROTECTION_POOL_ENABLED = bool(process.env.FBT_PROTECTION_POOL_ENABLED, false);
export const INSURANCE_AUTO_PURCHASE = bool(process.env.INSURANCE_AUTO_PURCHASE, false);
export const INSURANCE_CUSTODY_ENABLED = bool(process.env.INSURANCE_CUSTODY_ENABLED, false);

/* --------------------------- Chain / RPC / misc --------------------------- */
/** RPC used ONLY for independent receipt verification (eth_getTransactionReceipt). */
export const INSURANCE_RPC_URLS = list(process.env.INSURANCE_RPC_URLS);
/** Confirmations required before coverage activation (EVM). */
export const EVM_CONFIRMATIONS = Math.max(1, int(process.env.EVM_CONFIRMATIONS, 1));
export const PROVIDER_HTTP_TIMEOUT_MS = Math.max(1_000, int(process.env.INSURANCE_PROVIDER_TIMEOUT_MS, 8_000));
/** Quoted data older than this is flagged STALE in UI + API freshness. */
export const FRESHNESS_TTL_MS = Math.max(15_000, int(process.env.INSURANCE_FRESHNESS_TTL_MS, 120_000));

/** Admin ops (emergency pause, claim ops). In production this MUST be a
 *  multisig-operated key rotation process; a missing key disables the routes. */
export const INSURANCE_ADMIN_KEY = process.env.INSURANCE_ADMIN_KEY || '';

/**
 * The production gate: sandbox providers are structurally impossible in
 * production. Every sandbox registration path calls this first.
 */
export function assertNoSandboxInProduction(what = 'sandbox provider') {
  if (isProduction) {
    const err = new Error(`SANDBOX_PROVIDER_DISABLED_IN_PRODUCTION: refusing to register ${what} while NODE_ENV=production`);
    err.code = 'SANDBOX_PROVIDER_DISABLED_IN_PRODUCTION';
    throw err;
  }
}

/** Honest status roll-up used by /provider-health and the status report. */
export function productionSafetySnapshot() {
  return {
    nodeEnv: NODE_ENV,
    sandboxAllowed: !isProduction,
    custody: INSURANCE_CUSTODY_ENABLED ? 'ENABLED' : 'DISABLED',
    autoPurchase: INSURANCE_AUTO_PURCHASE ? 'ENABLED' : 'DISABLED',
    protectionPool: FBT_PROTECTION_POOL_ENABLED ? 'ENABLED' : 'DISABLED',
    fbtMarketplaceFeeBps: FBT_INSURANCE_FEE_BPS,
    fbtMarketplaceFlatFeeMicro: FBT_INSURANCE_FLAT_FEE_MICRO.toString(),
    providerCommissionBps: FBT_PROVIDER_COMMISSION_BPS,
    secretsInBundle: false
  };
}
