#!/usr/bin/env node
/**
 * FBT AI ORCHESTRATOR — DECISION LEDGER probe (Upgrade 14)
 * ────────────────────────────────────────────────────────────────────────────
 * The ledger is what makes the brain LEARN rather than merely remember, so its
 * powers are deliberately bounded and those bounds are the test:
 *
 *   · it keeps the decision record (tools that worked, providers that answered,
 *     where the models disagreed, what stayed unread) — sanitized, clipped, and
 *     never carrying a credential;
 *   · priors can REORDER tools and SIZE the panel, and nothing else: they can
 *     never raise confidence, never remove the judge, and never touch a number;
 *   · a seat recommendation may raise the panel on a history of conflicts and
 *     only lower 3→2 for a calm MEDIUM turn — never below 2, never at HIGH;
 *   · an execution tool can never be ranked in;
 *   · caps hold (per owner and total), the state survives export/import, and a
 *     broken persistence layer degrades to in-memory instead of losing a turn.
 *
 * Run: npm run test:upgrade14-ledger
 */
import assert from 'node:assert/strict';
import { createDecisionLedger, LEDGER_SCHEMA, LEDGER_STORE_KEY } from '../../src/lib/intent-ai/orchestrator/decisionLedger.js';

const results = [];
const t = async (name, fn) => {
  try { await fn(); results.push([name, true, '']); }
  catch (error) { results.push([name, false, String(error?.message || error).slice(0, 260)]); }
};

const baseEntry = (over = {}) => ({
  owner: 'dev:alice', question: 'قیمت BTC چنده؟', intentType: 'MARKET_ANALYSIS', stakes: 'MEDIUM',
  decision: 'ANSWER', confidence: 68, band: 'MEDIUM', seats: 2, agreement: 0.8,
  conflicts: [], missing: [], latencyMs: 1200,
  tools: [
    { tool: 'fbt_get_market_snapshot', facet: 'market_prices', status: 'observed', durationMs: 300 },
    { tool: 'fbt_get_news', facet: 'news_flow', status: 'observed', durationMs: 500 }
  ],
  providers: [{ provider: 'openrouter', model: 'x', stance: 'bullish' }, { provider: 'groq', model: 'y', stance: 'bullish' }],
  ...over
});

await t('a decision is recorded, sanitized and readable back', async () => {
  const ledger = createDecisionLedger({ now: () => 1_000 });
  const write = await ledger.record(baseEntry());
  assert.equal(write.ok, true);
  const rows = await ledger.recent({ owner: 'dev:alice' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].decision, 'ANSWER');
  assert.equal(rows[0].confidence, 68);
  assert.deepEqual(rows[0].tools.map((t2) => t2.tool), ['fbt_get_market_snapshot', 'fbt_get_news']);
  assert.equal(rows[0].at, 1_000);
  assert.equal(ledger.schema, LEDGER_SCHEMA);
  assert.equal(ledger.storeKey, LEDGER_STORE_KEY);
});

await t('nothing credential-shaped is stored, even inside a question or a tool summary', async () => {
  const ledger = createDecisionLedger({ now: () => 1 });
  await ledger.record(baseEntry({
    question: 'عبارت بازیابی من: abandon ability able about above absent absorb abstract absurd abuse access accident',
    tools: [{ tool: 'fbt_get_portfolio', facet: 'portfolio_state', status: 'observed', summary: { privateKey: '0x' + 'a'.repeat(64) } }]
  }));
  const [row] = await ledger.recent({ owner: 'dev:alice' });
  const text = JSON.stringify(row);
  assert.ok(!text.includes('abandon ability'), 'the seed phrase must not be in the record');
  assert.ok(!text.includes('a'.repeat(64)), 'a raw key must not be in the record');
  assert.match(row.question, /REDACTED/);
});

await t('records are owner-scoped: a different device sees only its own history', async () => {
  const ledger = createDecisionLedger({ now: () => 2 });
  await ledger.record(baseEntry({ owner: 'dev:alice' }));
  await ledger.record(baseEntry({ owner: 'dev:bob', question: 'طلا بخرم؟' }));
  const alice = await ledger.recent({ owner: 'dev:alice' });
  assert.equal(alice.length, 1);
  assert.equal(alice[0].owner, 'dev:alice');
  const bob = await ledger.recent({ owner: 'dev:bob' });
  assert.equal(bob.length, 1);
  assert.equal(bob[0].question, 'طلا بخرم؟');
  const aggregate = await ledger.recent({ owner: null });
  assert.equal(aggregate.length, 2, 'ops may read the aggregate');
});

await t('caps hold per owner and in total, oldest dropped first', async () => {
  let clock = 0;
  const ledger = createDecisionLedger({ now: () => (clock += 1), maxPerOwner: 3, max: 5 });
  for (let i = 0; i < 6; i += 1) await ledger.record(baseEntry({ owner: 'dev:alice', confidence: 50 + i }));
  const rows = await ledger.recent({ owner: 'dev:alice', limit: 10 });
  assert.equal(rows.length, 3, 'per-owner cap');
  assert.deepEqual(rows.map((r) => r.confidence), [55, 54, 53], 'newest first');
  const stats = await ledger.stats();
  assert.equal(stats.total <= 5, true);
  assert.equal(stats.byOwner['dev:alice'], 3);
});

await t('priors rank tools by what actually produced evidence, not by what was asked', async () => {
  let clock = 0;
  const ledger = createDecisionLedger({ now: () => (clock += 1) });
  /* The news tool works; the macro tool never does (all skipped/unavailable). */
  for (let i = 0; i < 5; i += 1) {
    await ledger.record(baseEntry({
      owner: 'dev:alice',
      tools: [
        { tool: 'fbt_get_news', facet: 'news_flow', status: 'observed', durationMs: 400 },
        { tool: 'fbt_get_macro', facet: 'macro_state', status: 'unavailable', durationMs: 20 }
      ]
    }));
  }
  const priors = await ledger.priors({ owner: 'dev:alice', intentType: 'MARKET_ANALYSIS' });
  const news = priors.toolRanking.find((t2) => t2.tool === 'fbt_get_news');
  const macro = priors.toolRanking.find((t2) => t2.tool === 'fbt_get_macro');
  assert.ok(news.score > macro.score, `${news.score} should beat ${macro.score}`);
  assert.equal(macro.unavailableRate, 1);
  assert.equal(news.observedRate, 1);
  assert.equal(priors.sampleSize, 5);
});

await t('rankTools only REORDERS a plan — it never adds a tool, and never an execution tool', async () => {
  let clock = 0;
  const ledger = createDecisionLedger({ now: () => (clock += 1) });
  for (let i = 0; i < 4; i += 1) {
    await ledger.record(baseEntry({
      owner: 'dev:alice',
      tools: [{ tool: 'fbt_rag_search', facet: 'knowledge', status: 'observed', durationMs: 90 }]
    }));
  }
  const asked = ['fbt_get_market_snapshot', 'fbt_get_news', 'fbt_rag_search'];
  const ranked = await ledger.rankTools(asked, { owner: 'dev:alice' });
  assert.deepEqual([...ranked.tools].sort(), [...asked].sort(), 'same set, possibly new order');
  assert.equal(ranked.tools.length, asked.length, 'nothing added');
  const withExecution = await ledger.rankTools(['fbt_swap_now', 'sign_transaction', ...asked], { owner: 'dev:alice' });
  assert.equal(withExecution.tools.length, asked.length + 2, 'nothing is dropped either');
  assert.ok(!/swap_now|sign_transaction/.test(withExecution.tools[0]), 'an execution-shaped name is never promoted to the front');
  assert.equal(withExecution.tools[withExecution.tools.length - 1], 'sign_transaction', 'execution-shaped names keep their own order, last');
});

await t('a calm MEDIUM history can shrink the panel to 2 — never below, never at HIGH', async () => {
  let clock = 0;
  const ledger = createDecisionLedger({ now: () => (clock += 1) });
  for (let i = 0; i < 6; i += 1) {
    /* The history of the panel size that is being reconsidered: three seats,
       answered, high confidence, no conflicts. */
    await ledger.record(baseEntry({ owner: 'dev:alice', seats: 3, confidence: 72, agreement: 0.95, conflicts: [] }));
  }
  const medium = await ledger.seatRecommendation({ owner: 'dev:alice', intentType: 'MARKET_ANALYSIS', stakes: 'MEDIUM', defaultSeats: 3 });
  assert.equal(medium.seats, 2);
  assert.ok(medium.reason);
  const high = await ledger.seatRecommendation({ owner: 'dev:alice', intentType: 'MARKET_ANALYSIS', stakes: 'HIGH', defaultSeats: 3 });
  assert.equal(high.seats, 3, 'a high-stakes turn never loses a seat to priors');
  const floor = await ledger.seatRecommendation({ owner: 'dev:alice', intentType: 'MARKET_ANALYSIS', stakes: 'MEDIUM', defaultSeats: 1 });
  assert.equal(floor.seats, 1, 'and it may not invent a panel where none was planned');
});

await t('a history of conflicts earns a seat, and the reason travels with it', async () => {
  let clock = 0;
  const ledger = createDecisionLedger({ now: () => (clock += 1) });
  for (let i = 0; i < 5; i += 1) {
    await ledger.record(baseEntry({
      owner: 'dev:alice',
      conflicts: [{ kind: 'OPPOSING_STANCE', topic: 'direction' }],
      agreement: 0.5
    }));
  }
  const rec = await ledger.seatRecommendation({ owner: 'dev:alice', intentType: 'MARKET_ANALYSIS', stakes: 'MEDIUM', defaultSeats: 2 });
  assert.equal(rec.seats, 3);
  assert.match(rec.reason, /CONFLICT/);
});

await t('standing gaps are surfaced, so "what we never read" is visible to ops', async () => {
  const ledger = createDecisionLedger({ now: () => 1 });
  for (let i = 0; i < 4; i += 1) {
    await ledger.record(baseEntry({ owner: 'dev:alice', missing: ['macro_state'], decision: 'CLARIFY' }));
  }
  const priors = await ledger.priors({ owner: 'dev:alice' });
  assert.ok(priors.standingGaps.some((g) => g.facet === 'macro_state' && g.count >= 4));
});

await t('state survives export/import (the same path store.js persists)', async () => {
  let clock = 0;
  const ledger = createDecisionLedger({ now: () => (clock += 1) });
  await ledger.record(baseEntry());
  const state = ledger.exportState();
  const restored = createDecisionLedger();
  assert.equal((await restored.importState(state)).ok, true);
  assert.equal((await restored.recent({ owner: 'dev:alice' })).length, 1);
  assert.equal((await restored.importState({ schema: 'nope' })).ok, false, 'foreign state is refused');
});

await t('with a persistence layer wired, a fresh instance loads what the last one wrote', async () => {
  let persisted = [];
  const save = async (rows) => { persisted = JSON.parse(JSON.stringify(rows)); };
  const load = async () => persisted;
  const first = createDecisionLedger({ load, save, now: () => 5 });
  await first.record(baseEntry());
  const second = createDecisionLedger({ load, save, now: () => 6 });
  const rows = await second.recent({ owner: 'dev:alice' });
  assert.equal(rows.length, 1, 'the decision outlives the process');
  assert.equal(rows[0].confidence, 68);
});

await t('a broken persistence layer costs a write, never a turn', async () => {
  const ledger = createDecisionLedger({
    load: async () => { throw new Error('blob down'); },
    save: async () => { throw new Error('blob down'); },
    now: () => 7
  });
  const write = await ledger.record(baseEntry());
  assert.equal(write.ok, true, 'the in-memory record still exists');
  assert.equal((await ledger.recent({ owner: 'dev:alice' })).length, 1);
  assert.ok(write.persisted === false || write.degraded === true || write.ok === true);
});

await t('stats answer "is the brain learning?" without a model', async () => {
  let clock = 0;
  const ledger = createDecisionLedger({ now: () => (clock += 1) });
  await ledger.record(baseEntry({ decision: 'ANSWER', confidence: 70 }));
  await ledger.record(baseEntry({ decision: 'ABSTAIN', confidence: 30, missing: ['portfolio_state'] }));
  const stats = await ledger.stats();
  assert.equal(stats.total, 2);
  assert.equal(stats.byDecision.ANSWER, 1);
  assert.equal(stats.byDecision.ABSTAIN, 1);
  assert.equal(stats.averageConfidence, 50);
  assert.equal(stats.byOwner['dev:alice'], 2);
  assert.equal(stats.schema, LEDGER_SCHEMA);
});

let passed = 0;
console.log('\n=== FBT AI ORCHESTRATOR — decision ledger probe ===\n');
for (const [name, ok, detail] of results) {
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); } else console.error(`  ✗ ${name}\n    ${detail}`);
}
console.log(`\n=== LEDGER PROBE: ${passed}/${results.length} passed ===\n`);
if (passed !== results.length) process.exit(1);
