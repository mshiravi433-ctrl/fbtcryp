/**
 * THE SESSION MACHINERY, IN A REAL TURN (path 16)
 * ---------------------------------------------------------------------------
 * `session-machinery.test.mjs` covers the parts. This covers the WHOLE:
 * a real brain turn, with the conversation-state engine wired in, and the
 * question the machine asks actually reaching the reply.
 *
 * The claim being proved is narrow and important: the conversation
 * machinery is not a module the user invokes — it is the layer under
 * every turn. So a turn that is missing a field must ASK for it, in the
 * reply, in the machine's own voice, and the turn must still answer
 * everything else it could.
 *
 * Fully offline: no provider is contacted, and the state store is the
 * in-process one.
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { createCentralBrain } from '../../server/ci/brain.js';
import { createCentralStateStore } from '../../server/ci/stateStore.js';
import { setConversationProvider, setReplanReader } from '../../server/ci/sessionBridge.js';

const stateStore = createCentralStateStore();
assert.ok(stateStore, 'a state store is required to run a brain turn');

const brain = createCentralBrain({ stateStore });

/* The machine, as the brain will meet it: it opens the conversation,
   advances to UNDERSTANDING, and asks for the FIRST field it lacks. */
function mountConversation() {
  return setConversationProvider(async (owner, opts) => {
    const message = String(opts?.message || '');
    const needsGoal = !/رشد|درآمد|حفظ/i.test(message);
    return {
      ok: true,
      conversation: {
        id: `cnv_${owner}`,
        state: 'UNDERSTANDING',
        turns: 1,
        locale: opts?.locale || 'fa',
        updatedAt: Date.now()
      },
      suggestion: { to: 'CLARIFICATION', because: needsGoal ? 'missing goal' : 'UNDERSTANDING is satisfied' },
      question: needsGoal
        ? {
            question: { fa: 'این پول برای چیست — رشد، درآمد، یا حفظ سرمایه؟', en: 'What is this money for?' },
            field: 'goal',
            missing: ['goal', 'targetReturnPct', 'horizonMonths']
          }
        : { question: null, field: null, missing: [] }
    };
  });
}

test.after(() => {
  /* Leave the bridge as the deployment finds it. */
  setConversationProvider(null);
  setReplanReader(null);
});

test('the turn ingests the message into the conversation', async () => {
  const restore = mountConversation();
  try {
    const out = await brain.handle({ owner: 'devsession01', message: 'می‌خواهم برای رشد سرمایه‌ام برنامه بگذارم', locale: 'fa' });
    assert.ok(out.conversation, 'the turn must report the conversation it is in');
    assert.equal(out.conversation.state, 'UNDERSTANDING');
    assert.equal(out.conversation.turns, 1);
  } finally {
    restore();
  }
});

test('the turn asks for the ONE field the conversation lacks', async () => {
  const restore = mountConversation();
  try {
    const out = await brain.handle({ owner: 'devsession02', message: 'یک برنامهٔ سرمایه‌گذاری می‌خواهم', locale: 'fa' });
    assert.ok(out.conversation);
    assert.ok(out.conversation.asked, 'the machine asked for a field');
    assert.ok(out.conversation.asked.includes('رشد'), `the machine's own question must travel: ${out.conversation.asked}`);
    assert.deepEqual(out.conversation.missing, ['goal', 'targetReturnPct', 'horizonMonths']);
    assert.ok(out.context.missing.includes('goal'), 'the missing field joins the turn’s own missing list');
  } finally {
    restore();
  }
});

test('a turn whose fields are all present asks nothing', async () => {
  const restore = mountConversation();
  try {
    const out = await brain.handle({ owner: 'devsession03', message: 'برنامهٔ رشد سرمایه می‌خواهم', locale: 'fa' });
    assert.ok(out.conversation);
    assert.equal(out.conversation.asked, null, 'a conversation with its fields asks nothing');
    assert.deepEqual(out.conversation.missing, []);
  } finally {
    restore();
  }
});

test('a turn without the conversation engine still answers', async () => {
  const restore = setConversationProvider(null);
  try {
    const out = await brain.handle({ owner: 'devsession04', message: 'قیمت بیت‌کوین چقدر است؟', locale: 'fa' });
    assert.ok(out, 'the turn must still resolve');
    assert.equal(out.conversation, null, 'there is no conversation to report');
    assert.ok(out.response, 'the reply must still be composed');
  } finally {
    restore();
  }
});

test('the last replan travels with the turn', async () => {
  const restore = setReplanReader(async () => ({
    ok: true,
    replan: {
      trigger: 'RISK_CHANGED',
      family: 'risk',
      label: 'ریسک تغییر کرد',
      at: Date.now(),
      changed: { riskLevel: true, macroImpulse: false, guardianAlert: false },
      impulse: 0.2,
      riskLevel: 'HIGH',
      notify: true,
      recommendation: 'risk moved to HIGH — re-run the decision engine before any new entry',
      executionAuthorized: false
    },
    attempts: []
  }));
  try {
    const out = await brain.handle({ owner: 'devsession05', message: 'وضعیت پرتفوی من چگونه است؟', locale: 'fa' });
    const finding = (out.findings || []).find((f) => f.id === 'event-replan');
    assert.ok(finding, 'the replan must be visible as a finding');
    assert.equal(finding.riskLevel, 'HIGH');
    assert.equal(finding.executionAuthorized, false, 'a replan never authorises an execution');
    assert.ok(finding.detail.includes('HIGH'));
  } finally {
    restore();
  }
});

test('a replan that changed nothing is NOT announced', async () => {
  const restore = setReplanReader(async () => ({
    ok: true,
    replan: {
      trigger: 'PRICE_CHANGED',
      label: 'قیمت تغییر کرد',
      at: Date.now(),
      changed: { riskLevel: false, macroImpulse: false, guardianAlert: false },
      notify: false,
      recommendation: 'nothing crossed a decision-relevant line'
    },
    attempts: []
  }));
  try {
    const out = await brain.handle({ owner: 'devsession06', message: 'وضعیت پرتفوی من چگونه است؟', locale: 'fa' });
    const finding = (out.findings || []).find((f) => f.id === 'event-replan');
    assert.equal(finding, undefined, 'a replan that changed nothing is not a finding');
  } finally {
    restore();
  }
});
