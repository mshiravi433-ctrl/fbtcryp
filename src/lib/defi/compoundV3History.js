/**
 * COMPOUND V3 (BASE/USDC) LOCAL ACTION LEDGER.
 * ---------------------------------------------------------------------------
 * Same shape and same discipline as lib/defi/aaveV3History.js and
 * lib/swapHistory.js: one localStorage key, newest-first, capped, JSON only.
 * Per device. There is no server component — nothing here is uploaded, and
 * nothing here is trusted as the source of truth for a balance. The chain is.
 *
 * A SEPARATE KEY from the Aave ledger, on purpose. The two protocols hold two
 * independent positions, and merging them would make "accrued since" wrong for
 * both: the figure is `on-chain balance − net local principal`, so a supply
 * recorded against Aave would be subtracted from a Compound balance and
 * produce a confidently wrong number. Separate keys, separate arithmetic.
 *
 * What it is FOR:
 *   1. The "accrued since" figure on the position card (best-effort, and null
 *      when the records cannot account for the position — see getPosition() in
 *      lib/defi/compoundV3Base.js).
 *   2. PARTIAL-STATE RECOVERY. Approve and supply are two separate
 *      transactions. If the approve confirms and the supply is rejected or
 *      reverts, the user is left holding a standing allowance with nothing
 *      supplied. That state must survive an app reload, so the sheet can
 *      reopen offering "continue" or "revoke". The record below is the local
 *      half of that; the on-chain allowance is the other half, and the
 *      on-chain half always wins.
 *
 * What it must NEVER contain: private keys, mnemonics, signatures, or raw
 * signed transaction blobs. Only public on-chain facts (hash, amount, block,
 * timestamp) plus the owner address the user already knows.
 * `recordCompoundAction` picks its fields explicitly from a whitelist so a
 * careless caller cannot smuggle a signer or a key into localStorage.
 */

export const COMPOUND_HISTORY_KEY = 'fbt-compound-base-history-v1';
const MAX_ROWS = 120;

/** The only fields that may be persisted. Anything else is dropped. */
const FIELDS = Object.freeze([
  'id', 'action', 'chainId', 'owner', 'amountUsdcWei', 'amountUsdc',
  'txHash', 'blockNumber', 'status', 'at', 'confirmedAt', 'error', 'revertKey'
]);

const ACTIONS = Object.freeze(['supply', 'withdraw', 'approve', 'revoke']);
const STATUSES = Object.freeze(['pending', 'confirmed', 'cancelled', 'failed', 'replaced', 'timeout']);

function readJson(key, fallback) {
  try {
    if (typeof localStorage === 'undefined') return fallback;
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** All records, newest first. */
export function loadCompoundHistory() {
  const rows = readJson(COMPOUND_HISTORY_KEY, []);
  return Array.isArray(rows) ? rows : [];
}

/** Records for one wallet (case-insensitive), newest first. */
export function loadCompoundHistoryFor(owner) {
  const who = String(owner ?? '').toLowerCase();
  if (!who) return [];
  return loadCompoundHistory().filter((r) => String(r?.owner ?? '').toLowerCase() === who);
}

function sanitize(row) {
  const out = {};
  for (const key of FIELDS) {
    if (row[key] !== undefined) out[key] = row[key];
  }
  // An amount is a public on-chain fact; a key or signature is not a field we
  // accept at all, and there is no key for one to land in.
  out.action = ACTIONS.includes(out.action) ? out.action : 'supply';
  out.status = STATUSES.includes(out.status) ? out.status : 'pending';
  out.chainId = out.chainId == null ? null : Number(out.chainId);
  return out;
}

/** Append a record and return it (with its generated id). */
export function recordCompoundAction({
  action = 'supply',
  owner = '',
  amountUsdcWei = null,
  amountUsdc = null,
  txHash = null,
  blockNumber = null,
  chainId = 8453,
  status = 'pending',
  at = Date.now(),
  error = null,
  revertKey = null
} = {}) {
  const row = sanitize({
    id: `c_${at}_${Math.random().toString(36).slice(2, 8)}`,
    action, owner, amountUsdcWei: amountUsdcWei == null ? null : String(amountUsdcWei),
    amountUsdc, txHash, blockNumber, chainId, status, at, error, revertKey
  });
  const rows = loadCompoundHistory();
  rows.unshift(row);
  writeJson(COMPOUND_HISTORY_KEY, rows.slice(0, MAX_ROWS));
  return row;
}

/** Patch a record by id — the pending → confirmed / failed transition. */
export function updateCompoundAction(id, patch = {}) {
  const rows = loadCompoundHistory();
  const target = rows.find((r) => r.id === id);
  if (!target) return null;
  Object.assign(target, sanitize({ ...target, ...patch, id: target.id }));
  writeJson(COMPOUND_HISTORY_KEY, rows);
  return target;
}

export function confirmCompoundAction(id, { txHash = null, blockNumber = null } = {}) {
  return updateCompoundAction(id, {
    status: 'confirmed',
    txHash: txHash ?? null,
    blockNumber: blockNumber ?? null,
    confirmedAt: Date.now()
  });
}

export const cancelCompoundAction = (id, error = null) =>
  updateCompoundAction(id, { status: 'cancelled', error });

export const failCompoundAction = (id, { error = null, revertKey = null } = {}) =>
  updateCompoundAction(id, { status: 'failed', error, revertKey });

export const replaceCompoundAction = (id, { error = 'TRANSACTION_REPLACED', txHash = null } = {}) =>
  updateCompoundAction(id, { status: 'replaced', error, txHash });

export const timeoutCompoundAction = (id, { error = 'TRANSACTION_TIMEOUT' } = {}) =>
  updateCompoundAction(id, { status: 'timeout', error });

export function removeCompoundAction(id) {
  writeJson(COMPOUND_HISTORY_KEY, loadCompoundHistory().filter((r) => r.id !== id));
}

/* -------------------------------------------------------------------------- */
/* Partial-state derivation                                                    */
/* -------------------------------------------------------------------------- */

/**
 * "You approved X USDC but nothing was supplied."
 *
 * Derived from BOTH halves, never from one:
 *   · the local record of an approve that confirmed, and
 *   · the on-chain allowance the Comet market still holds.
 *
 * The on-chain allowance wins: if it is zero the state is clean regardless of
 * what the ledger says (the user may have revoked from another device), and if
 * it is non-zero while the ledger has nothing, we still surface it — a stale
 * allowance with no local record is exactly the case the ledger would hide.
 *
 * `positionUsdcWei` is the caller's Comet base balance; a partial state only
 * makes sense when there is an allowance AND the position is not already ≥ it
 * (i.e. the supply genuinely did not land).
 *
 * @returns {{ needed: boolean, allowanceUsdcWei: bigint|null, source: 'chain'|'record'|null,
 *             lastApprove: object|null }}
 */
export function derivePartialApprovalState({ owner, allowanceUsdcWei = 0n, positionUsdcWei = 0n } = {}) {
  const who = String(owner ?? '').toLowerCase();
  const rows = who
    ? loadCompoundHistoryFor(who).filter(
        (r) => r.action === 'approve' && r.status === 'confirmed'
      )
    : [];
  const lastApprove = rows[0] ?? null;

  const allowance = typeof allowanceUsdcWei === 'bigint'
    ? allowanceUsdcWei
    : BigInt(String(allowanceUsdcWei ?? 0));
  const position = typeof positionUsdcWei === 'bigint'
    ? positionUsdcWei
    : BigInt(String(positionUsdcWei ?? 0));

  const onChain = allowance > 0n;
  const recorded = lastApprove ? BigInt(String(lastApprove.amountUsdcWei ?? 0)) > 0n : false;

  // The supply already landed if the position covers the allowance.
  const supplyLanded = onChain && position >= allowance;

  return {
    needed: (onChain || recorded) && !supplyLanded,
    allowanceUsdcWei: onChain ? allowance : (recorded ? BigInt(String(lastApprove.amountUsdcWei)) : null),
    source: onChain ? 'chain' : recorded ? 'record' : null,
    lastApprove
  };
}
