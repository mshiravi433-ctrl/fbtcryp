/**
 * THE REASONING LEDGER — LEVER #4
 * ---------------------------------------------------------------------------
 * The last open lever of docs/AI-COGNITION-AUDIT-2026-11-11.md.
 *
 * The finding: the pipeline ASKED for reasoning and then DISCARDED it.
 * `deepReasoning` told the smartest mode to "identify the 2-3 facts that
 * actually decide this question and reason from them" — but the JSON shape
 * had nowhere to put the result, so only the conclusion came back.
 *
 * That is exactly the state in which a weaker seat looks like a stronger
 * one: a fluent, plausible, unverifiable conclusion is indistinguishable
 * from a reasoned one.
 *
 * These tests pin the fix: the reasoning is captured, the paths reach the
 * synthesis, and a conclusion that does not carry its own reasoning is
 * FLAGGED rather than laundered.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  REASONING_CONTRACT,
  REASONING_LEDGER_SCHEMA,
  captureReasoning,
  checkReasoningSupportsAnswer,
  buildReasoningLedger,
  renderReasoningLedger,
  reasoningLedgerSummary
} from '../../server/aiReasoningLedger.js';

const FACT_A = 'funding rate is positive at 0.01 percent per interval';
const FACT_B = 'open interest is 1.2 times the 30 day average';
const INFERENCE = 'Both readings point the same way: the long side is paying and carrying more size than usual.';

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE CAPTURE                                                               */
/* ══════════════════════════════════════════════════════════════════════════ */

test('lever 4: the canonical shape is captured', () => {
  const r = captureReasoning({
    reasoning: { decidingFacts: [FACT_A, FACT_B], inference: INFERENCE }
  });
  assert.ok(r, 'the reasoning must be captured');
  assert.equal(r.decidingFacts.length, 2);
  assert.equal(r.inference, INFERENCE);
  assert.equal(r.usable, true);
});

test('lever 4: every shape a model may return is captured', () => {
  const shapes = [
    { reasoning: { decidingFacts: [FACT_A], inference: INFERENCE } },
    { reasoning: { facts: [FACT_A], inference: INFERENCE } },
    { reasoning: { keyFacts: [FACT_A], inference: INFERENCE } },
    { reasoning: { decidingFacts: `${FACT_A}\n${FACT_B}`, inference: INFERENCE } },
    { reasoning: [FACT_A, FACT_B] },
    { reasoning: { decidingFacts: [{ fact: FACT_A }], inference: INFERENCE } },
    { decidingFacts: [FACT_A], inference: INFERENCE }
  ];
  for (const shape of shapes) {
    const r = captureReasoning(shape);
    assert.ok(r, `the shape must be captured: ${JSON.stringify(shape).slice(0, 80)}`);
    assert.ok(r.decidingFacts.length >= 1, 'at least one fact must survive');
    assert.ok(r.decidingFacts[0].length >= 3, 'a fact must not be a placeholder');
  }
});

test('lever 4: a plain-string fact is never dropped', () => {
  /* The bug this pins: `f?.fact` on a plain string is undefined, so a
     string fact fell through to the empty fallback and was silently lost. */
  const r = captureReasoning({ reasoning: { decidingFacts: [FACT_A, FACT_B], inference: INFERENCE } });
  assert.equal(r.decidingFacts[0], FACT_A);
  assert.equal(r.decidingFacts[1], FACT_B);
});

test('lever 4: no reasoning is not an error', () => {
  assert.equal(captureReasoning({ answer: 'just an answer' }), null);
  assert.equal(captureReasoning({}), null);
  assert.equal(captureReasoning(null), null);
  assert.equal(captureReasoning('text'), null);
});

test('lever 4: placeholder facts are discarded', () => {
  const r = captureReasoning({
    reasoning: { decidingFacts: ['n/a', 'none', '-', '...', FACT_A], inference: INFERENCE }
  });
  assert.equal(r.decidingFacts.length, 1);
  assert.equal(r.decidingFacts[0], FACT_A);
});

test('lever 4: capturing twice returns the same thing', () => {
  const once = captureReasoning({ reasoning: { decidingFacts: [FACT_A], inference: INFERENCE } });
  const twice = captureReasoning(once);
  assert.deepEqual(twice.decidingFacts, once.decidingFacts);
  assert.equal(twice.usable, once.usable);
});

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE CHECK                                                                 */
/* ══════════════════════════════════════════════════════════════════════════ */

test('lever 4: a conclusion that carries its reasoning is supported', () => {
  const reasoning = captureReasoning({
    reasoning: { decidingFacts: [FACT_A, FACT_B], inference: INFERENCE }
  });
  const answer = `The funding rate is positive at 0.01 percent per interval and open interest is 1.2 times the 30 day average, so the long side is crowded.`;
  const check = checkReasoningSupportsAnswer(reasoning, answer);
  assert.equal(check.checked, true);
  assert.equal(check.supported, true);
  assert.equal(check.unusedFacts.length, 0);
});

test('lever 4: a conclusion that contradicts its reasoning is FLAGGED', () => {
  const reasoning = captureReasoning({
    reasoning: { decidingFacts: [FACT_A, FACT_B], inference: INFERENCE }
  });
  /* The reasoning says the long side is crowded; the answer says the opposite. */
  const answer = 'Bitcoin is about to reach 100000 dollars on institutional accumulation and strong buying.';
  const check = checkReasoningSupportsAnswer(reasoning, answer);
  assert.equal(check.checked, true);
  assert.equal(check.supported, false);
  assert.ok(check.unusedFacts.length >= 1, 'the unused facts must be named');
  assert.match(check.note, /does not carry/i);
});

test('lever 4: a partly-carried conclusion is partial, not a pass', () => {
  const reasoning = captureReasoning({
    reasoning: { decidingFacts: [FACT_A, FACT_B], inference: INFERENCE }
  });
  const answer = 'The funding rate is positive at 0.01 percent per interval, which suggests crowded longs.';
  const check = checkReasoningSupportsAnswer(reasoning, answer);
  assert.equal(check.supported, 'partial');
});

test('lever 4: no reasoning means nothing is checked', () => {
  const check = checkReasoningSupportsAnswer(null, 'any answer');
  assert.equal(check.checked, false);
  assert.equal(check.supported, null);
});

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE LEDGER                                                                */
/* ══════════════════════════════════════════════════════════════════════════ */

test('lever 4: the ledger collects the paths of every role', () => {
  const analyses = [
    {
      role: 'market', ok: true, provider: 'groq', model: 'gpt-oss-120b',
      answer: `The funding rate is positive at 0.01 percent per interval and open interest is 1.2 times the 30 day average.`,
      reasoning: { decidingFacts: [FACT_A, FACT_B], inference: INFERENCE }
    },
    {
      role: 'risk', ok: true, provider: 'workersai', model: '@cf/qwen/qwen3.8-27b',
      answer: 'Crowding means a flush would liquidate longs first.',
      reasoning: { decidingFacts: [FACT_A], inference: INFERENCE }
    },
    { role: 'failed', ok: false, answer: '' }
  ];
  const ledger = buildReasoningLedger(analyses);
  assert.equal(ledger.schema, REASONING_LEDGER_SCHEMA);
  assert.equal(ledger.paths.length, 2, 'a failed role contributes nothing');
  assert.equal(ledger.stats.rolesWithReasoning, 2);
  assert.equal(ledger.stats.rolesChecked, 2);
});

test('lever 4: the ledger counts the unsupported conclusions', () => {
  const ledger = buildReasoningLedger([
    {
      role: 'market', ok: true, provider: 'groq', model: 'gpt-oss-120b',
      answer: 'Bitcoin is about to reach 100000 dollars on institutional accumulation and strong buying.',
      reasoning: { decidingFacts: [FACT_A, FACT_B], inference: INFERENCE }
    }
  ]);
  assert.equal(ledger.stats.unsupported, 1);
  assert.equal(ledger.stats.fullySupported, 0);
});

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE RENDER                                                                 */
/* ══════════════════════════════════════════════════════════════════════════ */

test('lever 4: the synthesis sees the paths, not only the conclusions', () => {
  const ledger = buildReasoningLedger([
    {
      role: 'market', ok: true, provider: 'groq', model: 'gpt-oss-120b',
      answer: 'The funding rate is positive and open interest is elevated.',
      reasoning: { decidingFacts: [FACT_A, FACT_B], inference: INFERENCE }
    }
  ]);
  const text = renderReasoningLedger(ledger);
  assert.ok(text.length > 0);
  assert.match(text, /REASONING PATHS/);
  assert.match(text, /\[market\]/);
  assert.ok(text.includes(FACT_A), 'the deciding fact must reach the synthesis');
  assert.ok(text.includes(INFERENCE.slice(0, 40)), 'the inference must reach the synthesis');
});

test('lever 4: an unsupported conclusion carries a warning AND a hard rule', () => {
  const ledger = buildReasoningLedger([
    {
      role: 'market', ok: true, provider: 'groq', model: 'gpt-oss-120b',
      answer: 'Bitcoin is about to reach 100000 dollars on institutional accumulation.',
      reasoning: { decidingFacts: [FACT_A], inference: INFERENCE }
    }
  ]);
  const text = renderReasoningLedger(ledger);
  assert.match(text, /WARNING/, 'the unsupported path must be marked');
  assert.match(text, /HARD RULE/, 'the synthesis must be told not to launder it');
  assert.match(text, /not supported by their own reasoning/i);
});

test('lever 4: an empty ledger renders nothing', () => {
  assert.equal(renderReasoningLedger(null), '');
  assert.equal(renderReasoningLedger(buildReasoningLedger([])), '');
  assert.equal(renderReasoningLedger({ paths: [] }), '');
});

test('lever 4: the summary is safe for the status endpoint', () => {
  const ledger = buildReasoningLedger([
    {
      role: 'market', ok: true, provider: 'groq', model: 'gpt-oss-120b',
      answer: 'The funding rate is positive and open interest is elevated.',
      reasoning: { decidingFacts: [FACT_A], inference: INFERENCE }
    }
  ]);
  const summary = reasoningLedgerSummary(ledger);
  assert.equal(summary.schema, REASONING_LEDGER_SCHEMA);
  assert.equal(summary.rolesWithReasoning, 1);
  assert.equal(Array.isArray(summary.paths), true);
  assert.equal(summary.paths[0].role, 'market');
});

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE WIRING                                                                 */
/* ══════════════════════════════════════════════════════════════════════════ */

test('lever 4: the JSON shape has somewhere to put the reasoning', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../../server/aiCollaboration.js', import.meta.url), 'utf8');
  assert.match(src, /"reasoning"\s*:\s*\{/, 'the analysis shape must carry a reasoning field');
  assert.match(src, /"decidingFacts"/, 'the shape must name the deciding facts');
  assert.match(src, /"inference"/, 'the shape must name the inference');
});

test('lever 4: the role call captures the reasoning', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../../server/aiCollaboration.js', import.meta.url), 'utf8');
  assert.match(src, /captureReasoning\(parsed\)/, 'the parsed response must be captured');
  assert.match(src, /buildReasoningLedger/, 'the ledger must be built');
  assert.match(src, /renderReasoningLedger/, 'the paths must be rendered into the synthesis');
});

test('lever 4: the reasoning contract reaches the system prompt', () => {
  assert.ok(REASONING_CONTRACT.includes('decidingFacts'));
  assert.ok(REASONING_CONTRACT.includes('inference'));
  assert.ok(
    /checked|check/i.test(REASONING_CONTRACT),
    'the contract must tell the model its reasoning is checked'
  );
});

test('lever 4: the turn publishes the ledger', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../../server/aiCollaboration.js', import.meta.url), 'utf8');
  assert.match(src, /result\.reasoningLedger/, 'the turn must publish the ledger summary');
});
