/*
 * THE SENTENCES PEOPLE ACTUALLY TYPE
 * ---------------------------------------------------------------------------
 *
 * The engine-reach sweep grew to all thirty-six intents, and the ten it
 * added were the EXECUTION ones — the ones with consequences. A
 * misclassified EXECUTE is a transaction the user did not ask for, so
 * the sweep asked about them in the shapes that produce the most
 * DANGEROUS confusion:
 *
 *   · a QUOTE that reads like an ORDER («قیمت سواپ بیت‌کوین چقدر است؟»
 *     wants a price; «ETH را به USDC سواپ کن» wants the trade);
 *   · a NAVIGATION that reads like a COMMAND («برو به شبکه پالیگان» is
 *     a bridge, not a page);
 *   · a CONFIRMATION that only means something when there is an action
 *     waiting.
 *
 * It found five real failures, and each of them was a hole in the
 * language, not in an engine:
 *
 *   1. «برو به شبکه پالیگان» was NAVIGATE, because the navigation
 *      pattern was `/برو به (صفحه )?/` — the page word was OPTIONAL.
 *      It only showed up when the wallet was unreadable, because the
 *      execute intent was then down-scored — but it was wrong either
 *      way: a destination on a chain is not a screen.
 *
 *   2. `stateDigest` sorted `ANALYSIS_MINIMUM` and `STATE_SECTION_IDS`
 *      IN PLACE, and both are `Object.freeze`d. In strict mode (which
 *      ES modules are) that threw
 *
 *          TypeError: Cannot assign to read only property '0' of object '[object Array]'
 *
 *      and every CANCEL_PENDING turn died on the way to its answer.
 *
 *   3. `QUOTE_BRIDGE` had NO RULE AT ALL. The intent was declared,
 *      given modules, given a priority — and nothing could produce it.
 *
 *   4. «وام بگذار» (lend) and «وام را برگردان» (repay) were
 *      UNSUPPORTED: the patterns only knew «سپرده» and «بدهی», which
 *      are the bank's words and not the user's.
 *
 *   5. «یک هدف برایم بساز» was GOAL_PLAN, because the pattern wanted
 *      «هدف» immediately followed by «بساز» — and Persian puts the
 *      possessive («برایم») in between.
 *
 * These tests pin all five, plus the distinctions that must NOT
 * collapse: a lend is not a borrow, a quote is not an order, and a
 * destination is not a page.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { classify } from '../../src/lib/central/intent.js';
import { stateDigest, createSystemState } from '../../src/lib/central/state.js';

const CAPS = {};
for (const k of [
  'wallet', 'portfolio', 'markets', 'risk', 'lending', 'borrowing', 'crypto',
  'transactions', 'goals', 'routeIntelligence', 'signals', 'news', 'farming',
  'liquidity', 'staking', 'futures', 'dydx', 'globalIntel', 'opportunityFit',
  'macroGraph', 'goalScenarios', 'whyDecision'
]) CAPS[k] = 'AVAILABLE';

const STATE_HAS = Object.fromEntries(Object.keys(CAPS).map((k) => [k, true]));

const classifyIn = (text, { caps = CAPS, has = STATE_HAS } = {}) =>
  classify(text, { context: { capabilities: caps, stateHas: has }, state: {} });

/* ── 1 · navigation needs an OBJECT, not just a preposition ─────────────── */

test('a destination on a chain is a bridge, not a page', () => {
  assert.equal(classifyIn('برو به شبکه پالیگان').type, 'EXECUTE_BRIDGE');
});

test('the same sentence stays a bridge when the wallet is unreadable', () => {
  /* It only became NAVIGATE when the wallet failed, because the execute
     intent was down-scored. A sentence whose meaning depends on an
     unrelated dependency being up is a sentence that is wrong. */
  const caps = { ...CAPS, wallet: 'UNAVAILABLE' };
  const has = { ...STATE_HAS, wallet: true };
  assert.equal(classifyIn('برو به شبکه پالیگان', { caps, has }).type, 'EXECUTE_BRIDGE');
});

test('a request to SEE a page is still navigation', () => {
  for (const text of [
    'برو به صفحه پورتفوی',
    'نمایش بده',
    'باز کن منوی تنظیمات',
    'open the swap page',
    'navigate to dashboard'
  ]) {
    assert.equal(classifyIn(text).type, 'NAVIGATE', `«${text}» should navigate`);
  }
});

/* ── 2 · a frozen constant cannot be sorted in place ────────────────────── */

test('stateDigest does not throw on the frozen section list', () => {
  /* Both defaults are `Object.freeze`d and `Array.prototype.sort` sorts
     in place. In strict mode that throws, and every CANCEL_PENDING turn
     died here — CANCEL_PENDING has no entry in SECTION_FOR_INTENT, so
     its section list IS `ANALYSIS_MINIMUM`. */
  const state = createSystemState();
  assert.doesNotThrow(() => stateDigest(state));
  assert.doesNotThrow(() => stateDigest(state, ['wallet', 'portfolio', 'markets', 'risk']));
});

test('stateDigest leaves the frozen list exactly as it found it', () => {
  const state = createSystemState();
  const before = [...Object.keys(createSystemState().sections)];
  stateDigest(state);
  const after = [...Object.keys(createSystemState().sections)];
  assert.deepEqual(after, before, 'the frozen section list must survive a digest');
});

test('stateDigest is stable for the same state', () => {
  const state = createSystemState();
  assert.equal(stateDigest(state), stateDigest(state));
});

/* ── 3 · QUOTE_BRIDGE can be produced at all ────────────────────────────── */

test('a question about the cost of a bridge is a quote, not a crossing', () => {
  assert.equal(classifyIn('قیمت پل زدن از ۱ به ۱۳۷ چقدر است؟').type, 'QUOTE_BRIDGE');
  assert.equal(classifyIn('هزینه انتقال چقدر است؟').type, 'QUOTE_BRIDGE');
});

test('an order to cross is an execution', () => {
  assert.equal(classifyIn('پل بزنم از ۱ به ۱۳۷').type, 'EXECUTE_BRIDGE');
});

/* ── 4 · a lend is not a borrow ────────────────────────────────────────── */

test('lending and borrowing are told apart by the verb, not the noun', () => {
  assert.equal(classifyIn('۱۰۰ دلار را در Aave وام بگذار').type, 'EXECUTE_LEND');
  assert.equal(classifyIn('وام بگذار').type, 'EXECUTE_LEND');
  assert.equal(classifyIn('از Aave وام بگیر').type, 'EXECUTE_BORROW');
  assert.equal(classifyIn('وام بگیر').type, 'EXECUTE_BORROW');
});

test('repaying is told apart from borrowing', () => {
  assert.equal(classifyIn('وام Aave را برگردان').type, 'EXECUTE_REPAY');
  assert.equal(classifyIn('وام را برگردان').type, 'EXECUTE_REPAY');
  assert.equal(classifyIn('قرض را تسویه کن').type, 'EXECUTE_REPAY');
  assert.equal(classifyIn('بدهی را بده').type, 'EXECUTE_REPAY');
});

/* ── 5 · a goal that is asked to be created ────────────────────────────── */

test('asking for a goal to be made is CREATE_GOAL, not GOAL_PLAN', () => {
  for (const text of [
    'یک هدف برایم بساز',
    'هدف جدید بساز',
    'برایم هدف بساز',
    'هدفم رو ثبت کن'
  ]) {
    assert.equal(classifyIn(text).type, 'CREATE_GOAL', `«${text}» should create a goal`);
  }
});

test('asking for a PLAN towards a goal is still GOAL_PLAN', () => {
  assert.equal(classifyIn('برنامه رسیدن به هدفم چیست؟').type, 'GOAL_PLAN');
});

/* ── the distinctions that must not collapse ────────────────────────────── */

test('a question about a price is a quote; an order to trade is an execution', () => {
  assert.equal(classifyIn('قیمت سواپ بیت‌کوین چقدر است؟').type, 'QUOTE_SWAP');
  assert.equal(classifyIn('ETH را به USDC سواپ کن').type, 'EXECUTE_SWAP');
});

test('«چقدر» alone is not a swap question', () => {
  /* It is the question word for everything. The swap nouns have to be
     there too, or every «X چقدر است؟» becomes a price request. */
  assert.equal(classifyIn('موجودی من چقدر است؟').type, 'BALANCE_QUERY');
  assert.equal(classifyIn('تمرکز پرتفوی من چقدر است؟').type, 'CONCENTRATION_CHECK');
});

test('a comparison of bridges is a ranking, never an execution', () => {
  assert.equal(classifyIn('کدام پل برای انتقال بیت‌کوین به پالیگان بهتر است؟').type, 'ROUTE_INTELLIGENCE');
});
