/**
 * FBT INTENT AI — PHASE 90: FEE INTEGRITY
 * ---------------------------------------------------------------------------
 * Setting a fee is not the same as earning one. Phase 90 makes the fee visible
 * on every receipt, in the same units the user is trading, and makes collected
 * fee accounting something we can prove rather than assert.
 *
 *   · the fee shown on the quote and the fee on the receipt must be the SAME
 *     number; a drift is an error, not a rounding footnote
 *   · every fee line names its basis points, its amount and what it was taken
 *     from — no "service fee" with no arithmetic behind it
 *   · accounting sums only fees attached to CONFIRMED receipts with a tx hash;
 *     expected revenue is not revenue
 *   · a fee above the configured maximum is refused outright
 */

import { classifyFailure } from './failureModes.js';
import { FEE_BPS, FEE_BPS_MAX } from '../feeBps.js';

export const FEE_SCHEMA = 'fbt.fee-integrity.v1';
export const FEE_TOLERANCE = 1e-9;

const TX_HASH = /^0x[a-f0-9]{64}$/i;
const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean'
  ? null
  : (Number.isFinite(Number(v)) ? Number(v) : null));

const round = (n, dp = 8) => Math.round(n * 10 ** dp) / 10 ** dp;

/** Compute the fee line the user will see, with the arithmetic attached. */
export function computeFee({ notional = null, bps = FEE_BPS, symbol = null, now = Date.now() } = {}) {
  const amount = num(notional);
  const rate = num(bps);
  if (amount === null || amount <= 0) {
    return { ok: false, i18nKey: 'intentAI.fee.unavailable', error: classifyFailure('MISSING_DATA', { detail: 'NO_NOTIONAL' }) };
  }
  if (rate === null || rate < 0) {
    return { ok: false, i18nKey: 'intentAI.fee.unavailable', error: classifyFailure('MISSING_DATA', { detail: 'NO_FEE_RATE' }) };
  }
  if (rate > FEE_BPS_MAX) {
    // A fee above the configured ceiling never ships.
    return { ok: false, i18nKey: 'intentAI.fee.aboveMax', error: classifyFailure('GUARDIAN_REJECTED', { detail: 'FEE_ABOVE_MAX' }) };
  }
  const feeAmount = round((amount * rate) / 10_000);
  return {
    ok: true,
    schema: FEE_SCHEMA,
    bps: rate,
    percent: round(rate / 100, 4),
    notional: amount,
    symbol: symbol ?? null,
    feeAmount,
    netAmount: round(amount - feeAmount),
    // The user can redo this sum on paper.
    formula: 'notional * bps / 10000',
    disclosed: true,
    i18nKey: 'intentAI.fee.line',
    i18nParams: { percent: round(rate / 100, 4), amount: feeAmount, symbol: symbol ?? '' },
    at: now
  };
}

/** Attach the fee to a receipt, and refuse to attach a different one. */
export function attachFeeToReceipt({ receipt = null, quotedFee = null } = {}) {
  if (!receipt || typeof receipt !== 'object') {
    return { ok: false, receipt: null, error: classifyFailure('MISSING_DATA', { detail: 'NO_RECEIPT' }) };
  }
  if (!quotedFee?.ok) {
    return { ok: false, receipt, i18nKey: 'intentAI.fee.unavailable', error: classifyFailure('MISSING_DATA', { detail: 'NO_QUOTED_FEE' }) };
  }
  const charged = num(receipt.feeAmount);
  if (charged !== null && Math.abs(charged - quotedFee.feeAmount) > FEE_TOLERANCE) {
    // Quoted one number, charged another: that is a bug, not a footnote.
    return {
      ok: false, receipt, drift: round(charged - quotedFee.feeAmount),
      i18nKey: 'intentAI.fee.mismatch',
      error: classifyFailure('TERMS_CHANGED', { detail: 'FEE_DRIFT' })
    };
  }
  return {
    ok: true,
    receipt: { ...receipt, fee: { bps: quotedFee.bps, amount: quotedFee.feeAmount, symbol: quotedFee.symbol, disclosed: true } },
    i18nKey: 'intentAI.fee.line',
    i18nParams: quotedFee.i18nParams
  };
}

/** Only settled fees count. Expected revenue is not revenue. */
export function accountCollectedFees({ receipts = [], now = Date.now() } = {}) {
  const rows = Array.isArray(receipts) ? receipts : [];
  const settled = [];
  const excluded = [];
  for (const r of rows) {
    const amount = num(r?.fee?.amount);
    if (r?.status !== 'confirmed') { excluded.push({ id: r?.id ?? null, reason: 'NOT_CONFIRMED' }); continue; }
    if (!TX_HASH.test(String(r?.txHash || ''))) { excluded.push({ id: r?.id ?? null, reason: 'NO_TX_HASH' }); continue; }
    if (amount === null) { excluded.push({ id: r?.id ?? null, reason: 'FEE_UNREADABLE' }); continue; }
    if (r?.fee?.disclosed !== true) { excluded.push({ id: r?.id ?? null, reason: 'FEE_NOT_DISCLOSED' }); continue; }
    settled.push({ id: r.id ?? null, amount, symbol: r.fee.symbol ?? null, txHash: String(r.txHash).toLowerCase() });
  }
  const bySymbol = {};
  for (const s of settled) {
    const key = s.symbol || 'UNKNOWN';
    bySymbol[key] = round((bySymbol[key] || 0) + s.amount);
  }
  return {
    ok: true,
    schema: FEE_SCHEMA,
    settledCount: settled.length,
    excludedCount: excluded.length,
    excluded,
    bySymbol,
    // Every counted fee points at a transaction anybody can look up.
    provable: settled.every((s) => TX_HASH.test(s.txHash)),
    complete: excluded.length === 0,
    i18nKey: excluded.length ? 'intentAI.fee.accountingPartial' : 'intentAI.fee.accountingComplete',
    i18nParams: { counted: settled.length, excluded: excluded.length },
    at: now
  };
}

/** No hidden fee, no undisclosed fee, no fee above the ceiling. */
export function assertFeeHonest({ quote = null, receipt = null, accounting = null } = {}) {
  const reasons = [];
  if (quote) {
    if (quote.disclosed !== true) reasons.push('FEE_NOT_DISCLOSED');
    if ((num(quote.bps) ?? 0) > FEE_BPS_MAX) reasons.push('FEE_ABOVE_MAX');
    if (quote.ok === true && num(quote.feeAmount) === null) reasons.push('FEE_WITHOUT_AMOUNT');
    if (quote.ok === true && Math.abs(num(quote.feeAmount) - (quote.notional * quote.bps) / 10_000) > FEE_TOLERANCE) reasons.push('FEE_ARITHMETIC_WRONG');
  }
  if (receipt) {
    if (num(receipt?.fee?.amount) !== null && receipt.fee.disclosed !== true) reasons.push('UNDISCLOSED_FEE_CHARGED');
    if (receipt?.status === 'confirmed' && receipt?.fee === undefined) reasons.push('RECEIPT_WITHOUT_FEE_LINE');
  }
  if (accounting) {
    if (accounting.provable !== true) reasons.push('UNPROVABLE_REVENUE');
    if (accounting.complete === true && (accounting.excludedCount ?? 0) > 0) reasons.push('ACCOUNTING_CLAIMS_COMPLETE');
  }
  const unique = [...new Set(reasons)];
  return unique.length
    ? { ok: false, reasons: unique, error: classifyFailure('MISSING_DATA', { detail: unique[0] }) }
    : { ok: true };
}
