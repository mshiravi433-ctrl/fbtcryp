/**
 * SWAP HISTORY — a per-device ledger of swaps (EVM + Solana).
 *
 * The user asked for the swap history to live on the device and in cache, NOT
 * in mutable memory. Every record is written to localStorage under a single
 * key the same way the portfolio lots ledger (lib/portfolioIntel.js) does.
 * Backed by cache-first, so reloading the app or reopening the tab keeps the
 * history — and it never grows unbounded: it is capped.
 *
 * Statuses are the three the UI asks for, plus failure:
 *   'pending'    — در حال اجرا (in progress / awaiting confirmation)
 *   'confirmed'  — تایید شده (mined & accepted)
 *   'cancelled'  — لغو شده (user rejected / replaced / never sent)
 *   'failed'     — ناموفق (chain refused / timed out)
 */

export const SWAP_HISTORY_KEY = 'fbt-swap-history-v1';
const MAX_ROWS = 80;

function readJson(key, fallback) {
  try {
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
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** Load the swap history, newest first (already capped to MAX_ROWS). */
export function loadSwapHistory() {
  const rows = readJson(SWAP_HISTORY_KEY, []);
  return Array.isArray(rows) ? rows : [];
}

export function saveSwapHistory(rows) {
  const list = (rows || []).slice(0, MAX_ROWS);
  writeJson(SWAP_HISTORY_KEY, list);
  return list;
}

/**
 * Append a swap record. `status` is one of pending/confirmed/cancelled/failed.
 * Returns the new entry so the caller can later update it by id.
 */
export function recordSwap({
  network = 'evm',
  chainId = null,
  chainName = null,
  from = '',
  fromSymbol = '',
  to = '',
  toSymbol = '',
  amountIn = null,
  amountOut = null,
  txHash = null,
  status = 'pending',
  at = Date.now(),
  error = null
} = {}) {
  const row = {
    id: `s_${at}_${Math.random().toString(36).slice(2, 8)}`,
    network,
    chainId: chainId == null ? null : Number(chainId),
    chainName,
    from: from || '',
    fromSymbol: fromSymbol || '',
    to: to || '',
    toSymbol: toSymbol || '',
    amountIn: amountIn == null ? null : Number(amountIn),
    amountOut: amountOut == null ? null : Number(amountOut),
    txHash: txHash || null,
    status,
    at,
    error: error || null
  };
  const rows = loadSwapHistory();
  rows.unshift(row);
  saveSwapHistory(rows);
  return row;
}

/** Update an existing record (e.g. pending → confirmed) by id. */
export function updateSwapHistory(id, patch = {}) {
  const rows = loadSwapHistory();
  const target = rows.find((r) => r.id === id);
  if (!target) return null;
  Object.assign(target, patch);
  saveSwapHistory(rows);
  return target;
}

/** Mark a record confirmed. */
export function confirmSwap(id, txHash = null) {
  return updateSwapHistory(id, { status: 'confirmed', txHash: txHash ?? null });
}

/** Mark a record cancelled. */
export function cancelSwap(id, error = null) {
  return updateSwapHistory(id, { status: 'cancelled', error: error ?? null });
}

/** Mark a record failed. */
export function failSwap(id, error = null) {
  return updateSwapHistory(id, { status: 'failed', error: error ?? null });
}

/** Remove a record (delete action on the history list). */
export function removeSwap(id) {
  const rows = loadSwapHistory().filter((r) => r.id !== id);
  saveSwapHistory(rows);
  return rows;
}

/** Clear the whole history ledger. */
export function clearSwapHistory() {
  saveSwapHistory([]);
  return [];
}
