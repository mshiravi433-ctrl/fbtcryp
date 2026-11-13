/*
 * THE LANGUAGE OF AN ASSET NAME (2026-11-13)
 * ==========================================================================
 *
 * An execution intent with the wrong asset — or no asset — is a transaction
 * the user did not ask for. These are the spellings that used to break, found
 * by driving a real confirmation card through the brain and reading what the
 * card actually carried:
 *
 *   «۱۰۰ دلار بیت کوین بخر»  → asset: null  → a SWAP card with no asset on it,
 *                                             and the risk engine reporting
 *                                             "no live quote was produced"
 *   «۵۰۰ دلار تتر بخر»       → asset: null  → the most common Persian name for
 *                                             a stablecoin was not in the
 *                                             dictionary at all
 *   «buy 100 USD of BTC»     → asset: USD   → the currency the AMOUNT was
 *                                             spoken in became the subject of
 *                                             the trade
 *   «بیت‌کوینمو بفروش»        → asset: null  → the code CLAIMED to strip the
 *                                             colloquial «و» and only ever
 *                                             stripped «م»
 *
 * Three separate defects, one layer:
 *
 *   1. SPACING. A Persian compound is written three ways — with a ZWNJ
 *      («بیت‌کوین»), joined («بیتکوین»), with an ordinary space («بیت کوین») —
 *      and the dictionary carried two of the three. The fix is a canonical key
 *      with ZWNJ and spaces removed, so all three collapse onto one entry and a
 *      name added later inherits it for free.
 *   2. TOKENISING. A name containing a space is two tokens, and a token-by-token
 *      lookup can never match it; adjacent words are now joined and looked up
 *      together, with the match spanning both positions.
 *   3. ROLE. The first asset token is not automatically the subject: in
 *      «buy 100 USD of BTC» it is the unit of the amount. The demotion is
 *      deliberately narrow, because the neighbouring case must NOT move — in
 *      «۰.۱ BTC به USDC» the amount precedes the SOURCE and BTC is the subject.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { findAssetsIn, findAssetsWithPositions, usableSymbol } from '../../src/lib/central/context.js';
import { classify } from '../../src/lib/central/intent.js';

const CAPS = {};
for (const k of [
  'wallet', 'portfolio', 'markets', 'risk', 'lending', 'borrowing', 'crypto',
  'transactions', 'goals', 'routeIntelligence', 'signals', 'news', 'farming',
  'liquidity', 'staking', 'futures', 'dydx', 'globalIntel', 'opportunityFit',
  'macroGraph', 'goalScenarios', 'whyDecision'
]) CAPS[k] = 'AVAILABLE';
const ctx = { context: { capabilities: CAPS, stateHas: Object.fromEntries(Object.keys(CAPS).map((k) => [k, true])) }, state: {} };

const assetOf = (text) => classify(text, ctx).entities?.asset || null;

/* ─── 1. one name, three ways of typing it ───────────────────────────────── */

test('every spacing of a Persian compound name resolves to the same asset', () => {
  const spellings = ['بیت‌کوین', 'بیتکوین', 'بیت کوین'];
  for (const name of spellings) {
    assert.equal(assetOf(`۱۰۰ دلار ${name} بخر`), 'BTC', `«${name}» must resolve to BTC`);
    assert.equal(assetOf(`قیمت ${name} چقدره`), 'BTC', `«${name}» in a price question must resolve to BTC`);
  }
  /* The scan, not just the sentence: a spaced name is two tokens and the pair
     has to be recognised as one asset. */
  assert.deepEqual(findAssetsIn('بیت کوین'), ['BTC']);
  assert.deepEqual(findAssetsIn('بیت‌کوین'), ['BTC']);
  assert.deepEqual(findAssetsIn('بیتکوین'), ['BTC']);
});

test('the position of a spaced name spans BOTH words', () => {
  /* An amount attaches to the asset it was spoken next to, so a match that
     reported only the first half would attach the number to the wrong thing. */
  const hits = findAssetsWithPositions('۱۰۰ دلار بیت کوین بخر');
  const btc = hits.find((h) => h.asset === 'BTC');
  assert.ok(btc, `BTC must be found with a position → ${JSON.stringify(hits)}`);
  const text = '۱۰۰ دلار بیت کوین بخر';
  assert.equal(text.slice(btc.at, btc.end).replace(/\s+/g, ''), 'بیتکوین',
    `the span must cover both halves → "${text.slice(btc.at, btc.end)}"`);
});

/* ─── 2. the names that were simply missing ──────────────────────────────── */

test('«تتر» is USDT — the most common Persian name for a stablecoin', () => {
  assert.equal(assetOf('۵۰۰ دلار تتر بخر'), 'USDT');
  assert.equal(assetOf('تترم را بفروش'), 'USDT');
  assert.deepEqual(findAssetsIn('تتر'), ['USDT']);
});

test('«اتر» is ETH, alongside «اتریوم»', () => {
  assert.equal(assetOf('۱۰۰ دلار اتر بخر'), 'ETH');
  assert.equal(assetOf('۰.۵ اتریوم'), 'ETH');
});

/* ─── 3. clitics, in either order ────────────────────────────────────────── */

test('the possessive and the colloquial object marker both come off', () => {
  /* The code claimed to handle «بیت‌کوینمو» and only ever stripped «م», so a
     word ending in «و» resolved to nothing while the «را» form worked. */
  for (const sentence of [
    'بیت‌کوینم را بفروش', 'بیت‌کوینمو بفروش', 'بیت کوینمو بفروش', 'بیتکوینمو بفروش'
  ]) {
    assert.equal(assetOf(sentence), 'BTC', `«${sentence}» must resolve to BTC`);
  }
  assert.equal(assetOf('اتریومم را بفروش'), 'ETH');
});

test('a word that legitimately ends in a clitic letter still resolves as itself', () => {
  /* Peeling is tried AFTER the original, so «اتریوم» — which ends in «م» — is
     not reduced to «اتریو» and lost. */
  assert.equal(usableSymbol('اتریوم'), 'ETH');
  assert.equal(usableSymbol('بیت‌کوین'), 'BTC');
  assert.equal(usableSymbol('بیت کوین'), 'BTC');
});

/* ─── 4. the currency of an amount is not the subject of the sentence ─────── */

test('«buy 100 USD of BTC» is a request for BTC, not for USD', () => {
  /* This is the dangerous one: on an EXECUTE_SWAP the first asset token became
     the card's asset, so the user was offered a trade in the unit they priced
     it in. */
  assert.equal(assetOf('buy 100 USD of BTC'), 'BTC');
  const all = findAssetsIn('buy 100 USD of BTC');
  assert.equal(all[0], 'BTC', `the subject comes first; the unit follows → ${JSON.stringify(all)}`);
  assert.ok(all.includes('USD'), 'the unit is still reported, just not as the subject');
});

test('a direction keeps the SOURCE as the subject — the demotion must not invert a swap', () => {
  /* «۰.۱ BTC به USDC» is a swap FROM BTC. BTC is number-adjacent here too, so a
     rule that demoted every number-adjacent asset would invert this trade. */
  assert.equal(assetOf('۰.۱ BTC به USDC'), 'BTC');
  assert.equal(assetOf('convert 0.5 ETH to USDC'), 'ETH');
});

test('an amount spoken in the asset itself still resolves to that asset', () => {
  /* «۰.۵ اتریوم» names a quantity of ETH and there is no second asset, so
     nothing is demoted — a rule that needed two assets to fire is what keeps
     this case working. */
  assert.equal(assetOf('۰.۵ اتریوم'), 'ETH');
  assert.equal(assetOf('۵۰۰ دلار USDC'), 'USDC');
  assert.equal(assetOf('۱۰۰ دلار بیت کوین بخر'), 'BTC');
});

/* ─── 5. the stopword floor still holds ──────────────────────────────────── */

test('a verb is never read as an asset', () => {
  /* The quality corpus caught «buy BTC» extracting asset=BUY. Widening the
     lookup must not reopen that hole. */
  assert.equal(assetOf('buy BTC now'), 'BTC');
  assert.equal(assetOf('sell all my ETH'), 'ETH');
  assert.equal(assetOf('show me the price page'), null);
});

test('a sentence with no asset resolves to nothing rather than guessing', () => {
  assert.equal(assetOf('وضعیت بازار چطوره'), null);
  assert.equal(assetOf('ریسک من چقدر است'), null);
  assert.deepEqual(findAssetsIn('قیمت چقدره'), []);
});
