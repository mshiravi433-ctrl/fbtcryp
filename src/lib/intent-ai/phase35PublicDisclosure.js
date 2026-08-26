/** Phase 35 — public disclosure. A green banner is never invented. */
import { unavailable } from './phaseBoundary.js';
import { LAUNCH_BANNER } from './phase30LaunchControlPlane.js';
import { opsPlane } from './opsPlane.js';

export const PHASE35_SCHEMA = 'fbt.public-disclosure.v1';

export function operatePublicDisclosure({ page = null, comms = null } = {}) {
  if (page?.status === 'operational' || page?.launchAllowed === true) {
    return unavailable('PUBLIC_STATUS_MUST_STAY_HONEST', null, { schema: PHASE35_SCHEMA, banner: [...LAUNCH_BANNER] });
  }
  if (!comms || comms.channelAttested !== true) {
    return unavailable('DISCLOSURE_CHANNEL_UNATTESTED', null, { banner: [...LAUNCH_BANNER] });
  }
  return {
    ok: true,
    schema: PHASE35_SCHEMA,
    status: 'unavailable',
    launchAllowed: false,
    banner: [...LAUNCH_BANNER],
    operational: false
  };
}

export function evaluatePublicDisclosurePlane(input = {}) {
  const row = operatePublicDisclosure(input);
  return opsPlane(35, PHASE35_SCHEMA, [row.code || 'DISCLOSURE_NOT_OPERATIONAL'], { disclosure: row, banner: row.banner });
}
