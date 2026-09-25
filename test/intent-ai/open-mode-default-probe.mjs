/* Open implementation access is not operational verification. A local probe
   or code file is not evidence that a production signer, broker, RPC or
   independent reviewer answered. */
import assert from 'node:assert/strict';
import { phaseStatusReport } from '../../server/intentPhaseStatus.js';
import { scanOperationalProviders } from '../../server/intentOperationalEvidence.js';

const previous = process.env.INTENT_OS_OPEN_MODE;
try {
  const blockedScan = scanOperationalProviders({ injectedEvidence: [] });
  assert.equal(blockedScan.readiness.launchAllowed, false);

  delete process.env.INTENT_OS_OPEN_MODE;
  const shipped = phaseStatusReport({ operationalScan: blockedScan });
  assert.equal(shipped.openMode, true);
  assert.equal(shipped.gate, 'open-mode-access');
  assert.equal(shipped.capabilitiesAvailable, true);
  assert.equal(shipped.launchAllowed, false);
  assert.equal(shipped.live, false);
  assert.equal(shipped.operationalPhaseCount, 0);
  assert(shipped.phases.length > 0);
  assert(shipped.phases.every((row) => row.available === true && row.live === false && row.claims.verified === false));
  assert.equal(shipped.executionActivated, false);
  assert.equal(shipped.rawCredentialsAllowed, false);

  process.env.INTENT_OS_OPEN_MODE = '0';
  const strict = phaseStatusReport({ operationalScan: blockedScan });
  assert.equal(strict.openMode, false);
  assert.equal(strict.gate, 'closed');
  assert.equal(strict.capabilitiesAvailable, false);
  assert.equal(strict.launchAllowed, false);
  assert(strict.phases.every((row) => row.live !== true));

  console.log(JSON.stringify({ probe: 'open-mode-default', passed: 5, results: [
    'all implemented capabilities accessible without pretending providers live',
    'no operational launch without reviewed evidence',
    'no wallet signing or credentials granted by open access',
    'report distinguishes access from evidence',
    'strict mode turns off access without altering verified status'
  ] }));
} catch (error) {
  console.error(JSON.stringify({ probe: 'open-mode-default', failed: true, error: error.message }));
  process.exitCode = 1;
} finally {
  if (previous === undefined) delete process.env.INTENT_OS_OPEN_MODE;
  else process.env.INTENT_OS_OPEN_MODE = previous;
}
