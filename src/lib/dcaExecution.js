/**
 * DCA execution evidence and lifecycle.
 *
 * A schedule is not a trade. This small, storage-only model deliberately keeps
 * the two separate: only a receipt which is explicitly verified, complete and
 * bound to both the order and its goal may contribute to goal progress.
 */
export const DCA_RECEIPTS_KEY = 'fbt-dca-receipts-v1';
export const DCA_EXECUTION_STATUSES = new Set(['active', 'completed', 'failed', 'rejected', 'partial', 'cancelled', 'paused']);

export function isUnavailableChain(chainId) {
  // These adapters have no DCA execution path. Never manufacture a receipt.
  return ['solana', 'dydx', 'ostium'].includes(String(chainId).toLowerCase());
}

export function validExecutionReceipt(receipt, order, goalId) {
  if (!receipt || !order || order.type !== 'dca') return false;
  if (!receipt.verified || receipt.verification !== 'verified') return false;
  if (receipt.orderId !== order.id || receipt.goalId !== goalId || order.goalId !== goalId) return false;
  if (String(receipt.chainId) !== String(order.chainId)) return false;
  if (isUnavailableChain(order.executionProvider) || isUnavailableChain(receipt.executionProvider)) return false;
  if (typeof receipt.txHash !== 'string' || receipt.txHash.trim().length < 8) return false;
  const actualUsd = Number(receipt.actualUsd);
  return Number.isFinite(actualUsd) && actualUsd > 0;
}

export function verifiedGoalExecution({ goalId, orders = [], receipts = [] }) {
  const owned = orders.filter((order) => order?.type === 'dca' && order.goalId === goalId);
  const byId = new Map(owned.map((order) => [order.id, order]));
  const valid = receipts.filter((receipt) => validExecutionReceipt(receipt, byId.get(receipt?.orderId), goalId));
  const totalUsd = valid.reduce((sum, receipt) => sum + Number(receipt.actualUsd), 0);
  return { receipts: valid, totalUsd, hasVerifiedExecution: valid.length > 0 };
}

export function dcaDisplayStatus(order, receipts = []) {
  if (!order || order.type !== 'dca') return 'paused';
  if (order.status === 'cancelled') return 'cancelled';
  const own = receipts.filter((r) => r?.orderId === order.id);
  // Failure/rejection is never hidden just because another run was successful.
  if (own.some((r) => r?.status === 'rejected')) return 'rejected';
  if (own.some((r) => r?.status === 'failed')) return 'failed';
  if (own.some((r) => r?.status === 'partial')) return 'partial';
  if (order.status === 'completed') return 'completed';
  return order.status === 'active' ? 'active' : 'paused';
}

export function createDcaRevision(order, changes, now = Date.now()) {
  if (!order || order.type !== 'dca') return { error: 'NOT_DCA' };
  const id = `o_${now.toString(36)}_revision_${Math.random().toString(36).slice(2, 9)}`;
  const next = {
    ...order,
    ...changes,
    id,
    status: 'paused',
    revisionOf: order.id,
    createdAt: now,
    userSignedAt: undefined,
    cancelRequestedAt: undefined,
    runsDone: 0,
    nextRunAt: undefined
  };
  return { order: next, diff: dcaDiff(order, next) };
}

export function dcaDiff(before, after) {
  const keys = ['amountIn', 'interval', 'fromToken', 'toToken', 'chainId', 'deadlineMs'];
  return keys.filter((key) => JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key])).map((key) => ({ key, before: before?.[key], after: after?.[key] }));
}

export function activateDca(order, explicitSignature, now = Date.now()) {
  if (!order || order.type !== 'dca' || order.status !== 'paused') return { error: 'NOT_PAUSED' };
  if (!explicitSignature || explicitSignature.confirmed !== true) return { error: 'SIGNATURE_REQUIRED' };
  return { order: { ...order, status: 'active', userSignedAt: now, nextRunAt: now } };
}

export function requestDcaCancel(order, now = Date.now()) {
  if (!order || order.type !== 'dca' || order.status !== 'active') return { error: 'NOT_ACTIVE' };
  return { order: { ...order, cancelRequestedAt: now } };
}

export function confirmDcaCancel(order, confirmation, now = Date.now()) {
  if (!order?.cancelRequestedAt) return { error: 'CANCEL_REVIEW_REQUIRED' };
  if (!confirmation || confirmation.confirmed !== true) return { error: 'CANCEL_CONFIRMATION_REQUIRED' };
  return { order: { ...order, status: 'cancelled', cancelledAt: now, cancelRequestedAt: undefined } };
}

export function loadDcaReceipts() {
  try {
    const parsed = JSON.parse(localStorage.getItem(DCA_RECEIPTS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

export function saveDcaReceipts(receipts) {
  try { localStorage.setItem(DCA_RECEIPTS_KEY, JSON.stringify(receipts)); return true; } catch { return false; }
}

/** Stores evidence, but does not bless it. Invalid receipts remain non-progress evidence. */
export function addDcaReceipt(receipt) {
  const next = [receipt, ...loadDcaReceipts()];
  saveDcaReceipts(next);
  return next;
}
