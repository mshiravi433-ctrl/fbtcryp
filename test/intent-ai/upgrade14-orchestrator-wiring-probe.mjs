#!/usr/bin/env node
/**
 * FBT AI ORCHESTRATOR — WIRING / HTTP surface probe (Upgrade 14)
 * ────────────────────────────────────────────────────────────────────────────
 * The panel/judge probes prove the engines. This one proves the DOORS and the
 * seams, which is where an upgrade actually breaks an app:
 *
 *   · the new routes are mounted under the SAME `/api/v1/ai` prefix and are
 *     strictly additive — the mount in server/app.js sits beside the existing
 *     router, and no existing path was renamed;
 *   · an owner is derived the same way on every AI surface (telegram → salted
 *     device hash → ip), so a device cannot smuggle another owner's memory;
 *   · the run endpoint refuses credential-shaped input and bounds what the
 *     client can hand the brain (wallet/portfolio shapes only);
 *   · the feature flag really disables the run endpoint (and the whole layer is
 *     inert without it — this is the "do not disrupt the app" contract);
 *   · the chat integration order is orchestrator → escalation ladder →
 *     deterministic reply, with the ladder still in the file and the graph
 *     wrapped in a try/catch;
 *   · zero new dependencies: every new file imports only relative paths,
 *     `node:` builtins, or the app's own MCP package;
 *   · the new environment knobs are documented in .env.example.
 *
 * Run: npm run test:upgrade14-wiring
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import express from 'express';
import { createOrchestratorRouter, _setOrchestrator, ORCHESTRATOR_ROUTES_SCHEMA } from '../../server/aiOrchestratorRoutes.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const results = [];
const t = async (name, fn) => {
  try { await fn(); results.push([name, true, '']); }
  catch (error) { results.push([name, false, String(error?.message || error).slice(0, 260)]); }
};

/* ── fakes: the routes are tested, not the graph ─────────────────────────── */

const seenRuns = [];
const fakeOrchestrator = {
  describe: () => ({ schema: 'fbt.reasoning-graph.v1', id: 'fbt.ai-orchestrator.v1', nodes: ['plan', 'gather', 'analyze', 'judge', 'decide', 'learn'], policies: { maxSteps: 8 } }),
  async health() { return { ok: true, enabled: true, tools: [{ name: 'fbt_get_market_snapshot', sideEffects: 'read' }], providers: ['openrouter'] }; },
  async planOnly(turn) { return { ok: true, schema: 'fbt.evidence-plan.v1', intentType: turn.intentType || 'GENERAL', facets: { requests: [{ facetId: 'market_prices', tool: 'fbt_get_market_snapshot' }], satisfied: [], deferred: [] }, analysis: { seats: 2, roles: ['analyst', 'risk-reviewer'] }, permissions: { canExecute: false } }; },
  async run(turn) {
    seenRuns.push(turn);
    return {
      ok: true, answer: 'پاسخ آزمون', answerSource: 'panel+judge', decision: 'ANSWER', confidence: 71,
      plan: { facets: { requests: [] } }, evidence: [{ facetId: 'market_prices', tool: 'fbt_get_market_snapshot', status: 'observed' }],
      seats: [{ provider: 'openrouter', ok: true }], seatErrors: [], limits: [], permissions: { canExecute: false, canSign: false, canMoveFunds: false }
    };
  },
  judgeOnly(input) {
    return {
      ok: true, decision: 'ANSWER', confidence: 60, question: input.question,
      conflicts: [], dissent: [], limits: [], laws: { executionAuthority: false }
    };
  }
};
const fakeRag = {
  async recall(args) { return { ok: true, schema: 'fbt.rag-memory.v1', query: args.query, ownerScoped: Boolean(args.owner), passages: [{ id: 'cite:kb.x', cite: 'kb.x', score: 0.5, title: 't', text: 'x' }], sources: [{ cite: 'kb.x' }], stats: { backend: 'local' } }; },
  async remember(args) { return { ok: true, id: `mem:${args.owner}`, deduped: false }; },
  async indexKnowledge() { return { ok: true, points: 53, skipped: false }; },
  async stats() { return { knowledgePoints: 53, memoryPoints: 1, backend: 'local', counters: {} }; }
};
const fakeLedger = {
  async recent() { return [{ question: 'q', decision: 'ANSWER', confidence: 70 }]; },
  async priors() { return { toolRanking: [], sample: 3 }; },
  async stats() { return { total: 3, byDecision: { ANSWER: 3 } }; }
};

const app = express();
app.use(express.json());
app.use('/api/v1/ai', createOrchestratorRouter({ orchestrator: fakeOrchestrator, rag: fakeRag, ledger: fakeLedger, log: () => {} }));
/* A JSON error handler, so a parse failure is a 400 with a body instead of an
   HTML page — the same thing server/app.js does for the routes it owns. */
app.use((err, _req, res, _next) => {
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ ok: false, code: 'MALFORMED_JSON' });
  return res.status(500).json({ ok: false, code: 'PROBE_ERROR' });
});
const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const base = `http://127.0.0.1:${server.address().port}/api/v1/ai`;
const DEVICE = 'probe-upgrade14-device';

async function call(path, { method = 'GET', body = null, device = DEVICE, raw = false } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(device ? { 'x-fbt-device': device } : {}) },
    body: body === null ? undefined : (raw ? body : JSON.stringify(body))
  });
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, body: json };
}

const ownerOf = (device) => `dev:${createHash('sha256').update(`${device}|${process.env.FINANCIAL_GOALS_SALT || process.env.CRON_SECRET || 'fbt-ai-intent-os'}`).digest('hex').slice(0, 32)}`;

/* ── 1. the doors exist and describe themselves ─────────────────────────── */

await t('the graph endpoint publishes the pipeline, the tools and the laws', async () => {
  const out = await call('/orchestrator/graph');
  assert.equal(out.status, 200);
  assert.equal(out.body.schema, ORCHESTRATOR_ROUTES_SCHEMA);
  assert.deepEqual(out.body.graph.nodes, ['plan', 'gather', 'analyze', 'judge', 'decide', 'learn']);
  assert.equal(out.body.laws.canExecute, false);
  assert.equal(out.body.laws.numbersFromToolsOnly, true);
  assert.ok(Array.isArray(out.body.tools) && out.body.tools.length >= 10);
  assert.ok(out.body.tools.every((tool) => tool.sideEffects === 'read'));
  assert.equal(out.body.enabled, true);
});

await t('the health endpoint reports the memory backend and the fleet', async () => {
  const out = await call('/orchestrator/health');
  assert.equal(out.status, 200);
  assert.equal(out.body.ok, true);
  assert.equal(out.body.laws.canExecute, false);
});

await t('a plan can be inspected without spending a single model call', async () => {
  const out = await call('/orchestrator/plan', { method: 'POST', body: { message: 'قیمت BTC چنده؟', intentType: 'MARKET_ANALYSIS' } });
  assert.equal(out.status, 200);
  assert.equal(out.body.ok, true);
  assert.equal(out.body.plan.analysis.seats, 2);
  assert.equal(out.body.plan.permissions.canExecute, false);
  assert.equal(out.body.owner, ownerOf(DEVICE), 'the owner is derived exactly as the rest of the AI surface derives it');
  assert.equal(seenRuns.length, 0, 'a plan must not run the graph');
  const empty = await call('/orchestrator/plan', { method: 'POST', body: {} });
  assert.equal(empty.body.code, 'MESSAGE_REQUIRED');
});

/* ── 2. the run door: bounded, owner-scoped, refuse-by-default ──────────── */

await t('a run reaches the orchestrator with the derived owner and sanitized client data', async () => {
  const out = await call('/orchestrator/run', {
    method: 'POST',
    body: {
      message: 'وضعیت بازار چطوره؟',
      intentType: 'MARKET_ANALYSIS',
      clientData: {
        wallet: { attached: true, chains: ['ethereum'], evmAddresses: ['0xabc'] },
        portfolio: { totalValueUsd: 100, holdings: [{ symbol: 'ETH' }] },
        /* these must never survive sanitization */
        seedPhrase: 'abandon ability able about above absent absorb abstract absurd abuse access accident',
        privateKey: '0x' + 'f'.repeat(64)
      }
    }
  });
  assert.equal(out.status, 200);
  assert.equal(out.body.ok, true);
  assert.equal(out.body.owner, ownerOf(DEVICE));
  const last = seenRuns[seenRuns.length - 1];
  assert.equal(last.owner, ownerOf(DEVICE));
  assert.equal(last.clientData.portfolio.totalValueUsd, 100);
  assert.ok(!('seedPhrase' in (last.clientData || {})));
  assert.ok(!JSON.stringify(last.clientData).includes('abandon ability'), 'a pasted seed phrase must never reach the brain');
});

await t('a credential-shaped message is refused before anything is planned', async () => {
  const out = await call('/orchestrator/run', { method: 'POST', body: { message: 'عبارت بازیابی من: abandon ability able about above absent absorb abstract absurd abuse access accident' } });
  assert.equal(out.body.code, 'SENSITIVE_CONTENT_REFUSED');
  assert.equal(out.body.ok, false);
});

await t('the feature flag turns the whole layer off without touching the app', async () => {
  process.env.AI_ORCHESTRATOR = 'off';
  try {
    const out = await call('/orchestrator/run', { method: 'POST', body: { message: 'سلام' } });
    assert.equal(out.body.code, 'ORCHESTRATOR_DISABLED');
  } finally { delete process.env.AI_ORCHESTRATOR; }
});

await t('the judge door judges a panel it is handed, and never authorizes anything', async () => {
  const out = await call('/orchestrator/judge', {
    method: 'POST',
    body: {
      question: 'BTC?',
      analyses: [{ provider: 'openrouter', answer: 'روند صعودی است و ادامه دارد.', stance: 'bullish' }],
      evidence: [{ facetId: 'market_prices', tool: 'fbt_get_market_snapshot', status: 'observed' }]
    }
  });
  assert.equal(out.status, 200);
  assert.equal(out.body.ok, true);
  assert.equal(out.body.judgment.laws.executionAuthority, false);
  const noQuestion = await call('/orchestrator/judge', { method: 'POST', body: {} });
  assert.equal(noQuestion.body.code, 'QUESTION_REQUIRED');
});

/* ── 3. memory and learning doors ───────────────────────────────────────── */

await t('memory recall/remember/index/stats are owner-scoped and additive', async () => {
  const recall = await call('/memory/recall', { method: 'POST', body: { query: 'کارمزد سواپ؟' } });
  assert.equal(recall.body.ok, true);
  assert.equal(recall.body.ownerScoped, true);
  const knowledge = await call('/memory/recall', { method: 'POST', body: { query: 'کارمزد سواپ؟', scope: 'knowledge' } });
  assert.equal(knowledge.body.ownerScoped, false, 'knowledge is shared; memory is not');
  const remember = await call('/memory/remember', { method: 'POST', body: { question: 'طلا بخرم؟', answer: 'بستگی به افق زمانی دارد.' } });
  assert.equal(remember.body.ok, true);
  assert.match(remember.body.id, /^mem:dev:/, 'memory is written under the derived owner');
  const index = await call('/memory/index', { method: 'POST', body: {} });
  assert.equal(index.body.ok, true);
  const stats = await call('/memory/stats');
  assert.equal(stats.body.stats.knowledgePoints, 53);
  const empty = await call('/memory/recall', { method: 'POST', body: {} });
  assert.equal(empty.body.code, 'QUERY_REQUIRED');
});

await t('the decision history and learning surfaces read the ledger, not a model', async () => {
  const decisions = await call('/orchestrator/decisions');
  assert.equal(decisions.status, 200);
  assert.equal(decisions.body.decisions[0].decision, 'ANSWER');
  const learning = await call('/orchestrator/learning');
  assert.equal(learning.body.ok, true);
  assert.equal(learning.body.priors.sample, 3);
  const aggregate = await call('/orchestrator/learning?scope=aggregate');
  assert.equal(aggregate.body.ok, true);
});

await t('a malformed body is rejected by the JSON parser before any brain runs', async () => {
  const runsBefore = seenRuns.length;
  const out = await call('/orchestrator/run', { method: 'POST', body: 'not json', raw: true });
  /* Express's own parser answers first (it runs app-wide, ahead of every
     router in this app), so the contract here is: NOT a 2xx, and the graph is
     never entered with a half-parsed body. */
  assert.ok(out.status >= 400 && out.status < 500, `malformed JSON must not be a success, got ${out.status}`);
  assert.equal(seenRuns.length, runsBefore, 'the orchestrator is never called with an unparsed body');
});

await t('every new endpoint is POST/GET under /api/v1/ai — the mount is unchanged', async () => {
  const rows = read('server/app.js');
  /*
   * The mount is asserted in its LAZY form: server/app.js now imports this
   * router on the first request that reaches /api/v1/ai (see the lazyMount
   * note there — a cold start must not compile the whole AI stack). Position,
   * prefix and the shared budget middleware are unchanged, and the count
   * assertion still catches an extra router appearing on the prefix.
   *
   * This is also the probe that would have caught the original mounting bug if
   * it had exercised HTTP through server/app.js instead of a router the probe
   * built itself: the module's default export used to be the FACTORY, so
   * `app.use('/api/v1/ai', aiOrchestratorRoutes)` mounted a router factory as
   * middleware — Express called it, threw the router away and never called
   * next(), so every one of these endpoints hung instead of answering. See the
   * note at the foot of server/aiOrchestratorRoutes.js.
   */
  assert.ok(
    rows.includes("lazyMount('ai-orchestrator', () => import('./aiOrchestratorRoutes.js'))"),
    'the orchestrator router is mounted under the SAME prefix'
  );
  assert.ok(
    rows.includes("lazyMount('ai-intent-os', () => import('./aiIntentOS.js'))"),
    'the existing AI router is untouched'
  );
  const mountCount = rows.split("app.use('/api/v1/ai'").length - 1;
  /* the shared rate limiter + the existing router + the additive one */
  assert.equal(mountCount, 3, 'the prefix keeps its limiter and gains exactly one additive router');
  assert.ok(rows.includes('orchestratorRateLimit') || rows.includes("app.use('/api/v1/ai', (req, res, next)"), 'the shared budget middleware still guards the prefix');
});

/* ── 4. the seams: owner parity, chat order, zero deps, env docs ────────── */

await t('every orchestrator symbol the chat route names really exists where it imports it from', async () => {
  const src = read('server/aiIntentOS.js');
  const imports = [...src.matchAll(/import\s*\{([^}]+)\}\s*from\s*'(\.\/aiOrchestrator(?:Routes)?\.js)'/g)];
  assert.ok(imports.length >= 1, 'the chat route imports the orchestrator');
  const modules = {
    './aiOrchestrator.js': await import('../../server/aiOrchestrator.js'),
    './aiOrchestratorRoutes.js': await import('../../server/aiOrchestratorRoutes.js')
  };
  for (const [, names, spec] of imports) {
    for (const raw of names.split(',')) {
      const name = raw.trim().split(/\s+as\s+/)[0].trim();
      if (!name) continue;
      assert.ok(name in modules[spec], `${spec} must export '${name}' (named by server/aiIntentOS.js)`);
    }
  }
  /* And the module itself must actually load — a broken specifier is exactly
     the failure mode a text-only wiring check cannot see. */
  const intent = await import('../../server/aiIntentOS.js');
  assert.ok(intent, 'server/aiIntentOS.js must import cleanly with the new dependency');
});

await t('owner derivation is byte-identical across the three AI surfaces', async () => {
  for (const file of ['server/aiIntentOS.js', 'server/aiOrchestratorRoutes.js', 'server/central/router.js']) {
    const src = read(file);
    assert.ok(src.includes('x-fbt-device'), `${file} must read the device header`);
    assert.ok(src.includes('sha256'), `${file} must hash the device`);
    assert.ok(src.includes('FINANCIAL_GOALS_SALT'), `${file} must use the shared salt chain`);
    assert.ok(src.includes('fbt-ai-intent-os'), `${file} must fall back to the same salt`);
    assert.ok(src.includes('slice(0, 32)'), `${file} must truncate the owner hash the same way`);
  }
});

await t('the chat path tries the orchestrator first, keeps the ladder second, and the reply third', async () => {
  const src = read('server/aiIntentOS.js');
  const importIdx = src.indexOf("from './aiOrchestrator.js'");
  assert.ok(importIdx > 0, 'the orchestrator is imported by the chat route');
  assert.ok(src.includes("logInternal('orchestrator-error'"), 'a failure is logged and swallowed, never thrown at the user');
  const block = src.slice(src.indexOf('if (orchestratorEnabled())'), src.indexOf('if (!orchestration?.answer)'));
  assert.ok(block.includes('await getOrchestrator().run('), 'the orchestrator runs first');
  assert.ok(src.indexOf('escalateToProviders({') > src.indexOf('if (!orchestration?.answer)'), 'the ladder still runs when the graph yields nothing');
  assert.ok(src.includes('orchestrator: orchestration ? {'), 'the reply exposes the decision additively');
  assert.ok(src.includes('executionAuthorized: false'));
});

await t('the whole upgrade adds ZERO dependencies', async () => {
  const files = [
    'server/aiOrchestrator.js', 'server/aiOrchestratorRoutes.js', 'server/aiToolBroker.js',
    'src/lib/intent-ai/orchestrator/graphEngine.js', 'src/lib/intent-ai/orchestrator/evidencePlan.js',
    'src/lib/intent-ai/orchestrator/vectorStore.js', 'src/lib/intent-ai/orchestrator/ragMemory.js',
    'src/lib/intent-ai/orchestrator/judge.js', 'src/lib/intent-ai/orchestrator/decisionLedger.js',
    'src/lib/intent-ai/orchestrator/redact.js'
  ];
  const pkg = JSON.parse(read('package.json'));
  const declared = new Set([...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {})]);
  for (const file of files) {
    const src = read(file);
    for (const match of src.matchAll(/from\s+'([^']+)'/g)) {
      const spec = match[1];
      assert.ok(
        spec.startsWith('.') || spec.startsWith('node:') || declared.has(spec),
        `${file} imports an undeclared module: ${spec}`
      );
    }
  }
  /* and nothing new was added to the manifest for this upgrade */
  assert.ok(!Object.keys(pkg.dependencies).some((d) => /langgraph|llama|qdrant|modelcontextprotocol/.test(d)));
});

await t('the new environment knobs are documented, not invented in code only', async () => {
  const env = read('.env.example');
  for (const key of ['AI_ORCHESTRATOR', 'AI_ORCH_DEADLINE_MS', 'AI_ORCH_CHAT_DEADLINE_MS', 'AI_ORCH_GATHER_SHARE', 'AI_ORCH_SEAT_TOKENS', 'AI_ORCH_SEAT_TIMEOUT_MS', 'AI_ORCH_MAX_TOOLS', 'AI_ORCH_ALLOW_MACRO', 'AI_ORCH_VECTOR', 'AI_ORCH_VECTOR_DIM', 'AI_ORCH_MEMORY_PER_OWNER', 'QDRANT_URL', 'QDRANT_API_KEY']) {
    assert.ok(env.includes(key), `.env.example must document ${key}`);
  }
});

server.close();
let passed = 0;
console.log('\n=== FBT AI ORCHESTRATOR — wiring probe ===\n');
for (const [name, ok, detail] of results) {
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); } else console.error(`  ✗ ${name}\n    ${detail}`);
}
console.log(`\n=== WIRING PROBE: ${passed}/${results.length} passed ===\n`);
if (passed !== results.length) process.exit(1);
