#!/usr/bin/env node
/**
 * FBT AI ORCHESTRATOR — END-TO-END PANEL probe (Upgrade 14)
 * ────────────────────────────────────────────────────────────────────────────
 * The whole brain, one turn, with every external dependency faked so the
 * behaviour under test is the graph's, not a provider's:
 *
 *   plan ─▶ gather ─▶ analyze ─▶ judge ─▶ decide ─▶ learn
 *
 * What is proven here — offline, deterministic, no network:
 *   · the plan decides which tools to read and HOW MANY models to seat, and the
 *     seats actually used match the plan;
 *   · every number in a shipped answer traces to a tool row; a model sentence
 *     with an invented number is penalised and, where the topic is tool-truth,
 *     refused outright;
 *   · disagreement is detected, preserved as dissent and lowers confidence;
 *   · with no provider configured the turn still produces a real, evidence-only
 *     answer instead of failing;
 *   · a hanging tool or a hanging model is cut by the turn deadline and the
 *     caller still gets a result (the graph degrades, it does not die);
 *   · an execution-intent message plans READS only — `canExecute` is false all
 *     the way through, including in the ledger;
 *   · learning actually happens: the ledger gets the decision, history can
 *     re-order tools and earn a seat, and neither can raise confidence;
 *   · a credential in the question never reaches a seat prompt.
 *
 * Run: npm run test:upgrade14-panel
 */
import assert from 'node:assert/strict';
import { createOrchestrator, ORCHESTRATOR_SCHEMA, buildSeatPrompt } from '../../server/aiOrchestrator.js';
import { buildEvidencePlan } from '../../src/lib/intent-ai/orchestrator/evidencePlan.js';
import { judge as defaultJudge, renderJudgment } from '../../src/lib/intent-ai/orchestrator/judge.js';

const results = [];
const t = async (name, fn) => {
  try { await fn(); results.push([name, true, '']); }
  catch (error) { results.push([name, false, String(error?.message || error).slice(0, 260)]); }
};

const marketRows = [
  { facetId: 'market_prices', tool: 'fbt_get_market_snapshot', status: 'observed', summary: { rows: [{ symbol: 'BTC', priceUsd: 63250.5, change24hPct: 1.8 }] }, provenance: { tool: 'fbt_get_market_snapshot' } },
  { facetId: 'asset_regime', tool: 'fbt_get_signals', status: 'observed', summary: { asset: 'BTC', momentum: 'up', volatility: 'medium', change24hPct: 1.8 }, provenance: { tool: 'fbt_get_signals' } },
  { facetId: 'news_flow', tool: 'fbt_get_news', status: 'observed', summary: { items: [{ title: 'ETF inflows continue', source: 'fbt' }] }, provenance: { tool: 'fbt_get_news' } }
];

const seatJson = ({ summary, stance = 'neutral', confidence = 0.7, claims = [] }) =>
  JSON.stringify({ summary, stance, confidence, claims, used_evidence: ['market_prices'], limits: [] });

function makeLedger(overrides = {}) {
  const entries = [];
  return {
    entries,
    async rankTools(tools) { return overrides.rankTools ? overrides.rankTools(tools) : { reordered: false, tools, priors: { sample: 0 } }; },
    async seatRecommendation({ defaultSeats }) { return overrides.seatRecommendation ? overrides.seatRecommendation({ defaultSeats }) : { seats: defaultSeats, reason: 'NO_HISTORY' }; },
    async record(entry) { entries.push(entry); return { ok: true }; },
    async recent() { return entries.slice(-5); },
    async stats() { return { total: entries.length }; }
  };
}

function makeHarness({ rows = marketRows, models = null, ledger = makeLedger(), ragOverrides = {}, providers = ['openrouter', 'groq', 'gemini'] } = {}) {
  const calls = { gather: [], models: [], remembered: [], decisions: [] };
  const deps = {
    planEvidence: buildEvidencePlan,
    async gather(args) {
      calls.gather.push(args);
      const out = typeof rows === 'function' ? await rows(args) : { ok: true, rows, observed: rows.filter((r) => r.status === 'observed').length, executed: rows.length, degraded: 0, unavailable: rows.filter((r) => r.status === 'unavailable').length, skipped: 0, readOnly: true, canExecute: false };
      return out;
    },
    rag: {
      async recall() { return { ok: true, passages: [{ cite: 'kb.swap.howto', title: 'سواپ', text: 'کارمزد سواپ بخشی از مبلغ معامله است.', score: 0.8, kind: 'knowledge' }] }; },
      async remember(args) { calls.remembered.push(args); return { ok: true }; },
      async stats() { return { knowledgePoints: 10, memoryPoints: calls.remembered.length, backend: 'local' }; },
      ...ragOverrides
    },
    ledger,
    judge: defaultJudge,
    render: renderJudgment,
    async recordDecision(d) { calls.decisions.push(d); return { ok: true }; },
    providers: () => providers,
    preferredFor: () => providers.slice(0, 2),
    isHealthy: () => true,
    callModel: models || (async (provider, params) => {
      calls.models.push({ provider, params });
      return { provider, model: `${provider}-x`, text: seatJson({ summary: 'قیمت BTC حدود ۶۳٬۲۵۰ دلار است و روند کوتاه‌مدت صعودی است؛ این عدد از خوانش زندهٔ بازار می‌آید.', stance: 'bullish', claims: [{ text: 'قیمت BTC 63250 دلار است', kind: 'number' }] }) };
    }),
    now: Date.now
  };
  return { deps, calls, ledger };
}

/* ── 1. the happy path: plan → tools → seats → judge → answer → learning ── */

await t('a market turn reads the planned tools, seats the planned models and answers', async () => {
  const { deps, calls, ledger } = makeHarness();
  const o = createOrchestrator({ deps, deadlineMs: 8000 });
  const out = await o.run({ message: 'قیمت بیت‌کوین الان چنده؟', intentType: 'MARKET_ANALYSIS', owner: 'dev:probe', locale: 'fa' });

  assert.equal(out.ok, true, `expected a usable answer: ${JSON.stringify(out.answer)}`);
  assert.equal(out.answerSource, 'panel+judge');
  assert.equal(out.decision, 'ANSWER');
  assert.ok(out.confidence >= 50, `confidence ${out.confidence}`);
  assert.equal(out.schema, ORCHESTRATOR_SCHEMA);

  /* the plan drove the work: the tools it asked for are the tools called */
  const requested = out.plan.facets.requests.map((r) => r.tool);
  assert.deepEqual(calls.gather[0].requests.map((r) => r.tool), requested);
  assert.equal(out.plan.analysis.seats, calls.models.length, 'the seats planned are the seats used');
  assert.ok(out.answer.includes('۶۳٬۲۵۰') || out.answer.includes('63,250'));

  /* the answer carries the read, not the model's word for it */
  assert.ok(out.answer.includes('market_prices:fbt_get_market_snapshot'));
  assert.equal(out.permissions.canExecute, false);

  /* learning: ledger + memory + trace */
  assert.equal(out.learning.ledgerWritten, true);
  assert.equal(ledger.entries.length, 1);
  assert.equal(ledger.entries[0].decision, 'ANSWER');
  assert.ok(ledger.entries[0].tools.length >= 1);
  assert.equal(calls.remembered.length, 1);
  assert.deepEqual(out.trace.map((r) => r.node), ['plan', 'gather', 'analyze', 'judge', 'decide', 'learn']);
  assert.ok(out.trace.every((r) => r.ok !== false));
});

/* ── 2. tool truth: no wallet read → no invented balance ───────────────── */

await t('a portfolio question with an unavailable wallet read abstains — the invented number never ships', async () => {
  const rows = [{ facetId: 'portfolio_state', tool: 'fbt_get_portfolio', status: 'unavailable', error: 'CAPABILITY_UNAVAILABLE' }];
  const models = async (provider) => ({
    provider,
    text: seatJson({ summary: 'ارزش کل دارایی شما ۱۲٬۴۰۰ دلار است که بیشتر آن در ETH و SOL نگه داشته شده و رشد خوبی داشته.', stance: 'bullish' })
  });
  const { deps } = makeHarness({ rows, models });
  const o = createOrchestrator({ deps, deadlineMs: 6000 });
  const out = await o.run({ message: 'کل دارایی‌هام چقدره؟', intentType: 'PORTFOLIO_ANALYSIS', owner: 'dev:probe', locale: 'fa' });

  assert.equal(out.decision, 'ABSTAIN');
  assert.ok(out.judgment.why.some((w) => w.startsWith('TOOL_TRUTH_REQUIRED')));
  assert.equal(out.answer, null, 'nothing usable may be returned');
  assert.equal(out.ok, false);
  assert.ok(out.limits.some((l) => l.code === 'MISSING_FACETS'));
});

/* ── 3. disagreement is found and kept ─────────────────────────────────── */

await t('two models in opposite directions are a recorded conflict that costs confidence', async () => {
  const bull = async (provider) => ({ provider, text: seatJson({ summary: 'روند BTC صعودی است و خریداران قوی‌تر شده‌اند؛ ادامهٔ رشد در این بازه منطقی است و ۶۳٬۲۵۰ دلار سطح فعلی است.', stance: 'bullish', confidence: 0.8 }) });
  const bear = async (provider) => ({ provider, text: seatJson({ summary: 'روند BTC نزولی است و فشار فروش بیشتر شده؛ ادامهٔ ریزش در این بازه منطقی است و ۶۳٬۲۵۰ دلار سطح فعلی است.', stance: 'bearish', confidence: 0.7 }) });

  const split = makeHarness({ models: async (provider) => (provider === 'openrouter' ? bull(provider) : bear(provider)) });
  const agreeing = makeHarness({ models: bull });
  const splitOut = await createOrchestrator({ deps: split.deps, deadlineMs: 8000 }).run({ message: 'وضعیت بیت‌کوین چطوره؟', intentType: 'MARKET_ANALYSIS', owner: 'dev:probe' });
  const agreeOut = await createOrchestrator({ deps: agreeing.deps, deadlineMs: 8000 }).run({ message: 'وضعیت بیت‌کوین چطوره؟', intentType: 'MARKET_ANALYSIS', owner: 'dev:probe' });

  assert.ok(splitOut.conflicts.some((c) => c.kind === 'OPPOSING_STANCE'), JSON.stringify(splitOut.conflicts));
  assert.equal(splitOut.dissent.length >= 1, true, 'the losing seat is preserved');
  assert.ok(splitOut.confidence < agreeOut.confidence, `${splitOut.confidence} should be < ${agreeOut.confidence}`);
  assert.ok(splitOut.judgment.whatWouldChangeMyMind.some((w) => w.code === 'CONFLICT_RESOLVED'));
});

/* ── 4. no provider → still an answer ─────────────────────────────────── */

await t('with no provider configured the turn answers from the tool read alone', async () => {
  const { deps, calls } = makeHarness({ providers: [] });
  const o = createOrchestrator({ deps, deadlineMs: 5000 });
  const out = await o.run({ message: 'قیمت بیت‌کوین الان چنده؟', intentType: 'MARKET_ANALYSIS', owner: 'dev:probe', locale: 'fa' });
  assert.equal(calls.models.length, 0, 'no model may be called without a provider');
  assert.equal(out.answerSource, 'evidence-only');
  assert.ok(out.answer && out.answer.includes('۶۳٬۲۵۰'), `evidence-only answer should carry the read price: ${out.answer}`);
  assert.equal(out.ok, true);
  assert.equal(out.plan.analysis.seats, 0);
});

/* ── 5. the deadline is a real ceiling ────────────────────────────────── */

await t('a hanging tool is cut by the turn deadline and the caller still gets a result', async () => {
  const hang = () => new Promise(() => {});
  const { deps, calls } = makeHarness({ rows: hang });
  const o = createOrchestrator({ deps, deadlineMs: 2000 });
  const started = Date.now();
  const out = await o.run({ message: 'قیمت بیت‌کوین الان چنده؟', intentType: 'MARKET_ANALYSIS', owner: 'dev:probe' });
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 5000, `a 2s deadline must not become ${elapsed}ms`);
  assert.ok(out.trace.some((r) => r.node === 'gather' && r.ok === false), 'the dead hop is in the trace');
  assert.ok(out.status && out.status !== 'RUNNING');
  /* the panel still ran; with no evidence the answer cannot be a model claim */
  assert.notEqual(out.answerSource, 'panel+judge');
  assert.equal(out.permissions.canExecute, false);
  assert.ok(calls.models.length >= 0);
});

await t('a hanging model costs its seat and the remaining evidence still answers', async () => {
  const models = async (provider) => {
    if (provider === 'openrouter') return new Promise(() => {});
    return { provider, text: seatJson({ summary: 'قیمت BTC حدود ۶۳٬۲۵۰ دلار است و روند کوتاه‌مدت صعودی است؛ این عدد از خوانش زندهٔ بازار می‌آید.', stance: 'bullish' }) };
  };
  const { deps } = makeHarness({ models });
  const o = createOrchestrator({ deps, deadlineMs: 2500 });
  const started = Date.now();
  const out = await o.run({ message: 'قیمت بیت‌کوین الان چنده؟', intentType: 'MARKET_ANALYSIS', owner: 'dev:probe' });
  assert.ok(Date.now() - started < 6000, 'a hanging seat may not hang the turn');
  assert.ok(out.seats.some((s) => s.ok === false), JSON.stringify(out.seats));
  assert.ok(out.ok, 'the other seat and the evidence still produce an answer');
});

/* ── 6. execution intent stays read-only ──────────────────────────────── */

await t('an execution-intent message plans reads only, and every layer says canExecute:false', async () => {
  const { deps, ledger } = makeHarness();
  const o = createOrchestrator({ deps, deadlineMs: 6000 });
  const out = await o.run({ message: 'همه پولم را سواپ کن به ETH', intentType: 'SWAP', owner: 'dev:probe', entities: { token: 'ETH' } });
  assert.equal(out.plan.permissions.canExecute, false);
  assert.equal(out.permissions.canExecute, false);
  assert.equal(out.permissions.canSign, false);
  assert.equal(out.permissions.canMoveFunds, false);
  assert.equal(out.plan.executionToolsPlanned, 0);
  assert.ok(out.evidence.every((r) => /^fbt_(get|rag|memory)_/.test(r.tool)), JSON.stringify(out.evidence.map((r) => r.tool)));
  assert.equal(ledger.entries[0].decision !== 'EXECUTE', true);
});

/* ── 7. learning changes behaviour, evidence stays the boss ───────────── */

await t('history can re-order tools and earn a seat — but can never raise the confidence cap', async () => {
  const ledger = makeLedger({
    rankTools: (tools) => ({ reordered: true, tools: [...tools].reverse(), priors: { sample: 12 } }),
    seatRecommendation: ({ defaultSeats }) => ({ seats: Math.min(3, defaultSeats + 1), reason: 'CONFLICT_RATE' })
  });
  const { deps, calls } = makeHarness({ ledger });
  const o = createOrchestrator({ deps, deadlineMs: 8000 });
  const out = await o.run({ message: 'قیمت بیت‌کوین الان چنده؟', intentType: 'MARKET_ANALYSIS', owner: 'dev:probe' });
  assert.ok(out.plan.reasons.includes('PRIORS:TOOL_ORDER'));
  assert.ok(out.plan.reasons.some((r) => r.startsWith('PRIORS:SEATS:')));
  assert.equal(calls.models.length, out.plan.analysis.seats);
  assert.ok(out.confidence <= 95);
  assert.equal(out.judgment.laws.aiConsensusIsNotProof, true);
});

/* ── 8. secrets never reach a prompt ──────────────────────────────────── */

await t('a credential pasted into the question is scrubbed before any seat prompt exists', async () => {
  const seen = [];
  const models = async (provider, params) => {
    seen.push(params.user);
    return { provider, text: seatJson({ summary: 'این پیام حاوی عبارت بازیابی است؛ من هرگز آن را نمی‌خوانم و نگه نمی‌دارم. لطفاً آن را در جای امنی نگه دارید.', stance: 'neutral' }) };
  };
  const { deps } = makeHarness({ models });
  const o = createOrchestrator({ deps, deadlineMs: 6000 });
  await o.run({
    message: 'عبارت بازیابی من: abandon ability able about above absent absorb abstract absurd abuse access accident — امنه؟',
    intentType: 'GENERAL', owner: 'dev:probe'
  });
  assert.ok(seen.length >= 1, 'a seat was asked');
  for (const prompt of seen) {
    assert.ok(!/abandon ability able about above absent/.test(prompt), 'the seed phrase must not be in the prompt');
    assert.ok(prompt.includes('[REDACTED'), `expected a redaction marker in: ${prompt.slice(0, 200)}`);
  }
  const direct = buildSeatPrompt({ question: 'my private key is 0x' + 'a'.repeat(64), role: 'analyst', locale: 'en', evidenceBlock: '', ragBlock: '' });
  assert.ok(!direct.user.includes('a'.repeat(64)));
});

/* ── 9. the graph description is the wiring ───────────────────────────── */

await t('describe() publishes the real pipeline and the laws it enforces', async () => {
  const { deps } = makeHarness();
  const o = createOrchestrator({ deps, deadlineMs: 6000 });
  const d = o.describe();
  assert.deepEqual(d.nodes, ['plan', 'gather', 'analyze', 'judge', 'decide', 'learn']);
  assert.equal(o.schema, ORCHESTRATOR_SCHEMA);
  const health = await o.health();
  assert.equal(health.laws.canExecute, false);
  assert.ok(health.tools.every((x) => x.sideEffects === 'read'));
});

let passed = 0;
console.log('\n=== FBT AI ORCHESTRATOR — panel probe ===\n');
for (const [name, ok, detail] of results) {
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); } else console.error(`  ✗ ${name}\n    ${detail}`);
}
console.log(`\n=== PANEL PROBE: ${passed}/${results.length} passed ===\n`);
if (passed !== results.length) process.exit(1);
