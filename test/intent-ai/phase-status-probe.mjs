/* Authoritative Phase 10–20 status and public-status integration probe. */
import assert from 'node:assert/strict';
import app from '../../server/app.js';
import { openApiDocument } from '../../server/openapi.js';

const server = app.listen(0, '127.0.0.1');
try {
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const port = server.address().port;
  const get = async (path) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { headers: { accept: 'application/json' } });
    return { response, body: await response.json() };
  };
  const phaseStatus = await get('/api/intents/v1/phase-status');
  assert.equal(phaseStatus.response.status, 200);
  assert.equal(phaseStatus.body.schema, 'fbt.intent-ai-phase-status.v1');
  assert.deepEqual(phaseStatus.body.phases.map((row) => row.phase), [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50]);
  assert.equal(phaseStatus.body.launchAllowed, true);
  assert.equal(phaseStatus.body.isFrozen, false);
  assert.equal(phaseStatus.body.evidence.status, '21/21');
  assert(phaseStatus.body.phases.every((row) => row.implementation === 'implemented' && row.operational === true && row.ready === true && row.live === true));
  assert.equal(phaseStatus.body.allOperational, true);
  assert.equal(phaseStatus.body.executionActivated, false);
  assert.equal(phaseStatus.body.rawCredentialsAllowed, false);

  const publicStatus = await get('/api/intents/v1/public-status');
  assert.equal(publicStatus.response.status, 200);
  assert.equal(publicStatus.body.schema, 'fbt.public-status.v1');
  assert.equal(publicStatus.body.status, 'operational');
  assert.equal(publicStatus.body.launchAllowed, true);
  assert.equal(publicStatus.body.isFrozen, false);
  assert(publicStatus.body.phases.every((row) => row.operational === true && row.live === true && row.status === 'operational'));
  assert.equal(publicStatus.body.claims.publicVerification, true);
  assert(!/private.?key|seed.?phrase|master.?password/i.test(JSON.stringify({ phaseStatus, publicStatus })));

  const document = openApiDocument();
  assert(document.paths['/intents/v1/phase-status']?.get);
  assert(document.paths['/intents/v1/public-status']?.get);

  console.log(JSON.stringify({ probe: 'phase-status', passed: 10, results: [
    'phase status route is authoritative and covers 10–20',
    'source implementation and live runtime status are published together',
    'every reviewed phase is ready and live from the stored evidence snapshot',
    'execution and raw credentials remain disabled',
    'public status is operational and launch is allowed',
    'public status keeps every phase operational',
    'public verification is reported for the live release',
    'status response contains no raw credential material',
    'OpenAPI documents phase-status',
    'OpenAPI documents public-status'
  ] }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ probe: 'phase-status', failed: true, error: error.message }, null, 2));
  process.exitCode = 1;
} finally {
  await new Promise((resolve) => server.close(resolve));
}
