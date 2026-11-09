/**
 * «هر سؤالی دربارهٔ FBT، سازنده‌ها، کارها و همهٔ صفحه‌ها» — answered from the
 * repository, and refused honestly where the repository has no truth.
 * ---------------------------------------------------------------------------
 * The assistant that answers product questions from memory is the assistant
 * that invents a founder, a fee, or a page. `server/aiProductBrain.js` builds
 * its answer from three real sources instead:
 *
 *   · the app's own route table (`src/App.jsx`) — so «چه صفحه‌هایی داری؟» is a
 *     list of routes that ship, and a plausible-but-absent route is caught;
 *   · the verified knowledge center + the real fee + the policy caps + the
 *     execution authority;
 *   · an explicit gap list for what is NOT in the repository — the founders
 *     are the loudest one. Absent knowledge becomes «ثبت نشده», never a name.
 *
 * These tests are offline: no provider, no network, no key.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PRODUCT_BRAIN_SCHEMA,
  pageCatalog,
  answerProduct,
  detectProductQuestion,
  detectProductIntent,
  renderProductBrief,
  checkProductAnswer,
  renderProductDeficit,
  PRODUCT_FACTS,
  PRODUCT_CAPABILITIES
} from '../../server/aiProductBrain.js';
import { FBT_KNOWLEDGE, searchKnowledge } from '../../src/lib/intent-ai/os/knowledgeCenter.js';
import { FEE_BPS } from '../../src/lib/feeBps.js';
import { runCollaborativeAnalysis } from '../../server/aiCollaboration.js';
import { planCollaboration } from '../../src/lib/intent-ai/os/collaborationRouter.js';

/* -------------------------------------------------------------------------- */
/*  A. THE PAGE CATALOG                                                       */
/* -------------------------------------------------------------------------- */

test('every route the router ships is in the catalog', () => {
  const pages = pageCatalog();
  assert.ok(pages.length >= 70, `expected the full router, got ${pages.length}`);
  const paths = pages.map((p) => p.path);
  for (const essential of ['/', '/swap', '/bridge', '/wallet', '/portfolio', '/signals', '/about', '/contact']) {
    assert.ok(paths.includes(essential), `${essential} is missing from the catalog`);
  }
  assert.equal(new Set(paths).size, paths.length, 'a path is listed twice');
});

test('routes carry a purpose line, and the undescribed ones say so', () => {
  const pages = pageCatalog();
  const described = pages.filter((p) => p.described);
  assert.ok(described.length >= 70, `only ${described.length} routes are described`);
  const swap = pages.find((p) => p.path === '/swap');
  assert.match(swap.purposeFa, /سواپ/);
  for (const page of pages.filter((p) => !p.described)) {
    assert.match(page.purposeFa, /توضیح رسمی ثبت نشده/, `${page.path} pretends to be described`);
  }
});

test('feature-gated routes are catalogued as gated, not as plain pages', () => {
  const gated = pageCatalog().filter((p) => p.gated);
  assert.ok(gated.length >= 1, 'no gated route detected');
  for (const page of gated) assert.match(page.gate, /^[A-Z0-9_]+$/);
});

/* -------------------------------------------------------------------------- */
/*  B. THE ANSWER                                                             */
/* -------------------------------------------------------------------------- */

test('a product question is told apart from a market question', () => {
  assert.equal(detectProductQuestion('FBT چیه؟'), true);
  assert.equal(detectProductQuestion('چرا کارمزد FBT از بقیه بیشتره؟'), true);
  assert.equal(detectProductQuestion('سازندگان FBT کی هستن؟'), true);
  assert.equal(detectProductQuestion('/swap چه کاری می‌کند؟'), true);
  assert.equal(detectProductQuestion('چه صفحه‌هایی داری؟'), true);
  assert.equal(detectProductQuestion('چه کارهایی می‌تونی بکنی؟'), true);

  assert.equal(detectProductQuestion('قیمت BTC چنده؟'), false);
  assert.equal(detectProductQuestion('کارمزد صرافی‌های دیگر چقدره؟'), false);
  assert.equal(detectProductQuestion('چه کار کنم الان؟'), false);
  assert.equal(detectProductQuestion(''), false);
});

test('intent is classified before the answer is written', () => {
  assert.equal(detectProductIntent('سازندگان FBT کی هستن؟'), 'creators');
  assert.equal(detectProductIntent('همهٔ صفحه‌های FBT را بگو'), 'pages');
  assert.equal(detectProductIntent('/wallet چه کاری می‌کند؟'), 'page');
  assert.equal(detectProductIntent('کارمزد FBT چقدره؟'), 'fees');
  assert.equal(detectProductIntent('آیا FBT امن است؟'), 'security');
  assert.equal(detectProductIntent('چه کارهایی می‌تونی بکنی؟'), 'capabilities');
  assert.equal(detectProductIntent('FBT چیه؟'), 'identity');
});

test('the fee answer quotes the real fee, and only the real fee', () => {
  const answer = answerProduct({ message: 'کارمزد FBT چقدره؟' });
  assert.equal(answer.intent, 'fees');
  assert.equal(answer.confidence, 'verified');
  assert.match(answer.answer, /۰٫۷٪|0\.7%|70 bps/);
  assert.match(answer.answer, /۱٪|1%/);
  const fee = answer.facts.find((f) => f.id === 'fee');
  assert.equal(fee.source, 'src/lib/feeBps.js');
  assert.deepEqual(checkProductAnswer({ product: answer, answer: answer.answer }).issues, []);
});

test('the page answer names real routes and marks gated ones', () => {
  const answer = answerProduct({ message: '/perp چه کاری می‌کند؟' });
  assert.equal(answer.intent, 'page');
  assert.equal(answer.confidence, 'verified');
  assert.equal(answer.pages[0].path, '/perp');
  assert.equal(answer.pages[0].gated, true);
  assert.match(answer.answer, /مشتقه/);

  const list = answerProduct({ message: 'همهٔ صفحه‌های FBT را بگو' });
  assert.equal(list.intent, 'pages');
  assert.ok(list.pageCount >= 70);
  assert.ok(list.answer.includes('/swap'));
});

test('a route that does not exist is answered as absent, not invented', () => {
  const answer = answerProduct({ message: '/staking چه کاری می‌کند؟' });
  assert.equal(answer.intent, 'page');
  assert.equal(answer.confidence, 'absent');
  assert.deepEqual(answer.gaps, ['page']);
  assert.match(answer.answer, /پیدا نکردم/);
  assert.match(renderProductBrief(answer), /does not exist in the app/);
});

test('the creators answer says it is not recorded — and names nobody', () => {
  const answer = answerProduct({ message: 'سازندگان FBT کی هستن؟' });
  assert.equal(answer.intent, 'creators');
  assert.equal(answer.confidence, 'absent');
  assert.deepEqual(answer.gaps, ['creators']);
  assert.match(answer.answer, /ثبت نشده/);
  assert.match(answer.answer, /\/contact/);
  /* No capitalised/unknown name may appear in the honest answer. */
  assert.equal(/بنیان‌گذار\s+\S+\s+(است|هست)/.test(answer.answer), false);
  assert.match(renderProductBrief(answer), /Do not name anyone/);
});

test('security questions stand on custody and the never-asks rule', () => {
  const answer = answerProduct({ message: 'آیا کیف پول FBT امن است؟' });
  assert.equal(answer.intent, 'security');
  assert.equal(answer.confidence, 'verified');
  const ids = answer.facts.map((f) => f.id);
  assert.deepEqual(ids.sort(), ['authority', 'custody', 'never-asks']);
  assert.match(answer.answer, /غیرامانی/);
  assert.match(answer.answer, /عبارت بازیابی/);
});

test('capabilities are the layers that actually ship', () => {
  const answer = answerProduct({ message: 'چه کارهایی می‌تونی بکنی؟' });
  assert.equal(answer.intent, 'capabilities');
  const text = answer.answer;
  for (const phrase of ['حالت', 'راستی‌آزمایی']) assert.ok(text.includes(phrase), `missing ${phrase}`);
  assert.ok(PRODUCT_CAPABILITIES.length >= 8);
});

test('the identity answer is grounded in the knowledge center', () => {
  const answer = answerProduct({ message: 'FBT چیه؟' });
  assert.equal(answer.intent, 'identity');
  assert.equal(answer.confidence, 'verified');
  assert.ok(answer.knowledge.some((k) => k.id === 'kb.product.overview'));
  assert.ok(answer.sources.includes('kb.product.overview'));
});

test('the English answer says the same verified things', () => {
  const answer = answerProduct({ message: 'What is the FBT fee?', locale: 'en' });
  assert.equal(answer.intent, 'fees');
  assert.match(answer.answer, /0\.7%/);
  const creators = answerProduct({ message: 'Who founded FBT?', locale: 'en' });
  assert.equal(creators.confidence, 'absent');
  assert.match(creators.answer, /will not compose one/);
});

test('every fact the brain states carries a source', () => {
  for (const fact of PRODUCT_FACTS) {
    assert.equal(fact.status, 'verified');
    assert.ok(fact.source && fact.source.length > 5, `${fact.id} has no source`);
  }
});

test('the knowledge center now carries the fee, the team gap and the page map', () => {
  const fee = FBT_KNOWLEDGE.find((k) => k.id === 'kb.product.fee');
  assert.ok(fee, 'kb.product.fee is missing');
  assert.equal(fee.source, 'src/lib/feeBps.js');
  /* Stated from the constant, not retyped: the body must move with FEE_BPS. */
  assert.match(fee.bodyFa, /کارمزد/);
  assert.ok(fee.bodyEn.includes(`${FEE_BPS} bps`), 'the body does not quote the real bps');
  assert.match(fee.bodyFa, /۰٫۷٪/);
  assert.match(fee.bodyFa, /۱٪/);

  const team = FBT_KNOWLEDGE.find((k) => k.id === 'kb.product.team');
  assert.ok(team);
  assert.match(team.bodyFa, /ثبت نشده/);

  const pages = FBT_KNOWLEDGE.find((k) => k.id === 'kb.product.pages');
  assert.ok(pages);
  assert.match(pages.bodyFa, /جدول مسیر/);

  assert.equal(searchKnowledge('کارمزد پلتفرم FBT چقدر است', { locale: 'fa' })[0].id, 'kb.product.fee');
  assert.ok(searchKnowledge('سازندگان FBT چه کسانی هستند', { locale: 'fa' }).some((k) => k.id === 'kb.product.team'));
});

/* -------------------------------------------------------------------------- */
/*  C. THE BOUNDARY                                                           */
/* -------------------------------------------------------------------------- */

const creatorsTurn = () => answerProduct({ message: 'سازندگان FBT کی هستن؟' });
const feeTurn = () => answerProduct({ message: 'کارمزد FBT چقدره؟' });

test('naming a founder the repository does not contain is HIGH', () => {
  const bad = checkProductAnswer({
    product: creatorsTurn(),
    answer: 'بنیان‌گذار FBT آقای احمدی است و تیم ما در تهران کار می‌کند.'
  });
  assert.ok(bad.issues.some((i) => i.id === 'UNVERIFIED_CREATOR_CLAIM'));
  assert.equal(bad.compliant, false);
  assert.match(renderProductDeficit(bad), /PRODUCT KNOWLEDGE VIOLATIONS/);
});

test('a founding year is the same fabrication', () => {
  const bad = checkProductAnswer({ product: creatorsTurn(), answer: 'FBT در سال ۲۰۱۹ تاسیس شد.' });
  assert.ok(bad.issues.some((i) => i.id === 'UNVERIFIED_CREATOR_CLAIM'));
});

test('the honest «ثبت نشده» answer is never punished', () => {
  const honest = 'نام سازندگان یا اعضای تیم در دانش تأییدشدهٔ محصول ثبت نشده است؛ من نام از خودم نمی‌سازم. صفحهٔ /contact مرجع رسمی است.';
  const good = checkProductAnswer({ product: creatorsTurn(), answer: honest });
  assert.deepEqual(good.issues, []);
  assert.equal(good.compliant, true);
  /* The brain's own template must pass its own check. */
  assert.deepEqual(checkProductAnswer({ product: creatorsTurn(), answer: creatorsTurn().answer }).issues, []);
});

test('a fee that is not the platform fee is HIGH — Persian digits included', () => {
  for (const answer of ['کارمزد FBT ۲ درصد است.', 'کارمزد ما 2.5% است.', 'کارمزد پلتفرم ۵٪ است.']) {
    const bad = checkProductAnswer({ product: feeTurn(), answer });
    assert.ok(bad.issues.some((i) => i.id === 'INVENTED_FEE'), answer);
  }
  for (const answer of ['کارمزد ۰٫۷ درصد است.', 'کارمزد 0.7% است و سقفش ۱٪ است.']) {
    assert.deepEqual(checkProductAnswer({ product: feeTurn(), answer }).issues, [], answer);
  }
});

test('a route that is not in the app is MEDIUM', () => {
  const bad = checkProductAnswer({ product: feeTurn(), answer: 'کارمزد ۰٫۷ درصد است؛ جزئیات در /staking و /fees است.' });
  assert.ok(bad.issues.some((i) => i.id === 'UNSUPPORTED_PAGE'));
  assert.match(renderProductDeficit(bad), /\/fees/);

  const good = checkProductAnswer({ product: feeTurn(), answer: 'کارمزد ۰٫۷ درصد است؛ جزئیات در /help است.' });
  assert.equal(good.issues.length, 0);
});

test('asking the user to send a key contradicts custody — HIGH', () => {
  const bad = checkProductAnswer({
    product: creatorsTurn(),
    answer: 'برای بازیابی حساب، عبارت بازیابی را برای پشتیبانی بفرستید.'
  });
  assert.ok(bad.issues.some((i) => i.id === 'CONTRADICTS_CUSTODY'));
});

test('a turn that is not a product question is never policed', () => {
  const check = checkProductAnswer({ product: null, answer: 'بنیان‌گذار X آقای ... است و کارمزد ۲ درصد.' });
  assert.equal(check.applicable, false);
  assert.equal(check.compliant, true);
  assert.equal(renderProductDeficit(null), '');
});

test('the brief is a source of truth, not a suggestion', () => {
  const brief = renderProductBrief(feeTurn());
  assert.match(brief, /VERIFIED PRODUCT KNOWLEDGE/);
  assert.match(brief, /do not add to it/);
  assert.match(brief, /۰٫۷٪|0\.7%/);
  assert.match(brief, /never fill the gap/i);
  assert.equal(renderProductBrief(null), '');
  assert.equal(renderProductBrief({ schema: 'other' }), '');
});

/* -------------------------------------------------------------------------- */
/*  D. WIRING                                                                 */
/* -------------------------------------------------------------------------- */

const PRODUCT_TURN = 'دربارهٔ FBT توضیح بده: سازنده‌هاش کی هستن، کارمزدش چقدره، و چه صفحه‌هایی برای وام داره؟';
const STRATEGY_PLUS_PRODUCT = 'استراتژی من با ۲۰۰۰۰ دلار چه باشد؟ ریسکش چقدر است و چرا؟ سازندگان FBT کی هستن و کارمزدش چقدره؟';

function makeFleet({ finalAnswer = 'در دانش تأییدشده نامی از سازندگان ثبت نشده است. ' } = {}) {
  const calls = [];
  const execute = async (providerId, opts = {}) => {
    const system = String(opts.system || '');
    calls.push({ system, message: String(opts.user || '') });
    const reply = (text) => ({ provider: providerId, model: 'fake', durationMs: 2, text: JSON.stringify(text) });
    if (system.includes('adversarial self-reviewer')) return reply({ answer: finalAnswer, claims: [], uncertainty: '' });
    if (system.includes('Final Answer AI')) return reply({ answer: finalAnswer, claims: [], uncertainty: '' });
    return reply({ answer: 'تحلیل نقش: محصول غیرامانی است و کارمزدش ۰٫۷٪.', claims: [], uncertainty: '' });
  };
  return {
    execute,
    selectProviders: () => ['fake-a', 'fake-b', 'fake-c'],
    calls,
    finalCalls: () => calls.filter((c) => c.system.includes('Final Answer AI')),
    critiqueCalls: () => calls.filter((c) => c.system.includes('adversarial self-reviewer')),
    productCalls: () => calls.filter((c) => c.system.includes('VERIFIED PRODUCT KNOWLEDGE'))
  };
}

test('max: the product brief reaches the roles and the reply publishes it', async () => {
  const fleet = makeFleet();
  const out = await runCollaborativeAnalysis({
    message: PRODUCT_TURN,
    locale: 'fa',
    context: {},
    intelligence: 'max',
    deps: fleet,
    deadlineMs: 15000
  });

  assert.ok(fleet.productCalls().length >= 2, 'the brief did not reach the specialists');
  assert.match(fleet.finalCalls()[0].system, /VERIFIED PRODUCT KNOWLEDGE/);
  assert.match(fleet.finalCalls()[0].system, /Do not name anyone/);

  assert.equal(out.product.schema, PRODUCT_BRAIN_SCHEMA);
  assert.equal(out.product.intent, 'creators');
  assert.equal(out.product.confidence, 'absent');
  assert.deepEqual(out.product.gaps, ['creators']);
  assert.ok(out.product.pageCount >= 70);
  assert.equal(out.product.compliant, true);
});

test('max: an invented founder in the draft is sent back to the reviewer', async () => {
  const fleet = makeFleet({
    finalAnswer: 'بنیان‌گذار FBT آقای رضایی است و شرکت ما در سال ۲۰۱۸ تاسیس شد. '
      + 'کارمزد پلتفرم ۲ درصد است و برای شروع باید در /staking ثبت‌نام کنید. '
      + 'تیم ما در دبی مستقر است و بیش از ۵۰ نفر عضو دارد.'
  });
  const out = await runCollaborativeAnalysis({
    message: STRATEGY_PLUS_PRODUCT,
    locale: 'fa',
    context: {},
    intelligence: 'max',
    deps: fleet,
    deadlineMs: 20000
  });

  assert.ok(fleet.critiqueCalls().length >= 1, 'no reviewer ran on a level-4 turn');
  const critique = fleet.critiqueCalls()[0].message;
  assert.match(critique, /PRODUCT KNOWLEDGE VIOLATIONS/);
  assert.match(critique, /UNVERIFIED_CREATOR_CLAIM/);
  assert.match(critique, /INVENTED_FEE/);
  assert.match(critique, /UNSUPPORTED_PAGE/);
  assert.equal(out.product.compliant, false);
  assert.ok(out.product.violations.includes('UNVERIFIED_CREATOR_CLAIM'));
});

test('a market turn gets no product brief at all', async () => {
  const fleet = makeFleet({ finalAnswer: 'BTC در محدودهٔ ۶۴ تا ۶۸ هزار است. ' });
  const out = await runCollaborativeAnalysis({
    message: 'قیمت BTC چنده و روندش چطوره؟',
    locale: 'fa',
    context: {},
    intelligence: 'max',
    deps: fleet,
    deadlineMs: 15000
  });
  assert.equal(out.product, null);
  assert.equal(fleet.productCalls().length, 0);
});

test('balanced: no product brief reaches the models', async () => {
  const fleet = makeFleet();
  const out = await runCollaborativeAnalysis({
    message: PRODUCT_TURN,
    locale: 'fa',
    context: {},
    intelligence: 'balanced',
    deps: fleet,
    deadlineMs: 15000
  });
  assert.equal(out.product, null);
  for (const call of fleet.calls) assert.equal(call.system.includes('VERIFIED PRODUCT KNOWLEDGE'), false);
});

test('a product question still plans as a real question', () => {
  const planned = planCollaboration({ message: PRODUCT_TURN, intelligence: 'max' });
  assert.ok(planned.level >= 2, `expected a real level, got ${planned.level}`);
  assert.equal(planned.conversationKind, 'QUESTION');
});
