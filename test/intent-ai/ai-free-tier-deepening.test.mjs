/*
 * THE FREE-TIER DEEPENING PROBE
 * ============================================================================
 *
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * The deployment holds three working keys, all on free tiers: OpenRouter
 * (free catalogue), Groq (free tier) and Cloudflare Workers AI (free tier).
 * Everything else answered 402, 403 or 404.
 *
 * Two facts made the free fleet shallower than it needed to be:
 *
 *   1. THE PAID SEAT WAS CALLING PAID IDS. `openrouter`'s whole model list
 *      was paid ids — `openai/gpt-4o-mini`, `google/gemini-2.5-pro`,
 *      `anthropic/claude-sonnet-4-6`, `x-ai/grok-4`. A free key calling a
 *      paid id answers HTTP 402 "Insufficient Balance", which the gateway
 *      classifies as BILLING — an ACCOUNT-level failure that stops the model
 *      walk immediately rather than stepping to the next id. So the free
 *      key's actual capacity (the `:free` catalogue) was unreachable: there
 *      was no `:free` id anywhere in the registry.
 *
 *   2. THE FREE MODELS WERE CALLED WITHOUT THEIR REASONING KNOB. The
 *      matcher only recognised ids spelling a reasoning family (`gpt-5`,
 *      `o1`..`o9`, `deepseek-r1`, `qwq`, `thinking`). NVIDIA's Nemotron
 *      family — the strongest models on the free tier — matched nothing, so
 *      the gateway could not ask them to reason harder. Cloudflare had no
 *      reasoning branch at all, so its R1 distill ran as a plain chat model.
 *
 * These tests pin the fix. They are about WIRING, not about model quality:
 * no test here can prove that a model is smart, only that the gateway asks
 * the right model, in the right order, with the right knobs.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PROVIDER_CONFIGS,
  getModelCandidates,
  isRetiredModel,
  executeProviderChat,
  getAvailableProviders
} from '../../server/aiGateway.js';
import {
  intelligenceReasoningFields,
  intelligenceModelLadder,
  INTELLIGENCE_MODES
} from '../../server/aiIntelligence.js';
import { resolveProviderFleet, PROVIDER_ALIASES } from '../../server/aiProviderFleet.js';

/* -------------------------------------------------------------------------- */
/*  A. THE FREE SEAT EXISTS, AND SERVES ONLY FREE IDS                        */
/* -------------------------------------------------------------------------- */

test('the free OpenRouter seat exists and is not the paid seat', () => {
  const free = PROVIDER_CONFIGS.openrouterfree;
  assert.ok(free, 'the free seat must be registered');
  assert.equal(free.type, 'openai-compatible');
  assert.equal(free.costTier, 'free');
  assert.notEqual(free.baseModel, PROVIDER_CONFIGS.openrouter.baseModel);
});

test('the free seat reuses the paid seat\'s key — two seats, one key', () => {
  assert.deepEqual(
    PROVIDER_CONFIGS.openrouterfree.envKeys,
    PROVIDER_CONFIGS.openrouter.envKeys
  );
  /* No new secret to store, and no way for the two seats to drift apart on
     credentials: they are literally the same list. */
  assert.ok(PROVIDER_CONFIGS.openrouterfree.envKeys.includes('OPENROUTER_API_KEY'));
});

test('the free seat only ever auto-picks free ids', () => {
  const free = PROVIDER_CONFIGS.openrouterfree;
  const ids = [free.defaultModel, ...free.fallbackModels];
  for (const id of ids) {
    const isFree = String(id).endsWith(':free') || id === 'openrouter/free';
    assert.ok(isFree, `the free seat must not auto-pick a paid id: ${id}`);
  }
  /* And the paid seat's ids must never appear in the free seat's list —
     that is the exact 402 the free seat exists to avoid. */
  const paidIds = new Set([
    PROVIDER_CONFIGS.openrouter.defaultModel,
    ...(PROVIDER_CONFIGS.openrouter.fallbackModels || [])
  ]);
  for (const id of ids) {
    assert.ok(!paidIds.has(id), `${id} is a paid id and would answer 402`);
  }
});

test('the free seat\'s default is a model that is verified to answer', () => {
  /* nvidia/nemotron-3.5-super-vl:free was the only free id that answered
     JSON extraction, a tool call AND a coding task on every attempt across a
     ten-day benchmark. It is the default because "it answered correctly"
     beats "it is the biggest". */
  assert.equal(PROVIDER_CONFIGS.openrouterfree.defaultModel, 'nvidia/nemotron-3.5-super-vl:free');
  assert.ok(!isRetiredModel(PROVIDER_CONFIGS.openrouterfree.defaultModel));
});

test('a withdrawn free id can never be chosen automatically', () => {
  const retired = PROVIDER_CONFIGS.openrouterfree.retiredModels;
  assert.ok(retired.length > 0, 'the free catalogue churns — the retired list must exist');
  for (const id of retired) {
    assert.ok(isRetiredModel(id), `${id} must be recognised as retired`);
  }
  /* An automatic choice must never land on one. */
  for (const candidate of getModelCandidates('openrouterfree')) {
    assert.ok(!retired.includes(candidate), `automatic choice landed on withdrawn id ${candidate}`);
  }
});

test('an explicit withdrawn id is still honoured — a paying account may own it', () => {
  /* The contract that predates every provider here: an explicit request is
     never refused by the automatic-choice filter. */
  const candidates = getModelCandidates('openrouterfree', 'poolside/laguna-s-2.1:free');
  assert.equal(candidates[0], 'poolside/laguna-s-2.1:free');
});

/* -------------------------------------------------------------------------- */
/*  B. THE LADDER PUTS THE DEEPEST FREE MODEL FIRST                          */
/* -------------------------------------------------------------------------- */

test('the free seat has a ladder and it leads with the strongest free model', () => {
  const ladder = intelligenceModelLadder('openrouterfree', 'max');
  assert.ok(ladder.length > 0, 'the free seat must have a ladder');
  assert.equal(ladder[0], 'nvidia/nemotron-3.5-super-vl:free');
  assert.ok(ladder.includes('nvidia/nemotron-3-ultra-550b-a55b:free'));

  /* In `max` the ladder leads the candidate list. */
  const candidates = getModelCandidates('openrouterfree', null, { mode: 'max' });
  assert.equal(candidates[0], ladder[0]);

  /* And the provider's own default is still reachable behind it — the ladder
     is an ORDERING, never a whitelist. */
  assert.ok(candidates.includes(PROVIDER_CONFIGS.openrouterfree.defaultModel));
});

test('balanced and swift keep the historical order on the free seat', () => {
  const historical = getModelCandidates('openrouterfree');
  const balanced = getModelCandidates('openrouterfree', null, { mode: 'balanced' });
  assert.deepEqual(balanced, historical);
  assert.equal(getModelCandidates('openrouterfree', null, { mode: 'swift' })[0], historical[0]);
});

test('every id the free ladder names is a real, non-retired id', () => {
  /* This is the guard the existing suite keeps for every other provider, and
     the free seat must obey it too — a ladder that invents an id would put a
     404 on the wire. */
  const known = new Set([
    PROVIDER_CONFIGS.openrouterfree.defaultModel,
    ...(PROVIDER_CONFIGS.openrouterfree.fallbackModels || []),
    ...(PROVIDER_CONFIGS.openrouterfree.retiredModels || [])
  ]);
  for (const id of intelligenceModelLadder('openrouterfree', 'max')) {
    assert.ok(known.has(id), `the free ladder invents a model id: ${id}`);
    assert.ok(!isRetiredModel(id), `the free ladder uses a withdrawn id: ${id}`);
  }
});

/* -------------------------------------------------------------------------- */
/*  C. THE REASONING KNOB REACHES THE FREE MODELS                            */
/* -------------------------------------------------------------------------- */

test('the free Nemotron models get a reasoning budget in max', () => {
  /* Before this change the matcher recognised no Nemotron id, so the
     strongest free models on the planet were asked for a plain answer. */
  const fields = intelligenceReasoningFields('openrouterfree', 'max', 'nvidia/nemotron-3-ultra-550b-a55b:free');
  assert.deepEqual(fields, { reasoning: { effort: 'high' } });

  assert.deepEqual(
    intelligenceReasoningFields('openrouterfree', 'max', 'nvidia/nemotron-3.5-super-vl:free'),
    { reasoning: { effort: 'high' } }
  );
  assert.deepEqual(
    intelligenceReasoningFields('openrouterfree', 'max', 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free'),
    { reasoning: { effort: 'high' } }
  );
});

test('a non-reasoning free id gets no reasoning field', () => {
  /* A false positive sends a field the model rejects, and that is how a
     "smarter" switch becomes a 400 on every request. */
  assert.deepEqual(
    intelligenceReasoningFields('openrouterfree', 'max', 'google/gemma-4-31b-it:free'),
    {}
  );
  assert.deepEqual(
    intelligenceReasoningFields('openrouterfree', 'max', 'cohere/north-mini-code:free'),
    {}
  );
});

test('swift and balanced send no reasoning fields at all', () => {
  for (const mode of ['swift', 'balanced']) {
    assert.deepEqual(
      intelligenceReasoningFields('openrouterfree', mode, 'nvidia/nemotron-3-ultra-550b-a55b:free'),
      {},
      `${mode} must not ask for reasoning`
    );
  }
});

test('Cloudflare\'s reasoning models get a reasoning effort', () => {
  assert.deepEqual(
    intelligenceReasoningFields('workersai', 'max', '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b'),
    { reasoning_effort: 'high' }
  );
  /* 2026-11-11 — Qwen 3.8 27B is the new Cloudflare flagship. Cloudflare
     documents Reasoning: low | medium | xhigh for it, and it accepts
     `reasoning_effort` exactly as the R1 distill does. */
  assert.deepEqual(
    intelligenceReasoningFields('workersai', 'max', '@cf/qwen/qwen3.8-27b'),
    { reasoning_effort: 'high' }
  );
  /* And its other models stay untouched. */
  assert.deepEqual(
    intelligenceReasoningFields('workersai', 'max', '@cf/meta/llama-3.3-70b-instruct-fp8-fast'),
    {}
  );
});

test('the paid seats are unchanged — this work is additive', () => {
  assert.deepEqual(
    intelligenceReasoningFields('openrouter', 'max', 'deepseek/deepseek-r1'),
    { reasoning: { effort: 'high' } }
  );
  assert.deepEqual(
    intelligenceReasoningFields('groq', 'max', 'openai/gpt-oss-120b'),
    { reasoning_effort: 'high' }
  );
  assert.deepEqual(intelligenceReasoningFields('openai', 'max', 'gpt-4o-mini'), {});
});

/* -------------------------------------------------------------------------- */
/*  D. CLOUDFLARE HAS A FAST SEAT AND A DEEP SEAT                             */
/* -------------------------------------------------------------------------- */

test('the Cloudflare max seat is the reasoning model, not the 8B model', () => {
  const ladder = intelligenceModelLadder('workersai', 'max');
  /* 2026-11-11 — Qwen 3.8 27B took the flagship seat. The R1 distill it
     replaced is scheduled for deprecation on 2026-11-20, so it cannot be the
     seat the smartest mode depends on. */
  assert.equal(ladder[0], '@cf/qwen/qwen3.8-27b');
  assert.ok(ladder.includes('@cf/deepseek-ai/deepseek-r1-distill-qwen-32b'));
  assert.ok(ladder.includes('@cf/meta/llama-3.3-70b-instruct-fp8-fast'));
});

test('every Cloudflare model id in the ladder is spelled the way Cloudflare spells it', () => {
  /* The publisher segment is part of the id: `@cf/deepseek-ai/…`, not
     `@cf/deepseek/…`. A wrong id 404s, and because the gateway walks the
     ladder on a 404, one wrong id makes the provider burn every candidate
     before the router moves on. */
  const ladder = intelligenceModelLadder('workersai', 'max');
  const fallbacks = PROVIDER_CONFIGS.workersai.fallbackModels;
  const all = [...ladder, ...fallbacks];
  for (const id of all) {
    assert.ok(id.startsWith('@cf/'), `${id} must keep the literal @cf/ prefix`);
    assert.ok(/^@cf\/[a-z0-9-]+\/[A-Za-z0-9._:-]+$/.test(id), `${id} must be @cf/<publisher>/<model>`);
  }
  assert.ok(!all.some((id) => id.startsWith('@cf/deepseek/')), 'the wrong publisher spelling must be gone');
});

test('Cloudflare\'s default stays the fast model', () => {
  /* The default is what an unconfigured mode inherits. It must not silently
     become the slowest seat on the fleet. */
  assert.equal(PROVIDER_CONFIGS.workersai.defaultModel, '@cf/meta/llama-3.1-8b-instruct');
  assert.equal(
    getModelCandidates('workersai', null, { mode: 'swift' })[0],
    '@cf/meta/llama-3.1-8b-instruct'
  );
});

test('the Cloudflare model path keeps its literal @ and slashes', () => {
  /* The code-7000 "No route for that URI" bug: the model id IS the URL
     path, so it must never be percent-encoded into one segment. */
  for (const m of PROVIDER_CONFIGS.workersai.fallbackModels) {
    assert.ok(!m.includes('%40'));
    assert.ok(!m.includes('%2F'));
    assert.ok(/^[@A-Za-z0-9][A-Za-z0-9@/._:-]*$/.test(m), `unsafe model id: ${m}`);
  }
});

/* -------------------------------------------------------------------------- */
/*  E. THE FLEET DECLARES THE FREE SEATS                                       */
/* -------------------------------------------------------------------------- */

test('the default fleet is the three seats that answer', () => {
  const fleet = resolveProviderFleet();
  assert.deepEqual(fleet.providers, ['openrouterfree', 'groq', 'workersai']);
  /* The paid seat is out: every id it knows costs money and a free key
     answers 402 on all of them. */
  assert.equal(fleet.providers.includes('openrouter'), false);
});

test('the free seat is nameable by the spellings an operator would type', () => {
  for (const spelling of ['openrouterfree', 'openrouter-free', 'openrouter_free', 'free-router', 'orf']) {
    assert.equal(PROVIDER_ALIASES[spelling], 'openrouterfree', `${spelling} must resolve`);
  }
  /* The paid spelling must still mean the paid seat — two seats, not one
     renamed twice. */
  assert.equal(PROVIDER_ALIASES['openrouter'], 'openrouter');
  assert.notEqual(PROVIDER_ALIASES['openrouter'], PROVIDER_ALIASES['openrouterfree']);
});

test('an operator can still put the paid seat back in the fleet', () => {
  /* Funding the account must not require a code change — the fleet is
     declared, not discovered. */
  const fleet = resolveProviderFleet('openrouter,openrouterfree,groq,workersai');
  assert.deepEqual(fleet.providers, ['openrouter', 'openrouterfree', 'groq', 'workersai']);
});

test('the free seat is reported in the provider panel', () => {
  const row = getAvailableProviders().find((p) => p.id === 'openrouterfree');
  assert.ok(row, 'the panel must show the free seat');
  assert.equal(row.costTier, 'free');
  assert.ok(row.modelCandidates.length > 0);
});

/* -------------------------------------------------------------------------- */
/*  F. THE MODES STILL MEAN WHAT THEY SAY                                      */
/* -------------------------------------------------------------------------- */

test('the max mode still asks for reasoning, and swift still does not', () => {
  assert.equal(INTELLIGENCE_MODES.max.reasoning, true);
  assert.equal(INTELLIGENCE_MODES.swift.reasoning, false);
  assert.equal(INTELLIGENCE_MODES.balanced.reasoning, false);
});

test('the max mode still runs three independent analyses', () => {
  /* The deepening here is about WHICH models and HOW MUCH reasoning, not
     about doing fewer things. */
  assert.equal(INTELLIGENCE_MODES.max.analysesCount, 3);
  assert.equal(INTELLIGENCE_MODES.max.selfCritique, true);
});

test('a free provider call actually reaches the wire with the free model', async () => {
  /* The end-to-end proof that the ladder reaches the request body: the model
     id in the stubbed call must be the free flagship, and the body must
     carry the reasoning field the free models need. */
  const calls = [];
  const originalFetch = globalThis.fetch;
  /* The free seat reads the SAME key as the paid one, so setting it here is
     also a check that the two seats share credentials. */
  const originalKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'sk-or-free-tier-test';
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), body: JSON.parse(opts.body || '{}') });
    return new Response(JSON.stringify({
      choices: [{ message: { content: 'free-answered' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5 }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const res = await executeProviderChat('openrouterfree', {
      system: 's',
      user: 'u',
      json: false,
      intelligence: 'max'
    });
    assert.equal(res.text, 'free-answered');
    assert.ok(calls.length > 0, 'the provider must reach the wire');
    assert.ok(
      calls[0].body.model.endsWith(':free') || calls[0].body.model === 'openrouter/free',
      `the request must carry a free model id, got ${calls[0].body.model}`
    );
    assert.deepEqual(calls[0].body.reasoning, { effort: 'high' });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalKey;
  }
});
