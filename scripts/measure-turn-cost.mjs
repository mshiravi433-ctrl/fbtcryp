#!/usr/bin/env node
/**
 * How many PROVIDER CALLS does one turn cost, per intelligence mode?
 *
 * WHY THIS SCRIPT EXISTS (2026-11-11)
 * ---------------------------------------------------------------------------
 * The project runs on three free tiers. Two ceilings bind it at once:
 *
 *   • ~8 minutes of CPU per day (Vercel Hobby Fluid Active CPU)
 *   • OpenRouter's free catalogue: 50 requests per day
 *
 * Every claim about "making the AI smarter" has to be priced in one of
 * those two currencies. Measuring the CPU is easy (cold start is 343 ms;
 * the whole lexical corpus searches in 10 ms). Measuring the PROVIDER
 * CALLS is the thing that was never measured — and it is the number that
 * decides whether "smarter" is affordable at all.
 *
 * So this counts the calls, per mode, with every provider mocked. It also
 * measures the prompt weight of each role, because a call that costs 5,677
 * tokens is a different thing from a call that costs 600.
 *
 * It prints a table. The table is the argument.
 */

import { performance } from 'node:perf_hooks';

const MODE = process.argv[2] || 'max';
const QUESTION = process.argv[3] || 'ریسک لیکوییدیتی در بازار کریپتو چقدر است و چطور مدیریت می‌شود؟';

const calls = [];
const promptChars = [];

/** A mocked provider that records what it was asked and answers instantly. */
function makeMockProvider(name) {
  return async (role, params = {}) => {
    calls.push({ name, role, at: Date.now() });
    const prompt = String(
      params.messages?.map((m) => m.content).join('\n') || params.prompt || params.system || ''
    );
    promptChars.push(prompt.length);
    return {
      ok: true,
      provider: name,
      model: 'mock/model',
      answer: `MOCK ANSWER from ${name} for role ${role}: تحلیل چندجانبهٔ ساختگی برای آزمون مسیر.`,
      content: 'متن آزمایشی',
      text: 'متن آزمایشی',
      usage: { prompt_tokens: Math.round(prompt.length / 4), completion_tokens: 100 }
    };
  };
}

/* Map a system prompt back to the role that produced it. The role prompt
   is the head of the system message, so a distinctive slice of it is enough. */
function roleNameOf(system) {
  const head = String(system || '').split('\n')[0] || '';
  for (const [role, marker] of Object.entries(ROLE_MARKERS)) {
    if (head.includes(marker)) return role;
  }
  return head.slice(0, 34) || 'unknown';
}

const ROLE_MARKERS = {
  'market': "You are FBT's Market AI",
  'risk': "You are FBT's Risk AI",
  'crypto-research': "You are FBT's Crypto Research AI",
  'news': "You are FBT's News AI",
  'strategy': "You are FBT's Strategy AI",
  'portfolio': "You are FBT's Portfolio AI",
  'social': "You are FBT's Social AI",
  'emotion': "You are FBT's Emotion AI",
  'situation': "You are FBT's Situation AI",
  'discourse': "You are FBT's Discourse AI",
  'product': "You are FBT's Product AI",
  'dialogue': "You are FBT's Dialogue AI",
  'request': "You are FBT's Request AI",
  'professor': "You are FBT's Professor AI",
  'research': "You are FBT's Research AI",
  'verification': "You are FBT's Verification AI",
  'critic': "You are FBT's Critic AI",
  'final-answer': "You are FBT's Final Answer AI"
};


const FLEET = ['openrouterfree', 'groq', 'workersai'];

/* deps.execute(providerId, params) is the shape the collaboration layer
   actually calls. The mock answers in the shape the pipeline parses. */
const deps = {
  selectProviders: () => FLEET.slice(),
  execute: async (providerId, params = {}) => {
    const prompt = `${params.system || ''}\n${params.user || ''}`;
    promptChars.push(prompt.length);
    /* The role is not passed to the executor, but the role's own prompt is
       the first line of the system message, so the call can still be
       attributed — which is what makes the table readable. */
    calls.push({ name: providerId, role: roleNameOf(params.system) });
    return {
      ok: true,
      provider: providerId,
      model: 'mock/model',
      text: JSON.stringify({
        answer: `پاسخ آزمایشی از ${providerId}: تحلیل چندجانبهٔ ساختگی برای آزمون مسیر و شمارش فراخوانی.`,
        claims: ['ادعای آزمایشی'],
        uncertainty: 'عدم قطعیت آزمایشی'
      }),
      usage: { prompt_tokens: Math.round(prompt.length / 4), completion_tokens: 100 }
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
    intelligence: MODE,
    deps
  });
} catch (err) {
  error = err;
}
const wallMs = performance.now() - t0;

const byRole = {};
for (const c of calls) {
  byRole[c.role] = (byRole[c.role] || 0) + 1;
}
const avgPrompt = promptChars.length
  ? Math.round(promptChars.reduce((a, b) => a + b, 0) / promptChars.length)
  : 0;
const totalPromptChars = promptChars.reduce((a, b) => a + b, 0);

console.log(JSON.stringify({
  mode: MODE,
  question: QUESTION,
  providerCalls: calls.length,
  rolesCalled: Object.keys(byRole).length,
  callsByRole: byRole,
  avgPromptChars: avgPrompt,
  avgPromptTokensEst: Math.round(avgPrompt / 4),
  totalPromptChars,
  wallMs: Math.round(wallMs),
  error: error ? String(error.message || error) : null,
  answerChars: result?.answer ? String(result.answer).length : 0,
  providersUsed: result?.providersUsed?.length ?? null,
  modelsConsulted: result?.modelsConsulted?.length ?? null
}, null, 2));

process.exit(0);
