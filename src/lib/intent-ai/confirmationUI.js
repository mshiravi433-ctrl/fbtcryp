/**
 * Immutable Confirmation Gate UI block. Never executable by itself.
 */
import { confirmationSummary } from './draftOrder.js';

export const CONFIRMATION_UI_SCHEMA = 'fbt.confirmation-ui.v1';

export const GATE_BUTTONS = Object.freeze(['CONFIRM', 'REJECT', 'CANCEL', 'REAUTHORIZE']);

export function buildConfirmationBlock(order, extras = {}) {
  const summary = confirmationSummary(order);
  if (!summary) return null;
  return Object.freeze({
    schema: CONFIRMATION_UI_SCHEMA,
    immutable: true,
    buttons: GATE_BUTTONS,
    fields: Object.freeze({
      asset: summary.asset_pair,
      amount: summary.amount_in,
      usdValue: summary.usd_value,
      chain: summary.chain_id,
      protocol: summary.protocol,
      recipient: summary.recipient,
      route: extras.routeFingerprint || order.route?.planId || 'quoted-at-submit',
      slippage: summary.slippage_pct,
      fee: summary.fee_bps,
      leverage: summary.leverage,
      deadline: summary.deadline_iso,
      maxLoss: summary.max_loss_usd,
      agentsInvolved: extras.agents || [order.agentInvolved || 'fbt-core'],
      policyId: summary.policy_id,
      riskSummary: extras.riskSummary || { level: 'unknown', decision: 'acknowledge' }
    }),
    termsHash: extras.termsHash || null,
    disclaimer: 'NOT_GUARANTEED_NO_ZERO_RISK'
  });
}
