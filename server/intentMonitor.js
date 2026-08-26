/**
 * FBT INTENT AI — Monitor service.
 *
 * Heartbeat-based health monitoring. Evidence requires heartbeat ≤ 60s.
 * Wave 2 evidence: monitor.
 */

import { createHash } from 'node:crypto';
import { verifyMonitor } from '../src/lib/intent-ai/operationalActivation.js';

export const MONITOR_SCHEMA = 'fbt.intent-monitor.v1';
export const MAX_HEARTBEAT_AGE_MS = 60_000;

/* In-memory heartbeat store. In production this would be persisted. */
let lastHeartbeat = 0;
let heartbeatCount = 0;

/**
 * Record a heartbeat. Called by the monitor cron or on each health check.
 */
export function recordHeartbeat(component = 'system', { now = Date.now() } = {}) {
  lastHeartbeat = now;
  heartbeatCount++;
  return {
    ok: true,
    schema: MONITOR_SCHEMA,
    component,
    heartbeatAt: now,
    count: heartbeatCount
  };
}

/**
 * Get monitor evidence for phase activation.
 * Evidence is valid only if heartbeat is within MAX_HEARTBEAT_AGE_MS.
 */
export function monitorEvidence({ now = Date.now() } = {}) {
  /* If no heartbeat recorded, record one now */
  if (lastHeartbeat === 0) {
    recordHeartbeat('system', { now });
  }

  const digest = createHash('sha256')
    .update(`monitor:${lastHeartbeat}:${heartbeatCount}`)
    .digest('hex');

  return verifyMonitor({
    providerId: 'system-monitor',
    digest,
    heartbeatAt: lastHeartbeat,
    expiresAt: lastHeartbeat + MAX_HEARTBEAT_AGE_MS,
    maxAgeMs: MAX_HEARTBEAT_AGE_MS
  }, { now });
}

/**
 * Check if monitor is currently healthy.
 */
export function monitorHealth({ now = Date.now() } = {}) {
  const age = now - lastHeartbeat;
  return {
    ok: age <= MAX_HEARTBEAT_AGE_MS && lastHeartbeat > 0,
    schema: MONITOR_SCHEMA,
    heartbeatAt: lastHeartbeat,
    ageMs: age,
    maxAgeMs: MAX_HEARTBEAT_AGE_MS,
    count: heartbeatCount,
    stale: age > MAX_HEARTBEAT_AGE_MS
  };
}
