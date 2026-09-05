/**
 * FBT FINANCIAL OS — Universal Action Model (Upgrade 11+12 §14)
 * ---------------------------------------------------------------------------
 * Standardized action format that every module produces and the orchestrator
 * consumes. Replaces ad-hoc action objects with a single schema that carries
 * enough metadata for simulation, permission, execution, verification, and
 * idempotency — so duplicate execution is impossible and every action is
 * auditable end-to-end.
 *
 * WHY THIS EXISTS
 * Previously each module returned its own shape. The orchestrator had to
 * guess which fields mattered. With UAM, every action has the same envelope
 * regardless of whether it came from swap, lending, bridge, or pay — and the
 * permission engine, simulation layer, and verification engine all speak the
 * same language.
 */

export const UAM_SCHEMA = 'fbt.universal-action-model.v1';

/** All action types the system can produce */
export const ACTION_TYPES = Object.freeze([
  'PAYMENT', 'SWAP', 'BUY', 'SELL', 'TRANSFER', 'BRIDGE',
  'BORROW', 'LEND', 'STAKE', 'UNSTAKE',
  'ADD_LIQUIDITY', 'REMOVE_LIQUIDITY',
  'INVEST', 'REBALANCE', 'DCA',
  'CREATE_ORDER', 'CANCEL_ORDER', 'MODIFY_ORDER',
  'OPEN_POSITION', 'CLOSE_POSITION',
  'RESEARCH', 'MONITOR', 'ALERT',
  'CREATE_GOAL', 'UPDATE_GOAL',
  'APPROVE_TOKEN', 'REVOKE_APPROVAL',
  'DEPLOY_CONTRACT', 'SIGN_MESSAGE',
  'CONNECT_WALLET', 'DISCONNECT_WALLET',
  'NOTIFY', 'REPORT'
]);

/** Risk levels for actions */
export const RISK_LEVELS = Object.freeze({
  NONE: { level: 0, label: 'No Risk', color: '#22c55e' },
  LOW: { level: 1, label: 'Low Risk', color: '#84cc16' },
  MEDIUM: { level: 2, label: 'Medium Risk', color: '#eab308' },
  HIGH: { level: 3, label: 'High Risk', color: '#f97316' },
  CRITICAL: { level: 4, label: 'Critical', color: '#ef4444' }
});

/** Permission scopes required for actions */
export const PERMISSION_LEVELS = Object.freeze({
  NONE: 'none',         // no permission needed (read-only)
  INFORM: 'inform',     // user should be informed
  CONFIRM: 'confirm',   // user must confirm
  AUTHENTICATE: 'authenticate', // user must authenticate
  APPROVE: 'approve'    // admin/approval required
});

/**
 * Create a Universal Action
 * @param {Object} params
 * @returns {Object} UniversalAction envelope
 */
export function createUniversalAction({
  module,
  actionType,
  intentId = null,
  userId = null,
  inputs = {},
  expectedOutput = null,
  riskLevel = 'LOW',
  requiredPermission = 'CONFIRM',
  estimatedGasUsd = null,
  estimatedTimeMs = null,
  idempotencyKey = null,
  metadata = {}
} = {}) {
  // Validate action type
  if (!ACTION_TYPES.includes(actionType)) {
    return {
      ok: false,
      code: 'UNKNOWN_ACTION_TYPE',
      detail: `Action type "${actionType}" is not in the registry. Valid types: ${ACTION_TYPES.join(', ')}`,
      validTypes: ACTION_TYPES
    };
  }

  // Validate module
  if (!module || typeof module !== 'string') {
    return { ok: false, code: 'MODULE_REQUIRED', detail: 'Every action must declare which module produced it' };
  }

  const now = Date.now();
  const actionId = `act_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  return {
    ok: true,
    action: {
      schema: UAM_SCHEMA,
      actionId,
      intentId: intentId ? String(intentId).slice(0, 64) : null,
      userId: userId ? String(userId).slice(0, 80) : null,
      module: String(module).toUpperCase().slice(0, 32),
      actionType,
      inputs: sanitizeInputs(inputs),
      expectedOutput: expectedOutput || null,
      riskLevel: RISK_LEVELS[riskLevel] ? riskLevel : 'MEDIUM',
      requiredPermission: PERMISSION_LEVELS[requiredPermission] ? requiredPermission : 'CONFIRM',
      estimatedGasUsd: estimatedGasUsd != null ? Number(estimatedGasUsd) : null,
      estimatedTimeMs: estimatedTimeMs != null ? Number(estimatedTimeMs) : null,
      idempotencyKey: idempotencyKey || `${actionId}:${module}:${actionType}:${hashInputs(inputs)}`,
      metadata: { ...metadata, createdAt: now },
      // Execution lifecycle — set by orchestrator
      status: 'CREATED',
      simulation: null,
      permission: null,
      execution: null,
      verification: null,
      evidence: null,
      // Timestamps
      createdAt: now,
      updatedAt: now,
      expiresAt: now + 5 * 60_000 // 5 minute default expiry
    }
  };
}

/**
 * Transition an action through its lifecycle
 */
export function transitionAction(action, nextStatus, data = {}) {
  const validTransitions = {
    CREATED: ['SIMULATED', 'CANCELLED', 'EXPIRED'],
    SIMULATED: ['PENDING_PERMISSION', 'CANCELLED', 'EXPIRED'],
    PENDING_PERMISSION: ['APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED'],
    APPROVED: ['EXECUTING', 'CANCELLED', 'EXPIRED'],
    EXECUTING: ['EXECUTED', 'FAILED', 'CANCELLED'],
    EXECUTED: ['VERIFYING'],
    VERIFYING: ['VERIFIED', 'MISMATCH', 'FAILED'],
    VERIFIED: ['COMPLETED'],
    COMPLETED: [],
    FAILED: ['RETRYING'],
    RETRYING: ['EXECUTING', 'FAILED'],
    CANCELLED: [],
    REJECTED: [],
    EXPIRED: [],
    MISMATCH: ['FAILED']
  };

  const current = action?.status;
  const allowed = validTransitions[current] || [];

  if (!allowed.includes(nextStatus)) {
    return {
      ok: false,
      code: 'ILLEGAL_TRANSITION',
      from: current,
      to: nextStatus,
      allowed
    };
  }

  const now = Date.now();
  const updated = {
    ...action,
    status: nextStatus,
    updatedAt: now,
    history: [
      ...(action.history || []),
      { status: nextStatus, at: now, data: sanitizeInputs(data) }
    ].slice(-20)
  };

  // Attach phase-specific data
  if (nextStatus === 'SIMULATED') updated.simulation = data.simulation || null;
  if (nextStatus === 'APPROVED' || nextStatus === 'PENDING_PERMISSION') updated.permission = data.permission || null;
  if (nextStatus === 'EXECUTED' || nextStatus === 'EXECUTING') updated.execution = data.execution || null;
  if (nextStatus === 'VERIFIED' || nextStatus === 'VERIFYING') updated.verification = data.verification || null;
  if (nextStatus === 'COMPLETED') updated.evidence = data.evidence || null;

  return { ok: true, action: updated };
}

/**
 * Check if an action is a duplicate using idempotency
 */
export function checkIdempotency(action, recentActions = []) {
  if (!action?.idempotencyKey) return { duplicate: false };

  const match = recentActions.find(a =>
    a.idempotencyKey === action.idempotencyKey &&
    a.status !== 'CANCELLED' &&
    a.status !== 'FAILED' &&
    a.status !== 'EXPIRED' &&
    a.status !== 'REJECTED' &&
    Date.now() - a.createdAt < 10 * 60_000 // 10 minute window
  );

  if (match) {
    return {
      duplicate: true,
      existingActionId: match.actionId,
      existingStatus: match.status,
      detail: 'An identical action was already submitted recently'
    };
  }

  return { duplicate: false };
}

/**
 * Compute overall risk score for a set of actions
 */
export function computeBatchRisk(actions = []) {
  if (!actions.length) return { level: 'NONE', score: 0 };

  const riskWeights = { NONE: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
  let totalWeight = 0;
  let maxRisk = 0;
  let valueAtRisk = 0;

  for (const a of actions) {
    const w = riskWeights[a.riskLevel] || 2;
    totalWeight += w;
    maxRisk = Math.max(maxRisk, w);
    if (a.inputs?.amountUsd) {
      valueAtRisk += Number(a.inputs.amountUsd) * (w / 4);
    }
  }

  const avgRisk = totalWeight / actions.length;
  let level;
  if (maxRisk >= 4) level = 'CRITICAL';
  else if (maxRisk >= 3 || avgRisk >= 2.5) level = 'HIGH';
  else if (avgRisk >= 1.5) level = 'MEDIUM';
  else if (avgRisk >= 0.5) level = 'LOW';
  else level = 'NONE';

  return {
    level,
    score: Math.round(avgRisk * 100) / 100,
    maxRisk,
    valueAtRiskUsd: Math.round(valueAtRisk * 100) / 100,
    actionCount: actions.length
  };
}

/**
 * Serialize an action for the confirmation UI
 */
export function actionToConfirmationCard(action) {
  return {
    actionId: action.actionId,
    module: action.module,
    actionType: action.actionType,
    summary: formatActionSummary(action),
    riskLevel: action.riskLevel,
    riskColor: RISK_LEVELS[action.riskLevel]?.color || '#eab308',
    estimatedGasUsd: action.estimatedGasUsd,
    estimatedTimeMs: action.estimatedTimeMs,
    expiresAt: action.expiresAt,
    inputs: action.inputs,
    requiresPermission: action.requiredPermission !== 'NONE',
    permissionLevel: action.requiredPermission
  };
}

function formatActionSummary(action) {
  const { module, actionType, inputs } = action;
  switch (actionType) {
    case 'SWAP': return `Swap ${inputs.fromAmount || ''} ${inputs.fromAsset || ''} → ${inputs.toAsset || ''}`;
    case 'BUY': return `Buy ${inputs.amount || ''} ${inputs.asset || ''}`;
    case 'SELL': return `Sell ${inputs.amount || ''} ${inputs.asset || ''}`;
    case 'PAYMENT': return `Pay ${inputs.amountUsd || ''} USD via ${inputs.network || 'default'}`;
    case 'TRANSFER': return `Transfer ${inputs.amount || ''} ${inputs.asset || ''} to ${inputs.destination || '...'}`;
    case 'LEND': return `Lend ${inputs.amountUsd || ''} USD on ${inputs.protocol || 'best yield'}`;
    case 'BORROW': return `Borrow ${inputs.amountUsd || ''} USD`;
    case 'STAKE': return `Stake ${inputs.amount || ''} ${inputs.asset || ''}`;
    case 'INVEST': return `Invest ${inputs.amountUsd || ''} USD`;
    case 'REBALANCE': return `Rebalance portfolio`;
    case 'BRIDGE': return `Bridge ${inputs.amount || ''} ${inputs.asset || ''} to ${inputs.targetChain || ''}`;
    default: return `${actionType} via ${module}`;
  }
}

function sanitizeInputs(inputs) {
  if (!inputs || typeof inputs !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(inputs)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'string') out[k] = v.slice(0, 500);
    else if (typeof v === 'number') out[k] = Number.isFinite(v) ? v : 0;
    else if (typeof v === 'boolean') out[k] = v;
    else if (Array.isArray(v)) out[k] = v.slice(0, 50);
    else out[k] = v;
  }
  return out;
}

function hashInputs(inputs) {
  try {
    return String(JSON.stringify(inputs) || '').slice(0, 32);
  } catch {
    return String(Date.now());
  }
}

export default {
  createUniversalAction, transitionAction, checkIdempotency,
  computeBatchRisk, actionToConfirmationCard, ACTION_TYPES,
  RISK_LEVELS, PERMISSION_LEVELS, UAM_SCHEMA
};
