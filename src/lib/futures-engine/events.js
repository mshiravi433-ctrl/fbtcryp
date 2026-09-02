/**
 * FBT FUTURES — event vocabulary (spec §15).
 * ---------------------------------------------------------------------------
 * One list shared by the server bus (server/central/eventBus.js publishes these
 * names) and the browser bus (src/lib/futures-engine/store.js). The names are
 * data, so a typo cannot create a silent, never-received event.
 */

export const FUTURES_EVENTS = Object.freeze([
  'FUTURES_MARKET_SELECTED',
  'FUTURES_PROVIDER_CHANGED',
  'FUTURES_PROVIDER_HEALTH_CHANGED',
  'FUTURES_QUOTE_UPDATED',
  'FUTURES_RISK_UPDATED',
  'FUTURES_ORDER_PREPARED',
  'FUTURES_ORDER_SUBMITTED',
  'FUTURES_ORDER_CONFIRMED',
  'FUTURES_ORDER_FAILED',
  'FUTURES_ORDER_REJECTED',
  'FUTURES_POSITION_OPENED',
  'FUTURES_POSITION_UPDATED',
  'FUTURES_POSITION_CLOSED',
  'FUTURES_TP_SL_UPDATED',
  'FUTURES_FEE_RECORDED',
  'FUTURES_ALERT_TRIGGERED',
  'FUTURES_STRATEGY_STARTED',
  'FUTURES_STRATEGY_STOPPED'
]);

export const FUTURES_EVENT_SET = new Set(FUTURES_EVENTS);
export const isFuturesEvent = (type) => FUTURES_EVENT_SET.has(String(type || ''));
