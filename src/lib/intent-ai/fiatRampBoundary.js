/**
 * Intent OS Buy / Sell safety boundary.
 *
 * A natural-language request to use a bank card or bank account is never an
 * authorization to start a payment. Intent OS may recognize the request and
 * direct the user to the native Buy / Sell screen, where provider availability,
 * eligibility, destination, quote freshness and explicit confirmation are
 * checked. It never supplies a third-party trading link or opens checkout.
 */
import { classifyFailure } from './failureModes.js';

export const RAMP_SCHEMA = 'fbt.buy-sell-intent-boundary.v2';
/* The current provider adapter is deliberately fail-closed pending its
   official authenticated settlement contract. This is availability, not a
   promise that Intent OS can turn on with a prompt. */
export const RAMP_SUPPORTED = false;

export const FIAT_CURRENCIES = Object.freeze([
  'USD', 'EUR', 'GBP', 'TRY', 'AED', 'IRR', 'INR', 'IDR', 'RUB', 'BRL', 'CNY', 'PKR'
]);

const FIAT_WORDS = Object.freeze([
  'bank', 'card', 'visa', 'mastercard', 'wire', 'sepa', 'iban', 'paypal',
  'deposit cash', 'withdraw cash', 'cash out', 'cash in', 'top up', 'topup'
]);

const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean'
  ? null
  : (Number.isFinite(Number(v)) ? Number(v) : null));

/** Identify a real-world money request without interpreting it as consent. */
export function detectFiatIntent({ text = null, intent = null } = {}) {
  const raw = String(text ?? '').toLowerCase();
  const signals = [];
  for (const word of FIAT_WORDS) if (raw.includes(word)) signals.push(word);
  for (const currency of FIAT_CURRENCIES) {
    if (new RegExp(`\\b${currency.toLowerCase()}\\b`).test(raw)) signals.push(currency);
  }
  if (/\b(onramp|on-ramp|offramp|off-ramp|fiat)\b/.test(raw)) signals.push('ramp');
  const direction = /\b(withdraw|cash out|off-?ramp|sell to (bank|card))\b/.test(raw)
    ? 'offramp'
    : (signals.length ? 'onramp' : null);
  const fiatSymbol = FIAT_CURRENCIES.includes(String(intent?.fromSymbol || '').toUpperCase())
    || FIAT_CURRENCIES.includes(String(intent?.toSymbol || '').toUpperCase());
  if (fiatSymbol) signals.push('FIAT_SYMBOL');
  return {
    schema: RAMP_SCHEMA,
    isFiat: signals.length > 0 || fiatSymbol,
    direction: signals.length || fiatSymbol ? (direction || 'onramp') : null,
    signals: [...new Set(signals)]
  };
}

/**
 * The only permitted AI response to a fiat request: a route to the native
 * surface. This response authorizes neither a payment session nor a provider
 * redirect. Provider availability is checked afresh by that surface.
 */
export function fiatBoundaryResponse({ detection = null, now = Date.now() } = {}) {
  if (!detection?.isFiat) return { ok: true, applies: false, blocked: false };
  return {
    ok: true,
    schema: RAMP_SCHEMA,
    applies: true,
    blocked: true,
    supported: RAMP_SUPPORTED,
    direction: detection.direction,
    i18nKey: detection.direction === 'offramp' ? 'intentAI.ramp.sellUnavailable' : 'intentAI.ramp.buyUnavailable',
    alternativeI18nKey: 'intentAI.ramp.openBuySell',
    route: '/buy',
    thirdParty: [],
    executionAuthorized: false,
    at: now
  };
}

/** A crypto-swapping route cannot be silently converted into a fiat purchase. */
export function filterMisleadingRoutes({ routes = [] } = {}) {
  const rows = Array.isArray(routes) ? routes : [];
  const kept = [];
  const removed = [];
  for (const route of rows) {
    const isFiat = FIAT_CURRENCIES.includes(String(route?.fromSymbol || '').toUpperCase())
      || FIAT_CURRENCIES.includes(String(route?.toSymbol || '').toUpperCase())
      || route?.kind === 'fiat' || route?.rampRequired === true;
    if (isFiat) removed.push({ id: route?.id ?? null, reason: 'FIAT_ROUTE_NOT_SUPPORTED' });
    else kept.push(route);
  }
  return {
    ok: true,
    schema: RAMP_SCHEMA,
    routes: kept,
    removed,
    i18nKey: removed.length ? 'intentAI.ramp.routesRemoved' : null
  };
}

/** Assert that no view turns detection, a return URL, or a prompt into consent. */
export function assertNoRampPromise(view) {
  const reasons = [];
  if (view?.supported === true && RAMP_SUPPORTED !== true) reasons.push('CLAIMS_RAMP_SUPPORT');
  if (view?.blocked === false && view?.applies === true) reasons.push('FIAT_INTENT_NOT_BLOCKED');
  if (view?.executionAuthorized === true) reasons.push('FIAT_EXECUTION_AUTHORIZED');
  if (view?.route && view.route !== '/buy') reasons.push('UNSAFE_FIAT_ROUTE');
  if (Array.isArray(view?.thirdParty) && view.thirdParty.length) reasons.push('THIRD_PARTY_PROVIDER_NOT_ALLOWED');
  for (const route of Array.isArray(view?.routes) ? view.routes : []) {
    if (route?.rampRequired === true) reasons.push('MISLEADING_ROUTE');
  }
  if (num(view?.estimatedBankSettlementMs) !== null) reasons.push('PROMISES_BANK_SETTLEMENT');
  const unique = [...new Set(reasons)];
  return unique.length
    ? { ok: false, reasons: unique, error: classifyFailure('MISSING_DATA', { detail: unique[0] }) }
    : { ok: true };
}
