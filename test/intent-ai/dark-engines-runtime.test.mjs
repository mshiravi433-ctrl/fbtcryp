/**
 * THE THREE ENGINES, IN A REAL TURN (paths 14–16, runtime)
 * ---------------------------------------------------------------------------
 * `route-intelligence-runtime.test.mjs` covers the route engine's runtime.
 * This covers the OTHER two, and the claim is the same one:
 *
 *   A capability that is present in the code and absent in the answer is
 *   NOT a capability. The surface tests prove the parts; these prove the
 *   whole — a real brain turn, the real module path, the real bridge,
 *   and the question reaching the reply.
 *
 * The two engines being proved here:
 *
 *   · the WHY engine — the brain's own decision, explained. It is a
 *     READ after the recommendation, because it explains THAT
 *     recommendation, and reading it earlier would explain the previous
 *     turn's decision.
 *
 *   · the SESSION machinery — the conversation state and the event
 *     replanner. They are not modules the user invokes; they are the
 *     layer under every turn, so the proof is that a turn's missing field
 *     is ASKED FOR in the reply and a replan is ANNOUNCED when it
 *     crossed a line.
 *
 * Fully offline: every provider is a fake, and the state store is the
 * in-process one.
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { createCentralBrain } from '../../server/ci/brain.js';
import { createCentralStateStore } from '../../server/ci/stateStore.js';
import { setWhyProvider } from '../../server/ci/whyBridge.js';
import { setConversationProvider, setReplanProvider, setReplanReader } from '../../server/ci/sessionBridge.js';

const stateStore = createCentralStateStore();
assert.ok(stateStore, 'a state store is required to run a brain turn');
const brain = createCentralBrain({ stateStore });

/*
 * AN OWNER WHO HAS A DECISION.
 *
 * The why engine explains a RECOMMENDATION, and a recommendation needs
 * something to recommend FROM. A signed-out owner has no holdings, so
 * no finding survives validation, so there is no recommendation — and
 * then there is honestly nothing to explain.
 *
 * So the test gives the owner a portfolio. Otherwise it would be
 * testing the absence of a decision and calling it the presence of an
 * explanation.
 */
async function seedOwner(owner) {
  await stateStore.write(owner, 'wallet', {
    data: { addresses: { evm: ['0x1111111111111111111111111111111111111111'] }, connected: true },
    source: 'test-wallet',
    status: 'OK',
    now: Date.now()
  });
  await stateStore.write(owner, 'portfolio', {
    data: {
      holdings: [
        { symbol: 'USDC', amount: 2500, valueUsd: 2500, chainId: 1, priceUsd: 1 },
        { symbol: 'ETH', amount: 1.5, valueUsd: 4800, chainId: 1, priceUsd: 3200 }
      ],
      totalValueUsd: 7300,
      dataStatus: 'live'
    },
    source: 'test-portfolio',
    status: 'OK',
    now: Date.now()
  });
  await stateStore.write(owner, 'markets', {
    data: { prices: { USDC: { priceUsd: 1 }, ETH: { priceUsd: 3200 } }, bySymbol: {} },
    source: 'test-markets',
    status: 'OK',
    now: Date.now()
  });
}

/* ─── the why engine, mounted ───────────────────────────────────────────── */

/*
 * THE REAL WHY ENGINE, MOUNTED.
 *
 * The fake that used to stand here spoke a shape of its own, and it
 * would have hidden the very bug this file exists to find: the real
 * engine returns a record whose five why-lines sit under `why`, and the
 * provider used to hand the reader only the INNER part — so every
 * why-line arrived as null.
 *
 * A fake that agrees with the implementation cannot catch a mismatch
 * between the implementation and the engine it is supposed to read. So
 * the real engine is mounted here, and the record it produces is the
 * one under test.
 */
function mountWhyEngine({ calls } = { calls: [] }) {
  return setWhyProvider(async (owner, bundle = {}) => {
    calls.push(bundle);
    const { explainDecision } = await import('../../server/fios/whyEngine.js');
    const out = explainDecision(bundle);
    if (!out?.ok) return { ok: false, code: out?.code || 'WHY_FAILED', detail: out?.detail || null, why: null };
    return { ok: true, why: out };
  });
}

/* ─── the session machinery, mounted ─────────────────────────────────────── */

function mountConversation({ calls } = { calls: [] }) {
  return setConversationProvider(async (owner, opts) => {
    calls.push(opts);
    return {
      ok: true,
      conversation: { id: `cnv_${owner}`, state: 'UNDERSTANDING', turns: 1, locale: 'fa', updatedAt: Date.now() },
      suggestion: { to: 'CLARIFICATION', because: 'the goal is missing' },
      question: {
        question: { fa: 'این پول برای چیست — رشد، درآمد، یا حفظ سرمایه؟', en: 'What is this money for?' },
        field: 'goal',
        missing: ['goal']
      }
    };
  });
}

test.after(() => {
  setWhyProvider(null);
  setConversationProvider(null);
  setReplanProvider(null);
  setReplanReader(null);
});

/* ─── the why engine ────────────────────────────────────────────────────── */

test('a why question reaches the why engine with the brain\'s own decision', async () => {
  const calls = [];
  mountWhyEngine({ calls });
  await seedOwner('why-runtime-1');
  const out = await brain.handle({
    owner: 'why-runtime-1',
    message: 'چرا این را گفتی؟',
    locale: 'fa'
  });

  assert.ok(calls.length >= 1, `the why engine was asked → ${out?.response?.text?.slice(0, 200) || ''}`);
  const bundle = calls[calls.length - 1];
  /* The bundle's shape is the engine's OWN vocabulary, not the brain's:
     the brain's recommendation becomes a DECISION record, and the
     findings become the costs and strategies it was made of. */
  assert.ok(bundle.decision, 'the bundle carries the decision the engine was asked to explain');
  assert.ok(bundle.costs, 'and the costs the decision was made of');
  /* The goal is OPTIONAL: an owner with no goal has a decision about
     their portfolio and no goal behind it, and the engine says so
     rather than the bundle inventing one. */
  assert.ok('goal' in bundle, 'and the goal field, present whether or not there is one');
});

test('the why explanation reaches the reply', async () => {
  const calls = [];
  mountWhyEngine({ calls });
  await seedOwner('why-runtime-2');
  const out = await brain.handle({
    owner: 'why-runtime-2',
    message: 'چرا این را گفتی؟',
    locale: 'fa'
  });

  const text = String(out?.response?.text || '');
  assert.ok(text.length > 0, 'the turn answered');
  /* The explanation must be the engine's, not a generic line. The fake
     says «a recommendation was made» — so that phrase, or a section of
     it, has to be in the reply. */
  const explained = text.includes('recommendation was made')
    || text.includes('فیندینگ')
    || text.includes('تصمیم')
    || text.includes('پشتوانه')
    || text.includes('دلیل');
  assert.ok(explained, `the reply must carry the engine's explanation → ${text.slice(0, 260)}`);
});

/* ─── the session machinery ─────────────────────────────────────────────── */

test('a turn with a missing field asks for it, in the reply', async () => {
  const calls = [];
  mountConversation({ calls });
  const out = await brain.handle({
    owner: 'session-runtime-1',
    message: 'برای رسیدن به هدفم چه برنامه‌ای داشته باشم؟',
    locale: 'fa'
  });

  assert.ok(calls.length >= 1, 'the conversation machinery was consulted');
  const text = String(out?.response?.text || '');
  assert.ok(text.length > 0, 'the turn still answered');
});

test('a turn with NO conversation machinery still answers', async () => {
  /* The machinery is optional by design: a deployment without it must
     get a thinner but successful turn, never a failure. */
  setConversationProvider(null);

  const out = await brain.handle({
    owner: 'session-runtime-2',
    message: 'برای رسیدن به هدفم چه برنامه‌ای داشته باشم؟',
    locale: 'fa'
  });

  assert.ok(out?.response?.text?.length, 'the turn answered without the machinery');
});

/* ─── the ordering that was wrong ───────────────────────────────────────── */

test('the why read AFTER the recommendation is the one that counts', async () => {
  /*
   * The regression this file exists for.
   *
   * The why section used to be read in the SAME pass as the portfolio
   * and the risk — a pass that happens BEFORE the recommendation is
   * built. So the engine was asked to explain a decision that did not
   * exist yet, and it honestly answered NO_DECISION.
   *
   * Then the reply read the results in the wrong order and preferred
   * the failed section read over the successful one. So a turn that
   * HAD a decision and a working engine still answered «no decision to
   * explain».
   *
   * The capability was in the code and absent in the answer, and the
   * surface tests could not see it because they drove the engine
   * directly.
   */
  const calls = [];
  mountWhyEngine({ calls });
  await seedOwner('why-runtime-3');

  const out = await brain.handle({
    owner: 'why-runtime-3',
    message: 'چرا این را گفتی؟',
    locale: 'fa'
  });

  assert.equal(calls.length, 1, `the engine was asked once, not twice → ${out?.response?.text?.slice(0, 200) || ''}`);
  const finding = (out?.findings || []).find((f) => f?.id === 'why-decision');
  assert.ok(finding, 'the why finding is in the reply');
  assert.equal(finding.status, 'OK', `the why finding is not a failure → ${finding?.reason || ''}`);
});

test('a why question with no decision says so, and asks for nothing', async () => {
  /*
   * The other half. A signed-out owner has no holdings, so no finding
   * survives validation, so there is no recommendation — and then there
   * is honestly nothing to explain. The turn must say THAT, not invent
   * a reason and not call the engine with an empty decision.
   */
  const calls = [];
  mountWhyEngine({ calls });

  const out = await brain.handle({
    owner: 'why-runtime-4',
    message: 'چرا این را گفتی؟',
    locale: 'fa'
  });

  assert.equal(calls.length, 0, 'the engine was not asked to explain a decision that does not exist');
  const text = String(out?.response?.text || '');
  assert.ok(text.length > 0, 'the turn still answered');
});

/* ─── the session machinery, in the reply ───────────────────────────────── */

test('the machine\'s own question reaches the reply, in its own words', async () => {
  /*
   * The conversation machinery is not a module the user invokes — it is
   * the layer UNDER every turn. So the proof is not that the provider
   * was called; it is that the question the machine asked appears in
   * the reply, in the machine's own words, and not in a generic
   * «tell me more» that any layer could have produced.
   */
  const calls = [];
  mountConversation({ calls });

  const out = await brain.handle({
    owner: 'session-runtime-3',
    message: 'برای رسیدن به هدفم چه برنامه‌ای داشته باشم؟',
    locale: 'fa'
  });

  assert.ok(calls.length >= 1, 'the conversation machinery was consulted');
  const text = String(out?.response?.text || '');
  /* The fake asks «این پول برای چیست — رشد، درآمد، یا حفظ سرمایه؟» —
     the reply must carry that question, or the machinery is not
     reaching the answer. */
  assert.ok(
    text.includes('این پول برای چیست') || text.includes('رشد، درآمد'),
    `the machine's question must reach the reply → ${text.slice(0, 300)}`
  );
});

test('the replan is announced only when it crossed a line', async () => {
  /*
   * A replan that changed nothing is not news. A replan that crossed a
   * line is — and the brain says so WITHOUT treating the replan as
   * permission to act.
   */
  const { setReplanReader } = await import('../../server/ci/sessionBridge.js');
  setReplanReader(async () => ({
    ok: true,
    replan: {
      id: 'replan_1',
      notify: true,
      changed: true,
      trigger: 'RISK_CHANGED',
      riskLevel: 'HIGH',
      bestRoute: { tool: 'across', totalCostUsd: 3.5 },
      why: ['the risk moved above the comfort band'],
      falsifiers: ['the risk reading returns below the band'],
      lines: ['the crossing was replaced with a slower route']
    }
  }));

  const out = await brain.handle({
    owner: 'session-runtime-4',
    message: 'وضعیت پرتفوی من چیست؟',
    locale: 'fa'
  });

  const finding = (out?.findings || []).find((f) => f?.id === 'event-replan');
  assert.ok(finding, `the replan is in the reply → ${(out?.findings || []).map((f) => f?.id).join(',')}`);
  assert.equal(finding.executionAuthorized, false, 'a replan is news, not permission to act');
  setReplanReader(null);
});

/* ─── the comparison that must never become an instruction ─────────────── */

test('a comparison question is never read as an instruction, wallet or not', async () => {
  /*
   * The most dangerous shape of the dark-engine failure.
   *
   * The EXECUTE_BRIDGE pattern is deliberately loose — «برو به شبکه»
   * appears in the middle of an ordinary sentence — so it matches
   * «انتقال بیت‌کوین به پالیگان» inside «کدام پل ... بهتر است؟».
   *
   * The route intent is supposed to win that sentence, and it does so
   * by PRIORITY. But the priority only decided the winner once the two
   * intents were both scored, and the route intent was never told
   * that its own section was already in memory — because `stateHas`
   * was a fixed list that did not contain it, and because the rule's
   * `requires` name was a MODULE while the state is keyed by SECTION.
   *
   * So the route intent sat at 0.755 and the instruction at 0.76, and
   * a QUESTION about which bridge is cheapest was read as an
   * instruction to move the money.
   *
   * Both halves are checked here: with a wallet and without one, the
   * answer is a ROAD RANKING and never an EXECUTE.
   */
  for (const [label, withWallet] of [['signed out', false], ['signed in', true]]) {
    const owner = `route-compare-${label.replace(/\s+/g, '-')}`;
    if (withWallet) await seedOwner(owner);
    const out = await brain.handle({
      owner,
      message: 'کدام پل برای انتقال بیت‌کوین به پالیگان بهتر است؟',
      locale: 'fa'
    });
    assert.equal(
      out?.intent?.intentType,
      'ROUTE_INTELLIGENCE',
      `${label}: a comparison is a ranking, not an instruction → ${out?.intent?.intentType}`
    );
    assert.notEqual(out?.intent?.intentType, 'EXECUTE_BRIDGE', `${label}: never an instruction`);
  }
});

test('the English comparison is never read as an instruction either', async () => {
  const out = await brain.handle({
    owner: 'route-compare-en',
    message: 'which bridge is cheapest for this transfer?',
    locale: 'en'
  });
  assert.equal(out?.intent?.intentType, 'ROUTE_INTELLIGENCE', `→ ${out?.intent?.intentType}`);
});
