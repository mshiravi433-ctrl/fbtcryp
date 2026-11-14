/**
 * ─── COUNTERFACTUAL REASONING, AND THE HALF OF INTROSPECTION IT CAME WITH ───
 *
 * Measured before the fix, over the real brain with faked externals:
 *
 *   «اگر بیت کوین ۲۰ درصد بالا بره چی میشه»   → mode=QUESTION, no result section
 *   «اگر بیت کوین ۲۰ درصد بریزه چی میشه»     → mode=QUESTION, no result section
 *   «فرض کن بیت کوین دو برابر بشه»           → mode=QUESTION, no result section
 *   «اگر بیت کوین نصف بشه چقدر ضرر میکنم»    → mode=QUESTION, no result section
 *
 * Five what-if sentences, five questions, zero answers — while the machine had
 * already computed the shock internally (`10000 → 8000 USD` on the finding) and
 * then dropped it. Three separate causes, all of them real:
 *
 *   1. `lab.simulate` was counted as a MONEY step (WHATIF_SIMULATION is
 *      PREPARE), so it was probed for a pair, found none, and asked for
 *      «ارز مقصد» — a destination asset for a question about a price move. A
 *      missing money input then withheld the step, so the `lab` module never
 *      ran at all and the brain recomputed the shock in a fallback.
 *   2. The sign was forced negative everywhere, so «۲۰٪ بالا بره» was answered
 *      with a 20% DROP — the opposite question, with a real number attached.
 *   3. «دو برابر» and «نصف بشه» produced `percent: null`, so the −30% default
 *      answered a question nobody asked.
 *
 * Beside it: «چقدر مطمئنی این پیشنهاد درسته؟» fell through to the registry
 * paragraph listing what the machine can do, while its sibling «چرا این را
 * گفتی؟» was routed to the why engine — which is fed the brain's own decision
 * bundle and therefore already carries the confidence.
 *
 *   node --test test/intent-ai/counterfactual-runtime.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/* ── the real brain, the real engines, faked externals ───────────────────── */
const { installFakes } = await import(path.join(ROOT, 'test', 'intent-ai', 'ci-fakes.mjs'));
const { setCiSource } = await import(path.join(ROOT, 'server', 'ci', 'sources.js'));
const fakes = installFakes();
for (const [name, fn] of Object.entries(fakes)) setCiSource(name, fn);
const { createCentralBrain } = await import(path.join(ROOT, 'server', 'ci', 'brain.js'));
const { createCentralStateStore } = await import(path.join(ROOT, 'server', 'ci', 'stateStore.js'));
const stateStore = createCentralStateStore();
const brain = createCentralBrain({ stateStore });
const { createFinancialIntelligence } = await import(path.join(ROOT, 'server', 'fios', 'index.js'));
createFinancialIntelligence({ stateStore, brain, ownerFor: (o) => o, log: () => {} });

/* Two correlated series, longer than the engine's own 20-sample floor, so the
   correlation the lab computes is computable here at all. */
const series = (base, drift) => Array.from({ length: 32 }, (_, i) => Math.round(base * (1 + drift * Math.sin(i / 3) + i * 0.004)));

async function seed(owner, { history = false } = {}) {
  const now = Date.now();
  await stateStore.write(owner, 'wallet', {
    data: { addresses: { evm: ['0x1111111111111111111111111111111111111111'] }, connected: true },
    source: 'gate-wallet', status: 'OK', now
  });
  await stateStore.write(owner, 'portfolio', {
    data: {
      holdings: [
        { symbol: 'BTC', amount: 0.25, valueUsd: 9000, chainId: 1, priceUsd: 36000 },
        { symbol: 'USDC', amount: 1000, valueUsd: 1000, chainId: 1, priceUsd: 1 }
      ],
      totalValueUsd: 10000, dataStatus: 'live'
    },
    source: 'gate-portfolio', status: 'OK', now
  });
  await stateStore.write(owner, 'markets', {
    data: {
      prices: { BTC: { priceUsd: 36000 }, ETH: { priceUsd: 3000 }, USDC: { priceUsd: 1 } },
      bySymbol: {},
      /* Only some turns get a price history: the correlation clause must be
         present when it is readable and ABSENT when it is not. */
      ...(history ? { history: { BTC: series(36000, 0.02), ETH: series(3000, 0.018) } } : {})
    },
    source: 'gate-markets', status: 'OK', now
  });
  await stateStore.write(owner, 'goals', {
    data: { goals: [{ id: 'g1', name: 'reserve', targetUsd: 100000, horizonMonths: 36 }] },
    source: 'gate-goals', status: 'OK', now
  });
  await stateStore.write(owner, 'risk', { data: { riskScore: 40, level: 'MEDIUM' }, source: 'gate-risk', status: 'OK', now });
}

let turn = 0;
async function ask(message, opts = {}) {
  const owner = `counterfactual-${turn++}`;
  await seed(owner, opts);
  const out = await brain.handle({ owner, message, locale: 'fa' });
  const sections = (out?.response?.sections || []).filter((s) => String(s?.value ?? '') !== '');
  const section = (id) => sections.find((s) => s.id === id) || null;
  return {
    out,
    sections,
    section,
    mode: out?.response?.mode || null,
    intent: out?.intent?.intentType || null,
    text: () => sections.map((s) => String(s.value ?? '')).join(' '),
    result: () => String(section('result')?.value ?? ''),
    asked: () => String(out?.response?.ask?.text ?? '')
  };
}

const FA = '۰۱۲۳۴۵۶۷۸۹';
const AR = '٠١٢٣٤٥٦٧٨٩';
/** Read a Persian sentence the way an arithmetic assertion needs to. */
const latin = (s) => String(s)
  .replace(/[۰-۹]/g, (d) => String(FA.indexOf(d)))
  .replace(/[٠-٩]/g, (d) => String(AR.indexOf(d)))
  .replace(/٬/g, ',').replace(/٫/g, '.');
const num = (s) => Number(String(s).replace(/,/g, ''));

/** The two figures a scenario headline must carry: what it moves FROM and TO. */
function figures(reply) {
  const m = latin(reply.result()).match(/از\s*([\d,.]+)\s*دلار\s*به\s*([\d,.]+)\s*دلار/);
  assert.ok(m, `the scenario headline must name both figures, got «${reply.result()}»`);
  return [num(m[1]), num(m[2])];
}

test('a scenario is answered, and its direction comes from the sentence', async () => {
  const up = await ask('اگر بیت کوین ۲۰ درصد بالا بره چی میشه');
  assert.equal(up.intent, 'WHATIF_SIMULATION');
  assert.equal(up.mode, 'ANSWER', 'a counterfactual about the owner’s own book is answerable; it must not end in a question');
  const [beforeUp, afterUp] = figures(up);
  assert.ok(afterUp > beforeUp, `a 20% RISE must raise the value: ${beforeUp} → ${afterUp}`);

  const down = await ask('اگر بیت کوین ۲۰ درصد بریزه چی میشه');
  assert.equal(down.mode, 'ANSWER');
  const [beforeDown, afterDown] = figures(down);
  assert.ok(afterDown < beforeDown, `a 20% DROP must lower the value: ${beforeDown} → ${afterDown}`);

  /* The strongest form of the assertion: the same magnitude in opposite
     directions must move the same distance. A sign bug cannot survive it. */
  assert.ok(
    Math.abs((afterUp - beforeUp) + (afterDown - beforeDown)) < 1,
    `+20% moved ${afterUp - beforeUp} and −20% moved ${afterDown - beforeDown}; they must be equal and opposite`
  );
});

test('a multiplier word is a percentage, not a default', async () => {
  const doubled = await ask('فرض کن بیت کوین دو برابر بشه');
  const [before, after] = figures(doubled);
  assert.ok(Math.abs(after - before * 2) <= 1,
    `«دو برابر بشه» is +100%, so ${before} must become ${before * 2}, got ${after} (the old default answered −30%)`);

  const halved = await ask('اگر بیت کوین نصف بشه چقدر ضرر میکنم');
  const [b2, a2] = figures(halved);
  assert.ok(Math.abs(a2 - b2 / 2) <= 1,
    `«نصف بشه» is −50%, so ${b2} must become ${b2 / 2}, got ${a2}`);
});

test('a price shock is not a trade, so nothing asks for a destination asset', async () => {
  const r = await ask('اگر اتریوم ۳۰ درصد بریزه چقدر ضرر میکنم');
  assert.equal(r.mode, 'ANSWER');
  /* The old reply was exactly this question, and answering it could never
     unblock the turn: a shock scenario has no pair in it. */
  assert.doesNotMatch(r.asked(), /ارز مقصد|ارز مبدأ/, `asked: «${r.asked()}»`);
  assert.doesNotMatch(r.text(), /ارز مقصد/, 'the whole reply must be free of a trade’s missing fields');
});

test('the scenario is computed by the lab module, not by a copy of it in the brain', async () => {
  /*
   * `lab.simulate` returns a BTC/ETH correlation beside the shock, and the brain's
   * own fallback cannot produce one. So the clause is a reachability marker: when
   * a price history is readable the sentence must carry it, and when none is
   * readable it must say nothing at all rather than invent a coefficient.
   */
  const withHistory = await ask('اگر بیت کوین ۲۰ درصد بریزه چی میشه', { history: true });
  assert.match(withHistory.text(), /همبستگیِ BTC\/ETH/,
    'the lab module ran and its correlation must reach the reply');
  assert.match(withHistory.text(), /نمونه/, 'and the sample count that makes it a measurement');
  const coefficient = Number(latin(withHistory.text()).match(/همبستگیِ BTC\/ETH\s*(-?[\d.]+)/)?.[1]);
  assert.ok(Number.isFinite(coefficient) && Math.abs(coefficient) <= 1,
    `a correlation is a ratio in [-1, 1], got ${coefficient}`);

  /*
   * AND SILENCE WHEN IT IS NOT READABLE.
   *
   * Seeding a markets section without a history is not enough: the plan's own
   * `markets.read` step re-reads the section from the source, and the shared fake
   * returns a history. So the unreadable case is built where it actually lives —
   * at the source seam — and the fakes are put back afterwards, or the next test
   * in this file measures the override instead of the product.
   */
  try {
    setCiSource('marketSnapshot', async (...args) => {
      const read = await fakes.marketSnapshot(...args);
      const { history, ...withoutHistory } = read || {};
      return withoutHistory;
    });
    const without = await ask('اگر بیت کوین ۲۰ درصد بریزه چی میشه');
    assert.equal(without.mode, 'ANSWER', 'an unreadable correlation must not break the scenario');
    assert.doesNotMatch(without.text(), /همبستگی/,
      'with no history read there is no coefficient to state — silence, not a guess');
    const [b, a] = figures(without);
    assert.ok(a < b, `and the scenario itself still answers: ${b} → ${a}`);
  } finally {
    for (const [name, fn] of Object.entries(fakes)) setCiSource(name, fn);
  }
});

test('the scenario says it is a scenario, and stays in Persian', async () => {
  const r = await ask('اگر بیت کوین ۲۰ درصد بریزه چی میشه', { history: true });
  assert.match(r.result(), /سناریو|پیش‌بینی/,
    `a shock is arithmetic over read holdings, not a forecast, and must say so: «${r.result()}»`);
  /* The probe's own matcher, so this gate and `probe-multiquestion` cannot
     disagree about what an English clause is. */
  const ENGLISH_CLAUSE = /[A-Za-z]{2,}(?:\s+[A-Za-z()%$.,-]{1,}){3,}/g;
  const clauses = r.sections
    .map((sec) => String(sec?.value ?? '').match(ENGLISH_CLAUSE) || [])
    .flat()
    .filter((m) => /[a-z]\s+[a-z]/i.test(m));
  assert.deepEqual(clauses, [], 'a Persian reply carries no English clause, including in its evidence');
});

test('a question about the answer’s own certainty is answered with the certainty', async () => {
  const r = await ask('چقدر مطمئنی این پیشنهاد درسته');
  assert.equal(r.intent, 'WHY_DECISION',
    'the why engine is fed the brain’s own decision bundle, which carries the confidence');
  assert.equal(r.mode, 'ANSWER', 'introspection is answerable; it must not fall through to the registry paragraph');
  assert.doesNotMatch(r.result(), /رجیستری مرکزی نرساندم/,
    `that paragraph lists capabilities instead of answering: «${r.result().slice(0, 90)}»`);

  const headline = latin(r.result());
  const m = headline.match(/اطمینانِ این پاسخ\s*(\d+)\s*٪/);
  assert.ok(m, `the headline must state the confidence, got «${r.result().slice(0, 90)}»`);
  /* ONE number per reply. The headline used to read the copy that travelled
     through the decision bundle, which came out one point below the figure the
     reply's own confidence section prints. */
  const shown = Number(String(r.section('confidence')?.value ?? '').replace(/[^\d]/g, ''));
  assert.equal(Number(m[1]), shown,
    `the headline says ${m[1]}% and the confidence section says ${shown}%`);
  /* And the warrant travels with it: a confidence with no falsifier is a vibe. */
  assert.match(r.result(), /دلیل|نقض‌کننده/,
    `the count of reason lines and falsifiers is the warrant for the number: «${r.result().slice(0, 120)}»`);
});

test('the new patterns do not steal a question about an asset', async () => {
  /* «قیمت بیت کوین چقدر دقیقه» contains a certainty word and an accuracy word,
     and it is a question about the MARKET, not about our answer. */
  const r = await ask('قیمت بیت کوین چقدر دقیقه');
  assert.equal(r.intent, 'ASSET_ANALYSIS', `got ${r.intent}`);
  assert.equal(r.mode, 'ANSWER');
  assert.match(r.result(), /BTC/, `the price read must lead, got «${r.result().slice(0, 90)}»`);

  const plain = await ask('قیمت بیت کوین چنده');
  assert.equal(plain.intent, 'ASSET_ANALYSIS');
});
