/**
 * FBT INTENT AI — PHASE 83: APPROVAL HYGIENE
 * ---------------------------------------------------------------------------
 * An allowance is not forever. The standard swap flow asks for an unlimited
 * approval once and then never mentions it again, which means a wallet slowly
 * accumulates a list of contracts that may move its tokens — a list the owner
 * has never seen.
 *
 * This module is the inventory and the exit:
 *
 *   · every allowance is classified (exact / bounded / UNLIMITED) with the
 *     exposure it represents in dollars, so "unlimited" stops being abstract
 *   · a swap asks for the MINIMUM allowance that covers the trade, never
 *     `MaxUint256`, and `minimalApproval()` is the only approved way to size it
 *   · a revoke plan can be produced for any entry, and stale, unlimited or
 *     unknown-spender approvals are surfaced first
 *   · the answer to "what did I allow, and to whom?" is a real list with
 *     addresses, amounts and timestamps — never a reassuring summary
 */

import { classifyFailure } from './failureModes.js';

export const APPROVAL_SCHEMA = 'fbt.approval-hygiene.v1';

/** 2^256-1 — the unlimited allowance every swap UI quietly asks for. */
export const MAX_UINT256 = (2n ** 256n) - 1n;
/** Anything above this is treated as unlimited in practice. */
export const EFFECTIVELY_UNLIMITED = 2n ** 200n;
/** An approval untouched for this long is stale housekeeping. */
export const STALE_APPROVAL_MS = 90 * 24 * 60 * 60 * 1000;
/** A swap approval is padded by this much to survive a small re-quote. */
export const APPROVAL_HEADROOM_PCT = 2;

export const APPROVAL_RISKS = Object.freeze(['none', 'low', 'medium', 'high']);

const ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const norm = (a) => (typeof a === 'string' && ADDRESS.test(a.trim()) ? a.trim().toLowerCase() : null);
// Number(null) === 0 and Number('') === 0, so an absent value must be
// rejected BEFORE the finite check or "missing" silently reads as zero.
const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean'
  ? null
  : (Number.isFinite(Number(v)) ? Number(v) : null));

function toBig(v) {
  try {
    if (typeof v === 'bigint') return v;
    if (typeof v === 'number' && Number.isFinite(v)) return BigInt(Math.trunc(v));
    if (typeof v === 'string' && /^\d+$/.test(v.trim())) return BigInt(v.trim());
    if (typeof v === 'string' && /^0x[0-9a-f]+$/i.test(v.trim())) return BigInt(v.trim());
  } catch { /* fall through */ }
  return null;
}

/** Classify one allowance row. */
export function classifyAllowance(entry = {}, { now = Date.now() } = {}) {
  const token = norm(entry.token);
  const spender = norm(entry.spender);
  const amount = toBig(entry.allowance ?? entry.amount);
  const decimals = num(entry.decimals) ?? 18;
  const priceUsd = num(entry.priceUsd);
  const balance = toBig(entry.balance);
  const approvedAt = num(entry.approvedAt);

  if (!token || !spender) {
    return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'ALLOWANCE_ROW_INCOMPLETE' }) };
  }
  if (amount === null) {
    // An allowance we could not read is NOT reported as zero.
    return {
      ok: true, token, spender, kind: 'unknown', unlimited: false, revocable: true,
      risk: 'high', exposureUsd: null, reasonKey: 'intentAI.approvals.reason.unreadable',
      spenderKnown: entry.spenderKnown === true, approvedAt, ageMs: approvedAt === null ? null : now - approvedAt
    };
  }

  const unlimited = amount >= EFFECTIVELY_UNLIMITED;
  const kind = amount === 0n ? 'none' : unlimited ? 'unlimited' : 'bounded';
  // Exposure is capped by what the wallet actually holds — an unlimited
  // approval on an empty balance is still a liability, but not the same one.
  const atRisk = unlimited ? balance : (balance === null ? amount : (amount < balance ? amount : balance));
  const exposureUsd = priceUsd !== null && atRisk !== null
    ? Math.round((Number(atRisk) / 10 ** decimals) * priceUsd * 100) / 100
    : null;

  const stale = approvedAt !== null && now - approvedAt > STALE_APPROVAL_MS;
  let risk = 'none';
  if (kind === 'unlimited') risk = entry.spenderKnown === true ? 'medium' : 'high';
  else if (kind === 'bounded') risk = entry.spenderKnown === true ? 'low' : 'medium';
  if (stale && risk !== 'none' && risk !== 'high') risk = 'high';

  return {
    ok: true,
    token,
    spender,
    spenderLabel: typeof entry.spenderLabel === 'string' ? entry.spenderLabel.slice(0, 48) : null,
    spenderKnown: entry.spenderKnown === true,
    symbol: typeof entry.symbol === 'string' ? entry.symbol.toUpperCase().slice(0, 16) : null,
    kind,
    unlimited,
    allowance: amount.toString(),
    decimals,
    exposureUsd,
    risk,
    stale,
    approvedAt,
    ageMs: approvedAt === null ? null : now - approvedAt,
    revocable: amount > 0n,
    reasonKey: unlimited
      ? 'intentAI.approvals.reason.unlimited'
      : stale ? 'intentAI.approvals.reason.stale'
        : kind === 'none' ? 'intentAI.approvals.reason.none' : 'intentAI.approvals.reason.bounded'
  };
}

/** The full "what did I allow, and to whom" inventory, worst first. */
export function approvalInventory(entries = [], { now = Date.now() } = {}) {
  const rows = (Array.isArray(entries) ? entries : [])
    .slice(0, 200)
    .map((entry) => classifyAllowance(entry, { now }))
    .filter((row) => row.ok === true);
  const order = { high: 0, medium: 1, low: 2, none: 3 };
  rows.sort((a, b) => (order[a.risk] - order[b.risk]) || ((b.exposureUsd ?? 0) - (a.exposureUsd ?? 0)));
  const active = rows.filter((row) => row.kind !== 'none');
  return {
    ok: true,
    schema: APPROVAL_SCHEMA,
    entries: rows,
    activeCount: active.length,
    unlimitedCount: rows.filter((row) => row.unlimited).length,
    staleCount: rows.filter((row) => row.stale).length,
    // Null when any exposure is unreadable — a partial total would be a lie.
    totalExposureUsd: active.some((row) => row.exposureUsd === null)
      ? null
      : Math.round(active.reduce((sum, row) => sum + row.exposureUsd, 0) * 100) / 100,
    exposureComplete: !active.some((row) => row.exposureUsd === null),
    needsAttention: rows.filter((row) => row.risk === 'high' || row.unlimited),
    builtAt: now
  };
}

/**
 * The minimum allowance a swap actually needs. Never MaxUint256.
 * @param {bigint|string|number} amountWei the exact amount being swapped
 */
export function minimalApproval({ amountWei = null, headroomPct = APPROVAL_HEADROOM_PCT, currentAllowance = null } = {}) {
  const amount = toBig(amountWei);
  if (amount === null || amount <= 0n) {
    return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_SWAP_AMOUNT' }) };
  }
  const pct = num(headroomPct);
  const headroom = pct === null || pct < 0 ? 0n : BigInt(Math.round(pct * 100));
  const required = amount + (amount * headroom) / 10_000n;
  const current = toBig(currentAllowance);
  const sufficient = current !== null && current >= required;
  return {
    ok: true,
    schema: APPROVAL_SCHEMA,
    required: required.toString(),
    // The invariant this whole phase exists to hold.
    unlimited: false,
    isMaxUint: false,
    approvalNeeded: !sufficient,
    currentAllowance: current === null ? null : current.toString(),
    // An existing unlimited allowance is not "already fine" — it is the thing
    // we are trying to stop, so it is reported for replacement.
    replaceUnlimited: current !== null && current >= EFFECTIVELY_UNLIMITED,
    headroomPct: pct ?? 0,
    reasonKey: sufficient ? 'intentAI.approvals.reason.sufficient' : 'intentAI.approvals.reason.needed'
  };
}

/** The plan for taking an allowance back to zero. */
export function revokePlan(entry = {}, { now = Date.now() } = {}) {
  const row = classifyAllowance(entry, { now });
  if (row.ok !== true) return row;
  if (row.revocable !== true) {
    return { ok: false, schema: APPROVAL_SCHEMA, revocable: false, reasonKey: 'intentAI.approvals.reason.none', error: classifyFailure('MISSING_DATA', { detail: 'NOTHING_TO_REVOKE' }) };
  }
  return {
    ok: true,
    schema: APPROVAL_SCHEMA,
    action: 'approve-zero',
    token: row.token,
    spender: row.spender,
    targetAllowance: '0',
    // A revoke is still a transaction: it goes through the same confirmation.
    requiresConfirmation: true,
    executionAuthorized: false,
    exposureRemovedUsd: row.exposureUsd,
    i18nKey: 'intentAI.approvals.revokePrompt',
    i18nParams: { spender: row.spender, symbol: row.symbol, exposure: row.exposureUsd },
    plannedAt: now
  };
}

/** Fail-closed guard: a swap may not carry an unlimited approval request. */
export function assertNoUnlimitedApproval(request = {}) {
  const amount = toBig(request?.allowance ?? request?.required ?? request?.amount);
  if (request?.unlimited === true || request?.isMaxUint === true) {
    return { ok: false, error: classifyFailure('RISK_BLOCKED', { detail: 'UNLIMITED_APPROVAL_REQUESTED' }) };
  }
  if (amount !== null && amount >= EFFECTIVELY_UNLIMITED) {
    return { ok: false, error: classifyFailure('RISK_BLOCKED', { detail: 'APPROVAL_EFFECTIVELY_UNLIMITED' }) };
  }
  if (amount === null) {
    return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'APPROVAL_AMOUNT_UNREADABLE' }) };
  }
  return { ok: true };
}
