/**
 * «هوش اجتماعی را باهوش‌ترش کن» — beyond the single message.
 * ---------------------------------------------------------------------------
 * The first social layer read one message. Most social failure happens ACROSS
 * messages: the same question asked twice is feedback, not repetition; a tone
 * that worsened needs a different reply than the same tone on a first contact;
 * a polite «فعلاً نه» is a decision and must not be re-offered; and a person who
 * says they have lost everything is a safety state, not a trading question.
 *
 * Added here, all deterministic and offline:
 *   · distress / safety (no advice, no promises, no lectures)
 *   · Persian pragmatics — taarof, politeness-wrapped requests, indirect refusal
 *   · conversation-level read — repeat, rising / cooling tone, unresolved
 *
 * The brief stays empty for an ordinary neutral question, and only the smartest
 * mode receives it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  readSocialContext,
  renderSocialBrief
} from '../../src/lib/intent-ai/os/conversation/socialRead.js';
import { runCollaborativeAnalysis } from '../../server/aiCollaboration.js';

/* -------------------------------------------------------------------------- */
/*  A. SAFETY                                                                 */
/* -------------------------------------------------------------------------- */

test('distress is a safety state, and the brief forbids advice and promises', () => {
  const read = readSocialContext({ message: 'همه پولمو از دست دادم، دیگه فایده‌ای نداره' });
  assert.equal(read.distress, true);
  assert.ok(read.signals.includes('distress'));
  const brief = renderSocialBrief(read);
  assert.match(brief, /SAFETY/);
  assert.match(brief, /Do NOT give trading or investment advice/);
  assert.match(brief, /do not promise/);
  assert.match(brief, /do not diagnose/);
  assert.match(brief, /someone they trust or a professional/);
  /* A distressed turn is not a checklist: no need/ambiguity instructions. */
  assert.equal(brief.includes('- need:'), false);
  assert.equal(brief.includes('- ambiguity:'), false);
});

test('distress outranks hostility and the ordinary tone lines', () => {
  const brief = renderSocialBrief(readSocialContext({ message: 'این برنامه مزخرفه، همه چیمو از دست دادم' }));
  assert.match(brief, /SAFETY/);
  assert.equal(brief.includes('- tone: they are hostile'), false);
});

/* -------------------------------------------------------------------------- */
/*  B. PERSIAN PRAGMATICS                                                     */
/* -------------------------------------------------------------------------- */

test('taarof is read as politeness, not as information', () => {
  const read = readSocialContext({ message: 'قربونت، اگر زحمتی نیست یه سؤال بپرسم' });
  assert.equal(read.pragmatics.taarof, true);
  assert.equal(read.pragmatics.politeRequest, true);
  const brief = renderSocialBrief(read);
  assert.match(brief, /taarof/);
  assert.match(brief, /Do not take it literally/);
  assert.match(brief, /Treat it as a normal request/);
});

test('an indirect refusal is accepted, not re-offered', () => {
  const read = readSocialContext({ message: 'فعلاً نه، شاید بعداً' });
  assert.equal(read.pragmatics.indirectRefusal, true);
  assert.match(renderSocialBrief(read), /do not push, do not re-offer/);
});

/* -------------------------------------------------------------------------- */
/*  C. CONVERSATION-LEVEL READ                                                */
/* -------------------------------------------------------------------------- */

test('the same question asked twice is recognised as a repeat', () => {
  const read = readSocialContext({
    message: 'قیمت بیت‌کوین با توجه به داده زنده چقدر است؟',
    history: 'کاربر پرسید قیمت بیت‌کوین با توجه به داده زنده چقدر است و پاسخ گرفت.'
  });
  assert.equal(read.relationship.repeat, true);
  assert.equal(read.relationship.hasHistory, true);
  assert.match(renderSocialBrief(read), /already asked this/);
});

test('a different question in the same conversation is not a repeat', () => {
  const read = readSocialContext({
    message: 'ریسک نگه‌داشتن اتریوم در این شرایط چیست؟',
    history: 'کاربر دربارهٔ قیمت بیت‌کوین و ورود سرمایه پرسید.'
  });
  assert.equal(read.relationship.repeat, false);
});

test('tone that worsened across turns is marked rising; a calmer turn is cooling', () => {
  const rising = readSocialContext({
    message: 'بازم هیچی نگفتی، این چه وضعشه',
    history: 'کاربر ناراضی بود و گفت جواب قبلی بیفایده است.'
  });
  assert.equal(rising.relationship.historyTone, 'hostile');
  assert.equal(rising.relationship.escalation, 'rising');
  assert.match(renderSocialBrief(rising), /tone has worsened/);

  const cooling = readSocialContext({
    message: 'ممنون، حالا یک سؤال دیگر دارم',
    history: 'کاربر عصبانی بود و گفت این چه وضعشه.'
  });
  assert.equal(cooling.relationship.escalation, 'cooling');
  assert.match(renderSocialBrief(cooling), /tone has improved/);
});

test('without history there is no relationship claim and no relationship line', () => {
  const read = readSocialContext({ message: 'قیمت BTC چنده؟' });
  assert.equal(read.relationship.hasHistory, false);
  assert.equal(read.relationship.escalation, 'unknown');
  assert.equal(renderSocialBrief(read), '', 'an ordinary neutral question stays untouched');
});

/* -------------------------------------------------------------------------- */
/*  D. WIRING                                                                 */
/* -------------------------------------------------------------------------- */

const CONTEXT = { market: { priceMap: { BTC: 108000 } } };
const ANSWER = 'می‌فهمم این وضعیت سخت است و در این پیام توصیهٔ معاملاتی نمی‌دهم. برای قدم بعدی، با یک آدم مطمئن '
  + 'یا مشاور مالی مستقل حرف بزن و تا روشن‌شدن وضعیت هیچ تصمیم مالی تازه‌ای نگیر.';

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
    finalCalls: () => calls.filter((c) => c.system.includes('Final Answer AI'))
  };
}

test('max: a distressed message reaches the synthesiser with the safety brief', async () => {
  const fleet = makeFleet();
  const out = await runCollaborativeAnalysis({
    message: 'همه پولمو از دست دادم، دیگه فایده‌ای نداره',
    locale: 'fa',
    context: CONTEXT,
    intelligence: 'max',
    deps: fleet,
    deadlineMs: 15000
  });
  assert.equal(out.socialRead.distress, true);
  assert.match(fleet.finalCalls()[0].system, /SAFETY/);
  assert.match(fleet.finalCalls()[0].system, /Do NOT give trading or investment advice/);
});

test('max: the session summary becomes a conversation-level read', async () => {
  const fleet = makeFleet({ finalAnswer: 'قیمت بیت‌کوین در داده زنده ۱۰۸٬۰۰۰ دلار است و سطح بعدی خوانده نشده؛ همان عددی است که قبلاً هم گفتم و تنها چیز تازه، فشار فروش امروز است.' });
  const out = await runCollaborativeAnalysis({
    message: 'قیمت بیت‌کوین با توجه به داده زنده چقدر است؟',
    locale: 'fa',
    context: { ...CONTEXT, conversationSummary: 'کاربر پرسید قیمت بیت‌کوین با توجه به داده زنده چقدر است و پاسخ گرفت.' },
    intelligence: 'max',
    deps: fleet,
    deadlineMs: 15000
  });
  assert.equal(out.socialRead.relationship.repeat, true);
  assert.match(fleet.finalCalls()[0].system, /already asked this/);
});

test('balanced: a distressed substantive message receives a social safety read', async () => {
  const fleet = makeFleet();
  const out = await runCollaborativeAnalysis({
    message: 'همه پولمو از دست دادم، دیگه فایده‌ای نداره',
    locale: 'fa',
    context: CONTEXT,
    intelligence: 'balanced',
    deps: fleet,
    deadlineMs: 15000
  });
  assert.equal(out.socialRead.distress, true);
  assert.ok(fleet.calls.some(c => c.system.includes('SAFETY')));
});
