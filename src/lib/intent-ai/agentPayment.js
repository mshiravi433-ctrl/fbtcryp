/**
 * FBT INTENT AI — Spec 65 item 52: Agent Payment Layer.
 *
 * Before an external agent starts: service fee, performance fee and network
 * fee are declared with a withdrawal cap. The agent has NO right to withdraw
 * above the cap — a withdrawal request above the cap is blocked. Displaying a
 * fee is not paying it: settlement requires settlement evidence, otherwise the
 * fee stays `displayed-only`.
 */

import { containsRawSecret, fail, finite, noExecutionPermission, safeId } from './phaseBoundary.js';

export const AGENT_PAYMENT_SCHEMA = 'fbt.intent-agent-payment.v1';

/**
 * Declare the payment plan before work starts. All three fee classes must be
 * present (they may be zero only with explicit evidence), and the withdrawal
 * cap must be a non-negative number.
 */
export function createPaymentPlan({
  agentId = null,
  intentId = null,
  fees = {},
  feeEvidence = {},
  withdrawalCapUsd = null,
  now = Date.now()
} = {}) {
  if (containsRawSecret({ agentId, intentId, fees, feeEvidence })) return fail('RAW_CREDENTIAL_FORBIDDEN');
  const agent = safeId(agentId) || safeStringSafe(agentId);
  if (!agent) return fail('AGENT_ID_REQUIRED');
  const service = finite(fees.serviceUsd);
  const performance = finite(fees.performancePct);
  const network = finite(fees.networkUsd);
  const cap = finite(withdrawalCapUsd);
  if (service === null || service < 0) return fail('SERVICE_FEE_REQUIRED');
  if (performance === null || performance < 0 || performance > 100) return fail('PERFORMANCE_FEE_INVALID');
  if (network === null || network < 0) return fail('NETWORK_FEE_REQUIRED');
  if (cap === null || cap < 0) return fail('WITHDRAWAL_CAP_REQUIRED');
  const zeroClaimed = [service === 0, performance === 0, network === 0];
  const zeroEvidence = ['serviceUsd', 'performancePct', 'networkUsd'].map((key) => feeEvidence?.[key] === true);
  const unevidencedZero = zeroClaimed.some((claim, index) => claim && !zeroEvidence[index]);
  return noExecutionPermission({
    ok: true,
    schema: AGENT_PAYMENT_SCHEMA,
    agentId: agent,
    intentId: safeId(intentId),
    fees: { serviceUsd: service, performancePct: performance, networkUsd: network },
    withdrawalCapUsd: cap,
    paid: false,
    paidIsDisplay: unevidencedZero ? 'zero-fee-without-evidence-flagged' : 'displayed-only',
    unevidencedZeroFee: unevidencedZero,
    note: 'Declaring or displaying fees is not paying them; settlement requires settlement evidence.',
    createdAt: now
  });
}

function safeStringSafe(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text && text.length <= 80 ? text : null;
}

/**
 * A withdrawal attempt by an agent. Above the cap → BLOCKED, always. This
 * layer never holds funds and never moves funds; it only records the request
 * and enforces the cap boundary.
 */
export function requestAgentWithdrawal(paymentPlan, { amountUsd = null, now = Date.now() } = {}) {
  if (!paymentPlan || paymentPlan.schema !== AGENT_PAYMENT_SCHEMA) return fail('BAD_PAYMENT_PLAN');
  if (containsRawSecret({ amountUsd })) return fail('RAW_CREDENTIAL_FORBIDDEN');
  const amount = finite(amountUsd);
  if (amount === null || amount < 0) return fail('AMOUNT_REQUIRED');
  if (amount > paymentPlan.withdrawalCapUsd) {
    return fail('WITHDRAWAL_ABOVE_CAP', `Requested ${amount} exceeds the cap ${paymentPlan.withdrawalCapUsd}. The agent has no right to withdraw above the cap.`);
  }
  return noExecutionPermission({
    ok: true,
    schema: AGENT_PAYMENT_SCHEMA,
    agentId: paymentPlan.agentId,
    requestedUsd: amount,
    withinCap: true,
    settled: false,
    settlementRequiresEvidence: true,
    fundsMovedByThisLayer: false,
    requestedAt: now
  });
}

/**
 * Mark a fee settled ONLY with settlement evidence (provider id, checkedAt,
 * confirmed). Without it the fee remains displayed, not paid.
 */
export function settleFeeWithEvidence(paymentPlan, { amountUsd = null, settlement = null, now = Date.now() } = {}) {
  if (!paymentPlan || paymentPlan.schema !== AGENT_PAYMENT_SCHEMA) return fail('BAD_PAYMENT_PLAN');
  if (containsRawSecret(settlement)) return fail('RAW_CREDENTIAL_FORBIDDEN');
  const amount = finite(amountUsd);
  const providerId = safeId(settlement?.providerId) || (typeof settlement?.providerId === 'string' && settlement.providerId.length <= 80 ? settlement.providerId : null);
  const checkedAt = finite(settlement?.checkedAt);
  const confirmed = settlement?.confirmed === true;
  const evidenceId = typeof settlement?.evidenceId === 'string' && settlement.evidenceId.length <= 120 ? settlement.evidenceId : null;
  if (amount === null || amount < 0) return fail('AMOUNT_REQUIRED');
  if (!providerId || checkedAt === null || checkedAt > now || !confirmed || !evidenceId) {
    return noExecutionPermission({
      ok: true,
      schema: AGENT_PAYMENT_SCHEMA,
      status: 'displayed-only',
      settled: false,
      reason: 'Settlement evidence (provider, checkedAt, confirmed, evidenceId) is missing; the fee stays displayed, not paid.',
      checkedAt: now
    });
  }
  return noExecutionPermission({
    ok: true,
    schema: AGENT_PAYMENT_SCHEMA,
    status: 'settled-with-evidence',
    settled: true,
    settledUsd: amount,
    settlementEvidence: { providerId, checkedAt, evidenceId },
    fundsMovedByThisLayer: false,
    settledAt: now
  });
}
