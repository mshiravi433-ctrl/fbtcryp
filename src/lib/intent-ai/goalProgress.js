/**
 * FBT INTENT AI — Spec 65 items 41–42: Goal Progress Engine and Goal Tree.
 *
 * Progress toward a target is computed only from an ATTESTED balance — a
 * provider observation with id, checkedAt and confirmation. Without one the
 * progress percentage is null and stays null. The goal tree decomposes an
 * objective into bounded sub-goals (capital growth, risk control, monthly
 * DCA, yield); the tree is a planning artifact, never an execution.
 */

import { bounded, containsRawSecret, fail, finite, noExecutionPermission, safeId, safeString } from './phaseBoundary.js';

export const GOAL_PROGRESS_SCHEMA = 'fbt.intent-goal-progress.v1';
export const GOAL_TREE_SCHEMA = 'fbt.intent-goal-tree.v1';

function attestedBalance(balance) {
  if (!balance || typeof balance !== 'object') return null;
  const value = finite(balance.valueUsd);
  const checkedAt = finite(balance.checkedAt);
  const providerId = safeId(balance.providerId) || safeString(String(balance.providerId || ''), 80);
  const confirmed = balance.confirmed === true;
  const evidenceId = safeId(balance.evidenceId) || safeString(String(balance.evidenceId || ''), 120);
  if (value === null || value < 0 || checkedAt === null || !providerId || !confirmed) return null;
  return { valueUsd: value, checkedAt, providerId, confirmed, evidenceId };
}

/**
 * Target / Current / Progress%. The balance must arrive attested; an
 * unattested or missing balance yields progressPct=null with status
 * 'unattested' — never a fabricated percentage.
 */
export function goalProgress({ targetCapital = null, currentBalance = null, capitalUsd = null, now = Date.now() } = {}) {
  if (containsRawSecret({ targetCapital, currentBalance })) return fail('RAW_CREDENTIAL_FORBIDDEN');
  const target = finite(targetCapital);
  if (target === null || target <= 0) return fail('TARGET_CAPITAL_REQUIRED');
  const initial = finite(capitalUsd);
  const attested = attestedBalance(currentBalance);
  if (!attested) {
    return noExecutionPermission({
      ok: true,
      schema: GOAL_PROGRESS_SCHEMA,
      targetCapital: target,
      currentBalanceUsd: null,
      progressPct: null,
      status: 'unattested',
      note: 'No attested balance observation was supplied; progress stays unknown instead of being guessed.',
      progressComputable: false,
      checkedAt: now
    });
  }
  const progressPct = Math.round(((attested.valueUsd / target) * 100) * 100) / 100;
  const fromInitial = initial !== null && initial > 0
    ? Math.round((((attested.valueUsd - initial) / initial) * 100) * 100) / 100
    : null;
  return noExecutionPermission({
    ok: true,
    schema: GOAL_PROGRESS_SCHEMA,
    targetCapital: target,
    currentBalanceUsd: attested.valueUsd,
    initialCapitalUsd: initial,
    progressPct,
    growthFromInitialPct: fromInitial,
    remainingUsd: Math.round(Math.max(0, target - attested.valueUsd) * 100) / 100,
    status: 'attested',
    balanceEvidence: { providerId: attested.providerId, checkedAt: attested.checkedAt, evidenceId: attested.evidenceId },
    progressComputable: true,
    executionAuthorized: false,
    checkedAt: now
  });
}

const GOAL_TREE_KINDS = Object.freeze(['capital-growth', 'risk-control', 'monthly-dca', 'yield']);

/**
 * Build a goal tree: a root objective decomposed into typed sub-goals with
 * bounded weights. Weights must sum to at most 100. The tree is descriptive;
 * it cannot execute and cannot move funds.
 */
export function buildGoalTree({ root = null, subgoals = [], now = Date.now() } = {}) {
  if (containsRawSecret({ root, subgoals })) return fail('RAW_CREDENTIAL_FORBIDDEN');
  const rootId = safeId(root?.id || 'goal-root');
  const title = safeString(String(root?.title || ''), 120);
  if (!rootId || !title) return fail('ROOT_REQUIRED');
  const rows = [];
  const invalidWeights = [];
  (Array.isArray(subgoals) ? subgoals : []).slice(0, 12).forEach((row, index) => {
    if (!row || typeof row !== 'object') return;
    const kind = GOAL_TREE_KINDS.includes(row.kind) ? row.kind : null;
    const id = safeId(row.id || `subgoal-${index + 1}`);
    const weightPct = bounded(row.weightPct);
    if (!kind || !id) return;
    if (weightPct === null) {
      // A recognized sub-goal with an unusable weight is a hard error, not a
      // silently dropped node.
      invalidWeights.push(id);
      return;
    }
    rows.push({
      id,
      kind,
      title: safeString(String(row.title || kind), 120) || kind,
      weightPct,
      target: row.target == null ? null : finite(row.target),
      executable: false,
      note: 'Sub-goals decompose planning; none of them authorizes an order.'
    });
  });
  if (invalidWeights.length) return fail('SUBGOAL_WEIGHT_INVALID', `Invalid weight on: ${invalidWeights.join(', ')}.`);
  const totalWeight = Math.round(rows.reduce((sum, row) => sum + row.weightPct, 0) * 100) / 100;
  if (totalWeight > 100) return fail('TREE_OVER_WEIGHTED', `Sub-goal weights sum to ${totalWeight}% (>100%).`);
  return noExecutionPermission({
    ok: true,
    schema: GOAL_TREE_SCHEMA,
    root: { id: rootId, title, target: root?.target == null ? null : finite(root.target) },
    subgoals: rows,
    totalWeightPct: totalWeight,
    unallocatedWeightPct: Math.round((100 - totalWeight) * 100) / 100,
    treeIsNotExecution: true,
    builtAt: now
  });
}
