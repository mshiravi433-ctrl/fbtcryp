import { operatePublicDisclosure } from '../../src/lib/intent-ai/index.js';
const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });
try {
  check('honest status required', operatePublicDisclosure({ page: { status: 'operational', launchAllowed: true } }).code === 'PUBLIC_STATUS_MUST_STAY_HONEST');
  check('channel required', operatePublicDisclosure({}).code === 'DISCLOSURE_CHANNEL_UNATTESTED');
  const ok = operatePublicDisclosure({ comms: { channelAttested: true } });
  check('banner blocked', ok.launchAllowed === false && ok.banner[0] === 'Launch blocked.');
  console.log(JSON.stringify({ probe: 'phase35-public-disclosure', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(JSON.stringify({ probe: 'phase35-public-disclosure', failed: true, error: e.message, results }, null, 2));
  process.exitCode = 1;
}
export default results;
