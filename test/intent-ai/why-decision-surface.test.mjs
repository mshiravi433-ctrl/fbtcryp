/**
 * THE WHY-DECISION SURFACE (path 15)
 * ---------------------------------------------------------------------------
 * `server/fios/whyEngine.js` answers the question every assistant is
 * eventually asked: «چرا این را گفتی؟» — why this asset, why this
 * network, why now, why this amount, why this strategy, plus four named
 * falsifiers and the invalidation conditions.
 *
 * It was dark, and it was dark for a reason that was not its fault: it
 * expected a decision record from the FIOs decision engine, and the
 * central brain does not use that engine. The brain has its OWN
 * decision — the recommendation it builds from its own findings — and
 * nobody translated it into the engine's language. So «چرا این را
 * گفتی؟» was UNSUPPORTED.
 *
 * These tests cover the translation and the surface:
 *
 *   · the INTENT — the question reaches WHY_DECISION, and it does not
 *     steal the market question («چرا بیت‌کوین بالا رفت؟» is about the
 *     world, not about the answer);
 *   · the TRANSLATION — every number in the bundle came from a finding
 *     the brain read, and a finding that could not be read leaves the
 *     line absent rather than defaulting it to zero;
 *   · the REFUSAL — there is no explanation without a decision, and the
 *     engine says so instead of producing a plausible sentence;
 *   · the REGISTRY — the module, the section and the event are declared.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { classify, INTENT_TYPES } from '../../src/lib/central/intent.js';
import { MODULE_IDS, EVENT_TYPES, STATE_SECTIONS } from '../../src/lib/central/schema.js';
import {
  setWhyProvider,
  hasWhyProvider,
  explainWhy,
  buildBrainDecisionBundle
} from '../../server/ci/whyBridge.js';

/* ─── THE INTENT ───────────────────────────────────────────────────────── */

const CAPS = {
  wallet: 'AVAILABLE', portfolio: 'AVAILABLE', markets: 'AVAILABLE',
  risk: 'AVAILABLE', signals: 'AVAILABLE', news: 'AVAILABLE'
};
const CTX = {
  capabilities: CAPS,
  stateHas: { markets: true, signals: true, news: true, portfolio: true, whyDecision: true }
};
const ask = (q) => classify(q, { context: CTX, state: {} });

test('the Persian «why did you say that» reaches the why surface', () => {
  const r = ask('چرا این را گفتی؟');
  assert.equal(r.type, 'WHY_DECISION', `→ ${r.type}`);
});

test('the English «why did you say that» reaches the why surface', () => {
  const r = ask('why did you recommend that?');
  assert.equal(r.type, 'WHY_DECISION', `→ ${r.type}`);
});

test('the why surface does not steal the market question', () => {
  const r = ask('چرا بیت‌کوین بالا رفت؟');
  assert.notEqual(r.type, 'WHY_DECISION', 'a question about the WORLD is not a question about the ANSWER');
});

test('the why surface does not steal the portfolio question', () => {
  const r = ask('پرتفوی من چطور است؟');
  assert.notEqual(r.type, 'WHY_DECISION');
});

test('the why intent is declared and names its module', () => {
  assert.ok(INTENT_TYPES.WHY_DECISION, 'the intent must be declared');
  assert.ok(INTENT_TYPES.WHY_DECISION.modules.includes('why-decision'));
});

/* ─── THE REGISTRY ─────────────────────────────────────────────────────── */

test('the why module is in the registry', () => {
  assert.ok(MODULE_IDS.includes('why-decision'));
});

test('the why state section exists', () => {
  assert.ok(STATE_SECTIONS.whyDecision, 'a module with no section is a module nothing asks for');
});

test('the why event is declared', () => {
  assert.ok(EVENT_TYPES.includes('WHY_DECISION_READ'));
});

/* ─── THE TRANSLATION ──────────────────────────────────────────────────── */

const recommendation = {
  ok: true,
  headline: 'The cheapest yield the owner can actually hold',
  confidence: { overall: 0.62 },
  evidence: [{ id: 'opportunities', source: 'yields-engine' }],
  reasons: ['the pool cleared the eligibility floor and pays the most after the risk adjustment'],
  alternatives: [{ id: 'alt-1', label: 'a lower-yield stable pool' }]
};

const findings = [
  {
    id: 'opportunities',
    status: 'OK',
    source: 'yields-engine',
    at: 1700000000000,
    candidates: [
      { id: 'pool-1', name: 'USDC lending', aprPct: 7.4, evidence: [{ source: 'defillama', detail: 'observed' }] },
      { id: 'pool-2', name: 'ETH staking', aprPct: 4.1, evidence: [{ source: 'defillama', detail: 'observed' }] }
    ],
    reason: 'the top eligible pool pays the most with acceptable protocol risk',
    detail: '2 eligible pools, best 7.4% APR'
  }
];

test('the translation refuses when there is no decision', () => {
  const built = buildBrainDecisionBundle({ recommendation: { ok: false, reason: ['nothing to recommend'] }, findings });
  assert.equal(built.ok, false);
  assert.equal(built.code, 'NO_DECISION');
});

test('the translation carries the chosen candidate', () => {
  const built = buildBrainDecisionBundle({ recommendation, findings });
  assert.equal(built.ok, true);
  assert.ok(built.bundle.decision.decision.strategyId, 'the chosen candidate must be named');
  assert.equal(built.bundle.decision.decision.expectedReturnPct, 7.4, 'the return comes from the finding');
  assert.ok(built.bundle.strategies.length >= 2, 'the candidate rows travel with it');
});

test('the translation names the confidence the brain derived', () => {
  const built = buildBrainDecisionBundle({ recommendation, findings });
  assert.equal(built.bundle.decision.confidence.overall, 0.62);
});

test('the translation carries the reasons the brain wrote', () => {
  const built = buildBrainDecisionBundle({ recommendation, findings });
  assert.ok(Array.isArray(built.bundle.decision.reason));
  assert.ok(built.bundle.decision.reason.length > 0);
});

test('the translation leaves an unread number absent', () => {
  const built = buildBrainDecisionBundle({ recommendation, findings: [] });
  assert.equal(built.bundle.decision.decision.expectedReturnPct, null, 'no finding, no number');
  assert.equal(built.bundle.decision.decision.amountUsd, null);
});

test('the translation carries the invalidation conditions the findings named', () => {
  const withInvalidation = [
    ...findings,
    { id: 'risk-note', status: 'OK', invalidationConditions: ['a price below the entry band'], source: 'risk-engine' }
  ];
  const built = buildBrainDecisionBundle({ recommendation, findings: withInvalidation });
  assert.ok(built.bundle.decision.invalidationConditions.includes('a price below the entry band'));
});

test('the translation invents no invalidation condition', () => {
  const built = buildBrainDecisionBundle({ recommendation, findings });
  assert.deepEqual(built.bundle.decision.invalidationConditions, [], 'no finding named one');
});

test('the translation carries the risk tolerance the decision was sized against', () => {
  const built = buildBrainDecisionBundle({
    recommendation,
    findings,
    risk: { level: 'HIGH' }
  });
  assert.equal(built.bundle.preferences.riskTolerance, 'HIGH');
});

/* ─── THE BRIDGE ───────────────────────────────────────────────────────── */

test('an unwired why bridge says WHY_PROVIDER_NOT_WIRED', async () => {
  const restore = setWhyProvider(null);
  try {
    assert.equal(hasWhyProvider(), false);
    const out = await explainWhy('owner-1', {});
    assert.equal(out.ok, false);
    assert.equal(out.code, 'WHY_PROVIDER_NOT_WIRED');
    assert.equal(out.why, null);
  } finally {
    restore();
  }
});

test('a failing why provider is named, not thrown', async () => {
  const restore = setWhyProvider(async () => { throw new Error('the engine is down'); });
  try {
    const out = await explainWhy('owner-1', {});
    assert.equal(out.ok, false);
    assert.equal(out.code, 'WHY_FAILED');
  } finally {
    restore();
  }
});

test('the bridge hands the bundle to the provider', async () => {
  const seen = [];
  const restore = setWhyProvider(async (owner, bundle) => {
    seen.push({ owner, bundle });
    return { ok: true, why: { why: { whyAsset: ['because the number'] }, falsifiers: [] } };
  });
  try {
    const built = buildBrainDecisionBundle({ recommendation, findings });
    const out = await explainWhy('owner-1', built.bundle);
    assert.equal(out.ok, true);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].owner, 'owner-1');
    assert.ok(seen[0].bundle.decision, 'the bundle carries the decision');
  } finally {
    restore();
  }
});
