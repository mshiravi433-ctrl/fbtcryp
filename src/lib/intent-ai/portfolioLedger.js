/**
 * FBT INTENT AI — PHASE 65: PORTFOLIO AND HISTORY FROM RECEIPTS
 * ---------------------------------------------------------------------------
 * A list is not a ledger. A portfolio screen that adds up what the app *hoped*
 * would happen is a fiction, and the fiction always resolves in the user's
 * disfavour: the position was never opened, the swap reverted, the bridge is
 * still in flight.
 *
 * So the ledger has exactly one input: honest receipts.
 *
 *   · a receipt without a transaction hash, a status and a confirmed time is
 *     not evidence, and is excluded from every total
 *   · only `confirmed` receipts move a position. `pending`, `submitted` and
 *     `failed` are shown as themselves — visible, counted separately, never
 *     folded into the balance
 *   · a portfolio built on any excluded receipt reports `complete: false`, so
 *     a partial view can never be read as a full one
 */

import { classifyFailure } from './failureModes.js';

export const LEDGER_SCHEMA = 'fbt.portfolio-ledger.v1';
export const RECEIPT_STATES = Object.freeze(['pending', 'submitted', 'confirmed', 'failed']);
/** Only this one changes a balance. */
export const SETTLED_STATE = 'confirmed';

const TX_HASH = /^0x[a-f0-9]{64}$/i;
const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean'
  ? null
  : (Number.isFinite(Number(v)) ? Number(v) : null));
const sym = (s) => (typeof s === 'string' && s.trim() ? s.trim().toUpperCase().slice(0, 16) : null);

/**
 * Is this receipt evidence of anything? A receipt that cannot be checked is
 * not "probably fine" — it is excluded and named.
 */
export function validateReceipt(receipt = {}, { now = Date.now() } = {}) {
  const reasons = [];
  const status = typeof receipt?.status === 'string' ? receipt.status.toLowerCase() : null;
  if (!RECEIPT_STATES.includes(status)) reasons.push('NO_VALID_STATUS');
  // A confirmed receipt with no hash is the fabrication this guards against.
  if (status === SETTLED_STATE && !TX_HASH.test(String(receipt?.txHash || ''))) reasons.push('CONFIRMED_WITHOUT_TX_HASH');
  if (status === SETTLED_STATE && num(receipt?.confirmedAt) === null) reasons.push('CONFIRMED_WITHOUT_TIME');
  if (status === SETTLED_STATE && num(receipt?.confirmedAt) > now) reasons.push('CONFIRMED_IN_THE_FUTURE');
  if (!sym(receipt?.symbol)) reasons.push('NO_ASSET');
  if (num(receipt?.amount) === null) reasons.push('NO_AMOUNT');
  return reasons.length
    ? { ok: false, status, reasons, error: classifyFailure('MISSING_DATA', { detail: reasons[0] }) }
    : { ok: true, status };
}

/**
 * Build positions and history from receipts alone.
 * @param {Array} receipts [{ id, status, txHash, symbol, side:'in'|'out', amount, valueUsd, confirmedAt }]
 */
export function buildLedger({ receipts = [], now = Date.now() } = {}) {
  const settled = [];
  const open = [];
  const failed = [];
  const excluded = [];

  for (const raw of Array.isArray(receipts) ? receipts.slice(0, 500) : []) {
    const verdict = validateReceipt(raw, { now });
    if (verdict.ok !== true) {
      excluded.push({ id: raw?.id ?? null, status: verdict.status, reasons: verdict.reasons });
      continue;
    }
    const row = {
      id: typeof raw.id === 'string' ? raw.id.slice(0, 64) : null,
      status: verdict.status,
      txHash: typeof raw.txHash === 'string' ? raw.txHash : null,
      symbol: sym(raw.symbol),
      side: raw.side === 'out' ? 'out' : 'in',
      amount: num(raw.amount),
      valueUsd: num(raw.valueUsd),
      at: num(raw.confirmedAt) ?? num(raw.submittedAt) ?? num(raw.createdAt)
    };
    if (verdict.status === SETTLED_STATE) settled.push(row);
    else if (verdict.status === 'failed') failed.push(row);
    else open.push(row);
  }

  /* Positions come from settled receipts only. */
  const positions = new Map();
  for (const row of settled) {
    const cur = positions.get(row.symbol) || { symbol: row.symbol, amount: 0, valueUsd: 0, valueKnown: true, receipts: 0 };
    const sign = row.side === 'out' ? -1 : 1;
    cur.amount += sign * row.amount;
    if (row.valueUsd === null) cur.valueKnown = false;
    else cur.valueUsd += sign * row.valueUsd;
    cur.receipts += 1;
    positions.set(row.symbol, cur);
  }

  const rows = [...positions.values()].map((p) => ({
    ...p,
    amount: Math.round(p.amount * 1e8) / 1e8,
    // A position whose value could not be read shows no dollar figure at all.
    valueUsd: p.valueKnown ? Math.round(p.valueUsd * 100) / 100 : null
  }));

  const history = [...settled, ...open, ...failed].sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  const valuesComplete = rows.every((p) => p.valueUsd !== null);

  return {
    ok: true,
    schema: LEDGER_SCHEMA,
    positions: rows,
    history,
    // Everything that is NOT in the balance, shown as itself.
    pending: open.filter((r) => r.status === 'pending'),
    submitted: open.filter((r) => r.status === 'submitted'),
    failed,
    excluded,
    counts: { settled: settled.length, pending: open.filter((r) => r.status === 'pending').length, submitted: open.filter((r) => r.status === 'submitted').length, failed: failed.length, excluded: excluded.length },
    // A view built on anything unverifiable says so, loudly.
    complete: excluded.length === 0 && valuesComplete,
    totalValueUsd: valuesComplete ? Math.round(rows.reduce((s, p) => s + p.valueUsd, 0) * 100) / 100 : null,
    unsettledCount: open.length,
    i18nKey: excluded.length ? 'intentAI.ledger.partial' : 'intentAI.ledger.complete',
    i18nParams: { excluded: excluded.length, pending: open.length, failed: failed.length },
    builtAt: now
  };
}

/**
 * Fail-closed guard: a fabricated receipt must never reach the ledger, and a
 * ledger must never claim a total it could not compute.
 */
export function assertLedgerHonest(ledger) {
  const reasons = [];
  if (!ledger || ledger.schema !== LEDGER_SCHEMA) reasons.push('NOT_A_LEDGER');
  if (ledger?.excluded?.length && ledger.complete === true) reasons.push('PARTIAL_CLAIMED_COMPLETE');
  if (ledger?.totalValueUsd !== null && ledger?.complete === false) reasons.push('TOTAL_ON_INCOMPLETE_DATA');
  if ((ledger?.history || []).some((row) => row.status === SETTLED_STATE && !TX_HASH.test(String(row.txHash || '')))) {
    reasons.push('SETTLED_WITHOUT_PROOF');
  }
  return reasons.length
    ? { ok: false, reasons, error: classifyFailure('MISSING_DATA', { detail: reasons.join(',') }) }
    : { ok: true, reasons: [] };
}
