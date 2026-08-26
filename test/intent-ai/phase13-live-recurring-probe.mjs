/* Phase 13 — live/recurring lifecycle, monitoring, exit and receipts. */
import {
  createLiveIntent,
  transitionLiveIntent,
  finalizeLiveIntent,
  recordLiveFailure,
  monitorLiveIntent,
  createRecurringIntent,
  prepareRecurringRun,
  applyLiveControl,
  finalResult
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });
const now = Date.now();

try {
  const created = createLiveIntent({ id: 'live-13', intent: { id: 'intent-13', kind: 'swap', chainId: 42161, protocol: 'swap', amountUsd: 50 }, expiresAt: now + 3600000, now });
  check('live intent starts as DRAFT with a timeline', created.ok && created.intent.status === 'DRAFT' && created.intent.timeline.length === 1);
  const pending = transitionLiveIntent(created.intent, 'PENDING', { now });
  check('intent can become PENDING without claiming execution', pending.ok && pending.intent.status === 'PENDING' && pending.intent.executionAuthorized === false);
  const noProof = finalizeLiveIntent(pending.intent, { now });
  check('missing runtime evidence cannot complete an intent', !noProof.ok && noProof.status === 'unavailable');
  const partial = recordLiveFailure(pending.intent, { partial: true, code: 'PARTIAL_FILL', now });
  check('partial is distinct from completed', partial.ok && partial.intent.status === 'PARTIAL' && finalResult(partial.intent).code === 'RESULT_NOT_FINAL');
  const evidence = { providerId: 'provider-13', status: 'confirmed', checkedAt: now, expiresAt: now + 60000, evidenceId: 'evidence-13' };
  const receipt = { schema: 'fbt.intent-final-result.v1', receiptId: 'receipt-13', verified: true, confirmed: true, txStatus: 'confirmed', actualOutput: 49, issuedAt: now };
  const completed = finalizeLiveIntent(pending.intent, { runtimeEvidence: evidence, receipt, now });
  check('COMPLETED requires current runtime evidence and a verified receipt', completed.ok && completed.intent.status === 'COMPLETED');
  check('final result exposes receipt facts only after completion', finalResult(completed.intent).ok && finalResult(completed.intent).final && finalResult(completed.intent).status === 'COMPLETED');
  check('terminal completed intent cannot be completed again', transitionLiveIntent(completed.intent, 'COMPLETED', { now }).idempotent === true && transitionLiveIntent(completed.intent, 'FAILED', { now }).ok === false);

  const recurring = createRecurringIntent({ id: 'recurring-13', intent: { id: 'template-13', kind: 'swap', chainId: 42161 }, schedule: { intervalMs: 3600000, firstRunAt: now + 1000 }, expiresAt: now + 86400000, maxRuns: 3, now });
  check('recurring intent is a bounded definition, not a scheduler permission', recurring.ok && recurring.recurring.policyRecheckRequired && recurring.recurring.userAuthorizationPerRun && recurring.recurring.executionAuthorized === false);
  const noPolicy = await prepareRecurringRun(recurring.recurring, { now: now + 1000, userAuthorized: true });
  check('recurring run without a policy re-check is unavailable', !noPolicy.ok && noPolicy.status === 'unavailable');
  const blockedPolicy = await prepareRecurringRun(recurring.recurring, { now: now + 1000, userAuthorized: true, policyCheck: async () => ({ ok: false }) });
  check('recurring run rechecks and respects policy', !blockedPolicy.ok && blockedPolicy.code === 'POLICY_RECHECK_BLOCKED');
  const prepared = await prepareRecurringRun(recurring.recurring, { now: now + 1000, userAuthorized: true, policyCheck: async () => ({ ok: true, decision: 'ALLOW_REVIEW_ONLY', policyVersion: 'policy-13' }) });
  check('each recurring run requires explicit user authorization and remains unsubmitted', prepared.ok && prepared.run.policyRechecked && prepared.run.executionAuthorized === false && prepared.nextRecurring.runCount === 1);
  const monitored = await monitorLiveIntent(pending.intent);
  check('missing live monitor is unavailable', monitored.status === 'unavailable' && monitored.code === 'MONITOR_UNAVAILABLE');
  const revoked = applyLiveControl(pending.intent, 'REVOKE', { now });
  check('REVOKE immediately changes an active intent', revoked.ok && revoked.immediate && revoked.intent.status === 'REVOKED' && revoked.controls.revoked);
  const expired = createLiveIntent({ id: 'expire-13', intent: { id: 'i-expire' }, expiresAt: now + 1, now });
  const expiredTransition = transitionLiveIntent(expired.intent, 'PENDING', { now: now + 2 });
  check('expired intents cannot become pending', expiredTransition.intent?.status === 'EXPIRED' && expiredTransition.ok === true);
  check('lifecycle output contains no raw credential', !/private.?key|seed.?phrase|master.?password/i.test(JSON.stringify({ created, pending, completed, recurring })));

  console.log(JSON.stringify({ probe: 'phase13-live-recurring', passed: results.filter((row) => row.ok).length, results }, null, 2));
  if (results.some((row) => !row.ok)) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ probe: 'phase13-live-recurring', failed: true, results, error: error.message }, null, 2));
  process.exitCode = 1;
}

export default results;
