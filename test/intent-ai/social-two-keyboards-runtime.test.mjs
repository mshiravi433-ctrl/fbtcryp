/*
 * ONE PHRASE, TWO KEYBOARDS, ONE UNDERSTANDING (2026-11-13)
 * ==========================================================================
 *
 * Half this audience types Persian on a Latin phone keyboard. The social
 * classifier already anticipated that: it keeps a `FINGLISH_PATTERNS` block whose
 * entries are merged into the same act lists as the script-side vocabulary and
 * consulted whenever a message contains no Arabic-script character at all. What
 * it did not have was coverage, and two of its patterns were not merely
 * incomplete but DEAD:
 *
 *   · `kha(v|b)r` cannot match «khabar». It demands `kha`, exactly one letter,
 *     then `r`, so it matched the nonsense «khar» and missed the word every
 *     speaker actually types. «che khabar» was read as an incomplete fragment
 *     needing web research — and therefore paid for the flagship ladder — while
 *     «چه خبر» was answered as the pleasantry it is.
 *   · `khodaa?\s*hafez` demands an `h`, so «khodafez», the commonest
 *     romanisation of «خداحافظ», missed.
 *
 * Neither is a stricter pattern. Both are branches that look correct in review
 * and match nothing at runtime, which is the failure mode this file exists to
 * make expensive: a regex that matches nothing does not fail loudly, it quietly
 * decides that this user's spelling is not a greeting.
 *
 * AND THE SECOND HALF IS THE IMPORTANT ONE. Teaching the classifier a new
 * pleasantry without teaching the ACTION GUARD the matching verb opens a hole
 * rather than closing one. The moment «damet garm» became recognisable,
 * «damet garm, hala hame ro befroosh» became a PURE social turn — because the
 * guard knew «بفروش» but not «befroosh», and a pure social turn is routed away
 * from the pipeline that would have read the instruction. Before the greeting fix
 * that message was handled correctly, by accident: nothing in it was recognised
 * at all. The guard tests below are what stop the improvement from being a
 * regression.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { classifySocialAct } from '../../src/lib/intent-ai/os/conversation/socialIntent.js';
import { planCollaboration } from '../../src/lib/intent-ai/os/collaborationRouter.js';

const act = (text) => classifySocialAct(text, { locale: 'fa' });

/* Each pair is ONE phrase: the spelling on a Persian keyboard and the spelling
   on a Latin one. The claim is that they are understood identically. */
const PAIRS = [
  ['چه خبر', 'che khabar', 'WHATS_UP'],
  ['چخبر', 'chekhabar', 'WHATS_UP'],
  ['خبر چیه', 'khabar chie', 'WHATS_UP'],
  ['خداحافظ', 'khodafez', 'GOODBYE'],
  ['خداحافظ', 'khodaafez', 'GOODBYE'],
  ['خداحافظ', 'khodahafez', 'GOODBYE'],
  ['دمت گرم', 'damet garm', 'THANKS'],
  ['دمت گرم', 'damet gharm', 'THANKS'],
  ['ممنون', 'mamnoon', 'THANKS'],
  ['مرسی', 'merci', 'THANKS'],
  ['سپاس', 'sepas', 'THANKS'],
  ['عالی بود', 'aali bud', 'THANKS'],
  ['لطف کردی', 'lotf kardi', 'THANKS'],
  ['زحمت کشیدی', 'zahmat keshidi', 'THANKS'],
  ['قربانت', 'ghorbanat', 'THANKS'],
  ['سلام', 'salam', 'GREETING'],
  ['خوش اومدی', 'khosh oomadi', 'GREETING'],
  ['شب بخیر', 'shab be kheir', 'GREETING'],
  ['خوبی', 'khoobi', 'HOW_ARE_YOU'],
  ['خوبین', 'khoobin', 'HOW_ARE_YOU'],
  ['حالت چطوره', 'haalet chetore', 'HOW_ARE_YOU']
];

test('a phrase means the same thing on both keyboards', () => {
  for (const [persian, latin, want] of PAIRS) {
    const a = act(persian);
    const b = act(latin);
    assert.equal(a.act, want, `${persian} must be read as ${want}`);
    assert.equal(b.act, a.act,
      `${latin} is the same phrase as ${persian} and must be read the same way; got ${b.act}`);
    assert.equal(b.pure, true, `${latin} must count as a pure social turn, or the reply cannot greet`);
  }
});

test('the two patterns that were dead are alive', () => {
  /* Named separately from the table above, because these are not gaps in a
     vocabulary — they are branches that looked correct and matched nothing.
     `kha(v|b)r` needs a vowel it did not have; `khodaa?\s*hafez` needs an `h`
     that half the audience does not type. */
  assert.equal(act('che khabar').act, 'WHATS_UP', 'khabar has a vowel the old pattern dropped');
  assert.equal(act('khodafez').act, 'GOODBYE', 'the commonest romanisation of a goodbye');
  /* And the guard on the fix: a pattern widened to match `khabar` must not have
     started matching words that merely contain those letters. */
  assert.equal(act('kharid o forosh dar market').guard.blocks, true,
    'a sentence about buying and selling is a task, not a pleasantry');
});

test('a money instruction in Latin script is never decoration', () => {
  /* THE SAFETY HALF. Recognising more pleasantries must not make the guard
     blinder: the guard is the only thing that keeps a greeting beside an
     instruction from steering the whole turn into small talk. */
  for (const text of [
    'damet garm, hala hame ro befroosh',
    'salam, 100 dollar bitcoin bekhar',
    'mamnoon, hala swap kon',
    'khodafez, farda position baz mikonam',
    'aali bud, hala ahrom 10x bezan',
    'che khabar? va begoo chetor 1000 dollar ra tabdil konam'
  ]) {
    const r = act(text);
    assert.equal(r.pure, false, `${JSON.stringify(text)} carries an instruction, so it may not be a pure social turn`);
    /* `executionAuthorized` is a top-level field of the social read; reaching for
       it through `r.social` (a boolean) would yield undefined and pass for the
       wrong reason, which is the same as not asserting it at all. */
    assert.equal(r.executionAuthorized, false,
      `${JSON.stringify(text)} must never carry execution authority from a social read`);
  }
});

test('a pleasantry stays a pleasantry — the guard must not over-fire', () => {
  /* The opposite failure, and the one that would be invisible in use: if the new
     verb list caught words inside ordinary pleasantries, every thank-you would
     become a full-price turn and the tiering above would discount nothing. */
  for (const text of ['salam', 'che khabar', 'khodafez', 'mamnoon', 'damet garm', 'aali bud', 'khoobi', 'sepas', 'lotf kardi', 'thanks', 'hi']) {
    const r = act(text);
    assert.equal(r.pure, true, `${JSON.stringify(text)} is a pleasantry and must stay one`);
    assert.equal(r.guard.blocks, false, `${JSON.stringify(text)} must not trip the action guard`);
  }
});

test('the router protects a Latin-script pleasantry exactly as it protects the Persian one', () => {
  /* The link to the tier decision: `smallTalkProtected` is what stops a greeting
     from buying the flagship ladder, and it has to follow the social read on
     both keyboards or the discount only exists for one half of the audience. */
  for (const [persian, latin] of [['سلام', 'salam'], ['چه خبر', 'che khabar'], ['خداحافظ', 'khodafez'], ['دمت گرم', 'damet garm']]) {
    const a = planCollaboration({ message: persian, locale: 'fa' });
    const b = planCollaboration({ message: latin, locale: 'fa' });
    assert.equal(a.intelligence.smallTalkProtected, true, `${persian} must be protected`);
    assert.equal(b.intelligence.smallTalkProtected, a.intelligence.smallTalkProtected,
      `${latin} must be protected the same way as ${persian}`);
  }
});

test('the social read never contradicts itself about the guard', () => {
  /*
   * FOUND WHILE TESTING SOMETHING ELSE, AND FIXED. The no-social-marker return
   * chose its evidence string from the real guard and then returned an empty one,
   * so «kharid» came back as `evidence: ['guard:action']` beside
   * `guard.blocks: false`. No behaviour depended on it — the act was already
   * NOT_SOCIAL — which is precisely why it survived: a field that is wrong only
   * where nothing reads it for a decision is read for telemetry instead, and
   * telemetry that contradicts itself is where a misdiagnosis starts.
   */
  for (const text of ['kharid', 'befroosh', 'kharid o forosh dar market', 'salam', '...', '??', 'che khabar']) {
    const r = act(text);
    const saysBlocked = (r.evidence || []).some((e) => String(e).startsWith('guard:action'));
    assert.equal(saysBlocked, r.guard.blocks === true,
      `${JSON.stringify(text)}: evidence ${JSON.stringify(r.evidence)} disagrees with guard ${JSON.stringify(r.guard)}`);
    assert.equal(r.executionAuthorized, false, 'a social read never carries execution authority');
  }
});
