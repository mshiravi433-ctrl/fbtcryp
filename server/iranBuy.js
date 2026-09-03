/**
 * Iranian-only USDT purchase workflow.
 *
 * This is a deliberately separate financial namespace from Buy/Sell's Ramp
 * checkout. Wallex's documented private API is an exchange-account API, not
 * evidence of a customer Toman-payment checkout, so this module is fail-closed
 * until a reviewed payment collector and current Wallex settlement contract
 * exist. The state machine is present to make those future integrations
 * auditable; it never fabricates a payment, quote, fill, withdrawal, or
 * blockchain receipt.
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { getAddress, verifyMessage } from 'ethers';
import { EVM_CHAINS } from './chainsLite.js';
import { storeGetFresh, storeSet } from './store.js';
import {
  upstashConfigured,
  upstashGetAtomic,
  upstashReleaseAtomicLease,
  upstashSetAtomic,
  upstashSetIfAbsent
} from './blobCache.js';
import {
  IRAN_BUY_ASSET,
  IRAN_BUY_SCHEMA,
  iranBuyConfig,
  publicIranBuyCapability,
  validIranBuyToman,
  validateIranBuyEvmDestination
} from './iranBuyConfig.js';
import { WallexIranBuyError, wallexIranBuyProvider } from './providers/iranWallex.js';
import { publish } from './central/eventBus.js';

export const IRAN_BUY_ORDER_SCHEMA = 'fbt.iran-buy-order.v1';
export const IRAN_BUY_ORDER_STATES = Object.freeze([
  'CREATED',
  'PAYMENT_PENDING',
  'PAYMENT_PROCESSING',
  'PAYMENT_CONFIRMED',
  'PROCESSING',
  'SETTLEMENT_PENDING',
  'SENT',
  'CONFIRMED',
  'FAILED',
  'CANCELLED',
  'EXPIRED'
]);

const TTL = Object.freeze({
  challengeMs: 5 * 60_000,
  bindingMs: 10 * 60_000,
  previewMs: 10 * 60_000,
  orderMs: 90 * 24 * 60 * 60_000,
  idempotencyMs: 36 * 60 * 60_000,
  /* Covers two provider calls plus durable writes; a short lease expiry could
     admit a parallel financial transition while the first is still uncertain. */
  leaseMs: 2 * 60_000,
  rpcMs: 12_000
});
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const REQUEST_ID = /^[A-Za-z0-9._:-]{16,128}$/;
const TX_HASH = /^0x[0-9a-f]{64}$/i;
const DECIMAL = /^(0|[1-9]\d*)(?:\.(\d+))?$/;
const MAX_AUDIT_ROWS = 120;

export class IranBuyError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = 'IranBuyError';
    this.code = code;
    this.status = status;
  }
}

const fail = (code, status = 400) => { throw new IranBuyError(code, status); };
const hash = (value) => createHash('sha256').update(String(value)).digest('hex');
const opaqueToken = () => randomBytes(32).toString('base64url');
const isoNow = () => new Date().toISOString();
const ownerHash = (ownerId) => hash(`telegram:${String(ownerId || '')}`);
const orderKey = (id) => `iran-buy:order:${id}`;
const auditKey = (id) => `iran-buy:audit:${id}`;
const challengeKey = (id) => `iran-buy:wallet-challenge:${id}`;
const bindingKey = (tokenValue) => `iran-buy:wallet-binding:${hash(tokenValue)}`;
const previewKey = (id) => `iran-buy:preview:${id}`;
const idempotencyKey = (owner, key) => `iran-buy:idempotency:${owner}:${hash(key)}`;
const orderLeaseKey = (id) => `iran-buy:order-lease:${id}`;

function constantTokenMatch(provided, expectedHash) {
  if (typeof provided !== 'string' || typeof expectedHash !== 'string') return false;
  const candidate = Buffer.from(hash(provided));
  const expected = Buffer.from(expectedHash);
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

function normalizeOwnerId(value) {
  const owner = String(value || '').trim();
  if (!/^\d{1,20}$/.test(owner)) fail('AUTH_REQUIRED', 401);
  return owner;
}

function requireAvailable(config = iranBuyConfig()) {
  if (!config.available || !upstashConfigured()) fail('IRAN_BUY_DISABLED', 503);
  return config;
}

function toPublicError(error) {
  if (error instanceof IranBuyError) return error;
  if (error instanceof WallexIranBuyError) {
    return new IranBuyError(
      error.code === 'WALLEX_PROVIDER_RATE_LIMITED' ? 'PROVIDER_RATE_LIMITED'
        : error.code === 'WALLEX_PROVIDER_UNCERTAIN' ? 'PROVIDER_STATUS_UNCERTAIN'
          : 'PROVIDER_UNAVAILABLE',
      error.status === 429 ? 429 : 503
    );
  }
  return new IranBuyError('IRAN_BUY_UNAVAILABLE', 503);
}

function shortAddress(address) {
  const raw = String(address || '');
  return raw.length > 12 ? `${raw.slice(0, 6)}…${raw.slice(-4)}` : raw;
}

function externalFacingOrder(order) {
  if (!order) return null;
  const {
    ownerIdHash,
    accessTokenHash,
    idempotencyKeyHash,
    walletBindingHash,
    walletSettlementAuthorizationHash,
    providerSubmission,
    providerWithdrawalSubmission,
    internalFailure,
    ...safe
  } = order;
  return {
    ...safe,
    /* `actualUsdtAmount` is only populated after Wallex has reported a filled
       order and the amount selected for withdrawal. It is never an estimate
       derived in the browser. */
    actualUsdtAmount: order.withdrawalAmount || null,
    destinationDisplay: shortAddress(order.destinationAddress),
    /* Full address is returned only after BOTH the same signed Telegram owner
       and this order's opaque session capability have been verified. The UI
       needs it to prove its currently connected account never changed. */
    destinationAddress: order.destinationAddress
  };
}

async function appendAudit(orderId, type, details = {}) {
  const key = auditKey(orderId);
  const previous = await storeGetFresh(key, []);
  const rows = Array.isArray(previous) ? previous : [];
  /* Do not put raw signatures, payment payloads, checkout URLs, API output,
     card data, or credentials in the audit timeline. */
  const event = { at: isoNow(), type: String(type || 'UNKNOWN').slice(0, 80), details };
  await storeSet(key, [...rows, event].slice(-MAX_AUDIT_ROWS));
  return event;
}

function decimalParts(value) {
  const raw = String(value ?? '').trim();
  const match = DECIMAL.exec(raw);
  if (!match) return null;
  const [, whole, fraction = ''] = match;
  if (fraction.length > 36) return null;
  try {
    return { raw, units: BigInt(`${whole}${fraction}`), scale: fraction.length };
  } catch { return null; }
}

function unitPower(power) {
  if (!Number.isInteger(power) || power < 0 || power > 72) return null;
  return 10n ** BigInt(power);
}

function compareDecimals(left, right) {
  const a = decimalParts(left);
  const b = decimalParts(right);
  if (!a || !b) return null;
  const scale = Math.max(a.scale, b.scale);
  const av = a.units * unitPower(scale - a.scale);
  const bv = b.units * unitPower(scale - b.scale);
  return av < bv ? -1 : av > bv ? 1 : 0;
}

function decimalToUnitsExact(value, decimals) {
  const parsed = decimalParts(value);
  if (!parsed || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null;
  if (parsed.scale > decimals && /[1-9]/.test(parsed.raw.split('.')[1]?.slice(decimals) || '')) return null;
  return parsed.units * unitPower(decimals - Math.min(parsed.scale, decimals));
}

function unitsToDecimal(units, decimals) {
  if (typeof units !== 'bigint' || units <= 0n || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null;
  if (decimals === 0) return units.toString();
  const raw = units.toString().padStart(decimals + 1, '0');
  const whole = raw.slice(0, -decimals) || '0';
  const fraction = raw.slice(-decimals).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

/** Calculate a tradable USDT amount from an actual provider quote — never from a local price. */
export function calculateIranBuyQuantity({ tomanAmount, price, quantityDecimals }) {
  const amount = decimalParts(tomanAmount);
  const unitPrice = decimalParts(price);
  if (!amount || !unitPrice || amount.units <= 0n || unitPrice.units <= 0n
    || !Number.isInteger(quantityDecimals) || quantityDecimals < 0 || quantityDecimals > 18) {
    return null;
  }
  /* `price` is TMN / USDT. Quantity is rounded DOWN to the market's documented
     step precision so an amount can never be rounded up into an unapproved
     customer charge. */
  const numerator = amount.units * unitPower(quantityDecimals + unitPrice.scale);
  const denominator = unitPrice.units * unitPower(amount.scale);
  const units = numerator / denominator;
  return unitsToDecimal(units, quantityDecimals);
}

function subtractDecimal(left, right) {
  const a = decimalParts(left);
  const b = decimalParts(right);
  if (!a || !b) return null;
  const scale = Math.max(a.scale, b.scale);
  const av = a.units * unitPower(scale - a.scale);
  const bv = b.units * unitPower(scale - b.scale);
  if (av <= bv) return null;
  return unitsToDecimal(av - bv, scale);
}

function sumFees(fills, asset) {
  const values = (Array.isArray(fills) ? fills : [])
    .filter((fill) => String(fill?.feeAsset || '').toUpperCase() === asset)
    .map((fill) => String(fill?.fee || ''));
  if (!values.length) return '0';
  const parsed = values.map(decimalParts);
  if (parsed.some((entry) => !entry)) return null;
  const scale = Math.max(...parsed.map((entry) => entry.scale));
  const sum = parsed.reduce((total, entry) => total + entry.units * unitPower(scale - entry.scale), 0n);
  return unitsToDecimal(sum, scale) || '0';
}

function enoughForMarket(amountToman, market) {
  if (compareDecimals(amountToman, market.minNotional) < 0) return { ok: false, code: 'AMOUNT_BELOW_MINIMUM' };
  if (market.maxNotional && compareDecimals(amountToman, market.maxNotional) > 0) return { ok: false, code: 'AMOUNT_ABOVE_MAXIMUM' };
  return { ok: true };
}

function buildWalletMessage({ action, address, network, chainId, nonce, orderId = null, expiresAt }) {
  const purpose = action === 'AUTHORIZE_SETTLEMENT'
    ? 'تأیید نهایی کیف پول مقصد برای ارسال'
    : 'تأیید کیف پول مقصد';
  return [
    'FBT Swap — خرید USDT با تومان',
    `هدف امضا: ${purpose}`,
    orderId ? `شناسه سفارش: ${orderId}` : null,
    `کیف پول مقصد: ${address}`,
    `شبکه: ${network}`,
    `شناسه شبکه: ${chainId}`,
    `شناسه یک‌بارمصرف: ${nonce}`,
    `انقضا: ${expiresAt}`,
    'این امضا تراکنش بلاک‌چین یا مجوز برداشت ایجاد نمی‌کند.'
  ].filter(Boolean).join('\n');
}

async function loadBinding(bindingToken, owner, config) {
  if (typeof bindingToken !== 'string' || bindingToken.length < 30) fail('WALLET_BINDING_REQUIRED', 401);
  const binding = await storeGetFresh(bindingKey(bindingToken), null);
  if (!binding || binding.expiresAt <= Date.now() || binding.ownerIdHash !== ownerHash(owner)) {
    fail('WALLET_BINDING_REQUIRED', 401);
  }
  const destination = validateIranBuyEvmDestination(binding.address, binding.chainId, config);
  if (!destination.ok) fail(destination.code, 409);
  return binding;
}

function assertOrderAccess(order, owner, accessToken) {
  if (!order || order.ownerIdHash !== ownerHash(owner) || !constantTokenMatch(accessToken, order.accessTokenHash)) {
    fail('ORDER_NOT_FOUND', 404);
  }
  return order;
}

async function withOrderLease(orderId, worker) {
  if (!upstashConfigured()) fail('IRAN_BUY_DISABLED', 503);
  const lease = { leaseHash: hash(opaqueToken()), at: Date.now() };
  const key = orderLeaseKey(orderId);
  const claimed = await upstashSetIfAbsent(key, lease, TTL.leaseMs);
  if (!claimed) fail('REQUEST_IN_PROGRESS', 409);
  try { return await worker(); }
  finally { await upstashReleaseAtomicLease(key, lease).catch(() => false); }
}

async function saveOrder(order) {
  order.updatedAt = isoNow();
  await storeSet(orderKey(order.orderId), order);
  return order;
}

async function withIdempotency({ owner, requestId, fingerprint, action }) {
  if (!REQUEST_ID.test(String(requestId || ''))) fail('IDEMPOTENCY_KEY_REQUIRED', 400);
  if (!upstashConfigured()) fail('IRAN_BUY_DISABLED', 503);
  const key = idempotencyKey(ownerHash(owner), requestId);
  const lease = { fingerprint, state: 'PROCESSING', startedAt: Date.now() };
  const claimed = await upstashSetIfAbsent(key, lease, TTL.idempotencyMs);
  if (!claimed) {
    const prior = await upstashGetAtomic(key);
    if (!prior) fail('REQUEST_IN_PROGRESS', 409);
    if (prior.fingerprint !== fingerprint) fail('IDEMPOTENCY_CONFLICT', 409);
    if (prior.state === 'COMPLETE' && prior.response) return { ...prior.response, replayed: true };
    if (prior.state === 'FAILED') fail(prior.errorCode || 'REQUEST_FAILED', prior.status || 409);
    fail('REQUEST_IN_PROGRESS', 409);
  }
  try {
    const response = await action();
    const saved = await upstashSetAtomic(key, { ...lease, state: 'COMPLETE', response, completedAt: Date.now() }, TTL.idempotencyMs);
    if (!saved) fail('DURABLE_STORE_REQUIRED', 503);
    return response;
  } catch (error) {
    const safe = toPublicError(error);
    await upstashSetAtomic(key, { ...lease, state: 'FAILED', errorCode: safe.code, status: safe.status, completedAt: Date.now() }, TTL.idempotencyMs).catch(() => false);
    throw safe;
  }
}

export function getIranBuyCapability() {
  return publicIranBuyCapability();
}

/** Sign a short-lived, non-transaction message before the server accepts a destination. */
export async function createIranBuyWalletChallenge({ ownerId, address, chainId } = {}) {
  const owner = normalizeOwnerId(ownerId);
  const config = requireAvailable();
  const destination = validateIranBuyEvmDestination(address, chainId, config);
  if (!destination.ok) fail(destination.code, 409);
  const challengeId = `irbc_${randomUUID()}`;
  const nonce = opaqueToken();
  const expiresAt = Date.now() + TTL.challengeMs;
  const message = buildWalletMessage({
    action: 'VERIFY_DESTINATION',
    address: destination.address,
    network: config.network.id,
    chainId: config.network.chainId,
    nonce,
    expiresAt: new Date(expiresAt).toISOString()
  });
  await storeSet(challengeKey(challengeId), {
    schema: IRAN_BUY_SCHEMA,
    challengeId,
    ownerIdHash: ownerHash(owner),
    address: destination.address,
    chainId: config.network.chainId,
    network: config.network.id,
    action: 'VERIFY_DESTINATION',
    message,
    expiresAt,
    createdAt: isoNow()
  });
  return { challengeId, message, expiresAt: new Date(expiresAt).toISOString() };
}

export async function verifyIranBuyWalletChallenge({ ownerId, challengeId, signature } = {}) {
  const owner = normalizeOwnerId(ownerId);
  const config = requireAvailable();
  const id = String(challengeId || '');
  const challenge = await storeGetFresh(challengeKey(id), null);
  if (!challenge || challenge.ownerIdHash !== ownerHash(owner) || challenge.expiresAt <= Date.now()
    || challenge.action !== 'VERIFY_DESTINATION') fail('WALLET_CHALLENGE_EXPIRED', 409);
  if (typeof signature !== 'string' || signature.length > 512) fail('WALLET_SIGNATURE_INVALID', 401);
  let signer;
  try { signer = getAddress(verifyMessage(challenge.message, signature)); } catch { signer = null; }
  if (!signer || signer !== challenge.address) fail('WALLET_SIGNATURE_INVALID', 401);
  const consumed = await upstashSetIfAbsent(`iran-buy:wallet-challenge-used:${id}`, { at: Date.now() }, TTL.challengeMs);
  if (!consumed) fail('WALLET_CHALLENGE_USED', 409);
  const bindingToken = opaqueToken();
  const expiresAt = Date.now() + TTL.bindingMs;
  await storeSet(bindingKey(bindingToken), {
    schema: IRAN_BUY_SCHEMA,
    ownerIdHash: ownerHash(owner),
    address: challenge.address,
    chainId: challenge.chainId,
    network: challenge.network,
    bindingHash: hash(bindingToken),
    expiresAt,
    createdAt: isoNow()
  });
  return {
    walletBindingToken: bindingToken,
    address: challenge.address,
    network: config.network.id,
    chainId: config.network.chainId,
    expiresAt: new Date(expiresAt).toISOString()
  };
}

/**
 * Server-side preview. The browser sends Toman and an opaque signed-wallet
 * binding, never a rate, USDT quantity, asset, network, or destination.
 */
export async function createIranBuyPreview({ ownerId, amountToman, walletBindingToken } = {}) {
  const owner = normalizeOwnerId(ownerId);
  const config = requireAvailable();
  const amount = validIranBuyToman(amountToman, config);
  if (!amount.ok) fail(amount.code, 400);
  const binding = await loadBinding(walletBindingToken, owner, config);
  const provider = wallexIranBuyProvider(config);
  let market; let quote;
  try {
    [market, quote] = await Promise.all([provider.getUsdttmnMarket(), provider.getBuyQuote()]);
  } catch (error) { throw toPublicError(error); }
  const marketCheck = enoughForMarket(amount.amount, market);
  if (!marketCheck.ok) fail(marketCheck.code, 400);
  const quantity = calculateIranBuyQuantity({
    tomanAmount: amount.amount,
    price: quote.price,
    quantityDecimals: market.quantityDecimals
  });
  if (!quantity || compareDecimals(quantity, market.minQty) < 0) fail('AMOUNT_BELOW_MINIMUM', 400);
  const previewId = `irbp_${randomUUID()}`;
  const accessToken = opaqueToken();
  const providerExpiry = Date.parse(quote.expiresAt);
  const expiresAt = Math.min(Date.now() + TTL.previewMs, providerExpiry);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) fail('QUOTE_EXPIRED', 409);
  await storeSet(previewKey(previewId), {
    schema: IRAN_BUY_SCHEMA,
    previewId,
    ownerIdHash: ownerHash(owner),
    accessTokenHash: hash(accessToken),
    walletBindingHash: binding.bindingHash,
    destinationAddress: binding.address,
    chainId: binding.chainId,
    network: config.network.id,
    amountToman: amount.amount,
    /* Provider-derived values stay server-side. An OTC quote is not a final
       customer receipt and the UI deliberately does not print a rate. */
    providerQuotePrice: quote.price,
    providerQuoteExpiresAt: quote.expiresAt,
    requestedQuantity: quantity,
    market,
    expiresAt,
    createdAt: isoNow()
  });
  return {
    preview: {
      previewId,
      accessToken,
      amountToman: amount.amount,
      asset: IRAN_BUY_ASSET,
      network: { id: config.network.id, label: config.network.label, chainId: config.network.chainId },
      destinationAddress: binding.address,
      expiresAt: new Date(expiresAt).toISOString(),
      /* These remain intentionally null until a provider-reported execution
         and withdrawal exist. No local USDT/fee calculation is presented as a
         final amount. */
      actualUsdtAmount: null,
      fee: null
    }
  };
}

async function loadPreview({ owner, previewId, accessToken, binding, config }) {
  const preview = await storeGetFresh(previewKey(String(previewId || '')), null);
  if (!preview || preview.ownerIdHash !== ownerHash(owner) || !constantTokenMatch(accessToken, preview.accessTokenHash)) {
    fail('PREVIEW_NOT_FOUND', 404);
  }
  if (preview.expiresAt <= Date.now()) fail('QUOTE_EXPIRED', 409);
  if (preview.walletBindingHash !== binding.bindingHash || preview.destinationAddress !== binding.address
    || preview.network !== config.network.id || Number(preview.chainId) !== Number(config.network.chainId)) {
    fail('WALLET_BINDING_REQUIRED', 409);
  }
  return preview;
}

/**
 * Create a durable payment-pending order. It does not debit, buy, or withdraw
 * anything. A production payment adapter must create a real customer payment
 * and deliver an independently signed confirmation before settlement can be
 * authorized; no adapter is currently approved, so requireAvailable() blocks
 * this method in every ordinary deployment.
 */
export async function createIranBuyOrder({ ownerId, previewId, previewAccessToken, walletBindingToken, idempotencyKey: bodyKey } = {}, headerIdempotencyKey = '') {
  const owner = normalizeOwnerId(ownerId);
  const config = requireAvailable();
  const headerKey = String(headerIdempotencyKey || '');
  const bodyRequestKey = String(bodyKey || '');
  /* The browser sends the same key in both places. Never silently choose one
     if a proxy/body mutation made them disagree: that defeats replay intent. */
  if (headerKey && bodyRequestKey && headerKey !== bodyRequestKey) fail('IDEMPOTENCY_CONFLICT', 409);
  const requestId = headerKey || bodyRequestKey;
  const binding = await loadBinding(walletBindingToken, owner, config);
  const fingerprint = hash([ownerHash(owner), previewId, binding.bindingHash, config.network.id].join(':'));
  return withIdempotency({ owner, requestId, fingerprint, action: async () => {
    const preview = await loadPreview({ owner, previewId, accessToken: previewAccessToken, binding, config });
    const orderId = `irbo_${randomUUID()}`;
    const accessToken = opaqueToken();
    const now = isoNow();
    const order = {
      schema: IRAN_BUY_ORDER_SCHEMA,
      orderId,
      ownerIdHash: ownerHash(owner),
      accessTokenHash: hash(accessToken),
      idempotencyKeyHash: hash(requestId),
      walletBindingHash: binding.bindingHash,
      asset: IRAN_BUY_ASSET,
      network: config.network.id,
      networkLabel: config.network.label,
      chainId: config.network.chainId,
      walletType: 'EVM',
      destinationAddress: preview.destinationAddress,
      amountToman: preview.amountToman,
      requestedQuantity: preview.requestedQuantity,
      status: 'CREATED',
      paymentStatus: 'NOT_STARTED',
      settlementStatus: 'NOT_STARTED',
      verificationStatus: 'NOT_STARTED',
      provider: 'wallex-otc-server',
      requiresWalletSettlementAuthorization: true,
      createdAt: now,
      updatedAt: now,
      expiresAt: Date.now() + TTL.orderMs
    };
    await storeSet(orderKey(orderId), order);
    await appendAudit(orderId, 'ORDER_CREATED', {
      asset: IRAN_BUY_ASSET,
      network: config.network.id,
      amountToman: preview.amountToman,
      destinationHash: hash(preview.destinationAddress)
    });
    /* There is deliberately no generated bank link, card number, receipt, or
       checkout URL here. That would invent an unsupported payment rail. */
    order.status = 'PAYMENT_PENDING';
    order.paymentStatus = 'PENDING';
    await saveOrder(order);
    await appendAudit(orderId, 'PAYMENT_AWAITING_VERIFIED_COLLECTION');
    return { order: externalFacingOrder(order), orderAccessToken: accessToken };
  }});
}


export async function createIranBuySettlementChallenge({ ownerId, orderId, orderAccessToken } = {}) {
  const owner = normalizeOwnerId(ownerId);
  const config = requireAvailable();
  const order = await storeGetFresh(orderKey(String(orderId || '')), null);
  assertOrderAccess(order, owner, orderAccessToken);
  if (order.status !== 'PAYMENT_CONFIRMED' || order.paymentStatus !== 'CONFIRMED') {
    fail('ORDER_NOT_READY', 409);
  }
  const destination = validateIranBuyEvmDestination(order.destinationAddress, order.chainId, config);
  if (!destination.ok) fail(destination.code, 409);
  const challengeId = `irbs_${randomUUID()}`;
  const nonce = opaqueToken();
  const expiresAt = Date.now() + TTL.challengeMs;
  const message = buildWalletMessage({
    action: 'AUTHORIZE_SETTLEMENT',
    orderId: order.orderId,
    address: destination.address,
    network: config.network.id,
    chainId: config.network.chainId,
    nonce,
    expiresAt: new Date(expiresAt).toISOString()
  });
  await storeSet(challengeKey(challengeId), {
    schema: IRAN_BUY_SCHEMA,
    challengeId,
    ownerIdHash: ownerHash(owner),
    orderId: order.orderId,
    address: destination.address,
    chainId: config.network.chainId,
    network: config.network.id,
    action: 'AUTHORIZE_SETTLEMENT',
    message,
    expiresAt,
    createdAt: isoNow()
  });
  return { challengeId, message, expiresAt: new Date(expiresAt).toISOString() };
}

function executionNetAmount(execution) {
  if (!execution?.executedQty || !Array.isArray(execution.fills) || execution.fills.some((fill) => !fill?.feeAsset || fill.fee == null)) return null;
  const fee = sumFees(execution.fills, IRAN_BUY_ASSET);
  if (fee == null) return null;
  return { net: fee === '0' ? execution.executedQty : subtractDecimal(execution.executedQty, fee), fee };
}

function withdrawalStatusIsTerminalFailure(status) {
  return ['FAILED', 'REJECTED', 'CANCELLED', 'CANCELED'].includes(String(status || '').toUpperCase());
}

function withdrawalStatusHasBroadcast(status) {
  return ['ACCOMPLISHED', 'CONFIRMED', 'COMPLETED', 'SUCCESS', 'SENT'].includes(String(status || '').toUpperCase());
}

async function rpcCall(chain, method, params) {
  const urls = Array.isArray(chain?.rpc) ? chain.rpc : [];
  let last = null;
  for (const url of urls) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TTL.rpcMs);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: controller.signal,
        cache: 'no-store'
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || body?.error || body?.result == null) throw new Error('RPC_BAD_RESPONSE');
      return body.result;
    } catch (error) { last = error; }
    finally { clearTimeout(timer); }
  }
  throw last || new Error('RPC_UNAVAILABLE');
}

function topicToAddress(topic) {
  if (typeof topic !== 'string' || !/^0x[0-9a-f]{64}$/i.test(topic)) return null;
  try { return getAddress(`0x${topic.slice(-40)}`); } catch { return null; }
}

async function verifyIranBuyEvmSettlement(order, config) {
  const chain = EVM_CHAINS[order.chainId];
  if (!chain || !TX_HASH.test(String(order.txHash || '')) || !order.withdrawalAmount) return { ok: false, code: 'TX_NOT_AVAILABLE' };
  try {
    const [actualChain, receipt, latest] = await Promise.all([
      rpcCall(chain, 'eth_chainId', []),
      rpcCall(chain, 'eth_getTransactionReceipt', [order.txHash]),
      rpcCall(chain, 'eth_blockNumber', [])
    ]);
    if (Number(BigInt(actualChain)) !== Number(order.chainId)) return { ok: false, code: 'CHAIN_MISMATCH' };
    if (!receipt) return { ok: false, code: 'TX_NOT_FOUND' };
    if (receipt.status !== '0x1') return { ok: false, code: 'TX_FAILED' };
    const blockNumber = Number(BigInt(receipt.blockNumber));
    const confirmations = Math.max(0, Number(BigInt(latest)) - blockNumber + 1);
    if (confirmations < config.settlement.minConfirmations) {
      return { ok: false, code: 'TX_CONFIRMING', confirmations, required: config.settlement.minConfirmations, blockNumber };
    }
    const expected = decimalToUnitsExact(order.withdrawalAmount, config.network.tokenDecimals);
    if (expected == null) return { ok: false, code: 'SETTLEMENT_AMOUNT_INVALID' };
    const recipient = getAddress(order.destinationAddress);
    const contract = String(config.network.tokenContract).toLowerCase();
    const transfers = (receipt.logs || []).filter((log) =>
      String(log?.address || '').toLowerCase() === contract
      && String(log?.topics?.[0] || '').toLowerCase() === TRANSFER_TOPIC
      && topicToAddress(log?.topics?.[2]) === recipient
    );
    if (transfers.length !== 1) return { ok: false, code: transfers.length ? 'AMBIGUOUS_TRANSFER' : 'TOKEN_TRANSFER_NOT_FOUND' };
    const amount = BigInt(transfers[0].data);
    if (amount !== expected) return { ok: false, code: 'AMOUNT_MISMATCH' };
    const block = await rpcCall(chain, 'eth_getBlockByNumber', [receipt.blockNumber, false]);
    return {
      ok: true,
      txHash: order.txHash,
      chainId: order.chainId,
      recipient,
      tokenContract: config.network.tokenContract,
      amount: amount.toString(),
      decimals: config.network.tokenDecimals,
      confirmations,
      blockNumber,
      timestamp: block?.timestamp ? new Date(Number(BigInt(block.timestamp)) * 1000).toISOString() : null
    };
  } catch { return { ok: false, code: 'RPC_UNAVAILABLE' }; }
}

async function writeIranBuyVerification(order, verification, config) {
  if (verification.ok) {
    order.status = 'CONFIRMED';
    order.paymentStatus = 'CONFIRMED';
    order.settlementStatus = 'SETTLED';
    order.verificationStatus = 'VERIFIED';
    order.completedAt = isoNow();
    order.blockchainVerification = verification;
    order.explorerTxUrl = `${EVM_CHAINS[order.chainId].explorer}/tx/${order.txHash}`;
    await saveOrder(order);
    await appendAudit(order.orderId, 'BLOCKCHAIN_VERIFIED', { txHash: order.txHash, blockNumber: verification.blockNumber });
    publish('IRAN_BUY_CONFIRMED', { orderId: order.orderId, asset: IRAN_BUY_ASSET, txHash: order.txHash }, { source: 'iran-buy' });
    publish('BALANCE_CHANGED', { walletAddress: order.destinationAddress, chainId: order.chainId }, { source: 'iran-buy' });
    return order;
  }
  if (verification.code === 'TX_CONFIRMING') {
    order.status = 'SENT'; order.verificationStatus = 'PENDING';
  } else if (['RPC_UNAVAILABLE', 'TX_NOT_FOUND', 'TX_NOT_AVAILABLE'].includes(verification.code)) {
    order.status = 'SETTLEMENT_PENDING'; order.verificationStatus = 'PENDING';
  } else {
    /* A provider report is not enough to call a receipt confirmed. Keep the
       source amount/status but quarantine the order for operator reconciliation. */
    order.status = 'FAILED'; order.verificationStatus = 'FAILED'; order.internalFailure = verification.code;
  }
  await saveOrder(order);
  await appendAudit(order.orderId, 'BLOCKCHAIN_VERIFICATION', { result: verification.code, txHash: order.txHash || null });
  return order;
}

async function recordOtcExecution(order, execution) {
  if (execution.status !== 'FILLED' || !execution.executedQty || !execution.executedSum) {
    order.status = 'PROCESSING';
    order.settlementStatus = 'AWAITING_OTC_FILL';
    order.providerOrderId = execution.clientOrderId;
    order.providerOrderStatus = execution.status;
    await saveOrder(order);
    await appendAudit(order.orderId, 'OTC_ORDER_PENDING', { providerOrderId: execution.clientOrderId, status: execution.status });
    return false;
  }
  if (compareDecimals(execution.executedSum, order.amountToman) > 0) {
    /* Detection happens AFTER the unknown-execution risk but BEFORE a
       withdrawal. This is why the live capability remains disabled pending a
       documented cost cap / treasury policy. */
    order.status = 'FAILED';
    order.settlementStatus = 'BLOCKED';
    order.internalFailure = 'WALLEX_COST_EXCEEDS_PAYMENT';
    order.providerOrderId = execution.clientOrderId;
    await saveOrder(order);
    await appendAudit(order.orderId, 'OTC_COST_CAP_BREACH', { providerOrderId: execution.clientOrderId });
    return false;
  }
  const net = executionNetAmount(execution);
  if (!net?.net) {
    order.status = 'FAILED';
    order.settlementStatus = 'BLOCKED';
    order.internalFailure = 'WALLEX_FEE_UNREPORTED';
    await saveOrder(order);
    await appendAudit(order.orderId, 'OTC_FEE_UNREPORTED');
    return false;
  }
  order.providerOrderId = execution.clientOrderId;
  order.providerOrderStatus = execution.status;
  order.executedUsdtAmount = execution.executedQty;
  order.executedTomanAmount = execution.executedSum;
  order.tradeFee = net.fee;
  order.withdrawalAmount = net.net;
  order.status = 'SETTLEMENT_PENDING';
  order.settlementStatus = 'READY_FOR_WITHDRAWAL';
  await saveOrder(order);
  await appendAudit(order.orderId, 'OTC_ORDER_FILLED', { providerOrderId: execution.clientOrderId, feeAsset: IRAN_BUY_ASSET });
  return true;
}

async function submitWithdrawalOnce(order, config, provider) {
  if (order.providerWithdrawalId || order.providerWithdrawalSubmission?.attemptedAt) return order;
  order.status = 'SETTLEMENT_PENDING';
  order.settlementStatus = 'WITHDRAWAL_SUBMITTING';
  order.providerWithdrawalSubmission = { attemptedAt: isoNow(), requestHash: hash(`${order.withdrawalAmount}:${order.destinationAddress}:${order.network}`) };
  await saveOrder(order);
  await appendAudit(order.orderId, 'WITHDRAWAL_SUBMISSION_STARTED');
  let withdrawal;
  try {
    withdrawal = await provider.createUsdtWithdrawal({
      network: config.network.id,
      amount: order.withdrawalAmount,
      walletAddress: order.destinationAddress
    });
  } catch (error) {
    /* No retry. The provider might have accepted the command before the
       network response was lost; an automatic second withdrawal can pay twice. */
    order.providerWithdrawalSubmission = { ...order.providerWithdrawalSubmission, outcome: 'UNKNOWN', error: toPublicError(error).code };
    order.settlementStatus = 'RECONCILIATION_REQUIRED';
    await saveOrder(order);
    await appendAudit(order.orderId, 'WITHDRAWAL_SUBMISSION_UNCERTAIN');
    return order;
  }
  if (compareDecimals(withdrawal.amount, order.withdrawalAmount) !== 0) {
    order.providerWithdrawalId = withdrawal.id;
    order.status = 'SETTLEMENT_PENDING';
    order.settlementStatus = 'RECONCILIATION_REQUIRED';
    order.internalFailure = 'WITHDRAWAL_AMOUNT_MISMATCH';
    await saveOrder(order);
    await appendAudit(order.orderId, 'WITHDRAWAL_AMOUNT_MISMATCH', { withdrawalId: withdrawal.id });
    return order;
  }
  order.providerWithdrawalId = withdrawal.id;
  order.providerWithdrawalStatus = withdrawal.status;
  order.withdrawalFee = withdrawal.fee;
  order.txHash = withdrawal.txHash;
  order.status = withdrawalStatusIsTerminalFailure(withdrawal.status) ? 'FAILED'
    : withdrawal.txHash && withdrawalStatusHasBroadcast(withdrawal.status) ? 'SENT' : 'SETTLEMENT_PENDING';
  order.settlementStatus = withdrawalStatusIsTerminalFailure(withdrawal.status) ? 'FAILED'
    : withdrawal.txHash ? 'BROADCAST_REPORTED' : 'WITHDRAWAL_PENDING';
  await saveOrder(order);
  await appendAudit(order.orderId, 'WITHDRAWAL_REPORTED', { withdrawalId: withdrawal.id, status: withdrawal.status, hasTxHash: Boolean(withdrawal.txHash) });
  return order;
}

async function settleAuthorizedOrder(order, config) {
  if (order.status !== 'PAYMENT_CONFIRMED' || !order.walletSettlementAuthorizedAt) return order;
  const provider = wallexIranBuyProvider(config);
  order.status = 'PROCESSING';
  order.settlementStatus = 'OTC_SUBMITTING';
  order.providerSubmission = { attemptedAt: isoNow(), requestHash: hash(`${order.amountToman}:${order.destinationAddress}:${order.network}`) };
  await saveOrder(order);
  await appendAudit(order.orderId, 'OTC_SUBMISSION_STARTED');

  let market; let quote;
  try { [market, quote] = await Promise.all([provider.getUsdttmnMarket(), provider.getBuyQuote()]); }
  catch (error) {
    order.providerSubmission = { ...order.providerSubmission, outcome: 'QUOTE_UNAVAILABLE', error: toPublicError(error).code };
    order.settlementStatus = 'RECONCILIATION_REQUIRED';
    await saveOrder(order);
    await appendAudit(order.orderId, 'OTC_QUOTE_UNAVAILABLE');
    return order;
  }
  if (Date.parse(quote.expiresAt) <= Date.now()) {
    order.status = 'EXPIRED'; order.settlementStatus = 'NOT_STARTED';
    await saveOrder(order); await appendAudit(order.orderId, 'OTC_QUOTE_EXPIRED');
    return order;
  }
  const marketCheck = enoughForMarket(order.amountToman, market);
  const quantity = marketCheck.ok ? calculateIranBuyQuantity({
    tomanAmount: order.amountToman, price: quote.price, quantityDecimals: market.quantityDecimals
  }) : null;
  if (!marketCheck.ok || !quantity || compareDecimals(quantity, market.minQty) < 0) {
    order.status = 'FAILED'; order.settlementStatus = 'BLOCKED'; order.internalFailure = marketCheck.code || 'AMOUNT_BELOW_MINIMUM';
    await saveOrder(order); await appendAudit(order.orderId, 'OTC_MARKET_VALIDATION_FAILED');
    return order;
  }
  let execution;
  try { execution = await provider.createOtcBuy({ quantity }); }
  catch (error) {
    /* Exactly like withdrawal submission, a failed POST response is unknown,
       not a reason to submit a second exchange order. */
    order.providerSubmission = { ...order.providerSubmission, outcome: 'UNKNOWN', error: toPublicError(error).code };
    order.settlementStatus = 'RECONCILIATION_REQUIRED';
    await saveOrder(order); await appendAudit(order.orderId, 'OTC_SUBMISSION_UNCERTAIN');
    return order;
  }
  order.providerSubmission = { ...order.providerSubmission, outcome: 'REPORTED' };
  const filled = await recordOtcExecution(order, execution);
  if (filled) await submitWithdrawalOnce(order, config, provider);
  return order;
}

export async function authorizeIranBuySettlement({ ownerId, orderId, orderAccessToken, challengeId, signature } = {}) {
  const owner = normalizeOwnerId(ownerId);
  const config = requireAvailable();
  const id = String(orderId || '');
  const challenge = await storeGetFresh(challengeKey(String(challengeId || '')), null);
  if (!challenge || challenge.ownerIdHash !== ownerHash(owner) || challenge.orderId !== id
    || challenge.action !== 'AUTHORIZE_SETTLEMENT' || challenge.expiresAt <= Date.now()) {
    fail('WALLET_CHALLENGE_EXPIRED', 409);
  }
  if (typeof signature !== 'string' || signature.length > 512) fail('WALLET_SIGNATURE_INVALID', 401);
  let signer;
  try { signer = getAddress(verifyMessage(challenge.message, signature)); } catch { signer = null; }
  if (!signer || signer !== challenge.address) fail('WALLET_SIGNATURE_INVALID', 401);
  const consumed = await upstashSetIfAbsent(`iran-buy:wallet-challenge-used:${challenge.challengeId}`, { at: Date.now() }, TTL.challengeMs);
  if (!consumed) fail('WALLET_CHALLENGE_USED', 409);

  return withOrderLease(id, async () => {
    const order = await storeGetFresh(orderKey(id), null);
    assertOrderAccess(order, owner, orderAccessToken);
    if (order.status !== 'PAYMENT_CONFIRMED' || order.paymentStatus !== 'CONFIRMED') fail('ORDER_NOT_READY', 409);
    /* This is the final settlement gate: the signer from the current browser
       must equal the durable order destination. No copied/pasted replacement
       address can enter after a payment has been confirmed. */
    if (getAddress(order.destinationAddress) !== signer || Number(order.chainId) !== Number(challenge.chainId)) {
      fail('WALLET_DESTINATION_CHANGED', 409);
    }
    order.walletSettlementAuthorizedAt = isoNow();
    order.walletSettlementAuthorizationHash = hash(signature);
    await saveOrder(order);
    await appendAudit(order.orderId, 'DESTINATION_REAUTHORIZED', { destinationHash: hash(order.destinationAddress) });
    const progressed = await settleAuthorizedOrder(order, config);
    return { order: externalFacingOrder(progressed) };
  });
}

async function pollOrderUnsafe(order, config) {
  if (order.status === 'CONFIRMED' || order.status === 'FAILED' || order.status === 'CANCELLED' || order.status === 'EXPIRED') return order;
  if (order.expiresAt <= Date.now() && ['CREATED', 'PAYMENT_PENDING', 'PAYMENT_PROCESSING'].includes(order.status)) {
    order.status = 'EXPIRED'; order.paymentStatus = order.paymentStatus === 'CONFIRMED' ? 'CONFIRMED' : 'EXPIRED';
    await saveOrder(order); await appendAudit(order.orderId, 'ORDER_EXPIRED');
    return order;
  }
  /* Never perform provider polling/settlement if a config has been removed;
     users can still read their existing durable record, but no secret-bearing
     call is made from an unready deployment. */
  if (!config.available) return order;
  const provider = wallexIranBuyProvider(config);
  if (order.providerOrderId && !order.providerWithdrawalId && !order.providerWithdrawalSubmission?.attemptedAt) {
    try {
      const execution = await provider.getOtcOrder(order.providerOrderId);
      const filled = await recordOtcExecution(order, execution);
      if (filled) await submitWithdrawalOnce(order, config, provider);
    } catch {
      /* Read polling failure stays pending; it is not a provider rejection. */
      await appendAudit(order.orderId, 'OTC_STATUS_UNAVAILABLE');
    }
  }
  if (order.providerWithdrawalId && !withdrawalStatusIsTerminalFailure(order.providerWithdrawalStatus)) {
    try {
      const withdrawal = await provider.getWithdrawal(order.providerWithdrawalId, {
        network: config.network.id,
        walletAddress: order.destinationAddress
      });
      order.providerWithdrawalStatus = withdrawal.status;
      if (withdrawal.txHash) order.txHash = withdrawal.txHash;
      if (withdrawalStatusIsTerminalFailure(withdrawal.status)) {
        order.status = 'FAILED'; order.settlementStatus = 'FAILED';
        await saveOrder(order); await appendAudit(order.orderId, 'WITHDRAWAL_FAILED', { withdrawalId: withdrawal.id });
      } else if (order.txHash && withdrawalStatusHasBroadcast(withdrawal.status)) {
        order.status = 'SENT'; order.settlementStatus = 'BROADCAST_REPORTED';
        await saveOrder(order);
      } else {
        order.status = 'SETTLEMENT_PENDING'; order.settlementStatus = 'WITHDRAWAL_PENDING';
        await saveOrder(order);
      }
    } catch {
      await appendAudit(order.orderId, 'WITHDRAWAL_STATUS_UNAVAILABLE');
    }
  }
  if (order.txHash && ['SENT', 'SETTLEMENT_PENDING'].includes(order.status)) {
    const verification = await verifyIranBuyEvmSettlement(order, config);
    await writeIranBuyVerification(order, verification, config);
  }
  return order;
}

export async function getIranBuyOrder({ ownerId, orderId, orderAccessToken, poll = true } = {}) {
  const owner = normalizeOwnerId(ownerId);
  const id = String(orderId || '');
  let order = await storeGetFresh(orderKey(id), null);
  assertOrderAccess(order, owner, orderAccessToken);
  if (poll) {
    try {
      order = await withOrderLease(id, async () => {
        const fresh = await storeGetFresh(orderKey(id), null);
        assertOrderAccess(fresh, owner, orderAccessToken);
        return pollOrderUnsafe(fresh, iranBuyConfig());
      });
    } catch (error) {
      /* Another poll owns the tiny lease. Returning the last durable record is
         safer than treating that contention as a payment/settlement failure. */
      if (!(error instanceof IranBuyError) || error.code !== 'REQUEST_IN_PROGRESS') throw error;
    }
  }
  return { order: externalFacingOrder(order) };
}

export async function getIranBuyOrderAudit({ ownerId, orderId, orderAccessToken } = {}) {
  const owner = normalizeOwnerId(ownerId);
  const order = await storeGetFresh(orderKey(String(orderId || '')), null);
  assertOrderAccess(order, owner, orderAccessToken);
  const events = await storeGetFresh(auditKey(order.orderId), []);
  return {
    orderId: order.orderId,
    /* Details are retained internally for audit/reconciliation but intentionally
       withheld from the browser: do not leak provider/payment metadata. */
    events: (Array.isArray(events) ? events : []).map((event) => ({ at: event?.at || null, type: event?.type || 'UNKNOWN' }))
  };
}

export async function cancelIranBuyOrder({ ownerId, orderId, orderAccessToken } = {}) {
  const owner = normalizeOwnerId(ownerId);
  const id = String(orderId || '');
  return withOrderLease(id, async () => {
    const order = await storeGetFresh(orderKey(id), null);
    assertOrderAccess(order, owner, orderAccessToken);
    if (!['CREATED', 'PAYMENT_PENDING', 'PAYMENT_PROCESSING'].includes(order.status) || order.paymentStatus === 'CONFIRMED') {
      fail('CANCEL_UNAVAILABLE', 409);
    }
    order.status = 'CANCELLED';
    order.paymentStatus = 'CANCELLED';
    order.settlementStatus = 'NOT_STARTED';
    await saveOrder(order);
    await appendAudit(order.orderId, 'ORDER_CANCELLED');
    return { order: externalFacingOrder(order) };
  });
}

/** Route wrappers use this to preserve only named, user-safe failures. */
export function iranBuyPublicFailure(error) {
  const safe = toPublicError(error);
  const allowed = new Set([
    'IRAN_BUY_DISABLED', 'AUTH_REQUIRED', 'AMOUNT_INVALID', 'AMOUNT_BELOW_MINIMUM', 'AMOUNT_ABOVE_MAXIMUM',
    'WALLET_NETWORK_INCOMPATIBLE', 'WALLET_ADDRESS_INVALID', 'WALLET_BINDING_REQUIRED', 'WALLET_CHALLENGE_EXPIRED',
    'WALLET_CHALLENGE_USED', 'WALLET_SIGNATURE_INVALID', 'WALLET_DESTINATION_CHANGED', 'PREVIEW_NOT_FOUND',
    'QUOTE_EXPIRED', 'IDEMPOTENCY_KEY_REQUIRED', 'IDEMPOTENCY_CONFLICT', 'REQUEST_IN_PROGRESS', 'DURABLE_STORE_REQUIRED',
    'ORDER_NOT_FOUND', 'ORDER_NOT_READY', 'CANCEL_UNAVAILABLE',
    'PROVIDER_RATE_LIMITED', 'PROVIDER_STATUS_UNCERTAIN', 'PROVIDER_UNAVAILABLE', 'IRAN_BUY_UNAVAILABLE'
  ]);
  return { status: allowed.has(safe.code) ? safe.status : 503, code: allowed.has(safe.code) ? safe.code : 'IRAN_BUY_UNAVAILABLE' };
}

export const __iranBuy = Object.freeze({
  compareDecimals,
  decimalToUnitsExact,
  unitsToDecimal,
  buildWalletMessage,
  executionNetAmount,
  toPublicError
});
