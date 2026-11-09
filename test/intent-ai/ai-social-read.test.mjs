/**
 * «هوش اجتماعی» — the SOCIAL READ layer.
 * ---------------------------------------------------------------------------
 * Understanding a request is not keyword extraction, and social intelligence
 * is not a warm sentence at the end. «بازم ضرر کردم، به نظرت اینو نگه دارم؟»
 * is a decision question asked by someone frustrated, and the literal words
 * hide a need for containment. «مطمئنی؟ منبعش چیه» is a trust challenge, not a
 * data request. «چیکار کنم؟» leaves almost everything unsaid and must be
 * answered under a stated assumption with exactly ONE question back.
 *
 * `readSocialContext` is pure and deterministic; `renderSocialBrief` turns it
 * into obligations and returns '' for an ordinary, clear, neutral question so
 * those prompts are unchanged. Only the smartest mode sends the brief.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  readSocialContext,
  renderSocialBrief,
  SOCIAL_READ_SCHEMA
} from '../../src/lib/intent-ai/os/conversation/socialRead.js';
import { runCollaborativeAnalysis } from '../../server/aiCollaboration.js';

/* -------------------------------------------------------------------------- */
/*  A. THE READ                                                               */
/* -------------------------------------------------------------------------- */

test('a formal, specific request reads as formal with nothing remarkable', () => {
  const read = readSocialContext({ message: 'لطفاً بفرمایید قیمت BTC چقدر است؟' });
  assert.equal(read.schema, SOCIAL_READ_SCHEMA);
  assert.equal(read.register, 'formal');
  assert.equal(read.tone, 'neutral');
  assert.equal(read.need, 'data');
  assert.equal(read.ambiguity, 'low');
  assert.equal(renderSocialBrief(read).includes('register: they wrote formally'), true);
  assert.equal(renderSocialBrief(read).includes('tone:'), false, 'a neutral tone gets no tone instruction');
});

test('an informal message is read as informal', () => {
  const read = readSocialContext({ message: 'داداش این چه وضعشه 😡' });
  assert.equal(read.register, 'informal');
  assert.equal(read.tone, 'frustrated');
  assert.equal(read.need, 'reassurance');
});

test('frustration plus a question about holding is a decision need', () => {
  const read = readSocialContext({ message: 'بازم ضرر کردم، به نظرت اینو نگه دارم؟' });
  assert.equal(read.tone, 'frustrated');
  assert.equal(read.need, 'decision');
  const brief = renderSocialBrief(read);
  assert.match(brief, /ONE short clause/);
  assert.match(brief, /recommendation with its condition/);
});

test('fear of loss is risk containment, not a forecast request', () => {
  const read = readSocialContext({ message: 'می‌ترسم پولم بسوزه' });
  assert.equal(read.tone, 'anxious');
  assert.equal(read.need, 'risk_containment');
  assert.equal(read.ambiguity, 'high');
  assert.deepEqual(read.signals, ['tone:anxious', 'ambiguity:high']);
  const brief = renderSocialBrief(read);
  assert.match(brief, /never promise safety/);
  assert.match(brief, /answer the need/i);
});

test('hostility is answered without mirroring it', () => {
  const read = readSocialContext({ message: 'این چه برنامه مزخرفیه، بیفایده‌اید' });
  assert.equal(read.tone, 'hostile');
  const brief = renderSocialBrief(read);
  assert.match(brief, /Do not mirror it/);
  assert.match(brief, /do not scold/);
});

test('a confidence challenge asks for evidence, not reassurance', () => {
  const read = readSocialContext({ message: 'مطمئنی؟ منبعش چیه' });
  assert.equal(read.challenged, true);
  assert.match(renderSocialBrief(read), /never claim certainty the data cannot give/i);
});

test('a bare «what should I do» is high ambiguity; a priced question is not', () => {
  assert.equal(readSocialContext({ message: 'چیکار کنم؟' }).ambiguity, 'high');
  assert.equal(readSocialContext({ message: 'قیمت BTC چنده؟' }).ambiguity, 'low');
  const brief = renderSocialBrief(readSocialContext({ message: 'چیکار کنم؟' }));
  assert.match(brief, /exactly ONE precise question/);
});

test('urgency puts the recommendation first', () => {
  const read = readSocialContext({ message: 'فوری بگو وضعیتم چطوره' });
  assert.equal(read.urgent, true);
  assert.match(renderSocialBrief(read), /first two sentences/);
});

test('an ordinary clear neutral question renders the empty brief', () => {
  const read = readSocialContext({ message: 'قیمت BTC چنده؟' });
  assert.equal(read.register, 'neutral');
  assert.equal(read.tone, 'neutral');
  assert.equal(read.need, 'data');
  assert.equal(read.ambiguity, 'low');
  assert.equal(renderSocialBrief(read), '', 'nothing remarkable → no block, no token cost');
  assert.equal(renderSocialBrief(null), '');
  assert.equal(renderSocialBrief({ schema: 'other' }), '');
});

/* -------------------------------------------------------------------------- */
/*  B. WIRING                                                                 */
/* -------------------------------------------------------------------------- */

const CONTEXT = { market: { priceMap: { BTC: 108000 } } };
const ANSWER = 'می‌دانم این وضعیت خسته‌کننده است. در داده خوانده‌شده بیت‌کوین حدود ۱۰۸٬۰۰۰ دلار است و سطح بعدی '
  + 'خوانده نشده؛ نگه‌داشتن فقط با شرط تحمل افت و بدون اهرم منطقی است و اگر جریان صندوق‌ها منفی بماند، بازبینی لازم است.';

function makeFleet({ finalAnswer = ANSWER } = {}) {
  const calls = [];
  const execute = async (providerId, opts = {}) => {
    const system = String(opts.system || '');
    calls.push({ system, message: String(opts.user || '') });
    const reply = (text) => ({ provider: providerId, model: 'fake', durationMs: 2, text: JSON.stringify(text) });
    if (system.includes('adversarial self-reviewer')) return reply({ answer: finalAnswer, claims: [], uncertainty: '' });
    if (system.includes('Final Answer AI')) return reply({ answer: finalAnswer, claims: [], uncertainty: '' });
    return reply({ answer: 'تحلیل نقش: داده زنده فشار فروش را نشان می‌دهد.', claims: [], uncertainty: '' });
  };
  return {
    execute,
    selectProviders: () => ['fake-a', 'fake-b', 'fake-c'],
    calls,
    briefCalls: () => calls.filter((c) => c.system.includes('SOCIAL READ')),
    finalCalls: () => calls.filter((c) => c.system.includes('Final Answer AI'))
  };
}

test('max: the specialists and the synthesiser receive the social brief, the reviewer does not', async () => {
  const fleet = makeFleet();
  const out = await runCollaborativeAnalysis({
    message: 'بازم ضرر کردم، به نظرت اینو نگه دارم؟',
    locale: 'fa',
    context: CONTEXT,
    intelligence: 'max',
    deps: fleet,
    deadlineMs: 15000
  });

  assert.ok(fleet.briefCalls().length >= 2, 'analysts and the synthesiser carry the brief');
  assert.equal(fleet.briefCalls().every((c) => !c.system.includes('adversarial self-reviewer')), true);
  assert.equal(fleet.finalCalls()[0].system.includes('ONE short clause'), true);
  assert.equal(out.socialRead.tone, 'frustrated');
  assert.equal(out.socialRead.need, 'decision');
  assert.equal(out.answer, ANSWER);
});

test('max: a neutral, specific question sends no social block at all', async () => {
  const fleet = makeFleet({ finalAnswer: 'بیت‌کوین در داده زنده ۱۰۸٬۰۰۰ دلار است و روند کوتاه‌مدت به جریان صندوق‌ها وابسته است؛ سطح بعدی خوانده نشده و حدس نمی‌زنم.' });
  await runCollaborativeAnalysis({
    message: 'قیمت BTC با توجه به داده زنده چقدر است؟',
    locale: 'fa',
    context: CONTEXT,
    intelligence: 'max',
    deps: fleet,
    deadlineMs: 15000
  });
  for (const c of fleet.calls) assert.equal(c.system.includes('SOCIAL READ'), false);
});

test('balanced: social context reaches the model', async () => {
  const fleet = makeFleet();
  const out = await runCollaborativeAnalysis({
    message: 'بازم ضرر کردم، به نظرت اینو نگه دارم؟',
    locale: 'fa',
    context: CONTEXT,
    intelligence: 'balanced',
    deps: fleet,
    deadlineMs: 15000
  });
  assert.ok(out.socialRead);
  assert.ok(fleet.calls.some(c => c.system.includes('SOCIAL READ')));
});

test('a greeting is not given a social analysis', async () => {
  const fleet = makeFleet();
  const out = await runCollaborativeAnalysis({
    message: 'سلام، خوبی؟',
    locale: 'fa',
    context: {},
    intelligence: 'max',
    deps: fleet,
    deadlineMs: 15000
  });
  assert.ok(out.level <= 2);
  assert.equal(out.socialRead, null);
  for (const c of fleet.calls) assert.equal(c.system.includes('SOCIAL READ'), false);
});
