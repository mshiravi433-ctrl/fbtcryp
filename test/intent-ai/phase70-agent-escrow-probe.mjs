/**
 * PHASE 70 — AGENT PAYMENT RAIL WITH ESCROW
 * A quote is not a payment. Money is released only against provable delivery,
 * a dispute defaults to refunding the buyer, and the books always balance.
 */
import { readFileSync } from 'node:fs';
import {
  openEscrow, submitDelivery, releaseEscrow, openDispute, resolveDispute, expireEscrow,
  assertEscrowSound, ESCROW_SCHEMA, ESCROW_STATES, DELIVERY_WINDOW_MS, DISPUTE_WINDOW_MS, MAX_ESCROW_USD
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

const NOW = 1_800_000_000_000;
const DELIVERABLE = { kind: 'analysis', asset: 'ETH', horizonDays: 7 };
const base = { jobId: 'j1', buyerId: 'me', agentId: 'agent-1', amountUsd: 120, deliverable: DELIVERABLE, userConfirmed: true, now: NOW };
const PROOF = { verified: true, issuer: 'assurance-op-a' };

try {
  /* ---------- funding is the user's decision ---------- */
  const opened = openEscrow(base);
  check('escrow opens on a confirmed job', opened.ok === true && opened.schema === ESCROW_SCHEMA);
  check('the money is held, not paid', opened.escrow.heldUsd === 120 && opened.escrow.releasedUsd === 0);
  check('the deliverable is committed as a hash', typeof opened.escrow.deliverableHash === 'string');
  check('the delivery deadline is set', opened.escrow.deliverBy === NOW + DELIVERY_WINDOW_MS);
  check('the dispute deadline is later still', opened.escrow.disputeBy === NOW + DELIVERY_WINDOW_MS + DISPUTE_WINDOW_MS);
  check('nothing is escrowed without the user confirming', openEscrow({ ...base, userConfirmed: false }).ok === false);
  check('the unconfirmed refusal is an authorization failure',
    openEscrow({ ...base, userConfirmed: false }).error.code === 'USER_AUTHORIZATION_REQUIRED');
  check('an escrow with no deliverable is refused', openEscrow({ ...base, deliverable: null }).ok === false);
  check('a zero amount is refused', openEscrow({ ...base, amountUsd: 0 }).ok === false);
  check('an empty-string amount is not read as zero-and-fine', openEscrow({ ...base, amountUsd: '' }).ok === false);
  check('an amount above the cap is refused', openEscrow({ ...base, amountUsd: MAX_ESCROW_USD + 1 }).reasons.includes('ABOVE_ESCROW_CAP'));
  check('a job with no agent is refused', openEscrow({ ...base, agentId: null }).ok === false);
  check('every state is a known state', ESCROW_STATES.includes(opened.escrow.state));

  /* ---------- delivery ---------- */
  const delivered = submitDelivery(opened.escrow, { deliverable: DELIVERABLE, receipt: PROOF, now: NOW + 1000 });
  check('a matching delivery is accepted', delivered.ok === true && delivered.escrow.state === 'delivered');
  check('an independently attested delivery is proven', delivered.escrow.deliveryProven === true);
  check('accepting a delivery does NOT move money', delivered.releasedUsd === 0 && delivered.escrow.heldUsd === 120);
  const selfAttested = submitDelivery(opened.escrow, { deliverable: DELIVERABLE, receipt: { verified: true, issuer: 'agent-1' }, now: NOW + 1000 });
  check('an agent attesting to its own delivery is not proof', selfAttested.escrow.deliveryProven === false);
  check('the unproven delivery is labelled honestly', selfAttested.i18nKey === 'intentAI.escrow.deliveredUnproven');
  check('a different deliverable is rejected',
    submitDelivery(opened.escrow, { deliverable: { kind: 'analysis', asset: 'BTC' }, receipt: PROOF, now: NOW + 1000 }).reason === 'DELIVERABLE_MISMATCH');
  check('a late delivery is rejected',
    submitDelivery(opened.escrow, { deliverable: DELIVERABLE, receipt: PROOF, now: NOW + DELIVERY_WINDOW_MS + 1 }).reason === 'DELIVERY_WINDOW_PASSED');
  check('delivering into an unfunded escrow does nothing', submitDelivery(null, { deliverable: DELIVERABLE }).ok === false);

  /* ---------- release needs proof ---------- */
  const released = releaseEscrow(delivered.escrow, { now: NOW + 2000 });
  check('a proven delivery releases the fee', released.released === true && released.escrow.releasedUsd === 120);
  check('after release nothing is still held', released.escrow.heldUsd === 0);
  check('the release is a translatable notice', released.i18nKey === 'intentAI.escrow.released');
  check('a self-attested delivery releases NOTHING', releaseEscrow(selfAttested.escrow, { now: NOW + 2000 }).released === false);
  check('the unproven refusal is named', releaseEscrow(selfAttested.escrow, { now: NOW + 2000 }).reason === 'DELIVERY_NOT_PROVEN');
  check('an undelivered escrow releases nothing', releaseEscrow(opened.escrow, { now: NOW + 2000 }).reason === 'NOTHING_DELIVERED');
  check('a released escrow cannot be released twice', releaseEscrow(released.escrow, { now: NOW + 3000 }).released === false);
  check('nothing at all releases nothing', releaseEscrow(null, { now: NOW }).released === false);

  /* ---------- disputes default to the buyer ---------- */
  const disputed = openDispute(delivered.escrow, { raisedBy: 'me', reason: 'not what was agreed', now: NOW + 3000 });
  check('the buyer can raise a dispute', disputed.ok === true && disputed.escrow.state === 'disputed');
  check('the default outcome of a dispute is a refund', disputed.defaultOutcome === 'REFUND_BUYER');
  check('a disputed escrow cannot be released', releaseEscrow(disputed.escrow, { now: NOW + 4000 }).reason === 'UNDER_DISPUTE');
  check('the agent can also dispute', openDispute(delivered.escrow, { raisedBy: 'agent-1', now: NOW + 3000 }).ok === true);
  check('a stranger cannot dispute', openDispute(delivered.escrow, { raisedBy: 'someone', now: NOW + 3000 }).reason === 'NOT_A_PARTY');
  check('a dispute after the window is refused',
    openDispute(delivered.escrow, { raisedBy: 'me', now: NOW + DELIVERY_WINDOW_MS + DISPUTE_WINDOW_MS + 1 }).reason === 'DISPUTE_WINDOW_PASSED');
  const refunded = resolveDispute(disputed.escrow, { outcome: 'REFUND_BUYER', now: NOW + 5000 });
  check('resolving for the buyer refunds in full', refunded.refunded === true && refunded.escrow.refundedUsd === 120);
  check('a refund releases nothing to the agent', refunded.escrow.releasedUsd === 0);
  check('the refund is a translatable notice', refunded.i18nKey === 'intentAI.escrow.refunded');
  const forAgentNoProof = resolveDispute(disputed.escrow, { outcome: 'RELEASE_AGENT', evidence: null, now: NOW + 5000 });
  check('releasing to the agent without evidence refunds the buyer instead', forAgentNoProof.refunded === true);
  check('the insufficient evidence is named', forAgentNoProof.reason === 'EVIDENCE_INSUFFICIENT');
  const forAgentWithProof = resolveDispute(disputed.escrow, { outcome: 'RELEASE_AGENT', evidence: PROOF, now: NOW + 5000 });
  check('proven delivery in a dispute does release to the agent', forAgentWithProof.released === true);
  check('resolving a non-disputed escrow does nothing', resolveDispute(opened.escrow, { outcome: 'REFUND_BUYER' }).ok === false);

  /* ---------- expiry returns the money ---------- */
  check('an escrow inside its window does not expire', expireEscrow(opened.escrow, { now: NOW + 1000 }).ok === false);
  const expired = expireEscrow(opened.escrow, { now: NOW + DELIVERY_WINDOW_MS + 1 });
  check('an undelivered escrow refunds after the window', expired.refunded === true && expired.escrow.refundedUsd === 120);
  check('a delivered escrow awaiting release does not silently expire',
    expireEscrow(delivered.escrow, { now: NOW + DELIVERY_WINDOW_MS + 1 }).reason === 'AWAITING_RELEASE');

  /* ---------- the books ---------- */
  check('a funded escrow balances', assertEscrowSound(opened.escrow).ok === true);
  check('a released escrow balances', assertEscrowSound(released.escrow).ok === true);
  check('a refunded escrow balances', assertEscrowSound(refunded.escrow).ok === true);
  check('money appearing from nowhere is caught',
    assertEscrowSound({ ...released.escrow, releasedUsd: 500 }).reasons.includes('LEDGER_DOES_NOT_BALANCE'));
  check('paying twice is caught',
    assertEscrowSound({ ...opened.escrow, heldUsd: 0, releasedUsd: 60, refundedUsd: 60, deliveryProven: true }).reasons.includes('PAID_TWICE'));
  check('a release without proof is caught',
    assertEscrowSound({ ...opened.escrow, state: 'released', heldUsd: 0, releasedUsd: 120 }).reasons.includes('RELEASED_WITHOUT_PROOF'));
  check('an unknown state is caught', assertEscrowSound({ ...opened.escrow, state: 'vibes' }).reasons.includes('UNKNOWN_STATE'));
  check('a non-escrow is caught', assertEscrowSound(null).ok === false);

  const locales = ['en', 'fa', 'ar'].map((l) => JSON.parse(readFileSync(`src/i18n/locales/${l}.json`, 'utf8')));
  check('the escrow copy is translated in en, fa and ar',
    locales.every((loc) => ['funded', 'delivered', 'deliveredUnproven', 'released', 'notReleased', 'disputed', 'refunded']
      .every((k) => typeof loc?.intentAI?.escrow?.[k] === 'string')));

  console.log(JSON.stringify({ probe: 'phase70-agent-escrow', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}

export default results;
