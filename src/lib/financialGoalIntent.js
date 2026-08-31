/**
 * Financial Goal → EXISTING Intent OS.
 * ---------------------------------------------------------------------------
 * The Financial OS does not own an execution engine, and this file is where
 * that promise is kept in code. An approved goal plan arrives here as an
 * intent payload:
 *
 *     { source: 'FINANCIAL_GOAL', goalId, actions: [{ type:'ALLOCATE', asset,
 *       percentage }] }
 *
 * and leaves as an ordinary Intent OS draft — compiled by the EXISTING
 * `compileIntent`, stored by the EXISTING `saveCompiledIntent`, tracked by the
 * EXISTING lifecycle, and reviewed on the EXISTING compose tab. The user's
 * wallet remains the only thing that can execute it.
 *
 * WHY SOME LEGS DISAPPEAR
 *   · STABLE is not a trade: the allocation is already denominated in the
 *     quote asset (USDC), so it stays where it is.
 *   · OTHER is a diversified sleeve with no single token in Intent OS. It is
 *     reported as a note rather than turned into a fake swap — an invented
 *     ticker is how a plan becomes a loss.
 *
 * If fewer than two tradable legs remain, no workflow can be compiled (the
 * existing compiler requires at least two steps) and the caller is told so
 * instead of being handed a broken draft.
 */

import {
  compileIntent,
  loadIntentMemory,
  saveCompiledIntent,
  WORKFLOW_REVERT_POLICIES
} from './intentOS.js';
import { ensureLifecycle, saveLifecycle, transition } from './intentLifecycle.js';

/** Assets Intent OS can actually route a swap to. */
const TRADABLE = new Set(['BTC', 'ETH']);
/** The asset the allocation is denominated in. */
export const QUOTE_ASSET = 'USDC';

export function goalIntentLegs(intent = {}) {
  const actions = Array.isArray(intent?.actions) ? intent.actions : [];
  return actions
    .filter((row) => row?.type === 'ALLOCATE' && TRADABLE.has(String(row.asset || '').toUpperCase()))
    .filter((row) => Number(row.percentage) > 0)
    .map((row) => ({
      asset: String(row.asset).toUpperCase(),
      percentage: Number(row.percentage),
      amount: Number.isFinite(Number(row.amount)) ? Number(row.amount) : null
    }));
}

export function skippedLegs(intent = {}) {
  const actions = Array.isArray(intent?.actions) ? intent.actions : [];
  return actions
    .filter((row) => row?.type === 'ALLOCATE' && !TRADABLE.has(String(row.asset || '').toUpperCase()))
    .map((row) => String(row.asset).toUpperCase());
}

/**
 * Turn the payload into the draft shape the existing compiler already
 * validates: a same-chain workflow of swaps when there are two or more legs,
 * a single swap when there is one.
 */
export function goalIntentToDraft({ goal, intent, memory, now = Date.now() }) {
  const legs = goalIntentLegs(intent);
  const total = Math.max(0, Number(intent?.totalAmount) || 0);
  const legAmount = legs.reduce((sum, leg) => sum + (leg.amount ?? 0), 0);
  const amountIn = legAmount > 0
    ? legAmount
    : (Number(goal?.startingCapital) > 0 ? Number(goal.startingCapital) : total);
  if (!(amountIn > 0)) return { error: 'BAD_AMOUNT' };
  /* Nothing to trade is a real outcome, not an error to paper over: an
     all-stable allocation is a savings plan, and inventing a swap so the
     screen has something to show would be the worst bug in the file. */
  if (legs.length === 0) return { error: 'NO_TRADABLE_LEGS' };

  const chainId = Number(memory?.preferredChainId) || 42161;
  const deadlineAt = now + 2 * 3600_000;
  const note = String(goal?.name || '').trim().slice(0, 80) || 'Financial goal';

  if (legs.length === 1) {
    return {
      draft: {
        kind: 'swap',
        chainId,
        fromSymbol: QUOTE_ASSET,
        toSymbol: legs[0].asset,
        amountIn: String(Math.round(amountIn * 100) / 100),
        maxSlippagePct: Number(memory?.maxSlippagePct) || 0.5,
        deadlineAt,
        note,
        requireExecutionProof: memory?.requireExecutionProof !== false
      },
      kind: 'swap',
      legs
    };
  }

  return {
    draft: {
      kind: 'workflow',
      chainId,
      fromSymbol: QUOTE_ASSET,
      toSymbol: legs[0].asset,
      amountIn: String(Math.round(amountIn * 100) / 100),
      maxSlippagePct: Number(memory?.maxSlippagePct) || 0.5,
      deadlineAt,
      note,
      requireExecutionProof: memory?.requireExecutionProof !== false,
      steps: legs.map((leg, index) => ({
        id: `alloc-${index + 1}-${String(leg.asset).toLowerCase()}`,
        action: 'swap',
        asset: leg.asset,
        target: `Allocate ${leg.percentage}% to ${leg.asset}`,
        chainId,
        minOutput: '',
        maxInput: '',
        revertPolicy: WORKFLOW_REVERT_POLICIES.includes('abort-all') ? 'abort-all' : 'abort-all',
        deadline: Math.floor(deadlineAt / 1000)
      }))
    },
    kind: 'workflow',
    legs
  };
}

/**
 * Compile + save + start the lifecycle, exactly the way the compose tab does
 * it. Reusing the same three calls is the point: the goal plan is not a second
 * kind of intent, it is an ordinary intent with a financial-goal source.
 *
 * @returns {{ ok: boolean, error?: string, compiled?: object, intentId?: string,
 *             kind?: string, skipped?: string[], lifecycle?: object }}
 */
export function handOffToIntentOS({ goal, intent, now = Date.now() } = {}) {
  if (!intent || intent.source !== 'FINANCIAL_GOAL') return { ok: false, error: 'NOT_A_GOAL_INTENT' };
  const memory = loadIntentMemory();
  const built = goalIntentToDraft({ goal, intent, memory, now });
  if (built.error) return { ok: false, error: built.error };

  const compiled = compileIntent(built.draft, memory, now, { confidentialAvailable: false });
  if (compiled.error) return { ok: false, error: compiled.error };

  const persisted = saveCompiledIntent(compiled);
  let record = ensureLifecycle({
    intentId: compiled.intent.id,
    deadlineAt: compiled.intent.deadlineAt,
    origin: 'financial-goal'
  });
  const validating = transition(record, 'VALIDATING', { reasonCode: 'COMPILED' });
  record = validating.ok ? validating.record : record;
  const next = compiled.blocked
    ? transition(record, 'FAILED', { reasonCode: 'RISK_CHECK_BLOCKED' })
    : transition(record, 'VALIDATED', { reasonCode: 'RISK_CHECKS_PASSED' });
  record = next.ok ? next.record : record;
  const lifecycle = saveLifecycle(record);

  return {
    ok: true,
    compiled,
    intentId: compiled.intent.id,
    kind: built.kind,
    blocked: compiled.blocked === true,
    checks: compiled.checks,
    rows: persisted?.rows ?? null,
    skipped: skippedLegs(intent),
    lifecycle
  };
}
