/**
 * Phase 2 pipeline:
 * Draft → Guardian → RiskEngine → ConfirmationGate → SessionKey → sign → submit → monitor → reconcile
 */
import { guardianReview, emergencyStopCheck } from './guardian.js';
import { evaluateRisk } from './riskEngine.js';
import { openConfirmationGate, decideGate, assertGateAllowsSubmit, termsFromDraft } from './confirmationGate.js';
import { issueSessionKey, scopeFor, revokeAllForPolicy } from './sessionKeys.js';
import { signDraft } from './walletAdapter.js';
import { brokerSubmit } from './brokerAdapter.js';
import { createMonitor, heartbeat } from './executionMonitor.js';
import { reconcile } from './reconciliation.js';
import { classifyFailure, lifecycleStatusForFailure } from './failureModes.js';
import {
  createLifecycle, transition, recordReview, applyMaterialChange, termsFingerprint
} from '../intentLifecycle.js';
import { audit } from './audit.js';

export function prepareExecution({
  draftOrder,
  policy,
  session,
  riskInput = {},
  termsHash
} = {}) {
  const stop = emergencyStopCheck(policy?.emergencyStop === true);
  if (!stop.ok) return fail(session, 'EMERGENCY_STOP');

  const action = {
    action: draftOrder?.kind === 'futures_open' ? 'futures' : (draftOrder?.kind || 'swap'),
    chainId: draftOrder?.chainId,
    protocol: draftOrder?.protocol || 'swap',
    asset: draftOrder?.toSymbol || draftOrder?.fromSymbol,
    fromSymbol: draftOrder?.fromSymbol,
    toSymbol: draftOrder?.toSymbol,
    amountUsd: draftOrder?.amountUsd,
    slippagePct: draftOrder?.slippagePct,
    feeBps: draftOrder?.feeBps,
    leverage: draftOrder?.leverage,
    execution: true
  };
  const g = guardianReview(action, policy, {
    sessionStartAt: policy?.sessionStartAt,
    now: Date.now(),
    termsHash,
    approvedTermsHash: termsHash
  });
  if (!g.approved) return fail(session, 'GUARDIAN_REJECTED', { reasons: g.reasons });

  const risk = evaluateRisk({
    ...riskInput,
    priceImpactPct: draftOrder?.priceImpactPct ?? riskInput.priceImpactPct ?? 0,
    slippagePct: draftOrder?.slippagePct ?? riskInput.slippagePct
  });
  if (risk.decision === 'block') return fail(session, 'RISK_BLOCKED', { blocked: risk.blocked });

  const opened = openConfirmationGate({
    order: draftOrder,
    termsHash,
    riskSummary: { level: risk.level, decision: risk.decision }
  });
  if (!opened.ok) return { ok: false, error: opened.error };

  let lc = createLifecycle({ intentId: draftOrder.id, origin: 'intent-ai' });
  lc = walk(lc, ['VALIDATING', 'VALIDATED', 'QUOTING', 'OPTIMIZING', 'SIMULATING', 'AWAITING_APPROVAL']);
  lc = recordReview(lc, termsFromDraft(draftOrder));

  if (session) audit(session, 'fbt.exec', 'gate.opened', { draftId: draftOrder.id }, 'ok');

  return {
    ok: true,
    guardian: g,
    risk,
    gate: opened.gate,
    lifecycle: lc,
    requiresAck: risk.decision === 'acknowledge'
  };
}

export function confirmAndSubmit({
  prepared,
  action = 'CONFIRM',
  policy,
  session,
  signer,
  brokerHandle,
  idempotencyKey,
  currentTerms,
  submitVia = 'wallet'
} = {}) {
  const stop = emergencyStopCheck(policy?.emergencyStop === true);
  if (!stop.ok) return fail(session, 'EMERGENCY_STOP');

  const decided = decideGate(prepared.gate, action, { currentTerms });
  if (!decided.ok) {
    if (decided.action === 'REAUTHORIZE' && prepared.lifecycle) {
      const moved = applyMaterialChange(prepared.lifecycle, ['TERMS']);
      return { ok: false, error: decided.error, lifecycle: moved.record, gate: decided.gate, reauthoriseRequired: true };
    }
    return { ok: false, error: decided.error, gate: decided.gate };
  }
  const allowed = assertGateAllowsSubmit(decided.gate);
  if (!allowed.ok) return { ok: false, error: allowed.error };

  const sk = issueSessionKey({
    policyId: policy.id,
    allowedChains: policy.allowedChains,
    allowedProtocols: policy.allowedProtocols,
    maxAmountUsd: policy.maxTransactionUsd
  });
  if (!sk.ok) return { ok: false, error: sk.error };
  const scoped = scopeFor(sk.sessionKey, prepared.gate.ui ? { ...currentTerms } : {}, {});
  // scope against draft-like object from locked terms
  const draftLike = {
    chainId: decided.gate.lockedTerms.chainId,
    protocol: decided.gate.lockedTerms.protocol,
    amountUsd: Number(decided.gate.lockedTerms.amountIn),
    amountIn: decided.gate.lockedTerms.amountIn
  };
  const scoped2 = scopeFor(sk.sessionKey, draftLike);
  if (!scoped2.ok) return { ok: false, error: scoped2.error };

  let signed = null;
  let submit = null;
  if (submitVia === 'broker') {
    submit = brokerSubmit({
      draftOrder: draftLike,
      handle: brokerHandle,
      idempotencyKey: idempotencyKey || `idemp_${Date.now()}`
    });
    if (!submit.ok) return { ok: false, error: submit.error };
  } else {
    signed = signDraft(
      { id: prepared.lifecycle.intentId, kind: 'swap', chainId: draftLike.chainId, protocol: draftLike.protocol, amountUsd: draftLike.amountUsd },
      sk.sessionKey,
      { signer: signer || (() => ({ signedTx: 'stub-signed' })) }
    );
    if (!signed.ok) return { ok: false, error: signed.error };
    submit = { ok: true, submitted: true, receiptRef: `tx_${Date.now().toString(36)}`, confirmed: false };
  }

  let lc = prepared.lifecycle;
  const toSig = transition(lc, 'AWAITING_SIGNATURE', { reasonCode: 'GATE_CONFIRMED' });
  lc = toSig.ok ? toSig.record : lc;
  const sub = transition(lc, 'SUBMITTED', { reasonCode: 'SUBMITTED' });
  lc = sub.ok ? sub.record : lc;

  const mon = createMonitor({ txRef: submit.receiptRef });
  if (session) audit(session, 'fbt.exec', 'submitted', { ref: submit.receiptRef }, 'ok');

  return {
    ok: true,
    gate: decided.gate,
    sessionKey: sk.sessionKey,
    signed,
    submit,
    lifecycle: lc,
    monitor: mon.monitor
  };
}

export function observeAndReconcile({ submitted, observation, session, emergencyStop = false } = {}) {
  const beat = heartbeat(submitted.monitor, observation, { emergencyStop });
  if (!beat.ok && beat.error?.code === 'EMERGENCY_STOP') {
    return { ok: false, error: beat.error, lifecycleStatus: 'CANCELLED', receipt: null };
  }
  const rec = reconcile({
    lifecycleStatus: beat.monitor?.status,
    observation
  });
  if (session) {
    audit(session, 'fbt.exec', 'reconcile', { status: rec.receipt?.status, confirmed: rec.receipt?.confirmed }, rec.ok ? 'ok' : 'warning');
  }
  return { ...rec, monitor: beat.monitor };
}

export function emergencyHalt(policy, session) {
  if (policy?.id) revokeAllForPolicy(policy.id);
  return fail(session, 'EMERGENCY_STOP');
}

function walk(lc, statuses) {
  let cur = lc;
  for (const s of statuses) {
    const t = transition(cur, s, { reasonCode: 'PIPELINE' });
    if (t.ok) cur = t.record;
  }
  return cur;
}

function fail(session, code, detail) {
  const error = classifyFailure(code, { detail: detail ? JSON.stringify(detail).slice(0, 180) : null });
  if (session) audit(session, 'guardian', 'blocked', { code }, 'rejected');
  return { ok: false, error, lifecycleStatus: lifecycleStatusForFailure(error) };
}

export { termsFingerprint };
