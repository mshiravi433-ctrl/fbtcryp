/*
 * DOES THE GATEWAY REMEMBER WHICH MODEL FAILED? (2026-11-13)
 * ==========================================================================
 *
 * `recordProviderCall` was handed the model id and the classified reason code on
 * every call — and stored neither in the call window. The window kept
 * ok/duration/tokens, so the store could say "this provider answered badly" but
 * never "this MODEL does not exist". Two consequences, both measured before the
 * fix:
 *
 *   1. After `google/gemini-2.5-pro` returned HTTP 404 five turns running, the
 *      ladder it leads was byte-for-byte unchanged, so the NEXT turn paid for the
 *      same dead call again. On the `:free` tier a failed request counts against
 *      the daily allowance exactly like a successful one — this was a recurring
 *      tax on every deep turn, not a latency quirk.
 *   2. A model-scoped fault parked the whole provider, pushing a gateway that
 *      fronts a hundred models to LAST in the fleet order behind two providers
 *      nobody had asked anything of.
 *
 * The second one is an inconsistency the file had already named. `classifyAiError`
 * draws the line explicitly — "this MODEL is wrong (404 model_not_found, 403
 * tier_not_allowed — try the next model on the same provider, no reason to give
 * up on a working key)" versus "this ACCOUNT/KEY is wrong (no model will help)" —
 * and nothing downstream honoured it.
 *
 * These tests drive the real store. No network: the evidence is recorded by hand
 * and the ladder is read back, which is the only part of this that was broken.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  getModelCandidates,
  recordProviderCall,
  resetProviderHealth,
  deadModelsFor,
  isProviderHealthy,
  orderByHealth
} from '../../server/aiGateway.js';

const P = 'openrouter';

const died = (model, reasonCode = 'MODEL_UNAVAILABLE') =>
  recordProviderCall(P, { ok: false, model, durationMs: 400, reasonCode, error: 'HTTP 404 model_not_found' });
const lived = (model) => recordProviderCall(P, { ok: true, model, durationMs: 500 });

test('a model that 404d is not offered first again', () => {
  /* THE TAX. One deterministic 404 is enough to act on: a model id that does not
     exist does not start existing on the next request. */
  resetProviderHealth();
  const before = getModelCandidates(P, null, { mode: 'max' });
  assert.ok(before.length >= 2, 'the ladder must have more than one id for this to mean anything');

  died(before[0]);
  const after = getModelCandidates(P, null, { mode: 'max' });

  assert.notEqual(after[0], before[0], 'the proven-dead id must not lead the next turn');
  assert.deepEqual([...deadModelsFor(P).keys()], [before[0]], 'and the store must say which id died');
});

test('the fault belongs to the model, so the provider is not taken out of service', () => {
  /*
   * Consequence 2. Parking the seat punished every live id behind the dead one,
   * and the ladders that matter FILTER on health — so a parked provider was not
   * merely ordered later, it was removed from the collaboration and escalation
   * queues entirely.
   *
   * `orderByHealth` still puts this seat behind an untried one, and that is its
   * own documented policy ("answered badly last time: try after the untried"),
   * not a punishment this fix left behind — the last call really did fail. The
   * claim under test is the narrower and more consequential one: the circuit
   * stays CLOSED, so the seat is still in the queue to be asked.
   */
  resetProviderHealth();
  const ladder = getModelCandidates(P, null, { mode: 'max' });
  died(ladder[0]);

  assert.equal(isProviderHealthy(P), true,
    'one model-scoped fault must not park a provider whose other ids were never asked');
  assert.ok(orderByHealth([P, 'groq']).includes(P),
    'and the seat must still be in the fleet order, wherever the policy puts it');
});

test('two failures in a row still park the provider', () => {
  /* THE ACCOUNT-WIDE CASE, still covered and by the rule that always covered it.
     A key that lost tier access answers 403 on EVERY id, so the second
     consecutive failure is the evidence that the fault is no longer one model's. */
  resetProviderHealth();
  const ladder = getModelCandidates(P, null, { mode: 'max' });
  died(ladder[0]);
  died(ladder[1] || ladder[0]);

  assert.equal(isProviderHealthy(P), false,
    'two consecutive failures park the seat whichever models they happened to be on');
});

test('an explicitly requested model still leads, dead or not', () => {
  /* Pinned by the wiring probe and unchanged on purpose: a caller who named an id
     is entitled to have it tried. An Enterprise account may still serve an id its
     vendor retired for new customers. */
  resetProviderHealth();
  const ladder = getModelCandidates(P, null, { mode: 'max' });
  died(ladder[0]);

  assert.equal(getModelCandidates(P, ladder[0], { mode: 'max' })[0], ladder[0],
    'an explicit request is an instruction, not a suggestion');
});

test('a demoted model is demoted, never deleted — and a chain that is all dead still answers', () => {
  /*
   * The philosophy the stale-pin rule above already follows: nothing is removed
   * from the chain, only ordered. Demotion operates on the FULL chain and the
   * attempt cap then decides how many are tried, so killing the four ids a turn
   * was offered simply promotes the next four live ones — which is the point.
   *
   * The limit case is the one that matters: kill every id the provider has, one
   * round at a time, and the chain must stop moving rather than empty out. An
   * empty chain would turn a bad morning into a seat that can never be asked
   * again, and no evidence justifies that.
   */
  resetProviderHealth();
  const original = getModelCandidates(P, null, { mode: 'max' });
  const seen = new Set();
  let rounds = 0;
  for (; rounds < 12; rounds++) {
    const current = getModelCandidates(P, null, { mode: 'max' });
    assert.ok(current.length > 0, `round ${rounds}: the chain must never come back empty`);
    if (current.every((m) => seen.has(m))) break; // nothing live left to promote
    for (const m of current) { seen.add(m); died(m); }
  }
  assert.ok(rounds > 1, `the provider must have had more than one round of ids to offer (rounds ${rounds})`);

  const settled = getModelCandidates(P, null, { mode: 'max' });
  assert.ok(settled.length > 0, 'with every id proven dead there is still a chain to try');
  assert.deepEqual(settled, original,
    'and once there is nothing left to prefer, the chain reverts to its untouched order instead of churning');
  assert.deepEqual(getModelCandidates(P, null, { mode: 'max' }), settled, 'reading it again changes nothing');
});

test('a slow model is not a dead model', () => {
  /* Only deterministic faults demote. A timeout or a rate limit says the model
     exists and is busy; demoting it would punish the fleet's fastest recovery
     and, on a throttled free tier, would demote precisely the id that is about
     to be allowed again. */
  resetProviderHealth();
  const ladder = getModelCandidates(P, null, { mode: 'max' });
  for (const code of ['TIMEOUT', 'NETWORK', 'QUOTA']) {
    resetProviderHealth();
    died(ladder[0], code);
    assert.equal(getModelCandidates(P, null, { mode: 'max' })[0], ladder[0],
      `a ${code} fault must not demote a model — it is evidence about the network, not about the id`);
    assert.equal(deadModelsFor(P).size, 0, `a ${code} fault is not a dead model`);
  }
});

test('the demotion expires on the same clock as the circuit it replaces', () => {
  /* A vendor's 404 can be a bad morning rather than a retired model, so the
     evidence cools — and it cools for exactly as long as the provider park used
     to, because a model and its provider must not be punished on two clocks. */
  resetProviderHealth();
  const ladder = getModelCandidates(P, null, { mode: 'max' });
  died(ladder[0]);

  const cooldown = 10 * 60_000; // CIRCUIT_OPEN_MS.MODEL_UNAVAILABLE
  assert.equal(deadModelsFor(P, { now: Date.now() + cooldown - 1000 }).size, 1, 'still dead a moment before the cooldown ends');
  assert.equal(deadModelsFor(P, { now: Date.now() + cooldown + 60_000 }).size, 0, 'and forgotten after it');
});

test('a recovery is remembered too: the newest evidence wins', () => {
  resetProviderHealth();
  const ladder = getModelCandidates(P, null, { mode: 'max' });
  died(ladder[0]);
  lived(ladder[0]);

  assert.equal(getModelCandidates(P, null, { mode: 'max' })[0], ladder[0],
    'an id that answered after it 404d is not dead, and must lead again');
});

test('with no evidence the ladder is byte-for-byte what it was', () => {
  /* The whole change must be inert until something actually fails — otherwise it
     is a reordering of the fleet nobody asked for. */
  resetProviderHealth();
  const max = getModelCandidates(P, null, { mode: 'max' });
  assert.deepEqual(getModelCandidates(P, null, { mode: 'balanced' }), getModelCandidates(P), 'balanced is the historical chain');
  assert.equal(getModelCandidates(P, null, { mode: 'swift' })[0], getModelCandidates(P)[0], 'and so is swift');
  assert.ok(max.length >= 2, 'max still puts the flagships first');
  assert.equal(deadModelsFor(P).size, 0, 'nothing is dead until something fails');
});
