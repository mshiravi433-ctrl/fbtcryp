/**
 * Iranian USDT buy — server-only deployment contract.
 *
 * This is intentionally a *capability* rather than a browser feature flag.
 * `IRAN_BUY_ENABLED=true` is necessary, but is never sufficient to expose a
 * payment surface. A deployment has to prove durable storage, one approved
 * EVM-compatible network, a known USDT contract, and a documented payment /
 * settlement contract first. No value in this module is sent to the browser
 * except the tiny object returned by publicIranBuyCapability().
 */
import { getAddress, isAddress } from 'ethers';
import { EVM_CHAINS } from './chainsLite.js';
import { upstashConfigured } from './blobCache.js';

export const IRAN_BUY_SCHEMA = 'fbt.iran-buy.v1';
export const IRAN_BUY_ASSET = 'USDT';
export const IRAN_BUY_SYMBOL = 'USDTTMN';

const YES = new Set(['1', 'true', 'yes', 'on']);
const NO = new Set(['0', 'false', 'no', 'off', '']);
const env = (key) => String(process.env[key] || '').trim();
const enabled = (key) => YES.has(env(key).toLowerCase());

function configuredInteger(key, { min = 0, max = Number.MAX_SAFE_INTEGER, required = true } = {}) {
  const raw = env(key);
  if (!raw && !required) return null;
  if (!/^\d+$/.test(raw)) return null;
  try {
    const value = BigInt(raw);
    if (value < BigInt(min) || value > BigInt(max)) return null;
    return value;
  } catch { return null; }
}

function canonicalEvmAddress(value) {
  if (!isAddress(value)) return null;
  try { return getAddress(value); } catch { return null; }
}

function safeHttpsOrigin(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
    return url;
  } catch { return null; }
}

function normalizeNetwork(value) {
  const candidate = String(value || '').trim().toUpperCase();
  return /^[A-Z0-9_-]{2,32}$/.test(candidate) ? candidate : null;
}

function configuredWalletFamily() {
  const family = env('IRAN_BUY_WALLET_FAMILY').toUpperCase();
  return family === 'EVM' ? family : null;
}

/**
 * Return the *internal* config and its fail-closed prerequisite list. The
 * list is deliberately not sent to an untrusted browser: it is an operational
 * deployment checklist, not a way to enumerate credentials/configuration.
 */
export function iranBuyConfig() {
  const requested = enabled('IRAN_BUY_ENABLED');
  const apiBase = safeHttpsOrigin(env('WALLEX_API_BASE_URL'));
  const apiKey = env('WALLEX_API_KEY');
  const networkId = normalizeNetwork(env('IRAN_BUY_USDT_NETWORK'));
  const networkApproved = enabled('IRAN_BUY_NETWORK_APPROVED');
  const walletFamily = configuredWalletFamily();
  const chainIdBig = configuredInteger('IRAN_BUY_EVM_CHAIN_ID', { min: 1, max: 9_007_199_254_740_991 });
  const chainId = chainIdBig == null ? null : Number(chainIdBig);
  const chain = chainId ? EVM_CHAINS[chainId] : null;
  const tokenContract = canonicalEvmAddress(env('IRAN_BUY_USDT_TOKEN_CONTRACT'));
  const tokenDecimalsBig = configuredInteger('IRAN_BUY_USDT_DECIMALS', { min: 0, max: 36 });
  const tokenDecimals = tokenDecimalsBig == null ? null : Number(tokenDecimalsBig);
  const minToman = configuredInteger('IRAN_BUY_MIN_TOMAN', { min: 1 });
  const maxToman = configuredInteger('IRAN_BUY_MAX_TOMAN', { min: 1 });
  const paymentAdapter = env('IRAN_BUY_PAYMENT_ADAPTER');
  const paymentCallbackUrl = safeHttpsOrigin(env('IRAN_BUY_PAYMENT_CALLBACK_URL'));
  const paymentWebhookSecret = env('IRAN_BUY_PAYMENT_WEBHOOK_SECRET');
  const paymentContractVerified = enabled('IRAN_BUY_PAYMENT_CONTRACT_VERIFIED');
  const withdrawalContractVerified = enabled('IRAN_BUY_WALLEX_WITHDRAWAL_LIFECYCLE_VERIFIED');
  const settlementApproved = enabled('IRAN_BUY_SETTLEMENT_RECONCILIATION_APPROVED');
  const minConfirmationsBig = configuredInteger('IRAN_BUY_MIN_CONFIRMATIONS', { min: 1, max: 100, required: false });
  const minConfirmations = minConfirmationsBig == null ? 3 : Number(minConfirmationsBig);
  const rateLimitBig = configuredInteger('IRAN_BUY_ORDER_RATE_LIMIT', { min: 1, max: 60, required: false });
  const rateLimit = rateLimitBig == null ? 10 : Number(rateLimitBig);
  const approvedPaymentHosts = env('IRAN_BUY_APPROVED_PAYMENT_HOSTS')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => /^[a-z0-9.-]+$/.test(value));

  const prerequisites = [];
  if (!requested) prerequisites.push('IRAN_BUY_DISABLED');
  if (!apiBase || apiBase.origin !== 'https://api.wallex.ir') prerequisites.push('WALLEX_API_BASE_URL_REQUIRED');
  if (apiKey.length < 20) prerequisites.push('WALLEX_API_KEY_REQUIRED');
  if (!networkId || !networkApproved) prerequisites.push('APPROVED_USDT_NETWORK_REQUIRED');
  if (walletFamily !== 'EVM') prerequisites.push('EVM_WALLET_BINDING_REQUIRED');
  if (!chain) prerequisites.push('APPROVED_EVM_CHAIN_REQUIRED');
  if (!tokenContract || tokenDecimals == null) prerequisites.push('VERIFIED_USDT_TOKEN_CONTRACT_REQUIRED');
  if (minToman == null || maxToman == null || minToman > maxToman) prerequisites.push('TOMAN_LIMITS_REQUIRED');
  if (!upstashConfigured()) prerequisites.push('UPSTASH_ATOMIC_IDEMPOTENCY_REQUIRED');

  /*
   * A Wallex exchange API key is not an end-user payment rail. The public
   * Wallex API reference documents OTC trading and a withdrawal request, but
   * does not document a merchant checkout, customer-payment authorization, or
   * a signed payment callback for this product. Do not weaken either guard by
   * setting an environment variable: a real, reviewed adapter must replace
   * this blocker before a production deployment can be exposed.
   */
  if (paymentAdapter !== 'IMPLEMENTED_REVIEWED_PROVIDER'
    || !paymentCallbackUrl
    || paymentWebhookSecret.length < 32
    || !paymentContractVerified
    || approvedPaymentHosts.length === 0) {
    prerequisites.push('PAYMENT_COLLECTION_ADAPTER_REQUIRED');
  }
  /* There is intentionally no generic checkout/callback implementation in
     this repository. A string in an environment variable must never turn an
     unspecified merchant API into a live money-moving integration. */
  prerequisites.push('PAYMENT_COLLECTION_ADAPTER_NOT_IMPLEMENTED');
  if (!withdrawalContractVerified || !settlementApproved) {
    prerequisites.push('WALLEX_WITHDRAWAL_RECONCILIATION_REQUIRED');
  }
  /*
   * The documented OTC create endpoint has no documented client idempotency
   * or max-cost field. A timeout after submission cannot safely be retried,
   * and an OTC buy cannot be exposed against a customer payment until Wallex
   * documents a bounded-execution contract or the reviewed payment adapter
   * supplies an equivalent treasury/cost safeguard.
   */
  prerequisites.push('WALLEX_OTC_COST_CAP_CONTRACT_REQUIRED');

  const available = prerequisites.length === 0;
  return {
    requested,
    available,
    prerequisites,
    wallex: {
      apiBase: apiBase?.origin || null,
      apiKey,
      symbol: IRAN_BUY_SYMBOL
    },
    asset: IRAN_BUY_ASSET,
    network: {
      id: networkId,
      label: env('IRAN_BUY_USDT_NETWORK_LABEL') || networkId,
      walletFamily: walletFamily || 'UNSUPPORTED',
      chainId,
      chainName: chain?.name || null,
      tokenContract,
      tokenDecimals
    },
    limits: {
      minToman: minToman?.toString() || null,
      maxToman: maxToman?.toString() || null
    },
    payment: {
      adapter: paymentAdapter || null,
      callbackConfigured: Boolean(paymentCallbackUrl && paymentWebhookSecret),
      approvedPaymentHosts
    },
    settlement: { minConfirmations },
    rateLimit
  };
}

/** The only configuration that may cross the server/browser boundary. */
export function publicIranBuyCapability() {
  const config = iranBuyConfig();
  if (!config.available) {
    return {
      schema: IRAN_BUY_SCHEMA,
      enabled: false,
      asset: null,
      network: null,
      limits: null,
      requiresTelegramAuth: true
    };
  }
  return {
    schema: IRAN_BUY_SCHEMA,
    enabled: true,
    asset: IRAN_BUY_ASSET,
    network: {
      id: config.network.id,
      label: config.network.label,
      walletFamily: config.network.walletFamily,
      chainId: config.network.chainId,
      chainName: config.network.chainName
    },
    limits: config.limits,
    requiresTelegramAuth: true
  };
}

export function validIranBuyToman(value, config = iranBuyConfig()) {
  const raw = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : String(value ?? '').trim();
  if (!/^[1-9]\d{0,17}$/.test(raw)) return { ok: false, code: 'AMOUNT_INVALID' };
  let amount;
  try { amount = BigInt(raw); } catch { return { ok: false, code: 'AMOUNT_INVALID' }; }
  if (config.limits.minToman == null || config.limits.maxToman == null) return { ok: false, code: 'IRAN_BUY_DISABLED' };
  if (amount < BigInt(config.limits.minToman)) return { ok: false, code: 'AMOUNT_BELOW_MINIMUM' };
  if (amount > BigInt(config.limits.maxToman)) return { ok: false, code: 'AMOUNT_ABOVE_MAXIMUM' };
  return { ok: true, amount: amount.toString() };
}

/** Never infer another network or silently alter a browser-supplied address. */
export function validateIranBuyEvmDestination(address, chainId, config = iranBuyConfig()) {
  if (config.network.walletFamily !== 'EVM' || !config.network.chainId || !config.network.tokenContract) {
    return { ok: false, code: 'WALLET_NETWORK_INCOMPATIBLE' };
  }
  if (Number(chainId) !== Number(config.network.chainId)) return { ok: false, code: 'WALLET_NETWORK_INCOMPATIBLE' };
  const canonical = canonicalEvmAddress(String(address || '').trim());
  return canonical ? { ok: true, address: canonical, chainId: config.network.chainId } : { ok: false, code: 'WALLET_ADDRESS_INVALID' };
}

export function isIranBuyFeatureRequested() {
  return enabled('IRAN_BUY_ENABLED');
}

/* Kept private to this module so a malformed false-ish env value is never
   interpreted as authorization elsewhere. Exported only for focused probes. */
export const __iranBuyFalseValues = NO;
