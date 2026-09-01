/**
 * FBT WALLET ENGINE — SMART NOTIFICATIONS
 * ---------------------------------------------------------------------------
 * Maps wallet events to notification templates. The spec's list is the
 * vocabulary:
 *
 *   Incoming · Large Transfer · Confirmed · Failed · Low Gas · Price Alert
 *   · Approval Risk · Portfolio Change
 *
 * This module only SHAPES the notification (type + i18n key + severity +
 * payload). Delivering it — FCM, Telegram, web-push, in-app — is the caller's
 * job, so the engine stays pure and transport-agnostic.
 *
 * ─── HONESTY RULES ──────────────────────────────────────────────────────────
 * · Every template is an i18n KEY + structured payload, never a hardcoded
 *   sentence, so the 11 locales stay the source of truth for wording.
 * · Unknown events return `type:'generic'` with `known:false` — a notification
 *   is never silently dropped, and never mislabeled.
 */

export const NOTIFICATION_SCHEMA = 'fbt.notification.v1';

const TEMPLATES = {
  incoming: { type: 'incoming', key: 'notif.incoming', severity: 'info' },
  large_transfer: { type: 'largeTransfer', key: 'notif.largeTransfer', severity: 'warning' },
  confirmed: { type: 'confirmed', key: 'notif.confirmed', severity: 'success' },
  failed: { type: 'failed', key: 'notif.failed', severity: 'error' },
  low_gas: { type: 'lowGas', key: 'notif.lowGas', severity: 'warning' },
  price_alert: { type: 'priceAlert', key: 'notif.priceAlert', severity: 'info' },
  approval_risk: { type: 'approvalRisk', key: 'notif.approvalRisk', severity: 'error' },
  portfolio_change: { type: 'portfolioChange', key: 'notif.portfolioChange', severity: 'info' }
};

/** Build a notification from an event name + payload. */
export function buildNotification(event, payload = {}) {
  const t = TEMPLATES[String(event || '').toLowerCase()];
  if (!t) {
    return {
      schema: NOTIFICATION_SCHEMA,
      type: 'generic',
      key: 'notif.generic',
      severity: 'info',
      known: false,
      payload: payload && typeof payload === 'object' ? payload : {}
    };
  }
  return {
    schema: NOTIFICATION_SCHEMA,
    ...t,
    known: true,
    payload: payload && typeof payload === 'object' ? payload : {}
  };
}
