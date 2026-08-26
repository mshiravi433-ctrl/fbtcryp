/** Phase 48 — insurance / bond / capital. A declared bond is not escrow. */
import { unavailable } from './phaseBoundary.js';
import { opsPlane } from './opsPlane.js';

export const PHASE48_SCHEMA = 'fbt.capital-bond-ops.v1';

export function operateCapitalBond({ bond = null, custody = null } = {}) {
  if (!bond || bond.declared !== true) return unavailable('BOND_NOT_DECLARED', null, { schema: PHASE48_SCHEMA });
  if (bond.escrowed === true && custody?.attested !== true) return unavailable('BOND_ESCROW_UNATTESTED');
  if (bond.assumedFunded === true && bond.attested !== true) return unavailable('BOND_ASSUMED_NOT_VERIFIED');
  return { ok: true, schema: PHASE48_SCHEMA, operational: false, settlesFunds: false };
}

export function evaluateCapitalBondPlane(input = {}) {
  const row = operateCapitalBond(input);
  return opsPlane(48, PHASE48_SCHEMA, [row.code || 'CAPITAL_BOND_NOT_OPERATIONAL'], { bond: row });
}
