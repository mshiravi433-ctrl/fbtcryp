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

/**
 * A payment return address is a full URL, not just an origin. It must carry no
 * query or fragment of its own: the PSP appends `?Authority=…&Status=…`, and a
 * pre-existing query string is exactly where a return URL silently breaks.
 */
function safeHttpsUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
    if (url.pathname.length > 200) return null;
    return url;
  } catch { return null; }
}

function merchantUuid(value) {
  const raw = String(value || '').trim();
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(raw) ? raw.toLowerCase() : null;
}

function normalizeNetwork(value) {
  const candidate = String(value || '').trim().toUpperCase();
  return /^[A-Z0-9_-]{2,32}$/.test(candidate) ? candidate : null;
}

/* ── Referral mode (bitpin deep link) ────────────────────────────────────── */
/*
 * While the direct rail is off, the tab may hand Persian users a deep link to
 * a partner exchange instead. This is deliberately a *display-only* surface:
 * the link is copied verbatim from the partner's affiliate panel (query string
 * included — that is usually where the invite code lives), and this module
 * only checks the transport before it is allowed to cross to the browser:
 * https, no embedded credentials, an exact host from a short allowlist, and a
 * bounded length. No parameter is ever added, removed or rewritten here — a
 * silently "normalized" link could break attribution or point somewhere the
 * operator never approved. Anything else keeps `referral` null and the tab
 * renders exactly as before.
 */
const IRAN_BUY_REFERRAL_URL_MAX_LENGTH = 500;
const IRAN_BUY_REFERRAL_PATH_MAX_LENGTH = 200;
const IRAN_BUY_REFERRAL_NOTE_MAX_LENGTH = 140;
const IRAN_BUY_REFERRAL_PARTNERS = new Set(['BITPIN']);

function approvedReferralHosts() {
  const raw = env('IRAN_BUY_REFERRAL_APPROVED_HOSTS') || 'bitpin.ir';
  const hosts = raw
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => /^[a-z0-9.-]+$/.test(value));
  return [...new Set(hosts)];
}

function safeReferralUrl(value, approvedHosts) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > IRAN_BUY_REFERRAL_URL_MAX_LENGTH || !approvedHosts.length) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    if (url.pathname.length > IRAN_BUY_REFERRAL_PATH_MAX_LENGTH) return null;
    if (!approvedHosts.includes(url.hostname.toLowerCase())) return null;
    return url.toString();
  } catch { return null; }
}

function referralDiscountNote(value) {
  const raw = String(value || '').replace(/\s+/g, ' ').trim();
  if (!raw || raw.length > IRAN_BUY_REFERRAL_NOTE_MAX_LENGTH) return null;
  return raw;
}

/**
 * The withdrawal network a Persian user must pick *inside the partner
 * exchange*. In referral mode the direct-rail network config is normally
 * absent, so the referral block carries its own, with an explicit fallback
 * chain: a referral-specific value, then the direct-rail network, then ERC20.
 * ERC20 is the safe default because the destination is always the user's own
 * EVM address — a wrong-but-EVM chain is recoverable, a non-EVM one is not.
 */
function referralNetwork() {
  const id = normalizeNetwork(env('IRAN_BUY_REFERRAL_USDT_NETWORK'))
    || normalizeNetwork(env('IRAN_BUY_USDT_NETWORK'))
    || 'ERC20';
  const label = String(env('IRAN_BUY_REFERRAL_USDT_NETWORK_LABEL') || env('IRAN_BUY_USDT_NETWORK_LABEL') || id).trim();
  const chainIdBig = configuredInteger('IRAN_BUY_REFERRAL_EVM_CHAIN_ID', { min: 1, max: 9_007_199_254_740_991, required: false });
  return { id, label: label.slice(0, 60), chainId: chainIdBig == null ? null : Number(chainIdBig) };
}

/** null unless partner + link + allowlist all agree; null means "render nothing". */
export function publicIranBuyReferral() {
  if (!IRAN_BUY_REFERRAL_PARTNERS.has(env('IRAN_BUY_REFERRAL_PARTNER').toUpperCase())) return null;
  const url = safeReferralUrl(env('IRAN_BUY_REFERRAL_URL'), approvedReferralHosts());
  if (!url) return null;
  return {
    partner: 'bitpin',
    url,
    discountNote: referralDiscountNote(env('IRAN_BUY_REFERRAL_DISCOUNT_NOTE')),
    network: referralNetwork()
  };
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
  const paymentAdapter = env('IRAN_BUY_PAYMENT_ADAPTER').toUpperCase();
  const paymentCallbackUrl = safeHttpsUrl(env('IRAN_BUY_PAYMENT_CALLBACK_URL'));
  const paymentContractVerified = enabled('IRAN_BUY_PAYMENT_CONTRACT_VERIFIED');
  const zarinpalMerchantId = merchantUuid(env('ZARINPAL_MERCHANT_ID'));
  const zarinpalApiBase = safeHttpsOrigin(env('ZARINPAL_API_BASE_URL') || 'https://payment.zarinpal.com');
  const zarinpalCheckoutBase = safeHttpsOrigin(env('ZARINPAL_CHECKOUT_BASE_URL') || 'https://payment.zarinpal.com');
  const slippageBpsBig = configuredInteger('IRAN_BUY_MAX_SLIPPAGE_BPS', { min: 1, max: 500, required: false });
  const maxSlippageBps = slippageBpsBig == null ? null : Number(slippageBpsBig);
  const costCapAcknowledged = enabled('IRAN_BUY_TREASURY_COST_CAP_ACKNOWLEDGED');
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
   * A Wallex exchange API key is not an end-user payment rail: the documented
   * OTC endpoints trade the *operator* account. Collecting Toman from a
   * customer therefore needs a separate, real PSP contract. The reviewed
   * adapter for that is server/providers/iranZarinpal.js, implementing
   * ZarinPal's published request/StartPay/verify contract.
   *
   * Every element below is required, and none of them is a free-text promise:
   * a merchant id must be a real UUID, the return URL must be an exact https
   * URL with no query of its own, and the hosted checkout host must be listed
   * explicitly in the approved-host allowlist that the browser is redirected
   * to.
   */
  const paymentCheckoutHost = zarinpalCheckoutBase?.hostname?.toLowerCase() || null;
  const paymentAdapterReady = paymentAdapter === 'ZARINPAL'
    && Boolean(zarinpalMerchantId)
    && Boolean(zarinpalApiBase)
    && Boolean(zarinpalCheckoutBase)
    && Boolean(paymentCallbackUrl)
    && paymentContractVerified
    && Boolean(paymentCheckoutHost)
    && approvedPaymentHosts.includes(paymentCheckoutHost);
  if (!paymentAdapterReady) prerequisites.push('PAYMENT_COLLECTION_ADAPTER_REQUIRED');
  if (!withdrawalContractVerified || !settlementApproved) {
    prerequisites.push('WALLEX_WITHDRAWAL_RECONCILIATION_REQUIRED');
  }
  /*
   * The documented OTC create endpoint has no client max-cost field, so the
   * price can move between the quote that priced the customer's order and the
   * execution. Bounded execution is therefore enforced here instead: an order
   * is only executable while the live provider quote is within
   * IRAN_BUY_MAX_SLIPPAGE_BPS of the price the customer was quoted, and the
   * operator must acknowledge that the remaining spread is absorbed by the
   * treasury (see docs/IRAN-BUY-WALLEX-READINESS.md). Without both, the
   * feature stays closed.
   */
  if (maxSlippageBps == null || !costCapAcknowledged) {
    prerequisites.push('WALLEX_OTC_COST_CAP_CONTRACT_REQUIRED');
  }

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
      provider: paymentAdapter === 'ZARINPAL' ? 'zarinpal' : null,
      merchantId: zarinpalMerchantId,
      apiBase: zarinpalApiBase?.origin || null,
      checkoutBase: zarinpalCheckoutBase?.origin || null,
      checkoutHost: paymentCheckoutHost,
      callbackUrl: paymentCallbackUrl?.toString() || null,
      currency: 'IRR',
      ready: paymentAdapterReady,
      approvedPaymentHosts
    },
    settlement: { minConfirmations, maxSlippageBps, costCapAcknowledged },
    rateLimit
  };
}

/**
 * Coarse, credential-free readiness groups.
 *
 * The detailed prerequisite list stays server-side — it is an operational
 * checklist. These four group codes tell a Persian-speaking user *why* the tab
 * cannot take money yet without naming a single environment variable, host,
 * key, or provider secret.
 */
function readinessGroups(prerequisites) {
  const groups = new Set();
  for (const code of prerequisites) {
    if (code === 'IRAN_BUY_DISABLED') groups.add('ACTIVATION');
    else if (code === 'PAYMENT_COLLECTION_ADAPTER_REQUIRED') groups.add('PAYMENT');
    else if (code === 'WALLEX_API_BASE_URL_REQUIRED' || code === 'WALLEX_API_KEY_REQUIRED'
      || code === 'WALLEX_WITHDRAWAL_RECONCILIATION_REQUIRED' || code === 'WALLEX_OTC_COST_CAP_CONTRACT_REQUIRED') {
      groups.add('EXCHANGE');
    } else if (code === 'APPROVED_USDT_NETWORK_REQUIRED' || code === 'EVM_WALLET_BINDING_REQUIRED'
      || code === 'APPROVED_EVM_CHAIN_REQUIRED' || code === 'VERIFIED_USDT_TOKEN_CONTRACT_REQUIRED'
      || code === 'TOMAN_LIMITS_REQUIRED') {
      groups.add('NETWORK');
    } else if (code === 'UPSTASH_ATOMIC_IDEMPOTENCY_REQUIRED') groups.add('STORAGE');
    else groups.add('ACTIVATION');
  }
  return [...groups];
}

/** The only configuration that may cross the server/browser boundary. */
export function publicIranBuyCapability() {
  const config = iranBuyConfig();
  if (!config.available) {
    /* Referral is an *alternative* to the paid rail, never a companion: it is
       offered only while the direct path is closed, and only when the link
       itself passes the transport checks above. */
    return {
      schema: IRAN_BUY_SCHEMA,
      enabled: false,
      asset: null,
      network: null,
      limits: null,
      requiresTelegramAuth: true,
      referral: publicIranBuyReferral(),
      /* Not the checklist: four coarse groups so the UI can explain the wait. */
      readiness: readinessGroups(config.prerequisites)
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
    requiresTelegramAuth: true,
    payment: { provider: 'zarinpal', mode: 'REDIRECT', currency: 'TOMAN' },
    /* The direct rail replaces the referral the moment it is live. */
    referral: null,
    readiness: []
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
