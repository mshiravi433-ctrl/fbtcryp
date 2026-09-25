/** Phase 35 — public disclosure. A green banner is never invented. */
import { unavailable } from './phaseBoundary.js';
import { LAUNCH_BANNER } from './phase30LaunchControlPlane.js';
import { opsPlane } from './opsPlane.js';

export const PHASE35_SCHEMA = 'fbt.public-disclosure.v1';

export function operatePublicDisclosure({ page = null, comms = null, launched = false } = {}) {
  /* Owner policy (2026-09-25, full activation): disclosure honesty means the
     page matches the ACTUAL launch state. A green page on an unlaunched
     release is still refused; a green page on a launched release with an
     attested channel is the honest state. `launched` defaults to false so
     every existing caller keeps the old fail-closed behaviour. */
  const pageClaimsLive = page?.status === 'operational' || page?.launchAllowed === true;
  if (pageClaimsLive && launched !== true) {
    return unavailable('PUBLIC_STATUS_MUST_STAY_HONEST', null, { schema: PHASE35_SCHEMA, banner: [...LAUNCH_BANNER] });
  }
  if (!comms || comms.channelAttested !== true) {
    return unavailable('DISCLOSURE_CHANNEL_UNATTESTED', null, { banner: [...LAUNCH_BANNER] });
  }
  const live = launched === true && pageClaimsLive;
  return {
    ok: true,
    schema: PHASE35_SCHEMA,
    status: live ? 'operational' : 'unavailable',
    launchAllowed: live,
    banner: [...LAUNCH_BANNER],
    operational: false
  };
}

export function evaluatePublicDisclosurePlane(input = {}) {
  const row = operatePublicDisclosure(input);
  return opsPlane(35, PHASE35_SCHEMA, [row.code].filter(Boolean), { pass: row.ok === true, disclosure: row, banner: row.banner });
}
