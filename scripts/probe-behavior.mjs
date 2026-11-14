#!/usr/bin/env node
/*
 * DOES THE SYSTEM LEARN WHO THE USER IS?
 * ==========================================================================
 *
 * `server/fios/behavior.js` categorises what a user DOES — fourteen signals,
 * each needing three verified samples, each mapped to the preference it should
 * write. `server/fios/personalProfile.js` assembles those into the profile the
 * fit engine scores against. Both were complete. Neither was ever fed:
 *
 *   · `behavior.ingest` was reachable only from `learning.learn`, which only an
 *     HTTP POST to `/learning` and the evaluation engine called — so a user
 *     confirming an execution through the brain fed no model;
 *   · `memoryKey`/`memoryValue` appear nowhere outside `behavior.js`, so even a
 *     computed signal was dropped instead of written, and `preferences.resolve`
 *     could never return a behaviour-derived value despite MEMORY_PROVENANCE
 *     reserving USER_BEHAVIOR for exactly that.
 *
 * The symptom was visible in a headline: «۵ گزینه با پروفایل ریسک خوانده‌نشده
 * سنجیده شد» — an engine scoring opportunities against a profile it could not
 * read.
 *
 * This probe drives REAL turns and REAL confirmations through the real brain and
 * the real composition root, and asks four questions:
 *
 *   1. does a decision reach the model at all?
 *   2. do three decisions produce a SIGNAL?
 *   3. does the signal become a PREFERENCE the fit engine can read?
 *   4. does what the user SAID survive what the user DID?   (§8: learning is
 *      not authority — a behaviour record must never downgrade USER_SAID)
 *
 * Plus the cost, because a side-effect on the confirmation path is a latency
 * question and not a free one.
 *
 * Usage:  node scripts/probe-behavior.mjs [--json]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AS_JSON = process.argv.includes('--json');

const { installFakes } = await import(path.join(ROOT, 'test', 'intent-ai', 'ci-fakes.mjs'));
const { setCiSource } = await import(path.join(ROOT, 'server', 'ci', 'sources.js'));
for (const [name, fn] of Object.entries(installFakes())) setCiSource(name, fn);

const { createCentralBrain } = await import(path.join(ROOT, 'server', 'ci', 'brain.js'));
const { createCentralStateStore } = await import(path.join(ROOT, 'server', 'ci', 'stateStore.js'));
const { createFinancialIntelligence } = await import(path.join(ROOT, 'server', 'fios', 'index.js'));
const { hasBehaviorReporter, readBehaviorSignals } = await import(path.join(ROOT, 'server', 'ci', 'learningBridge.js'));

const stateStore = createCentralStateStore();
const brain = createCentralBrain({ stateStore });
/* The REAL composition root — the fit, macro, scenario and now behaviour
   providers are wired by it. A fake provider would mirror the implementation
   and hide the mismatch. */
const fi = createFinancialIntelligence({ stateStore, brain, ownerFor: (o) => o, log: () => {} });

const now = Date.now();
async function seed(owner, { riskProfile = null } = {}) {
  await stateStore.write(owner, 'wallet', {
    data: { addresses: { evm: ['0x1111111111111111111111111111111111111111'] }, connected: true },
    source: 'probe-wallet', status: 'OK', now: Date.now()
  });
  await stateStore.write(owner, 'portfolio', {
    data: {
      holdings: [
        { symbol: 'BTC', amount: 0.25, valueUsd: 9000, chainId: 1, priceUsd: 36000 },
        { symbol: 'USDC', amount: 1000, valueUsd: 1000, chainId: 1, priceUsd: 1 }
      ],
      totalValueUsd: 10000, dataStatus: 'live'
    },
    source: 'probe-portfolio', status: 'OK', now: Date.now()
  });
  await stateStore.write(owner, 'markets', {
    data: { prices: { BTC: { priceUsd: 36000 }, ETH: { priceUsd: 3000 }, USDC: { priceUsd: 1 } }, bySymbol: {} },
    source: 'probe-markets', status: 'OK', now: Date.now()
  });
  if (riskProfile) {
    await stateStore.write(owner, 'riskProfile', { data: riskProfile, source: 'probe', status: 'OK', now: Date.now() });
  }
}

/** Ask for a swap, then confirm or cancel the card the brain produced. */
async function decide(owner, { message, accept, asset = 'BTC' }) {
  const turn = await brain.handle({ owner, message, locale: 'fa' });
  /* The card the brain created for this turn. `createdAction` is the field the
     turn actually carries — reading `action` silently produced NO_ACTION_CARD
     for every decision, and a probe that cannot find its own subject reports a
     failure that is not in the product. */
  const actionId = turn?.createdAction?.actionId || turn?.action?.actionId || null;
  if (!actionId) return { ok: false, code: 'NO_ACTION_CARD', turn };
  const startedAt = Date.now();
  const out = accept
    ? await brain.confirmAction({ owner, actionId, execute: false })
    : await brain.cancelAction({ owner, actionId, reason: 'probe: the user changed their mind' });
  return { ok: out?.ok === true, out, actionId, asset, tookMs: Date.now() - startedAt };
}

const rows = [];
function record(name, value, ok, note = '') {
  rows.push({ name, value, ok, note });
}

/* ── 0. is the model mounted at all? ─────────────────────────────────────── */
record('model mounted in the composition root', hasBehaviorReporter(), hasBehaviorReporter() === true);

/* ── 1. a fresh owner knows nothing about itself ─────────────────────────── */
const fresh = 'beh-fresh';
await seed(fresh);
const beforeSignals = await readBehaviorSignals(fresh);
record('a fresh owner has no signals', Object.keys(beforeSignals.signals || {}).length,
  Object.keys(beforeSignals.signals || {}).length === 0,
  `events=${beforeSignals.events ?? 0}, minSamples=${beforeSignals.minSamples ?? '—'}`);

/* ── 2. three REJECTIONS of a high-risk proposal ─────────────────────────── */
/*
 * This is the chain that matters, and it is the one that ends in a preference.
 *
 * REJECTS_HIGH_RISK_PROTOCOLS needs three proposals carrying a HIGH/CRITICAL
 * risk level of which ≥66% were rejected — and the swap card the brain creates
 * for a concentrated BTC portfolio IS assessed HIGH by the risk engine. The
 * signal then carries `memoryKey: 'riskTolerance', memoryValue: 'CONSERVATIVE'`,
 * which is the write that had never happened anywhere in the codebase.
 *
 * Three rejections also give CANCELS_AT_CONFIRMATION a ratio of 1.0, over its
 * 0.4 floor. (Two acceptances and one rejection gives 0.33 and correctly
 * produces NO signal — a model that fires on a third of the evidence is a model
 * that guesses.)
 */
const cons = 'beh-conservative';
await seed(cons);
let rejected = 0;
const rejectLatencies = [];
for (let i = 0; i < 3; i += 1) {
  const d = await decide(cons, { message: '۱۰۰ دلار بیت کوین بخر', accept: false });
  if (d.ok) rejected += 1;
  else record(`rejection ${i + 1} reached the model`, d.code || 'failed', false, 'no action card was produced');
  if (d.tookMs != null) rejectLatencies.push(d.tookMs);
}
const consSignals = await readBehaviorSignals(cons);
const consKeys = Object.keys(consSignals.signals || {});
record('three rejections were recorded as events', rejected, rejected === 3);
record('the high-risk rejection was categorised', Boolean(consSignals.signals?.REJECTS_HIGH_RISK_PROTOCOLS),
  Boolean(consSignals.signals?.REJECTS_HIGH_RISK_PROTOCOLS), JSON.stringify(consKeys));
record('the cancellation ratio was categorised', Boolean(consSignals.signals?.CANCELS_AT_CONFIRMATION),
  Boolean(consSignals.signals?.CANCELS_AT_CONFIRMATION),
  consSignals.signals?.CANCELS_AT_CONFIRMATION ? `ratio=${consSignals.signals.CANCELS_AT_CONFIRMATION.ratio}` : '—');

/* ── 3. did the signal become a PREFERENCE? (the link that never existed) ── */
const prefs = await fi.preferences.resolve(cons).catch(() => null);
const origins = prefs?.origins || {};
const behaviorDerived = Object.entries(origins).filter(([, v]) => v === 'USER_BEHAVIOR');
record('a behaviour signal reached the preference model', prefs?.riskTolerance,
  behaviorDerived.length > 0,
  behaviorDerived.length ? behaviorDerived.map(([k]) => `${k}=${prefs[k]} (${origins[k]})`).join(', ') : 'no USER_BEHAVIOR origin');

/* ── 4. and does the FIT ENGINE finally read a profile? ──────────────────── */
/*
 * The visible symptom of this whole chain being dark was a headline that said
 * «۵ گزینه با پروفایل ریسک خوانده‌نشده سنجیده شد» — the fit engine scoring
 * opportunities against a profile it could not read. That is the end-to-end
 * proof: the behaviour model is not an audit trail, it is what makes
 * personalisation possible at all.
 */
/* `fitFor` nests its answer under `result` — reading `fitOut.riskTolerance`
   reported "unreachable" for a call that had in fact succeeded, which is the
   same class of mistake as reading `turn.action` instead of
   `turn.createdAction`: a probe that cannot find its own subject reports a
   failure that is not in the product. */
const fitOut = fi.fitFor ? await fi.fitFor(cons).catch(() => null) : null;
const fitResult = fitOut?.result || fitOut || null;
const fitRisk = fitOut?.ok === true ? (fitResult?.riskTolerance || null) : null;
const fitValue = fitOut?.ok === true
  ? (fitRisk || 'profile read but no riskTolerance')
  : (fitOut?.ok === false ? `${fitOut.code}` : 'fitFor not reachable from the root');
record('the fit engine can now read a risk profile', fitValue,
  fitOut?.ok === true && Boolean(fitRisk),
  fitOut?.ok === true
    ? `ranked=${(fitResult?.ranked || []).length}, coverage.profileReadable=${fitResult?.coverage?.profileReadable}`
    : `fit: ${fitOut?.code || fitOut?.detail || 'not reachable from the root'}`);

/* ── 5. three confirmations → the asset preference ───────────────────────── */
const majors = 'beh-majors';
await seed(majors);
let confirmed = 0;
const confirmLatencies = [];
for (let i = 0; i < 3; i += 1) {
  const d = await decide(majors, { message: '۱۰۰ دلار بیت کوین بخر', accept: true });
  if (d.ok) confirmed += 1;
  if (d.tookMs != null) confirmLatencies.push(d.tookMs);
}
const majorSignals = await readBehaviorSignals(majors);
record('three confirmations were recorded', confirmed, confirmed === 3);
/* PREFERS_MAJOR_ASSETS carries no memoryKey by design — it describes the user,
   it does not claim to know a preference they never expressed. So this signal
   must NOT produce a preference write, and that absence is the assertion. */
record('the asset preference was categorised', Boolean(majorSignals.signals?.PREFERS_MAJOR_ASSETS),
  Boolean(majorSignals.signals?.PREFERS_MAJOR_ASSETS), JSON.stringify(Object.keys(majorSignals.signals || {})));
const majorPrefs = await fi.preferences.resolve(majors).catch(() => null);
const majorBehaviorWrites = Object.values(majorPrefs?.origins || {}).filter((v) => v === 'USER_BEHAVIOR').length;
record('a descriptive signal writes no preference', majorBehaviorWrites, majorBehaviorWrites === 0,
  'PREFERS_MAJOR_ASSETS has no memoryKey, so nothing is claimed');

/* ── 6. §8 — what the user SAID must survive what the user DID ───────────── */
const said = 'beh-said';
await seed(said);
await fi.memory.remember(said, { key: 'riskTolerance', value: 'AGGRESSIVE', provenance: 'USER_SAID', note: 'probe: the user said it' }).catch(() => {});
for (let i = 0; i < 4; i += 1) await decide(said, { message: '۱۰۰ دلار بیت کوین بخر', accept: false });
const afterPrefs = await fi.preferences.resolve(said).catch(() => null);
record('USER_SAID outranks USER_BEHAVIOR', afterPrefs?.riskTolerance,
  afterPrefs?.riskTolerance === 'AGGRESSIVE', `origin=${afterPrefs?.origins?.riskTolerance || '—'}`);

/* ── 7. the cost on the confirmation path ────────────────────────────────── */
const allLatencies = [...rejectLatencies, ...confirmLatencies].filter((n) => Number.isFinite(n));
const meanMs = allLatencies.length ? Math.round(allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length) : null;
record('mean cost of a decision turn (ms)', meanMs, meanMs === null || meanMs < 250, `n=${allLatencies.length}`);

/* ── the report ──────────────────────────────────────────────────────────── */
const failed = rows.filter((r) => r.ok === false);

if (AS_JSON) {
  console.log(JSON.stringify({
    rows,
    summary: {
      checks: rows.length,
      failed: failed.length,
      mounted: hasBehaviorReporter(),
      signalsAfterThreeRejections: consKeys.length,
      signalsAfterThreeConfirmations: Object.keys(majorSignals.signals || {}).length,
      behaviorDerivedPreferences: behaviorDerived.length,
      riskToleranceLearned: prefs?.riskTolerance || null,
      fitCanReadProfile: fitOut?.ok === true && Boolean(fitRisk),
      fitRanked: (fitResult?.ranked || []).length,
      descriptiveSignalWroteNothing: majorBehaviorWrites === 0,
      saidSurvived: afterPrefs?.riskTolerance === 'AGGRESSIVE',
      meanDecisionMs: meanMs
    }
  }, null, 2));
  process.exit(failed.length ? 1 : 0);
}

console.log('');
console.log('  DOES THE SYSTEM LEARN WHO THE USER IS?');
console.log('  ' + '='.repeat(78));
for (const r of rows) {
  console.log(`  ${r.ok === false ? '✗' : '·'} ${r.name.padEnd(48)} ${String(r.value).padEnd(12)} ${r.note}`);
}
console.log('  ' + '-'.repeat(78));
console.log(`  checks                    ${rows.length}`);
console.log(`  failed                    ${failed.length}`);
console.log(`  signals from 3 rejections  ${consKeys.length}  ${consKeys.join(', ')}`);
console.log(`  riskTolerance learned      ${prefs?.riskTolerance || '—'}  (${origins?.riskTolerance || 'no origin'})`);
console.log(`  behaviour-derived prefs    ${behaviorDerived.length}`);
console.log(`  fit can read the profile   ${fitOut?.ok === true && Boolean(fitRisk) ? `yes (${fitRisk})` : `no (${fitValue})`}`);
console.log(`  USER_SAID survived         ${afterPrefs?.riskTolerance === 'AGGRESSIVE' ? 'yes' : 'NO'}`);
console.log(`  mean decision turn         ${meanMs ?? '—'} ms`);
console.log('');
process.exit(failed.length ? 1 : 0);
