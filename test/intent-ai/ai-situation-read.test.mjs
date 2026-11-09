/**
 * «اگر پولی از دست داده و ناراحت است یک‌جور رفتار کند، اگر سود کرده جور دیگر»
 * ---------------------------------------------------------------------------
 * The emotion layer reads the message; the market frame reads the tape. Neither
 * knows the fact that changes the answer most: the user's OWN portfolio is down
 * 20% while they are panicking, or up 30% while they are euphoric.
 *
 *   down 20%, acute   → acknowledge, no plan, no averaging down, no «جبران میشه»
 *   up 30%, euphoric  → confirm once, say it is unrealized, ask what they would
 *                       give back
 *   up 30%, anxious   → the fear is a real tradeoff, not a mood to fix
 *   no P&L at all     → never call them up or down
 *
 * `server/aiSituationRead.js` joins the aggregate portfolio with the mood, and
 * `checkSituationResponse` catches the six ways an answer gets this wrong.
 * These tests pin the arithmetic, the stance, the checks and the wiring — plus
 * the routing bug this increment exposed: a loss described in words used to be
 * answered on the small-talk path.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SITUATION_SCHEMA,
  readSituation,
  renderSituationContract,
  checkSituationResponse,
  renderSituationDeficit
} from '../../server/aiSituationRead.js';
import { readEmotion } from '../../server/aiEmotionRead.js';
import { runCollaborativeAnalysis } from '../../server/aiCollaboration.js';
import { planCollaboration } from '../../src/lib/intent-ai/os/collaborationRouter.js';

/* -------------------------------------------------------------------------- */
/*  A. THE READ                                                               */
/* -------------------------------------------------------------------------- */

const LOSS_CTX = {
  portfolio: {
    dataStatus: 'live',
    totalValueUsd: 8000,
    pnlUsd: -2000,
    costBasisUsd: 10000,
    holdings: [{ symbol: 'BTC', valueUsd: 6000 }, { symbol: 'ETH', valueUsd: 2000 }]
  }
};

const GAIN_CTX = {
  portfolio: {
    dataStatus: 'live',
    totalValueUsd: 13000,
    pnlUsd: 3000,
    costBasisUsd: 10000,
    holdings: [{ symbol: 'BTC', valueUsd: 13000 }]
  }
};

const emotionOf = (message) => readEmotion({ message });
const situationOf = (context, message, extra = {}) => readSituation({
  context,
  message,
  emotion: extra.emotion === undefined ? emotionOf(message) : extra.emotion,
  ...extra
});

test('a loss and a gain are different situations, not one "portfolio" line', () => {
  const loss = situationOf(LOSS_CTX, 'سبدم ضرر کرده');
  assert.equal(loss.schema, SITUATION_SCHEMA);
  assert.equal(loss.direction, 'loss');
  assert.equal(loss.basis, 'pnl');
  assert.equal(loss.pct, -20);
  assert.equal(loss.magnitudePct, 20);
  assert.equal(loss.hasRead, true);

  const gain = situationOf(GAIN_CTX, 'سبدم سود کرده');
  assert.equal(gain.direction, 'gain');
  assert.equal(gain.pct, 30);
});

test('profit/loss percentage is derived from the cash figures when only they exist', () => {
  const derived = readSituation({
    context: { portfolio: { totalValueUsd: 8000, pnlUsd: -2000, costBasisUsd: 10000 } },
    emotion: null
  });
  assert.equal(derived.pct, -20);
  assert.equal(derived.basis, 'pnl');
});

test('a daily move is not a profit — the basis says so', () => {
  const day = readSituation({
    context: { portfolio: { totalValueUsd: 8000, change24hPct: -6.4 } },
    emotion: null
  });
  assert.equal(day.basis, 'day_change');
  assert.equal(day.pct, -6.4);
  assert.equal(day.direction, 'loss');
  const text = renderSituationContract(day);
  assert.match(text, /TODAY'S move of the portfolio, not their profit or loss/);
});

test('no portfolio means no claim — and the user’s own words are not a measurement', () => {
  const unknown = readSituation({ context: { market: { priceMap: { BTC: 68000 } } }, emotion: null });
  assert.equal(unknown.state, 'unknown');
  assert.equal(unknown.basis, 'none');
  assert.equal(unknown.hasRead, false);
  assert.deepEqual(unknown.numbers, []);
  assert.equal(renderSituationContract(unknown), '');

  const claimed = readSituation({ context: {}, message: 'ضرر کردم و ناراحتم', emotion: null });
  assert.equal(claimed.direction, 'loss_unverified');
  assert.equal(claimed.basis, 'none');
});

test('the state follows the numbers AND the mood', () => {
  const panic = situationOf(LOSS_CTX, 'همه پولمو از دست دادم، دیگه فایده‌ای نداره');
  assert.equal(panic.state, 'loss_panic');

  const upset = situationOf(LOSS_CTX, 'سبدم ضرر کرده، ناراحتم');
  assert.equal(upset.state, 'loss_upset');

  const calm = situationOf(LOSS_CTX, 'سبدم ضرر کرده. وضعیت چطوره؟');
  assert.equal(calm.state, 'loss_calm');

  const euphoric = situationOf(GAIN_CTX, 'خوشحالم، سود کردم، عالیه!');
  assert.equal(euphoric.state, 'gain_euphoric');

  const worried = situationOf(GAIN_CTX, 'سبدم سود کرده ولی می‌ترسم همه‌شو از دست بدم');
  assert.equal(worried.state, 'gain_worried');

  const flat = readSituation({ context: { portfolio: { totalValueUsd: 10000, pnlPct: 0.2 } }, emotion: null });
  assert.equal(flat.state, 'flat');
  assert.equal(flat.direction, 'flat');
});

test('concentration and cash are computed, not guessed', () => {
  const read = situationOf(LOSS_CTX, 'سبدم چطوره؟');
  assert.equal(read.concentration.symbol, 'BTC');
  assert.equal(read.concentration.weightPct, 75);
  assert.equal(read.concentration.holdings, 2);
  assert.ok(read.concentration.hhi > 0.5);

  const withCash = readSituation({
    context: { portfolio: { totalValueUsd: 10000, cashUsd: 2500, holdings: [{ symbol: 'BTC', valueUsd: 7500 }] } },
    emotion: null
  });
  assert.equal(withCash.cashPct, 25);
});

/* -------------------------------------------------------------------------- */
/*  B. THE STANCE                                                             */
/* -------------------------------------------------------------------------- */

test('panic gets acknowledgement and an explicit ban on adding risk', () => {
  const plan = situationOf(LOSS_CTX, 'همه پولمو از دست دادم، دیگه فایده‌ای نداره');
  const text = renderSituationContract(plan);
  assert.match(text, /SITUATION/);
  assert.match(text, /unrealized -20%/);
  assert.match(text, /do NOT propose a plan/);
  assert.match(text, /averaging down, adding, leveraging or borrowing/);
  assert.match(text, /must not be a trade/);
  assert.match(text, /concentration: BTC is 75%/);
});

test('euphoria gets the unrealized caveat and one give-back question', () => {
  const text = renderSituationContract(situationOf(GAIN_CTX, 'خوشحالم، سود کردم، عالیه!'));
  assert.match(text, /Confirm the gain ONCE/);
  assert.match(text, /how much of this are they willing to give back/);
  assert.match(text, /do not encourage leverage/);
  assert.match(text, /Unrealized is not money in hand/);
});

test('an anxious gain is treated as a real tradeoff, not a mood to fix', () => {
  const text = renderSituationContract(situationOf(GAIN_CTX, 'سبدم سود کرده ولی می‌ترسم از دستش بدم'));
  assert.match(text, /fear as legitimate/);
  assert.match(text, /never say «چیزی برای نگرانی نیست»/);
});

test('with no P&L the contract forbids the claim itself', () => {
  const loss = readSituation({ context: {}, message: 'ضرر کردم', emotion: null });
  const text = renderSituationContract(loss);
  assert.match(text, /Never say the user is up or down/);
  assert.match(text, /their statement/);
});

/* -------------------------------------------------------------------------- */
/*  C. THE CHECKS                                                             */
/* -------------------------------------------------------------------------- */

test('congratulating a loss is HIGH', () => {
  const plan = situationOf(LOSS_CTX, 'سبدم ضرر کرده، ناراحتم');
  const bad = checkSituationResponse({ plan: undefined, situation: plan, answer: 'تبریک! عالیه که هنوز BTC داری.' });
  assert.equal(bad.compliant, false);
  assert.ok(bad.issues.some((i) => i.id === 'CELEBRATING_A_LOSS'));
  assert.match(renderSituationDeficit(bad), /SITUATION VIOLATIONS/);
});

test('pushing risk after a loss is HIGH', () => {
  const plan = situationOf(LOSS_CTX, 'سبدم ضرر کرده، ناراحتم');
  for (const answer of ['میانگین کم کن تا پایین‌ترش بیاید.', 'با اهرم ۳ برابر جبران کن.', 'double down here.']) {
    const check = checkSituationResponse({ situation: plan, answer });
    assert.ok(check.issues.some((i) => i.id === 'PUSHING_RISK_AFTER_LOSS'), answer);
  }
});

test('feeding euphoria and promising a recovery are caught', () => {
  const gain = situationOf(GAIN_CTX, 'خوشحالم، سود کردم، عالیه!');
  const fed = checkSituationResponse({ situation: gain, answer: 'عالیه! اهرم بزن و همه رو بزن که قطعاً میره بالاتر.' });
  assert.ok(fed.issues.some((i) => i.id === 'FEEDING_EUPHORIA'));

  const loss = situationOf(LOSS_CTX, 'سبدم ضرر کرده، ناراحتم');
  const promise = checkSituationResponse({ situation: loss, answer: 'نگران نباش، قیمت برمی‌گرده و جبران میشه.' });
  assert.ok(promise.issues.some((i) => i.id === 'FALSE_RECOVERY_PROMISE'));
});

test('a P&L figure the turn does not hold is invented', () => {
  const plan = situationOf(LOSS_CTX, 'سبدم چطوره؟');
  const invented = checkSituationResponse({ situation: plan, answer: 'سبدت ۳۵٪ ضرر کرده است.' });
  assert.ok(invented.issues.some((i) => i.id === 'INVENTED_PNL'));

  const honest = checkSituationResponse({ situation: plan, answer: 'سبدت ۲۰٪ پایین‌تر از قیمت خرید است (۸٬۰۰۰ از ۱۰٬۰۰۰).' });
  assert.equal(honest.issues.some((i) => i.id === 'INVENTED_PNL'), false);
});

test('telling someone they are up with no data is a claim, not an answer', () => {
  const none = readSituation({ context: {}, emotion: null });
  const bad = checkSituationResponse({ situation: none, answer: 'شما در سود هستی و سود خوبی کردی.' });
  assert.ok(bad.issues.some((i) => i.id === 'PROFIT_CLAIM_WITHOUT_DATA'));

  const ok = checkSituationResponse({ situation: none, answer: 'برای این‌که بگویم سود یا ضرر داری، به دادهٔ سبد نیاز دارم.' });
  assert.equal(ok.issues.some((i) => i.id === 'PROFIT_CLAIM_WITHOUT_DATA'), false);
});

test('an answer that ignores a measured portfolio is flagged, and numbers clear it', () => {
  const plan = situationOf(LOSS_CTX, 'سبدم چطوره؟');
  const vague = checkSituationResponse({ situation: plan, answer: 'بازار نوسان دارد و باید صبور بود.' });
  assert.ok(vague.issues.some((i) => i.id === 'IGNORING_PORTFOLIO'));

  const concrete = checkSituationResponse({ situation: plan, answer: 'سبدت ۲۰٪ پایین‌تر از خرید است؛ سنگین‌ترین بخشش BTC با ۷۵٪ است.' });
  assert.equal(concrete.compliant, true);
});

test('a calm market answer with no portfolio is never nagged', () => {
  const none = readSituation({ context: { market: { priceMap: { BTC: 68400 } } }, emotion: null });
  assert.equal(checkSituationResponse({ situation: none, answer: 'BTC امروز ۲٪ ریزش کرده است.' }).applicable, false);
  assert.equal(checkSituationResponse({ situation: null, answer: 'متن' }).compliant, true);
  assert.equal(renderSituationDeficit(null), '');
});

test('the good answers pass every check', () => {
  const panic = situationOf(LOSS_CTX, 'همه پولمو از دست دادم');
  const good = 'واقعاً متأسفم. سبدت ۲۰٪ پایین‌تر از قیمت خرید است (۸٬۰۰۰ از ۱۰٬۰۰۰) و BTC سه‌چهارم آن است. '
    + 'امروز تصمیم معاملاتی نگیر؛ فردا فقط همین دو عدد را نگاه کن.';
  const check = checkSituationResponse({ situation: panic, answer: good });
  assert.equal(check.compliant, true);
  assert.deepEqual(check.issues, []);
});

/* -------------------------------------------------------------------------- */
/*  D. WIRING                                                                 */
/* -------------------------------------------------------------------------- */

const LOSS_TURN = 'سبد من ضرر کرده و ناراحتم. چرا این اتفاق افتاد، ریسکش چقدر است و استراتژی‌ام چه باشد؟';

function makeFleet({ finalAnswer = 'واقعاً متأسفم. سبدت ۲۰٪ پایین‌تر از قیمت خرید است. ' } = {}) {
  const calls = [];
  const execute = async (providerId, opts = {}) => {
    const system = String(opts.system || '');
    calls.push({ system, message: String(opts.user || '') });
    const reply = (text) => ({ provider: providerId, model: 'fake', durationMs: 2, text: JSON.stringify(text) });
    if (system.includes('adversarial self-reviewer')) return reply({ answer: finalAnswer, claims: [], uncertainty: '' });
    if (system.includes('Final Answer AI')) return reply({ answer: finalAnswer, claims: [], uncertainty: '' });
    return reply({ answer: 'تحلیل نقش: ضرر ۲۰٪ و تمرکز بالا روی BTC.', claims: [], uncertainty: '' });
  };
  return {
    execute,
    selectProviders: () => ['fake-a', 'fake-b', 'fake-c'],
    calls,
    finalCalls: () => calls.filter((c) => c.system.includes('Final Answer AI')),
    critiqueCalls: () => calls.filter((c) => c.system.includes('adversarial self-reviewer')),
    situationCalls: () => calls.filter((c) => c.system.includes('SITUATION (their money'))
  };
}

test('max: the situation reaches the roles and the reply publishes it', async () => {
  const fleet = makeFleet();
  const out = await runCollaborativeAnalysis({
    message: LOSS_TURN,
    locale: 'fa',
    context: LOSS_CTX,
    intelligence: 'max',
    deps: fleet,
    deadlineMs: 15000
  });

  assert.ok(fleet.situationCalls().length >= 2);
  assert.match(fleet.finalCalls()[0].system, /SITUATION \(their money/);
  assert.match(fleet.finalCalls()[0].system, /measured this turn: total \$8000/);

  assert.equal(out.situation.schema, SITUATION_SCHEMA);
  assert.equal(out.situation.direction, 'loss');
  assert.equal(out.situation.pct, -20);
  assert.equal(out.situation.hasRead, true);
  assert.equal(out.situation.compliant, true);
});

test('max: congratulating the loss is sent back to the reviewer', async () => {
  const fleet = makeFleet({
    finalAnswer: 'تبریک! عالیه که هنوز BTC داری. میانگین کم کن تا جبران بشه. '
      + 'بازار همیشه بالا و پایین دارد و این طبیعی است. دفعهٔ بعد بهتر عمل می‌کنی.'
  });
  const out = await runCollaborativeAnalysis({
    message: LOSS_TURN,
    locale: 'fa',
    context: LOSS_CTX,
    intelligence: 'max',
    deps: fleet,
    deadlineMs: 15000
  });

  const critique = fleet.critiqueCalls()[0].message;
  assert.match(critique, /SITUATION VIOLATIONS/);
  assert.match(critique, /CELEBRATING_A_LOSS/);
  assert.match(critique, /PUSHING_RISK_AFTER_LOSS/);
  assert.equal(out.situation.compliant, false);
});

test('max: a short disclosure gets a real, careful reply instead of the canned line', async () => {
  const fleet = makeFleet({ finalAnswer: 'خیلی متأسفم که این‌طور شده. این حس الان کاملاً قابل فهم است.' });
  const out = await runCollaborativeAnalysis({
    message: 'ناراحتم',
    locale: 'fa',
    context: {},
    intelligence: 'max',
    deps: fleet,
    deadlineMs: 8000
  });
  assert.equal(fleet.calls.length, 1, 'one careful call, not a pipeline');
  assert.match(fleet.calls[0].system, /EMOTION READ/);
  assert.equal(out.emotion.primary, 'grief');
  assert.ok(out.answer.length > 0, 'the disclosure is answered, not dropped');
});

test('a loss described in words is never answered on the small-talk path', () => {
  const words = 'سبد من ضرر کرده و ناراحتم. چرا این اتفاق افتاد؟';
  const planned = planCollaboration({ message: words, intelligence: 'max' });
  assert.ok(planned.level >= 3, `expected a real analysis level, got ${planned.level}`);
  assert.notEqual(planned.conversationKind, 'CASUAL');

  /* A greeting stays a greeting. */
  assert.equal(planCollaboration({ message: 'سلام، چطوری؟', intelligence: 'max' }).conversationKind, 'GREETING');
});

test('balanced: no situation read reaches the models', async () => {
  const fleet = makeFleet();
  const out = await runCollaborativeAnalysis({
    message: LOSS_TURN,
    locale: 'fa',
    context: LOSS_CTX,
    intelligence: 'balanced',
    deps: fleet,
    deadlineMs: 15000
  });
  assert.equal(out.situation, null);
  for (const call of fleet.calls) {
    assert.equal(call.system.includes('SITUATION (their money'), false);
  }
});
