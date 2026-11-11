/**
 * The real plane facts — measured, not asserted.
 *
 * These tests guard the three properties that matter:
 *
 *   1. A fact is only produced when this process can MEASURE it. A plane
 *      that needs something this deployment does not have gets NO fact and
 *      stays blocked with its real blocker code.
 *   2. The measurement is real: the sandbox stages are actually exercised,
 *      the backtest is actually computed, the audit chain is actually built
 *      and verified.
 *   3. The per-phase product-arc probe judges each arc on its own merits —
 *      a missing production signer must not mark 159 pure-logic arcs dead.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildRealPlaneFacts, syncContentHash } from '../../server/intentRealPlaneFacts.js';
import { probeProductArcPhases } from '../../server/intentPhaseRuntimeProbe.js';
import { refreshMeasuredPlaneFacts, scanOperationalProviders } from '../../server/intentOperationalEvidence.js';
import { refreshProductArcProbe } from '../../server/intentPhaseRuntimeProbeCache.js';
import { phaseStatusReport } from '../../server/intentPhaseStatus.js';
import { collectPlaneInputs } from '../../server/intentRuntimePlaneInputs.js';

/* ── the measurement itself ─────────────────────────────────────────── */

test('the measured facts contain only what this process can actually measure', async () => {
  const facts = await buildRealPlaneFacts();
  /* The planes that need nothing external are measured. */
  for (const plane of [23, 24, 28, 34, 37, 38, 39, 41, 46, 50]) {
    assert.ok(facts[plane], `plane ${plane} must be measured — it needs nothing external`);
  }
  /* The planes that need a real external party are NOT measured. Claiming
     them is exactly the bug this module fixes. */
  for (const plane of [21, 25, 26, 27, 31]) {
    assert.equal(facts[plane], undefined, `plane ${plane} must NOT be claimed — it needs an external party`);
  }
});

test('the sandbox stages are actually exercised, not asserted', async () => {
  const facts = await buildRealPlaneFacts();
  const stages = facts[23]?.stages || [];
  assert.equal(stages.length, 5);
  for (const stage of stages) {
    assert.equal(stage.isolated, true, `stage ${stage.id} must be measured as isolated`);
    assert.equal(stage.measured, true);
  }
  /* The operator must declare that it is NOT a production operator. */
  assert.equal(facts[23].operator.productionSigner, false);
  assert.equal(facts[23].operator.mainnetAccess, false);
  assert.equal(facts[23].operator.realCustody, false);
});

test('the audit root is a real hash chain, verified', async () => {
  const facts = await buildRealPlaneFacts();
  const root = facts[28]?.audit?.event?.rootHash;
  assert.match(root, /^[0-9a-f]{64}$/);
  /* It must NOT be a hash of a source file — it is the hash of the last link
     in a chain that was built and checked. */
  assert.notEqual(root, await syncContentHash('durable-immutable-audit'));
});

test('the simulator really computed something', async () => {
  const facts = await buildRealPlaneFacts();
  const sim = facts[24]?.simulator;
  assert.match(sim.requestDigest, /^[0-9a-f]{64}$/);
  assert.match(sim.resultDigest, /^[0-9a-f]{64}$/);
  assert.notEqual(sim.requestDigest, sim.resultDigest);
  /* The scheduler must not be able to sign or submit. */
  assert.equal(facts[24].scheduler.signs, false);
  assert.equal(facts[24].scheduler.submits, false);
});

test('the release train has a rollback target that really exists', async () => {
  const facts = await buildRealPlaneFacts();
  const change = facts[41]?.change;
  assert.equal(change.rollbackReady, true);
  assert.match(change.rollbackTarget, /^[0-9a-f]{40}$/);
  assert.notEqual(change.rollbackTarget, facts[41].train.head);
});

/* ── the merge rule ─────────────────────────────────────────────────── */

test('a measurement outranks an attestation', async () => {
  const { collectPlaneInputs } = await import('../../server/intentRuntimePlaneInputs.js');
  const measured = await buildRealPlaneFacts();
  const collected = collectPlaneInputs({
    mode: 'owner',
    facts: { 34: { limiter: { perMinute: 1 }, enforcement: { attested: false, active: false } } },
    realFacts: measured,
    launchAllowed: true
  });
  /* Plane 34 was measured, so the attested "not enforced" claim loses. */
  assert.equal(collected.inputs.abuse.enforcement.active, true);
  assert.equal(collected.inputs.abuse.limiter.perMinute, 120);
});

test('a plane the measurement could not exercise keeps its attested fact', async () => {
  const { collectPlaneInputs } = await import('../../server/intentRuntimePlaneInputs.js');
  const measured = await buildRealPlaneFacts();
  const collected = collectPlaneInputs({
    mode: 'owner',
    facts: { 43: { budget: { capUsd: 50 }, spent: { usd: 0 }, kill: { engaged: false, bypassable: false } } },
    realFacts: measured,
    launchAllowed: true
  });
  /* Plane 43 was NOT measured (no spend cap is configured), so the attested
     fact survives — the operator's attestation is still evidence. */
  assert.equal(collected.inputs.cost.budget.capUsd, 50);
});

/* ── the control planes ─────────────────────────────────────────────── */

test('the measured planes are live and the unmeasured ones keep real blockers', async () => {
  await refreshMeasuredPlaneFacts();
  const scan = scanOperationalProviders();
  const planes = scan.controlPlane.planes;
  const byPhase = new Map(planes.map((row) => [row.phase, row]));

  /* The planes that need nothing external are live. */
  for (const plane of [24, 34, 37, 38, 39, 41, 46]) {
    assert.equal(byPhase.get(plane).live, true, `plane ${plane} must be live when measured`);
    assert.deepEqual(byPhase.get(plane).blockers, []);
  }
  /* The planes that need a real external party keep their blocker code. */
  assert.ok(byPhase.get(27).blockers.includes('RPC_OUTAGE'));
  assert.ok(byPhase.get(29).blockers.includes('SECURITY_REVIEW_NOT_INDEPENDENT'));
  assert.ok(byPhase.get(22).blockers.includes('CA_INVALID'));
});

test('no plane ever claims live while carrying a blocker', async () => {
  await refreshMeasuredPlaneFacts();
  const scan = scanOperationalProviders();
  for (const plane of scan.controlPlane.planes) {
    assert.ok(
      !(plane.live === true && (plane.blockers || []).length > 0),
      `plane ${plane.phase} claims live with blockers`
    );
  }
});

/* ── the product arcs ───────────────────────────────────────────────── */

test('the product arcs are judged on their own merits', async () => {
  const probe = await probeProductArcPhases();
  assert.equal(probe.entryPointLoadable, true);
  assert.ok(probe.live > 100, `the pure-logic arcs must be live — got ${probe.live}`);

  /* Every blocked arc must name a REAL missing provider. */
  const providerCodes = new Set([
    'WALLET_RUNTIME_REQUIRED',
    'EXECUTION_FEED_REQUIRED',
    'VENUE_ADAPTER_REQUIRED',
    'BRIDGE_PROVIDER_REQUIRED',
    'BROKER_PROVIDER_REQUIRED'
  ]);
  for (const phase of probe.phases.filter((row) => !row.live)) {
    assert.ok(
      (phase.blockers || []).some((code) => providerCodes.has(code)),
      `phase ${phase.phase} is blocked without naming a missing provider: ${phase.blockers}`
    );
  }
});

test('a missing production signer does not mark the pure-logic arcs dead', async () => {
  await refreshMeasuredPlaneFacts();
  await refreshProductArcProbe();
  const report = phaseStatusReport();
  const arcs = report.phases.filter((row) => row.phase > 50);
  const liveArcs = arcs.filter((row) => row.live === true);
  assert.ok(liveArcs.length > 100, `expected the pure-logic arcs to be live — got ${liveArcs.length}`);
  /* And no live arc carries a blocker. */
  for (const arc of liveArcs) {
    assert.deepEqual(arc.blockers, []);
  }
});

test('every phase verdict is self-consistent', async () => {
  await refreshMeasuredPlaneFacts();
  await refreshProductArcProbe();
  const report = phaseStatusReport();
  for (const row of report.phases) {
    assert.equal(row.operational, row.live, `phase ${row.phase} disagrees with itself`);
    if (row.live) assert.deepEqual(row.blockers, [], `phase ${row.phase} is live with blockers`);
  }
  /* Execution and raw credentials never come along with an operational phase. */
  assert.equal(report.executionActivated, false);
  assert.equal(report.rawCredentialsAllowed, false);
});

/* ══════════════════════════════════════════════════════════════════════
 * THE MEASURED-VERSUS-ATTESTED MERGE
 * ══════════════════════════════════════════════════════════════════════ */

test('a measurement replaces the attested fact where it speaks', () => {
  const collected = collectPlaneInputs({
    mode: 'owner',
    facts: { 34: { limiter: { perMinute: 999 }, enforcement: { attested: true, active: true } } },
    realFacts: { 34: { limiter: { perMinute: 120 } } },
    launchAllowed: true,
    now: Date.now()
  });
  assert.equal(collected.inputs.abuse.limiter.perMinute, 120, 'the measurement must win');
});

test('an absence of knowledge does NOT erase the attested fact', () => {
  /* Plane 29's independent review is produced by a human or an external
     service. This process cannot produce one and cannot prove one is
     absent either — so `review: null` means "not measured", and the
     operator's attested review has to survive. */
  const collected = collectPlaneInputs({
    mode: 'owner',
    facts: { 29: { review: { independent: true, signed: true, reviewerId: 'r1' } } },
    realFacts: { 29: { review: null, privacy: { reviewed: true } } },
    launchAllowed: true,
    now: Date.now()
  });
  assert.equal(collected.inputs.assurance.review.independent, true, 'the attested review must survive');
  assert.equal(collected.inputs.assurance.review.reviewerId, 'r1');
  /* And the field that WAS measured is still there. */
  assert.equal(collected.inputs.assurance.privacy.reviewed, true);
});

test('a negative measurement DOES replace the attested fact', () => {
  /* `false` is a measurement, not an absence of knowledge. If the process
     measured that the thing is absent, the attested "it is there" must go
     — otherwise the merge would be a way to keep a false claim alive. */
  const collected = collectPlaneInputs({
    mode: 'owner',
    facts: { 34: { limiter: { perMinute: 120 }, enforcement: { attested: true, active: true } } },
    realFacts: { 34: { enforcement: { attested: true, active: false } } },
    launchAllowed: true,
    now: Date.now()
  });
  assert.equal(collected.inputs.abuse.enforcement.active, false);
});

test('a plane with no measurement at all keeps its attested fact', () => {
  const collected = collectPlaneInputs({
    mode: 'owner',
    facts: { 31: { incident: { id: 'standby-no-active-incident' }, commander: { independent: true, id: 'ops-lead' } } },
    realFacts: { 34: { limiter: { perMinute: 120 } } },
    launchAllowed: true,
    now: Date.now()
  });
  assert.equal(collected.inputs.incident.commander.id, 'ops-lead');
});

test('without an injected bundle, an unmeasured plane stays unmeasured', () => {
  const collected = collectPlaneInputs({
    mode: 'owner',
    facts: null,
    realFacts: { 34: { limiter: { perMinute: 120 } } },
    launchAllowed: true,
    now: Date.now()
  });
  /* Only the measured plane carries a fact — the built-in self-attesting
     bundle may not stand in for a measurement. The unmeasured plane comes
     back EMPTY, which is exactly "nothing is claimed here". */
  assert.ok(collected.inputs.abuse);
  assert.deepEqual(collected.inputs.incident, {});
  assert.equal(collected.meta.provenance, 'measured-in-process');
});
