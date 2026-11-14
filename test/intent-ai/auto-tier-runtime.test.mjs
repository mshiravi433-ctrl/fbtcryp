/*
 * DOES THE QUESTION CHOOSE ITS OWN TIER? (2026-11-13)
 * ==========================================================================
 *
 * The three tiers were complete and fully wired — UI selector, persisted
 * preference, request → route → gateway, model ladders, token budgets, reasoning
 * knobs, latency deadlines — and none of that machinery ever ASKED WHAT THE
 * QUESTION WAS. The tier came from one input, the saved preference, defaulting
 * to `max`. A greeting therefore bought five models, a reasoning pass, a
 * self-critique and repair pass, 1280 generation tokens and a 45-second thinking
 * window, on a deployment whose host kills a request at 60.
 *
 * The fix adds no classifier. `planCollaboration` already reads every message —
 * conversation kind, complexity, freshness, whether web research is needed, how
 * complete the message is, how the user feels — purely, with no model call, in
 * every mode. `proposeIntelligenceMode` only turns a read that already happens
 * into a tier, and it is the single place that does so, the same way
 * `INTELLIGENCE_MODES` is the single definition of what a tier means.
 *
 * THE PROPERTY UNDER TEST IS AN ASYMMETRY, not a mapping. A wrong "cheaper"
 * costs an answer; a wrong "keep the expensive tier" costs milliseconds. So only
 * two shapes are ever discounted, everything else is refused BY NAME, and the
 * refusal is the interesting half of this file: a rule that can only make things
 * cheaper is a bug waiting for a frightened user or a sell order.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

let cached = null;
function runProbe() {
  if (cached) return cached;
  const res = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'probe-autotier.mjs'), '--json'], {
    encoding: 'utf8', cwd: ROOT, timeout: 600_000, maxBuffer: 32 * 1024 * 1024
  });
  assert.equal(res.status, 0, `the probe must exit 0; stderr: ${String(res.stderr || '').slice(0, 600)}`);
  const text = String(res.stdout || '').trim();
  assert.equal(text.indexOf('{'), 0, `the probe must emit JSON only: ${text.slice(0, 140)}`);
  cached = JSON.parse(text);
  return cached;
}

test('every shape of question in the corpus lands on the tier it justifies', () => {
  const { rows, summary } = runProbe();
  const failed = rows.filter((r) => r.ok === false);
  assert.deepEqual(failed.map((r) => `${r.name}: ${r.value}${r.note ? ` (${r.note})` : ''}`), [],
    'every check in the probe must hold');
  assert.equal(summary.failures, 0);
  assert.ok(summary.messages >= 20, `the corpus must stay broad enough to mean something, got ${summary.messages}`);
});

test('a social turn stops buying the flagship ladder', () => {
  /* The concrete saving: 5 models → 2, reasoning off, self-critique off,
     1280 → 640 generation tokens, and a 45 s window → 8 s. The window matters
     most on a host that aborts at 60 s: a tier that plans for 45 s of thinking
     is a tier that can be killed mid-await and return nothing at all. */
  const { decided } = runProbe();
  const greeting = decided.find((d) => d.text === 'سلام');
  assert.ok(greeting, 'the corpus must contain a plain greeting');
  assert.equal(greeting.mode, 'swift');
  assert.equal(greeting.models, 2);
  assert.equal(greeting.reasoning, false);
  assert.equal(greeting.selfCritique, false);
  assert.equal(greeting.deadlineMs, 8000);
});

test('a self-contained question gets the middle tier, and that branch is reachable', () => {
  /* Not a hypothetical rule: measured over the corpus, definitional questions —
     «بلاکچین یعنی چه», «gas fee چیه», «استیکینگ چیست» — read as complete,
     simple or medium, level <= 2, needing no web research. */
  const { decided, summary } = runProbe();
  const balanced = decided.filter((d) => d.mode === 'balanced');
  assert.ok(balanced.length >= 3, `the middle tier must be reachable by real messages, got ${balanced.length}`);
  assert.ok(balanced.every((d) => d.reason === 'SELF_CONTAINED_QUESTION'),
    balanced.filter((d) => d.reason !== 'SELF_CONTAINED_QUESTION').map((d) => `${d.text}:${d.reason}`).join('; '));
  assert.ok(summary.selfContained >= 3, 'the corpus must keep covering the middle tier');
});

test('nothing that moves money is ever discounted', () => {
  /* The strongest safety property here. A cheaper tier on an execution turn
     means fewer models checking a sell order, and the tier ladder is also what
     decides how much verification a turn gets. */
  const { decided } = runProbe();
  const money = decided.filter((d) => d.group === 'money');
  assert.ok(money.length >= 3, 'the corpus must keep covering money-moving turns');
  assert.deepEqual(
    money.filter((d) => d.mode !== 'max').map((d) => `${d.text} → ${d.mode}`),
    [],
    'every money-moving turn keeps the full tier'
  );
  assert.ok(money.every((d) => d.reason === 'MONEY_MOVING_TURN'),
    'and each one must say it was refused because it moves money');
});

test('an incomplete, research-bound, distressed or compound turn is never discounted', () => {
  const { decided } = runProbe();
  const protectedGroups = ['incomplete', 'research', 'emotional', 'high-stakes', 'compound'];
  for (const group of protectedGroups) {
    const members = decided.filter((d) => d.group === group);
    assert.ok(members.length >= 1, `the corpus lost its ${group} coverage`);
    assert.deepEqual(
      members.filter((d) => d.mode !== 'max').map((d) => `${d.text} → ${d.mode} (${d.reason})`),
      [],
      `no ${group} turn may be discounted`
    );
  }
});

test('only two reasons can ever produce a discount', () => {
  const { decided } = runProbe();
  const discounted = decided.filter((d) => d.mode !== 'max');
  assert.ok(discounted.length >= 8, `discounts must actually happen, got ${discounted.length}`);
  const allowed = new Set(['SOCIAL_TURN', 'SELF_CONTAINED_QUESTION']);
  assert.deepEqual(
    discounted.filter((d) => !allowed.has(d.reason)).map((d) => `${d.text}:${d.reason}`),
    [],
    'a third discount reason would be a new claim about what a turn needs'
  );
});

test('a tier decision always names itself', () => {
  /* A tier chosen silently is indistinguishable from a tier nobody chose. */
  const { decided } = runProbe();
  assert.deepEqual(decided.filter((d) => !d.reason).map((d) => d.text), [], 'every row carries a reason');
  assert.deepEqual(decided.filter((d) => d.source === 'auto' && !d.reason).map((d) => d.text), [],
    'every applied discount carries its reason with it');
});

test('the decision is free: no model call, and under 2 ms warm', () => {
  const { summary } = runProbe();
  assert.ok(summary.perMessageMs < 2,
    `the tier decision must cost less than the turn it prices; warm ${summary.perMessageMs} ms against an 8000 ms floor`);
  assert.ok(summary.coldPerMessageMs > 0, 'the cold JIT pass is reported rather than hidden');
});

/* ─── the resolver's invariants, checked directly ──────────────────────────── */

test('the resolver keeps its four invariants', async () => {
  const { resolveIntelligenceMode } = await import('../../server/aiIntelligence.js');
  const cheap = { mode: 'swift', reason: 'SOCIAL_TURN' };

  const userChoice = resolveIntelligenceMode('max', { env: {}, auto: cheap });
  assert.equal(userChoice.mode, 'max');
  assert.equal(userChoice.source, 'request');
  assert.equal(userChoice.auto.ignored, 'USER_CHOICE_WINS',
    'a heuristic that overrules an explicit preference is the kind of cleverness that makes a product feel unreliable');

  const pinned = resolveIntelligenceMode(null, { env: { FBT_AI_INTELLIGENCE: 'max' }, auto: cheap });
  assert.equal(pinned.mode, 'max');
  assert.equal(pinned.source, 'env');
  assert.equal(pinned.auto.ignored, 'OPERATOR_PIN_WINS');

  const upward = resolveIntelligenceMode(null, { env: {}, defaultMode: 'swift', auto: { mode: 'max', reason: 'TEST' } });
  assert.equal(upward.mode, 'swift');
  assert.equal(upward.auto.ignored, 'AUTO_MAY_ONLY_LOWER',
    'this function can never be the reason a turn got more expensive');

  const legacy = resolveIntelligenceMode(null, { env: {} });
  assert.deepEqual(
    { mode: legacy.mode, source: legacy.source, requested: legacy.requested, rejected: legacy.rejected },
    { mode: 'max', source: 'default', requested: null, rejected: null },
    'with no proposal the resolver must behave exactly as it did before'
  );
  assert.equal(legacy.auto, null);
});
