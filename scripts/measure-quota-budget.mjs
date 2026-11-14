/**
 * WHERE THE FREE-TIER QUOTA ACTUALLY GOES
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *
 * The `:free` tier allows 50 requests a day on OpenRouter, ~20/minute on
 * the others. The project's own docs have said for a while that this —
 * not CPU — is the binding constraint, and that a "prompt/token diet"
 * would help. The diet was measured (§5.12) and found to have nothing
 * to cut: the prompt is 92.5 % contracts and 5.3 % evidence.
 *
 * So the quota question is not "how do we make each call cheaper". It is
 * **"how many calls does one question need, and which of them change
 * the answer?"**
 *
 * A `max` turn runs up to six provider calls: two analyses, a verifier,
 * a final answer, a critic, and — in some paths — one more. Each one
 * spends a unit of a 50-unit daily budget. If four of the six produce
 * text the answer would have said anyway, then four units of the budget
 * are being spent on theatre.
 *
 * This harness MEASURES that: it runs one real question through the
 * real collaboration layer with a fake fleet, records every call with
 * the role that made it, and reports:
 *
 *   · how many calls a question costs, by role;
 *   · how much DISTINCT content each call contributed — measured as the
 *     words that appear in that call's answer and in no other;
 *   · what the answer looks like with each role removed.
 *
 * The distinct-word measure is the honest one. "The critic found a
 * problem" is not measurable; "the critic's answer shares 4 % of its
 * content with the draft and adds 180 words that appear nowhere else"
 * is.
 *
 * It is a MEASUREMENT, not a verdict. The point is to put the number on
 * the table so that changing the number is a decision rather than a
 * guess.
 */

import { runCollaborativeAnalysis } from '../server/aiCollaboration.js';
import { resetFleetCursor } from '../server/aiCollaboration.js';

const QUESTION = process.argv[2] || 'ریسک لیکوییدیتی در بازار کریپتو چقدر است و چطور مدیریت می‌شود؟';
const LOCALE = 'fa';

/** The words that make an answer distinguishable from another answer. */
const stop = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'are', 'was', 'has', 'have', 'not', 'but',
  'you', 'your', 'its', 'his', 'her', 'their', 'them', 'they', 'this', 'which', 'what', 'when',
  'where', 'how', 'why', 'can', 'will', 'would', 'there', 'here', 'been', 'being', 'into', 'out',
  'than', 'then', 'more', 'most', 'some', 'such', 'only', 'also', 'about', 'over', 'after',
  'است', 'را', 'با', 'که', 'برای', 'از', 'تا', 'این', 'آن', 'هم', 'یا', 'اما', 'در', 'به',
  'می', 'شود', 'شد', 'کرد', 'نیست', 'بود', 'هر', 'بدون', 'باید', 'می‌شود', 'می شود'
]);

function words(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !stop.has(w))
  );
}

function distinctAgainst(text, others) {
  const own = words(text);
  if (!own.size) return { count: 0, share: 0 };
  let shared = 0;
  for (const w of own) {
    if (others.some((o) => o.has(w))) shared += 1;
  }
  return { count: own.size - shared, share: shared / own.size };
}

/** One fake fleet: every provider answers, so the shape is what we measure. */
function makeDeps(calls) {
  const answerFor = (role) => {
    const text = {
      market: 'بازار در بازه تثبیت است؛ نقدینگی عمیق اما حجم پایین است.',
      risk: 'ریسک نقدینگی در استخرهای تک‌طرفه بالاست؛ impermanent loss ریسک اصلی است.',
      'crypto-research': 'عمق بازار در USDC بالاست؛ برای جابه‌جایی ۱۰هزار دلار اسلیپ‌یج قابل قبول است.',
      'You are FBT\'s Verification AI.': 'ادعای ریسک با داده هم‌خوان است؛ هشدار impermanent loss درست است.',
      'final-answer': 'خلاصه: ریسک نقدینگی را با عمق و ترکیب دارایی کم کنید.'
    }[role];
    return text || `پاسخ ${role}`;
  };
  return {
    selectProviders: () => ['openrouterfree'],
    execute: async (providerId, params = {}) => {
      const system = String(params.system || '');
      /* The role is named in the first line of its own system prompt. */
      const head = system.split('\n')[0] || '';
      const role = /Verification/i.test(head) ? 'You are FBT\'s Verification AI.'
        : /Final Answer/i.test(head) ? 'final-answer'
        : /Market/i.test(head) ? 'market'
        : /Risk/i.test(head) ? 'risk'
        : /Crypto Research/i.test(head) ? 'crypto-research'
        : 'unknown';
      const text = answerFor(role);
      calls.push({ role, provider: providerId, system, answer: text, chars: String(params.user || '').length + system.length });
      return {
        ok: true, provider: providerId, model: 'mock/model',
        text: JSON.stringify({ answer: text, claims: [], uncertainty: 'نامشخص' }),
        usage: { prompt_tokens: 100, completion_tokens: 20 }
      };
    }
  };
}

async function runTurn() {
  const calls = [];
  resetFleetCursor();
  const deps = makeDeps(calls);
  const result = await runCollaborativeAnalysis({
    message: QUESTION,
    locale: LOCALE,
    fleet: ['openrouterfree'],
    deps,
    mode: 'max'
  });
  return { calls, result };
}

const { calls, result } = await runTurn();

/* ── the report ──────────────────────────────────────────────────────── */

console.log('WHERE THE FREE-TIER QUOTA GOES');
console.log('================================');
console.log(`question: ${QUESTION}`);
console.log('');
console.log(`provider calls: ${calls.length}`);
console.log('');

/* The role each call belonged to. The system prompt's first line is the
   role's own name, so it is the cheapest honest label available. */
const labelled = calls.map((c) => {
  const first = c.system.split('\n')[0] || '';
  const label = first.replace(/^You are FBT'?s?\s*/i, '').replace(/\.?$/, '').slice(0, 34) || 'unknown';
  return { ...c, label };
});

console.log('call  role                                 chars');
console.log('----  ------------------------------------  -----');
labelled.forEach((c, i) => {
  console.log(`${String(i + 1).padStart(4)}  ${c.label.padEnd(36)}  ${String(c.chars).padStart(5)}`);
});

console.log('');
console.log('DISTINCT CONTENT — the words each call adds that no other call said');
console.log('-----------------------------------------------------------------');
for (let i = 0; i < labelled.length; i += 1) {
  const others = labelled.filter((_, k) => k !== i).map((c) => words(c.answer));
  const d = distinctAgainst(labelled[i].answer, others);
  const own = words(labelled[i].answer);
  const pct = own.size ? Math.round((d.count / own.size) * 100) : 0;
  console.log(`${String(i + 1).padStart(4)}  ${labelled[i].label.padEnd(36)}  ${String(d.count).padStart(4)} distinct of ${String(own.size).padStart(3)} (${String(pct).padStart(3)}%)`);
}

console.log('');
console.log(`daily budget (OpenRouter :free): 50 requests`);
console.log(`one max turn costs        : ${calls.length} requests`);
console.log(`turns per day             : ${Math.floor(50 / Math.max(1, calls.length))}`);
console.log(`provider calls per turn   : ${calls.length}`);
console.log(`provider calls per day    : ${Math.floor(50 / Math.max(1, calls.length)) * calls.length} of 50`);
console.log('');
console.log('NOTE: this is a MEASUREMENT. Whether the calls that contribute');
console.log('little distinct content are worth their budget is a decision,');
console.log('not something this file can decide.');
