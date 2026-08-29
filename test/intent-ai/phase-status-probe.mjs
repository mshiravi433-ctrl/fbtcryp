/* Authoritative Phase 10–150 status and public-status integration probe.
   Two contracts are proven here:
     1. fail-closed boot — no evidence, no launch;
     2. the reviewed release — once the complete 21/21 operator evidence
        snapshot is injected through the same dual-operator route an operator
        uses, the launch gate opens and every implementation-complete phase is
        published with its OWN verdict (product phases live; 22–50 audit planes
        keep their evaluator blockers instead of being painted over). */
import assert from 'node:assert/strict';
import app from '../../server/app.js';
import { openApiDocument } from '../../server/openapi.js';
import { injectReviewedEvidence } from './helpers/reviewed-evidence.mjs';

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
  assert.deepEqual(phaseStatus.body.phases.map((row) => row.phase), Array.from({ length: 141 }, (_, i) => i + 10));
  assert.equal(phaseStatus.body.specificationImplementedThrough, 150);
  assert.equal(phaseStatus.body.phaseCount, 141);
  assert.equal(phaseStatus.body.launchAllowed, true);
  assert.equal(phaseStatus.body.isFrozen, false);
  assert.equal(phaseStatus.body.evidence.status, '21/21');
  assert(phaseStatus.body.phases.every((row) => row.implementation === 'implemented'));
  /* No phase may claim live while it still carries unresolved blockers. */
  assert(phaseStatus.body.phases.every((row) => !(row.live === true && (row.blockers || []).length > 0)));
  /* Product phases 10–20 and 51–150 share the release gate. */
  const productLive = phaseStatus.body.phases.filter((row) => (row.phase >= 10 && row.phase <= 20) || row.phase >= 51);
  assert(productLive.length === 111);
  assert(productLive.every((row) => row.operational === true && row.ready === true && row.live === true));
  assert.equal(phaseStatus.body.phase21?.readiness?.launchAllowed, true);
  assert.equal(phaseStatus.body.executionActivated, false);
  assert.equal(phaseStatus.body.rawCredentialsAllowed, false);

  const publicStatus = await get('/api/intents/v1/public-status');
  assert.equal(publicStatus.response.status, 200);
  assert.equal(publicStatus.body.schema, 'fbt.public-status.v1');
  assert.equal(publicStatus.body.status, 'operational');
  assert.equal(publicStatus.body.launchAllowed, true);
  assert.equal(publicStatus.body.isFrozen, false);
  assert.equal(publicStatus.body.phases.length, 141);
  assert(publicStatus.body.phases.every((row) => row.implementation === 'implemented'));
  assert(publicStatus.body.phases.every((row) => (row.operational === true) === (row.live === true)));
  assert(publicStatus.body.phases.every((row) => (row.status === 'operational') === (row.operational === true)));
  assert.equal(publicStatus.body.claims.publicVerification, true);
  assert(!/private.?key|seed.?phrase|master.?password/i.test(JSON.stringify({ phaseStatus, publicStatus })));

  const document = openApiDocument();
  assert(document.paths['/intents/v1/phase-status']?.get);
  assert(document.paths['/intents/v1/public-status']?.get);

  console.log(JSON.stringify({ probe: 'phase-status', passed: 17, results: [
    'a deployment without evidence fails closed',
    'execution and raw credentials stay disabled before activation',
    'phase status route is authoritative and covers 10–150',
    'specification implementation is reported through 150',
    '141 specification phases are published',
    'the reviewed 21/21 snapshot re-opens the launch gate',
    'every implementation-complete phase is published with its own verdict',
    'no phase claims live while it still has unresolved blockers',
    'product phases 10–20 and 51–150 are live under the reviewed release',
    'phase 21 readiness reports the reviewed release',
    'execution and raw credentials remain disabled',
    'public status is operational with launch allowed',
    'public status covers all 141 specification phases',
    'public status keeps every phase verdict consistent',
    'public verification is reported for the live release',
    'OpenAPI documents phase-status and public-status',
    'status response contains no raw credential material'
  ] }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ probe: 'phase-status', failed: true, error: error.message }, null, 2));
  process.exitCode = 1;
} finally {
  await new Promise((resolve) => server.close(resolve));
}
