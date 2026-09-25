/* OPEN MODE default — owner directive 2026-09-25 («همه فازها باز باشند»).
   Proves, against a deterministically BLOCKED evidence scan (no store, no
   server, no network):
     1. with the shipped default (INTENT_OS_OPEN_MODE unset/1) every
        implementation-complete phase publishes live and launchAllowed is true;
     2. executionActivated and rawCredentialsAllowed stay false — open mode
        opens phases, never signatures or secrets;
     3. the report names its gate ('open-mode' vs 'evidence' vs 'closed');
     4. pinning INTENT_OS_OPEN_MODE=0 restores strict fail-closed (the state
        every other fail-closed probe in this suite measures).
   The flag is read at call time by phaseStatusReport, so toggling it inside
   this process is exactly what production vs audit deployments do. */
import assert from 'node:assert/strict';
import { phaseStatusReport } from '../../server/intentPhaseStatus.js';
import { scanOperationalProviders } from '../../server/intentOperationalEvidence.js';

const previous = process.env.INTENT_OS_OPEN_MODE;
try {
  /* A scan that can never launch on evidence: zero injected records. */
  const blockedScan = scanOperationalProviders({ injectedEvidence: [] });
  assert.equal(blockedScan.readiness.launchAllowed, false);

  delete process.env.INTENT_OS_OPEN_MODE;
  const shipped = phaseStatusReport({ operationalScan: blockedScan });
  assert.equal(shipped.openMode, true);
  assert.equal(shipped.gate, 'open-mode');
  assert.equal(shipped.launchAllowed, true);
  assert.equal(shipped.live, true);
  assert.equal(shipped.status, 'operational');
  assert.equal(shipped.operationalPhaseCount, shipped.phaseCount);
  assert(shipped.phases.length > 0);
  assert(shipped.phases.every((row) => row.live === true));
  assert(shipped.phases.every((row) => (row.blockers || []).length === 0));
  assert.equal(shipped.executionActivated, false);
  assert.equal(shipped.rawCredentialsAllowed, false);
  assert(shipped.phases.every((row) => row.claims?.executionActivated === false));

  process.env.INTENT_OS_OPEN_MODE = '0';
  const strict = phaseStatusReport({ operationalScan: blockedScan });
  assert.equal(strict.openMode, false);
  assert.equal(strict.gate, 'closed');
  assert.equal(strict.launchAllowed, false);
  assert.equal(strict.operationalPhaseCount, 0);
  assert(strict.phases.every((row) => row.live !== true));

  console.log(JSON.stringify({ probe: 'open-mode-default', passed: 5, results: [
    'shipped default publishes every implementation-complete phase live without evidence',
    'execution and raw credentials stay disabled in open mode',
    'the report names its gate (open-mode vs evidence vs closed)',
    'INTENT_OS_OPEN_MODE=0 restores strict fail-closed',
    'no live row carries blockers in open mode'
  ] }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ probe: 'open-mode-default', failed: true, error: error.message }, null, 2));
  process.exitCode = 1;
} finally {
  if (previous === undefined) delete process.env.INTENT_OS_OPEN_MODE;
  else process.env.INTENT_OS_OPEN_MODE = previous;
}
