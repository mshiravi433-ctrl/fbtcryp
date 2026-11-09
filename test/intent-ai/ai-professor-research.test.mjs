/**
 * «مثل یک استاد دانشگاه ارز دیجیتال باشد و ریسرچ‌کننده باشد برای ارتقای همیشگی»
 * ---------------------------------------------------------------------------
 * Two things separate a researcher from a feed, and both are enforced rather
 * than requested:
 *
 *   1. A FORECAST CARRIES ITS FALSIFIER. «BTC تا ماه آینده ۱۲۰ هزار» is a
 *      horoscope; «…مگر اینکه فاندینگ منفی بماند» is a research claim. The
 *      check is deterministic and runs on the draft and on the final text.
 *
 *   2. WHAT THE ASSISTANT STILL DOES NOT KNOW SURVIVES THE TURN. Every deep
 *      turn already computes its own gaps (strategy frame, decision evidence,
 *      unsourced numbers, unanswered parts, dialogue contract, falsifier). They
 *      used to be thrown away at the end, so the next turn started from zero.
 *      The research agenda keeps them, briefs the next turn with them, resolves
 *      them only when a later turn actually establishes the thing, and reports
 *      what was opened and closed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PROFESSOR_SCHEMA,
  selectProfessorLenses,
  renderProfessorContract,
  checkFalsifier,
  renderFalsifierDeficit
} from '../../server/aiProfessor.js';
import {
  RESEARCH_AGENDA_SCHEMA,
  RESEARCH_AGENDA_MAX,
  deriveResearchFindings,
  mergeResearchAgenda,
  normalizeResearchAgenda,
  selectAgendaItems,
  renderResearchBrief,
  createResearchAgenda
} from '../../server/aiResearchAgenda.js';
import { runCollaborativeAnalysis } from '../../server/aiCollaboration.js';

/* -------------------------------------------------------------------------- */
/*  A. THE PROFESSOR                                                          */
/* -------------------------------------------------------------------------- */

test('a technical question gets the pedagogy lenses; a greeting gets none', () => {
  const technical = selectProfessorLenses({
    message: 'چرا نقدینگی DEX و اسلیپیج در بازار ETH مهم است؟'
  });
  assert.ok(technical.includes('DEFINE_TERMS'));
  assert.ok(technical.includes('DATA_PROVENANCE'));
  assert.ok(technical.includes('FALSIFIER'));

  assert.deepEqual(selectProfessorLenses({ message: 'سلام، وقت بخیر' }), []);
  assert.equal(renderProfessorContract([]), '');
});

test('the contract states the posture, not a personality', () => {
  const text = renderProfessorContract(['DATA_PROVENANCE', 'FALSIFIER']);
  assert.match(text, /RESEARCH POSTURE/);
  assert.match(text, /where each material number comes from/);
  assert.match(text, /prove this reading wrong/);
});

test('a forecast without a falsifier is a deficit; with one it is a claim', () => {
  const bare = checkFalsifier({ answer: 'قیمت BTC تا ماه آینده به ۱۲۰٬۰۰۰ دلار می‌رسد.' });
  assert.equal(bare.schema, PROFESSOR_SCHEMA);
  assert.equal(bare.applicable, true);
  assert.equal(bare.compliant, false);
  assert.deepEqual(bare.issues.map((i) => i.id), ['FORECAST_WITHOUT_FALSIFIER']);
  assert.match(renderFalsifierDeficit(bare), /PROFESSOR DEFICIT/);

  const falsifiable = checkFalsifier({
    answer: 'قیمت BTC تا ماه آینده می‌تواند ۱۲۰٬۰۰۰ دلار شود، مگر اینکه فاندینگ منفی بماند و ورودی صرافی‌ها ادامه یابد.'
  });
  assert.equal(falsifiable.compliant, true);
  assert.equal(renderFalsifierDeficit(falsifiable), '');

  /* A factual read of today owes no falsifier. */
  const factual = checkFalsifier({ answer: 'قیمت لحظه‌ای BTC ۶۸٬۴۰۰ دلار است.' });
  assert.equal(factual.applicable, false);
  assert.equal(factual.compliant, true);
});

/* -------------------------------------------------------------------------- */
/*  B. THE AGENDA                                                             */
/* -------------------------------------------------------------------------- */

const STRATEGY_TURN = {
  strategy: { frame: { gaps: ['capital', 'live_prices'], hasLivePrices: false }, rubric: { missing: ['risk_budget'] } },
  decision: { applicable: true, evidence: { missing: ['verified_claims'] } },
  subQuestions: { uncovered: [{ id: 2 }] },
  numericAudit: { unsourced: [{ value: 3 }], clean: false },
  dialogue: { applicable: true, compliant: false },
  falsifier: { applicable: true, compliant: false }
};

test('a deep turn turns its gaps into agenda items, without its own text', () => {
  const findings = deriveResearchFindings(STRATEGY_TURN);
  const ids = findings.map((f) => f.id);
  for (const expected of ['capital', 'live_market', 'verified_claims', 'sourced_numbers', 'question_coverage', 'answer_shape', 'falsifier', 'rubric_section:risk_budget']) {
    assert.ok(ids.includes(expected), `missing ${expected} in ${ids.join(',')}`);
  }
  const text = JSON.stringify(findings);
  assert.equal(text.includes('BTC'), false, 'the agenda stores facets, never the user message');
});

test('an item is resolved only by a turn that establishes the thing', () => {
  const first = mergeResearchAgenda([], deriveResearchFindings(STRATEGY_TURN), { at: 1000 });
  assert.equal(first.schema, RESEARCH_AGENDA_SCHEMA);
  assert.ok(first.openTotal >= 6);
  assert.deepEqual(first.closed, []);

  /* Next turn has live market data and answers every part: those two close. */
  const second = mergeResearchAgenda(first.items, deriveResearchFindings({
    subQuestions: { uncovered: [] },
    context: { market: { priceMap: { BTC: 68000 }, dataStatus: 'live' } }
  }), { at: 2000 });
  assert.ok(second.closed.includes('live_market'));
  assert.ok(second.closed.includes('question_coverage'));
  assert.equal(second.items.find((i) => i.id === 'live_market').status, 'resolved');
  /* Silence resolves nothing. */
  const third = mergeResearchAgenda(second.items, [], { at: 3000 });
  assert.deepEqual(third.closed, []);
  assert.equal(third.items.find((i) => i.id === 'live_market').status, 'resolved');
});

test('a blind spot that keeps returning is counted, not duplicated', () => {
  let state = mergeResearchAgenda([], deriveResearchFindings({ numericAudit: { unsourced: [{ value: 1 }] } }), { at: 1 });
  state = mergeResearchAgenda(state.items, deriveResearchFindings({ numericAudit: { unsourced: [{ value: 2 }] } }), { at: 2 });
  const item = state.items.find((i) => i.id === 'sourced_numbers');
  assert.equal(item.seenCount, 2);
  assert.deepEqual(state.repeated, ['sourced_numbers']);
  assert.equal(state.items.filter((i) => i.id === 'sourced_numbers').length, 1);
});

test('the agenda is bounded and survives junk', () => {
  const junk = normalizeResearchAgenda([null, {}, { id: 'x', facet: 'nope' }, { id: 'capital', facet: 'capital' }]);
  assert.equal(junk.length, 1);
  assert.equal(junk[0].id, 'capital');

  let state = { items: [] };
  for (let i = 0; i < RESEARCH_AGENDA_MAX + 10; i++) {
    state = mergeResearchAgenda(state.items, [{ id: `question_coverage`, facet: 'question_coverage', status: 'open' }], { at: i });
  }
  assert.ok(state.items.length <= RESEARCH_AGENDA_MAX);
});

test('the next turn is briefed with the questions that matter to it', () => {
  const agenda = mergeResearchAgenda([], deriveResearchFindings(STRATEGY_TURN), { at: 1 }).items;
  const selected = selectAgendaItems(agenda, 'قیمت BTC چنده و سرمایه‌ام را چطور تقسیم کنم؟', { limit: 2 });
  assert.ok(selected.length >= 1 && selected.length <= 2);
  assert.ok(selected.some((i) => ['live_market', 'verified_claims', 'capital'].includes(i.facet)));

  const brief = renderResearchBrief(selected, 'fa');
  assert.match(brief, /دستور کار پژوهشی/);
  assert.match(brief, /\[live_market\]|\[capital\]|\[verified_claims\]/);

  assert.equal(renderResearchBrief([], 'fa'), '');
  assert.equal(selectAgendaItems([], 'سلام').length, 0);
});

test('the session wrapper persists through a store and is inert without one', async () => {
  const saved = [];
  const session = createResearchAgenda({
    load: async () => saved[saved.length - 1] || [],
    save: async (_owner, items) => { saved.push(items); },
    now: () => 5000
  });
  assert.equal(session.enabled, true);
  const first = await session.record('u1', { findings: deriveResearchFindings(STRATEGY_TURN) });
  assert.ok(first.opened.length >= 5);
  assert.equal(first.openTotal, first.items?.length ?? first.openTotal);
  const stored = saved[0];
  assert.ok(stored.length >= 5);

  const second = await session.record('u1', { findings: deriveResearchFindings({ numericAudit: { clean: true } }) });
  assert.ok(second.closed.includes('sourced_numbers'));

  const inert = createResearchAgenda();
  assert.equal(inert.enabled, false);
  assert.deepEqual(await inert.read('u1'), []);
  assert.equal(await inert.record('u1', { findings: [] }), null);
});

/* -------------------------------------------------------------------------- */
/*  C. WIRING                                                                 */
/* -------------------------------------------------------------------------- */

const LONG_FORECAST = 'به نظر من BTC در ماه آینده به ۱۲۰ هزار دلار می‌رسد و روند صعودی ادامه دارد. '
  + 'حجم معاملات در حال افزایش است و بازار در فاز انباشت قرار دارد. این روند تا پایان فصل ادامه پیدا می‌کند.';

function makeFleet({ finalAnswer = LONG_FORECAST } = {}) {
  const calls = [];
  const execute = async (providerId, opts = {}) => {
    const system = String(opts.system || '');
    calls.push({ system, message: String(opts.user || '') });
    const reply = (text) => ({ provider: providerId, model: 'fake', durationMs: 2, text: JSON.stringify(text) });
    if (system.includes('adversarial self-reviewer')) return reply({ answer: finalAnswer, claims: [], uncertainty: '' });
    if (system.includes('Final Answer AI')) return reply({ answer: finalAnswer, claims: [], uncertainty: '' });
    return reply({ answer: 'تحلیل نقش: نقدینگی بازار نازک است و ورودی صرافی‌ها مثبت.', claims: [], uncertainty: 'داده کم است' });
  };
  return {
    execute,
    selectProviders: () => ['fake-a', 'fake-b', 'fake-c'],
    calls,
    finalCalls: () => calls.filter((c) => c.system.includes('Final Answer AI')),
    critiqueCalls: () => calls.filter((c) => c.system.includes('adversarial self-reviewer'))
  };
}

const FORECAST_QUESTION = 'پیش‌بینی می‌کنی BTC تا ماه آینده چه شود و چرا؟ استراتژی من برای خرید ۲۰۰۰۰ دلار چیست؟';

test('max: the professor contract reaches the model and a bare forecast is sent back', async () => {
  const fleet = makeFleet();
  const out = await runCollaborativeAnalysis({
    message: FORECAST_QUESTION,
    locale: 'fa',
    context: { market: { priceMap: { BTC: 68400 }, dataStatus: 'live' } },
    intelligence: 'max',
    deps: fleet,
    deadlineMs: 15000
  });

  assert.match(fleet.finalCalls()[0].system, /RESEARCH POSTURE/);
  assert.match(fleet.critiqueCalls()[0].message, /PROFESSOR DEFICIT/);

  assert.equal(out.professor.schema, PROFESSOR_SCHEMA);
  assert.ok(out.professor.lenses.includes('FALSIFIER'));
  assert.equal(out.professor.falsifier.applicable, true);
  assert.equal(out.professor.falsifier.compliant, false);
  /* No store was injected, so the default (in-process / Blob) agenda is used;
     the reply must still describe it truthfully rather than claim nothing. */
  assert.ok(out.research === null || typeof out.research.openTotal === 'number');
});

test('max: a falsifier in the answer passes the check', async () => {
  const fleet = makeFleet({
    finalAnswer: 'BTC در ماه آینده می‌تواند ۱۲۰ هزار دلار شود، مگر اینکه فاندینگ منفی بماند و ورودی صرافی‌ها قطع شود. '
      + 'در آن صورت سناریوی انباشت باطل می‌شود و محدودهٔ ۶۰ تا ۶۵ هزار محتمل‌تر است.'
  });
  const out = await runCollaborativeAnalysis({
    message: FORECAST_QUESTION,
    locale: 'fa',
    context: { market: { priceMap: { BTC: 68400 }, dataStatus: 'live' } },
    intelligence: 'max',
    deps: fleet,
    deadlineMs: 15000
  });
  assert.equal(out.professor.falsifier.compliant, true);
  assert.equal(fleet.critiqueCalls()[0].message.includes('PROFESSOR DEFICIT'), false);
});

test('max: the agenda is read, briefed and written through an injected store', async () => {
  let stored = [{ id: 'live_market', facet: 'live_market', status: 'open', seenCount: 2, firstSeenAt: 1, lastSeenAt: 1 }];
  const writes = [];
  const fleet = makeFleet();
  const out = await runCollaborativeAnalysis({
    message: 'استراتژی خرید BTC با ۲۰۰۰۰ دلار چیست و ریسکش چقدر است؟',
    locale: 'fa',
    owner: 'dev:agenda',
    context: { market: { priceMap: { BTC: 68400 }, dataStatus: 'live' } },
    intelligence: 'max',
    deps: {
      ...fleet,
      researchLoad: async () => stored,
      researchSave: async (_owner, items) => { writes.push(items); stored = items; }
    },
    deadlineMs: 15000
  });

  assert.match(fleet.finalCalls()[0].system, /OPEN RESEARCH AGENDA|دستور کار پژوهشی/);
  assert.equal(writes.length, 1, 'the agenda must be persisted once per turn');
  assert.equal(out.research.schema, RESEARCH_AGENDA_SCHEMA);
  assert.ok(out.research.briefed.includes('live_market'));
  /* Live data arrived, so that item is closed by this turn. */
  assert.ok(out.research.closed.includes('live_market'));
});

test('balanced: no professor, no agenda, nothing changes', async () => {
  const fleet = makeFleet();
  const out = await runCollaborativeAnalysis({
    message: FORECAST_QUESTION,
    locale: 'fa',
    context: { market: { priceMap: { BTC: 68400 }, dataStatus: 'live' } },
    intelligence: 'balanced',
    deps: { ...fleet, researchLoad: async () => [{ id: 'capital', facet: 'capital', status: 'open' }], researchSave: async () => {} },
    deadlineMs: 15000
  });
  assert.equal(out.professor, null);
  assert.equal(out.research, null);
  for (const call of fleet.calls) {
    assert.equal(call.system.includes('RESEARCH POSTURE'), false);
    assert.equal(call.system.includes('RESEARCH AGENDA'), false);
  }
});
