/*
 * THE QUESTION THAT WAS HALF-ANSWERED
 * ---------------------------------------------------------------------------
 *
 * «قیمت بیت‌کوین چقدره و موجودی من چقدره» is TWO questions. The brain
 * answers ONE of them and drops the other without saying so.
 *
 * That is not a small thing. A person who asked two things got one
 * answer and no mention of the second — and the reply looks complete,
 * because it has a headline, a reason, data and a confidence. The
 * missing half is invisible unless you knew to look for it.
 *
 * This harness measures it: it asks a set of two-part questions, and
 * for each one it asks WHICH parts the reply actually answered.
 *
 * The measurement is over the REPLY, not the classification, because the
 * classification is the easy half — the brain can only hold one intent
 * at a time, and the question is what it does with the rest.
 *
 *   node scripts/probe-multiquestion.mjs
 *   node scripts/probe-multiquestion.mjs --json
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AS_JSON = process.argv.includes('--json');

/*
 * Each probe is a two-part question. `parts` are the WORDS that must
 * appear in the reply for that half to count as answered — the numbers
 * the user asked for, not the subject they were about.
 *
 * The two parts are deliberately different CAPABILITIES, because a
 * single-capability question can be answered by one module and looks
 * fine. «price AND balance» needs the market read and the wallet read.
 */
const PROBES = [
  {
    intent: 'PRICE + BALANCE',
    message: 'قیمت بیت‌کوین چقدره و موجودی من چقدره',
    parts: [
      { name: 'price', any: ['36000', '36,000', '36 000', 'BTC'] },
      { name: 'balance', any: ['10000', '10,000', '10 000', 'BTC', 'USDC'] }
    ]
  },
  {
    intent: 'PORTFOLIO + RISK',
    message: 'پورتفوی من چیست و ریسکش چقدر است',
    parts: [
      { name: 'portfolio', any: ['10000', '10,000', '10 000', 'BTC', 'USDC', 'پرتفوی'] },
      { name: 'risk', any: ['ریسک', 'risk', 'HHI', 'تمرکز', 'HIGH'] }
    ]
  },
  {
    intent: 'MARKET + FIT',
    message: 'وضعیت بازار چطوره و کدام گزینه مناسب منه',
    parts: [
      { name: 'market', any: ['بازار', 'رژیم', 'regime', 'BTC', 'ETH', 'دامنهٔ بیت‌کوین'] },
      { name: 'fit', any: ['مناسب', 'FITTED', 'CONDITIONAL', 'برازنده', 'تناسب'] }
    ]
  },
  {
    intent: 'YIELD + RISK',
    message: 'بهترین استخر ییلد کدام است و ریسک نقدینگی‌اش چقدره',
    parts: [
      { name: 'yield', any: ['یلد', 'yield', 'APY', 'استخر', 'pool'] },
      { name: 'liquidity risk', any: ['نقدینگی', 'liquidity', 'impermanent', 'ریسک'] }
    ]
  },
  {
    intent: 'LOAN + PORTFOLIO',
    message: 'وضعیت وامم چیست و با پورتفویم چه نسبتی دارد',
    parts: [
      { name: 'loan', any: ['وام', 'loan', 'بدهی', 'debt'] },
      { name: 'portfolio', any: ['10000', '10,000', 'BTC', 'USDC', 'پورتفوی'] }
    ]
  },
  {
    /*
     * ─── THE HALF THAT HAS NO VOCABULARY OF ITS OWN ────────────────────────
     *
     * The six probes above are two DIFFERENT capabilities, so each half carries
     * the words that name it. This one is the harder shape: the second clause
     * («اتریوم چطور») matches no rule in the table at all. It carries only its
     * SUBJECT, and the question it asks is the question the first clause asked.
     *
     * Measured before the fix: one leg, one answer. The BTC price arrived and
     * the ETH price did not — while `extractEntities` on the same sentence
     * already reported `assets: [BTC, ETH]`. The subject was in hand and no
     * decision read it, so the user asked about two assets and was told about
     * one, with nothing in the reply to say the second half had been heard.
     *
     * The numbers are the ones the MACHINE says, not the ones the seed contains:
     * the engines answer ETH at 3000 from their own source.
     */
    intent: 'PRICE + ELLIPSIS',
    message: 'قیمت بیت کوین چنده و اتریوم چطور',
    expectSubjects: ['BTC', 'ETH'],
    parts: [
      { name: 'btc price', any: ['36000', '36,000', '۳۶٬۰۰۰'] },
      { name: 'eth price', any: ['ETH 3000', '3000 USD', '۳٬۰۰۰'] }
    ]
  },
  {
    intent: 'GOAL + PLAN',
    message: 'هدفت چیست و برای رسیدن به آن چه برنامه‌ای دارم',
    parts: [
      { name: 'goal', any: ['هدف', 'goal', '100000', '100,000'] },
      { name: 'plan', any: ['برنامه', 'plan', 'ماهانه', 'monthly', 'قسط', 'شانس', 'احتمال'] }
    ]
  }
];

/* ── run the brain for real ─────────────────────────────────────────────── */
const { installFakes } = await import(path.join(ROOT, 'test', 'intent-ai', 'ci-fakes.mjs'));
const { setCiSource } = await import(path.join(ROOT, 'server', 'ci', 'sources.js'));
for (const [name, fn] of Object.entries(installFakes())) setCiSource(name, fn);

const { createCentralBrain } = await import(path.join(ROOT, 'server', 'ci', 'brain.js'));
const { createCentralStateStore } = await import(path.join(ROOT, 'server', 'ci', 'stateStore.js'));

const stateStore = createCentralStateStore();
const brain = createCentralBrain({ stateStore });

/*
 * MOUNT THE REAL ENGINES, NOT FAKE PROVIDERS.
 *
 * The fit, macro-graph and scenario engines sit behind `server/ci/fitBridge.js`
 * and are wired by the composition root (`server/fios/index.js`). Without that
 * mount they answer `PROVIDER_NOT_WIRED` — an honest refusal, but not the
 * behaviour a deployed brain has. A fake provider that mirrors the
 * implementation would hide an implementation/engine mismatch, so the probe
 * mounts the REAL root and keeps only the EXTERNAL sources faked.
 */
const { createFinancialIntelligence } = await import(path.join(ROOT, 'server', 'fios', 'index.js'));
createFinancialIntelligence({ stateStore, brain, ownerFor: (o) => o, log: () => {} });

async function seed(owner) {
  const now = Date.now();
  await stateStore.write(owner, 'wallet', {
    data: { addresses: { evm: ['0x1111111111111111111111111111111111111111'] }, connected: true },
    source: 'probe-wallet', status: 'OK', now
  });
  await stateStore.write(owner, 'portfolio', {
    data: {
      holdings: [
        { symbol: 'USDC', amount: 2500, valueUsd: 2500, chainId: 1, priceUsd: 1 },
        { symbol: 'ETH', amount: 1.5, valueUsd: 4800, chainId: 1, priceUsd: 3200 }
      ],
      totalValueUsd: 7300, dataStatus: 'live'
    },
    source: 'probe-portfolio', status: 'OK', now
  });
  await stateStore.write(owner, 'markets', {
    data: { prices: { USDC: { priceUsd: 1 }, ETH: { priceUsd: 3200 }, BTC: { priceUsd: 36000 } }, bySymbol: {} },
    source: 'probe-markets', status: 'OK', now
  });
  await stateStore.write(owner, 'goals', {
    data: { goals: [{ id: 'g1', name: 'reserve', targetUsd: 100000, horizonMonths: 36 }] },
    source: 'probe-goals', status: 'OK', now
  });
  await stateStore.write(owner, 'risk', {
    data: { riskScore: 40, level: 'MEDIUM' }, source: 'probe-risk', status: 'OK', now
  });
}

const rows = [];
for (const probe of PROBES) {
  const owner = `multi-${probe.intent.replace(/[^A-Z]+/g, '-').toLowerCase()}`;
  await seed(owner);
  let out = null;
  let error = null;
  try {
    out = await brain.handle({ owner, message: probe.message, locale: 'fa' });
  } catch (err) {
    error = String(err?.message || err).slice(0, 120);
  }
  /*
   * The WHOLE reply, not just the headline.
   *
   * The first version matched only `response.text`, and it reported
   * «price AND balance» as answered by NOTHING — because the numbers
   * live in the SECTIONS (`result`, `data`, `risk`), and `text` is the
   * assembled summary. A probe that looks in the wrong place reports a
   * failure that is not there.
   */
  /*
   * WHAT THE MACHINE SAID, NOT THE NAME OF THE BOX IT SAID IT IN.
   *
   * The first honest version of this matcher scanned `s.label` and `f.id`
   * as well, and a part could then be "answered" by its own section label:
   * `PART_LABEL_FA.OPPORTUNITY_FIT` is «تناسب با من» and the fit part
   * expected «تناسب», so an UNAVAILABLE fit finding still counted as an
   * answer. A keyword probe that can be satisfied by the word the probe
   * itself wrote into the section header measures nothing.
   *
   * So the scan is over the VALUE of each section and the DETAIL of each
   * finding — what the machine produced — never over the label or the id.
   */
  const text = [
    String(out?.response?.text || ''),
    ...(out?.response?.sections || []).map((s) => String(s?.value ?? '')),
    ...(out?.findings || []).map((f) => `${f?.detail || ''} ${typeof f?.value === 'object' ? JSON.stringify(f.value) : (f?.value ?? '')}`)
  ].join('\n');
  /*
   * A part counts as answered when its WORDS appear in the reply.
   *
   * The words are the user's own — «قیمت», «موجودی», «وام», «هدف» — and
   * the numbers are the engines'. The measurement is deliberately over
   * the whole reply (headline + sections + findings), because the
   * headline alone is only one part of what a user reads.
   *
   * It is also deliberately NOT over the classification: the brain used
   * to classify «قیمت بیت‌کوین چقدره و موجودی من چقدره» as a single
   * BALANCE_QUERY and said so perfectly correctly. The classification
   * was never the problem. The half that vanished was the half of the
   * ANSWER.
   */
  const answered = probe.parts
    .map((p) => ({ name: p.name, ok: p.any.some((w) => text.includes(w)) }));
  /*
   * THE LEGS, as the brain recorded them.
   *
   * This is the second half of the measurement. The words check asks
   * «did the reply mention it»; this asks «did the brain treat it as a
   * question of its own». A compound READ must produce two legs, and
   * NEITHER of them may be an execution — a question the user did not
   * turn into a transaction must never become one.
   */
  const compound = Array.isArray(out?.intent?.compound) ? out.intent.compound : [];
  const legIntents = compound.map((c) => c && c.intent).filter(Boolean);
  const EXECUTION_INTENTS = new Set([
    'EXECUTE_SWAP', 'EXECUTE_BRIDGE', 'EXECUTE_LEND', 'EXECUTE_BORROW',
    'EXECUTE_REPAY', 'EXECUTE_REBALANCE'
  ]);
  const executionLegs = legIntents.filter((t) => EXECUTION_INTENTS.has(t));
  /*
   * WHO each leg is about. Two legs can ask the same question, and then the
   * subject is the only thing that makes them two answers — so a probe that
   * counts legs without counting subjects would pass on a reply that answered
   * the same asset twice and dropped the other one.
   */
  const legSubjects = compound.map((c) => (c && c.asset) || null);
  const expectedSubjects = probe.expectSubjects || null;
  const subjectsOk = expectedSubjects
    ? expectedSubjects.every((a) => legSubjects.includes(a))
    : true;
  const planHasMoneyStep = (out?.intent?.plan || []).some(
    (s) => s && (s.operation === 'execute' || s.operation === 'quote' || s.operation === 'prepare')
  );
  /* The compound legs must be READS. A read leg reads; an execution leg
     moves money, and a question is not a permission. */
  const expectedLegs = probe.expectLegs || null;
  const legsOk = expectedLegs
    ? expectedLegs.every((t) => legIntents.includes(t))
    : true;

  /*
   * ─── THE TWO SECTIONS THAT USED TO FIGHT ──────────────────────────────
   *
   * `result` is the answer; `question` is the field the conversation
   * machinery still needs. QUESTION mode used to render the question
   * INSTEAD of the analysis, so a goal the engine had already computed
   * disappeared from the reply and the coverage number only looked fine
   * because the part's own SECTION LABEL contained the keyword.
   *
   * Both are reported so the gate can say what must be true: a turn that
   * produced an answer keeps it, whether or not the machine also asks.
   */
  const sectionIds = (out?.response?.sections || []).map((x) => x && x.id).filter(Boolean);

  /*
   * ─── ENGLISH PROSE INSIDE A PERSIAN REPLY ─────────────────────────────
   *
   * Counting findings that lack a `detailFa` counts an INTERNAL field, and
   * most of those never reach the user. What matters is narrower and
   * observable: a run of English WORDS inside the text the reply actually
   * renders. «BTC» and «wallet-service» are tokens, not prose; «BTC is 100%
   * of risk capital» is a clause the user has to parse in a second language
   * in the middle of a sentence that is otherwise theirs.
   *
   * The scan is over section VALUES, never labels — the same rule as the
   * keyword matcher above.
   */
  const ENGLISH_CLAUSE = /[A-Za-z]{2,}(?:\s+[A-Za-z()%$.,-]{1,}){3,}/g;
  const englishInReply = (out?.response?.sections || [])
    .map((sec) => String(sec?.value ?? '').match(ENGLISH_CLAUSE) || [])
    .flat()
    .filter((m) => /[a-z]\s+[a-z]/i.test(m));

  rows.push({
    intent: probe.intent,
    classified: out?.intent?.intentType || null,
    legs: legIntents,
    subjects: legSubjects,
    executionLegs,
    planHasMoneyStep,
    legsOk,
    subjectsOk,
    answered: answered.filter((a) => a.ok).map((a) => a.name),
    missed: answered.filter((a) => !a.ok).map((a) => a.name),
    parts: answered.length,
    textLength: text.length,
    mode: out?.response?.mode || null,
    hasResultSection: sectionIds.includes('result'),
    hasQuestionSection: sectionIds.includes('question'),
    englishInReply,
    error
  });
}

/* ── the report ────────────────────────────────────────────────────────── */
const totalParts = rows.reduce((a, r) => a + r.parts, 0);
const answeredParts = rows.reduce((a, r) => a + r.answered.length, 0);
const fullyAnswered = rows.filter((r) => r.missed.length === 0).length;

if (AS_JSON) {
  console.log(JSON.stringify({
    rows,
    summary: {
      probes: rows.length,
      parts: totalParts,
      answered: answeredParts,
      missed: totalParts - answeredParts,
      fullyAnswered,
      coveragePct: totalParts ? Number(((answeredParts / totalParts) * 100).toFixed(1)) : 0,
      executionLegs: rows.reduce((a, r) => a + r.executionLegs.length, 0),
      moneyPlans: rows.filter((r) => r.planHasMoneyStep).length,
      badLegs: rows.filter((r) => !r.legsOk).length,
      /* a leg that is not about the subject the user named is a leg that
         answers a question nobody asked */
      badSubjects: rows.filter((r) => !r.subjectsOk).length,
      /* a turn that answered its own question must show the answer as a
         section, not only as words somewhere in the reply */
      answeredWithoutResultSection: rows.filter((r) => r.missed.length === 0 && !r.hasResultSection).length,
      /* the machine's question must never ERASE the answer it sits beside */
      answersErasedByQuestion: rows.filter((r) => r.hasQuestionSection && !r.hasResultSection).length,
      englishClausesInReply: rows.reduce((a, r) => a + r.englishInReply.length, 0)
    }
  }, null, 2));
} else {
  console.log('');
  console.log('  DOES A TWO-PART QUESTION GET BOTH PARTS ANSWERED?');
  console.log('  ' + '='.repeat(78));
  for (const row of rows) {
    const ok = row.missed.length === 0;
    console.log(
      `  ${row.intent.padEnd(20)} ${(ok ? 'both' : 'ONE ').padEnd(6)} ` +
      `answered: ${row.answered.join(', ') || '—'}${row.missed.length ? `   MISSED: ${row.missed.join(', ')}` : ''}`
    );
    console.log(`  ${''.padEnd(20)} ${row.legs.length ? `legs: ${row.legs.join(' + ')}` : 'legs: — (one intent answers both)'}`);
  }
  console.log('');
  console.log('  ' + '-'.repeat(78));
  console.log(`  two-part questions        ${rows.length}`);
  console.log(`  both parts answered       ${fullyAnswered}`);
  console.log(`  parts answered            ${answeredParts} / ${totalParts}`);
  console.log(`  coverage                  ${totalParts ? ((answeredParts / totalParts) * 100).toFixed(1) : 0}%`);
  const execLegs = rows.reduce((a, r) => a + r.executionLegs.length, 0);
  const moneyPlans = rows.filter((r) => r.planHasMoneyStep).length;
  console.log(`  legs about the wrong subject  ${rows.filter((r) => !r.subjectsOk).length}   (two legs, one asset, is one answer twice)`);
  console.log(`  execution legs            ${execLegs}   (a question is not a permission)`);
  console.log(`  plans with a money step   ${moneyPlans}`);
  console.log('');
  if (fullyAnswered < rows.length) {
    console.log('  THE HALF THAT WAS DROPPED — silently, with a complete-looking reply:');
    for (const row of rows.filter((r) => r.missed.length)) {
      console.log(`    · ${row.intent} — ${row.missed.join(', ')}`);
    }
    console.log('');
  }
}
