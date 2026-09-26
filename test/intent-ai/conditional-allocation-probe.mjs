#!/usr/bin/env node
/**
 * PHASE 217 — RWA / STOCKS / FOREX / COMMODITIES BECOME AI-NATIVE.
 * ────────────────────────────────────────────────────────────────────────────
 * The acceptance sentence for this phase is the one in the request:
 *
 *   «اگر طلا ۵٪ اصلاح کرد و BTC هم بالای ۶۵۰۰۰ بود، ۱۰٪ سرمایه را به طلا
 *     اختصاص بده.»
 *
 * Understanding it needs six things at once — GOLD (a commodity), BTC (a
 * different class), PORTFOLIO («سرمایه» is the owner's capital, not a number),
 * RISK (a 5% drawdown), CONDITION (two of them, joined by AND) and ALLOCATION
 * (10%). Before this phase the AI's asset vocabulary was crypto-only
 * (`resolveAsset('طلا') === null`), the monitor engine could only watch a
 * CoinGecko id, and a stored `conditions[]` array was persisted and never
 * evaluated — so the sentence could be classified and never acted on.
 *
 * Proven here:
 *   1. the registry knows the traditional instruments and says where each one
 *      is read from — and refuses the ones with no feed;
 *   2. the parser recovers conditions, logic, action, capital source and the
 *      classes involved, in Persian and English;
 *   3. an unstated threshold is a QUESTION, never an invented 5%;
 *   4. evaluation is TRIGGERED / WAITING / ARMING / UNREADABLE and nothing
 *      else — one dead feed makes the whole instruction UNREADABLE;
 *   5. «۱۰٪ سرمایه» becomes dollars from the REAL capital read, or
 *      NO_CAPITAL_READ; units come from a real price or stay null;
 *   6. the 40% rail FLAGS and BLOCKS, it does not quietly apply;
 *   7. execution is gated by the Phase 215 broker registry: no provider → the
 *      honest Persian refusal, never a simulated fill;
 *   8. the instruction becomes ONE durable monitor with BOTH legs — firing on
 *      either leg alone would allocate on half an instruction;
 *   9. the brain classifies it as CONDITIONAL_ALLOCATION, and the what-if and
 *      the alert that look similar keep their own intents;
 *  10. the whole thing is behind a flag and refuses when disabled.
 *
 * Run: node test/intent-ai/conditional-allocation-probe.mjs
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
delete process.env.BLOB_READ_WRITE_TOKEN;

const rows = [];
const t = (name, ok) => rows.push([name, Boolean(ok)]);

const { instrumentFor, classOf, findInstruments, INSTRUMENTS, instrumentsInClass } =
  await import('../../src/lib/intent-ai/crossAssetInstruments.js');
const { parseConditionalIntent, describeConditionalIntent, questionFor, splitClauses } =
  await import('../../src/lib/intent-ai/conditionalIntent.js');
const {
  createConditionalAllocationEngine,
  evaluateOneCondition,
  combineEvaluations,
  buildAllocationPlan,
  monitorDraftFor,
  ALLOCATION_LIMITS
} = await import('../../server/fios/conditionalAllocation.js');
const {
  registerExecutionProvider, unregisterExecutionProvider, listExecutionProviders
} = await import('../../server/fios/traditionalAssets.js');
const {
  createMonitor, deleteMonitor, listMonitors, evaluateMonitor, resolveMonitorAsset, normalizeConditions
} = await import('../../server/intentMonitoring.js');
const { classify, INTENT_TYPES } = await import('../../src/lib/central/intent.js');
const { PLAN_TEMPLATES } = await import('../../src/lib/central/planner.js');
const { requireFlag } = await import('../../server/fios/flags.js');

const OWNER = 'dev:phase217';
const now = Date.now();

const ACCEPT_FA = 'اگر طلا ۵٪ اصلاح کرد و BTC هم بالای ۶۵۰۰۰ بود، ۱۰٪ سرمایه را به طلا اختصاص بده';
const ACCEPT_EN = 'if gold drops 5% and BTC is above 65000, allocate 10% of my capital to gold';

/* ── 1. the registry: what exists, and what can actually be read ───────── */
t('gold, silver, WTI, the dollar index, a stock and an RWA are all instruments now',
  ['GOLD', 'SILVER', 'WTI', 'DXY', 'AAPL', 'RWA'].every((s) => instrumentFor(s)?.symbol === s));
t('each lands in the class the decision engine already understands',
  classOf('GOLD') === 'commodities' && classOf('DXY') === 'forex'
  && classOf('AAPL') === 'stocks' && classOf('RWA') === 'rwa'
  && classOf('SPY') === 'etf' && classOf('BTC') === 'crypto');
t('the Persian words resolve — «طلا» is the asset, not an unknown token',
  findInstruments('اگر طلا اصلاح کرد').some((f) => f.symbol === 'GOLD')
  && findInstruments('نقره بخرم').some((f) => f.symbol === 'SILVER')
  && findInstruments('شاخص دلار').some((f) => f.symbol === 'DXY')
  && findInstruments('دارایی دنیای واقعی').some((f) => f.symbol === 'RWA'));
t('crypto is untouched by the new table (no double-reading of BTC)',
  findInstruments('btc').length === 1 && findInstruments('btc')[0].assetClass === 'crypto');
t('every instrument names WHERE its price comes from — or admits there is nowhere',
  INSTRUMENTS.every((i) => i.read && (['crypto', 'macro', 'global'].includes(i.read.kind) || i.read.kind === 'unreadable')));
t('an ETF with no feed in this deployment says so instead of pretending',
  instrumentFor('GLD')?.read?.kind === 'unreadable' && instrumentFor('GLD')?.read?.reason === 'NO_ETF_FEED');
t('the six traditional classes are all populated',
  ['etf', 'funds', 'stocks', 'forex', 'commodities', 'rwa'].every((c) => instrumentsInClass(c).length > 0));

/* ── 2. the acceptance sentence, in both languages ─────────────────────── */
const fa = parseConditionalIntent(ACCEPT_FA);
const en = parseConditionalIntent(ACCEPT_EN);
for (const [lang, it] of [['fa', fa], ['en', en]]) {
  t(`${lang}: two conditions, on two different classes`,
    it.conditions.length === 2
    && it.conditions[0].asset === 'GOLD' && it.conditions[0].assetClass === 'commodities'
    && it.conditions[1].asset === 'BTC' && it.conditions[1].assetClass === 'crypto');
  t(`${lang}: «۵٪ اصلاح کرد» is a DRAWDOWN of 5%, not "price ≤ 5"`,
    it.conditions[0].metric === 'PERCENT_CHANGE' && it.conditions[0].operator === 'BELOW'
    && it.conditions[0].threshold === -5 && it.conditions[0].basis === 'DRAWDOWN_FROM_NOW');
  t(`${lang}: «بالای ۶۵۰۰۰» is an absolute price floor on BTC`,
    it.conditions[1].metric === 'PRICE' && it.conditions[1].operator === 'ABOVE'
    && it.conditions[1].threshold === 65000);
  t(`${lang}: the two conditions are joined by AND`,
    it.logic === 'AND');
  t(`${lang}: the action allocates 10% of the PORTFOLIO into gold`,
    it.action?.kind === 'ALLOCATE' && it.action.target.symbol === 'GOLD'
    && it.action.target.assetClass === 'commodities'
    && it.action.sizePct === 10 && it.action.sizeUsd === null
    && it.action.source === 'PORTFOLIO');
  t(`${lang}: «سرمایه» is recognised as the capital source, not as a number`,
    it.portfolio.referenced === true && it.portfolio.assumed === false);
  t(`${lang}: nothing is missing, and the confidence says so`,
    it.missing.length === 0 && it.confidence > 0.8);
  t(`${lang}: the AI can say back what it understood, in the user's language`,
    describeConditionalIntent(it).includes(lang === 'fa' ? 'طلا' : 'Gold')
    && describeConditionalIntent(it).includes(lang === 'fa' ? '۱۰٪' : '10%'));
}

/* ── 3. cross-class breadth: stocks + forex, and RWA ───────────────────── */
const stocksFx = parseConditionalIntent('when tesla falls 10% and the dollar index is below 100, put 5% into AAPL');
t('an equity drawdown + an FX floor + an equity target parses across classes',
  stocksFx.conditions[0]?.asset === 'TSLA' && stocksFx.conditions[0]?.threshold === -10
  && stocksFx.conditions[1]?.asset === 'DXY' && stocksFx.conditions[1]?.operator === 'BELOW'
  && stocksFx.action?.target?.symbol === 'AAPL'
  && stocksFx.classes.includes('stocks') && stocksFx.classes.includes('forex'));
const rwa = parseConditionalIntent('اگر دارایی دنیای واقعی ۵٪ رشد کرد و اتریوم بالای ۳۰۰۰ بود، ۱۵٪ سرمایه را به rwa اختصاص بده');
t('RWA is a first-class conditional asset (a 5% rally, not a drawdown)',
  rwa.conditions[0]?.asset === 'RWA' && rwa.conditions[0]?.assetClass === 'rwa'
  && rwa.conditions[0]?.operator === 'ABOVE' && rwa.conditions[0]?.threshold === 5
  && rwa.action?.target?.assetClass === 'rwa' && rwa.action?.sizePct === 15);
const orCase = parseConditionalIntent('if gold drops 5% or WTI is below 70, allocate 8% of capital to silver');
t('«یا / or» produces OR, so either leg is enough', orCase.logic === 'OR' && orCase.conditions.length === 2);
t('a spoken fraction («نصف سرمایه») is 50%, not a parsing failure',
  parseConditionalIntent('اگر شاخص دلار بالای ۱۰۵ رفت نصف سرمایه را به نقره منتقل کن').action?.sizePct === 50);

/* ── 4. honesty: a gap is a question, never a default ──────────────────── */
const noThreshold = parseConditionalIntent('اگر طلا اصلاح کرد، ۱۰٪ سرمایه را به طلا اختصاص بده');
t('«اگر طلا اصلاح کرد» with no number asks for the threshold instead of guessing 5%',
  noThreshold.conditions[0]?.threshold === null
  && noThreshold.conditions[0]?.operator === 'BELOW'
  && noThreshold.missing.includes('THRESHOLD'));
t('the missing slot carries a real question, in the user\'s language',
  questionFor('THRESHOLD', { lang: 'fa' }).includes('حد نصاب')
  && questionFor('SIZE', { lang: 'en' }).includes('how much'));
t('a sentence with no condition at all is not silently treated as one',
  parseConditionalIntent('طلا بخرم').isConditional === false);
t('an unknown asset is not invented — the target stays empty and is reported',
  parseConditionalIntent('اگر xyzcoin ۵٪ ریخت، ۱۰٪ سرمایه را به xyzcoin اختصاص بده').action?.target === null);
t('clause splitting keeps the Persian comma («،») — the size never becomes the condition',
  splitClauses(ACCEPT_FA).length === 3);

/* ── 5. evaluation: TRIGGERED / WAITING / ARMING / UNREADABLE ──────────── */
const engine = createConditionalAllocationEngine({ collections: null, observability: null, log: () => {} });
const macroQuotes = {
  at: now, source: 'macroData:stooq',
  items: [
    { symbol: 'GOLD', priceUsd: 2650, change1dPct: -6.2, source: 'stooq:GC.F', at: now },
    { symbol: 'DXY', priceUsd: 101.2, change1dPct: 0.1, source: 'stooq:DX.F', at: now }
  ]
};
const cryptoPrices = { bitcoin: { usd: 67000, usd_24h_change: -1.1 } };
/* Gold at 2650 against a 2820 baseline is -6.03% → the -5% drawdown is met. */
const triggered = await engine.evaluate(OWNER, {
  intent: fa, capitalUsd: 10000, baselines: { GOLD: 2820 },
  cryptoPrices, macroQuotes, globalSnapshot: null
});
t('a met drawdown + a met price floor → TRIGGERED, with the allocation built',
  triggered.state === 'TRIGGERED'
  && triggered.record.plan?.ok === true
  && triggered.record.plan.allocationUsd === 1000
  && triggered.record.plan.sizePct === 10);
t('the plan carries the real price it used and the units that price implies',
  triggered.record.plan.target.priceUsd === 2650
  && Math.abs(triggered.record.plan.units - 1000 / 2650) < 1e-9);
t('every condition is reported with the value and the source it was read from',
  triggered.record.evaluations.length === 2
  && triggered.record.evaluations.every((e) => e.ok === true && e.value > 0 && e.source)
  && triggered.record.evaluations[0].source.startsWith('stooq'));
const waiting = await engine.evaluate(OWNER, {
  intent: fa, capitalUsd: 10000, baselines: { GOLD: 2820 },
  cryptoPrices: { bitcoin: { usd: 61000 } }, macroQuotes, globalSnapshot: null
});
t('BTC below the floor → WAITING, and NO allocation is produced',
  waiting.state === 'WAITING' && waiting.record.plan === null);
const arming = await engine.evaluate(OWNER, {
  intent: fa, capitalUsd: 10000, baselines: {},
  cryptoPrices, macroQuotes, globalSnapshot: null
});
t('a drawdown with no baseline ARMS on the live price instead of firing on nothing',
  arming.state === 'ARMING' && arming.newBaselines?.GOLD === 2650 && arming.record.plan === null);
const noFeed = await engine.evaluate(OWNER, {
  intent: fa, capitalUsd: 10000, baselines: { GOLD: 2820 },
  cryptoPrices, macroQuotes: { at: now, source: 'none', items: [] }, globalSnapshot: null
});
t('one unreadable feed makes the WHOLE instruction UNREADABLE — never "assume it corrected"',
  noFeed.state === 'UNREADABLE' && noFeed.record.plan === null
  && noFeed.record.evaluations.some((e) => e.reason === 'NO_FEED_FOR_INSTRUMENT'));
t('the pure evaluator is honest about a missing baseline and a missing threshold',
  evaluateOneCondition({ asset: 'GOLD', metric: 'PERCENT_CHANGE', operator: 'BELOW', threshold: -5 }, { ok: true, value: 2650 }).armed === true
  && evaluateOneCondition({ asset: 'GOLD', metric: 'PERCENT_CHANGE', operator: 'BELOW', threshold: null }, { ok: true, value: 2650 }).reason === 'NO_THRESHOLD'
  && evaluateOneCondition({ asset: 'GOLD', metric: 'PRICE', operator: 'ABOVE', threshold: 100 }, { ok: false, code: 'NO_FEED_FOR_INSTRUMENT' }).reason === 'NO_FEED_FOR_INSTRUMENT');
t('OR fires on one leg, AND does not',
  combineEvaluations([{ ok: true, hit: false }, { ok: true, hit: true }], 'OR').hit === true
  && combineEvaluations([{ ok: true, hit: false }, { ok: true, hit: true }], 'AND').hit === false);

/* ── 6. the allocation: real capital, or an honest refusal ─────────────── */
t('«۱۰٪ سرمایه» is dollars from the real capital read — not a default portfolio',
  buildAllocationPlan(en, { capitalUsd: 8350 }).allocationUsd === 835);
t('no capital read → NO_CAPITAL_READ, never a made-up portfolio size',
  buildAllocationPlan(en, { capitalUsd: null }).code === 'NO_CAPITAL_READ'
  && buildAllocationPlan(en, { capitalUsd: 0 }).code === 'NO_CAPITAL_READ');
t('an absolute amount still reports its share of capital',
  buildAllocationPlan({ action: { kind: 'ALLOCATE', target: { symbol: 'GOLD', assetClass: 'commodities' }, sizeUsd: 500 }, classes: [] },
    { capitalUsd: 10000 }).sizePct === 5);
t('units stay null when no price could be read (never a division by a guess)',
  buildAllocationPlan(en, { capitalUsd: 8350 }).units === null);
t('the plan is always PROPOSED: requiresConfirmation true, signs false, simulated false',
  buildAllocationPlan(en, { capitalUsd: 8350 }).rail.requiresConfirmation === true
  && buildAllocationPlan(en, { capitalUsd: 8350 }).signs === false
  && buildAllocationPlan(en, { capitalUsd: 8350 }).simulated === false);

/* ── 7. the 40% rail ───────────────────────────────────────────────────── */
const big = parseConditionalIntent('اگر طلا ۵٪ اصلاح کرد، ۶۰٪ سرمایه را به طلا اختصاص بده');
const bigPlan = buildAllocationPlan(big, { capitalUsd: 10000 });
t('a 60% instruction is FLAGGED above the 40% rail and BLOCKED until confirmed',
  bigPlan.rail.aboveRail === true && bigPlan.rail.blockedByRail === true
  && bigPlan.warnings.some((w) => w.code === 'ALLOCATION_ABOVE_RAIL' && w.requiresExplicitConfirmation === true));
t('the rail is a named number, not a vibe', ALLOCATION_LIMITS.MAX_SINGLE_ALLOCATION_PCT === 40);
t('a percentage with no stated source is reported as ASSUMED, not asserted',
  buildAllocationPlan(stocksFx, { capitalUsd: 10000 }).warnings.some((w) => w.code === 'CAPITAL_SOURCE_ASSUMED'));

/* ── 8. execution: the Phase 215 broker gate, unchanged ────────────────── */
const goldGate = await engine.executeCheck(OWNER, { assetClass: 'commodities', instrument: 'GOLD', amountUsd: 1000 });
t('a commodity with no broker → the honest Persian refusal, never a simulated fill',
  goldGate.ok === false && goldGate.code === 'NO_EXECUTION_PROVIDER'
  && /فقط تحلیل/.test(goldGate.detail) && /commodities/.test(goldGate.detail));
const cryptoGate = await engine.executeCheck(OWNER, { assetClass: 'crypto', instrument: 'BTC', amountUsd: 100 });
t('crypto keeps its real path — the existing swap hand-off, unsigned',
  cryptoGate.ok === true && cryptoGate.executionStatus.via === 'dex-cex-adapters');
let providerSaw = null;
registerExecutionProvider({
  id: 'probe-metals-desk', assetClass: 'commodities', name: 'Probe Metals Desk', configured: true,
  execute: async (input) => { providerSaw = input; return { ok: true, orderId: 'ord_1', status: 'ORDER_PREPARED', signed: false }; }
});
t('with a configured broker the gate opens and names the provider',
  (await engine.executeCheck(OWNER, { assetClass: 'commodities', instrument: 'GOLD', amountUsd: 1000 })).executionStatus.via === 'probe-metals-desk'
  && listExecutionProviders().some((p) => p.id === 'probe-metals-desk'));
unregisterExecutionProvider('commodities');
t('unregistering the broker returns the refusal (nothing is dialed by default)',
  (await engine.executeCheck(OWNER, { assetClass: 'commodities', instrument: 'GOLD', amountUsd: 1000 })).ok === false);

/* ── 9. the instruction becomes ONE durable monitor with BOTH legs ─────── */
const draft = monitorDraftFor(fa, { lang: 'fa' });
t('the draft keeps both legs on ONE row, joined by AND',
  draft.ok === true && draft.monitor.conditions.length === 1
  && draft.monitor.conditionLogic === 'AND'
  && draft.monitor.asset.symbol === 'GOLD' && draft.monitor.conditions[0].asset.symbol === 'BTC');
t('a PERCENT_CHANGE leg carries a POSITIVE threshold (the monitor convention: a drop of t%)',
  draft.monitor.metric === 'PERCENT_CHANGE' && draft.monitor.operator === 'BELOW' && draft.monitor.threshold === 5
  && draft.monitor.conditions[0].metric === 'PRICE' && draft.monitor.conditions[0].threshold === 65000);
t('the allocation the monitor is GUARDING rides along as data (it notifies, it does not allocate)',
  draft.monitor.allocation?.symbol === 'GOLD' && draft.monitor.allocation?.sizePct === 10
  && draft.monitor.allocation?.assetClass === 'commodities');
t('the monitor resolver accepts gold, which the crypto resolver never could',
  resolveMonitorAsset({ symbol: 'GOLD' })?.assetClass === 'commodities'
  && resolveMonitorAsset({ symbol: 'BTC' })?.coinId === 'bitcoin');
t('an instrument with no feed is still refused at CREATION (a watch that can never read is worse)',
  resolveMonitorAsset({ symbol: 'GLD' }) === null
  && normalizeConditions([{ asset: { symbol: 'GLD' }, metric: 'PRICE', operator: 'ABOVE', threshold: 10 }]).rows.length === 0);

const macroAt = (goldPrice) => ({
  at: now, source: 'macroData:stooq',
  items: [
    { symbol: 'GOLD', priceUsd: goldPrice, change1dPct: -6.2, source: 'stooq:GC.F', at: now },
    { symbol: 'DXY', priceUsd: 101.2, change1dPct: 0.1, source: 'stooq:DX.F', at: now }
  ]
});
const fresh = async () => (await createMonitor(OWNER, draft.monitor, { now })).monitor;
const created = await fresh();
t('the cross-asset monitor is storable — gold is no longer UNKNOWN_ASSET',
  Boolean(created) && created?.asset?.symbol === 'GOLD'
  && Array.isArray(created?.conditions) && created.conditions.length === 1);

/* The real lifecycle: arm at the live price, then move the market. */
const armedRun = await evaluateMonitor(created, { cryptoPrices, now, macroQuotes: macroAt(2650) });
t('first pass ARMS the drawdown baseline on the live gold price and never fires',
  armedRun.triggered === false && armedRun.armed === true
  && armedRun.monitor?.baseline === 2650);

const flatRun = await evaluateMonitor(armedRun.monitor, { cryptoPrices, now, macroQuotes: macroAt(2650) });
t('a flat gold reading stays quiet however high BTC is — the primary leg is not met',
  flatRun.triggered === false && flatRun.legs == null);

const dropRun = await evaluateMonitor(await fresh(), { cryptoPrices, now, macroQuotes: macroAt(2650) })
  .then((armed) => evaluateMonitor(armed.monitor, { cryptoPrices, now, macroQuotes: macroAt(2490) }));
t('gold -6% AND BTC above 65000 → BOTH legs hold and the monitor fires',
  dropRun.triggered === true && dropRun.legs?.[0]?.asset === 'BTC' && dropRun.legs?.[0]?.hit === true);
t('the fired event records the legs that held, so «why did this fire?» is answerable',
  dropRun.monitor?.events?.at(-1)?.legs?.[0]?.asset === 'BTC'
  && dropRun.monitor?.events?.at(-1)?.legs?.[0]?.value === 67000);

const halfRun = await evaluateMonitor(await fresh(), { cryptoPrices, now, macroQuotes: macroAt(2650) })
  .then((armed) => evaluateMonitor(armed.monitor, { cryptoPrices: { bitcoin: { usd: 60000 } }, now, macroQuotes: macroAt(2490) }));
t('gold -6% but BTC at 60000 → it does NOT fire, and names the leg holding it back',
  halfRun.triggered === false && halfRun.waitingOnLegs?.includes('BTC') === true);

const deadRun = await evaluateMonitor(await fresh(), { cryptoPrices, now, macroQuotes: macroAt(2650) })
  .then((armed) => evaluateMonitor(armed.monitor, { cryptoPrices: {}, now, macroQuotes: macroAt(2490) }));
t('an unreadable leg is an error, never a silent pass',
  deadRun.triggered === false && Boolean(deadRun.error));

for (const m of await listMonitors(OWNER)) await deleteMonitor(OWNER, m.id);
t('cleanup leaves the owner\'s monitor list as it was',
  (await listMonitors(OWNER)).length === 0);

/* ── 10. the brain routes it, and does not steal the neighbours ─────────── */
const ctx = { capabilities: {}, stateHas: { markets: true, portfolio: true }, memory: {}, page: { module: null }, followUp: null };
t('the central brain classifies the acceptance sentence as CONDITIONAL_ALLOCATION',
  classify(ACCEPT_FA, { context: ctx }).type === 'CONDITIONAL_ALLOCATION'
  && classify(ACCEPT_EN, { context: ctx }).type === 'CONDITIONAL_ALLOCATION');
t('the what-if that looks similar stays a what-if («اگر بیت‌کوین ریخت چه می‌شود» has no action)',
  classify('اگر بیت‌کوین ۲۰٪ بریزد چه میشه', { context: ctx }).type === 'WHATIF_SIMULATION');
t('the alert that looks similar stays an alert («وقتی رسید خبرم کن» has no allocation)',
  classify('وقتی بیت کوین به 100 هزار رسید خبرم کن', { context: ctx }).type === 'SET_ALERT');
t('a plain instrument question is still a question',
  classify('طلا بخرم؟', { context: ctx }).type === 'INSTRUMENT_QUERY');
t('the intent is PREPARE, not EXECUTE — the plan is proposed, the wallet signs',
  INTENT_TYPES.CONDITIONAL_ALLOCATION?.permission === 'PREPARE');
t('the planner has a template, and it ends at a confirmation gate',
  typeof PLAN_TEMPLATES.CONDITIONAL_ALLOCATION === 'function'
  && PLAN_TEMPLATES.CONDITIONAL_ALLOCATION().some((s) => s.module === 'policy' && s.gate === true)
  && PLAN_TEMPLATES.CONDITIONAL_ALLOCATION().some((s) => s.module === 'commodities')
  && PLAN_TEMPLATES.CONDITIONAL_ALLOCATION().every((s) => s.permission !== 'EXECUTE' || s.gate === true));

/* ── 11. the flag gate ─────────────────────────────────────────────────── */
process.env.CONDITIONAL_ALLOCATION_ENABLED = 'false';
t('the engine is flag-gated and refuses instead of faking success',
  engine.parse(OWNER, { text: ACCEPT_FA }).code === 'FEATURE_DISABLED'
  && requireFlag('CONDITIONAL_ALLOCATION_ENABLED').code === 'FEATURE_DISABLED');
process.env.CONDITIONAL_ALLOCATION_ENABLED = 'true';
t('flipping the flag back restores the engine without a redeploy',
  engine.parse(OWNER, { text: ACCEPT_FA }).ok === true);

/* ── 12. the chat actually answers it ──────────────────────────────────── */
const { conditionalAllocationReply } = await import('../../server/aiIntentOS.js');
const chatCtx = { portfolio: { totalValueUsd: 8350, holdings: [] } };
const fixtureReads = {
  GOLD: { ok: true, value: 2650, source: 'stooq:GC.F', at: now },
  BTC: { ok: true, value: 67000, source: 'coingecko', at: now }
};
const readPrices = async (syms) => Object.fromEntries(
  syms.map((s) => [s, fixtureReads[s] || { ok: false, code: 'NO_FEED_FOR_INSTRUMENT' }])
);
const say = (message, locale = 'fa') => conditionalAllocationReply({ message, context: chatCtx, locale, readPrices });

const chatFa = await say(ACCEPT_FA);
t('the chat answers the acceptance sentence instead of routing it to a page',
  chatFa?.ok === true && chatFa.ui?.type === 'CONDITIONAL_ALLOCATION'
  && chatFa.text.includes('طلا') && chatFa.text.includes('۱۰٪'));
t('the first read ARMS the baseline and says so — it does not claim the drop happened',
  chatFa.ui.state === 'ARMING' && /خط پایه/.test(chatFa.text));
const chatEn = await say(ACCEPT_EN, 'en');
t('the same instruction in English gets the same answer, in English',
  chatEn?.ui?.state === 'ARMING' && /Baseline recorded/.test(chatEn.text));
const chatAsk = await say('اگر طلا اصلاح کرد، ۱۰٪ سرمایه را به طلا اختصاص بده');
t('a condition with no threshold is answered with a QUESTION, not a defaulted 5%',
  chatAsk?.ui?.state === 'NEEDS_INPUT'
  && chatAsk.ui.missing.includes('THRESHOLD')
  && chatAsk.text.includes('حد نصاب')
  && !/۵٪/.test(chatAsk.text.split('\n')[0]));
const chatDead = await conditionalAllocationReply({
  message: ACCEPT_FA, context: chatCtx, locale: 'fa',
  readPrices: async (syms) => Object.fromEntries(syms.map((s) => [s, { ok: false, code: 'NO_FEED_FOR_INSTRUMENT' }]))
});
t('an unreadable price is stated as unreadable and the instruction is NOT evaluated',
  chatDead?.ui?.state === 'UNREADABLE' && /نمی‌زنم/.test(chatDead.text));
t('non-conditional turns are left to the normal pipeline (the chat does not hijack them)',
  (await say('سلام')) === null
  && (await say('اگر بیت‌کوین ۲۰٪ بریزد چه میشه')) === null
  && (await say('وقتی بیت کوین به 100 هزار رسید خبرم کن')) === null
  && (await say('قیمت اتریوم چنده')) === null);
const chatWatch = chatFa;
t('the reply carries a monitor draft and a route to the watching surface',
  chatWatch.ui.watch?.asset?.symbol === 'GOLD'
  && chatWatch.ui.watch?.conditions?.[0]?.asset?.symbol === 'BTC'
  && chatWatch.actions?.[0]?.route?.includes('/intent'));
t('the reply never claims to have executed anything',
  chatFa.executed === false && chatFa.requiresUserSignature === false);

/* ── report ────────────────────────────────────────────────────────────── */
const failed = rows.filter(([, ok]) => !ok);
console.log(`\n${rows.length - failed.length}/${rows.length} passed`);
if (failed.length) {
  console.error('\nFAILED checks:');
  for (const [name] of failed) console.error(`  ✗ ${name}`);
  process.exit(1);
}
console.log('cross-asset conditional allocation probe passed (Phase 217)');
process.exit(0);
