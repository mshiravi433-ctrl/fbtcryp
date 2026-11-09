/**
 * «مغز مرکزی را خیلی باهوش کن» — seat planning and council arbitration.
 * ---------------------------------------------------------------------------
 * Two failures of the central brain, both invisible in a green trace:
 *
 *   1. SEATS. The brain chose a provider by affinity/trust/health/cost with ONE
 *      weight table, and named the catalogue's default model id. So the answer
 *      to «چه مدلی جواب می‌دهد؟» was a stale id (Groq's retired
 *      `llama-3.3-70b-versatile`), the same plan in «سریع» and «باهوش‌ترین»,
 *      and in the smartest mode a cheap generalist could outrank the specialist
 *      because price carried 12% of the score.
 *
 *   2. CONTRADICTIONS. Every percentage any agent mentioned was compared with
 *      every other percentage, across topics — «کارمزد ۱٫۴٪» vs «بازده ۱۸٪»
 *      counted as a disagreement — and the scan returned after the FIRST pair,
 *      so a council split about price and return reported one conflict.
 *
 * Fixed here: mode-aware seat weights, flagship ladders with a documented
 * step-down, and per-subject numeric arbitration that also DISCLOSES a split
 * council instead of publishing one voice as the room's verdict.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SEAT_WEIGHT_PROFILES,
  seatWeightsForMode,
  resolveSeatModel,
  selectOptimalModels,
  classifyRequest,
  extractNumberClaims,
  findNumericConflicts,
  detectContradictions,
  summarizeArbitration,
  renderArbitrationDisclosure,
  selectEvidenceBasedResult,
  createCentralBrain
} from '../../src/lib/intent-ai/orchestrator/centralBrain.js';

const LADDERS = {
  openrouter: ['google/gemini-2.5-pro', 'openai/gpt-4.1', 'meta-llama/llama-3.3-70b-instruct'],
  groq: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'],
  workersai: ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3.1-8b-instruct'],
  gemini: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  deepseek: ['deepseek-reasoner', 'deepseek-chat'],
  anthropic: ['claude-sonnet-4-6', 'claude-sonnet-4-5']
};

const classificationFor = (message) => classifyRequest(message);

/* -------------------------------------------------------------------------- */
/*  A. SEATS                                                                  */
/* -------------------------------------------------------------------------- */

test('no mode means the historical weights, unchanged', () => {
  assert.deepEqual(SEAT_WEIGHT_PROFILES.default, { affinity: 0.44, trust: 0.28, health: 0.16, cost: 0.12 });
  assert.deepEqual(seatWeightsForMode(null), SEAT_WEIGHT_PROFILES.default);
  assert.deepEqual(seatWeightsForMode('balanced'), SEAT_WEIGHT_PROFILES.default);
  assert.deepEqual(seatWeightsForMode('nonsense'), SEAT_WEIGHT_PROFILES.default);
  /* max: the specialist matters more, price cannot buy a worse answer. */
  assert.ok(SEAT_WEIGHT_PROFILES.max.affinity > SEAT_WEIGHT_PROFILES.default.affinity);
  assert.ok(SEAT_WEIGHT_PROFILES.max.cost < SEAT_WEIGHT_PROFILES.default.cost);
  /* swift: the other direction. */
  assert.ok(SEAT_WEIGHT_PROFILES.swift.cost > SEAT_WEIGHT_PROFILES.default.cost);
});

test('a caller that passes no mode gets exactly the old plan', () => {
  const cls = classificationFor('استراتژی معاملاتی برای BTC با تحلیل تکنیکال و ریسک مدیریت‌شده پیشنهاد بده');
  const historical = selectOptimalModels({ classification: cls, availableProviders: ['deepseek', 'gemini', 'groq'] });
  const balanced = selectOptimalModels({ classification: cls, availableProviders: ['deepseek', 'gemini', 'groq'], intelligenceMode: 'balanced' });

  assert.deepEqual(balanced.taskAssignments, historical.taskAssignments);
  assert.deepEqual(balanced.selectedModels, historical.selectedModels);
  assert.equal(historical.selectedModels[0].model, 'deepseek-chat', 'catalogue default, no invented id');
  assert.equal(historical.selectedModels[0].modelSource, 'catalogue');
  assert.equal(historical.seatPolicy.modelRule, 'catalogue_default');
});

test('the smartest mode gives the specialist seat to the specialist', () => {
  /* risk_safety: the historical weights pick deepseek (cheaper, close enough);
     max gives it to the provider that actually specialises in safety. */
  const cls = classificationFor('ریسک این پوزیشن چقدر است و چه حد ضرری بگذارم؟');
  const sel = (mode) => selectOptimalModels({
    classification: { ...cls, complexity: 'COMPLEX' },
    availableProviders: ['deepseek', 'anthropic'],
    subTasks: [{ taskId: 'risk', agentId: 'risk_specialist', specialty: 'risk_safety' }],
    intelligenceMode: mode
  }).taskAssignments.risk.primaryProvider;

  assert.equal(sel(null), 'deepseek');
  assert.equal(sel('max'), 'anthropic');
});

test('the seat names the flagship id of the active mode, with a step-down', () => {
  assert.deepEqual(
    resolveSeatModel('groq', { mode: 'max', modelLadders: LADDERS }),
    { model: 'openai/gpt-oss-120b', modelFallbacks: ['openai/gpt-oss-20b'], modelSource: 'ladder_flagship' }
  );
  assert.deepEqual(
    resolveSeatModel('groq', { mode: 'swift', modelLadders: LADDERS }),
    { model: 'openai/gpt-oss-20b', modelFallbacks: [], modelSource: 'ladder_cheapest' }
  );
  assert.equal(
    resolveSeatModel('groq', { mode: 'balanced', modelLadders: LADDERS }).modelSource,
    'catalogue'
  );
  /* No ladder (unknown provider, or a mode without one) = catalogue default. */
  assert.equal(resolveSeatModel('groq', { mode: 'max', modelLadders: null }).modelSource, 'catalogue');
});

test('the plan carries the ladder through to the assignment and the trace', () => {
  const cls = classificationFor('قیمت BTC چنده؟');
  const plan = selectOptimalModels({
    classification: cls,
    availableProviders: ['groq'],
    intelligenceMode: 'max',
    modelLadders: LADDERS
  });
  const assignment = Object.values(plan.taskAssignments)[0];
  assert.equal(assignment.primaryModel, 'openai/gpt-oss-120b');
  assert.deepEqual(assignment.primaryModelFallbacks, ['openai/gpt-oss-20b']);
  assert.equal(assignment.primaryModelSource, 'ladder_flagship');
  assert.equal(plan.selectedModels[0].model, 'openai/gpt-oss-120b');
  assert.equal(plan.seatPolicy.modelRule, 'ladder_flagship_with_stepdown');
  assert.equal(plan.seatPolicy.intelligenceMode, 'max');
});

test('a seat is never planned on a provider that is not offered', () => {
  const cls = classificationFor('قیمت BTC چنده؟');
  const plan = selectOptimalModels({ classification: cls, availableProviders: ['workersai'] });
  assert.equal(plan.selectedModels.length, 1);
  assert.equal(plan.selectedModels[0].provider, 'workersai');
  assert.ok(plan.skippedModels.every((s) => s.provider === 'workersai'));
});

/* -------------------------------------------------------------------------- */
/*  B. NUMBERS                                                                */
/* -------------------------------------------------------------------------- */

const agent = (id, summary, stance = 'neutral') => ({
  memberId: id, agentId: id, roleFa: id, stance, summary, evidenceCited: ['market_prices'], provider: 'groq'
});

test('a claim knows its subject: asset plus the nearest domain keyword', () => {
  const claims = extractNumberClaims('قیمت بیت‌کوین ۶۸٬۰۰۰ دلار است و بازده هدف ۱۸٪.');
  const price = claims.find((c) => c.unit === 'usd');
  const ret = claims.find((c) => c.unit === 'pct');
  assert.equal(price.subject, 'BTC:price');
  assert.equal(ret.subject, 'BTC:return');
});

test('numbers about different quantities are not a contradiction', () => {
  const contradictions = detectContradictions({
    agentOutputs: [
      agent('a', 'کارمزد رفت‌وبرگشت ۱٫۴٪ است و باید در محاسبه بیاید.'),
      agent('b', 'بازده هدف سالانه ۱۸٪ است.')
    ]
  });
  assert.deepEqual(contradictions.filter((c) => c.type === 'NUMERIC_CONTRADICTION'), []);
});

test('two agents quoting different prices for the same asset do contradict', () => {
  const contradictions = detectContradictions({
    agentOutputs: [
      agent('technical_analyst', 'قیمت BTC حدود $۶۸٬۰۰۰ است.', 'bullish'),
      agent('macro_news_analyst', 'قیمت BTC حدود $۹۲٬۰۰۰ است.', 'bearish')
    ]
  });
  const numeric = contradictions.filter((c) => c.type === 'NUMERIC_CONTRADICTION');
  assert.equal(numeric.length, 1);
  assert.equal(numeric[0].subject, 'BTC:price');
  assert.equal(numeric[0].subjectLabel, 'قیمت BTC');
  assert.deepEqual(numeric[0].values.sort((x, y) => x - y), [68000, 92000]);
});

test('every divergent subject is reported, not only the first pair', () => {
  const found = findNumericConflicts([
    agent('a', 'قیمت BTC ۶۸۰۰۰ دلار و بازده ۴٪ است.'),
    agent('b', 'قیمت BTC ۹۲۰۰۰ دلار و بازده ۱۸٪ است.')
  ]);
  const subjects = found.map((c) => c.subject).sort();
  assert.deepEqual(subjects, ['BTC:price', 'BTC:return']);
});

test('counters are not claims, and identical pairs are reported once', () => {
  assert.deepEqual(findNumericConflicts([
    agent('a', 'سه سناریو با ۲ پله و افق ۱۲ ماه را بررسی کردم.'),
    agent('b', 'پنج سناریو با ۴ پله و افق ۲۴ ماه را بررسی کردم.')
  ]), []);
  const dup = findNumericConflicts([
    agent('a', 'قیمت ۶۸۰۰۰ و ۶۸۰۰۰ و ۶۸۰۰۰ دلار است.'),
    agent('b', 'قیمت ۹۲۰۰۰ دلار است.')
  ]);
  assert.equal(dup.length, 1);
});

test('a wide spread is HIGH severity, a narrow one is MEDIUM', () => {
  const wide = findNumericConflicts([agent('a', 'قیمت ۹۰۰۰۰ دلار'), agent('b', 'قیمت ۴۰۰۰۰ دلار')]);
  assert.equal(wide[0].severity, 'HIGH');
  const narrow = findNumericConflicts([agent('a', 'قیمت ۹۰۰۰۰ دلار'), agent('b', 'قیمت ۷۰۰۰۰ دلار')]);
  assert.equal(narrow[0].severity, 'MEDIUM');
});

/* -------------------------------------------------------------------------- */
/*  C. ARBITRATION                                                            */
/* -------------------------------------------------------------------------- */

test('arbitration says what the council split on, and whether it must be disclosed', () => {
  const split = summarizeArbitration([
    { type: 'DIRECTIONAL_CONFLICT', severity: 'HIGH', agentsA: ['technical_analyst'], agentsB: ['macro_news_analyst'] },
    { type: 'NUMERIC_CONTRADICTION', severity: 'MEDIUM', subject: 'BTC:price', subjectLabel: 'قیمت BTC', values: [68000, 92000], agentsA: ['technical_analyst'], agentsB: ['macro_news_analyst'] }
  ]);
  assert.equal(split.conflictCount, 2);
  assert.equal(split.high, 1);
  assert.equal(split.mustDisclose, true);
  assert.deepEqual(split.directionalSplit.bear, ['macro_news_analyst']);
  assert.deepEqual(split.types.sort(), ['DIRECTIONAL_CONFLICT', 'NUMERIC_CONTRADICTION']);

  const mediumOnly = summarizeArbitration([{ type: 'NUMERIC_CONTRADICTION', severity: 'MEDIUM', subject: 'BTC:price', values: [1, 2] }]);
  assert.equal(mediumOnly.mustDisclose, false);
});

test('the disclosure names the split in Persian and is empty when there is nothing to say', () => {
  const arbitration = summarizeArbitration([
    { type: 'DIRECTIONAL_CONFLICT', severity: 'HIGH', agentsA: ['technical_analyst'], agentsB: ['macro_news_analyst'] },
    { type: 'NUMERIC_CONTRADICTION', severity: 'HIGH', subject: 'BTC:price', subjectLabel: 'قیمت BTC', values: [68000, 92000], agentsA: ['technical_analyst'], agentsB: ['macro_news_analyst'] }
  ]);
  const text = renderArbitrationDisclosure(arbitration, { technical_analyst: 'تحلیلگر تکنیکال', macro_news_analyst: 'تحلیلگر اخبار' });
  assert.match(text, /⚠️/);
  assert.match(text, /صعودی/);
  assert.match(text, /تحلیلگر اخبار/);
  assert.match(text, /قیمت BTC/);
  assert.equal(renderArbitrationDisclosure(summarizeArbitration([])), '');
});

test('selectEvidenceBasedResult publishes the arbitration next to the winner', () => {
  const out = selectEvidenceBasedResult({
    agentOutputs: [agent('a', 'قیمت ۶۸۰۰۰ دلار', 'bullish'), agent('b', 'قیمت ۹۲۰۰۰ دلار', 'bearish')],
    evidence: [{ facetId: 'market_prices', status: 'observed', summary: { price: 68400 } }],
    contradictions: summarizeArbitration([]).mustDisclose ? [] : [{ type: 'DIRECTIONAL_CONFLICT', severity: 'HIGH', agentsA: ['a'], agentsB: ['b'] }]
  });
  assert.equal(out.arbitration.mustDisclose, true);
  assert.equal(out.winner.agentId, out.rankedCandidates[0].agentId);
});

/* -------------------------------------------------------------------------- */
/*  D. THE WHOLE PIPELINE                                                     */
/* -------------------------------------------------------------------------- */

const SPLIT_MESSAGE = 'با توجه به تحلیل تکنیکال، داده‌های آن‌چین و دیفای، جریان نهنگ‌های اسمارت‌مانی، اخبار فدرال رزرو و اقتصاد کلان، و مدیریت ریسک، چه استراتژی معاملاتی برای خرید ۲۰ هزار دلار BTC پیشنهاد می‌دهید؟';

const EVIDENCE = [
  { facetId: 'market_prices', tool: 'fbt_get_market_snapshot', status: 'observed', summary: { assets: [{ symbol: 'BTC', price: 68400, change24h: 2.8 }], regime: 'uptrend' } },
  { facetId: 'yield_rates', tool: 'fbt_get_yields', status: 'observed', summary: { pools: [{ project: 'Aave', symbol: 'WBTC', apy: 1.9 }] } },
  { facetId: 'smart_money', tool: 'fbt_get_signals', status: 'observed', summary: { trend: 'accumulation inflow' } },
  { facetId: 'news_flow', tool: 'fbt_get_news', status: 'observed', summary: { headlines: ['Hawkish Fed'] } }
];

test('a split council reaches the user as a disclosure, and confidence cannot imply consensus', async () => {
  const brain = createCentralBrain({
    availableProviders: ['deepseek', 'gemini', 'anthropic', 'openrouter'],
    intelligenceMode: 'max',
    modelLadders: LADDERS,
    providerInvoker: async ({ agentId }) => (agentId === 'macro_news_analyst'
      ? { text: 'قیمت $۹۲۰۰۰ و بازده ۱۸٪ با ریسک نزولی.', stance: 'bearish', confidence: 70, model: 'stub-a' }
      : { text: 'قیمت $۶۸۰۰۰ و بازده ۴٪ با روند صعودی.', stance: 'bullish', confidence: 78, model: 'stub-b' })
  });

  const out = await brain.run({ owner: 'dev:split', message: SPLIT_MESSAGE, preloadedEvidence: EVIDENCE });

  assert.equal(out.arbitration.mustDisclose, true);
  assert.ok(out.arbitration.high >= 1);
  assert.ok(out.decision.confidence <= 62, `confidence must not imply consensus, got ${out.decision.confidence}`);
  assert.match(out.answer, /⚠️/);
  assert.match(out.answer, /جهت‌گیری یکدست نیست/);

  /* The plan that produced it is explainable: flagship ids, step-downs, and
     the weights that ranked them. */
  assert.equal(out.seatPolicy.intelligenceMode, 'max');
  assert.equal(out.seatPolicy.modelRule, 'ladder_flagship_with_stepdown');
  assert.ok(out.modelSelection.selectedModels.every((m) => m.modelSource === 'ladder_flagship'));
  const stage3 = out.decisionTrace.stages.find((s) => s.stage === '3_MODEL_SELECTION_AND_TASK_DECOMPOSITION');
  assert.equal(stage3.details.seatPolicy.modelRule, 'ladder_flagship_with_stepdown');
});

test('a unanimous council gets no warning and no confidence cap', async () => {
  const brain = createCentralBrain({
    availableProviders: ['groq'],
    providerInvoker: async () => ({ text: 'قیمت $۶۸۴۰۰ و بازده ۴٪ با روند صعودی.', stance: 'bullish', confidence: 80, model: 'stub-same' })
  });
  const out = await brain.run({ owner: 'dev:unanimous', message: SPLIT_MESSAGE, preloadedEvidence: EVIDENCE });
  assert.equal(out.arbitration.mustDisclose, false);
  assert.equal(out.answer.includes('⚠️'), false);
});
