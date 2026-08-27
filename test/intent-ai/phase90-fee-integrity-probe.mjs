/**
 * PHASE 90 — FEE INTEGRITY
 * Setting a fee is not earning one. Every fee is shown with its arithmetic,
 * quoted equals charged, and only fees on confirmed receipts with a real tx
 * hash are counted as revenue.
 */
import { readFileSync } from 'node:fs';
import {
  computeFee, attachFeeToReceipt, accountCollectedFees, assertFeeHonest, FEE_SCHEMA
} from '../../src/lib/intent-ai/index.js';
import { FEE_BPS, FEE_BPS_MAX } from '../../src/lib/feeBps.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

const NOW = 1_800_000_000_000;
const HASH = '0x'.concat('7'.repeat(64));
const HASH2 = '0x'.concat('8'.repeat(64));

try {
  /* ---------- the fee line ---------- */
  const fee = computeFee({ notional: 1000, bps: 70, symbol: 'USDT', now: NOW });
  check('a fee is computed', fee.ok === true && fee.schema === FEE_SCHEMA);
  check('the arithmetic is right', fee.feeAmount === 7);
  check('the net amount is shown too', fee.netAmount === 993);
  check('the basis points are shown', fee.bps === 70 && fee.percent === 0.7);
  check('the formula is published so a user can check it', fee.formula === 'notional * bps / 10000');
  check('the fee is marked disclosed', fee.disclosed === true);
  check('the fee line is translatable', fee.i18nKey === 'intentAI.fee.line');
  check('the params carry the number and the asset', fee.i18nParams.amount === 7 && fee.i18nParams.symbol === 'USDT');
  check('the configured product fee is used by default', computeFee({ notional: 1000, symbol: 'ETH' }).bps === FEE_BPS);
  check('a zero-fee configuration is honest, not hidden', computeFee({ notional: 1000, bps: 0 }).feeAmount === 0);
  check('a fee above the ceiling is refused', computeFee({ notional: 1000, bps: FEE_BPS_MAX + 1 }).ok === false);
  check('the ceiling refusal is translatable', computeFee({ notional: 1000, bps: FEE_BPS_MAX + 1 }).i18nKey === 'intentAI.fee.aboveMax');
  check('a negative fee is refused', computeFee({ notional: 1000, bps: -5 }).ok === false);
  check('a fee with no notional is refused', computeFee({ bps: 70 }).ok === false);
  check('an empty-string notional is not read as zero', computeFee({ notional: '', bps: 70 }).ok === false);

  /* ---------- quoted must equal charged ---------- */
  const attached = attachFeeToReceipt({ receipt: { id: 'r1', status: 'confirmed', txHash: HASH, feeAmount: 7 }, quotedFee: fee });
  check('a matching fee attaches to the receipt', attached.ok === true);
  check('the receipt now carries a disclosed fee', attached.receipt.fee.disclosed === true && attached.receipt.fee.amount === 7);
  check('the receipt keeps the basis points', attached.receipt.fee.bps === 70);
  const drifted = attachFeeToReceipt({ receipt: { id: 'r2', status: 'confirmed', txHash: HASH, feeAmount: 12 }, quotedFee: fee });
  check('charging more than quoted is refused', drifted.ok === false);
  check('the drift is measured', drifted.drift === 5);
  check('the drift is a TERMS_CHANGED failure', drifted.error.code === 'TERMS_CHANGED');
  check('the drift is a translatable notice', drifted.i18nKey === 'intentAI.fee.mismatch');
  check('a receipt with no charged fee accepts the quote', attachFeeToReceipt({ receipt: { id: 'r3' }, quotedFee: fee }).ok === true);
  check('attaching without a quote is refused', attachFeeToReceipt({ receipt: { id: 'r4' } }).ok === false);
  check('attaching to nothing is refused', attachFeeToReceipt({ quotedFee: fee }).ok === false);

  /* ---------- only settled fees are revenue ---------- */
  const accounting = accountCollectedFees({
    receipts: [
      { id: 'a', status: 'confirmed', txHash: HASH, fee: { amount: 7, symbol: 'USDT', disclosed: true } },
      { id: 'b', status: 'confirmed', txHash: HASH2, fee: { amount: 3, symbol: 'USDT', disclosed: true } },
      { id: 'c', status: 'pending', txHash: null, fee: { amount: 100, symbol: 'USDT', disclosed: true } },
      { id: 'd', status: 'confirmed', txHash: null, fee: { amount: 50, symbol: 'USDT', disclosed: true } },
      { id: 'e', status: 'confirmed', txHash: HASH, fee: { amount: 9, symbol: 'USDT' } },
      { id: 'f', status: 'confirmed', txHash: HASH, fee: { symbol: 'USDT', disclosed: true } }
    ],
    now: NOW
  });
  check('settled fees are counted', accounting.settledCount === 2);
  check('the total is only the settled fees', accounting.bySymbol.USDT === 10);
  check('a pending fee is not revenue', accounting.excluded.some((e) => e.id === 'c' && e.reason === 'NOT_CONFIRMED'));
  check('a confirmed fee with no tx hash is not revenue', accounting.excluded.some((e) => e.id === 'd' && e.reason === 'NO_TX_HASH'));
  check('an undisclosed fee is not counted as revenue', accounting.excluded.some((e) => e.id === 'e' && e.reason === 'FEE_NOT_DISCLOSED'));
  check('an unreadable fee is excluded, not zeroed', accounting.excluded.some((e) => e.id === 'f' && e.reason === 'FEE_UNREADABLE'));
  check('every counted fee is provable on chain', accounting.provable === true);
  check('an accounting with exclusions is not complete', accounting.complete === false);
  check('the partial accounting says so', accounting.i18nKey === 'intentAI.fee.accountingPartial');
  const clean = accountCollectedFees({ receipts: [{ id: 'a', status: 'confirmed', txHash: HASH, fee: { amount: 7, symbol: 'USDT', disclosed: true } }], now: NOW });
  check('a clean accounting reports complete', clean.complete === true && clean.i18nKey === 'intentAI.fee.accountingComplete');
  check('no receipts means no revenue, not an error', accountCollectedFees({ receipts: [], now: NOW }).settledCount === 0);

  /* ---------- the guard ---------- */
  check('an honest quote passes', assertFeeHonest({ quote: fee }).ok === true);
  check('an undisclosed fee is caught', assertFeeHonest({ quote: { ...fee, disclosed: false } }).reasons.includes('FEE_NOT_DISCLOSED'));
  check('a fee above the ceiling is caught', assertFeeHonest({ quote: { ...fee, bps: FEE_BPS_MAX + 10 } }).reasons.includes('FEE_ABOVE_MAX'));
  check('wrong arithmetic is caught', assertFeeHonest({ quote: { ...fee, feeAmount: 70 } }).reasons.includes('FEE_ARITHMETIC_WRONG'));
  check('an undisclosed charged fee is caught',
    assertFeeHonest({ receipt: { fee: { amount: 5 } } }).reasons.includes('UNDISCLOSED_FEE_CHARGED'));
  check('a confirmed receipt with no fee line is caught',
    assertFeeHonest({ receipt: { status: 'confirmed' } }).reasons.includes('RECEIPT_WITHOUT_FEE_LINE'));
  check('unprovable revenue is caught',
    assertFeeHonest({ accounting: { provable: false } }).reasons.includes('UNPROVABLE_REVENUE'));
  check('accounting claiming completeness with exclusions is caught',
    assertFeeHonest({ accounting: { provable: true, complete: true, excludedCount: 2 } }).reasons.includes('ACCOUNTING_CLAIMS_COMPLETE'));
  check('the honest receipt and accounting pass together',
    assertFeeHonest({ quote: fee, receipt: attached.receipt, accounting: clean }).ok === true);

  const locales = ['en', 'fa', 'ar'].map((l) => JSON.parse(readFileSync(`src/i18n/locales/${l}.json`, 'utf8')));
  check('the fee copy is translated in en, fa and ar',
    locales.every((loc) => ['line', 'unavailable', 'aboveMax', 'mismatch', 'accountingComplete', 'accountingPartial']
      .every((k) => typeof loc?.intentAI?.fee?.[k] === 'string')));
  check('the english fee line shows both the percentage and the amount',
    /\{\{percent\}\}/.test(locales[0].intentAI.fee.line) && /\{\{amount\}\}/.test(locales[0].intentAI.fee.line));

  console.log(JSON.stringify({ probe: 'phase90-fee-integrity', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}

export default results;
