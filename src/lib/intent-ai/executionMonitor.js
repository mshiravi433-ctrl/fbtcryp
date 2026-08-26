/**
 * Post-submit monitor: heartbeat, confirmations, partial fills, timeouts.
 */
import { classifyFailure } from './failureModes.js';
import { emergencyStopCheck } from './guardian.js';

export function createMonitor({ txRef, requiredConfirmations = 1, timeoutMs = 60_000, now = Date.now() } = {}) {
  if (!txRef) return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_TX_REF' }) };
  return {
    ok: true,
    monitor: {
      txRef,
      requiredConfirmations,
      timeoutAt: now + timeoutMs,
      heartbeats: 0,
      confirmations: 0,
      status: 'WATCHING',
      filledAmount: 0,
      requestedAmount: null
    }
  };
}

export function heartbeat(monitor, observation = {}, { now = Date.now(), emergencyStop = false } = {}) {
  if (!monitor) return { ok: false, error: classifyFailure('MISSING_DATA') };
  const stop = emergencyStopCheck(emergencyStop);
  if (!stop.ok) {
    return {
      ok: false,
      monitor: { ...monitor, status: 'STOPPED' },
      error: classifyFailure('EMERGENCY_STOP')
    };
  }
  const next = {
    ...monitor,
    heartbeats: monitor.heartbeats + 1,
    lastBeatAt: now
  };
  if (now > monitor.timeoutAt && !(observation.confirmations >= monitor.requiredConfirmations)) {
    return {
      ok: false,
      monitor: { ...next, status: 'TIMEOUT' },
      error: classifyFailure('CONFIRMATION_TIMEOUT')
    };
  }
  if (observation.reverted) {
    return {
      ok: false,
      monitor: { ...next, status: 'REVERTED' },
      error: classifyFailure('ONCHAIN_REVERT')
    };
  }
  const conf = Number(observation.confirmations) || 0;
  next.confirmations = conf;
  if (observation.filledAmount != null) next.filledAmount = Number(observation.filledAmount) || 0;
  if (observation.requestedAmount != null) next.requestedAmount = Number(observation.requestedAmount);

  if (next.requestedAmount != null && next.filledAmount > 0 && next.filledAmount < next.requestedAmount
      && observation.terminal === true) {
    return {
      ok: true,
      monitor: { ...next, status: 'PARTIAL' },
      error: classifyFailure('PARTIAL_FILL'),
      partial: true
    };
  }
  if (conf >= monitor.requiredConfirmations && observation.confirmed === true) {
    return { ok: true, monitor: { ...next, status: 'CONFIRMED' }, confirmed: true };
  }
  return { ok: true, monitor: { ...next, status: 'WATCHING' }, confirmed: false };
}
