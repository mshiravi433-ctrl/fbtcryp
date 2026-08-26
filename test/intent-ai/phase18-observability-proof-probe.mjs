/* Phase 18 — immutable audit timeline, receipt integrity and recovery. */
import {
  createAuditTimeline,
  verifyAuditTimeline,
  createExecutionReceipt,
  verifyExecutionReceipt,
  whyEngine,
  classifyIncident,
  recoverExecution,
  disasterRecoveryStatus
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });
const now = Date.now();

try {
  const timeline = createAuditTimeline({ intentId: 'intent-18', policyVersion: 'policy-18', now });
  check('audit timeline is append-only and not durable by default', timeline.schema === 'fbt.audit-timeline.v1' && timeline.appendOnly && timeline.durable === false);
  const first = await timeline.append({ eventId: 'event-18-a', actor: 'user-18', action: 'review', reason: 'explicit-review', timestamp: now });
  const second = await timeline.append({ eventId: 'event-18-b', actor: 'guardian-18', action: 'guardian', reason: 'policy-checked', timestamp: now + 1 });
  check('every audit action has actor, reason, policy and timestamp', first.ok && second.ok && first.event.actor && first.event.reason && first.event.policyVersion && first.event.timestamp);
  check('hash chain verifies before sealing', (await verifyAuditTimeline(timeline)).ok && (await timeline.verify()).immutable);
  timeline.seal();
  check('sealed audit timeline rejects later writes', !(await timeline.append({ eventId: 'event-18-c', actor: 'user-18', action: 'late', reason: 'late', timestamp: now })).ok);
  const tampered = timeline.public();
  tampered.events[1] = { ...tampered.events[1], reason: 'rewritten' };
  check('rewriting history breaks integrity', !(await verifyAuditTimeline(tampered)).ok);

  const incompleteProof = await createExecutionReceipt({ intentId: 'intent-18', receiptId: 'receipt-18', providerId: 'provider-18', txRef: 'tx-18', status: 'confirmed', confirmed: true, providerEvidence: true, checkedAt: now, reorgChecked: false });
  check('receipt without reorg/finality evidence is not completed', incompleteProof.ok && incompleteProof.completed === false && (await verifyExecutionReceipt(incompleteProof)).status === 'unavailable');
  const receipt = await createExecutionReceipt({ intentId: 'intent-18', receiptId: 'receipt-18-final', providerId: 'provider-18', txRef: 'tx-18-final', status: 'confirmed', confirmed: true, providerEvidence: true, checkedAt: now, reorgChecked: true });
  const verified = await verifyExecutionReceipt(receipt, { now });
  check('verified receipt integrity is required for COMPLETED', receipt.ok && verified.ok && verified.completed && verified.status === 'COMPLETED');
  const receiptTampered = { ...receipt, proof: { ...receipt.proof, txRef: 'different' } };
  check('tampered receipt cannot become completed', (await verifyExecutionReceipt(receiptTampered, { now })).code === 'RECEIPT_INTEGRITY_MISMATCH');
  check('why engine requires reason, actor, policy and time', whyEngine({ action: 'submit', actor: 'user-18', reason: 'confirmed', policyVersion: 'policy-18', timestamp: now }).ok && !whyEngine({ action: 'submit' }).ok);
  check('reorg, outage and partial fill are distinct incidents', classifyIncident({ reorg: true }).type === 'reorg' && classifyIncident({ providerError: 'timeout' }).type === 'outage' && classifyIncident({ partial: true }).type === 'partial-fill');
  const observed = await recoverExecution({ idempotencyKey: 'attempt-18', observer: async () => ({ submitted: true, status: 'unknown' }), incident: { retry: true }, now });
  check('ambiguous recovery observes existing transaction and never submits a second', observed.ok && observed.action === 'OBSERVE_EXISTING' && observed.secondTransactionCreated === false && observed.retryAllowed === false);
  check('recovery without observer is unavailable', (await recoverExecution({ idempotencyKey: 'attempt-18', now })).status === 'unavailable');
  check('disaster resilience is not claimed without durable backup/drill evidence', disasterRecoveryStatus().status === 'unavailable' && disasterRecoveryStatus().operational === false);
  check('audit/proof output contains no raw credential', !/private.?key|seed.?phrase|master.?password/i.test(JSON.stringify({ timeline: timeline.public(), receipt: verified })));

  console.log(JSON.stringify({ probe: 'phase18-observability-proof', passed: results.filter((row) => row.ok).length, results }, null, 2));
  if (results.some((row) => !row.ok)) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ probe: 'phase18-observability-proof', failed: true, results, error: error.message }, null, 2));
  process.exitCode = 1;
}

export default results;
