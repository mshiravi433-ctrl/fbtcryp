/** Phase 42 — support / break-glass. Support never bypasses Guardian or STOP. */
import { fail, safeId, unavailable } from './phaseBoundary.js';
import { opsPlane } from './opsPlane.js';

export const PHASE42_SCHEMA = 'fbt.break-glass-support.v1';

export function operateBreakGlass({ ticket = null, actor = null, guardian = null } = {}) {
  if (!ticket || !safeId(ticket.id)) return unavailable('SUPPORT_TICKET_REQUIRED', null, { schema: PHASE42_SCHEMA });
  if (!actor || actor.attested !== true) return unavailable('SUPPORT_ACTOR_UNATTESTED');
  if (actor.bypassesGuardian === true || actor.bypassesStop === true) return fail('SUPPORT_MUST_NOT_BYPASS_GUARDIAN');
  if (guardian?.approved !== true) return fail('GUARDIAN_REQUIRED_FOR_BREAK_GLASS');
  return { ok: true, schema: PHASE42_SCHEMA, granted: false, operational: false, live: false };
}

export function evaluateBreakGlassPlane(input = {}) {
  const row = operateBreakGlass(input);
  return opsPlane(42, PHASE42_SCHEMA, [row.code || 'BREAK_GLASS_NOT_OPERATIONAL'], { support: row });
}
