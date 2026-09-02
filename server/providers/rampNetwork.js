/**
 * Ramp Network — Hosted Mode adapter (Provider #1 in the ProviderRegistry).
 *
 * Ramp is payment / on-ramp / off-ramp infrastructure, NEVER a CEX trading
 * API. This adapter only uses Ramp's officially documented surfaces:
 *
 *   Hosted widget      https://app.rampnetwork.com (demo: app.demo.rampnetwork.com)
 *                      with documented query parameters only (hostApiKey,
 *                      hostAppName, hostLogoUrl, userAddress, swapAsset,
 *                      offrampAsset, swapAmount, fiatCurrency, fiatValue,
 *                      enabledFlows, defaultFlow, selectedCountryCode,
 *                      finalUrl, webhookStatusUrl, offrampWebhookV3Url).
 *                      docs.rampnetwork.com/configuration
 *   REST API v3        GET  /host-api/v3/assets            (on-ramp catalog)
 *                      GET  /host-api/v3/offramp/assets    (off-ramp catalog)
 *                      POST /host-api/v3/onramp/quote/all  (per-method quotes)
 *                      POST /host-api/v3/offramp/quote/all
 *                      docs.rampnetwork.com/rest-api-v3-reference
 *   Webhooks           X-Body-Signature: base64 DER ECDSA (secp256k1, sha256)
 *                      over the JSON body stringified with sorted keys and no
 *                      whitespace. docs.rampnetwork.com/webhooks
 *
 * Fail-closed rules:
 *   - No credential  → status CONFIGURATION_REQUIRED, nothing is faked.
 *   - No verified webhook contract → no settlement can ever be recorded, so
 *     the provider stays unavailable rather than stranding paid orders.
 *   - No partner fee is configured: FBT adds 0 on top of Ramp's own pricing.
 *   - Country/KYC/AML/sanctions checks belong to Ramp. Nothing here rewrites,
 *     spoofs or bypasses a jurisdiction decision; a rejection surfaces as
 *     REGION_UNSUPPORTED.
 */
import { createVerify, randomUUID } from 'node:crypto';
import { getAddress, isAddress } from 'ethers';
import { EVM_CHAINS } from '../chainsLite.js';
import { upstashConfigured } from '../blobCache.js';

export const RAMP_PROVIDER_ID = 'ramp';

/* Official hosts per docs.rampnetwork.com. Nothing else is ever contacted. */
const HOSTS = Object.freeze({
  production: Object.freeze({ widget: 'https://app.rampnetwork.com', api: 'https://api.rampnetwork.com/api' }),
  demo: Object.freeze({ widget: 'https://app.demo.rampnetwork.com', api: 'https://api.demo.rampnetwork.com/api' })
});

/* Ramp chain code ⇄ FBT network key, restricted to EVM chains this app can
 * independently verify over its own RPC infrastructure. A Ramp asset on any
 * other chain is simply not offered — never "trusted without verification". */
const RAMP_CHAINS = Object.freeze({
  ETH: Object.freeze({ network: 'ethereum', chainId: 1 }),
  ARBITRUM: Object.freeze({ network: 'arbitrum', chainId: 42161 }),
  OPTIMISM: Object.freeze({ network: 'optimism', chainId: 10 }),
  BASE: Object.freeze({ network: 'base', chainId: 8453 }),
  MATIC: Object.freeze({ network: 'polygon', chainId: 137 }),
  BSC: Object.freeze({ network: 'bsc', chainId: 56 }),
  AVAX: Object.freeze({ network: 'avalanche', chainId: 43114 })
});
const NETWORK_TO_RAMP_CHAIN = Object.freeze(Object.fromEntries(
  Object.entries(RAMP_CHAINS).map(([chain, row]) => [row.network, chain])
));

/* Payment method types documented in Ramp's quote/webhook contracts. */
export const RAMP_PAYMENT_METHODS = Object.freeze([
  'CARD_PAYMENT', 'APPLE_PAY', 'GOOGLE_PAY', 'MANUAL_BANK_TRANSFER', 'AUTO_BANK_TRANSFER', 'PIX', 'OPEN_BANKING'
]);

const CATALOG_TTL_MS = Math.max(60_000, Number(process.env.RAMP_CATALOG_TTL_MS || 10 * 60_000));
const HTTP_TIMEOUT_MS = Math.max(3_000, Number(process.env.RAMP_HTTP_TIMEOUT_MS || 15_000));
const QUOTE_TTL_MS = Math.max(30_000, Number(process.env.BUY_SELL_QUOTE_TTL_MS || 60_000));

/**
 * Runtime configuration. Values come from the environment only — the secret
 * production Host API key must never reach frontend JavaScript or Git.
 * `partnerFee` is deliberately not configurable here: FBT's target is a $0
 * partner fee, so no fee-adding parameter is ever appended to the widget URL.
 */
export function rampConfig(env = process.env) {
  const environment = String(env.RAMP_ENVIRONMENT || 'production').trim().toLowerCase() === 'demo' ? 'demo' : 'production';
  const flows = String(env.RAMP_ENABLED_FLOWS || 'ONRAMP')
    .split(',').map((f) => f.trim().toUpperCase()).filter((f) => f === 'ONRAMP' || f === 'OFFRAMP');
  return {
    providerId: RAMP_PROVIDER_ID,
    environment,
    hosts: HOSTS[environment],
    hostApiKey: String(env.RAMP_HOST_API_KEY || '').trim(),
    hostAppName: String(env.RAMP_HOST_APP_NAME || 'FBT').trim(),
    hostLogoUrl: String(env.RAMP_HOST_LOGO_URL || '').trim(),
    flows: flows.length ? flows : ['ONRAMP'],
    /* Where the hosted checkout returns the user (…/order/result/:orderId). */
    finalUrlBase: String(env.RAMP_FINAL_URL_BASE || '').trim().replace(/\/+$/, ''),
    /* Publicly reachable webhook endpoint + Ramp's ECDSA public key (PEM). */
    webhookStatusUrl: String(env.RAMP_WEBHOOK_STATUS_URL || '').trim(),
    webhookPublicKeyPem: String(env.RAMP_WEBHOOK_PUBLIC_KEY_PEM || '').replace(/\\n/g, '\n').trim()
  };
}

/** Production prerequisites. Empty array ⇒ the integration is operational. */
export function rampPrerequisites(config = rampConfig()) {
  const missing = [];
  if (!config.hostApiKey) missing.push('RAMP_HOST_API_KEY_REQUIRED');
  /* Without the documented signed webhook there is no legitimate way to learn
     the settlement transaction hash, so paid orders could never be verified
     on-chain. That makes the webhook a hard production prerequisite. */
  if (!config.webhookStatusUrl) missing.push('RAMP_WEBHOOK_STATUS_URL_REQUIRED');
  if (!config.webhookPublicKeyPem) missing.push('RAMP_WEBHOOK_PUBLIC_KEY_REQUIRED');
  if (!upstashConfigured()) missing.push('DURABLE_PRIVATE_STORE_REQUIRED');
  return missing;
}

/* ------------------------------ HTTP helpers ------------------------------ */

async function rampFetch(url, { method = 'GET', body } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method,
      headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: ctrl.signal
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload == null) {
      const error = new Error(`RAMP_HTTP_${response.status}`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  } finally { clearTimeout(timer); }
}

/* ------------------------------ Asset catalog ----------------------------- */

const catalogCache = new Map(); // `${side}:${currency}` -> { at, rows, meta }

function mapCatalogAsset(row) {
  const chain = RAMP_CHAINS[String(row?.chain || '').toUpperCase()];
  if (!chain || row?.enabled !== true || row?.hidden === true) return null;
  const symbol = String(row.symbol || '').toUpperCase();
  if (!symbol) return null;
  return {
    asset: symbol,
    name: String(row.name || symbol),
    network: chain.network,
    chainId: chain.chainId,
    providerAssetId: `${String(row.chain).toUpperCase()}_${symbol}`,
    tokenContract: row.address ? String(row.address) : null,
    tokenDecimals: Number(row.decimals),
    native: String(row.type || '').toUpperCase() === 'NATIVE',
    minPurchaseAmount: Number.isFinite(Number(row.minPurchaseAmount)) ? Number(row.minPurchaseAmount) : null,
    maxPurchaseAmount: Number.isFinite(Number(row.maxPurchaseAmount)) ? Number(row.maxPurchaseAmount) : null,
    networkFee: Number.isFinite(Number(row.networkFee)) ? Number(row.networkFee) : null,
    logoUrl: row.logoUrl ? String(row.logoUrl) : null
  };
}

/**
 * Documented catalog endpoints. `userIp` is passed through when known so the
 * response reflects Ramp's OWN geo-eligibility decision — FBT never overrides
 * or falsifies it.
 */
export async function rampAssetCatalog(config, { side = 'BUY', currencyCode = 'USD', userIp = null } = {}) {
  if (!config.hostApiKey) return { ok: false, code: 'CONFIGURATION_REQUIRED', rows: [], meta: null };
  const flow = String(side).toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
  const cacheKey = `${flow}:${currencyCode}:${userIp || 'any'}`;
  const cached = catalogCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CATALOG_TTL_MS) return { ok: true, rows: cached.rows, meta: cached.meta };
  const path = flow === 'SELL' ? '/host-api/v3/offramp/assets' : '/host-api/v3/assets';
  const params = new URLSearchParams({ currencyCode, hostApiKey: config.hostApiKey });
  if (userIp) params.set('userIp', userIp);
  try {
    const payload = await rampFetch(`${config.hosts.api}${path}?${params}`);
    const rows = (Array.isArray(payload.assets) ? payload.assets : []).map(mapCatalogAsset).filter(Boolean);
    const meta = {
      currencyCode: String(payload.currencyCode || currencyCode),
      minPurchaseAmount: Number(payload.minPurchaseAmount) || 0,
      maxPurchaseAmount: Number(payload.maxPurchaseAmount) || null,
      minFeeAmount: Number(payload.minFeeAmount) || null,
      minFeePercent: Number(payload.minFeePercent) || null,
      maxFeePercent: Number(payload.maxFeePercent) || null
    };
    catalogCache.set(cacheKey, { at: Date.now(), rows, meta });
    return { ok: true, rows, meta };
  } catch {
    /* A stale catalog is still an honest one. */
    if (cached) return { ok: true, rows: cached.rows, meta: cached.meta, stale: true };
    return { ok: false, code: 'PROVIDER_UNAVAILABLE', rows: [], meta: null };
  }
}

export function findCatalogAsset(rows, asset, network) {
  const wantedAsset = String(asset || '').trim().toUpperCase();
  const wantedNetwork = String(network || '').trim().toLowerCase();
  return rows.find((row) => row.asset === wantedAsset && row.network === wantedNetwork) || null;
}

/* ------------------------------ Unit helpers ------------------------------ */

export function unitsToDecimal(units, decimals) {
  try {
    const value = BigInt(String(units));
    const d = Number(decimals);
    if (!Number.isInteger(d) || d < 0 || d > 36) return null;
    const raw = value.toString().padStart(d + 1, '0');
    const whole = raw.slice(0, raw.length - d) || '0';
    const fraction = d ? raw.slice(raw.length - d).replace(/0+$/, '') : '';
    return fraction ? `${whole}.${fraction}` : whole;
  } catch { return null; }
}

export function decimalToUnits(value, decimals) {
  const raw = String(value ?? '').trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(raw);
  const d = Number(decimals);
  if (!match || !Number.isInteger(d) || d < 0 || d > 36) return null;
  const fraction = match[2] || '';
  if (fraction.length > d && /[1-9]/.test(fraction.slice(d))) return null;
  return BigInt(`${match[1]}${fraction.slice(0, d).padEnd(d, '0')}`);
}

/* --------------------------------- Quotes --------------------------------- */

function pickMethodQuote(payload, requestedMethod) {
  const entries = Object.entries(payload || {})
    .filter(([key, value]) => key !== 'asset' && value && typeof value === 'object' && value.cryptoAmount != null);
  if (!entries.length) return null;
  const wanted = String(requestedMethod || '').toUpperCase();
  const exact = entries.find(([key]) => key === wanted);
  if (exact) return { paymentMethod: exact[0], quote: exact[1] };
  /* No hardcoded "cheapest" assumption: for a fixed fiatValue the best
     eligible quote is simply the one delivering the most crypto. */
  const best = entries.reduce((a, b) => (BigInt(String(b[1].cryptoAmount)) > BigInt(String(a[1].cryptoAmount)) ? b : a));
  return { paymentMethod: best[0], quote: best[1], fallback: true };
}

/**
 * On-ramp quote via the documented POST /host-api/v3/onramp/quote/all.
 * Ramp's `fiatValue` is the TOTAL the user pays (Ramp fee included), and
 * `appliedFee`/`networkFee`/`baseRampFee` arrive in fiat currency. Those
 * numbers are surfaced verbatim — never hidden, never marked up.
 */
export async function rampOnRampQuote(config, { providerAssetId, fiatCurrency, fiatAmount, paymentMethod }) {
  const payload = await rampFetch(
    `${config.hosts.api}/host-api/v3/onramp/quote/all?${new URLSearchParams({ hostApiKey: config.hostApiKey })}`,
    { method: 'POST', body: { cryptoAssetSymbol: providerAssetId, fiatCurrency, fiatValue: Number(fiatAmount) } }
  );
  const picked = pickMethodQuote(payload, paymentMethod);
  if (!picked) return { ok: false, code: 'QUOTE_UNAVAILABLE' };
  return { ok: true, ...picked, asset: payload.asset || null };
}

export async function rampOffRampQuote(config, { providerAssetId, fiatCurrency, cryptoAmountUnits, payoutMethod }) {
  const payload = await rampFetch(
    `${config.hosts.api}/host-api/v3/offramp/quote/all?${new URLSearchParams({ hostApiKey: config.hostApiKey })}`,
    { method: 'POST', body: { cryptoAssetSymbol: providerAssetId, fiatCurrency, cryptoAmount: String(cryptoAmountUnits) } }
  );
  const picked = pickMethodQuote(payload, payoutMethod);
  if (!picked) return { ok: false, code: 'QUOTE_UNAVAILABLE' };
  return { ok: true, ...picked, asset: payload.asset || null };
}

/* ------------------------- Hosted checkout URL ---------------------------- */

/**
 * Compose the official Hosted Mode URL. Documented parameters only — no
 * invented query parameters, no partner-fee parameter (FBT partner fee = 0),
 * and `userAddress` prefilled so Ramp settles directly to the user's wallet.
 */
export function buildHostedCheckoutUrl(config, order, { webhookAuth = null } = {}) {
  const url = new URL(config.hosts.widget);
  const set = (name, value) => { if (value != null && value !== '') url.searchParams.set(name, String(value)); };
  const sell = String(order.side).toUpperCase() === 'SELL';
  set('hostApiKey', config.hostApiKey);
  set('hostAppName', config.hostAppName);
  set('hostLogoUrl', config.hostLogoUrl);
  set('userAddress', order.walletAddress);
  set('fiatCurrency', order.fiatCurrency);
  if (sell) {
    set('offrampAsset', order.providerAssetId);
    set('swapAmount', order.cryptoAmountUnits);
    set('defaultFlow', 'OFFRAMP');
    set('enabledFlows', 'OFFRAMP');
  } else {
    set('swapAsset', order.providerAssetId);
    set('fiatValue', order.fiatAmount);
    set('defaultFlow', 'ONRAMP');
    set('enabledFlows', 'ONRAMP');
  }
  /* The user's real country selection is passed through untouched. Ramp makes
     the eligibility decision; FBT never manipulates it. */
  if (/^[A-Z]{2}$/i.test(String(order.country || ''))) set('selectedCountryCode', String(order.country).toUpperCase());
  if (config.finalUrlBase) set('finalUrl', `${config.finalUrlBase}/order/result/${encodeURIComponent(order.orderId)}`);
  if (config.webhookStatusUrl && webhookAuth) {
    /* Ramp forwards custom query params on the webhook URL verbatim; the
       per-order token pairs the callback with its order (docs: webhooks →
       "Passing custom parameters"). Authenticity still comes from the ECDSA
       body signature, not from this token. */
    const hook = new URL(config.webhookStatusUrl);
    hook.searchParams.set('orderId', order.orderId);
    hook.searchParams.set('hookToken', webhookAuth);
    set(sell ? 'offrampWebhookV3Url' : 'webhookStatusUrl', hook.toString());
  }
  return url.toString();
}

/* ------------------------------- Webhooks --------------------------------- */

/**
 * Deterministic JSON serialization matching Ramp's documented signing input:
 * fast-json-stable-stringify semantics — keys sorted, no whitespace.
 */
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item) ?? 'null').join(',')}]`;
  const keys = Object.keys(value).sort();
  const parts = [];
  for (const key of keys) {
    const serialized = stableStringify(value[key]);
    if (serialized !== undefined) parts.push(`${JSON.stringify(key)}:${serialized}`);
  }
  return `{${parts.join(',')}}`;
}

/**
 * Verify X-Body-Signature: base64 DER ECDSA (secp256k1) with a sha256 digest
 * over the stable-stringified JSON body, against Ramp's published public key.
 */
export function verifyRampWebhookSignature(parsedBody, signatureBase64, publicKeyPem) {
  if (!publicKeyPem || typeof signatureBase64 !== 'string' || !signatureBase64) return false;
  try {
    const verifier = createVerify('sha256');
    verifier.update(Buffer.from(stableStringify(parsedBody), 'utf8'));
    verifier.end();
    return verifier.verify(publicKeyPem, Buffer.from(signatureBase64, 'base64'));
  } catch { return false; }
}

/**
 * Map a verified Ramp webhook event onto the FBT order lifecycle. This NEVER
 * completes an order: RELEASED only records the provider-reported settlement
 * transaction, which the independent on-chain verifier must then confirm.
 */
export function mapRampWebhookEvent(event) {
  const type = String(event?.type || '').toUpperCase();
  const purchase = event?.purchase || event?.sale || null;
  const purchaseStatus = String(purchase?.status || '').toUpperCase();
  const base = {
    providerReference: purchase?.id != null ? String(purchase.id) : null,
    purchaseStatus: purchaseStatus || null,
    receiverAddress: purchase?.receiverAddress ? String(purchase.receiverAddress) : null,
    finalTxHash: purchase?.finalTxHash ? String(purchase.finalTxHash) : null,
    cryptoAmountUnits: purchase?.cryptoAmount != null ? String(purchase.cryptoAmount) : null
  };
  if (type === 'RELEASED' || purchaseStatus === 'RELEASED') return { ...base, kind: 'RELEASED' };
  if (type === 'RETURNED' || ['EXPIRED', 'CANCELLED', 'PAYMENT_FAILED'].includes(purchaseStatus)) {
    return { ...base, kind: 'FAILED' };
  }
  if (type === 'CREATED' || purchaseStatus) return { ...base, kind: 'PENDING' };
  return { ...base, kind: 'UNKNOWN' };
}

/* ------------------------- Provider capability ---------------------------- */

/**
 * Dynamic capability report (spec §16). Nothing is hardcoded to true: every
 * flag derives from the actual configuration state of this deployment.
 */
export function rampCapabilities(config = rampConfig()) {
  const prerequisites = rampPrerequisites(config);
  const available = prerequisites.length === 0;
  return {
    id: RAMP_PROVIDER_ID,
    name: 'Ramp Network',
    mode: 'HOSTED_CHECKOUT',
    environment: config.environment,
    available: available && config.flows.includes('ONRAMP'),
    status: available ? 'AVAILABLE' : 'CONFIGURATION_REQUIRED',
    prerequisites,
    checkoutMode: available ? 'HOSTED_CHECKOUT' : null,
    checkoutHost: available ? config.hosts.widget : null,
    onRamp: available && config.flows.includes('ONRAMP'),
    offRamp: available && config.flows.includes('OFFRAMP'),
    directWalletSettlement: available,
    blockchainVerification: true,
    requiresCexApi: false,
    requiresRampProductionCredential: true,
    partnerFee: 0,
    fbtFee: 0,
    paymentMethods: [...RAMP_PAYMENT_METHODS],
    supportedNetworks: Object.values(RAMP_CHAINS).map((row) => row.network),
    /* Country / asset / payment-method eligibility is decided by Ramp per
       user and enforced inside its hosted checkout and geo-aware catalog. */
    eligibility: 'PROVIDER_ENFORCED'
  };
}

/* ----------------------------- Quote assembly ----------------------------- */

function normalizeWallet(address) {
  const raw = String(address || '').trim();
  if (!isAddress(raw)) return null;
  try { return getAddress(raw); } catch { return null; }
}

/**
 * Build a full FBT quote for BUY or SELL. All monetary figures come from the
 * live Ramp quote — nothing is invented, and fbtFee is a structural 0.
 */
export async function rampQuote(config, input, { makeToken }) {
  const side = String(input?.side || 'BUY').toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
  if (side === 'SELL' && !config.flows.includes('OFFRAMP')) return { ok: false, code: 'SELL_UNAVAILABLE' };
  const fiatCurrency = String(input?.fiatCurrency || 'USD').toUpperCase();
  const catalog = await rampAssetCatalog(config, { side, currencyCode: fiatCurrency, userIp: input?.userIp || null });
  if (!catalog.ok) return { ok: false, code: catalog.code };
  const row = findCatalogAsset(catalog.rows, input?.asset, input?.network);
  if (!row) return { ok: false, code: 'ASSET_UNSUPPORTED' };
  const walletAddress = normalizeWallet(input?.walletAddress);
  if (!walletAddress) return { ok: false, code: 'ADDRESS_INVALID' };

  let picked; let cryptoAmountUnits; let fiatAmount;
  if (side === 'BUY') {
    fiatAmount = Number(input?.fiatAmount);
    if (!Number.isFinite(fiatAmount) || fiatAmount <= 0) return { ok: false, code: 'AMOUNT_INVALID' };
    const min = row.minPurchaseAmount != null && row.minPurchaseAmount >= 0 ? row.minPurchaseAmount : catalog.meta?.minPurchaseAmount;
    const max = row.maxPurchaseAmount != null && row.maxPurchaseAmount >= 0 ? row.maxPurchaseAmount : catalog.meta?.maxPurchaseAmount;
    if (min != null && min >= 0 && fiatAmount < min) return { ok: false, code: 'AMOUNT_BELOW_MIN', min, max };
    if (max != null && max > 0 && fiatAmount > max) return { ok: false, code: 'AMOUNT_ABOVE_MAX', min, max };
    const quoted = await rampOnRampQuote(config, {
      providerAssetId: row.providerAssetId, fiatCurrency, fiatAmount, paymentMethod: input?.paymentMethod
    });
    if (!quoted.ok) return quoted;
    picked = quoted;
    cryptoAmountUnits = String(picked.quote.cryptoAmount);
  } else {
    const cryptoAmount = String(input?.cryptoAmount || '').trim();
    cryptoAmountUnits = decimalToUnits(cryptoAmount, row.tokenDecimals);
    if (cryptoAmountUnits == null || cryptoAmountUnits <= 0n) return { ok: false, code: 'AMOUNT_INVALID' };
    cryptoAmountUnits = cryptoAmountUnits.toString();
    const quoted = await rampOffRampQuote(config, {
      providerAssetId: row.providerAssetId, fiatCurrency, cryptoAmountUnits, payoutMethod: input?.paymentMethod
    });
    if (!quoted.ok) return quoted;
    picked = quoted;
    fiatAmount = Number(picked.quote.fiatValue);
  }

  const q = picked.quote;
  const decimals = Number(picked.asset?.decimals ?? row.tokenDecimals);
  const cryptoAmount = unitsToDecimal(cryptoAmountUnits, decimals);
  if (cryptoAmount == null) return { ok: false, code: 'QUOTE_UNAVAILABLE' };
  const providerFee = Number.isFinite(Number(q.appliedFee)) ? Number(q.appliedFee) : null;
  const networkFee = Number.isFinite(Number(q.networkFee)) ? Number(q.networkFee) : null;

  const quote = {
    quoteId: `bsq_${randomUUID()}`,
    provider: RAMP_PROVIDER_ID,
    checkoutMode: 'HOSTED_CHECKOUT',
    side,
    asset: row.asset,
    network: row.network,
    chainId: row.chainId,
    providerAssetId: row.providerAssetId,
    tokenContract: row.tokenContract,
    tokenDecimals: decimals,
    native: row.native,
    fiatCurrency,
    fiatAmount,
    cryptoAmount,
    cryptoAmountUnits,
    assetPrice: Number.isFinite(Number(q.assetExchangeRate)) ? Number(q.assetExchangeRate) : null,
    walletAddress,
    country: /^[A-Z]{2}$/i.test(String(input?.country || '')) ? String(input.country).toUpperCase() : null,
    paymentMethod: picked.paymentMethod,
    paymentMethodFallback: Boolean(picked.fallback),
    fbtFee: 0,
    providerFee,
    providerFees: providerFee != null ? [{ name: 'Ramp fee', amount: providerFee, currency: fiatCurrency }] : [],
    baseProviderFee: Number.isFinite(Number(q.baseRampFee)) ? Number(q.baseRampFee) : null,
    paymentFee: null,
    networkFee: networkFee != null ? { amount: networkFee, currency: fiatCurrency } : null,
    spread: null,
    /* Ramp's fiatValue for on-ramp already includes its fees; for off-ramp it
       is the fiat payout. Either way it is the provider's own figure. */
    totalPayable: side === 'BUY' ? fiatAmount : null,
    fiatPayout: side === 'SELL' ? fiatAmount : null,
    expiresAt: new Date(Date.now() + QUOTE_TTL_MS).toISOString(),
    createdAt: new Date().toISOString(),
    accessToken: makeToken()
  };
  return { ok: true, quote, limits: { min: catalog.meta?.minPurchaseAmount ?? null, max: catalog.meta?.maxPurchaseAmount ?? null } };
}

export function explorerTxUrl(chainId, txHash) {
  const chain = EVM_CHAINS[Number(chainId)];
  return chain && txHash ? `${chain.explorer}/tx/${txHash}` : null;
}
