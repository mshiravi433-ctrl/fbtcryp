/**
 * FBT Buy / Sell service
 *
 * This module is deliberately a payment-provider boundary, not an exchange
 * adapter. There is NO CEX trading API here (no Binance/Bybit/KuCoin/MEXC or
 * any other exchange API), no order book, no custody, and no private-key
 * code. The primary provider is Ramp Network's official Hosted Mode:
 *
 *   FBT (order + wallet context) → Ramp hosted checkout (payment, KYC/AML,
 *   fiat processing) → crypto settled DIRECTLY to the user's wallet →
 *   independent on-chain verification by FBT → COMPLETED.
 *
 * A provider is unavailable until every production prerequisite is explicitly
 * configured (Ramp host API key, signed settlement webhook, durable order
 * store). That fail-closed posture matters more than displaying a form: a
 * missing credential surfaces as CONFIGURATION_REQUIRED — never as a fake
 * checkout, and never (the forbidden inverse) does a missing CEX API key make
 * Buy unavailable.
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { getAddress, isAddress } from 'ethers';
import { EVM_CHAINS } from './chainsLite.js';
import { storeGet, storeSet } from './store.js';
import { upstashConfigured, upstashSetIfAbsent } from './blobCache.js';
import { publish } from './central/eventBus.js';
import {
  RAMP_PROVIDER_ID,
  buildHostedCheckoutUrl,
  explorerTxUrl,
  findCatalogAsset,
  mapRampWebhookEvent,
  rampAssetCatalog,
  rampCapabilities,
  rampConfig,
  rampQuote,
  verifyRampWebhookSignature
} from './providers/rampNetwork.js';

export const BUY_SELL_SCHEMA = 'fbt.buy-sell.v1';
export const FBT_TRADING_FEE = 0;
export const CHECKOUT_MODE = 'HOSTED_CHECKOUT';

export const ORDER_STATES = Object.freeze([
  'CREATED', 'ELIGIBILITY_CHECK', 'QUOTE_READY', 'AWAITING_CONFIRMATION',
  'CHECKOUT_CREATED', 'PAYMENT_PENDING', 'PAYMENT_CONFIRMED',
  'SETTLEMENT_PENDING', 'TX_DETECTED', 'TX_CONFIRMING', 'VERIFYING',
  'COMPLETED', 'QUOTE_EXPIRED', 'PAYMENT_FAILED', 'PAYMENT_REJECTED',
  'PROVIDER_UNAVAILABLE', 'REGION_UNSUPPORTED', 'ASSET_UNSUPPORTED',
  'NETWORK_UNSUPPORTED', 'ADDRESS_INVALID', 'SETTLEMENT_FAILED', 'TX_FAILED',
  'VERIFICATION_FAILED', 'VERIFICATION_PENDING', 'CANCELLED', 'MANUAL_REVIEW',
  'UNKNOWN'
]);

const TTL = {
  quoteMs: Math.max(30_000, Number(process.env.BUY_SELL_QUOTE_TTL_MS || 60_000)),
  orderMs: Math.max(3_600_000, Number(process.env.BUY_SELL_ORDER_TTL_MS || 90 * 24 * 3_600_000)),
  idempotencyMs: Math.max(60_000, Number(process.env.BUY_SELL_IDEMPOTENCY_TTL_MS || 24 * 3_600_000)),
  rpcMs: Math.max(3_000, Number(process.env.BUY_SELL_RPC_TIMEOUT_MS || 12_000))
};

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const txHashPattern = /^0x[0-9a-f]{64}$/i;
const requestIdPattern = /^[A-Za-z0-9._:-]{16,128}$/;
const h = (value) => createHash('sha256').update(String(value)).digest('hex');
const orderKey = (id) => `buy-sell:order:${id}`;
const quoteKey = (id) => `buy-sell:quote:${id}`;
const auditKey = (id) => `buy-sell:audit:${id}`;
const idemKey = (wallet, key) => `buy-sell:idem:${h(wallet)}:${h(key)}`;
const token = () => randomBytes(32).toString('base64url');
const constantTokenMatch = (provided, expectedHash) => {
  if (typeof provided !== 'string' || typeof expectedHash !== 'string') return false;
  const candidate = Buffer.from(h(provided));
  const expected = Buffer.from(expectedHash);
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
};

export function validateDestination(address, asset) {
  if (!asset) return { ok: false, code: 'NETWORK_UNSUPPORTED' };
  const raw = String(address || '').trim();
  if (!isAddress(raw)) return { ok: false, code: 'ADDRESS_INVALID' };
  try {
    /* ethers rejects a bad mixed-case checksum. `getAddress` also normalizes a
       lower-case EVM address without silently modifying any non-EVM input. */
    return { ok: true, address: getAddress(raw), chainId: asset.chainId };
  } catch {
    return { ok: false, code: 'ADDRESS_INVALID' };
  }
}


function externalFacingOrder(order) {
  if (!order) return null;
  const {
    accessTokenHash, providerCheckoutUrl, idempotencyKeyHash, checkoutIdempotencyKeyHash,
    settlementEventId, webhookAuth, webhookAuthHash, ...safe
  } = order;
  return safe;
}

function externalFacingQuote(quote) {
  if (!quote) return null;
  const { accessTokenHash, ...safe } = quote;
  return safe;
}

async function appendAudit(orderId, type, details = {}) {
  const key = auditKey(orderId);
  const previous = await storeGet(key, []);
  const rows = Array.isArray(previous) ? previous : [];
  const event = { at: new Date().toISOString(), type, details };
  await storeSet(key, [...rows, event].slice(-100));
  return event;
}


/**
 * Ramp Network — the primary Hosted Checkout provider (Provider #1).
 *
 * Ramp is payment / on-ramp / off-ramp infrastructure, not a CEX. The only
 * production credential this provider needs is what Ramp officially requires
 * for Hosted Mode (an active production host API key) plus the documented
 * signed settlement webhook — a Ramp integration credential, never a CEX
 * trading API. Availability is derived from configuration at call time; no
 * capability flag is hardcoded.
 */
export const RampNetworkHostedCheckoutProvider = Object.freeze({
  id: RAMP_PROVIDER_ID,
  mode: CHECKOUT_MODE,
  getCapabilities() {
    return rampCapabilities(rampConfig());
  },
  async listAssets({ side = 'BUY', fiatCurrency = 'USD', userIp = null } = {}) {
    const capability = this.getCapabilities();
    const sell = String(side).toUpperCase() === 'SELL';
    if ((sell && !capability.offRamp) || (!sell && !capability.onRamp)) {
      return { ok: false, code: sell ? 'SELL_UNAVAILABLE' : 'PROVIDER_UNAVAILABLE', prerequisites: capability.prerequisites, rows: [] };
    }
    const catalog = await rampAssetCatalog(rampConfig(), { side, currencyCode: fiatCurrency, userIp });
    return { ok: catalog.ok, code: catalog.code || null, rows: catalog.rows, meta: catalog.meta };
  },
  async checkEligibility(input = {}) {
    const capability = this.getCapabilities();
    const sell = String(input.side || 'BUY').toUpperCase() === 'SELL';
    if ((sell && !capability.offRamp) || (!sell && !capability.onRamp)) {
      return { ok: false, code: sell ? 'SELL_UNAVAILABLE' : 'PROVIDER_UNAVAILABLE', prerequisites: capability.prerequisites };
    }
    const catalog = await rampAssetCatalog(rampConfig(), {
      side: input.side, currencyCode: String(input.fiatCurrency || 'USD').toUpperCase(), userIp: input.userIp || null
    });
    if (!catalog.ok) return { ok: false, code: catalog.code };
    const row = findCatalogAsset(catalog.rows, input.asset, input.network);
    if (!row) return { ok: false, code: 'ASSET_UNSUPPORTED' };
    const min = row.minPurchaseAmount != null && row.minPurchaseAmount >= 0 ? row.minPurchaseAmount : catalog.meta?.minPurchaseAmount ?? null;
    const max = row.maxPurchaseAmount != null && row.maxPurchaseAmount >= 0 ? row.maxPurchaseAmount : catalog.meta?.maxPurchaseAmount ?? null;
    const fiatAmount = Number(input.fiatAmount);
    if (!sell && Number.isFinite(fiatAmount)) {
      if (min != null && fiatAmount < min) return { ok: false, code: 'AMOUNT_BELOW_MIN', min, max };
      if (max != null && max > 0 && fiatAmount > max) return { ok: false, code: 'AMOUNT_ABOVE_MAX', min, max };
    }
    /* Country/KYC eligibility is decided by Ramp inside its hosted checkout
       and geo-aware catalog. FBT passes the user's real inputs through and
       surfaces a provider rejection as REGION_UNSUPPORTED — never bypassed. */
    return { ok: true, limits: { min, max }, countryCheck: 'PROVIDER_ENFORCED_AT_CHECKOUT' };
  },
  async getQuote(input = {}) {
    const capability = this.getCapabilities();
    const sell = String(input.side || 'BUY').toUpperCase() === 'SELL';
    if ((sell && !capability.offRamp) || (!sell && !capability.onRamp)) {
      return { ok: false, code: sell ? 'SELL_UNAVAILABLE' : 'PROVIDER_UNAVAILABLE' };
    }
    try {
      return await rampQuote(rampConfig(), input, { makeToken: token });
    } catch {
      return { ok: false, code: 'QUOTE_UNAVAILABLE' };
    }
  },
  /**
   * Hosted Mode has no server-side session API: the "session" is the official
   * widget URL itself, composed of documented parameters with the destination
   * wallet prefilled via `userAddress` for direct wallet settlement.
   */
  async createCheckoutSession(order, { webhookAuth = null } = {}) {
    const capability = this.getCapabilities();
    if (!capability.available) return { ok: false, code: 'PROVIDER_UNAVAILABLE' };
    const checkoutUrl = buildHostedCheckoutUrl(rampConfig(), order, { webhookAuth });
    return {
      ok: true,
      checkoutUrl,
      paymentSessionId: null,
      providerReference: null,
      expectedCryptoAmount: order.cryptoAmount
    };
  }
});

/**
 * ProviderRegistry (spec §15). Ramp is Provider #1; future providers are
 * appended here and compete inside the router on real quotes — never on a
 * hardcoded "always cheapest" assumption.
 */
export const ProviderRegistry = Object.freeze({
  providers: Object.freeze([RampNetworkHostedCheckoutProvider]),
  list() { return this.providers.map((provider) => provider.getCapabilities()); },
  get(id) { return this.providers.find((provider) => provider.id === String(id || '').toLowerCase()) || null; }
});

/** ProviderRouter evaluates all inputs rather than hardcoding a redirect. */
export const ProviderRouter = Object.freeze({
  async route(input = {}) {
    const sell = String(input.side || 'BUY').toUpperCase() === 'SELL';
    const candidates = [];
    for (const provider of ProviderRegistry.providers) {
      const capability = provider.getCapabilities();
      const eligible = sell ? capability.offRamp : capability.onRamp;
      candidates.push({ provider: provider.id, available: Boolean(eligible), reasons: eligible ? [] : (capability.prerequisites?.length ? capability.prerequisites : [sell ? 'OFF_RAMP_NOT_CONFIGURED' : 'ON_RAMP_NOT_CONFIGURED']) });
      if (eligible) return { ok: true, provider, capability, candidates };
    }
    return { ok: false, code: sell ? 'SELL_UNAVAILABLE' : 'PROVIDER_UNAVAILABLE', candidates };
  }
});

export async function getBuySellCapabilities() {
  const providers = ProviderRegistry.list();
  return {
    schema: BUY_SELL_SCHEMA,
    fbtFee: FBT_TRADING_FEE,
    providers,
    buyAvailable: providers.some((capability) => capability.onRamp),
    sellAvailable: providers.some((capability) => capability.offRamp),
    storage: { durable: upstashConfigured(), type: upstashConfigured() ? 'upstash-redis' : null },
    noCexApi: true,
    custody: 'NON_CUSTODIAL',
    generatedAt: new Date().toISOString()
  };
}

export async function listAssets({ side = 'BUY', fiatCurrency = 'USD' } = {}) {
  const listed = await RampNetworkHostedCheckoutProvider.listAssets({ side, fiatCurrency });
  if (!listed.ok) {
    return { schema: BUY_SELL_SCHEMA, available: false, error: listed.code || 'PROVIDER_UNAVAILABLE', assets: [] };
  }
  return {
    schema: BUY_SELL_SCHEMA,
    available: true,
    provider: RAMP_PROVIDER_ID,
    limits: listed.meta ? { min: listed.meta.minPurchaseAmount, max: listed.meta.maxPurchaseAmount, currency: listed.meta.currencyCode } : null,
    assets: listed.rows.map((row) => ({
      asset: row.asset,
      name: row.name,
      network: row.network,
      chainId: row.chainId,
      native: row.native,
      minPurchaseAmount: row.minPurchaseAmount,
      maxPurchaseAmount: row.maxPurchaseAmount,
      logoUrl: row.logoUrl
    }))
  };
}

export async function listNetworks({ asset, side = 'BUY' } = {}) {
  const listed = await listAssets({ side });
  if (!listed.available) return { schema: BUY_SELL_SCHEMA, available: false, error: listed.error, networks: [] };
  const wanted = String(asset || '').trim().toUpperCase();
  const networks = listed.assets
    .filter((row) => !wanted || row.asset === wanted)
    .map((row) => ({ network: row.network, chainId: row.chainId }));
  const unique = [...new Map(networks.map((row) => [row.network, row])).values()];
  return { schema: BUY_SELL_SCHEMA, available: true, networks: unique };
}

export async function checkBuySellEligibility(input) {
  const routed = await ProviderRouter.route(input);
  if (!routed.ok) return { ok: false, status: 503, body: { error: routed.code, candidates: routed.candidates } };
  try {
    const eligibility = await routed.provider.checkEligibility(input);
    if (!eligibility.ok) return { ok: false, status: eligibility.code === 'REGION_UNSUPPORTED' ? 403 : 400, body: { error: eligibility.code, min: eligibility.min ?? null, max: eligibility.max ?? null } };
    return { ok: true, status: 200, body: { eligible: true, provider: routed.provider.id, checkoutMode: CHECKOUT_MODE, limits: eligibility.limits, fbtFee: FBT_TRADING_FEE } };
  } catch {
    return { ok: false, status: 503, body: { error: 'PROVIDER_UNAVAILABLE' } };
  }
}

export async function createBuySellQuote(input) {
  const routed = await ProviderRouter.route(input);
  if (!routed.ok) return { ok: false, status: 503, body: { error: routed.code, candidates: routed.candidates } };
  try {
    const quoted = await routed.provider.getQuote(input);
    if (!quoted.ok) return { ok: false, status: quoted.code === 'REGION_UNSUPPORTED' ? 403 : 400, body: { error: quoted.code, min: quoted.min ?? null, max: quoted.max ?? null } };
    const quote = quoted.quote;
    const accessToken = quote.accessToken;
    quote.accessTokenHash = h(accessToken);
    delete quote.accessToken;
    await storeSet(quoteKey(quote.quoteId), quote);
    await appendAudit(quote.quoteId, 'QUOTE_READY', { provider: quote.provider, asset: quote.asset, network: quote.network });
    return { ok: true, status: 200, body: { quote: { ...externalFacingQuote(quote), accessToken }, limits: quoted.limits } };
  } catch {
    return { ok: false, status: 503, body: { error: 'QUOTE_UNAVAILABLE' } };
  }
}

async function claimOperation(walletAddress, idempotencyKey, operation, fingerprint) {
  if (!requestIdPattern.test(String(idempotencyKey || ''))) return { ok: false, code: 'IDEMPOTENCY_KEY_REQUIRED' };
  const key = idemKey(`${walletAddress}:${operation}`, idempotencyKey);
  const first = await upstashSetIfAbsent(key, { fingerprint, state: 'PROCESSING', createdAt: Date.now() }, TTL.idempotencyMs);
  if (first) return { ok: true, key, fingerprint, replay: false };
  const existing = await storeGet(key, null);
  if (!existing) return { ok: false, code: 'IDEMPOTENCY_UNAVAILABLE' };
  if (existing.fingerprint !== fingerprint) return { ok: false, code: 'IDEMPOTENCY_CONFLICT' };
  if (existing.state !== 'COMPLETED') return { ok: false, code: 'REQUEST_IN_PROGRESS' };
  return { ok: true, replay: true, result: existing.result };
}

async function completeOperation(claim, result) {
  if (!claim?.key) return;
  await storeSet(claim.key, { state: 'COMPLETED', result, fingerprint: claim.fingerprint, completedAt: Date.now() });
}

export async function createBuySellOrder(input, idempotencyKey) {
  const routed = await ProviderRouter.route({ side: 'BUY' });
  const sellRouted = routed.ok ? null : await ProviderRouter.route({ side: 'SELL' });
  if (!routed.ok && !sellRouted?.ok) {
    const capability = RampNetworkHostedCheckoutProvider.getCapabilities();
    return { ok: false, status: 503, body: { error: 'PROVIDER_REQUIRES_INTEGRATION', prerequisites: capability.prerequisites } };
  }
  const quoteId = String(input?.quoteId || '');
  const quoteToken = String(input?.quoteAccessToken || '');
  const quote = await storeGet(quoteKey(quoteId), null);
  if (!quote || !constantTokenMatch(quoteToken, quote.accessTokenHash)) return { ok: false, status: 404, body: { error: 'QUOTE_NOT_FOUND' } };
  if (Date.now() >= Date.parse(quote.expiresAt)) return { ok: false, status: 409, body: { error: 'QUOTE_EXPIRED' } };
  const destination = validateDestination(input?.walletAddress, { chainId: quote.chainId });
  if (!destination.ok || destination.address !== quote.walletAddress) return { ok: false, status: 400, body: { error: 'ADDRESS_INVALID' } };
  const fingerprint = h(JSON.stringify({ quoteId, walletAddress: destination.address, side: quote.side }));
  const claim = await claimOperation(destination.address, idempotencyKey, 'order', fingerprint);
  if (!claim.ok) return { ok: false, status: claim.code === 'REQUEST_IN_PROGRESS' ? 409 : 400, body: { error: claim.code } };
  if (claim.replay) return { ok: true, status: 200, body: claim.result };

  const accessToken = token();
  const webhookAuth = token();
  const now = new Date().toISOString();
  const order = {
    schema: BUY_SELL_SCHEMA,
    orderId: `bso_${randomUUID()}`,
    requestId: String(input.requestId || idempotencyKey),
    sessionId: null,
    side: quote.side,
    asset: quote.asset,
    network: quote.network,
    chainId: quote.chainId,
    providerAssetId: quote.providerAssetId,
    tokenContract: quote.tokenContract,
    tokenDecimals: quote.tokenDecimals,
    native: quote.native,
    fiatCurrency: quote.fiatCurrency,
    fiatAmount: quote.fiatAmount,
    cryptoAmount: quote.cryptoAmount,
    cryptoAmountUnits: quote.cryptoAmountUnits ?? null,
    walletAddress: quote.walletAddress,
    country: quote.country,
    paymentMethod: quote.paymentMethod,
    provider: quote.provider,
    checkoutMode: CHECKOUT_MODE,
    quoteId: quote.quoteId,
    paymentSessionId: null,
    providerReference: null,
    txHash: null,
    explorerTxUrl: null,
    status: 'AWAITING_CONFIRMATION',
    paymentStatus: 'NOT_STARTED',
    settlementStatus: 'NOT_STARTED',
    verificationStatus: 'NOT_STARTED',
    fbtFee: FBT_TRADING_FEE,
    providerFee: quote.providerFee,
    providerFees: quote.providerFees,
    paymentFee: quote.paymentFee,
    networkFee: quote.networkFee,
    spread: quote.spread,
    totalPayable: quote.totalPayable,
    fiatPayout: quote.fiatPayout ?? null,
    createdAt: now,
    updatedAt: now,
    accessTokenHash: h(accessToken),
    /* Correlates the provider's signed settlement webhook with this order.
       Authenticity of the callback itself comes from the provider's ECDSA
       body signature — this token only pairs callback and order. */
    webhookAuth,
    webhookAuthHash: h(webhookAuth)
  };
  await storeSet(orderKey(order.orderId), order);
  await appendAudit(order.orderId, 'BUY_CREATED', { requestId: order.requestId, quoteId, provider: order.provider });
  publish('BUY_CREATED', { orderId: order.orderId, side: order.side, asset: order.asset, network: order.network }, { source: 'buy-sell' });
  const response = { order: externalFacingOrder(order), orderAccessToken: accessToken };
  await completeOperation(claim, response);
  return { ok: true, status: 201, body: response };
}

function validateOrderAccess(order, provided) {
  return order && constantTokenMatch(provided, order.accessTokenHash);
}

export async function createBuySellCheckout(orderId, orderAccessToken, input, idempotencyKey) {
  const order = await storeGet(orderKey(orderId), null);
  if (!validateOrderAccess(order, orderAccessToken)) return { ok: false, status: 404, body: { error: 'ORDER_NOT_FOUND' } };
  const routed = await ProviderRouter.route({ side: order.side });
  if (!routed.ok || routed.provider.id !== order.provider) {
    const capability = ProviderRegistry.get(order.provider)?.getCapabilities() || null;
    return { ok: false, status: 503, body: { error: 'PROVIDER_REQUIRES_INTEGRATION', prerequisites: capability?.prerequisites ?? [] } };
  }
  if (order.status === 'COMPLETED') return { ok: false, status: 409, body: { error: 'ORDER_COMPLETED' } };
  if (order.status !== 'AWAITING_CONFIRMATION') return { ok: false, status: 409, body: { error: 'ORDER_NOT_READY' } };
  if (input?.confirmed !== true) return { ok: false, status: 400, body: { error: 'CONFIRMATION_REQUIRED' } };
  const quote = await storeGet(quoteKey(order.quoteId), null);
  if (!quote || Date.now() >= Date.parse(quote.expiresAt)) {
    order.status = 'QUOTE_EXPIRED'; order.updatedAt = new Date().toISOString();
    await storeSet(orderKey(order.orderId), order);
    await appendAudit(order.orderId, 'QUOTE_EXPIRED');
    return { ok: false, status: 409, body: { error: 'QUOTE_EXPIRED' } };
  }
  const fingerprint = h(JSON.stringify({ orderId: order.orderId, quoteId: order.quoteId, confirmed: true }));
  const claim = await claimOperation(order.walletAddress, idempotencyKey, 'checkout', fingerprint);
  if (!claim.ok) return { ok: false, status: claim.code === 'REQUEST_IN_PROGRESS' ? 409 : 400, body: { error: claim.code } };
  if (claim.replay) return { ok: true, status: 200, body: claim.result };

  const provider = routed.provider;
  try {
    order.status = 'CHECKOUT_CREATED';
    order.updatedAt = new Date().toISOString();
    await storeSet(orderKey(order.orderId), order);
    const session = await provider.createCheckoutSession(order, { webhookAuth: order.webhookAuth || null });
    if (!session.ok) {
      order.status = 'UNKNOWN';
      order.paymentStatus = 'UNKNOWN';
      order.updatedAt = new Date().toISOString();
      await storeSet(orderKey(order.orderId), order);
      await appendAudit(order.orderId, 'CHECKOUT_FAILED_OR_UNKNOWN', { code: session.code || 'CHECKOUT_UNAVAILABLE' });
      return { ok: false, status: 502, body: { error: session.code || 'CHECKOUT_UNAVAILABLE' } };
    }
    order.sessionId = `bss_${randomUUID()}`;
    order.paymentSessionId = session.paymentSessionId || null;
    order.providerReference = session.providerReference || null;
    order.providerCheckoutUrl = session.checkoutUrl;
    order.status = 'PAYMENT_PENDING';
    order.paymentStatus = 'PENDING';
    order.settlementStatus = 'PENDING';
    order.expectedCryptoAmount = session.expectedCryptoAmount;
    order.updatedAt = new Date().toISOString();
    await storeSet(orderKey(order.orderId), order);
    await appendAudit(order.orderId, 'CHECKOUT_STARTED', { sessionId: order.sessionId, paymentSessionId: order.paymentSessionId });
    publish('CHECKOUT_STARTED', { orderId: order.orderId, provider: order.provider }, { source: 'buy-sell' });
    const response = { order: externalFacingOrder(order), checkoutUrl: session.checkoutUrl, checkoutMode: CHECKOUT_MODE };
    await completeOperation(claim, response);
    return { ok: true, status: 200, body: response };
  } catch {
    order.status = 'UNKNOWN'; order.paymentStatus = 'UNKNOWN'; order.updatedAt = new Date().toISOString();
    await storeSet(orderKey(order.orderId), order);
    await appendAudit(order.orderId, 'CHECKOUT_UNKNOWN');
    return { ok: false, status: 502, body: { error: 'CHECKOUT_UNKNOWN' } };
  }
}

async function rpcCall(chain, method, params) {
  let lastError = null;
  for (const endpoint of chain.rpc || []) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TTL.rpcMs);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: ctrl.signal
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || body?.error || body?.result == null) throw new Error('RPC_BAD_RESPONSE');
      return body.result;
    } catch (error) {
      lastError = error;
    } finally { clearTimeout(timer); }
  }
  const err = new Error('RPC_UNAVAILABLE');
  err.cause = lastError;
  throw err;
}

function decimalToUnits(value, decimals) {
  const raw = String(value ?? '').trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!match || decimals < 0 || decimals > 36) return null;
  const whole = match[1];
  const fraction = match[2] || '';
  if (fraction.length > decimals && /[1-9]/.test(fraction.slice(decimals))) return null;
  return BigInt(`${whole}${fraction.slice(0, decimals).padEnd(decimals, '0')}`);
}

function topicToAddress(topic) {
  if (typeof topic !== 'string' || !/^0x[0-9a-f]{64}$/i.test(topic)) return null;
  try { return getAddress(`0x${topic.slice(-40)}`); } catch { return null; }
}

/** Verify the actual receipt rather than a provider success page. */
export async function verifyEvmSettlement(order) {
  const chain = EVM_CHAINS[order?.chainId];
  const expectedHash = String(order?.txHash || '');
  if (!chain || !txHashPattern.test(expectedHash)) return { ok: false, code: 'TX_NOT_AVAILABLE' };
  try {
    const actualChain = Number(BigInt(await rpcCall(chain, 'eth_chainId', [])));
    if (actualChain !== order.chainId) return { ok: false, code: 'CHAIN_MISMATCH' };
    const [transaction, receipt, latestBlock] = await Promise.all([
      rpcCall(chain, 'eth_getTransactionByHash', [expectedHash]),
      rpcCall(chain, 'eth_getTransactionReceipt', [expectedHash]),
      rpcCall(chain, 'eth_blockNumber', [])
    ]);
    if (!transaction || !receipt) return { ok: false, code: 'TX_NOT_FOUND' };
    if (receipt.status !== '0x1') return { ok: false, code: 'TX_FAILED' };
    const blockNumber = Number(BigInt(receipt.blockNumber));
    const confirmations = Math.max(0, Number(BigInt(latestBlock)) - blockNumber + 1);
    const required = Math.max(1, Number(process.env.BUY_SELL_MIN_CONFIRMATIONS || 3));
    if (confirmations < required) return { ok: false, code: 'TX_CONFIRMING', confirmations, required, blockNumber };
    const recipient = getAddress(order.walletAddress);
    /* Prefer the provider-attested settlement units delivered in the signed
       webhook; fall back to the quoted expectation. Either way the number on
       the receipt itself is what decides. */
    let expectedAmount = null;
    if (order.settlementCryptoUnits != null) {
      try { expectedAmount = BigInt(String(order.settlementCryptoUnits)); } catch { expectedAmount = null; }
    } else {
      expectedAmount = decimalToUnits(order.settlementCryptoAmount ?? order.expectedCryptoAmount ?? order.cryptoAmount, order.tokenDecimals);
    }
    if (expectedAmount == null) return { ok: false, code: 'SETTLEMENT_AMOUNT_INVALID' };
    let amount = null;
    if (order.native) {
      if (!transaction.to || getAddress(transaction.to) !== recipient) return { ok: false, code: 'RECIPIENT_MISMATCH' };
      amount = BigInt(transaction.value);
    } else {
      const contract = String(order.tokenContract || '').toLowerCase();
      const transfers = (receipt.logs || []).filter((log) =>
        String(log.address || '').toLowerCase() === contract
        && String(log.topics?.[0] || '').toLowerCase() === TRANSFER_TOPIC
        && topicToAddress(log.topics?.[2]) === recipient
      );
      if (transfers.length !== 1) return { ok: false, code: transfers.length ? 'AMBIGUOUS_TRANSFER' : 'TOKEN_TRANSFER_NOT_FOUND' };
      amount = BigInt(transfers[0].data);
    }
    if (amount !== expectedAmount) return { ok: false, code: 'AMOUNT_MISMATCH' };
    const block = await rpcCall(chain, 'eth_getBlockByNumber', [receipt.blockNumber, false]);
    return {
      ok: true,
      txHash: expectedHash,
      chainId: actualChain,
      tokenContract: order.native ? null : order.tokenContract,
      recipient,
      amount: amount.toString(),
      decimals: order.tokenDecimals,
      confirmations,
      blockNumber,
      timestamp: block?.timestamp ? new Date(Number(BigInt(block.timestamp)) * 1000).toISOString() : null
    };
  } catch {
    return { ok: false, code: 'RPC_UNAVAILABLE' };
  }
}

async function writeVerification(order, verification) {
  order.updatedAt = new Date().toISOString();
  if (verification.ok) {
    order.status = 'COMPLETED';
    order.paymentStatus = 'CONFIRMED';
    order.settlementStatus = 'SETTLED';
    order.verificationStatus = 'VERIFIED';
    order.completedAt = order.updatedAt;
    order.blockchainVerification = verification;
    order.explorerTxUrl = order.explorerTxUrl || explorerTxUrl(verification.chainId, verification.txHash);
    await storeSet(orderKey(order.orderId), order);
    await storeSet(`buy-sell:blockchain-verification:${order.orderId}`, verification);
    await appendAudit(order.orderId, 'BUY_COMPLETED', { txHash: verification.txHash, blockNumber: verification.blockNumber });
    publish('TX_CONFIRMED', { orderId: order.orderId, txHash: verification.txHash, chainId: verification.chainId }, { source: 'buy-sell' });
    publish('BUY_COMPLETED', { orderId: order.orderId, asset: order.asset, network: order.network, txHash: verification.txHash }, { source: 'buy-sell' });
    publish('BALANCE_CHANGED', { walletAddress: order.walletAddress, chainId: order.chainId, source: 'blockchain-verification' }, { source: 'buy-sell' });
    publish('STATE_REFRESHED', { modules: ['wallet', 'portfolio', 'transactions', 'risk', 'goals', 'notifications', 'intent'] }, { source: 'buy-sell' });
    return order;
  }
  if (verification.code === 'TX_CONFIRMING') {
    order.status = 'TX_CONFIRMING'; order.verificationStatus = 'PENDING';
  } else if (verification.code === 'RPC_UNAVAILABLE') {
    order.status = 'VERIFICATION_PENDING'; order.verificationStatus = 'PENDING';
  } else if (verification.code === 'TX_NOT_AVAILABLE') {
    order.status = 'SETTLEMENT_PENDING'; order.verificationStatus = 'PENDING';
  } else {
    order.status = 'MANUAL_REVIEW'; order.verificationStatus = 'FAILED';
  }
  await storeSet(orderKey(order.orderId), order);
  await appendAudit(order.orderId, 'BLOCKCHAIN_VERIFICATION', { result: verification.code, txHash: order.txHash || null });
  return order;
}

export async function verifyBuySellOrder(orderId, orderAccessToken) {
  const order = await storeGet(orderKey(orderId), null);
  if (!validateOrderAccess(order, orderAccessToken)) return { ok: false, status: 404, body: { error: 'ORDER_NOT_FOUND' } };
  if (order.status === 'COMPLETED') return { ok: true, status: 200, body: { order: externalFacingOrder(order), verification: order.blockchainVerification || null } };
  if (order.paymentStatus !== 'CONFIRMED' || !order.txHash) {
    return { ok: true, status: 202, body: { order: externalFacingOrder(order), verification: { status: 'VERIFICATION_PENDING', reason: 'AWAITING_SIGNED_PROVIDER_SETTLEMENT' } } };
  }
  order.status = 'VERIFYING'; order.verificationStatus = 'IN_PROGRESS'; order.updatedAt = new Date().toISOString();
  await storeSet(orderKey(order.orderId), order);
  const verification = await verifyEvmSettlement(order);
  const saved = await writeVerification(order, verification);
  return { ok: verification.ok, status: verification.ok ? 200 : verification.code === 'RPC_UNAVAILABLE' ? 202 : 409, body: { order: externalFacingOrder(saved), verification } };
}

export async function getBuySellOrder(orderId, orderAccessToken, { verify = false } = {}) {
  if (verify) return verifyBuySellOrder(orderId, orderAccessToken);
  const order = await storeGet(orderKey(orderId), null);
  if (!validateOrderAccess(order, orderAccessToken)) return { ok: false, status: 404, body: { error: 'ORDER_NOT_FOUND' } };
  return { ok: true, status: 200, body: { order: externalFacingOrder(order) } };
}

/** Audit access is capability-bound to the same browser session as the order.
 * Details can contain provider session metadata, so this intentionally returns
 * a stable event timeline only—not request payloads, access hashes, or URLs. */
export async function getBuySellOrderAudit(orderId, orderAccessToken) {
  const order = await storeGet(orderKey(orderId), null);
  if (!validateOrderAccess(order, orderAccessToken)) return { ok: false, status: 404, body: { error: 'ORDER_NOT_FOUND' } };
  const raw = await storeGet(auditKey(order.orderId), []);
  const events = (Array.isArray(raw) ? raw : []).map((event) => ({ at: event?.at || null, type: String(event?.type || 'UNKNOWN') }));
  return { ok: true, status: 200, body: { orderId: order.orderId, events } };
}

export async function cancelBuySellOrder(orderId, orderAccessToken) {
  const order = await storeGet(orderKey(orderId), null);
  if (!validateOrderAccess(order, orderAccessToken)) return { ok: false, status: 404, body: { error: 'ORDER_NOT_FOUND' } };
  if (order.status !== 'AWAITING_CONFIRMATION') return { ok: false, status: 409, body: { error: 'CANCEL_UNAVAILABLE' } };
  order.status = 'CANCELLED'; order.updatedAt = new Date().toISOString();
  await storeSet(orderKey(order.orderId), order);
  await appendAudit(order.orderId, 'CANCELLED');
  return { ok: true, status: 200, body: { order: externalFacingOrder(order) } };
}

/**
 * Provider settlement webhook (Ramp Network).
 *
 * Ramp signs every webhook body with its ECDSA key (X-Body-Signature, base64
 * DER, sha256 over the stable-stringified JSON). Processing is enabled only
 * when the deployment has configured Ramp's published public key — an
 * unverifiable callback is rejected, never parsed as settlement evidence.
 *
 * A verified RELEASED event still does NOT complete the order. It records
 * the provider-reported transaction hash and settlement amount, then the
 * independent on-chain verifier must confirm chain, recipient, token, amount
 * and confirmations before the order can become COMPLETED.
 */
export async function handleBuySellProviderWebhook({ providerId, rawBody, signature, query } = {}) {
  if (String(providerId || '').toLowerCase() !== RAMP_PROVIDER_ID) {
    return { ok: false, status: 404, body: { error: 'PROVIDER_UNKNOWN' } };
  }
  const config = rampConfig();
  if (!config.webhookPublicKeyPem) {
    return {
      ok: false,
      status: 503,
      body: { error: 'PROVIDER_REQUIRES_INTEGRATION', detail: 'RAMP_WEBHOOK_PUBLIC_KEY_REQUIRED' }
    };
  }
  let event = null;
  try {
    event = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody ?? ''));
  } catch {
    return { ok: false, status: 400, body: { error: 'WEBHOOK_BODY_INVALID' } };
  }
  if (!verifyRampWebhookSignature(event, signature, config.webhookPublicKeyPem)) {
    return { ok: false, status: 401, body: { error: 'WEBHOOK_SIGNATURE_INVALID' } };
  }

  const orderId = String(query?.orderId || '');
  const hookToken = String(query?.hookToken || '');
  const order = await storeGet(orderKey(orderId), null);
  if (!order || !order.webhookAuthHash || !constantTokenMatch(hookToken, order.webhookAuthHash)) {
    /* Signed but uncorrelatable: acknowledge without acting so Ramp does not
       retry forever, and record nothing — no order may be mutated blindly. */
    return { ok: true, status: 200, body: { received: true, matched: false } };
  }
  if (order.status === 'COMPLETED' || order.status === 'CANCELLED') {
    return { ok: true, status: 200, body: { received: true, matched: true } };
  }

  const mapped = mapRampWebhookEvent(event);
  order.updatedAt = new Date().toISOString();
  if (mapped.providerReference) order.providerReference = mapped.providerReference;
  await appendAudit(order.orderId, 'PROVIDER_WEBHOOK', { kind: mapped.kind, purchaseStatus: mapped.purchaseStatus });

  if (mapped.kind === 'FAILED') {
    order.status = 'PAYMENT_FAILED';
    order.paymentStatus = 'FAILED';
    order.settlementStatus = 'FAILED';
    await storeSet(orderKey(order.orderId), order);
    publish('BUY_FAILED', { orderId: order.orderId, reason: mapped.purchaseStatus || 'PROVIDER_REPORTED_FAILURE' }, { source: 'buy-sell' });
    return { ok: true, status: 200, body: { received: true, matched: true } };
  }

  if (mapped.kind === 'RELEASED') {
    /* The provider must be settling to the wallet the order was created for.
       A mismatch is quarantined for manual review — never silently accepted. */
    if (mapped.receiverAddress) {
      try {
        if (getAddress(mapped.receiverAddress) !== getAddress(order.walletAddress)) {
          order.status = 'MANUAL_REVIEW';
          order.verificationStatus = 'FAILED';
          await storeSet(orderKey(order.orderId), order);
          await appendAudit(order.orderId, 'RECIPIENT_MISMATCH_QUARANTINED');
          return { ok: true, status: 200, body: { received: true, matched: true } };
        }
      } catch { /* non-EVM receiver formats are left to on-chain verification */ }
    }
    order.paymentStatus = 'CONFIRMED';
    order.settlementStatus = 'PROVIDER_REPORTED';
    if (mapped.finalTxHash && txHashPattern.test(mapped.finalTxHash)) {
      order.txHash = mapped.finalTxHash;
      order.explorerTxUrl = explorerTxUrl(order.chainId, order.txHash);
    }
    if (mapped.cryptoAmountUnits && /^\d+$/.test(mapped.cryptoAmountUnits)) {
      order.settlementCryptoUnits = mapped.cryptoAmountUnits;
    }
    order.status = order.txHash ? 'TX_DETECTED' : 'SETTLEMENT_PENDING';
    await storeSet(orderKey(order.orderId), order);
    publish('PAYMENT_CONFIRMED', { orderId: order.orderId, provider: order.provider }, { source: 'buy-sell' });
    /* Attempt on-chain verification immediately; failure keeps the order in
       an honest pending/confirming state which polling will retry. */
    if (order.txHash && String(order.side).toUpperCase() === 'BUY') {
      const verification = await verifyEvmSettlement(order);
      await writeVerification(order, verification);
    }
    return { ok: true, status: 200, body: { received: true, matched: true } };
  }

  /* PENDING / UNKNOWN: provider payment state moved but crypto has not been
     released. This never advances beyond PAYMENT_PENDING. */
  if (order.status === 'AWAITING_CONFIRMATION' || order.status === 'CHECKOUT_CREATED' || order.status === 'PAYMENT_PENDING') {
    order.status = 'PAYMENT_PENDING';
    order.paymentStatus = 'PENDING';
    await storeSet(orderKey(order.orderId), order);
  }
  return { ok: true, status: 200, body: { received: true, matched: true } };
}
