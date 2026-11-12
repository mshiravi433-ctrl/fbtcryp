/**
 * WHERE THE PROMPT WEIGHT IS
 * -----------------------------------------------------------------------
 *
 * A `max` turn costs 6 provider calls and about 28,700 prompt characters.
 * The `:free` quota is 50 requests a day, so the prompt weight matters
 * twice over: it eats the daily cap, and it eats the per-request latency
 * budget.
 *
 * This harness splits one real turn's prompts into their parts:
 *
 *   · the ROLE prompt      — the seat's own instructions
 *   · the CONTRACTS        — the JSON shape, the reasoning contract, the
 *                            red-team brief, the economist's lens
 *   · the CONTEXT BLOCK    — the evidence the seat is bound to
 *   · the USER block       — the question itself
 *
 * The question it answers is NOT cosmetic. The expensive part of a
 * prompt is usually the same bytes repeated in every seat, and a repeat
 * is a target: it can be shortened once instead of six times.
 */
import { performance } from 'node:perf_hooks';

const MODE = process.argv[2] || 'max';
const QUESTION = process.argv[3] || 'ریسک لیکوییدیتی در بازار کریپتو چقدر است و چطور مدیریت می‌شود؟';

const FLEET = ['openrouterfree', 'groq', 'workersai'];
const parts = [];
const calls = [];

const roleNameOf = (system) => {
  const first = String(system || '').split('\n')[0] || '';
  if (/Final Answer/i.test(first)) return 'final-answer';
  if (/adversarial|red team/i.test(first)) return 'adversarial';
  if (/Critic/i.test(first)) return 'critic';
  if (/Market/i.test(first)) return 'market';
  if (/Risk/i.test(first)) return 'risk';
  if (/Research/i.test(first)) return 'crypto-research';
  if (/News/i.test(first)) return 'news';
  return first.slice(0, 40) || 'unknown';
};

const deps = {
  selectProviders: () => FLEET.slice(),
  execute: async (providerId, params = {}) => {
    const system = String(params.system || '');
    const user = String(params.user || '');
    const lines = system.split('\n');
    /* The role prompt is the first line; the contracts follow. The context
       block is the part of the USER message that is not the question. */
    const question = (user.match(/USER QUESTION: ([\s\S]*?)\n\n/) || [])[1] || '';
    const contextBlock = user.replace(/USER QUESTION: [\s\S]*?(\n\n|$)/, '').trim();
    const parts_ = {
      roleLen: lines[0]?.length || 0,
      contracts: lines.slice(1).join('\n').length,
      question: question.length,
      context: contextBlock.length
    };
    parts.push({ role: roleNameOf(system), ...parts_, total: system.length + user.length });
    calls.push({ provider: providerId, role: roleNameOf(system) });
    return {
      ok: true,
      provider: providerId,
      model: 'mock/model',
      text: JSON.stringify({
        answer: 'پاسخ آزمایشی برای اندازه‌گیری وزن پرامپت.',
        claims: ['ادعای آزمایشی'],
        uncertainty: 'عدم قطعیت آزمایشی'
      }),
      usage: { prompt_tokens: Math.round((system.length + user.length) / 4), completion_tokens: 100 }
    };
  }
};

process.env.FBT_AI_INTELLIGENCE = MODE;
process.env.FBT_AI_PROVIDERS = 'openrouterfree,groq,workersai';

const { runCollaborativeAnalysis } = await import('../server/aiCollaboration.js');

const t0 = performance.now();
let result = null;
let error = null;
try {
  result = await runCollaborativeAnalysis({
    message: QUESTION,
    locale: 'fa',
    fleet: FLEET,
    deps,
    mode: MODE
  });
} catch (e) {
  error = String(e?.message || e);
}
const wallMs = Math.round(performance.now() - t0);

const sum = (k) => parts.reduce((a, p) => a + (p[k] || 0), 0);
const total = sum('total');
const pct = (n) => (total ? ((n / total) * 100).toFixed(1) : '0.0');

console.log('\nWHERE THE PROMPT WEIGHT IS — mode', MODE);
console.log('question:', QUESTION);
console.log('');
console.log('calls:', calls.length, '| error:', error);
console.log('');
console.log('part            chars      %');
console.log('---------------------------------------');
for (const key of ['roleLen', 'contracts', 'question', 'context']) {
  console.log(key.padEnd(14), String(sum(key)).padStart(7), '  ', pct(sum(key)) + '%');
}
console.log('---------------------------------------');
console.log('total'.padEnd(14), String(total).padStart(7));
console.log('');
console.log('per call:');
for (const p of parts) {
  console.log('  ', String(p.role).padEnd(18), 'role', String(p.roleLen ?? p.role).length, '| contracts', String(p.contracts).length, '| context', String(p.context).length, '| total', p.total);
}
console.log('');
console.log('THE REPEAT TEST — how many times the same block is sent');
const contextBlocks = parts.map((p) => p.context).filter(Boolean);
const unique = new Set(contextBlocks);
console.log('  context blocks sent :', contextBlocks.length);
console.log('  distinct            :', unique.size);
if (contextBlocks.length > 1 && unique.size === 1) {
  console.log('  ⇒ the SAME evidence block goes to every seat.');
  console.log('    Sending it once and referring to it would save',
    Math.round((sum('context') - unique.size ? (contextBlocks.length - 1) * contextBlocks[0].length : 0)), 'chars.');
}
