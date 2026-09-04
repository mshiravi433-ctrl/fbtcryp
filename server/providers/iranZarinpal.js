/**
 * Server-only ZarinPal payment collection adapter for the Iranian USDT buy.
 *
 * Why a payment adapter exists at all: a Wallex exchange API key operates the
 * *operator* exchange account. It is not a customer Toman payment rail. To
 * charge a customer legally and verifiably, a real Iranian PSP contract is
 * required. ZarinPal publishes a stable, documented REST contract, so this
 * adapter implements exactly that contract and nothing more:
 *
 *   1. POST /pg/v4/payment/request.json  → an `authority` + a hosted checkout
 *   2. redirect the customer to          → {checkout}/pg/StartPay/{authority}
 *   3. POST /pg/v4/payment/verify.json   → server-authoritative confirmation
 *   4. POST /pg/v4/payment/unVerified.json (operator reconciliation only)
 *
 * Sources: https://www.zarinpal.com/docs/paymentGateway/connectToGateway and
 * https://www.zarinpal.com/docs/sdk/php/method/verify
 *
 * Safety properties this module guarantees:
 *  - the browser never sees the merchant id and never chooses an amount that
 *    was not already stored server-side on the order;
 *  - the returned checkout URL is composed here from a pinned host, never
 *    echoed from a provider/browser-supplied string;
 *  - a payment is "paid" only when ZarinPal's own verify call answers 100/101
 *    for the exact stored amount. The `Status=OK` query parameter the browser
 *    comes back with is treated as a hint, never as evidence;
 *  - a lost/timed-out POST is reported as UNCERTAIN so the caller can re-run
 *    verify (idempotent) instead of charging a second time. `request` is never
 *    auto-retried: a second authority is a second potential charge.
 */
const API_TIMEOUT_MS = 15_000;
const MAX_JSON_BYTES = 64_000;
const AUTHORITY = /^[A-Za-z0-9]{20,80}$/;

/* ZarinPal REST hosts. sandbox.zarinpal.com speaks the *legacy* WebGate API
   with different field names, so it is deliberately not accepted here. */
const ALLOWED_API_ORIGINS = new Set(['https://payment.zarinpal.com', 'https://api.zarinpal.com']);
const ALLOWED_CHECKOUT_ORIGINS = new Set(['https://payment.zarinpal.com', 'https://www.zarinpal.com']);

/* Documented verify outcomes. 100 = verified now, 101 = already verified
   (both mean the money was collected exactly once). Everything else is not a
   payment. The negative codes below are documented as terminal. */
const VERIFIED_CODES = new Set([100, 101]);
const TERMINAL_FAILURE_CODES = new Set([-50, -51, -53, -54, -55]);

export class ZarinpalIranBuyError extends Error {
  constructor(code = 'PAYMENT_PROVIDER_UNAVAILABLE', { status = 503, uncertain = false, providerCode = null } = {}) {
    super(code);
    this.name = 'ZarinpalIranBuyError';
    this.code = code;
    this.status = status;
    this.uncertain = uncertain;
    this.providerCode = providerCode;
  }
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

/** ZarinPal amounts are integers. Toman → Rial is the documented ×10 factor. */
export function tomanToRial(amountToman) {
  const raw = String(amountToman ?? '').trim();
  if (!/^[1-9]\d{0,15}$/.test(raw)) throw new ZarinpalIranBuyError('PAYMENT_AMOUNT_INVALID', { status: 400 });
  const rial = BigInt(raw) * 10n;
  /* Shaparak/PSP ceiling guard: refuse a value JSON would turn into an unsafe
     integer before it can become a real charge instruction. */
  if (rial < 1_000n || rial > 5_000_000_000n) throw new ZarinpalIranBuyError('PAYMENT_AMOUNT_INVALID', { status: 400 });
  return Number(rial);
}

function providerCodeOf(payload) {
  const data = asObject(payload?.data);
  const code = Number(data?.code);
  if (Number.isInteger(code)) return code;
  const errors = asObject(payload?.errors) || (Array.isArray(payload?.errors) ? payload.errors[0] : null);
  const errorCode = Number(asObject(errors)?.code);
  return Number.isInteger(errorCode) ? errorCode : null;
}

export function createZarinpalIranBuyProvider({
  apiBase = 'https://payment.zarinpal.com',
  checkoutBase = 'https://payment.zarinpal.com',
  merchantId,
  fetchImpl = globalThis.fetch,
  timeoutMs = API_TIMEOUT_MS
} = {}) {
  let root;
  let checkoutRoot;
  try { root = new URL(String(apiBase || '')); } catch { root = null; }
  try { checkoutRoot = new URL(String(checkoutBase || '')); } catch { checkoutRoot = null; }
  const merchant = String(merchantId || '').trim();
  if (!root || !ALLOWED_API_ORIGINS.has(root.origin)
    || !checkoutRoot || !ALLOWED_CHECKOUT_ORIGINS.has(checkoutRoot.origin)
    || !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(merchant)
    || typeof fetchImpl !== 'function') {
    throw new ZarinpalIranBuyError('PAYMENT_PROVIDER_UNAVAILABLE', { status: 503 });
  }

  async function post(path, body, { financiallyMutating = false } = {}) {
    const url = new URL(path, root);
    if (url.origin !== root.origin || url.protocol !== 'https:') {
      throw new ZarinpalIranBuyError('PAYMENT_PROVIDER_UNAVAILABLE', { status: 503 });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1_000, Number(timeoutMs) || API_TIMEOUT_MS));
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
        cache: 'no-store',
        /* A redirect must never carry the merchant id to an unreviewed host. */
        redirect: 'error'
      });
      const text = await response.text().catch(() => '');
      if (Buffer.byteLength(text, 'utf8') > MAX_JSON_BYTES) {
        throw new ZarinpalIranBuyError('PAYMENT_PROVIDER_RESPONSE_INVALID', { status: 502 });
      }
      let payload = null;
      try { payload = JSON.parse(text); } catch { /* rejected below */ }
      if (!payload || typeof payload !== 'object') {
        throw new ZarinpalIranBuyError('PAYMENT_PROVIDER_RESPONSE_INVALID', { status: 502 });
      }
      /* ZarinPal answers 200 for business failures too, so the HTTP status is
         only used to detect infrastructure problems. */
      if (response.status === 429) throw new ZarinpalIranBuyError('PAYMENT_PROVIDER_RATE_LIMITED', { status: 429 });
      if (response.status >= 500) {
        throw new ZarinpalIranBuyError('PAYMENT_PROVIDER_UNCERTAIN', { status: 503, uncertain: financiallyMutating });
      }
      return payload;
    } catch (error) {
      if (error instanceof ZarinpalIranBuyError) throw error;
      /* Network loss after a POST leaves the provider state unknown. */
      throw new ZarinpalIranBuyError('PAYMENT_PROVIDER_UNCERTAIN', { status: 503, uncertain: financiallyMutating });
    } finally {
      clearTimeout(timer);
    }
  }

  return Object.freeze({
    id: 'zarinpal',
    currency: 'IRR',

    /**
     * Create one hosted-checkout intent for an amount that is already stored
     * on a durable order. Never called twice for the same order.
     */
    async createPayment({ amountToman, callbackUrl, description, orderId, mobile } = {}) {
      const amount = tomanToRial(amountToman);
      let callback;
      try { callback = new URL(String(callbackUrl || '')); } catch { callback = null; }
      if (!callback || callback.protocol !== 'https:' || callback.hash) {
        throw new ZarinpalIranBuyError('PAYMENT_CALLBACK_INVALID', { status: 500 });
      }
      const payload = await post('/pg/v4/payment/request.json', {
        merchant_id: merchant,
        amount,
        currency: 'IRR',
        description: String(description || 'FBT — USDT purchase').slice(0, 255),
        callback_url: callback.toString(),
        metadata: {
          order_id: String(orderId || '').slice(0, 64),
          ...(mobile && /^09\d{9}$/.test(String(mobile)) ? { mobile: String(mobile) } : {})
        }
      }, { financiallyMutating: true });
      const code = providerCodeOf(payload);
      const authority = String(asObject(payload?.data)?.authority || '').trim();
      if (code !== 100 || !AUTHORITY.test(authority)) {
        throw new ZarinpalIranBuyError('PAYMENT_PROVIDER_REJECTED', { status: 502, providerCode: code });
      }
      return {
        provider: 'zarinpal',
        authority,
        amountRial: String(amount),
        /* Composed here from the pinned checkout origin — never taken from the
           provider payload, so a compromised response cannot redirect a payer
           to an arbitrary host. */
        checkoutUrl: new URL(`/pg/StartPay/${encodeURIComponent(authority)}`, checkoutRoot).toString(),
        feeType: typeof asObject(payload?.data)?.fee_type === 'string' ? asObject(payload.data).fee_type : null
      };
    },

    /**
     * The only source of truth for "the customer paid". Idempotent by
     * contract: a second call for a verified authority answers code 101.
     */
    async verifyPayment({ amountToman, authority } = {}) {
      const amount = tomanToRial(amountToman);
      const reference = String(authority || '').trim();
      if (!AUTHORITY.test(reference)) throw new ZarinpalIranBuyError('PAYMENT_AUTHORITY_INVALID', { status: 400 });
      const payload = await post('/pg/v4/payment/verify.json', {
        merchant_id: merchant,
        amount,
        authority: reference
      });
      const code = providerCodeOf(payload);
      const data = asObject(payload?.data) || {};
      if (VERIFIED_CODES.has(code)) {
        const refId = data.ref_id == null ? null : String(data.ref_id).slice(0, 40);
        if (!refId) throw new ZarinpalIranBuyError('PAYMENT_PROVIDER_RESPONSE_INVALID', { status: 502 });
        return {
          verified: true,
          alreadyVerified: code === 101,
          providerCode: code,
          refId,
          /* Card data is deliberately dropped here: it is never stored, logged,
             audited, or returned to the browser. */
          feeRial: data.fee == null ? null : String(data.fee).slice(0, 20)
        };
      }
      return {
        verified: false,
        providerCode: code,
        /* Terminal means "this authority will never become a payment": the
           order can be released. Anything else stays retryable. */
        terminal: TERMINAL_FAILURE_CODES.has(Number(code))
      };
    },

    /** Operator reconciliation for payments collected but never verified. */
    async listUnverified() {
      const payload = await post('/pg/v4/payment/unVerified.json', { merchant_id: merchant });
      const rows = asObject(payload?.data)?.authorities;
      return Array.isArray(rows)
        ? rows
          .filter((row) => AUTHORITY.test(String(asObject(row)?.authority || '')))
          .map((row) => ({
            authority: String(row.authority),
            amountRial: row.amount == null ? null : String(row.amount),
            at: typeof row.date === 'string' ? row.date : null
          }))
          .slice(0, 200)
        : [];
    }
  });
}

export function zarinpalIranBuyProvider(config) {
  return createZarinpalIranBuyProvider({
    apiBase: config?.payment?.apiBase,
    checkoutBase: config?.payment?.checkoutBase,
    merchantId: config?.payment?.merchantId
  });
}

export const __zarinpalIranBuy = Object.freeze({
  tomanToRial,
  providerCodeOf,
  VERIFIED_CODES,
  TERMINAL_FAILURE_CODES
});
