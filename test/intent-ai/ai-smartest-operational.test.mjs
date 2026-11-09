/**
 * THE SMARTEST MODE, ACTUALLY RUNNING — the three gaps that made 14 000 lines
 * of new AI code invisible on the live deployment.
 * ---------------------------------------------------------------------------
 * Reported: «با وجود لایو شدن در ورسل هیچ تغییری در هوش مصنوعی انجام نشده».
 * The deployment WAS current (`GET /api/v1/ai/intelligence` answered with the
 * new schema and `mode: max`), so nothing was wrong with the release. Three
 * operational facts were:
 *
 *   1. a leftover `AI_MODEL` / `WORKERSAI_MODEL` pin in the Vercel environment
 *      repeated each provider's OLD CHEAP default, and the gateway read any pin
 *      as an instruction — so the flagship ladder resolved and then stepped
 *      aside, and `max` sent `gpt-4o-mini` to the wire;
 *   2. the turn's latency budget was one number for every mode (20 s, tuned
 *      for a 600-token cheap-model reply) and `withDeadline` re-armed that
 *      number for every stage instead of spending it — so a `max` turn either
 *      raced against an already-spent budget or outlived the 60 s function;
 *   3. the browser hung up at 30 s, which is shorter than the budget the
 *      smartest mode legitimately needs.
 *
 * Every check here is offline: the fleet is injected or `fetch` is stubbed, so
 * no key is needed and no provider is paid for.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  INTELLIGENCE_MODES,
  intelligenceDeadlineMs,
  turnCeilingMs,
  intelligenceModelLadder,
  describeIntelligence
} from '../../server/aiIntelligence.js';
import {
  PROVIDER_CONFIGS,
  getModelCandidates,
  describeModelPin,
  getAvailableProviders,
  gatewaySelfTest,
  resetProviderHealth
} from '../../server/aiGateway.js';
import { runCollaborativeAnalysis } from '../../server/aiCollaboration.js';

const src = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

/* Save and restore every variable a check touches: these tests mutate
   process.env on purpose (that IS the defect under test), and a leaked pin
   would quietly change every later file in the same `node --test` run. */
const TOUCHED = [
  'AI_MODEL', 'OPENAI_MODEL', 'WORKERSAI_MODEL', 'GROQ_MODEL',
  'FBT_AI_INTELLIGENCE', 'FBT_AI_PROVIDERS',
  'AI_COLLAB_DEADLINE_MS', 'AI_TURN_CEILING_MS',
  'OPENROUTER_API_KEY', 'GROQ_API_KEY', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'
];
const saved = Object.fromEntries(TOUCHED.map((k) => [k, process.env[k]]));
function resetEnv() {
  for (const k of TOUCHED) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
}
test.afterEach(resetEnv);
test.after(resetEnv);

/* ── 1. a stale env pin must not veto the flagship ladder ────────────────── */

test('max still calls the flagship when the deployment pins the old cheap default', () => {
  for (const [id, cfg] of Object.entries(PROVIDER_CONFIGS)) {
    if (!cfg.modelEnv || cfg.type === 'internal-engine') continue;
    const ladder = intelligenceModelLadder(id, 'max');
    if (!ladder.length) continue;
    /* The exact production value: the pin repeats the provider's own default. */
    process.env[cfg.modelEnv] = cfg.baseModel;
    const candidates = getModelCandidates(id, null, { mode: 'max' });
    assert.equal(candidates[0], ladder[0], `${id}: ${cfg.modelEnv} must not veto the flagship`);
    /* Nothing is deleted — the pinned seat is still in the chain, right after
       the flagships, so it answers the moment a flagship fails. */
    assert.ok(candidates.includes(cfg.baseModel), `${id}: the pinned model vanished from the chain`);
  }
});

test('a deliberate operator pin still outranks the ladder', () => {
  process.env.OPENAI_MODEL = 'acme-enterprise-gpt';
  const candidates = getModelCandidates('openai', null, { mode: 'max' });
  assert.equal(candidates[0], 'acme-enterprise-gpt', 'an unusual id is an instruction, not a leftover');
  /* …and the flagship is still reachable behind it. */
  assert.ok(candidates.includes(intelligenceModelLadder('openai', 'max')[0]));
});

test('balanced and swift keep the pre-mode order whatever the pin says', () => {
  process.env.AI_MODEL = 'openai/gpt-4o-mini';
  for (const [id, cfg] of Object.entries(PROVIDER_CONFIGS)) {
    if (!cfg.modelEnv || cfg.type === 'internal-engine') continue;
    const historical = getModelCandidates(id);
    assert.deepEqual(getModelCandidates(id, null, { mode: 'balanced' }), historical, `${id}: balanced moved`);
    assert.deepEqual(getModelCandidates(id, null, { mode: 'swift' }), historical, `${id}: swift moved`);
  }
});

test('describeModelPin names the variable, the value and what was done about it', () => {
  assert.equal(describeModelPin('openrouter').state, 'unset');
  process.env.AI_MODEL = 'openai/gpt-4o-mini';
  const shadowed = describeModelPin('openrouter');
  assert.equal(shadowed.state, 'shadowed');
  assert.equal(shadowed.envVar, 'AI_MODEL');
  assert.equal(shadowed.leads, false);
  assert.match(String(shadowed.fix), /AI_MODEL/);
  process.env.AI_MODEL = 'google/gemini-2.5-pro';
  const chosen = describeModelPin('openrouter');
  assert.equal(chosen.state, 'leads');
  assert.equal(chosen.leads, true);
  assert.equal(chosen.fix, null);
});

test('the fleet payload carries modelPin so the panel can explain itself', () => {
  process.env.FBT_AI_PROVIDERS = 'all';
  process.env.AI_MODEL = 'openai/gpt-4o-mini';
  const openrouter = getAvailableProviders().find((p) => p.id === 'openrouter');
  assert.equal(openrouter.modelPin.state, 'shadowed');
  assert.equal(openrouter.modelPin.envVar, 'AI_MODEL');
});

/* ── 2. the mode owns a budget, and the turn owns the clock ──────────────── */

test('each mode gets its own latency budget, balanced unchanged at 20 s', () => {
  assert.equal(intelligenceDeadlineMs('swift').deadlineMs, 8000);
  assert.equal(intelligenceDeadlineMs('balanced').deadlineMs, 20000, 'balanced must keep the historical window');
  assert.equal(intelligenceDeadlineMs('max').deadlineMs, 45000);
  assert.equal(intelligenceDeadlineMs('max').source, 'mode');
  /* The smartest mode is the slowest by design — three analyses, a verifier
     and a repair pass on flagships do not fit in a cheap-model window. */
  assert.ok(intelligenceDeadlineMs('max').deadlineMs > intelligenceDeadlineMs('balanced').deadlineMs);
});

test('precedence is request > AI_COLLAB_DEADLINE_MS > mode, then the ceiling', () => {
  process.env.AI_COLLAB_DEADLINE_MS = '30000';
  assert.equal(intelligenceDeadlineMs('max').deadlineMs, 30000, 'the deployment keeps control');
  assert.equal(intelligenceDeadlineMs('max').source, 'env');
  assert.equal(intelligenceDeadlineMs('max', 12000).deadlineMs, 12000);
  assert.equal(intelligenceDeadlineMs('max', 12000).source, 'request');
  /* A ceiling typo can never produce a turn that outlives the function. */
  process.env.AI_TURN_CEILING_MS = '900000';
  assert.ok(intelligenceDeadlineMs('max').deadlineMs <= turnCeilingMs());
  assert.equal(turnCeilingMs(), 58000, 'the ceiling is clamped to the platform, not to the typo');
  delete process.env.AI_TURN_CEILING_MS;
  process.env.AI_COLLAB_DEADLINE_MS = '1';
  assert.equal(intelligenceDeadlineMs('max').deadlineMs, 45000, 'a sub-second budget is refused, not obeyed');
});

test('the published contract states the budget it will run under', () => {
  const report = describeIntelligence({ env: {}, requested: 'max' });
  assert.equal(report.features.turnDeadlineMs, 45000);
  assert.equal(report.features.turnCeilingMs, turnCeilingMs({}));
  assert.equal(report.features.deadlineSource, 'mode');
  const swift = describeIntelligence({ env: {}, requested: 'swift' });
  assert.equal(swift.features.turnDeadlineMs, 8000, 'a fast mode must not advertise a slow budget');
});

test('every stage spends what the turn has LEFT — one deadline, not one per stage', () => {
  const collab = src('server/aiCollaboration.js');
  assert.match(collab, /const withDeadline = \(promise, fallback, timeoutMs = remainingMs\(\)\)/,
    'the per-stage timeout must be measured from the start of the turn');
  assert.doesNotMatch(collab, /timeoutMs = deadlineMs\)/,
    'a stage that re-arms the full budget makes the pipeline unbounded');
  const route = src('server/aiIntentOS.js');
  assert.match(route, /deadlineMs: turnBudgetFor\(resolvedIntelligence\.mode\)/,
    'the chat route must clamp the collaboration into the turn, not hand it the sky');
  assert.doesNotMatch(route, /26000 - ladderFloorMs/,
    'the escalation ladder budget must come from the same ceiling as the collaboration');
});

test('a collaborative turn returns inside its budget even when every model hangs', async () => {
  /* Providers that never answer: the ONLY thing that can end the turn is the
     budget. Under the old semantics each stage re-armed it, so a level-4 `max`
     run (analyses, then the synthesiser) took 2 × budget — and a real turn has
     more stages than that, which is how a 60 s function got killed. */
  const BUDGET_MS = 2000;
  const hang = () => new Promise(() => {});
  const started = Date.now();
  const result = await runCollaborativeAnalysis({
    message: 'وضعیت بیت‌کوین را تحلیل کن و بگو فشار فروش ادامه دارد یا نه؟',
    context: { market: { priceMap: { BTC: 108000 }, change24hPct: -4.2, dataStatus: 'live' } },
    locale: 'fa',
    intelligence: 'max',
    deadlineMs: BUDGET_MS,
    deps: {
      selectProviders: () => ['openrouter', 'groq', 'workersai'],
      execute: async () => { await hang(); return { ok: false, text: '' }; }
    }
  });
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= BUDGET_MS - 200, `the turn gave up after ${elapsed}ms — it did not even spend its budget`);
  assert.ok(elapsed < BUDGET_MS * 1.8, `the turn ran ${elapsed}ms on a ${BUDGET_MS}ms budget — the clock is being re-armed per stage`);
  /* Degraded, honest, and it says so: a timeout and a refusal must stay
     tellable apart, which is what `budget` is on the result for. */
  assert.equal(result.ok, true);
  assert.equal(result.intelligence.budget.deadlineMs, BUDGET_MS);
  assert.equal(result.intelligence.budget.source, 'request');
  assert.ok(result.degraded, 'a hung fleet must be reported as degraded');
});

test('the mode default reaches a direct caller that passes no deadline', async () => {
  const QUESTION = 'وضعیت اتریوم را تحلیل کن و بگو ریسک پوزیشن باز چیست؟';
  const CONTEXT = { market: { priceMap: { ETH: 2500 }, change24hPct: -2.1, dataStatus: 'live' } };
  const seen = [];
  const reply = (text) => ({ provider: 'openrouter', model: 'fake', durationMs: 1, engine: 'external-model', text: JSON.stringify({ answer: text, claims: [], uncertainty: '' }) });
  await runCollaborativeAnalysis({
    message: QUESTION,
    context: CONTEXT,
    locale: 'fa',
    intelligence: 'swift',
    deps: {
      selectProviders: () => ['openrouter'],
      execute: async (providerId, opts) => { seen.push(opts); return reply('تحلیل سریع'); }
    }
  });
  const maxRun = [];
  await runCollaborativeAnalysis({
    message: QUESTION,
    context: CONTEXT,
    locale: 'fa',
    intelligence: 'max',
    deps: {
      selectProviders: () => ['openrouter'],
      execute: async (providerId, opts) => { maxRun.push(opts); return reply('تحلیل عمیق'); }
    }
  });
  /* The mode is carried on every call — the gateway needs it to pick the
     flagship and the reasoning fields. */
  assert.equal(seen[0]?.intelligence, 'swift');
  assert.equal(maxRun[0]?.intelligence, 'max');
  /* …and the depth floor came with it: the smartest mode runs more than one
     analytical seat where swift runs one. */
  assert.ok(maxRun.length > seen.length, `max ran ${maxRun.length} call(s), swift ${seen.length}`);
});

/* ── 3. the client waits as long as the mode needs ───────────────────────── */

test('the browser timeout follows the mode instead of truncating it', () => {
  const client = src('src/lib/aiIntentClient.js');
  assert.match(client, /timeout: intelligenceTurnBudgetMs\(mode\)/,
    'aiChat must not keep a fixed window while the mode decides the depth');
  assert.match(client, /intelligence: mode\b/);
  const shared = src('src/lib/aiIntelligenceMode.js');
  assert.match(shared, /max: 58000/, 'the smartest mode needs a wait above the server ceiling');
  /* Cross-layer contract: the client never gives up before the server would. */
  const clientMax = Number(shared.match(/max: (\d+)/)[1]);
  assert.ok(clientMax >= turnCeilingMs({}) + 5000,
    'a client timeout below the server ceiling discards the answer it paid for');
  assert.ok(clientMax <= 60000, 'and it must stay inside the function the request runs in');
});

/* ── 4. the self-test probes the seat the mode will actually use ─────────── */

test('gatewaySelfTest pings the active mode, not the historical default', async () => {
  const bodies = [];
  globalThis.fetch = async (url, init = {}) => {
    bodies.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };
  process.env.FBT_AI_PROVIDERS = 'all';
  process.env.OPENROUTER_API_KEY = 'sk-or-test';
  process.env.AI_MODEL = 'openai/gpt-4o-mini';   /* the stale production pin */
  delete process.env.GROQ_API_KEY;
  delete process.env.CLOUDFLARE_API_TOKEN;
  resetProviderHealth();
  try {
    const report = await gatewaySelfTest();
    const openrouter = report.providers.find((p) => p.id === 'openrouter');
    assert.equal(openrouter.status, 'HEALTHY');
    /* The probe asked for the FLAGSHIP, so «HEALTHY» now means what the
       smartest mode needs it to mean. */
    const sent = bodies.filter((b) => b.url.includes('openrouter.ai'));
    assert.equal(sent[0].body.model, 'google/gemini-2.5-pro');
    assert.equal(openrouter.model, 'google/gemini-2.5-pro');
    assert.equal(openrouter.intelligenceMode, 'max');
    assert.equal(openrouter.modelPin.state, 'shadowed');
    assert.equal(report.intelligence.mode, 'max');
    assert.ok(report.intelligence.deadlineMs <= report.intelligence.ceilingMs);
  } finally {
    resetProviderHealth();
  }
});

test('the modes publish their budgets so a panel can say «this is the slow one»', () => {
  for (const profile of Object.values(INTELLIGENCE_MODES)) {
    assert.ok(Number.isFinite(profile.turnDeadlineMs) && profile.turnDeadlineMs >= 2000,
      `${profile.id} has no latency budget`);
    assert.equal(intelligenceDeadlineMs(profile.id, null).deadlineMs, Math.min(profile.turnDeadlineMs, turnCeilingMs({})));
  }
});
