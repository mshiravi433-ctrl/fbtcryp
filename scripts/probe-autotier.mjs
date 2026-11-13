/*
 * PROBE — DOES THE QUESTION CHOOSE ITS OWN TIER?
 * ==========================================================================
 * Run:  node scripts/probe-autotier.mjs [--json]
 *
 * The three tiers (`swift` = simple, `balanced` = medium, `max` = smart) existed
 * and were fully wired: UI selector, persisted preference, request → route →
 * gateway, model ladders, token budgets, reasoning knobs, latency deadlines.
 * What did not exist was a DECISION. The tier came from one input only — the
 * saved preference, defaulting to `max` — so a greeting and a leveraged
 * liquidation scenario bought the same brain: five models, a reasoning pass, a
 * self-critique and repair pass, 1280 generation tokens and a 45-second
 * thinking window.
 *
 * This probe drives the real functions over real messages:
 *   planCollaboration   — the router's pure read of the message (no model call)
 *   proposeIntelligenceMode — the read turned into a tier proposal
 *   resolveIntelligenceMode — the proposal against the user's choice and the env
 *
 * and then asserts the ASYMMETRY that makes it safe: a discount is only ever
 * proposed for a turn that is social or self-contained, and everything that
 * moves money, is incomplete, needs research, or carries distress keeps the tier
 * it was given. A wrong "cheaper" is a worse answer; a wrong "keep the expensive
 * tier" costs milliseconds. The rules are written to be wrong in the expensive
 * direction, and this probe is what holds them there.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planCollaboration } from '../src/lib/intent-ai/os/collaborationRouter.js';
import {
  proposeIntelligenceMode,
  resolveIntelligenceMode,
  getIntelligenceProfile,
  intelligenceDeadlineMs,
  intelligenceGeneration,
  INTELLIGENCE_MODE_RANK
} from '../server/aiIntelligence.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wantJson = process.argv.includes('--json');

/* Every shape the router actually produces, measured over the corpus below. */
const CORPUS = [
  /* ── social: the router's own law says these never become a five-model run ── */
  { text: 'سلام', expect: 'swift', group: 'social' },
  { text: 'سلام دوست من', expect: 'swift', group: 'social' },
  { text: 'ممنون', expect: 'swift', group: 'social' },
  { text: 'مرسی', expect: 'swift', group: 'social' },
  { text: 'خداحافظ', expect: 'swift', group: 'social' },
  { text: 'چطوری', expect: 'swift', group: 'social' },
  { text: 'خسته نباشی', expect: 'swift', group: 'social' },
  { text: 'دمت گرم', expect: 'swift', group: 'social' },
  { text: 'che khabar', expect: 'swift', group: 'social' },
  /* ── self-contained and definitional: complete, no web, level <= 2 ───────── */
  { text: 'بلاکچین یعنی چه', expect: 'balanced', group: 'self-contained' },
  { text: 'gas fee چیه', expect: 'balanced', group: 'self-contained' },
  { text: 'صرافی چیست', expect: 'balanced', group: 'self-contained' },
  { text: 'استیکینگ چیست', expect: 'balanced', group: 'self-contained' },
  /* ── money-moving: never discounted, whatever it reads like ─────────────── */
  { text: '۱۰۰ دلار بیت کوین بخر', expect: 'max', group: 'money' },
  { text: 'همه را بفروش', expect: 'max', group: 'money', intent: 'EXECUTE_SWAP' },
  { text: 'rebalance my portfolio', expect: 'max', group: 'money', intent: 'EXECUTE_REBALANCE' },
  { text: 'confirm', expect: 'max', group: 'money', intent: 'CONFIRM_PENDING', execution: true },
  /* ── incomplete: increment 23 RAISES the floor for these ───────────────── */
  { text: 'btc', expect: 'max', group: 'incomplete' },
  { text: 'فروش', expect: 'max', group: 'incomplete' },
  { text: 'بازار امروز چطوره', expect: 'max', group: 'incomplete' },
  /* ── research-bound: the cheap tier's two-model budget is spent on retrieval */
  { text: 'قیمت بیت کوین چقدره', expect: 'max', group: 'research' },
  { text: 'بهترین ییلد الان چیه', expect: 'max', group: 'research' },
  { text: 'اخبار امروز را خلاصه کن', expect: 'max', group: 'research' },
  /* ── distress: §25 gives an emotional turn at least one careful pass ───── */
  { text: 'می‌ترسم همه سرمایه‌ام را از دست بدهم، بیت کوین دارد سقوط می‌کند و نمی‌دانم چه کار کنم', expect: 'max', group: 'emotional' },
  /* ── high stakes / compound ─────────────────────────────────────────────── */
  { text: 'تحلیل کامل پرتفوی من با سناریوی سقوط ۲۰ درصدی و مقایسه با آلت‌های با نقدشوندگی بالا', expect: 'max', group: 'high-stakes' },
  { text: 'هم بازار را بگو هم بهترین ییلد را', expect: 'max', group: 'compound', parts: 2 }
];

const rows = [];
const failures = [];
const check = (name, ok, value, note) => {
  rows.push({ name, ok: Boolean(ok), value: value ?? null, note: note ?? null });
  if (!ok) failures.push(`${name}: ${value ?? 'false'}${note ? ` (${note})` : ''}`);
};

/* ── 1. every message is read, proposed and resolved ───────────────────────── */
const decided = [];
/*
 * COLD AND WARM ARE MEASURED SEPARATELY, ON PURPOSE.
 *
 * The first pass over this corpus costs about 12 ms a message and the second
 * about 0.7 ms, and the difference is JIT warm-up inside the router's regexes,
 * not work the decision does. A live server pays the cold number once at boot
 * and the warm number on every turn after it, so asserting on the cold figure
 * would be measuring the sandbox's first 200 milliseconds and calling it the
 * price of a tier decision. Both are reported; the assertion is on the warm one,
 * which is what a turn actually pays.
 */
const coldStartedAt = process.hrtime.bigint();
for (const item of CORPUS) planCollaboration({ message: item.text, locale: 'fa' });
const coldMs = Number(process.hrtime.bigint() - coldStartedAt) / 1e6 / CORPUS.length;

const startedAt = process.hrtime.bigint();
for (const item of CORPUS) {
  const read = planCollaboration({ message: item.text, locale: 'fa' });
  const proposal = proposeIntelligenceMode(read, {
    intentType: item.intent || 'GENERAL',
    execution: Boolean(item.execution),
    parts: item.parts || 1
  });
  const resolved = resolveIntelligenceMode(null, { env: {}, auto: proposal });
  const profile = getIntelligenceProfile(resolved.mode);
  decided.push({
    text: item.text,
    group: item.group,
    expected: item.expect,
    reason: proposal.reason,
    mode: resolved.mode,
    source: resolved.source,
    deadlineMs: intelligenceDeadlineMs(resolved.mode, null, { env: {} }).deadlineMs,
    models: profile.maxModels,
    tokens: intelligenceGeneration(resolved.mode, { maxTokens: 800, taskType: 'general' }).maxTokens,
    reasoning: profile.reasoning === true,
    selfCritique: profile.selfCritique === true,
    kind: read.conversationKind,
    complexity: read.complexity,
    completeness: read.partial?.completeness ?? null,
    needsWeb: Boolean(read.needsWeb)
  });
}
const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
const coldPerMessageMs = coldMs;

check('every message in the corpus was decided', decided.length === CORPUS.length, decided.length, `corpus ${CORPUS.length}`);

/* ── 2. the tier each group lands on ──────────────────────────────────────── */
const wrong = decided.filter((d) => d.mode !== d.expected);
check('every message lands on the tier its shape justifies', wrong.length === 0,
  wrong.length === 0 ? `${decided.length}/${decided.length}` : wrong.map((w) => `${JSON.stringify(w.text)} → ${w.mode} (wanted ${w.expected}, ${w.reason})`).join('; '),
  null);

/* ── 3. the asymmetry: only two shapes are ever discounted ────────────────── */
const discounted = decided.filter((d) => INTELLIGENCE_MODE_RANK[d.mode] < INTELLIGENCE_MODE_RANK.max);
const unsafeDiscount = discounted.filter((d) => !['SOCIAL_TURN', 'SELF_CONTAINED_QUESTION'].includes(d.reason));
check('only a social or self-contained turn is ever discounted', unsafeDiscount.length === 0,
  unsafeDiscount.length === 0 ? `${discounted.length} discounted, all justified` : unsafeDiscount.map((d) => `${JSON.stringify(d.text)}:${d.reason}`).join('; '), null);

for (const group of ['money', 'incomplete', 'research', 'emotional', 'high-stakes', 'compound']) {
  const members = decided.filter((d) => d.group === group);
  const leaked = members.filter((d) => INTELLIGENCE_MODE_RANK[d.mode] < INTELLIGENCE_MODE_RANK.max);
  check(`no ${group} turn is discounted`, members.length > 0 && leaked.length === 0,
    leaked.length === 0 ? `${members.length} kept the full tier` : leaked.map((d) => `${JSON.stringify(d.text)} → ${d.mode}`).join('; '),
    members.length === 0 ? 'the corpus lost this group' : null);
}

/* ── 4. every decision names itself ───────────────────────────────────────── */
const unnamed = decided.filter((d) => !d.reason || d.reason === 'UNNAMED_REASON');
check('every decision carries a reason', unnamed.length === 0, unnamed.length === 0 ? 'all named' : unnamed.map((d) => d.text).join('; '), null);

const silent = decided.filter((d) => d.source === 'auto' && !(d.reason === 'SOCIAL_TURN' || d.reason === 'SELF_CONTAINED_QUESTION'));
check('a discount is never applied without its reason travelling with it', silent.length === 0, silent.length === 0 ? 'ok' : silent.map((d) => d.text).join('; '), null);

/* ── 5. the four invariants of the resolver ───────────────────────────────── */
const socialProposal = { mode: 'swift', reason: 'SOCIAL_TURN' };
const userWins = resolveIntelligenceMode('max', { env: {}, auto: socialProposal });
check('the user\'s own choice is never overruled', userWins.mode === 'max' && userWins.source === 'request' && userWins.auto?.ignored === 'USER_CHOICE_WINS',
  `${userWins.mode}/${userWins.source}/${userWins.auto?.ignored}`, null);

const envWins = resolveIntelligenceMode(null, { env: { FBT_AI_INTELLIGENCE: 'max' }, auto: socialProposal });
check('an operator env pin is never overruled', envWins.mode === 'max' && envWins.source === 'env' && envWins.auto?.ignored === 'OPERATOR_PIN_WINS',
  `${envWins.mode}/${envWins.source}/${envWins.auto?.ignored}`, null);

const upward = resolveIntelligenceMode(null, { env: {}, defaultMode: 'swift', auto: { mode: 'max', reason: 'TEST' } });
check('a proposal can never raise the tier', upward.mode === 'swift' && upward.auto?.ignored === 'AUTO_MAY_ONLY_LOWER',
  `${upward.mode}/${upward.auto?.ignored}`, 'escalation stays a decision somebody makes on purpose');

const untouched = resolveIntelligenceMode(null, { env: {} });
check('with no proposal the resolver behaves exactly as before', untouched.mode === 'max' && untouched.source === 'default' && untouched.auto === null,
  `${untouched.mode}/${untouched.source}/${JSON.stringify(untouched.auto)}`, null);

const unknownMode = resolveIntelligenceMode('not-a-mode', { env: {}, auto: socialProposal });
check('a typo in the preference still does not downgrade anything', unknownMode.rejected === 'UNKNOWN_MODE',
  `${unknownMode.mode}/${unknownMode.rejected}`, null);

/* ── 6. the decision is free ──────────────────────────────────────────────── */
const perMessageMs = elapsedMs / Math.max(1, decided.length);
check('reading the question costs under 2 ms a turn, warm', perMessageMs < 2, `${perMessageMs.toFixed(2)} ms`,
  `measured over ${decided.length} messages; the turn it prices has an 8000 ms floor`);
check('the cold first pass is reported, not hidden', coldPerMessageMs > 0, `${coldPerMessageMs.toFixed(2)} ms`,
  'JIT warm-up, paid once per process, never per turn');

/* ── 7. what the discount actually buys back ──────────────────────────────── */
const greeting = decided.find((d) => d.text === 'سلام');
check('a greeting no longer buys the flagship ladder',
  greeting && greeting.models === 2 && greeting.reasoning === false && greeting.selfCritique === false && greeting.deadlineMs === 8000,
  greeting ? `${greeting.models} models, reasoning ${greeting.reasoning}, critique ${greeting.selfCritique}, ${greeting.deadlineMs} ms window` : 'no greeting row',
  'was 5 models, reasoning on, critique on, 45000 ms');

/* ── 8. the route really calls it ─────────────────────────────────────────── */
const route = readFileSync(path.join(ROOT, 'server', 'aiIntentOS.js'), 'utf8');
const atPropose = route.indexOf('proposeIntelligenceMode(tierRead');
const atResolve = route.indexOf('resolveIntelligenceMode(req.body?.intelligence ?? null, { auto: autoTier })');
check('the chat route proposes before it resolves', atPropose > 0 && atResolve > atPropose, atPropose > 0 && atResolve > atPropose,
  atPropose < 0 ? 'the route never calls the proposal' : `propose@${atPropose} resolve@${atResolve}`);
check('the route hands the proposal the execution signal', /execution:\s*Boolean\(human\?\.actionPlan/.test(route), /execution:\s*Boolean\(human\?\.actionPlan/.test(route),
  'a money-moving turn must be recognised by the route, not only by the conversation kind');
check('the route publishes the decision it made', /autoTier:\s*resolvedIntelligence\.auto/.test(route), /autoTier:\s*resolvedIntelligence\.auto/.test(route),
  'a tier chosen silently is indistinguishable from a tier nobody chose');

/* ── report ──────────────────────────────────────────────────────────────── */
const summary = {
  messages: decided.length,
  discounted: discounted.length,
  social: decided.filter((d) => d.group === 'social').length,
  selfContained: decided.filter((d) => d.group === 'self-contained').length,
  keptFullTier: decided.filter((d) => d.mode === 'max').length,
  perMessageMs: Number(perMessageMs.toFixed(2)),
  coldPerMessageMs: Number(coldPerMessageMs.toFixed(2)),
  greetingWindowMs: greeting?.deadlineMs ?? null,
  greetingTokens: greeting?.tokens ?? null,
  failures: failures.length
};

if (wantJson) {
  process.stdout.write(`${JSON.stringify({ schema: 'fbt.autotier-probe.v1', summary, rows, decided }, null, 2)}\n`);
  process.exit(failures.length > 0 ? 1 : 0);
}

const pad = (v, n) => String(v ?? '').padEnd(n);
console.log('\n  WHAT EACH SHAPE OF QUESTION BUYS\n');
console.log(`  ${pad('message', 46)}${pad('read', 26)}${pad('reason', 36)}${pad('tier', 10)}${pad('models', 8)}${pad('tokens', 8)}window`);
console.log(`  ${'-'.repeat(152)}`);
for (const d of decided) {
  const read = `${d.kind}/${d.complexity}/${d.completeness ?? '-'}${d.needsWeb ? '/web' : ''}`;
  console.log(`  ${pad(JSON.stringify(d.text).slice(0, 44), 46)}${pad(read, 26)}${pad(d.reason, 36)}${pad(d.mode, 10)}${pad(d.models, 8)}${pad(d.tokens, 8)}${d.deadlineMs} ms`);
}
console.log(`\n  ${'-'.repeat(152)}`);
for (const r of rows) console.log(`  ${r.ok ? '✓' : '✗'} ${pad(r.name, 56)} ${pad(r.value, 46)}${r.note || ''}`);
console.log(`\n  ${failures.length === 0 ? 'ALL CHECKS PASSED' : `${failures.length} FAILED`}`);
console.log(`  discounted ${summary.discounted}/${summary.messages} turns · ${summary.perMessageMs} ms warm / ${summary.coldPerMessageMs} ms cold per decision · greeting window ${summary.greetingWindowMs} ms, ${summary.greetingTokens} tokens\n`);
if (failures.length) {
  for (const f of failures) console.log(`  ! ${f}`);
  console.log();
}
process.exit(failures.length > 0 ? 1 : 0);
