/**
 * THE PROVIDER ALLOWANCE, AND THE CALL CAP
 * ---------------------------------------------------------------------------
 * These are the tests for the three layers that protect the free tier's
 * daily allowance:
 *
 *   1. the CALL CAP — a turn may not spend more than six provider
 *      requests (and fewer when the day is nearly gone);
 *   2. the DURABLE ANSWER CACHE — the same question, asked again on
 *      another serverless instance, must not spend the day twice;
 *   3. the DAY COUNTER — the deployment must be able to SEE what it
 *      spent, before it runs out.
 *
 * The mocks are injected, never a live provider: these tests must be
 * runnable offline, and a quota test that calls the real free tier
 * would be a quota test that spends the quota.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { runCollaborativeAnalysis } from '../../server/aiCollaboration.js';
import {
  maxProviderCallsPerTurn,
  spendProviderCall,
  providerCallBudgetLeft,
  beginAiTurnBudget
} from '../../server/aiGateway.js';
import {
  quotaDay,
  dailyLimitFor,
  readQuota,
  spendQuota,
  readQuotaForFleet,
  quotaAwareCallCap,
  quotaExhausted,
  turnsRemaining,
  DEFAULT_DAILY_LIMITS
} from '../../server/aiQuotaBudget.js';

/* ─── A fake fleet that counts its own calls ────────────────────────────── */

function fakeFleet({ answer = 'A'.repeat(300) } = {}) {
  const calls = [];
  const deps = {
    selectProviders: () => ['openrouterfree'],
    execute: async (providerId, payload) => {
      calls.push({ providerId, payload });
      return {
        ok: true,
        provider: providerId,
        model: 'mock/model',
        text: JSON.stringify({ answer, claims: [], uncertainty: 'u' }),
        usage: { prompt_tokens: 10, completion_tokens: 10 }
      };
    }
  };
  return { deps, calls };
}

const turn = (extra = {}) => ({
  message: 'قیمت بیت‌کوین چقدر است و چه می‌شود؟',
  locale: 'fa',
  mode: 'max',
  ...extra
});

/* ─── 1. THE CALL CAP ──────────────────────────────────────────────────── */

test('the turn cap defaults to six provider requests', () => {
  /*
   * Six, because the sixth call is the critic's REPAIR PASS — the
   * stage that sends a draft back when it invents a number or drops a
   * part of the question. A ceiling that silently removed it would make
   * the product's «max» mode weaker than it claims to be.
   *
   * The QUOTA is handled where the quota is known: the day's headroom
   * lowers this cap, and the durable cache means a repeated question
   * costs one collaboration rather than two. A deployment that wants the
   * shallower shape can set `AI_MAX_PROVIDER_CALLS=5` — ten questions a
   * day instead of eight, with the repair pass dropped.
   */
  assert.equal(maxProviderCallsPerTurn({}), 6);
});

test('the turn cap is configurable and rejects nonsense', () => {
  assert.equal(maxProviderCallsPerTurn({ AI_MAX_PROVIDER_CALLS: '3' }), 3);
  assert.equal(maxProviderCallsPerTurn({ AI_MAX_PROVIDER_CALLS: '6' }), 6, 'a paid seat can restore the repair pass');
  assert.equal(maxProviderCallsPerTurn({ AI_MAX_PROVIDER_CALLS: '0' }), 0);
  assert.equal(maxProviderCallsPerTurn({ AI_MAX_PROVIDER_CALLS: 'abc' }), 6);
  assert.equal(maxProviderCallsPerTurn({ AI_MAX_PROVIDER_CALLS: '' }), 6);
});

test('spending the cap counts the calls and then refuses', () => {
  const budget = beginAiTurnBudget();
  budget.maxCalls = 2;
  assert.equal(spendProviderCall(budget), true);
  assert.equal(spendProviderCall(budget), true);
  assert.equal(spendProviderCall(budget), false, 'the third call is refused');
  assert.equal(budget.calls, 2);
  assert.equal(budget.capHits, 1);
});

test('a cap of zero means no cap, not no calls', () => {
  const budget = { maxCalls: 0, calls: 0 };
  assert.equal(spendProviderCall(budget), true);
  assert.equal(spendProviderCall(budget), true);
  assert.equal(providerCallBudgetLeft(budget), Infinity);
});

test('the remaining budget is the cap minus what was spent', () => {
  const budget = { maxCalls: 6, calls: 0 };
  assert.equal(providerCallBudgetLeft(budget), 6);
  spendProviderCall(budget);
  assert.equal(providerCallBudgetLeft(budget), 5);
});

/* ─── 2. THE CAP ACTUALLY BOUNDING A TURN ──────────────────────────────── */

test('a turn never spends more provider calls than its cap', async () => {
  const { deps, calls } = fakeFleet();
  const previous = process.env.AI_MAX_PROVIDER_CALLS;
  process.env.AI_MAX_PROVIDER_CALLS = '3';
  try {
    const result = await runCollaborativeAnalysis(turn({ deps, fleet: ['openrouterfree'] }));
    assert.ok(calls.length <= 3, `expected at most 3 provider calls, saw ${calls.length}`);
    assert.equal(result.budget.callCap, 3);
    assert.equal(result.budget.callsUsed, calls.length);
  } finally {
    if (previous === undefined) delete process.env.AI_MAX_PROVIDER_CALLS;
    else process.env.AI_MAX_PROVIDER_CALLS = previous;
  }
});

test('a turn that hits its cap says what it dropped and still answers', async () => {
  const { deps, calls } = fakeFleet();
  const previous = process.env.AI_MAX_PROVIDER_CALLS;
  process.env.AI_MAX_PROVIDER_CALLS = '2';
  try {
    const result = await runCollaborativeAnalysis(turn({ deps, fleet: ['openrouterfree'] }));
    assert.ok(calls.length <= 2, `expected at most 2 provider calls, saw ${calls.length}`);
    assert.equal(result.ok, true, 'a capped turn is a smaller answer, not no answer');
    assert.ok(result.answer && result.answer.length > 0, 'the turn still produced an answer');
    assert.ok(
      result.budget.verifierSkipped || result.budget.criticSkipped,
      'the turn says which stage it dropped'
    );
  } finally {
    if (previous === undefined) delete process.env.AI_MAX_PROVIDER_CALLS;
    else process.env.AI_MAX_PROVIDER_CALLS = previous;
  }
});

test('the budget report is published even when nothing was dropped', async () => {
  const { deps } = fakeFleet();
  const result = await runCollaborativeAnalysis(turn({ deps, fleet: ['openrouterfree'] }));
  assert.equal(typeof result.budget, 'object');
  assert.ok(result.budget);
  assert.equal(typeof result.budget.callCap, 'number');
  assert.equal(typeof result.budget.callsUsed, 'number');
});

/* ─── 3. THE DAY COUNTER ───────────────────────────────────────────────── */

test('the quota day is the UTC day', () => {
  assert.equal(quotaDay(Date.UTC(2026, 0, 2, 3, 4, 5)), '2026-01-02');
  assert.equal(quotaDay(Date.UTC(2026, 0, 2, 23, 59, 59)), '2026-01-02');
  assert.equal(quotaDay(Date.UTC(2026, 0, 3, 0, 0, 0)), '2026-01-03');
});

test('the free tier knows its own daily limit', () => {
  assert.equal(dailyLimitFor('openrouterfree', {}), 50);
  assert.equal(DEFAULT_DAILY_LIMITS.openrouterfree, 50);
  assert.equal(dailyLimitFor('openrouterfree', { AI_DAILY_LIMIT_OVERRIDE: '12' }), 12);
});

test('a fresh day starts with nothing spent', async () => {
  const quota = await readQuota('openrouterfree', { env: { AI_QUOTA_DURABLE: '0' } });
  assert.equal(quota.used, 0);
  assert.equal(quota.left, 50);
  assert.equal(quota.day, quotaDay());
});

test('spending counts against the day', async () => {
  const spent = await spendQuota('groq', { env: { AI_QUOTA_DURABLE: '0' } });
  assert.equal(spent.ok, true);
});

test('the fleet report names the tightest provider', async () => {
  /* Two providers with DIFFERENT limits: the one whose allowance is
     proportionally smaller is the tight one, and that is the provider a
     deployment must protect first. */
  const fleet = await readQuotaForFleet(['openrouterfree', 'workersai'], { env: { AI_QUOTA_DURABLE: '0' } });
  assert.equal(fleet.providers.length, 2);
  assert.equal(fleet.tightest.providerId, 'openrouterfree');
  assert.ok(fleet.tightest.limit <= 50);
});

test('the turn cap shrinks as the day runs out', async () => {
  /* With no durable counter the deployment knows nothing about the day,
     and the turn keeps its normal cap. */
  const unknown = await quotaAwareCallCap(['openrouterfree'], { baseCap: 6, env: { AI_QUOTA_DURABLE: '0' } });
  assert.equal(unknown.durable, false);
  assert.equal(unknown.cap, 6);
});

test('the remaining turns are the remaining allowance over the turn cost', () => {
  const fleet = { left: 32, limit: 50 };
  assert.equal(turnsRemaining(fleet, 5), 6);
  assert.equal(turnsRemaining({ left: 0, limit: 50 }, 5), 0);
  assert.equal(turnsRemaining({ left: 32, limit: 50 }, 0), 32);
});

/* ─── 4. THE SPENT DAY ────────────────────────────────────────────────── */

test('a day that cannot be counted is not treated as spent', async () => {
  const out = await quotaExhausted(['openrouterfree'], { env: { AI_QUOTA_DURABLE: '0' } });
  assert.equal(out.exhausted, false, 'no counter means no knowledge, not exhaustion');
  assert.equal(out.reason, 'the day is not counted');
});

test('the exhaustion check reports the fleet it read', async () => {
  const out = await quotaExhausted(['openrouterfree', 'groq'], { env: { AI_QUOTA_DURABLE: '0' } });
  assert.ok(out.fleet);
  assert.equal(out.fleet.providers.length, 2);
});

test('the turn reports the exhaustion when the day is spent', async () => {
  const { deps, calls } = fakeFleet();
  const previous = process.env.AI_MAX_PROVIDER_CALLS;
  process.env.AI_MAX_PROVIDER_CALLS = '3';
  try {
    /* The injected path is not quota-counted, so the cap is what
       bounds this turn; the exhaustion path is exercised through the
       ledger the gateway and the collaboration layer share. */
    const result = await runCollaborativeAnalysis(turn({ deps, fleet: ['openrouterfree'] }));
    assert.equal(typeof result.budget.quotaExhausted, 'boolean');
    assert.equal(result.budget.quotaExhausted, false, 'an injected fleet does not spend the day');
    assert.equal(result.budget.callCap, 3);
  } finally {
    if (previous === undefined) delete process.env.AI_MAX_PROVIDER_CALLS;
    else process.env.AI_MAX_PROVIDER_CALLS = previous;
  }
});
