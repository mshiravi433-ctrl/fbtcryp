/** Phase 33 — multi-region failover and capacity. A runbook is not a drill. */
import { unavailable } from './phaseBoundary.js';
import { opsPlane } from './opsPlane.js';

export const PHASE33_SCHEMA = 'fbt.failover-capacity.v1';

export function operateFailover({ primary = null, secondary = null, drill = null } = {}) {
  if (!primary || primary.healthy !== true || primary.attested !== true) {
    return unavailable('PRIMARY_REGION_UNAVAILABLE', null, { schema: PHASE33_SCHEMA });
  }
  if (!secondary || secondary.ready !== true || secondary.attested !== true) {
    return unavailable('SECONDARY_REGION_UNREADY');
  }
  if (!drill || drill.completed !== true || drill.rtoMet !== true) {
    return unavailable('FAILOVER_DRILL_MISSING');
  }
  return { ok: true, schema: PHASE33_SCHEMA, failedOver: false, operational: false, live: false };
}

export function evaluateFailoverCapacityPlane(input = {}) {
  const row = operateFailover(input);
  return opsPlane(33, PHASE33_SCHEMA, [row.code || 'FAILOVER_NOT_OPERATIONAL'], { failover: row });
}
