/**
 * THE REASONING CAPACITY PROBE
 * ---------------------------------------------------------------------------
 * Lever #4 of docs/AI-COGNITION-AUDIT-2026-11-11.md: the OPEN lever.
 *
 * Levers #1-#3 are done: the corpus grew, the semantic recall is wired, and
 * the identical-payload retries are gone. What is left is the one thing none
 * of them could touch:
 *
 *     THE REASONING CAPACITY OF THE FREE SEATS.
 *
 * The audit's benchmark (server/aiBenchmark.js) scores grounding 30, quality
 * 25, honesty 20, safety 15, attribution 10 — it measures whether the
 * assistant is GROUNDED and HONEST, which is what it was built to measure.
 * It does NOT measure whether the model can REASON, and it cannot detect a
 * reasoning seat that is quietly weaker than another.
 *
 * So this probe measures the thing the rubric ignores, against the LIVE
 * free seats:
 *
 *   1. does the seat answer a multi-step reasoning task at all?
 *   2. does it return STRUCTURED output (the pipeline needs JSON)?
 *   3. does it emit a REASONING TRACE (the seat may be silently ignoring
 *      `reasoning_effort`)?
 *   4. how long does it take, and how many tokens does it burn?
 *
 * The point of #3 is the one that matters operationally. The gateway sends
 * `reasoning_effort: 'high'` to every seat that claims to support it. If a
 * seat accepts the field and silently ignores it, then "smarter mode" is a
 * fiction on that seat — and the fix is not code, it is SEAT SELECTION.
 *
 * Usage:
 *   node scripts/measure-reasoning-capacity.mjs            # all free seats
 *   node scripts/measure-reasoning-capacity.mjs groq       # one seat
 *   node scripts/measure-reasoning-capacity.mjs --json     # machine readable
 *
 * It needs the provider keys. With no keys it reports the seats as
 * unconfigured rather than failing.
 */

import { PROVIDER_CONFIGS, isProviderConfigured } from '../server/aiGateway.js';
import { intelligenceReasoningFields } from '../server/aiIntelligence.js';

/* -------------------------------------------------------------------------- */
/*  THE PROBE                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A task that CANNOT be answered by recall. It needs the model to hold three
 * facts in mind, apply a rule to each, and combine the results — and it has
 * an exactly checkable answer, so a wrong answer is a wrong answer rather
 * than a matter of taste.
 */
const REASONING_TASK = {
  name: 'three-step numeric rule application',
  system:
    'You are a careful reasoner. Solve the problem step by step. ' +
    'Return ONLY a JSON object with the keys "steps" (array of strings) and "answer" (number). ' +
    'No text outside the JSON.',
  user:
    'A trader has three positions. ' +
    'Position A has a balance of 120 and is exposed to a factor of 2. ' +
    'Position B has a balance of 80 and is exposed to a factor of 3. ' +
    'Position C has a balance of 45 and is exposed to a factor of 4. ' +
    'For each position, multiply its balance by its factor, then subtract 15 from ' +
    'that product. Sum the three results. ' +
    'What is the total? Work it out and give the final number.'
};

/** The expected total: (120*2-15) + (80*3-15) + (45*4-15) = 225 + 225 + 165 = 615. */
const EXPECTED_ANSWER = 615;

/**
 * A second task that probes SUSTAINED structure: the model must keep a
 * JSON schema over a long output. The pipeline's roles are long-form
 * (market analysis, risk assessment, a final answer with claims), so a seat
 * that degrades after ~500 tokens is a real constraint.
 */
const STRUCTURE_TASK = {
  name: 'long structured output with strict schema',
  system:
    'You write structured analysis. Return ONLY a JSON object with the key "items", ' +
    'an array of exactly 6 objects, each with "index" (number) and "finding" (string, ' +
    'at least 25 words). No text outside the JSON.',
  user:
    'Write six distinct findings about risk management in crypto markets. ' +
    'Each finding must be a complete sentence of at least 25 words.'
};

/* -------------------------------------------------------------------------- */
/*  THE SEATS                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The free seats, with the models worth probing. These are the ids the
 * gateway can actually reach on a free key — a paid id would answer 402 and
 * tell us nothing.
 */
const SEATS = [
  {
    provider: 'groq',
    label: 'Groq — gpt-oss-120b (reasoning_effort: high)',
    models: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b']
  },
  {
    provider: 'workersai',
    label: 'Cloudflare — qwen3.8-27b (reasoning_effort: high)',
    models: ['@cf/qwen/qwen3.8-27b', '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b', '@cf/meta/llama-3.3-70b-instruct-fp8-fast']
  },
  {
    provider: 'openrouterfree',
    label: 'OpenRouter :free — nemotron super-vl (reasoning.effort: high)',
    models: [
      'nvidia/nemotron-3.5-super-vl:free',
      'nvidia/nemotron-3.5-ultra-550b-a55b:free',
      'nvidia/nemotron-3.5-lightning:free'
    ]
  }
];

/* -------------------------------------------------------------------------- */
/*  THE CALLERS — the same shapes the gateway uses                            */
/* -------------------------------------------------------------------------- */

function cloudflareUrl(model) {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID || '';
  return `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`;
}

async function callSeat(seat, model, task, { timeoutMs = 45000 } = {}) {
  const cfg = PROVIDER_CONFIGS[seat.provider];
  const reasoning = intelligenceReasoningFields(seat.provider, 'max', model);
  const started = Date.now();

  let url;
  let headers = { 'content-type': 'application/json' };
  let body;

  if (seat.provider === 'workersai') {
    url = cloudflareUrl(model);
    headers.Authorization = `Bearer ${process.env.CLOUDFLARE_API_TOKEN || ''}`;
    body = {
      messages: [
        { role: 'system', content: task.system },
        { role: 'user', content: task.user }
      ],
      max_tokens: 1400,
      ...(reasoning.reasoning_effort ? { reasoning_effort: reasoning.reasoning_effort } : {})
    };
  } else {
    url = cfg.url;
    headers.Authorization = `Bearer ${process.env[cfg.envKey] || ''}`;
    body = {
      model,
      messages: [
        { role: 'system', content: task.system },
        { role: 'user', content: task.user }
      ],
      temperature: 0.2,
      max_tokens: 1400,
      response_format: { type: 'json_object' },
      ...(reasoning.reasoning ? { reasoning: reasoning.reasoning } : {}),
      ...(reasoning.reasoning_effort ? { reasoning_effort: reasoning.reasoning_effort } : {})
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const raw = await res.text();
    const latencyMs = Date.now() - started;

    if (!res.ok) {
      return { ok: false, status: res.status, latencyMs, error: raw.slice(0, 200) };
    }

    let payload;
    try { payload = JSON.parse(raw); } catch { payload = null; }

    /* The two response shapes: OpenAI-compatible vs Workers AI. */
    const content =
      payload?.choices?.[0]?.message?.content
      ?? payload?.result?.response
      ?? '';
    const reasoningTrace =
      payload?.choices?.[0]?.message?.reasoning_content
      ?? payload?.choices?.[0]?.message?.reasoning
      ?? payload?.result?.reasoning
      ?? null;

    return {
      ok: true,
      latencyMs,
      content: String(content || ''),
      reasoningTrace: reasoningTrace ? String(reasoningTrace) : null,
      usage: payload?.usage || payload?.result?.usage || null
    };
  } catch (err) {
    return { ok: false, status: 0, latencyMs: Date.now() - started, error: String(err?.message || err).slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}

/* -------------------------------------------------------------------------- */
/*  THE SCORING                                                                */
/* -------------------------------------------------------------------------- */

/** Pull the numeric answer out of whatever the model returned. */
function extractAnswer(content) {
  let parsed = null;
  try { parsed = JSON.parse(content); } catch { /* not pure JSON */ }

  if (parsed && typeof parsed.answer === 'number') return parsed.answer;
  if (parsed && typeof parsed.answer === 'string' && /^-?\d+(\.\d+)?$/.test(parsed.answer.trim())) {
    return Number(parsed.answer.trim());
  }
  /* The JSON may be wrapped in prose or a fence — look for the first number
     that follows an "answer" key. */
  const m = content.match(/"answer"\s*:\s*"?(-?\d+(?:\.\d+)?)"?/i);
  if (m) return Number(m[1]);
  return null;
}

/** Does the output hold the schema the pipeline needs? */
function structureOk(content, task) {
  if (task === STRUCTURE_TASK) {
    try {
      const parsed = JSON.parse(content);
      return Array.isArray(parsed.items) && parsed.items.length >= 6
        && parsed.items.every((i) => i && typeof i.finding === 'string');
    } catch { return false; }
  }
  try {
    const parsed = JSON.parse(content);
    return Array.isArray(parsed.steps) && typeof parsed.answer === 'number';
  } catch { return false; }
}

/* -------------------------------------------------------------------------- */
/*  THE RUN                                                                    */
/* -------------------------------------------------------------------------- */

async function probeSeat(seat, model) {
  const result = {
    provider: seat.provider,
    model,
    label: seat.label,
    configured: false,
    reasoningField: intelligenceReasoningFields(seat.provider, 'max', model),
    reachable: false,
    status: 0,
    latencyMs: 0,
    answered: false,
    correct: false,
    structured: false,
    hasReasoningTrace: false,
    steps: 0,
    tokens: null,
    error: null
  };

  if (!isProviderConfigured(seat.provider)) {
    result.error = 'NOT_CONFIGURED';
    return result;
  }
  result.configured = true;

  /* Task 1 — the reasoning task. */
  const r1 = await callSeat(seat, model, REASONING_TASK);
  result.latencyMs = r1.latencyMs;
  if (!r1.ok) {
    result.error = r1.error;
    result.status = r1.status;
    return result;
  }
  result.reachable = true;
  result.answered = r1.content.length > 0;
  const answer = extractAnswer(r1.content);
  result.correct = answer === EXPECTED_ANSWER;
  result.structured = structureOk(r1.content, REASONING_TASK);
  result.hasReasoningTrace = Boolean(r1.reasoningTrace && r1.reasoningTrace.length > 40);
  try {
    const parsed = JSON.parse(r1.content);
    result.steps = Array.isArray(parsed.steps) ? parsed.steps.length : 0;
  } catch { /* unparsed */ }
  result.tokens = r1.usage?.total_tokens ?? r1.usage?.completion_tokens ?? null;
  result.rawAnswer = answer;

  return result;
}

async function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const only = argv.filter((a) => !a.startsWith('--'));

  const seats = only.length
    ? SEATS.filter((s) => only.includes(s.provider))
    : SEATS;

  const rows = [];
  for (const seat of seats) {
    for (const model of seat.models) {
      const row = await probeSeat(seat, model);
      rows.push(row);
      if (!asJson) {
        const mark = row.correct ? '✓' : row.reachable ? '✗' : '·';
        const trace = row.hasReasoningTrace ? 'trace' : 'no-trace';
        const struct = row.structured ? 'json' : 'no-json';
        console.log(
          `${mark} ${row.provider.padEnd(15)} ${model.padEnd(46)} ` +
          `${String(row.latencyMs).padStart(6)}ms  ${struct.padEnd(7)} ${trace.padEnd(9)} ` +
          `ans=${row.rawAnswer ?? '—'} ${row.error ? '(' + row.error.slice(0, 60) + ')' : ''}`
        );
      }
    }
  }

  if (asJson) {
    console.log(JSON.stringify({ expected: EXPECTED_ANSWER, rows }, null, 2));
    return;
  }

  console.log('');
  console.log('THE SUMMARY');
  console.log('-----------');
  const reachable = rows.filter((r) => r.reachable);
  const correct = rows.filter((r) => r.correct);
  const traced = rows.filter((r) => r.hasReasoningTrace);
  console.log(`seats probed      : ${rows.length}`);
  console.log(`reachable         : ${reachable.length}`);
  console.log(`answered correctly: ${correct.length}`);
  console.log(`emitted a trace   : ${traced.length}`);
  console.log('');
  if (correct.length) {
    console.log('THE SEATS THAT SOLVED IT:');
    for (const r of correct) {
      console.log(`  ✓ ${r.provider} / ${r.model}  ${r.latencyMs}ms  ${r.steps} steps  ${r.tokens ?? '?'} tokens`);
    }
  } else {
    console.log('NO SEAT SOLVED THE REASONING TASK.');
  }
}

main().catch((err) => {
  console.error('PROBE FAILED:', err);
  process.exit(1);
});
