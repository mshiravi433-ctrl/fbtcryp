/**
 * PHASE 65 — PORTFOLIO AND HISTORY FROM RECEIPTS
 * A list is not a ledger. Only confirmed receipts with a real transaction hash
 * move a balance; pending, submitted and failed are shown as themselves, and a
 * view built on anything unverifiable reports itself incomplete.
 */
import { readFileSync } from 'node:fs';
import {
  validateReceipt, buildLedger, assertLedgerHonest, RECEIPT_STATES, SETTLED_STATE, LEDGER_SCHEMA
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

const NOW = 1_800_000_000_000;
const HASH = '0x'.concat('a'.repeat(64));
const HASH2 = '0x'.concat('b'.repeat(64));
const rec = (over = {}) => ({
  id: 'r1', status: 'confirmed', txHash: HASH, symbol: 'eth', side: 'in',
  amount: 1, valueUsd: 2500, confirmedAt: NOW - 1000, ...over
});

try {
  /* ---------- what counts as evidence ---------- */
  check('a complete confirmed receipt is evidence', validateReceipt(rec(), { now: NOW }).ok === true);
  check('a confirmed receipt with NO tx hash is not evidence',
    validateReceipt(rec({ txHash: null }), { now: NOW }).reasons.includes('CONFIRMED_WITHOUT_TX_HASH'));
  check('a malformed hash is not a hash',
    validateReceipt(rec({ txHash: '0x123' }), { now: NOW }).ok === false);
  check('a confirmed receipt with no time is not evidence',
    validateReceipt(rec({ confirmedAt: null }), { now: NOW }).ok === false);
  check('a receipt confirmed in the future is not evidence',
    validateReceipt(rec({ confirmedAt: NOW + 60_000 }), { now: NOW }).ok === false);
  check('a receipt with an unknown status is not evidence',
    validateReceipt(rec({ status: 'probably-fine' }), { now: NOW }).ok === false);
  check('a receipt with no asset is not evidence', validateReceipt(rec({ symbol: null }), { now: NOW }).ok === false);
  check('a receipt with no amount is not evidence', validateReceipt(rec({ amount: null }), { now: NOW }).ok === false);
  check('a pending receipt needs no hash yet',
    validateReceipt({ status: 'pending', symbol: 'eth', amount: 1 }, { now: NOW }).ok === true);
  check('all four receipt states are recognised', RECEIPT_STATES.length === 4 && RECEIPT_STATES.includes(SETTLED_STATE));

  /* ---------- only confirmed receipts move the balance ---------- */
  const ledger = buildLedger({
    receipts: [
      rec(),
      rec({ id: 'r2', txHash: HASH2, symbol: 'usdc', amount: 500, valueUsd: 500 }),
      rec({ id: 'r3', status: 'pending', txHash: null, confirmedAt: null, symbol: 'eth', amount: 5, valueUsd: 12500 }),
      rec({ id: 'r4', status: 'submitted', txHash: HASH2, confirmedAt: null, symbol: 'eth', amount: 3, valueUsd: 7500 }),
      rec({ id: 'r5', status: 'failed', txHash: null, confirmedAt: null, symbol: 'eth', amount: 9, valueUsd: 22500 })
    ],
    now: NOW
  });
  check('the ledger builds', ledger.ok === true && ledger.schema === LEDGER_SCHEMA);
  check('only confirmed receipts reach the positions',
    ledger.positions.find((p) => p.symbol === 'ETH').amount === 1);
  check('a pending receipt does not inflate the balance', ledger.counts.pending === 1);
  check('a submitted receipt does not inflate the balance', ledger.counts.submitted === 1);
  check('a failed receipt does not inflate the balance', ledger.counts.failed === 1);
  check('the total is only the settled value', ledger.totalValueUsd === 3000);
  check('the unsettled ones are listed separately', ledger.pending.length === 1 && ledger.submitted.length === 1);
  check('the failed ones are listed separately', ledger.failed.length === 1);
  check('the history holds everything, settled or not', ledger.history.length === 5);
  check('the history is newest first',
    ledger.history.every((row, i) => i === 0 || (row.at ?? 0) <= (ledger.history[i - 1].at ?? 0)));
  check('outgoing receipts reduce a position',
    buildLedger({ receipts: [rec(), rec({ id: 'r9', txHash: HASH2, side: 'out', amount: 0.4, valueUsd: 1000 })], now: NOW })
      .positions[0].amount === 0.6);

  /* ---------- a fabricated receipt cannot enter ---------- */
  const fabricated = buildLedger({
    receipts: [rec(), { id: 'fake', status: 'confirmed', symbol: 'ETH', amount: 1000, valueUsd: 2_500_000 }],
    now: NOW
  });
  check('a confirmed receipt with no proof is excluded', fabricated.counts.excluded === 1);
  check('the fabricated amount never reaches the positions',
    fabricated.positions.find((p) => p.symbol === 'ETH').amount === 1);
  check('the exclusion is named', fabricated.excluded[0].reasons.includes('CONFIRMED_WITHOUT_TX_HASH'));
  check('a view with exclusions is not complete', fabricated.complete === false);
  check('an incomplete view says so in a translatable key', fabricated.i18nKey === 'intentAI.ledger.partial');
  check('a clean view reports itself complete', ledger.complete === true && ledger.i18nKey === 'intentAI.ledger.complete');

  /* ---------- unreadable value is not zero ---------- */
  const noValue = buildLedger({ receipts: [rec({ valueUsd: null })], now: NOW });
  check('a position with an unreadable value shows no dollar figure', noValue.positions[0].valueUsd === null);
  check('a total that cannot be computed is not invented', noValue.totalValueUsd === null);
  check('the incompleteness is stated', noValue.complete === false);
  check('an empty ledger is empty, not an error', buildLedger({ receipts: [], now: NOW }).positions.length === 0);

  /* ---------- the fail-closed guard ---------- */
  check('the guard accepts an honest ledger', assertLedgerHonest(ledger).ok === true);
  check('the guard rejects a partial view claiming completeness',
    assertLedgerHonest({ ...fabricated, complete: true }).ok === false);
  check('the guard rejects a total on incomplete data',
    assertLedgerHonest({ schema: LEDGER_SCHEMA, excluded: [], complete: false, totalValueUsd: 100, history: [] }).ok === false);
  check('the guard rejects a settled row with no proof',
    assertLedgerHonest({ schema: LEDGER_SCHEMA, excluded: [], complete: true, totalValueUsd: null, history: [{ status: 'confirmed', txHash: null }] }).ok === false);
  check('the guard rejects a non-ledger', assertLedgerHonest({ positions: [] }).ok === false);

  const locales = ['en', 'fa', 'ar'].map((l) => JSON.parse(readFileSync(`src/i18n/locales/${l}.json`, 'utf8')));
  check('the ledger strings are translated in en, fa and ar',
    locales.every((loc) => ['complete', 'partial', 'pendingTitle', 'failedTitle']
      .every((k) => typeof loc?.intentAI?.ledger?.[k] === 'string')));

  console.log(JSON.stringify({ probe: 'phase65-portfolio-ledger', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}

export default results;
