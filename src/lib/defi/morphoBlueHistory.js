/**
 * MORPHO BLUE (BASE/USDC) LOCAL ACTION LEDGER.
 * ---------------------------------------------------------------------------
 * Same shape and same discipline as lib/defi/aaveV3History.js:
 * one localStorage key, newest-first, capped, JSON only. Per device. No server.
 *
 * What it is FOR:
 *   1. Partial-state recovery. Approve and supply are two txs. If approve
 *      confirms and supply is rejected/reverts, user is left with a standing
 *      allowance and no position. That state must survive reload, so sheet can
 *      offer "continue" or "revoke". Local record is one half; on-chain allowance
 *      is the other, and on-chain wins.
 *   2. Recent tx list in the panel.
 *
 * What it must NEVER contain: private keys, mnemonics, signatures, raw signed blobs.
 */

export const MORPHO_HISTORY_KEY = 'fbt-morpho-base-history-v1';
const MAX_ROWS = 120;

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

export function loadMorphoHistory() {
  const rows = readJson(MORPHO_HISTORY_KEY, []);
  return Array.isArray(rows) ? rows : [];
}

export function loadMorphoHistoryFor(owner) {
  const who = String(owner ?? '').toLowerCase();
  if (!who) return [];
  return loadMorphoHistory().filter((r) => String(r?.owner ?? '').toLowerCase() === who);
}

function sanitize(row) {
  const out = {};
  for (const key of FIELDS) {
    if (row[key] !== undefined) out[key] = row[key];
  }
  out.action = ACTIONS.includes(out.action) ? out.action : 'supply';
  out.status = STATUSES.includes(out.status) ? out.status : 'pending';
  out.chainId = out.chainId == null ? null : Number(out.chainId);
  return out;
}

export function recordMorphoAction({
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
    id: `m_${at}_${Math.random().toString(36).slice(2, 8)}`,
    action, owner, amountUsdcWei: amountUsdcWei == null ? null : String(amountUsdcWei),
    amountUsdc, txHash, blockNumber, chainId, status, at, error, revertKey
  });
  const rows = loadMorphoHistory();
  rows.unshift(row);
  writeJson(MORPHO_HISTORY_KEY, rows.slice(0, MAX_ROWS));
  return row;
}

export function updateMorphoAction(id, patch = {}) {
  const rows = loadMorphoHistory();
  const target = rows.find((r) => r.id === id);
  if (!target) return null;
  Object.assign(target, sanitize({ ...target, ...patch, id: target.id }));
  writeJson(MORPHO_HISTORY_KEY, rows);
  return target;
}

export function confirmMorphoAction(id, { txHash = null, blockNumber = null } = {}) {
  return updateMorphoAction(id, {
    status: 'confirmed',
    txHash: txHash ?? null,
    blockNumber: blockNumber ?? null,
    confirmedAt: Date.now()
  });
}

export const cancelMorphoAction = (id, error = null) =>
  updateMorphoAction(id, { status: 'cancelled', error });

export const failMorphoAction = (id, { error = null, revertKey = null } = {}) =>
  updateMorphoAction(id, { status: 'failed', error, revertKey });

export const replaceMorphoAction = (id, { error = 'TRANSACTION_REPLACED', txHash = null } = {}) =>
  updateMorphoAction(id, { status: 'replaced', error, txHash });

export const timeoutMorphoAction = (id, { error = 'TRANSACTION_TIMEOUT' } = {}) =>
  updateMorphoAction(id, { status: 'timeout', error });

export function removeMorphoAction(id) {
  writeJson(MORPHO_HISTORY_KEY, loadMorphoHistory().filter((r) => r.id !== id));
}

/* Partial-state derivation */
export function derivePartialApprovalState({ owner, allowanceUsdcWei = 0n, positionUsdcWei = 0n } = {}) {
  const who = String(owner ?? '').toLowerCase();
  const rows = who
    ? loadMorphoHistoryFor(who).filter((r) => r.action === 'approve' && r.status === 'confirmed')
    : [];
  const lastApprove = rows[0] ?? null;

  const allowance = typeof allowanceUsdcWei === 'bigint' ? allowanceUsdcWei : BigInt(String(allowanceUsdcWei ?? 0));
  const position = typeof positionUsdcWei === 'bigint' ? positionUsdcWei : BigInt(String(positionUsdcWei ?? 0));

  const onChain = allowance > 0n;
  const recorded = lastApprove ? BigInt(String(lastApprove.amountUsdcWei ?? 0)) > 0n : false;
  const supplyLanded = onChain && position >= allowance;

  return {
    needed: (onChain || recorded) && !supplyLanded,
    allowanceUsdcWei: onChain ? allowance : (recorded ? BigInt(String(lastApprove.amountUsdcWei)) : null),
    source: onChain ? 'chain' : recorded ? 'record' : null,
    lastApprove
  };
}
