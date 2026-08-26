/** Phase 41 — release train / change freeze. A calendar slot is not a release. */
import { fail, unavailable } from './phaseBoundary.js';
import { opsPlane } from './opsPlane.js';

export const PHASE41_SCHEMA = 'fbt.release-train.v1';

export function operateReleaseTrain({ train = null, change = null, freeze = true } = {}) {
  if (freeze === true && change?.wouldDeploy === true) return fail('CHANGE_FREEZE_ACTIVE', null, { schema: PHASE41_SCHEMA });
  if (!train || train.attested !== true) return unavailable('RELEASE_TRAIN_UNATTESTED');
  if (!change || change.reviewed !== true || change.rollbackReady !== true) {
    return unavailable('CHANGE_NOT_REVIEWED');
  }
  return { ok: true, schema: PHASE41_SCHEMA, deployed: false, operational: false, live: false };
}

export function evaluateReleaseTrainPlane(input = {}) {
  const row = operateReleaseTrain(input);
  return opsPlane(41, PHASE41_SCHEMA, [row.code || 'RELEASE_TRAIN_NOT_OPERATIONAL'], { train: row });
}
