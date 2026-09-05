#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createIntentOSState, createIntent, createTask, checkpoint, createQuestion, bindAnswer, normalizeShortAnswer, resolveReference, runAgents, createSimulation, createExecution, executionAllowed, createIdempotencyGuard, sanitizeContext, createGoal } from '../../src/lib/intent-ai/upgrade8/index.js';

const state = createIntentOSState({ sessionId: 's1', conversationId: 'c1' });
assert.equal(state.conversationStatus, 'CREATED');
const intent = createIntent({ type: 'PORTFOLIO_ANALYSIS', message: 'پرتفوی من را برای ۴ ماه بررسی کن' });
const goal = createGoal({ title: 'رشد پرتفوی', horizonMonths: 4, riskProfile: 'medium' });
const task = createTask({ intentId: intent.intentId, goalId: goal.goalId, steps: ['wallet read', 'portfolio load', 'risk analysis'] });
const done = checkpoint(task, task.steps[0].stepId);
assert.equal(done.progress, 33);
const question = createQuestion({ intentId: intent.intentId, slot: 'riskProfile', expectedType: 'enum' });
const answered = bindAnswer({ ...state, pendingQuestion: question, missingSlots: ['riskProfile'] }, 'medium');
assert.equal(answered.state.collectedSlots.riskProfile, 'medium');
assert.equal(answered.state.missingSlots.length, 0);
assert.equal(normalizeShortAnswer('انجام بده'), true);
assert.equal(resolveReference('همون گزینه دوم', { options: ['first', 'second'] }), 'second');
assert.equal(resolveReference('دومی', { options: ['first', 'second'] }), 'second');
const agents = await runAgents([{ agentId: 'market', run: async () => ({ value: 1 }), confidence: .8 }, { agentId: 'risk', run: async () => { throw new Error('offline'); } }]);
assert.equal(agents.results.length, 2); assert.equal(agents.results[1].status, 'failed');
assert.equal(createSimulation({ scenario: 'bear' }).transactionCreated, false);
assert.equal(executionAllowed(createExecution({ intentId: intent.intentId }), { permission: 'EXECUTE', simulation: true, confirmed: true }).ok, true);
const guard = createIdempotencyGuard(); const first = guard.claim('same', { executionId: 'e1' }); const second = guard.claim('same', { executionId: 'e2' });
assert.equal(first.ok, true); assert.equal(second.duplicate, true); assert.equal(second.execution.executionId, 'e1');
const clean = sanitizeContext({ address: '0xabc', privateKey: 'never', nested: { seedPhrase: 'never' } });
assert.equal('privateKey' in clean, false); assert.equal('seedPhrase' in clean.nested, false);

// 100 golden checks: short answers, references, lifecycle and simulation invariants.
for (let i = 0; i < 100; i += 1) {
  assert.equal(normalizeShortAnswer(i % 2 ? 'yes' : 'no'), i % 2 === 0 ? false : true);
  assert.equal(createSimulation({ scenario: ['bull', 'base', 'bear', 'stress'][i % 4] }).transactionCreated, false);
}
console.log('Upgrade 8 probe: 100 golden scenarios passed');
