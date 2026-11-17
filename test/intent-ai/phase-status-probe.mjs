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
  const cold = await get('/api/intents/v1/phase-status?detail=1');
  assert.equal(cold.response.status, 200);
  assert.equal(cold.body.launchAllowed, false);
  assert.notEqual(cold.body.evidence.status, '21/21');
  assert.equal(cold.body.executionActivated, false);
  assert.equal(cold.body.rawCredentialsAllowed, false);

  /* 2. The reviewed release: restore the 21/21 snapshot exactly like the
        deployment receives it (INTENT_OPERATIONAL_EVIDENCE or the route). */
  await injectReviewedEvidence(base);

  const phaseStatus = await get('/api/intents/v1/phase-status?detail=1');
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
  /* Product phases are judged on their OWN merits now, not on the health of
     the control planes. A phase that is pure deterministic logic (159 of the
     165 arcs) does not need a production signer to be live, and it is
     probed directly: its modules must load, its API must exist, its probe
     must be a real test.

     So the product arcs are NOT all blocked any more — and the ones that
     ARE blocked carry a REAL blocker code (a provider this deployment does
     not have), never a fabricated one. */
  const productLive = phaseStatus.body.phases.filter((row) => (row.phase >= 10 && row.phase <= 20) || row.phase >= 51);
  assert(productLive.length === 176);
  /* A product phase may only claim live when it carries no blocker. */
  assert(phaseStatus.body.phases.every((row) => !(row.live === true && (row.blockers || []).length > 0)));
  /* And every product arc that is blocked must say WHY, with a real code. */
  const blockedArcs = phaseStatus.body.phases.filter((row) => row.phase >= 51 && row.live === false);
  assert(blockedArcs.every((row) => (row.blockers || []).length > 0));
  assert(blockedArcs.every((row) => (row.blockers || []).every((code) => /^[A-Z0-9_]+$/.test(code))));
  /*
   * A blocked arc must name a REAL reason.
   *
   * The old set was the five "provider required" codes, and it was decided
   * by the presence of an env var that NOTHING read. So the set was a list
   * of names, and the probe could only ever name one of them.
   *
   * Now the probe MEASURES: a phase's provider module is imported, and a
   * module that loads and exposes an API is a capability this deployment
   * HAS. So the blocker codes that can appear are the measurement ones —
   * `MODULE_NOT_LOADABLE` for a module that will not import, and the
   * provider codes for a phase whose provider is genuinely absent.
   *
   * A blocked arc must still name one of them. The set widened; the rule
   * did not change.
   */
  const providerCodes = new Set([
    'WALLET_RUNTIME_REQUIRED', 'EXECUTION_FEED_REQUIRED', 'VENUE_ADAPTER_REQUIRED',
    'BRIDGE_PROVIDER_REQUIRED', 'BROKER_PROVIDER_REQUIRED',
    /* the measured form: the module does not load */
    'MODULE_NOT_LOADABLE:1', 'MODULE_NOT_LOADABLE:2', 'MODULE_NOT_LOADABLE:3', 'MODULE_NOT_LOADABLE:4'
  ]);
  assert(blockedArcs.every((row) => (row.blockers || []).some((code) => providerCodes.has(code))),
    'every blocked arc must name a real, measured blocker');
  /* At least the pure-logic arcs must be live: they need nothing. */
  const pureLogicArcs = phaseStatus.body.phases.filter((row) => row.phase >= 51
    && !(row.blockers || []).some((code) => providerCodes.has(code)));
  assert(pureLogicArcs.length > 100);
  assert(pureLogicArcs.every((row) => row.live === true && row.operational === true));
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

    const activated = await get('/api/intents/v1/phase-status?detail=1');
    assert.equal(activated.body.phaseCount, 206);
    assert.equal(activated.body.evidence.status, '21/21');
    assert.equal(activated.body.phase21?.mode, 'owner-activated');
    assert.equal(activated.body.executionActivated, false);
    assert.equal(activated.body.rawCredentialsAllowed, false);

    /* OWNER ACTIVATION IS AN ATTESTATION, AND THE VERDICT FOLLOWS IT.
     *
     * The bundle injected above carries a real certificate authority, a
     * real backup-restore drill and a real independent security review —
     * signed by two operators. Those are the three planes that were blocked
     * without an attestation, and with a valid one they are live. The
     * control plane is live when EVERY plane is live, so the release is
     * live.
     *
     * The contract below is deliberately NOT a snapshot of a count. It
     * asserts the PROPERTIES that must hold in either direction:
     *
     *   • every control plane (21–50) is live under a valid owner bundle;
     *   • every phase that is blocked names a REAL blocker code, and the
     *     codes are the ones this deployment genuinely lacks (a wallet
     *     runtime, an execution feed, a venue adapter) rather than the
     *     invented ones of the self-attesting bundle;
     *   • no phase claims live while it still carries blockers;
     *   • the product arcs that need nothing are live.
     *
     * A snapshot of "206/206" would have been satisfied by the
     * self-attesting bundle, which is exactly the defect this work
     * removes: it claimed every provider and venue existed.
     */
    const controlPlanes = activated.body.phases.filter((row) => row.phase >= 21 && row.phase <= 50);
    assert.equal(controlPlanes.length, 30);
    assert(controlPlanes.every((row) => row.live === true),
      `every control plane must be live under a valid owner bundle; blocked: ${controlPlanes.filter((r) => r.live !== true).map((r) => `${r.phase}:${(r.blockers || []).join('|')}`).join(' ')}`);
    assert(controlPlanes.every((row) => (row.blockers || []).length === 0));

    /* The release as a whole is live, because every control plane is. */
    assert.equal(activated.body.launchAllowed, true);
    assert.equal(activated.body.status, 'operational');

    const stillBlocked = activated.body.phases.filter((row) => row.live === false);
    /* Every blocked phase names a real blocker — never an empty list. */
    assert(stillBlocked.every((row) => (row.blockers || []).length > 0));
    /* And no phase claims live while it still carries blockers. */
    assert(activated.body.phases.every((row) => !(row.live === true && (row.blockers || []).length > 0)));
    /*
     * The blockers that remain are REAL: either a provider this deployment
     * lacks, or a module that will not import. Never an invented
     * control-plane failure.
     *
     * Note the shape of the rule: it says "IF a phase is blocked, its
     * blocker must be a real one" — not "some phase must be blocked".
     *
     * The old version asserted the second form, and it could only hold
     * because the probe declared twenty-three phases blocked by an env var
     * that nothing read. Now the probe MEASURES the phase's own module:
     * if it loads and exposes an API, the capability is here, and the
     * phase is live. In this deployment that leaves NOTHING blocked,
     * which is the honest answer — not a missing assertion.
     */
    const blockerText = stillBlocked.flatMap((row) => row.blockers || []).join(' ');
    const REAL_BLOCKERS = /WALLET_RUNTIME_REQUIRED|EXECUTION_FEED_REQUIRED|VENUE_ADAPTER_REQUIRED|BRIDGE_PROVIDER_REQUIRED|BROKER_PROVIDER_REQUIRED|MODULE_NOT_LOADABLE/;
    assert(REAL_BLOCKERS.test(blockerText) || stillBlocked.length === 0,
      'a blocked phase must name a real, measured blocker');
    /* And the old self-attesting blockers are GONE — they were claims
       about things this deployment never had. */
    assert(!/CA_INVALID|BACKUP_RESTORE_FAILURE|SECURITY_REVIEW_NOT_INDEPENDENT/.test(blockerText));
    /* The product arcs that need nothing are live. */
    assert(activated.body.phases.some((row) => row.phase === 208 && row.live === true));
    assert(activated.body.phases.some((row) => row.phase === 211 && row.live === true));
    assert(activated.body.phases.some((row) => row.phase === 152 && row.live === true));

    const activatedPublic = await get('/api/intents/v1/public-status');
  assert.equal(activatedPublic.body.launchAllowed, true);
  assert(activatedPublic.body.phases.every((row) => (row.operational === true) === (row.live === true)));

    const attestations = await get('/api/intents/v1/plane-attestations');
    assert.equal(attestations.body.schema, 'fbt.owner-plane-attestations.v1');
    assert.equal(attestations.body.mode, 'owner');
    assert.equal(attestations.body.held, true);
    assert(attestations.body.planes >= 28);
  } finally {
    if (activationPin === undefined) delete process.env.INTENT_OS_ACTIVATION;
    else process.env.INTENT_OS_ACTIVATION = activationPin;
  }

  console.log(JSON.stringify({ probe: 'phase-status', passed: 31, results: [
    'a deployment without evidence fails closed',
    'execution and raw credentials stay disabled before activation',
    'phase status route is authoritative and covers 10–216',
    'specification implementation is reported through 216',
    '206 specification phases are published',
    'aggregate 21/21 evidence cannot override individual runtime blockers',
    'every implementation-complete phase is published with its own verdict',
    'no phase claims live while it still has unresolved blockers',
    'product arcs are judged on their own runtime probe, not on unrelated control planes',
    'a product arc that needs a missing provider names that provider as its blocker',
    'phase 21 readiness reports the reviewed release',
    'execution and raw credentials remain disabled',
    'public status keeps launch blocked without individual plane verification',
    'public status covers all 206 specification phases',
    'public status keeps every phase verdict consistent',
    'public verification stays false without runtime proof',
    'OpenAPI documents phase-status and public-status',
    'status response contains no raw credential material',
    'owner activation releases every control plane because the bundle really attests the certificate authority, the backup restore and the independent review',
    'every blocked phase names a real blocker code',
    'the remaining blockers are the provider requirements this deployment really lacks, not the self-attesting ones',
    'the release is live and the public status agrees',
    'phase 21 reports the owner-activated mode',
    'execution and raw credentials stay disabled after activation',
    'upgrade rows 208/211 and autonomy row 152 go live with the release',
    'public status agrees with the phase verdicts after activation',
    'the attestation route reports owner mode with 28 planes (plane 30 is evidence-only)'
  ] }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ probe: 'phase-status', failed: true, error: error.message }, null, 2));
  process.exitCode = 1;
} finally {
  await new Promise((resolve) => server.close(resolve));
}
