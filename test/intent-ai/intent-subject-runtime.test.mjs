/*
 * IS THE SUBJECT OF THE SENTENCE RECOGNISED, WHICHEVER WAY IT IS WRITTEN?
 * ==========================================================================
 *
 * Three defects in the intent layer, all of the same shape: a rule that knew
 * ONE spelling of a question and silently returned nothing for the others.
 *
 *   1. THE BARE TOPIC NOUN. «استیکینگ» alone has always been a staking question
 *      and «نقدینگی» alone a liquidity one — in this file a single topic noun
 *      means "show me this". The yield intent was the only one without that
 *      branch, so «ییلد», «بازده», «فارم» and «APY» fell to UNSUPPORTED: an
 *      intent with no engine, whose reply explains what the system cannot do, to
 *      a user who asked for something it can.
 *
 *   2. A MARKER WORD TREATED AS A QUESTION TYPE. `ASSET_ANALYSIS` carried bare
 *      `yield`/`farm`/`apy` alternatives, so every mention of yield became an
 *      asset-analysis turn. The subject of «بهترین ییلد» is opportunities, not an
 *      asset; what makes an analysis turn an analysis turn is the analysis verb.
 *
 *   3. ONE WORD ORDER. The plain risk question was recognised as «ریسک چقدره»
 *      and as nothing else, so «چقدر ریسک دارم» and «how much risk do I have» —
 *      the same question with the words the other way round — were UNSUPPORTED.
 *
 * The fix for (3) shipped broken the first time, and the reason is worth more
 * than the fix: it ended in `\b`, and JS defines a word boundary over `\w`,
 * which is ASCII only. A boundary asserted after a Persian letter can never be
 * satisfied, so the pattern was dead on arrival while looking perfectly correct.
 * The last test here exists to make that trap visible rather than to trust that
 * it has been remembered.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify } from '../../src/lib/central/intent.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const typeOf = (text) => classify(text)?.type || classify(text)?.intent || null;

/* ─── 1. the topic noun alone is the request ──────────────────────────────── */

test('a bare topic noun is a request, in every intent that has one', () => {
  for (const [text, want] of [
    ['ییلد', 'YIELD_OPPORTUNITY'],
    ['بازده', 'YIELD_OPPORTUNITY'],
    ['فارم', 'YIELD_OPPORTUNITY'],
    ['APY', 'YIELD_OPPORTUNITY'],
    ['yield', 'YIELD_OPPORTUNITY'],
    ['استیکینگ', 'STAKING_REWARD'],
    ['نقدینگی', 'LIQUIDITY_RISK']
  ]) {
    assert.equal(typeOf(text), want, `${JSON.stringify(text)} is the shortest way to ask, and it must not fall through`);
  }
});

test('the yield noun is the head of its own sentence', () => {
  /* No question word, but a subject and a scope: the noun carries the request.
     These two were the holes that opened when ASSET_ANALYSIS stopped claiming
     the yield nouns — proof that removing a wrong match is not the same as
     making the right one reachable. */
  for (const [text, want] of [
    ['farm ETH', 'YIELD_OPPORTUNITY'],
    ['best yield now', 'YIELD_OPPORTUNITY'],
    ['ییلد USDC', 'YIELD_OPPORTUNITY'],
    ['apy on USDC', 'YIELD_OPPORTUNITY']
  ]) {
    assert.equal(typeOf(text), want, `${JSON.stringify(text)} names an opportunity and nothing else`);
  }
});

test('an analysis verb keeps its message', () => {
  /* The yield rule is listed before ASSET_ANALYSIS, so without the guard it
     would simply take these first. What makes them analysis is the verb. */
  for (const text of ['تحلیل فارم ETH', 'بررسی ETH', 'analyze the ETH farm', 'وضعیت بیت کوین چطوره']) {
    assert.equal(typeOf(text), 'ASSET_ANALYSIS', `${JSON.stringify(text)} asked for an analysis, not a ranking of opportunities`);
  }
});

/* ─── 2. the plain risk question, in both word orders and both languages ──── */

test('the risk question is recognised however its words are ordered', () => {
  for (const [text, want] of [
    ['ریسک چقدره', 'RISK_OVERVIEW'],
    ['ریسکش چقدر است', 'RISK_OVERVIEW'],
    ['چقدر ریسک دارم', 'RISK_OVERVIEW'],
    ['ریسک کل', 'RISK_OVERVIEW'],
    ['ریسک کلی چقدره', 'RISK_OVERVIEW'],
    ['risk level now', 'RISK_OVERVIEW'],
    ['how much risk do I have', 'RISK_OVERVIEW'],
    ['what is my risk', 'RISK_OVERVIEW'],
    ['how risky am i', 'RISK_OVERVIEW']
  ]) {
    assert.equal(typeOf(text), want, `${JSON.stringify(text)} asks about overall risk`);
  }
});

test('a named risk is never stolen by the plain one', () => {
  /* THE SAFETY HALF OF THE RULE. The specific risks are listed AFTER
     RISK_OVERVIEW and lose to it on order, so the only thing protecting them is
     that the gap between the risk noun and its question word stays empty. If a
     qualifier is ever allowed into that gap, four intents quietly become one. */
  for (const [text, want] of [
    ['ریسک نقدینگی چقدره', 'LIQUIDITY_RISK'],
    ['چقدر ریسک نقدینگی دارم', 'LIQUIDITY_RISK'],
    ['how much liquidity risk do I have', 'LIQUIDITY_RISK'],
    ['ریسک فیوچرز', 'FUTURES_RISK'],
    ['ریسک تمرکز', 'CONCENTRATION_CHECK'],
    ['ریسک پرتفوی من', 'PORTFOLIO_ANALYSIS']
  ]) {
    assert.equal(typeOf(text), want, `${JSON.stringify(text)} names which risk, so it is not the plain question`);
  }
});

/* ─── 3. the trap that made the first version of the fix dead ─────────────── */

test('no rule asserts a word boundary it can never satisfy', () => {
  /*
   * `\b` after Persian script is not a stricter pattern, it is a dead one: JS
   * computes word boundaries from `\w`, which excludes every Persian letter, so
   * the boundary is unsatisfiable and the alternative matches nothing. It is
   * invisible in review and silent at runtime — the intent simply never fires.
   *
   * The scan is deliberately narrow. A `\b` is only reported when the token
   * directly before it is Persian script, possibly through a quantifier or a
   * closing paren. `(farm|فارم)\b` is NOT reported, because its ASCII branch can
   * satisfy the boundary; that is a latent inconsistency, not a dead pattern, and
   * failing the build over it would train everybody to ignore this gate.
   */
  const src = readFileSync(path.join(ROOT, 'src', 'lib', 'central', 'intent.js'), 'utf8');
  const DEAD_BOUNDARY = /[\u0600-\u06FF](?:[?*)]|\{[^}]*\}|\s|\u200c)*\\b/g;

  /*
   * A candidate is only DEAD if nothing else in its own group can satisfy the
   * boundary. `(farm|فارم)\b` is not dead, because the ASCII branch matches and
   * the boundary holds for it — reporting that would be a false positive, and a
   * gate that cries wolf gets ignored, which is worse than no gate.
   *
   * So the enclosing group is found by walking backwards with a depth counter
   * rather than by guessing at a window of nearby characters.
   */
  const enclosingScope = (text, at) => {
    let depth = 0;
    for (let i = at; i >= 0; i--) {
      const c = text[i];
      if (c === ')') depth++;
      else if (c === '(') {
        if (depth === 0) {
          let inner = 1;
          for (let j = i + 1; j < text.length; j++) {
            if (text[j] === '(') inner++;
            else if (text[j] === ')') { inner--; if (inner === 0) return text.slice(i + 1, j); }
          }
          return text.slice(i + 1);
        }
        depth--;
      } else if (c === '/' && depth === 0) return text.slice(i + 1, at + 3);
    }
    return text.slice(0, at + 3);
  };

  const offenders = [];
  src.split('\n').forEach((text, i) => {
    if (!text.includes('\\b')) return;
    DEAD_BOUNDARY.lastIndex = 0;
    let m;
    while ((m = DEAD_BOUNDARY.exec(text)) !== null) {
      const scope = enclosingScope(text, m.index);
      /* If the same group offers an ASCII alternative, the boundary can hold. */
      if (/[a-zA-Z]{2,}/.test(scope)) continue;
      offenders.push(`${i + 1}: ${text.trim().slice(0, 120)}`);
      break;
    }
  });

  assert.deepEqual(
    offenders,
    [],
    'every \\b in this file must be satisfiable by something the pattern can actually match'
  );
});

test('a status verb beside the yield noun is still a yield question', () => {
  /* The question-word list had every interrogative except the one that asks HOW
     THINGS ARE, so a plain status question about yield fell through to
     ASSET_ANALYSIS, which claims the status verbs for itself. What keeps this
     from becoming an analysis rule is that the word must sit beside the yield
     noun: the verb that makes an analysis turn is not in the list. */
  for (const text of ['ییلد چطوره', 'بازده چگونه است', 'apy how is it']) {
    assert.equal(typeOf(text), 'YIELD_OPPORTUNITY', `${JSON.stringify(text)} asks how the yield is`);
  }
});

test('a bare risk noun is a request — and only when it is alone', () => {
  /* Every other topic noun in the file classified on its own; the risk noun did
     not. The consequence was bigger than the single word: «ریسک و بازده» could
     not be split into two legs, because the first leg was UNSUPPORTED and a
     split with an engine-less leg is rejected — so the compound question was
     lost twice over. The rule is ANCHORED, because it is listed before the
     specific risks and an unanchored noun would take all of them. */
  assert.equal(typeOf('ریسک'), 'RISK_OVERVIEW', 'the topic noun alone is a request');
  assert.equal(typeOf('risk'), 'RISK_OVERVIEW', 'on either keyboard');
  assert.equal(typeOf('ریسک و بازده') !== 'UNSUPPORTED', true, 'and a compound whose legs both classify is a compound');
});

test('a compound question is only splittable if every leg classifies', () => {
  /* THE REASON A BARE NOUN MATTERS BEYOND ITSELF. A split is rejected when one
     leg has no engine, so a single missing bare-noun rule silently turned two
     questions into one. Both of these were UNSUPPORTED-legged before this
     round. */
  for (const [text, wantLegs] of [
    ['بازار و ییلد', ['MARKET_OVERVIEW', 'YIELD_OPPORTUNITY']],
    ['ریسک و بازده', ['RISK_OVERVIEW', 'YIELD_OPPORTUNITY']],
    ['بازار و ییلد چطوره', ['MARKET_OVERVIEW', 'YIELD_OPPORTUNITY']]
  ]) {
    const r = classify(text);
    const legs = (r?.compound || []).map((c) => c.intent);
    assert.deepEqual(legs, wantLegs,
      `${JSON.stringify(text)} must split into ${wantLegs.join(' + ')}, got ${legs.join(' + ') || 'nothing'}`);
    assert.ok(!legs.includes('UNSUPPORTED'),
      `${JSON.stringify(text)} has an engine-less leg, so the split will be rejected and a question will be dropped`);
  }
});
