#!/usr/bin/env node
/**
 * THE BUDGET TABLE (2026-11-11)
 * ===========================================================================
 * The project runs on three free tiers. Two ceilings bind it:
 *
 *   • ~8 minutes of CPU per day (Vercel Hobby Fluid Active CPU)
 *   • OpenRouter's free catalogue: 50 requests per day
 *
 * This script measures BOTH sides of the ledger for a spread of realistic
 * questions, with every provider mocked so nothing is spent:
 *
 *   • how many PROVIDER CALLS each question costs, with and without the
 *     local-first gate;
 *   • how much CPU the local path costs (the corpus search, the embedding,
 *     the local reasoner) — because "cheaper" that is not measured is a
 *     claim, not a fact.
 *
 * The output is the table that decides which of the nine external
 * resources are worth their cost.
 *
 *   node scripts/measure-budget.mjs
 */

import { performance } from 'node:perf_hooks';
import { runCollaborativeAnalysis } from '../server/aiCollaboration.js';
import { searchKnowledge } from '../src/lib/intent-ai/os/knowledgeCenter.js';

const FLEET = ['openrouterfree', 'groq', 'workersai'];

function makeFleet() {
  const calls = [];
  const execute = async (providerId, params = {}) => {
    calls.push({ providerId, system: String(params.system || '') });
    return {
      provider: providerId,
      model: 'fake',
      durationMs: 2,
      text: JSON.stringify({ answer: 'پاسخ آزمایشی.', claims: [], uncertainty: '' })
    };
  };
  return { execute, selectProviders: () => FLEET.slice(), calls };
}

/* The question set: ten lookups the verified corpus answers, ten
   judgements/live questions it does not. */
const LOOKUPS = [
  'کارمزد پلتفرم FBT چقدر است',
  'کلید خصوصی من کجا نگهداری می شود',
  'بیت کوین چیست؟',
  'اتریوم چیست؟',
  'استیبل کوین چیست؟',
  'سازندگان FBT چه کسانی هستند',
  'کارمزد شبکه چقدر است؟',
  'سقف برداشت چقدر است؟',
  'کیف پول من کجا ذخیره می شود',
  'آیا پلتفرم غیرامانی است؟'
];
const JUDGEMENTS = [
  'ریسک لیکوییدیتی در بازار کریپتو چقدر است و چطور مدیریت می‌شود؟',
  'بازار امروز چطور است؟',
  'قیمت بیت کوین چنده؟',
  'سناریوهای استراتژی بیت‌کوین چیست؟',
  'با این داده، ریسک ورود به بیت‌کوین چیست؟',
  'پورتفوی من چطور است؟',
  'آیا بخرم؟',
  'چه استراتژی برای نوسانی بودن بازار دارم؟',
  '۱) قیمت BTC چنده؟ ۲) ریسک سبد من چیه؟',
  'بازار فردا کجا می‌رود؟'
];

async function measure(questions, gateOn) {
  if (!gateOn) process.env.AI_LOCAL_FIRST_GATE = '0';
  else delete process.env.AI_LOCAL_FIRST_GATE;
  let totalCalls = 0;
  let local = 0;
  let wall = 0;
  /* WARM-UP: the first TWO turns pay for importing the reading layer and
     for the JIT, which are ONE-TIME costs per process, not per-turn costs.
     Measuring them as if they were per-turn made the local path look four
     times slower than it is (541 ms and 76 ms on the first two turns,
     then ~10 ms steady-state). */
  for (const warm of ['گرم کردن', 'کارمزد پلتفرم FBT چقدر است؟']) {
    await runCollaborativeAnalysis({
      message: warm, locale: 'fa', intelligence: 'max', deps: makeFleet()
    });
  }
  for (const q of questions) {
    const fleet = makeFleet();
    const t0 = performance.now();
    const out = await runCollaborativeAnalysis({
      message: q, locale: 'fa', intelligence: 'max', deps: fleet
    });
    wall += performance.now() - t0;
    totalCalls += fleet.calls.length;
    if (out.localFirst?.used) local += 1;
  }
  return { totalCalls, local, wall: Math.round(wall), count: questions.length };
}

/* The local path's own cost, measured directly. */
function measureLocalCost() {
  const t0 = performance.now();
  for (let i = 0; i < 1000; i += 1) searchKnowledge(LOOKUPS[i % LOOKUPS.length], { limit: 3 });
  const searchMs = (performance.now() - t0) / 1000;
  return { searchMsPerCall: Number(searchMs.toFixed(4)) };
}

const withGate = await measure([...LOOKUPS, ...JUDGEMENTS], true);
const withoutGate = await measure([...LOOKUPS, ...JUDGEMENTS], false);
const localCost = measureLocalCost();

const table = [
  ['questions measured', withGate.count],
  ['provider calls WITHOUT the gate', withoutGate.totalCalls],
  ['provider calls WITH the gate', withGate.totalCalls],
  ['calls saved', withoutGate.totalCalls - withGate.totalCalls],
  ['questions answered locally', withGate.local],
  ['local rate', `${Math.round((withGate.local / withGate.count) * 100)}%`],
  ['pipeline wall time WITHOUT the gate (ms)', withoutGate.wall],
  ['pipeline wall time WITH the gate (ms)', withGate.wall],
  ['lexical corpus search per call (ms)', localCost.searchMsPerCall]
];

console.log('\nTHE BUDGET TABLE — 20 realistic questions, every provider mocked\n');
for (const [k, v] of table) console.log(`  ${String(k).padEnd(42)} ${v}`);
console.log(`\n  OpenRouter :free cap = 50 requests/day`);
console.log(`  ⇒ days of ${withoutGate.totalCalls === 0 ? '∞' : (50 / (withoutGate.totalCalls / withGate.count)).toFixed(1)} questions/day WITHOUT the gate`);
console.log(`  ⇒ days of ${(50 / (withGate.totalCalls / withGate.count)).toFixed(1)} questions/day WITH the gate`);
console.log('');
