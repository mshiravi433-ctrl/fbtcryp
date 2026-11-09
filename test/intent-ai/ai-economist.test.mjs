/**
 * «مثل یک پروفسور اقتصاد» — the ECONOMIST'S LENS.
 * ---------------------------------------------------------------------------
 * The smartest mode was deep but still spoke like a market commentator: it
 * described the move, hedged, and stopped. A professor of economics names the
 * mechanism, starts from the base rate, walks the transmission channel, asks
 * whose incentives shape the claim, and states what would falsify the view.
 *
 * The lens is selected DETERMINISTICALLY from the question and the router's
 * task types, and rides on the specialists and the synthesiser — never on the
 * reviewer, whose job is to break the draft. `balanced`/`swift` are untouched.
 * No extra model call, no numbers, no execution authority.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  selectEconomicLenses,
  renderEconomistLens,
  economistPersona,
  LENS_ORDER,
  ECONOMIST_LENS_SCHEMA
} from '../../server/aiEconomistLens.js';
import { runCollaborativeAnalysis } from '../../server/aiCollaboration.js';

/* -------------------------------------------------------------------------- */
/*  A. SELECTION                                                              */
/* -------------------------------------------------------------------------- */

test('a price question gets mechanism, base rate, reflexivity and a falsifier', () => {
  const lenses = selectEconomicLenses({ message: 'قیمت BTC چنده؟', taskTypes: ['market'] });
  assert.deepEqual(lenses, ['MECHANISM', 'BASE_RATE', 'REFLEXIVITY', 'FALSIFIER']);
});

test('macro words bring the transmission channel; fees bring incentives', () => {
  assert.ok(selectEconomicLenses({ message: 'با این تورم و نرخ بهره چه می‌شود؟' }).includes('TRANSMISSION'));
  assert.ok(selectEconomicLenses({ message: 'کارمزد این محصول چقدر است؟' }).includes('INCENTIVES'));
  assert.ok(selectEconomicLenses({ message: 'سبد من چطور تخصیص داده شود؟', taskTypes: ['portfolio'] }).includes('OPPORTUNITY_COST'));
  assert.ok(selectEconomicLenses({ message: 'ریسک بلندمدت این تصمیم چیست؟', taskTypes: ['risk'] }).includes('TIME_HORIZON'));
});

test('the lens list is bounded, ordered, deterministic, and always falsifiable', () => {
  const q = 'با تورم و نرخ بهره و ریسک بلندمدت، سبد و کارمزد و قیمت بیت‌کوین را چطور ببینم؟';
  const first = selectEconomicLenses({ message: q, taskTypes: ['market', 'risk', 'portfolio', 'news'] });
  const second = selectEconomicLenses({ message: q, taskTypes: ['market', 'risk', 'portfolio', 'news'] });
  assert.deepEqual(first, second, 'same question, same lenses');
  assert.ok(first.length <= 4);
  assert.equal(first[first.length - 1], 'FALSIFIER', 'the falsifier is never dropped');
  assert.deepEqual(first, LENS_ORDER.filter((id) => first.includes(id)), 'canonical order');
});

test('an empty question selects nothing', () => {
  assert.deepEqual(selectEconomicLenses({ message: '   ' }), []);
  assert.equal(renderEconomistLens([]), '');
  assert.equal(economistPersona([]), null);
});

/* -------------------------------------------------------------------------- */
/*  B. RENDERING                                                              */
/* -------------------------------------------------------------------------- */

test('the rendered contract names every selected lens and stays number-free', () => {
  const block = renderEconomistLens(['MECHANISM', 'TRANSMISSION', 'FALSIFIER']);
  assert.match(block, /ECONOMIST'S LENS/);
  assert.match(block, /professor of economics/);
  assert.match(block, /- MECHANISM:/);
  assert.match(block, /- TRANSMISSION:/);
  assert.match(block, /- FALSIFIER:/);
  assert.match(block, /prove you wrong/);
  assert.equal(/\d/.test(block.replace(/FBT smartest mode/g, '')), false, 'the lens must not smuggle in figures');
});

test('the persona record is schema-tagged and ordered', () => {
  const persona = economistPersona(['FALSIFIER', 'MECHANISM']);
  assert.equal(persona.schema, ECONOMIST_LENS_SCHEMA);
  assert.equal(persona.id, 'economist');
  assert.deepEqual(persona.lenses, ['MECHANISM', 'FALSIFIER']);
});

/* -------------------------------------------------------------------------- */
/*  C. WIRING                                                                 */
/* -------------------------------------------------------------------------- */

const CONTEXT = { market: { priceMap: { BTC: 108000 } } };
const ANSWER = 'سازوکار روشن است: نرخ بهره بالاتر هزینهٔ نگهداری دارایی ریسکی را بالا می‌برد و تقاضا را به سمت '
  + 'دارایی کم‌ریسک می‌برد؛ کسی که در سقف می‌خرد همین هزینه را می‌پردازد. این خوانش اگر جریان ورودی صندوق‌ها '
  + 'برای چند هفته مثبت بماند باطل می‌شود و آن موقع باید بازبینی شود.';

function makeFleet() {
  const calls = [];
  const execute = async (providerId, opts = {}) => {
    const system = String(opts.system || '');
    calls.push({ system, message: String(opts.user || '') });
    const reply = (text) => ({ provider: providerId, model: 'fake', durationMs: 2, text: JSON.stringify(text) });
    if (system.includes('adversarial self-reviewer')) return reply({ answer: ANSWER, claims: [], uncertainty: '' });
    if (system.includes('Final Answer AI')) return reply({ answer: ANSWER, claims: [], uncertainty: '' });
    return reply({ answer: 'تحلیل نقش: سازوکار و هزینهٔ فرصت روشن است.', claims: [], uncertainty: '' });
  };
  return {
    execute,
    selectProviders: () => ['fake-a', 'fake-b', 'fake-c'],
    calls,
    lensCalls: () => calls.filter((c) => c.system.includes("ECONOMIST'S LENS"))
  };
}

const MESSAGE = 'با این تورم و نرخ بهره، ریسک ورود به بیت‌کوین چیست؟';

test('max: every specialist and the synthesiser reason through the lens; the reviewer does not', async () => {
  const fleet = makeFleet();
  const out = await runCollaborativeAnalysis({
    message: MESSAGE,
    locale: 'fa',
    context: CONTEXT,
    intelligence: 'max',
    deps: fleet,
    deadlineMs: 15000
  });

  assert.ok(out.level >= 4);
  assert.ok(fleet.lensCalls().length >= 4, 'three analysts, the verifier and the synthesiser carry the lens');
  assert.equal(fleet.lensCalls().every((c) => !c.system.includes('adversarial self-reviewer')), true);
  assert.equal(out.persona.id, 'economist');
  assert.ok(out.persona.lenses.includes('TRANSMISSION'));
  assert.ok(out.persona.lenses.includes('FALSIFIER'));
  assert.equal(out.answer, ANSWER);
});

test('balanced: no lens, no persona', async () => {
  const fleet = makeFleet();
  const out = await runCollaborativeAnalysis({
    message: MESSAGE,
    locale: 'fa',
    context: CONTEXT,
    intelligence: 'balanced',
    deps: fleet,
    deadlineMs: 15000
  });
  assert.equal(out.persona, null);
  for (const c of fleet.calls) assert.equal(c.system.includes("ECONOMIST'S LENS"), false);
});

test('small talk stays small talk: no professor brief on a greeting', async () => {
  const fleet = makeFleet();
  const out = await runCollaborativeAnalysis({
    message: 'سلام، خوبی؟',
    locale: 'fa',
    context: {},
    intelligence: 'max',
    deps: fleet,
    deadlineMs: 15000
  });
  assert.ok(out.level <= 2, 'a greeting must not be escalated to a level-4 panel');
  assert.equal(out.persona, null);
  for (const c of fleet.calls) assert.equal(c.system.includes("ECONOMIST'S LENS"), false);
});
