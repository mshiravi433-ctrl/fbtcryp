/** Phase 39 — production rehearsal / game day. A tabletop is not a rehearsal. */
import { fail, unavailable } from './phaseBoundary.js';
import { opsPlane } from './opsPlane.js';

export const PHASE39_SCHEMA = 'fbt.gameday-rehearsal.v1';

export function operateGameDay({ rehearsal = null } = {}) {
  if (!rehearsal || rehearsal.executed !== true || rehearsal.attested !== true) {
    return unavailable('GAMEDAY_NOT_EXECUTED', null, { schema: PHASE39_SCHEMA });
  }
  if (rehearsal.tabletopOnly === true) return unavailable('TABLETOP_IS_NOT_REHEARSAL');
  if (rehearsal.usedProductionSigner === true) return fail('REHEARSAL_MUST_NOT_USE_PRODUCTION_SIGNER');
  if (rehearsal.usedMainnetFunds === true) return fail('REHEARSAL_MUST_NOT_USE_MAINNET_FUNDS');
  return { ok: true, schema: PHASE39_SCHEMA, passed: false, operational: false, live: false };
}

export function evaluateGameDayPlane(input = {}) {
  const row = operateGameDay(input);
  return opsPlane(39, PHASE39_SCHEMA, [row.code || 'GAMEDAY_NOT_OPERATIONAL'], { rehearsal: row });
}
