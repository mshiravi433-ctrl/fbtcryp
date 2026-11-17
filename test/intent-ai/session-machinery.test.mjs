/**
 * THE SESSION MACHINERY (path 16)
 * ---------------------------------------------------------------------------
 * The last two dark engines are not surfaces — they are MACHINERY.
 *
 * `server/fios/conversationState.js` is a state machine over a financial
 * conversation: DISCOVERY → UNDERSTANDING → CLARIFICATION → RESEARCH →
 * STRATEGY → SIMULATION → PROPOSAL → CONFIRMATION → EXECUTION →
 * VERIFICATION → MONITORING → REPLAN → COMPLETED, with legal edges, an
 * adaptive question bank that asks only for the fields the conversation
 * still lacks, and a rule that an illegal edge is REFUSED with the legal
 * edges named.
 *
 * `server/fios/eventReplanning.js` listens on the central event bus and
 * re-plans when the world moves under a plan.
 *
 * Making them modules would be a lie of the same kind this repo keeps
 * fixing: a user-facing «replan my conversation» button is not what a
 * conversation-state machine IS. The right integration is in the SESSION
 * LAYER — the turn ingests the message, advances the state, and asks the
 * ONE adaptive question the current state needs; and the turn reads the
 * last replan so the owner learns the plan was reconsidered.
 *
 * These tests cover that integration, and the honest refusals:
 *
 *   · the machine asks for a field it lacks, and for NO MORE than one;
 *   · it does NOT ask when the state does not consume a field;
 *   · it refuses an illegal edge and names the legal ones;
 *   · a missing engine means no adaptive question — not a failed turn;
 *   · a replan that changed nothing is NOT announced.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  setConversationProvider,
  setReplanProvider,
  setReplanReader,
  hasConversationProvider,
  hasReplanProvider,
  hasReplanReader,
  ingestTurn,
  replanFor,
  readLastReplan,
  conversationNeedsInput
} from '../../server/ci/sessionBridge.js';
import {
  openConversation,
  advanceConversation,
  suggestNextState,
  nextAdaptiveQuestion,
  presentInputs,
  CONVERSATION_STATES,
  CONVERSATION_TRANSITIONS,
  QUESTION_BANK
} from '../../server/fios/conversationState.js';
import { REPLAN_TRIGGERS } from '../../server/fios/eventReplanning.js';

/* ─── THE MACHINE ITSELF ───────────────────────────────────────────────── */

test('a conversation opens in DISCOVERY', () => {
  const row = openConversation({ owner: 'o1', locale: 'fa', message: 'سلام' });
  assert.equal(row.state, 'DISCOVERY');
  assert.equal(row.turns, 0);
  assert.ok(row.id.startsWith('cnv_'));
});

test('an illegal transition is refused and the legal edges are named', () => {
  const row = openConversation({ owner: 'o1' });
  const out = advanceConversation(row, { to: 'EXECUTION' });
  assert.equal(out.ok, false);
  assert.equal(out.code, 'ILLEGAL_TRANSITION');
  assert.deepEqual(out.allowed, CONVERSATION_TRANSITIONS.DISCOVERY);
  assert.ok(out.detail.includes('DISCOVERY'));
});

test('a legal transition advances and records the history', () => {
  const row = openConversation({ owner: 'o1' });
  const out = advanceConversation(row, { to: 'UNDERSTANDING', note: 'first message' });
  assert.equal(out.ok, true);
  assert.equal(out.conversation.state, 'UNDERSTANDING');
  assert.equal(out.conversation.turns, 1);
  assert.equal(out.conversation.history.length, 2);
});

test('every state has a transition table entry', () => {
  for (const state of CONVERSATION_STATES) {
    assert.ok(Array.isArray(CONVERSATION_TRANSITIONS[state]), `${state} must declare its legal edges`);
  }
});

test('the question bank has a Persian and an English line for every field', () => {
  for (const [field, entry] of Object.entries(QUESTION_BANK)) {
    assert.ok(entry.fa, `${field} needs a Persian question`);
    assert.ok(entry.en, `${field} needs an English question`);
  }
});

test('the adaptive question asks for the FIRST missing field only', () => {
  const q = nextAdaptiveQuestion('CLARIFICATION', { goalReasoning: { goal: 'growth' } });
  assert.ok(q.question);
  assert.equal(q.field, 'targetReturnPct');
  assert.equal(q.missing.length, 4);
  assert.ok(q.missing.includes('targetReturnPct'));
  assert.ok(q.missing.includes('horizonMonths'));
});

test('a state whose fields are all present asks nothing', () => {
  const q = nextAdaptiveQuestion('CLARIFICATION', {
    goalReasoning: {
      goal: 'growth', targetReturnPct: 12, horizonMonths: 18, maxDrawdownPct: 10, budgetUsd: 5000
    }
  });
  assert.equal(q.question, null);
  assert.deepEqual(q.missing, []);
});

test('the present-inputs helper reads the goal and the profile', () => {
  const present = presentInputs({
    goalReasoning: { goal: 'growth', horizonMonths: 12 },
    goal: { targetReturnPct: 8, startUsd: 1000 }
  });
  assert.ok(present.includes('goal'));
  assert.ok(present.includes('horizonMonths'));
  assert.ok(present.includes('targetReturnPct'));
  assert.ok(present.includes('budgetUsd'));
  assert.ok(!present.includes('liquidityNeed'));
});

test('a conversation that lacks a field suggests CLARIFICATION', () => {
  const row = { ...openConversation({ owner: 'o1' }), state: 'RESEARCH' };
  const s = suggestNextState(row, { goalReasoning: { goal: 'growth' } });
  assert.equal(s.to, 'CLARIFICATION');
  assert.ok(s.because.includes('missing'));
});

/* ─── THE BRIDGE ───────────────────────────────────────────────────────── */

test('an unwired conversation bridge says CONVERSATION_PROVIDER_NOT_WIRED', async () => {
  const restore = setConversationProvider(null);
  try {
    assert.equal(hasConversationProvider(), false);
    const out = await ingestTurn('owner-1', { message: 'سلام' });
    assert.equal(out.ok, false);
    assert.equal(out.code, 'CONVERSATION_PROVIDER_NOT_WIRED');
    assert.equal(out.question, null);
  } finally {
    restore();
  }
});

test('a failing conversation provider is named, not thrown', async () => {
  const restore = setConversationProvider(async () => { throw new Error('the engine is down'); });
  try {
    const out = await ingestTurn('owner-1', { message: 'سلام' });
    assert.equal(out.ok, false);
    assert.equal(out.code, 'CONVERSATION_FAILED');
  } finally {
    restore();
  }
});

test('the conversation bridge hands the message to the provider', async () => {
  const seen = [];
  const restore = setConversationProvider(async (owner, opts) => {
    seen.push({ owner, opts });
    return { ok: true, conversation: { state: 'UNDERSTANDING' }, suggestion: { to: 'RESEARCH' }, question: { question: { fa: 'q' }, field: 'goal' } };
  });
  try {
    const out = await ingestTurn('owner-1', { message: 'می‌خواهم رشد کنم', locale: 'fa' });
    assert.equal(out.ok, true);
    assert.equal(seen[0].owner, 'owner-1');
    assert.equal(seen[0].opts.message, 'می‌خواهم رشد کنم');
    assert.equal(out.question.field, 'goal');
  } finally {
    restore();
  }
});

/* ─── THE ADAPTIVE QUESTION AT THE TURN LEVEL ──────────────────────────── */

test('a state that consumes a field asks for it', () => {
  const needed = conversationNeedsInput(
    { state: 'CLARIFICATION', locale: 'fa' },
    { question: { fa: 'این پول برای چیست؟', en: 'What is this for?' }, field: 'goal', missing: ['goal'] }
  );
  assert.ok(needed);
  assert.equal(needed.field, 'goal');
  assert.equal(needed.question, 'این پول برای چیست؟');
});

test('a state that consumes NO field asks nothing', () => {
  const needed = conversationNeedsInput(
    { state: 'RESEARCH', locale: 'fa' },
    { question: { fa: 'سؤال' }, field: 'goal', missing: ['goal'] }
  );
  assert.equal(needed, null, 'a research turn does not re-ask for the goal');
});

test('a missing question asks nothing', () => {
  const needed = conversationNeedsInput({ state: 'CLARIFICATION', locale: 'fa' }, { question: null });
  assert.equal(needed, null);
});

test('the question is asked in the conversation’s own language', () => {
  const needed = conversationNeedsInput(
    { state: 'CLARIFICATION', locale: 'en' },
    { question: { fa: 'فارسی', en: 'English' }, field: 'goal', missing: ['goal'] }
  );
  assert.equal(needed.question, 'English');
});

/* ─── THE REPLAN ───────────────────────────────────────────────────────── */

test('the replan triggers are the central bus vocabulary', () => {
  for (const trigger of ['PRICE_CHANGED', 'NEWS_RECEIVED', 'BALANCE_CHANGED', 'RISK_CHANGED', 'SAFE_STOP']) {
    assert.ok(REPLAN_TRIGGERS[trigger], `${trigger} must be a trigger`);
    assert.ok(REPLAN_TRIGGERS[trigger].cooldownMs >= 0);
    assert.ok(REPLAN_TRIGGERS[trigger].label, `${trigger} must carry a label`);
  }
});

test('the risk triggers have the shortest cooldown', () => {
  assert.ok(REPLAN_TRIGGERS.RISK_CHANGED.cooldownMs <= REPLAN_TRIGGERS.PRICE_CHANGED.cooldownMs);
  assert.ok(REPLAN_TRIGGERS.SAFE_STOP.cooldownMs === 0, 'a safety stop never waits');
});

test('an unwired replan bridge says REPLAN_PROVIDER_NOT_WIRED', async () => {
  const restore = setReplanProvider(null);
  try {
    assert.equal(hasReplanProvider(), false);
    const out = await replanFor('owner-1', { trigger: 'PRICE_CHANGED' });
    assert.equal(out.ok, false);
    assert.equal(out.code, 'REPLAN_PROVIDER_NOT_WIRED');
    assert.equal(out.notify, false);
  } finally {
    restore();
  }
});

test('a replan that changed nothing does NOT notify', async () => {
  const restore = setReplanProvider(async () => ({
    ok: true, changed: false, notify: false, reason: 'nothing crossed a decision-relevant line'
  }));
  try {
    const out = await replanFor('owner-1', { trigger: 'PRICE_CHANGED' });
    assert.equal(out.ok, true);
    assert.equal(out.notify, false, 'a notification for every price tick is noise');
    assert.equal(out.changed, false);
  } finally {
    restore();
  }
});

test('a replan that crossed a line notifies and names what changed', async () => {
  const restore = setReplanProvider(async () => ({
    ok: true, changed: true, notify: true,
    summary: 'risk moved to HIGH'
  }));
  try {
    const out = await replanFor('owner-1', { trigger: 'RISK_CHANGED' });
    assert.equal(out.ok, true);
    assert.equal(out.notify, true);
    assert.equal(out.summary, 'risk moved to HIGH');
  } finally {
    restore();
  }
});

test('an unwired replan reader says REPLAN_READER_NOT_WIRED', async () => {
  const restore = setReplanReader(null);
  try {
    assert.equal(hasReplanReader(), false);
    const out = await readLastReplan('owner-1');
    assert.equal(out.ok, false);
    assert.equal(out.code, 'REPLAN_READER_NOT_WIRED');
    assert.equal(out.replan, null);
  } finally {
    restore();
  }
});

test('the replan reader returns the last attempt', async () => {
  const restore = setReplanReader(async () => ({
    ok: true,
    replan: { trigger: 'PRICE_CHANGED', notify: true },
    attempts: [{ trigger: 'PRICE_CHANGED' }]
  }));
  try {
    const out = await readLastReplan('owner-1');
    assert.equal(out.ok, true);
    assert.equal(out.replan.trigger, 'PRICE_CHANGED');
    assert.equal(out.attempts.length, 1);
  } finally {
    restore();
  }
});
