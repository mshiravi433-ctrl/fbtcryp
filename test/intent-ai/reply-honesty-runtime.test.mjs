/**
 * ─── THREE DEFECTS THAT A GREEN SUITE LET THROUGH ───────────────────────────
 *
 * All three were found by reading rendered replies, not by a failing test. The
 * suite was 954/954 green while:
 *
 *   1. «بیت کوین را بفروش» — an explicit sell order — answered with
 *      «این پول برای چیست — رشد، درآمد، یا حفظ سرمایه؟». A question about the
 *      OWNER, when the turn was blocked on the AMOUNT. The user could not
 *      unblock their own order by answering it, and nothing told them what was
 *      actually missing.
 *
 *   2. «۱۰۰ دلار بیت کوین بفروش و به تتر تبدیل کن» rendered
 *      `part:EXECUTE_SWAP:BTC` and `part:EXECUTE_SWAP:USDT` carrying the SAME
 *      quote word for word. One trade, two sections, each labelled as if it were
 *      about a different asset. This one was a regression from the subject-aware
 *      leg split — the split is right for two READINGS and wrong for the two
 *      SIDES of one trade.
 *
 *   3. The `reason` section of a Persian reply contained
 *      «the portfolio risk impulse is 0 — a first-order model over the read
 *      domains, not a forecast». That sentence is the qualifier that keeps an
 *      impulse of 0 from reading as "no risk", and it was the one clause the
 *      reader would skim past. The language gate did not catch it because the
 *      probe's own corpus never produced that finding.
 *
 * The gate mounts the real brain with the real composition root and faked
 * EXTERNAL sources only, so it measures a deployed reply rather than a
 * classifier's opinion about one.
 *
 *   node --test test/intent-ai/reply-honesty-runtime.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify } from '../../src/lib/central/intent.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/* ── the real brain, the real engines, faked externals ───────────────────── */
const { installFakes } = await import(path.join(ROOT, 'test', 'intent-ai', 'ci-fakes.mjs'));
const { setCiSource } = await import(path.join(ROOT, 'server', 'ci', 'sources.js'));
for (const [name, fn] of Object.entries(installFakes())) setCiSource(name, fn);
const { createCentralBrain } = await import(path.join(ROOT, 'server', 'ci', 'brain.js'));
const { createCentralStateStore } = await import(path.join(ROOT, 'server', 'ci', 'stateStore.js'));
const stateStore = createCentralStateStore();
const brain = createCentralBrain({ stateStore });
const { createFinancialIntelligence } = await import(path.join(ROOT, 'server', 'fios', 'index.js'));
createFinancialIntelligence({ stateStore, brain, ownerFor: (o) => o, log: () => {} });

async function seed(owner) {
  const now = Date.now();
  await stateStore.write(owner, 'wallet', {
    data: { addresses: { evm: ['0x1111111111111111111111111111111111111111'] }, connected: true },
    source: 'gate-wallet', status: 'OK', now
  });
  await stateStore.write(owner, 'portfolio', {
    data: {
      holdings: [
        { symbol: 'USDC', amount: 2500, valueUsd: 2500, chainId: 1, priceUsd: 1 },
        { symbol: 'ETH', amount: 1.5, valueUsd: 4800, chainId: 1, priceUsd: 3200 },
        { symbol: 'BTC', amount: 0.25, valueUsd: 9000, chainId: 1, priceUsd: 36000 }
      ],
      totalValueUsd: 16300, dataStatus: 'live'
    },
    source: 'gate-portfolio', status: 'OK', now
  });
  await stateStore.write(owner, 'markets', {
    data: { prices: { USDC: { priceUsd: 1 }, ETH: { priceUsd: 3200 }, BTC: { priceUsd: 36000 } }, bySymbol: {} },
    source: 'gate-markets', status: 'OK', now
  });
  await stateStore.write(owner, 'goals', {
    data: { goals: [{ id: 'g1', name: 'reserve', targetUsd: 100000, horizonMonths: 36 }] },
    source: 'gate-goals', status: 'OK', now
  });
  await stateStore.write(owner, 'risk', { data: { riskScore: 40, level: 'MEDIUM' }, source: 'gate-risk', status: 'OK', now });
}

let turn = 0;
async function ask(message) {
  const owner = `reply-honesty-${turn++}`;
  await seed(owner);
  const out = await brain.handle({ owner, message, locale: 'fa' });
  const sections = (out?.response?.sections || []).filter((s) => String(s?.value ?? '') !== '');
  const section = (id) => sections.find((s) => s.id === id) || null;
  return { out, sections, section, mode: out?.response?.mode || null };
}

/* The probe's own matcher, so this gate and `probe-multiquestion` cannot
   disagree about what an English clause is. */
const ENGLISH_CLAUSE = /[A-Za-z]{2,}(?:\s+[A-Za-z()%$.,-]{1,}){3,}/g;
const englishClauses = (sections) => sections
  .map((sec) => String(sec?.value ?? '').match(ENGLISH_CLAUSE) || [])
  .flat()
  .filter((m) => /[a-z]\s+[a-z]/i.test(m));

test('a turn blocked on money asks for the money, not for the owner’s goals', async () => {
  for (const message of ['بیت کوین را بفروش', 'بیت کوین را بفروش و دلیلش را توضیح بده']) {
    const { mode, section } = await ask(message);
    assert.equal(mode, 'QUESTION', `«${message}» cannot be executed without a size, so it must ask`);
    const question = String(section('question')?.value ?? '');
    assert.ok(question, `«${message}» asked nothing at all`);
    assert.match(question, /مبلغ/,
      `the missing field is the amount; the reply asked: «${question}»`);
    assert.doesNotMatch(question, /هدف|این پول برای چیست/,
      `a question about the owner cannot unblock a trade: «${question}»`);
    assert.match(question, /حدس نمی‌زنم/,
      'the honest ending — the machine says it will not guess the size');
  }
});

test('an order that named its size is not asked for it', async () => {
  const { mode, section } = await ask('۱۰۰ دلار بیت کوین بفروش و به تتر تبدیل کن');
  assert.equal(mode, 'ACTION', 'a fully specified order reaches the confirmation, not a question');
  const result = String(section('result')?.value ?? '');
  assert.match(result, /→/, `the quote must be rendered, got «${result.slice(0, 80)}»`);
  assert.doesNotMatch(result, /این پول برای چیست/, 'the answer is a quote, not a profiling question');
});

test('one trade is rendered once, and two parts never say the same thing', async () => {
  /*
   * The regression this pins: keying legs by (intent, subject) made a swap's two
   * SIDES into two legs, and both parts rendered the identical quote under two
   * different labels. The invariant is deliberately broader than that case — no
   * two part sections may carry the same answer — because the same failure would
   * show up on the read side as an ETH part holding the BTC number.
   */
  const sentences = [
    '۱۰۰ دلار بیت کوین بفروش و به تتر تبدیل کن',
    'قیمت بیت کوین چنده و اتریوم چطور',
    'بازار و ییلد'
  ];
  let partsSeen = 0;
  for (const message of sentences) {
    const { sections } = await ask(message);
    const parts = sections.filter((s) => String(s.id || '').startsWith('part:'));
    partsSeen += parts.length;
    const values = parts.map((p) => String(p.value).replace(/\s+/g, ' ').trim());
    assert.equal(new Set(values).size, values.length,
      `«${message}» rendered two parts with the same answer: ${JSON.stringify(parts.map((p) => p.id))}`);
    const moneyParts = parts.filter((p) => /EXECUTE_|QUOTE_/.test(String(p.id)));
    assert.ok(moneyParts.length <= 1,
      `«${message}» rendered ${moneyParts.length} sections for one trade: ${moneyParts.map((p) => p.id).join(', ')}`);
  }
  assert.ok(partsSeen >= 2, `the corpus must actually produce parts, or this gate proves nothing (saw ${partsSeen})`);
});

test('a money intent is never split by subject', () => {
  /*
   * The classifier half of the same rule, where it is cheap to state: a swap
   * names two assets because a swap HAS two sides, and reading them as two
   * trades is what produced the duplicated quote. A READ keeps its subject —
   * that is what makes «بیت کوین چنده و اتریوم چطور» two answers.
   */
  const money = classify('۱۰۰ دلار بیت کوین بفروش و به تتر تبدیل کن', {});
  const moneyLegs = (money.compound || []).filter((c) => /^EXECUTE_|^QUOTE_/.test(c.intent));
  const keys = new Set(moneyLegs.map((c) => c.intent));
  assert.equal(keys.size, moneyLegs.length,
    `two legs of one money intent: ${JSON.stringify(moneyLegs.map((c) => [c.intent, c.asset]))}`);

  const read = classify('قیمت بیت کوین چنده و اتریوم چطور', {});
  const readLegs = (read.compound || []).filter((c) => c.intent === 'ASSET_ANALYSIS');
  assert.equal(readLegs.length, 2, 'the read side must still split into two subjects');
  assert.deepEqual(readLegs.map((c) => c.asset).sort(), ['BTC', 'ETH'],
    '…and each keeps the asset the user named');
});

test('a Persian reply carries no English clause — the reason section included', async () => {
  /*
   * The language gate that existed scanned a probe corpus, and this finding was
   * not in it. The clause that leaked is the one that keeps an impulse of 0 from
   * reading as "no risk", so it is exactly the sentence a reader must not skip.
   */
  for (const message of [
    'وضعیت بازار چطوره',
    'وضعیت بازار چطوره و چقدر تغییر کرده',
    'ییلد چطوره و کدوم بهتره',
    'قیمت بیت کوین چنده و اتریوم چطور'
  ]) {
    const { sections } = await ask(message);
    const offenders = englishClauses(sections);
    assert.deepEqual(offenders, [],
      `«${message}» mixed languages inside a Persian reply: ${JSON.stringify(offenders.slice(0, 3))}`);
    const reason = String(sections.find((s) => s.id === 'reason')?.value ?? '');
    if (reason.includes('تکانهٔ ریسک')) {
      assert.match(reason, /مدلِ مرتبهٔ اول|پیش‌بینی/,
        'the impulse qualifier must survive in Persian, or the number reads as a forecast');
    }
  }
});
