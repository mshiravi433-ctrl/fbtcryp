/**
 * Server-only Wallex OTC / withdrawal adapter for the Iranian USDT purchase
 * boundary. It intentionally contains no payment collection code: Wallex's
 * documented exchange endpoints operate the configured exchange account, not
 * an FBT customer's bank payment.
 *
 * No browser imports this module. Every request uses the server-held
 * X-API-Key and the base origin is pinned by iranBuyConfig before it is used.
 */
import { getAddress } from 'ethers';
import { IRAN_BUY_ASSET, IRAN_BUY_SYMBOL } from '../iranBuyConfig.js';

const API_TIMEOUT_MS = 15_000;
const MAX_JSON_BYTES = 128_000;
const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

export class WallexIranBuyError extends Error {
  constructor(code = 'WALLEX_PROVIDER_UNAVAILABLE', { status = 503, uncertain = false } = {}) {
    super(code);
    this.name = 'WallexIranBuyError';
    this.code = code;
    this.status = status;
    this.uncertain = uncertain;
  }
}

function validPositiveDecimal(value) {
  const raw = String(value ?? '').trim();
  if (!DECIMAL.test(raw) || Number(raw) <= 0 || !Number.isFinite(Number(raw))) return null;
  return raw;
}

function normalizedStatus(value) {
  return String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
}

function decimalNumberForWallex(value) {
  const raw = validPositiveDecimal(value);
  if (!raw) throw new WallexIranBuyError('WALLEX_AMOUNT_INVALID', { status: 400 });
  const out = Number(raw);
  /* Wallex documents `amount` / `value` as JSON numbers. Refuse values that
     JSON could turn into scientific notation or an unsafe integer rather than
     quietly changing the requested withdrawal. */
  if (!Number.isFinite(out) || out <= 0 || Math.abs(out) >= 1e15) {
    throw new WallexIranBuyError('WALLEX_AMOUNT_INVALID', { status: 400 });
  }
  return out;
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function exactAddressMatch(left, right) {
  try { return getAddress(String(left)) === getAddress(String(right)); } catch { return false; }
}

function parseDateAfterNow(value) {
  const at = Date.parse(String(value || ''));
  return Number.isFinite(at) && at > Date.now() ? new Date(at).toISOString() : null;
}

function normalizeMarket(raw) {
  const row = asObject(raw);
  if (!row
    || String(row.symbol || '').toUpperCase() !== IRAN_BUY_SYMBOL
    || String(row.baseAsset || '').toUpperCase() !== IRAN_BUY_ASSET
    || String(row.quoteAsset || '').toUpperCase() !== 'TMN'
    || normalizedStatus(row.buyStatus) !== 'ENABLE') {
    throw new WallexIranBuyError('WALLEX_USDTTMN_UNAVAILABLE', { status: 503 });
  }
  const baseAssetPrecision = Number(row.baseAssetPrecision);
  const stepSize = Number(row.stepSize);
  const minQty = validPositiveDecimal(row.minQty);
  const minNotional = validPositiveDecimal(row.minNotional);
  const maxNotional = row.maxNotional == null || row.maxNotional === '' ? null : validPositiveDecimal(row.maxNotional);
  if (!Number.isInteger(baseAssetPrecision) || baseAssetPrecision < 0 || baseAssetPrecision > 18
    || !Number.isInteger(stepSize) || stepSize < 0 || stepSize > baseAssetPrecision
    || !minQty || !minNotional || (row.maxNotional != null && !maxNotional)) {
    throw new WallexIranBuyError('WALLEX_MARKET_CONTRACT_INVALID', { status: 502 });
  }
  return {
    symbol: IRAN_BUY_SYMBOL,
    baseAsset: IRAN_BUY_ASSET,
    quoteAsset: 'TMN',
    /* stepSize, not a locally selected precision, controls tradable quantity. */
    quantityDecimals: stepSize,
    baseAssetPrecision,
    minQty,
    minNotional,
    maxNotional
  };
}

function normalizeQuote(raw) {
  const row = asObject(raw);
  const price = validPositiveDecimal(row?.price);
  const expiresAt = parseDateAfterNow(row?.price_expires_at);
  if (!price || !expiresAt) throw new WallexIranBuyError('WALLEX_QUOTE_INVALID', { status: 502 });
  return { price, expiresAt };
}

function normalizeOtcOrder(raw) {
  const row = asObject(raw);
  const clientOrderId = typeof row?.clientOrderId === 'string' && row.clientOrderId.length <= 160 ? row.clientOrderId : null;
  const executedQty = validPositiveDecimal(row?.executedQty);
  const executedSum = validPositiveDecimal(row?.executedSum);
  const status = normalizedStatus(row?.status);
  if (!clientOrderId || !status) throw new WallexIranBuyError('WALLEX_ORDER_CONTRACT_INVALID', { status: 502 });
  return {
    clientOrderId,
    status,
    executedQty,
    executedSum,
    executedPrice: validPositiveDecimal(row?.executedPrice),
    fills: Array.isArray(row.fills)
      ? row.fills.map((fill) => ({
          fee: validPositiveDecimal(fill?.fee) || null,
          feeAsset: String(fill?.feeAsset || '').toUpperCase() || null,
          quantity: validPositiveDecimal(fill?.quantity) || null
        })).slice(0, 40)
      : []
  };
}

function normalizeWithdrawal(raw, { expectedNetwork, expectedAddress } = {}) {
  const row = asObject(raw);
  const id = row?.id == null ? null : String(row.id);
  const walletAddress = typeof row?.wallet_address === 'string' ? row.wallet_address : null;
  const network = String(row?.network?.name || row?.network || '').toUpperCase();
  const amount = validPositiveDecimal(row?.amount ?? row?.value);
  const fee = row?.fee == null || row.fee === '' ? null : validPositiveDecimal(row.fee);
  const txHash = typeof row?.txHash === 'string' && /^0x[0-9a-f]{64}$/i.test(row.txHash) ? row.txHash : null;
  const status = normalizedStatus(row?.status);
  if (!id || !walletAddress || !network || !amount || !status) {
    throw new WallexIranBuyError('WALLEX_WITHDRAWAL_CONTRACT_INVALID', { status: 502 });
  }
  if (expectedNetwork && network !== String(expectedNetwork).toUpperCase()) {
    throw new WallexIranBuyError('WALLEX_WITHDRAWAL_NETWORK_MISMATCH', { status: 409 });
  }
  if (expectedAddress && !exactAddressMatch(walletAddress, expectedAddress)) {
    throw new WallexIranBuyError('WALLEX_WITHDRAWAL_RECIPIENT_MISMATCH', { status: 409 });
  }
  return {
    id,
    status,
    amount,
    fee,
    txHash,
    walletAddress: getAddress(walletAddress),
    network,
    explorerUrl: typeof row?.block_explorer_link === 'string' && /^https:\/\//i.test(row.block_explorer_link)
      ? row.block_explorer_link
      : null,
    createdAt: typeof row?.time === 'string' ? row.time : null
  };
}

/**
 * Create an adapter from explicit values so a focused probe can substitute
 * fetch without ever changing process.env. Production gets its values from
 * iranBuyConfig and cannot point the API key at arbitrary hosts.
 */
export function createWallexIranBuyProvider({ apiBase, apiKey, fetchImpl = globalThis.fetch, timeoutMs = API_TIMEOUT_MS } = {}) {
  let root;
  try { root = new URL(String(apiBase || '')); } catch { root = null; }
  if (!root || root.origin !== 'https://api.wallex.ir' || !apiKey || typeof fetchImpl !== 'function') {
    throw new WallexIranBuyError('WALLEX_PROVIDER_UNAVAILABLE', { status: 503 });
  }

  async function request(path, { method = 'GET', query, body, financiallyMutating = false } = {}) {
    const url = new URL(path, root);
    if (url.origin !== root.origin || url.protocol !== 'https:') {
      throw new WallexIranBuyError('WALLEX_PROVIDER_UNAVAILABLE', { status: 503 });
    }
    for (const [key, value] of Object.entries(query || {})) {
      if (value != null) url.searchParams.set(key, String(value));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1_000, Number(timeoutMs) || API_TIMEOUT_MS));
    try {
      const response = await fetchImpl(url, {
        method,
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-api-key': apiKey
        },
        body: body == null ? undefined : JSON.stringify(body),
        signal: controller.signal,
        cache: 'no-store',
        /* A redirect must never carry the server-only API key to an unreviewed
           host, even if a compromised/provider endpoint returns one. */
        redirect: 'error'
      });
      const contentLength = Number(response.headers?.get?.('content-length') || 0);
      if (contentLength > MAX_JSON_BYTES) throw new WallexIranBuyError('WALLEX_PROVIDER_RESPONSE_INVALID', { status: 502 });
      const text = await response.text().catch(() => '');
      if (Buffer.byteLength(text, 'utf8') > MAX_JSON_BYTES) {
        throw new WallexIranBuyError('WALLEX_PROVIDER_RESPONSE_INVALID', { status: 502 });
      }
      let payload = null;
      try { payload = JSON.parse(text); } catch { /* rejected below */ }
      if (!response.ok || !payload || payload.success !== true || payload.result == null) {
        const status = Number(response.status) === 429 ? 429 : Number(response.status) >= 400 && Number(response.status) < 500 ? 400 : 502;
        throw new WallexIranBuyError(
          Number(response.status) === 429 ? 'WALLEX_PROVIDER_RATE_LIMITED' : 'WALLEX_PROVIDER_REJECTED',
          { status, uncertain: financiallyMutating && Number(response.status) >= 500 }
        );
      }
      return payload.result;
    } catch (error) {
      if (error instanceof WallexIranBuyError) throw error;
      /* A network/timeout failure after POST might still have reached Wallex.
       * Callers must record it as reconciliation-required and MUST NOT retry. */
      throw new WallexIranBuyError('WALLEX_PROVIDER_UNCERTAIN', { status: 503, uncertain: financiallyMutating });
    } finally {
      clearTimeout(timer);
    }
  }

  return Object.freeze({
    id: 'wallex-otc-server',
    async getUsdttmnMarket() {
      const result = await request('/v1/otc/markets');
      return normalizeMarket(result?.symbols?.[IRAN_BUY_SYMBOL] || result?.[IRAN_BUY_SYMBOL]);
    },
    async getBuyQuote() {
      /* The legacy Wallex reference labels these fields a GET body. Browsers
       * and standards-compliant fetch implementations reject GET bodies, so
       * serialize the documented fields as query parameters. This adapter is
       * disabled until a production conformance test confirms this current API
       * contract with Wallex. */
      const result = await request('/v1/account/otc/price', {
        query: { symbol: IRAN_BUY_SYMBOL, side: 'BUY' }
      });
      return normalizeQuote(result);
    },
    async createOtcBuy({ quantity } = {}) {
      const result = await request('/v1/account/otc/orders', {
        method: 'POST',
        body: { symbol: IRAN_BUY_SYMBOL, side: 'BUY', amount: decimalNumberForWallex(quantity) },
        financiallyMutating: true
      });
      return normalizeOtcOrder(result);
    },
    async getOtcOrder(clientOrderId) {
      const id = encodeURIComponent(String(clientOrderId || ''));
      if (!id) throw new WallexIranBuyError('WALLEX_ORDER_CONTRACT_INVALID', { status: 400 });
      return normalizeOtcOrder(await request(`/v1/account/orders/${id}`));
    },
    async createUsdtWithdrawal({ network, amount, walletAddress } = {}) {
      const expectedAddress = getAddress(String(walletAddress || ''));
      const expectedNetwork = String(network || '').toUpperCase();
      if (!expectedNetwork) throw new WallexIranBuyError('WALLEX_WITHDRAWAL_NETWORK_MISMATCH', { status: 400 });
      const result = await request('/v1/account/crypto-withdrawal', {
        method: 'POST',
        body: {
          coin: IRAN_BUY_ASSET,
          network: expectedNetwork,
          value: decimalNumberForWallex(amount),
          wallet_address: expectedAddress
        },
        financiallyMutating: true
      });
      return normalizeWithdrawal(result, { expectedNetwork, expectedAddress });
    },
    async getWithdrawal(withdrawalId, { network, walletAddress } = {}) {
      const id = String(withdrawalId || '');
      if (!id) throw new WallexIranBuyError('WALLEX_WITHDRAWAL_CONTRACT_INVALID', { status: 400 });
      const rows = await request('/v1/account/crypto-withdrawal', { query: { page: 1, per_page: 100 } });
      const match = Array.isArray(rows) ? rows.find((row) => String(row?.id) === id) : null;
      if (!match) throw new WallexIranBuyError('WALLEX_WITHDRAWAL_NOT_FOUND', { status: 404 });
      return normalizeWithdrawal(match, { expectedNetwork: network, expectedAddress: walletAddress });
    }
  });
}

export function wallexIranBuyProvider(config) {
  return createWallexIranBuyProvider({ apiBase: config?.wallex?.apiBase, apiKey: config?.wallex?.apiKey });
}

export const __wallexIranBuy = Object.freeze({
  normalizeMarket,
  normalizeQuote,
  normalizeOtcOrder,
  normalizeWithdrawal,
  validPositiveDecimal
});
