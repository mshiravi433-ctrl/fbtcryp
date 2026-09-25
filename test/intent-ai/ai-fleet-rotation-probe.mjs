/**
 * FBT INTENT AI — AI FLEET ROTATION & DIVERSITY PROBE
 * ---------------------------------------------------------------------------
 * Regression probe for the "the whole fleet must actually be active in the
 * Intent OS" fix. Previously the collaboration engine re-picked the SAME
 * top-priority provider (OpenRouter) for every analysis role, so a "multi-AI"
 * answer was really one model — the other registered providers showed ACTIVE
 * in the panel but never ran. This probe locks in the corrected behaviour:
 *
 *   1. All nine registered providers (8 external + internal) report ACTIVE
 *      when their keys are configured.
 *   2. A multi-model question is answered by DISTINCT providers — no role
 *      re-uses the same model as its neighbour.
 *   3. The round-robin makes the WHOLE fleet take turns holding the primary
 *      seat across a session (8 successive questions → 8 different leads).
 *   4. Failover: a down provider is still tried, then the next provider
 *      answers — the answer is attributed to a healthy model, never the dead one.
 *
 * Fully offline: no real network. The production routing path (fleet + seat,
 * NOT the injected selectProviders test path) is exercised by injecting a
 * recording `deps.execute` and stubbing `deps.research`, while the env keys
 * are set so the gateway sees a fully-configured fleet.
 */

import assert from 'node:assert/strict';

/* Set a fully-configured fleet BEFORE the gateway is consulted. */
const PROVIDER_ENV = {
  OPENROUTER_API_KEY: 'sk-or-test',
  GROQ_API_KEY: 'gsk-test',
  GEMINI_API_KEY: 'gem-test',
  ANTHROPIC_API_KEY: 'ant-test',
  DEEPSEEK_API_KEY: 'ds-test',
  MISTRAL_API_KEY: 'mi-test',
  CLOUDFLARE_API_TOKEN: 'cf-test',
  CLOUDFLARE_ACCOUNT_ID: 'acct-test',
  AIMLAPI_KEY: 'aiml-test'
};
const ALL_EXTERNAL = ['openrouter', 'groq', 'gemini', 'anthropic', 'deepseek', 'mistral', 'workersai', 'aimlapi'];
const ALL_NINE = [...ALL_EXTERNAL, 'internal'];

const savedEnv = {};
for (const [k, v] of Object.entries(PROVIDER_ENV)) {
  savedEnv[k] = process.env[k];
  process.env[k] = v;
}

const { getActiveProviderIds } = await import('../../server/aiGateway.js');
const {
  runCollaborativeAnalysis,
  resetFleetCursor,
  resetProviderHealth
} = await import('../../server/aiCollaboration.js');

let totalTests = 0;
let passedTests = 0;
async function atest(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    throw err;
  }
}

/** A recording provider that stands in for the real HTTP call. */
function makeFleet({ fail = new Set() } = {}) {
  const calls = [];
  const execute = async (providerId) => {
    calls.push(providerId);
    if (fail.has(providerId)) throw new Error(`NO_RESPONSE:${providerId}`);
    return {
      provider: providerId,
      model: `model-${providerId}`,
      text: JSON.stringify({ answer: `ANS from ${providerId}`, claims: [], uncertainty: '' }),
      durationMs: 1
    };
  };
  return { execute, calls, research: async () => null };
}

const MARKET_Q = 'analyze bitcoin momentum and the main risks right now';
const MARKET_CTX = { market: { priceMap: { BTC: 63450 }, change24hPct: 1.2, dataStatus: 'live' } };

async function runAll() {
  console.log('\n--- AI Fleet Rotation & Diversity ---');

  await atest('all nine registered providers report ACTIVE when configured', () => {
    const active = getActiveProviderIds();
    for (const id of ALL_NINE) assert.ok(active.includes(id), `missing active provider ${id}`);
    assert.equal(active.length, ALL_NINE.length, 'unexpected extra providers');
  });

  await atest('a multi-model question is answered by DISTINCT providers (no model re-used)', async () => {
    resetFleetCursor();
    resetProviderHealth();
    const fleet = makeFleet();
    const r = await runCollaborativeAnalysis({ message: MARKET_Q, locale: 'en', context: MARKET_CTX, deps: fleet });
    assert.equal(r.degraded, false, 'should not degrade with a healthy fleet');
    assert.ok(r.providersUsed.length >= 2, `expected >=2 providers, got ${JSON.stringify(r.providersUsed)}`);
    assert.equal(new Set(r.providersUsed).size, r.providersUsed.length,
      `providers are not distinct: ${JSON.stringify(r.providersUsed)}`);
  });

  await atest('the round-robin gives every one of the 8 external providers the lead', async () => {
    resetFleetCursor();
    resetProviderHealth();
    const fleet = makeFleet();
    const leads = [];
    for (let i = 0; i < ALL_EXTERNAL.length; i++) {
      const r = await runCollaborativeAnalysis({ message: MARKET_Q, locale: 'en', context: MARKET_CTX, deps: fleet });
      assert.equal(r.degraded, false, `run ${i} degraded unexpectedly`);
      leads.push(r.providersUsed[0]);
    }
    assert.equal(new Set(leads).size, ALL_EXTERNAL.length,
      `expected ${ALL_EXTERNAL.length} distinct leads, got ${JSON.stringify(leads)}`);
    for (const p of ALL_EXTERNAL) assert.ok(leads.includes(p), `provider ${p} never held the lead`);
  });

  await atest('failover: a down provider is tried, then a healthy provider answers', async () => {
    resetFleetCursor();
    resetProviderHealth();
    const lead = getActiveProviderIds().filter((p) => p !== 'internal')[0];
    const fleet = makeFleet({ fail: new Set([lead]) });
    const r = await runCollaborativeAnalysis({ message: MARKET_Q, locale: 'en', context: MARKET_CTX, deps: fleet });
    assert.ok(fleet.calls.includes(lead), `the down provider (${lead}) should still be tried`);
    assert.equal(r.degraded, false, 'a healthy fleet must not degrade');
    assert.ok(r.providersUsed.length >= 1, 'a healthy provider must answer');
    assert.ok(!r.providersUsed.includes(lead), `the down provider (${lead}) must not be in the answer`);
    assert.ok(!String(r.answer).startsWith(`ANS from ${lead}`), 'answer must not come from the dead provider');
  });

  await atest('execution authority is never granted by the fleet (honesty law)', async () => {
    resetFleetCursor();
    const fleet = makeFleet();
    const r = await runCollaborativeAnalysis({ message: MARKET_Q, locale: 'en', context: MARKET_CTX, deps: fleet });
    assert.equal(r.degraded, false);
    /* The collaboration result carries no signing/execution authority. */
    assert.equal(r.schema, 'fbt.ai-collaboration.v1');
    assert.ok(!('canSign' in r) || r.canSign !== true);
  });

  console.log(`\n=== AI FLEET ROTATION PROBE RESULT: ${passedTests}/${totalTests} passed ===\n`);
}

runAll()
  .then(() => {
    restoreEnv();
    if (passedTests !== totalTests) process.exit(1);
    process.exit(0);
  })
  .catch((err) => {
    restoreEnv();
    console.error(`\nAI FLEET ROTATION PROBE FAILED: ${err.message}\n`);
    process.exit(1);
  });

function restoreEnv() {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}
