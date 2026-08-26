import { federateVenueHealth, quoteVenueOnly } from '../../src/lib/intent-ai/index.js';
const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });
try {
  const missing = federateVenueHealth({ adapters: { wallet: { available: false } } });
  check('provider failure', missing.live === false && missing.blockers.includes('PROVIDER_HEALTH_FAILURE'));
  const bridge = federateVenueHealth({ adapters: { wallet: { available: true, attested: true, providerId: 'w' }, broker: { available: true, attested: true, providerId: 'b' }, bridge: { available: true, attested: true, providerId: 'br', executable: false }, venue: { available: true, attested: true, providerId: 'v' } } });
  check('bridge quote only', bridge.executable === false && bridge.blockers.includes('BRIDGE_NOT_EXECUTABLE'));
  check('quote never authorizes execution', quoteVenueOnly({ adapters: {} }).executionAuthorized === false);
  console.log(JSON.stringify({ probe: 'phase26-venue-federation', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(JSON.stringify({ probe: 'phase26-venue-federation', failed: true, error: e.message, results }, null, 2));
  process.exitCode = 1;
}
export default results;
