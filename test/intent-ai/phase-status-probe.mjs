/* Authoritative Phase 10–216 status and public-status integration probe.
   Three contracts are proven here:
     1. fail-closed boot — no evidence, no launch;
     2. aggregate operator evidence is necessary but NOT sufficient while the
        release is pinned to activation off: a 21/21 snapshot cannot clear
        per-plane blockers or publish product phases as live;
     3. owner activation — the 21/21 snapshot PLUS the dual-operator plane
        attestation bundle brings every specification phase live with zero
        critical blockers, while execution and raw credentials stay disabled. */
import './helpers/fail-closed-boot.mjs'; // must precede server/app.js import
import assert from 'node:assert/strict';
import app from '../../server/app.js';
import { openApiDocument } from '../../server/openapi.js';
import { injectReviewedEvidence } from './helpers/reviewed-evidence.mjs';
import { injectOwnerAttestations } from './helpers/owner-attestations.mjs';

const EXPECTED_PHASES = Object.freeze([
  ...Array.from({ length: 191 }, (_, i) => i + 10),
  201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212, 214, 215, 216
]);

const server = app.listen(0, '127.0.0.1');
try {
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const get = async (path) => {
    const response = await fetch(`${base}${path}`, { headers: { accept: 'application/json' } });
    return { response, body: await response.json() };
  };

  /* 1. Fail-closed boot: a deployment without evidence must not launch. */
  const cold = await get('/api/intents/v1/phase-status');
  assert.equal(cold.response.status, 200);
  assert.equal(cold.body.launchAllowed, false);
  assert.notEqual(cold.body.evidence.status, '21/21');
  assert.equal(cold.body.executionActivated, false);
  assert.equal(cold.body.rawCredentialsAllowed, false);

  /* 2. The reviewed release: restore the 21/21 snapshot exactly like the
        deployment receives it (INTENT_OPERATIONAL_EVIDENCE or the route). */
  await injectReviewedEvidence(base);

  const phaseStatus = await get('/api/intents/v1/phase-status');
  assert.equal(phaseStatus.response.status, 200);
  assert.equal(phaseStatus.body.schema, 'fbt.intent-ai-phase-status.v1');
  assert.deepEqual([...phaseStatus.body.phases.map((row) => row.phase)].sort((a, b) => a - b), [...EXPECTED_PHASES]);
  assert.equal(phaseStatus.body.specificationImplementedThrough, 216);
  assert.equal(phaseStatus.body.phaseCount, 206);
  assert.equal(phaseStatus.body.launchAllowed, false);
  assert.equal(phaseStatus.body.isFrozen, false);
  assert.equal(phaseStatus.body.evidence.status, '21/21');
  assert(phaseStatus.body.phases.every((row) => row.implementation === 'implemented'));
  /* No phase may claim live while it still carries unresolved blockers. */
  assert(phaseStatus.body.phases.every((row) => !(row.live === true && (row.blockers || []).length > 0)));
  /* Product phases remain accessible in open mode, but strict mode here
     must not claim runtime readiness from synthetic aggregate evidence. */
  const productLive = phaseStatus.body.phases.filter((row) => (row.phase >= 10 && row.phase <= 20) || row.phase >= 51);
  assert(productLive.length === 176);
  assert(productLive.every((row) => row.operational !== true && row.live === false));
  assert(phaseStatus.body.phases.some((row) => row.phase === 22 && row.blockers.includes('REGISTRY_UNAVAILABLE')));
  assert.equal(phaseStatus.body.phase21?.readiness?.launchAllowed, true);
  assert.equal(phaseStatus.body.executionActivated, false);
  assert.equal(phaseStatus.body.rawCredentialsAllowed, false);

  const publicStatus = await get('/api/intents/v1/public-status');
  assert.equal(publicStatus.response.status, 200);
  assert.equal(publicStatus.body.schema, 'fbt.public-status.v1');
  assert.equal(publicStatus.body.status, 'unavailable');
  assert.equal(publicStatus.body.launchAllowed, false);
  assert.equal(publicStatus.body.isFrozen, false);
  assert.equal(publicStatus.body.phases.length, 206);
  assert(publicStatus.body.phases.every((row) => row.implementation === 'implemented'));
  assert(publicStatus.body.phases.every((row) => (row.operational === true) === (row.live === true)));
  assert(publicStatus.body.phases.every((row) => (row.status === 'operational') === (row.operational === true)));
  assert.equal(publicStatus.body.claims.publicVerification, false);
  assert(!/private.?key|seed.?phrase|master.?password/i.test(JSON.stringify({ phaseStatus, publicStatus })));

  const document = openApiDocument();
  assert(document.paths['/intents/v1/phase-status']?.get);
  assert(document.paths['/intents/v1/public-status']?.get);

  /* 3. Owner activation: release the fail-closed pin, inject the plane
        attestation bundle, and prove the whole specification goes live.
     The pin is restored afterwards: test/run.mjs imports probes in-process,
     so a leaked deletion would change the posture of every later probe. */
  const activationPin = process.env.INTENT_OS_ACTIVATION;
  delete process.env.INTENT_OS_ACTIVATION;
  try {
    await injectOwnerAttestations(base);

    const activated = await get('/api/intents/v1/phase-status');
    assert.equal(activated.body.status, 'operational');
    assert.equal(activated.body.operational, true);
    assert.equal(activated.body.live, true);
    assert.equal(activated.body.phaseCount, 206);
    assert.equal(activated.body.operationalPhaseCount, 206);
    assert.equal(activated.body.evidence.status, '21/21');
    assert.deepEqual(activated.body.criticalBlockers, []);
    assert.equal(activated.body.launchAllowed, true);
    assert(activated.body.phases.every((row) => row.live === true && (row.blockers || []).length === 0));
    assert(activated.body.phases.every((row) => row.claims.verified === true));
    assert.equal(activated.body.phase21?.mode, 'owner-activated');
    assert.equal(activated.body.executionActivated, false);
    assert.equal(activated.body.rawCredentialsAllowed, false);
    assert(activated.body.phases.some((row) => row.phase === 208 && row.live === true));
    assert(activated.body.phases.some((row) => row.phase === 211 && row.live === true));
    assert(activated.body.phases.some((row) => row.phase === 152 && row.live === true));

    const activatedPublic = await get('/api/intents/v1/public-status');
  assert.equal(activatedPublic.body.status, 'operational');
  assert.equal(activatedPublic.body.launchAllowed, true);
  assert(activatedPublic.body.phases.every((row) => row.operational === true && row.live === true));

    const attestations = await get('/api/intents/v1/plane-attestations');
    assert.equal(attestations.body.schema, 'fbt.owner-plane-attestations.v1');
    assert.equal(attestations.body.mode, 'owner');
    assert.equal(attestations.body.held, true);
    assert(attestations.body.planes >= 28);
  } finally {
    if (activationPin === undefined) delete process.env.INTENT_OS_ACTIVATION;
    else process.env.INTENT_OS_ACTIVATION = activationPin;
  }

  console.log(JSON.stringify({ probe: 'phase-status', passed: 24, results: [
    'a deployment without evidence fails closed',
    'execution and raw credentials stay disabled before activation',
    'phase status route is authoritative and covers 10–216',
    'specification implementation is reported through 216',
    '206 specification phases are published',
    'aggregate 21/21 evidence cannot override individual runtime blockers',
    'every implementation-complete phase is published with its own verdict',
    'no phase claims live while it still has unresolved blockers',
    'product phases do not claim operational status while control planes remain blocked',
    'phase 21 readiness reports the reviewed release',
    'execution and raw credentials remain disabled',
    'public status keeps launch blocked without individual plane verification',
    'public status covers all 206 specification phases',
    'public status keeps every phase verdict consistent',
    'public verification stays false without runtime proof',
    'OpenAPI documents phase-status and public-status',
    'status response contains no raw credential material',
    'owner activation brings all 206 phases live with zero critical blockers',
    'every phase verifies with an empty blocker list after activation',
    'phase 21 reports the owner-activated mode',
    'execution and raw credentials stay disabled after activation',
    'upgrade rows 208/211 and autonomy row 152 go live with the release',
    'public status reports the operational release after activation',
    'the attestation route reports owner mode with 28 planes (plane 30 is evidence-only)'
  ] }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ probe: 'phase-status', failed: true, error: error.message }, null, 2));
  process.exitCode = 1;
} finally {
  await new Promise((resolve) => server.close(resolve));
}
