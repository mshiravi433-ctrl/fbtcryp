/**
 * «باهوش‌تر کن» — the FOURTH depth layer: the synthesiser writes with verdicts.
 * ---------------------------------------------------------------------------
 * Before this, verification ran AFTER the final answer was written. The
 * synthesiser therefore saw one digest of prose in which:
 *   · a claim backed by live tool data, and
 *   · a claim three models merely repeated
 * looked identical, and
 *   · two analysts quoting different prices for the same asset were merged
 *     into one confident sentence.
 *
 * The claim ledger is built deterministically BEFORE synthesis:
 *   verified by tool/web · AI-consensus only · conflicting figures per subject.
 * It is handed to the synthesiser and the adversarial reviewer (smartest mode
 * only) and published in the reply. It never edits text and never adds a call.
 *
 * Fully offline: the fleet is injected, no provider is called.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildClaimLedger,
  renderClaimLedger,
  CLAIM_LEDGER_SCHEMA
} from '../../server/aiClaimLedger.js';
import { runCollaborativeAnalysis } from '../../server/aiCollaboration.js';

const CONTEXT = { market: { priceMap: { BTC: 108000, ETH: 2500 } } };

/* -------------------------------------------------------------------------- */
/*  A. THE LEDGER                                                             */
/* -------------------------------------------------------------------------- */

test('verified, consensus-only and conflicting figures are told apart', () => {
  const ledger = buildClaimLedger({
    verified: [{ role: 'MARKET_AI', claim: 'BTC trades 108000', basis: 'tool-data' }],
    consensusOnly: [{ role: 'RISK_AI', claim: 'BTC support sits at 105000' }],
    factualClaims: [
      { role: 'MARKET_AI', claim: 'BTC trades 108000' },
      { role: 'RISK_AI', claim: 'BTC support sits at 105000' }
    ],
    context: CONTEXT
  });

  assert.equal(ledger.schema, CLAIM_LEDGER_SCHEMA);
  assert.equal(ledger.verifiedCount, 1);
  assert.equal(ledger.consensusOnlyCount, 1);
  assert.equal(ledger.conflictCount, 1);
  assert.equal(ledger.clean, false);
  assert.equal(ledger.conflicts[0].subject, 'BTC');
  assert.deepEqual(ledger.conflicts[0].values, [105000, 108000]);
  assert.equal(ledger.conflicts[0].toolValue, 108000);
  const block = renderClaimLedger(ledger);
  assert.match(block, /VERIFIED BY TOOL\/WEB/);
  assert.match(block, /AI-CONSENSUS ONLY/);
  assert.match(block, /CONFLICTING FIGURES/);
  assert.match(block, /tool data says BTC=108000/);
});

test('two analysts quoting the same figure do not conflict', () => {
  const ledger = buildClaimLedger({
    factualClaims: [
      { role: 'MARKET_AI', claim: 'BTC trades near 108000' },
      { role: 'STRATEGY_AI', claim: 'BTC is 108000 on the live feed, target higher' }
    ],
    context: CONTEXT
  });
  assert.equal(ledger.conflictCount, 0);
  assert.equal(ledger.clean, true);
});

test('a claim that names two numbers is not a conflict by itself', () => {
  const ledger = buildClaimLedger({
    factualClaims: [
      { role: 'MARKET_AI', claim: 'BTC trades 108000 and the next target is 120000' },
      { role: 'RISK_AI', claim: 'BTC trades 108000 on the same feed' }
    ],
    context: CONTEXT
  });
  assert.equal(ledger.conflictCount, 0, 'overlap on the shared figure is not a contradiction');
});

test('Persian asset names and Persian digits resolve to the same subject and values', () => {
  const ledger = buildClaimLedger({
    factualClaims: [
      { role: 'MARKET_AI', claim: 'بیت‌کوین حدود ۱۰۸٬۰۰۰ دلار معامله می‌شود' },
      { role: 'RISK_AI', claim: 'بیتکوین سطح ۱۰۵٬۰۰۰ را از دست داد' }
    ],
    context: CONTEXT
  });
  assert.equal(ledger.conflictCount, 1);
  assert.equal(ledger.conflicts[0].subject, 'BTC');
  assert.deepEqual(ledger.conflicts[0].values, [105000, 108000]);
});

test('a ticker inside a longer word is not a subject («method» is not ETH)', () => {
  const ledger = buildClaimLedger({
    factualClaims: [{ role: 'MARKET_AI', claim: 'the method shows 2500 samples' }],
    context: CONTEXT
  });
  assert.equal(ledger.conflictCount, 0);
  assert.equal(ledger.consensusOnlyCount, 0);
});

test('nothing to say renders the empty string, so the prompt is unchanged', () => {
  const ledger = buildClaimLedger({});
  assert.equal(renderClaimLedger(ledger), '');
  assert.equal(renderClaimLedger(null), '');
  assert.equal(renderClaimLedger({ schema: 'other' }), '');
});

/* -------------------------------------------------------------------------- */
/*  B. WIRING — the ledger reaches the synthesiser and the reply              */
/* -------------------------------------------------------------------------- */

const FINAL = 'بیت‌کوین در داده زنده ۱۰۸٬۰۰۰ دلار است. برخی تحلیل‌ها سطح ۱۰۵٬۰۰۰ را حمایت می‌دانند، اما این عدد '
  + 'در داده ابزار نیست و آن را قطعی نمی‌گیرم؛ سناریوی نزولی به شکست همین سطح وابسته است و برای تصمیم، '
  + 'خواندن جریان صندوق‌ها لازم است.';

function makeFleet() {
  const calls = [];
  const execute = async (providerId, opts = {}) => {
    const system = String(opts.system || '');
    calls.push({ system, message: String(opts.user || '') });
    const reply = (text) => ({ provider: providerId, model: 'fake', durationMs: 2, text: JSON.stringify(text) });
    if (system.includes('adversarial self-reviewer')) {
      return reply({ answer: FINAL, claims: [{ claim: 'no change', type: 'opinion', confidence: 80 }], uncertainty: '' });
    }
    if (system.includes('Final Answer AI')) {
      return reply({ answer: FINAL, claims: [], uncertainty: 'سطح حمایت خوانده نشد' });
    }
    if (system.includes('Market AI')) {
      return reply({ answer: 'داده زنده می‌گوید BTC ۱۰۸٬۰۰۰ است.', claims: [{ claim: 'BTC trades 108000', type: 'factual', confidence: 90 }], uncertainty: '' });
    }
    if (system.includes('Risk AI')) {
      return reply({ answer: 'سطح حمایت را ۱۰۵٬۰۰۰ می‌بینم.', claims: [{ claim: 'BTC support sits at 105000', type: 'factual', confidence: 70 }], uncertainty: 'منبع سطح حمایت نامشخص' });
    }
    return reply({ answer: 'تحلیل نقش.', claims: [{ claim: 'BTC volatility stays elevated', type: 'opinion', confidence: 60 }], uncertainty: '' });
  };
  return {
    execute,
    selectProviders: () => ['fake-a', 'fake-b', 'fake-c'],
    calls,
    finalCalls: () => calls.filter((c) => c.system.includes('Final Answer AI')),
    critiqueCalls: () => calls.filter((c) => c.system.includes('adversarial self-reviewer'))
  };
}

const MESSAGE = 'با این داده، ریسک ورود به بیت‌کوین چیست؟';

test('max: the synthesiser and the reviewer both receive the ledger', async () => {
  const fleet = makeFleet();
  const out = await runCollaborativeAnalysis({
    message: MESSAGE,
    locale: 'fa',
    context: CONTEXT,
    intelligence: 'max',
    deps: fleet,
    deadlineMs: 15000
  });

  const finalPrompt = fleet.finalCalls()[0].message;
  assert.match(finalPrompt, /ANALYST CLAIM LEDGER/);
  assert.match(finalPrompt, /VERIFIED BY TOOL\/WEB/);
  assert.match(finalPrompt, /CONFLICTING FIGURES BETWEEN ANALYSTS/);
  assert.match(finalPrompt, /BTC=108000/);
  assert.match(fleet.critiqueCalls()[0].message, /ANALYST CLAIM LEDGER/);

  assert.equal(out.synthesisLedger.schema, CLAIM_LEDGER_SCHEMA);
  assert.equal(out.synthesisLedger.verifiedCount, 1);
  assert.equal(out.synthesisLedger.conflictCount, 1);
  assert.equal(out.answer, FINAL);
});

test('balanced: no ledger, no ledger text in any prompt', async () => {
  const fleet = makeFleet();
  const out = await runCollaborativeAnalysis({
    message: MESSAGE,
    locale: 'fa',
    context: CONTEXT,
    intelligence: 'balanced',
    deps: fleet,
    deadlineMs: 15000
  });
  assert.equal(out.synthesisLedger, null);
  for (const call of fleet.calls) {
    assert.equal(call.message.includes('ANALYST CLAIM LEDGER'), false);
  }
});

test('a deep digest keeps more of each analysis at max than in balanced', async () => {
  const long = 'د'.repeat(900);
  const makeLongFleet = () => {
    const calls = [];
    const execute = async (providerId, opts = {}) => {
      const system = String(opts.system || '');
      calls.push({ system, message: String(opts.user || '') });
      const reply = (text) => ({ provider: providerId, model: 'fake', durationMs: 2, text: JSON.stringify(text) });
      if (system.includes('Final Answer AI')) return reply({ answer: FINAL, claims: [], uncertainty: '' });
      if (system.includes('adversarial self-reviewer')) return reply({ answer: FINAL, claims: [], uncertainty: '' });
      return reply({ answer: long, claims: [], uncertainty: '' });
    };
    return { execute, selectProviders: () => ['fake-a', 'fake-b', 'fake-c'], calls, finalCalls: () => calls.filter((c) => c.system.includes('Final Answer AI')) };
  };

  /* A message the router plans at level 4 in BOTH modes, so each mode reaches
     its synthesis stage and the digest budgets can be compared directly. */
  const L4 = 'سناریوهای استراتژی برای بیت‌کوین با توجه به ریسک بازار چیست؟';
  const maxFleet = makeLongFleet();
  await runCollaborativeAnalysis({ message: L4, locale: 'fa', context: CONTEXT, intelligence: 'max', deps: maxFleet, deadlineMs: 15000 });
  const balancedFleet = makeLongFleet();
  await runCollaborativeAnalysis({ message: L4, locale: 'fa', context: CONTEXT, intelligence: 'balanced', deps: balancedFleet, deadlineMs: 15000 });

  /* Measure the SPECIALIST WORK digest only: the verifier's own note later in
     the prompt is a different budget and would mask the comparison. */
  const digestOf = (prompt) => prompt
    .split('SPECIALIST WORK:')[1]
    .split('VERIFIER FINDINGS')[0]
    .split('ANALYST CLAIM LEDGER')[0];
  const longestRun = (text) => Math.max(0, ...(text.match(/د+/g) || []).map((m) => m.length));

  assert.equal(longestRun(digestOf(maxFleet.finalCalls()[0].message)), 800,
    'max keeps 800 characters of each deep analysis');
  assert.equal(longestRun(digestOf(balancedFleet.finalCalls()[0].message)), 500,
    'balanced keeps the historical 500');
});
