/**
 * Confirmation Gate — immutable terms lock. Any material change requires REAUTHORIZE.
 */
import { termsFingerprint, MATERIAL_TERM_FIELDS } from '../intentLifecycle.js';
import { buildConfirmationBlock, GATE_BUTTONS } from './confirmationUI.js';
import { classifyFailure } from './failureModes.js';

export const CONFIRMATION_GATE_SCHEMA = 'fbt.confirmation-gate.v1';

export const MATERIAL_FIELDS = Object.freeze([
  ...MATERIAL_TERM_FIELDS,
  'protocol',
  'feeBps',
  'leverage',
  'deadlineAt',
  'strategy',
  'externalAgent'
]);

export function termsFromDraft(order, extras = {}) {
  return {
    chainId: order?.chainId,
    amountIn: order?.amountIn,
    fromSymbol: order?.fromSymbol,
    toSymbol: order?.toSymbol,
    recipientRef: order?.recipientRef || '',
    slippagePct: order?.slippagePct,
    minOut: order?.amountOutEstimate,
    routeFingerprint: extras.routeFingerprint || order?.route?.planId || '',
    protocol: order?.protocol || '',
    feeBps: order?.feeBps,
    leverage: order?.leverage,
    deadlineAt: order?.deadlineAt,
    strategy: extras.strategy || '',
    externalAgent: extras.externalAgent || ''
  };
}

export function openConfirmationGate({ order, termsHash, riskSummary, agents, strategy } = {}) {
  if (!order) {
    return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_DRAFT' }) };
  }
  const terms = termsFromDraft(order, { strategy });
  const hash = termsHash || termsFingerprint(terms);
  const ui = buildConfirmationBlock(order, { termsHash: hash, riskSummary, agents, routeFingerprint: terms.routeFingerprint });
  return {
    ok: true,
    gate: Object.freeze({
      schema: CONFIRMATION_GATE_SCHEMA,
      status: 'AWAITING_USER',
      termsHash: hash,
      lockedTerms: Object.freeze({ ...terms }),
      ui,
      buttons: GATE_BUTTONS,
      confirmed: false,
      rejected: false,
      cancelled: false,
      reauthoriseRequired: false
    })
  };
}

export function decideGate(gate, action, { currentTerms } = {}) {
  if (!gate || gate.schema !== CONFIRMATION_GATE_SCHEMA) {
    return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_GATE' }) };
  }
  const act = String(action || '').toUpperCase();
  if (!GATE_BUTTONS.includes(act)) {
    return { ok: false, error: classifyFailure('UNKNOWN', { detail: act }) };
  }

  if (currentTerms) {
    const nextHash = termsFingerprint(currentTerms);
    if (nextHash !== gate.termsHash) {
      return {
        ok: false,
        gate: Object.freeze({ ...gate, status: 'REAUTHORIZE', reauthoriseRequired: true, confirmed: false }),
        error: classifyFailure('TERMS_CHANGED'),
        action: 'REAUTHORIZE'
      };
    }
  }

  if (act === 'CONFIRM') {
    return {
      ok: true,
      action: 'CONFIRM',
      gate: Object.freeze({
        ...gate,
        status: 'CONFIRMED',
        confirmed: true,
        rejected: false,
        cancelled: false,
        confirmedAt: Date.now()
      })
    };
  }
  if (act === 'REJECT') {
    return {
      ok: false,
      action: 'REJECT',
      gate: Object.freeze({ ...gate, status: 'REJECTED', rejected: true, confirmed: false }),
      error: classifyFailure('USER_REJECTED')
    };
  }
  if (act === 'CANCEL') {
    return {
      ok: false,
      action: 'CANCEL',
      gate: Object.freeze({ ...gate, status: 'CANCELLED', cancelled: true, confirmed: false }),
      error: classifyFailure('USER_CANCELLED')
    };
  }
  return {
    ok: false,
    action: 'REAUTHORIZE',
    gate: Object.freeze({ ...gate, status: 'REAUTHORIZE', reauthoriseRequired: true, confirmed: false }),
    error: classifyFailure('TERMS_CHANGED')
  };
}

export function assertGateAllowsSubmit(gate) {
  if (!gate || gate.schema !== CONFIRMATION_GATE_SCHEMA) {
    return { ok: false, error: classifyFailure('GATE_NOT_CONFIRMED') };
  }
  if (gate.reauthoriseRequired) return { ok: false, error: classifyFailure('TERMS_CHANGED') };
  if (!gate.confirmed || gate.status !== 'CONFIRMED') {
    return { ok: false, error: classifyFailure('GATE_NOT_CONFIRMED') };
  }
  return { ok: true, termsHash: gate.termsHash };
}

export function materialDelta(prev, next) {
  const changed = MATERIAL_FIELDS.filter((k) => String(prev?.[k] ?? '') !== String(next?.[k] ?? ''));
  return { required: changed.length > 0, changed };
}
