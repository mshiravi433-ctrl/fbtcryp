/**
 * LIDO HISTORY — localStorage ledger for Lido actions on this device.
 * ---------------------------------------------------------------------------
 * Same shape as Aave's history module, but for Lido's five actions.
 *
 * Each record:
 *   id            string  — random
 *   action        'stake' | 'wrap' | 'unwrap' | 'requestWithdraw' | 'claim' | 'approve' | 'revoke'
 *   owner         0x address lowercase
 *   chainId       1
 *   amountWei     string | null
 *   amount        number | null (human)
 *   symbol        'ETH' | 'stETH' | 'wstETH' | ''
 *   status        'pending' | 'confirmed' | 'failed' | 'cancelled'
 *   txHash        0x | null
 *   blockNumber   number | null
 *   at            ISO string
 *   requestId     string | null (for queue tickets)
 */

export const LIDO_HISTORY_KEY = 'fbt-lido-history-v1';
const STORAGE_KEY = LIDO_HISTORY_KEY;
const MAX_ROWS = 250;

function safeParse(raw) {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadAll() {
  if (typeof localStorage === 'undefined') return [];
  try {
    return safeParse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveAll(rows) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows.slice(-MAX_ROWS)));
  } catch {}
}

function randomId() {
  try {
    const arr = new Uint8Array(12);
    (typeof crypto !== 'undefined' && crypto.getRandomValues ? crypto.getRandomValues(arr) : arr.fill(Math.floor(Math.random() * 256)));
    return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return String(Date.now()) + '-' + Math.random().toString(16).slice(2);
  }
}

export function loadLidoHistory() {
  return loadAll();
}

export function loadLidoHistoryFor(owner) {
  const who = String(owner ?? '').trim().toLowerCase();
  if (!who) return [];
  return loadAll().filter((r) => String(r.owner ?? '').toLowerCase() === who);
}

export function recordLidoAction({
  action,
  owner,
  chainId = 1,
  amountWei = null,
  amount = null,
  symbol = '',
  status = 'pending',
  txHash = null,
  blockNumber = null,
  requestId = null
} = {}) {
  const row = {
    id: randomId(),
    action: String(action ?? ''),
    owner: String(owner ?? '').trim().toLowerCase(),
    chainId,
    amountWei: amountWei == null ? null : String(amountWei),
    amount: amount == null ? null : Number(amount),
    symbol: String(symbol ?? ''),
    status,
    txHash: txHash ? String(txHash) : null,
    blockNumber: blockNumber == null ? null : Number(blockNumber),
    requestId: requestId == null ? null : String(requestId),
    at: new Date().toISOString()
  };
  const all = loadAll();
  all.push(row);
  saveAll(all);
  return row;
}

export function confirmLidoAction(id, { txHash, blockNumber, requestId } = {}) {
  const all = loadAll();
  const idx = all.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  all[idx] = {
    ...all[idx],
    status: 'confirmed',
    txHash: txHash ? String(txHash) : all[idx].txHash,
    blockNumber: blockNumber == null ? all[idx].blockNumber : Number(blockNumber),
    requestId: requestId == null ? all[idx].requestId : String(requestId)
  };
  saveAll(all);
  return all[idx];
}

export function replaceLidoAction(id, { error = 'TRANSACTION_REPLACED', txHash = null } = {}) {
  const all = loadAll();
  const idx = all.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  all[idx] = { ...all[idx], status: 'replaced', error, txHash: txHash ? String(txHash) : all[idx].txHash };
  saveAll(all);
  return all[idx];
}

export function timeoutLidoAction(id, { error = 'TRANSACTION_TIMEOUT' } = {}) {
  const all = loadAll();
  const idx = all.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  all[idx] = { ...all[idx], status: 'timeout', error };
  saveAll(all);
  return all[idx];
}

export function failLidoAction(id, { error, revertKey } = {}) {
  const all = loadAll();
  const idx = all.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  all[idx] = {
    ...all[idx],
    status: 'failed',
    error: error ? String(error).slice(0, 300) : null,
    revertKey: revertKey ? String(revertKey) : null
  };
  saveAll(all);
  return all[idx];
}

export function cancelLidoAction(id, reason = 'USER_REJECTED') {
  const all = loadAll();
  const idx = all.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  all[idx] = { ...all[idx], status: 'cancelled', cancelReason: reason };
  saveAll(all);
  return all[idx];
}

export function derivePartialApprovalState({ owner, allowanceWstETHWei, allowanceQueueWei } = {}) {
  const allowances = {
    wstETH: allowanceWstETHWei == null ? 0n : BigInt(allowanceWstETHWei),
    queue: allowanceQueueWei == null ? 0n : BigInt(allowanceQueueWei)
  };
  const needed = allowances.wstETH > 0n || allowances.queue > 0n;
  return {
    needed,
    allowances,
    owner: String(owner ?? '').toLowerCase()
  };
}
