/**
 * FBT INTENT AI — PHASE 88: HONEST FIAT RAMP BOUNDARY
 * ---------------------------------------------------------------------------
 * A swap is not a ramp. The most damaging thing this product could do to a
 * newcomer is imply that "buy ETH" moves money out of their bank account.
 *
 *   · a fiat intent is DETECTED and answered plainly: we do not do that here
 *   · the honest answer is friendly and offers the thing we DO support
 *     (swapping crypto they already hold) — never a link that pretends
 *   · a third-party ramp is only ever surfaced if it is explicitly configured,
 *     and it is labelled as somebody else's service
 *   · no misleading path survives: `assertNoRampPromise()` refuses any copy or
 *     route that implies we take fiat
 */

import { classifyFailure } from './failureModes.js';

export const RAMP_SCHEMA = 'fbt.fiat-ramp-boundary.v1';
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

/** Did the user ask us to touch real-world money? */
export function detectFiatIntent({ text = null, intent = null } = {}) {
  const raw = String(text ?? '').toLowerCase();
  const signals = [];
  for (const w of FIAT_WORDS) if (raw.includes(w)) signals.push(w);
  for (const c of FIAT_CURRENCIES) {
    if (new RegExp(`\\b${c.toLowerCase()}\\b`).test(raw)) signals.push(c);
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

/** The honest answer. Friendly, specific, and offering what we can do. */
export function fiatBoundaryResponse({ detection = null, providers = [], region = null, now = Date.now() } = {}) {
  if (!detection?.isFiat) {
    return { ok: true, applies: false, blocked: false };
  }
  const configured = (Array.isArray(providers) ? providers : []).filter((p) =>
    p && typeof p.name === 'string' && typeof p.url === 'string' && p.url.startsWith('https://')
    && (!p.regions || !region || p.regions.includes(String(region).toUpperCase())));
  return {
    ok: true,
    applies: true,
    // We do not take fiat. Full stop.
    blocked: true,
    supported: RAMP_SUPPORTED,
    direction: detection.direction,
    i18nKey: detection.direction === 'offramp' ? 'intentAI.ramp.noOfframp' : 'intentAI.ramp.noOnramp',
    // What we CAN do, offered instead of a dead end.
    alternativeI18nKey: 'intentAI.ramp.alternative',
    thirdParty: configured.map((p) => ({
      name: p.name,
      url: p.url,
      // Somebody else's service, said out loud.
      firstParty: false,
      disclaimerI18nKey: 'intentAI.ramp.thirdPartyDisclaimer'
    })),
    executionAuthorized: false,
    at: now
  };
}

/** Strip any route that would imply we take fiat. */
export function filterMisleadingRoutes({ routes = [] } = {}) {
  const rows = Array.isArray(routes) ? routes : [];
  const kept = [];
  const removed = [];
  for (const r of rows) {
    const isFiat = FIAT_CURRENCIES.includes(String(r?.fromSymbol || '').toUpperCase())
      || FIAT_CURRENCIES.includes(String(r?.toSymbol || '').toUpperCase())
      || r?.kind === 'fiat' || r?.rampRequired === true;
    if (isFiat) removed.push({ id: r?.id ?? null, reason: 'FIAT_ROUTE_NOT_SUPPORTED' });
    else kept.push(r);
  }
  return {
    ok: true,
    schema: RAMP_SCHEMA,
    routes: kept,
    removed,
    i18nKey: removed.length ? 'intentAI.ramp.routesRemoved' : null
  };
}

/** Nothing in the product may promise a ramp we do not have. */
export function assertNoRampPromise(view) {
  const reasons = [];
  if (view?.supported === true) reasons.push('CLAIMS_RAMP_SUPPORT');
  if (view?.blocked === false && view?.applies === true) reasons.push('FIAT_INTENT_NOT_BLOCKED');
  for (const p of Array.isArray(view?.thirdParty) ? view.thirdParty : []) {
    if (p.firstParty === true) reasons.push('THIRD_PARTY_PRESENTED_AS_OURS');
    if (!p.url?.startsWith('https://')) reasons.push('INSECURE_PROVIDER_LINK');
    if (!p.disclaimerI18nKey) reasons.push('PROVIDER_WITHOUT_DISCLAIMER');
  }
  for (const r of Array.isArray(view?.routes) ? view.routes : []) {
    if (r?.rampRequired === true) reasons.push('MISLEADING_ROUTE');
  }
  if (num(view?.estimatedBankSettlementMs) !== null) reasons.push('PROMISES_BANK_SETTLEMENT');
  const unique = [...new Set(reasons)];
  return unique.length
    ? { ok: false, reasons: unique, error: classifyFailure('MISSING_DATA', { detail: unique[0] }) }
    : { ok: true };
}
