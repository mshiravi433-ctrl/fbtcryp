/**
 * FBT Insurance OS — Event emitter (§37, §26, §34).
 *
 * Emits domain events to BOTH the FBT Central Intelligence event bus (so the
 * brain refreshes state) and the insurance-persisted event log (so the UI can
 * read in-app notification history). No secrets are ever placed in payloads.
 * Notifications to external channels (push/email) can be subscribed via the
 * `notify` hook without changing callers.
 */
import { publish } from '../central/eventBus.js';
import { pushEvent, auditLog } from './store.js';
import { INSURANCE_EVENTS } from './constants.js';

let notifyHook = null; // async (event) => {}  external notification sink (§26)

export function setNotificationHook(fn) { notifyHook = fn; }

const NAME_MAP = {
  InsuranceQuoteCreated: 'INSURANCE_QUOTE_CREATED',
  InsuranceQuoteExpired: 'INSURANCE_QUOTE_EXPIRED',
  CoveragePurchaseStarted: 'COVERAGE_PURCHASE_STARTED',
  CoverageActivated: 'COVERAGE_ACTIVATED',
  CoverageExpired: 'COVERAGE_EXPIRED',
  IncidentDetected: 'INCIDENT_DETECTED',
  ClaimCreated: 'CLAIM_CREATED',
  ClaimSubmitted: 'CLAIM_SUBMITTED',
  ClaimUpdated: 'CLAIM_UPDATED',
  ClaimApproved: 'CLAIM_APPROVED',
  ClaimRejected: 'CLAIM_REJECTED',
  PayoutDetected: 'INSURANCE_PAYOUT_DETECTED',
  PayoutVerified: 'INSURANCE_PAYOUT_VERIFIED',
  ProviderHealthChanged: 'INSURANCE_PROVIDER_HEALTH_CHANGED',
  InsuranceFeeCollected: 'INSURANCE_FEE_COLLECTED',
  CommissionRecorded: 'COMMISSION_RECORDED'
};

/**
 * emit({ type: <InsuranceEventName>, wallet?, providerId?, quoteId?,
 *         coverageId?, claimId?, txId?, payload })
 * Pushes to the bus + persistent log, and forwards to the notification hook.
 */
export async function emit(event) {
  const domain = String(event?.type || '');
  const busType = NAME_MAP[domain] || `INSURANCE_${String(domain).toUpperCase()}`;
  const record = {
    type: domain,
    busType,
    ts: Date.now(),
    wallet: event.wallet ? String(event.wallet).toLowerCase() : null,
    providerId: event.providerId || null,
    quoteId: event.quoteId || null,
    coverageId: event.coverageId || null,
    claimId: event.claimId || null,
    txId: event.txId || null,
    payload: event.payload || {}
  };
  // Persisted, in-app readable event log (§26 in-app).
  const stored = await pushEvent(record);
  // Central bus so the brain can refresh dependent modules.
  try {
    publish(busType, record.payload || {}, { source: `insurance:${domain}` });
  } catch { /* observer must never break emit */ }
  if (typeof notifyHook === 'function') {
    try { await notifyHook(record); } catch { /* external notify must not break emit */ }
  }
  return stored;
}

export { auditLog };
export { INSURANCE_EVENTS };
