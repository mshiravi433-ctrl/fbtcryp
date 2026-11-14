/**
 * ─── THE FIRST-PARTY PLUGINS, ATTACHED TO A CHAT TURN ───────────────────────
 *
 * Measured before this change, over the real brain and the real catalog:
 *
 *   · `server/agentHub/native/agents.js` holds ELEVEN working plugins (a yield
 *     optimizer over DefiLlama pools, a token risk scanner over GoPlus, a
 *     wallet exposure auditor, a strategy backtester, a smart-money tracker,
 *     six more), each with a real data source and an honest «the source did not
 *     answer» path.
 *   · `runNativeAgent` had ZERO call sites outside the Agent Hub dock. A chat
 *     turn could not reach ONE of them, so «گزارش امنیتی Aave را بده» arrived
 *     as UNSUPPORTED and spent one of the 50 daily provider calls on a generic
 *     model answer — or refused — while a local plugin that reads the live
 *     source sat dark.
 *   · Cost, measured 2026-11-11: importing all eleven is 4 ms / 1.2 MB, a warm
 *     run of one plugin is 0.4 ms, and a mounted agent-layer call (guardian,
 *     council, agent council, runtime) is 0.0–1.5 ms. The user's rule was
 *     «measure the CPU, then remove the expensive ones and upgrade the cheap
 *     ones» — these are the cheapest capabilities in the product, so they were
 *     upgraded, not removed.
 *
 * What the attach had to survive, and what this gate therefore measures:
 *
 *   1. A plugin report is MARKDOWN and the reply is plain text cut at 220
 *      characters, so publishing it raw put «# اسکن ریسک · 0x1111 ## قرارداد -
 *      آدرس: …» in the headline behind the generic «نتیجهٔ خواندن وضعیت:».
 *   2. A plugin whose source was down still returns `ok:true` with a report of
 *      labels whose values are «—», and one of them computed «بیشترین افت از
 *      سقف: +0.0%» from ZERO candles — a number-shaped hole that read as a
 *      fact. An absence must never be published as an answer.
 *   3. The plugin that asks for an input the user ALREADY gave («گزارش امنیتی
 *      Aave» → «نام پروتکل را بدهید») must not be published either; that was a
 *      reader that only saw a protocol name after «پروتکل», not a bare one.
 *   4. The attach runs only on a turn the registry could not route, so it must
 *      never steal a routed turn, and no match must cost nothing at all.
 *
 *   node --test test/intent-ai/plugin-attach-runtime.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* This gate tests the attach, so it says so: the suite runs with the plugin
   attach off (an unset flag under NODE_ENV=test means off, so no test reaches
   CoinGecko/DefiLlama/GoPlus), and every plugin run below goes through a
   catalog this file installs itself. */
process.env.AI_PLUGIN_ATTACH = 'true';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/* ── the real brain, the real composition root, faked externals ──────────── */
const { installFakes } = await import(path.join(ROOT, 'test', 'intent-ai', 'ci-fakes.mjs'));
const { setCiSource } = await import(path.join(ROOT, 'server', 'ci', 'sources.js'));
for (const [name, fn] of Object.entries(installFakes())) setCiSource(name, fn);
const { createCentralBrain } = await import(path.join(ROOT, 'server', 'ci', 'brain.js'));
const { createCentralStateStore } = await import(path.join(ROOT, 'server', 'ci', 'stateStore.js'));
const stateStore = createCentralStateStore();
const brain = createCentralBrain({ stateStore });
const { createFinancialIntelligence } = await import(path.join(ROOT, 'server', 'fios', 'index.js'));
createFinancialIntelligence({ stateStore, brain, ownerFor: (o) => o, log: () => {} });
const { hasPluginProvider, consultPlugins } = await import(path.join(ROOT, 'server', 'ci', 'pluginBridge.js'));
const attach = await import(path.join(ROOT, 'server/agentHub/pluginAttach.js'));
const { NATIVE_AGENTS } = await import(path.join(ROOT, 'server/agentHub/native/agents.js'));
const { extractRequest } = await import(path.join(ROOT, 'server/agentHub/native/data.js'));

const ADDRESS = '0x1111111111111111111111111111111111111111';
const now = Date.now();
const series = (base, drift) => Array.from({ length: 32 }, (_, i) => Math.round(base * (1 + drift * Math.sin(i / 3) + i * 0.004)));

async function seed(owner) {
  await stateStore.write(owner, 'wallet', {
    data: { addresses: { evm: [ADDRESS] }, connected: true }, source: 'gate-wallet', status: 'OK', now
  });
  await stateStore.write(owner, 'portfolio', {
    data: { holdings: [{ symbol: 'BTC', amount: 0.25, valueUsd: 9000, chainId: 1, priceUsd: 36000 }, { symbol: 'USDC', amount: 1000, valueUsd: 1000, chainId: 1, priceUsd: 1 }], totalValueUsd: 10000, dataStatus: 'live' },
    source: 'gate-portfolio', status: 'OK', now
  });
  await stateStore.write(owner, 'markets', {
    data: { prices: { BTC: { priceUsd: 36000 }, ETH: { priceUsd: 3000 }, USDC: { priceUsd: 1 } }, bySymbol: {}, history: { BTC: series(36000, 0.02), ETH: series(3000, 0.018) } },
    source: 'gate-markets', status: 'OK', now
  });
  await stateStore.write(owner, 'risk', { data: { riskScore: 40, level: 'MEDIUM' }, source: 'gate-risk', status: 'OK', now });
}

let turn = 0;
async function ask(message, { locale = 'fa' } = {}) {
  const owner = `plug-gate-${turn++}`;
  await seed(owner);
  const out = await brain.handle({ owner, message, locale });
  const res = out?.response ?? {};
  const section = (id) => (res.sections || []).find((s) => s.id === id) || null;
  return {
    out, res, intent: out?.intent ?? {},
    intentType: out?.intent?.intentType ?? null,
    mode: res.mode ?? null,
    result: String(section('result')?.value ?? ''),
    reason: String(section('reason')?.value ?? ''),
    dataRows: Array.isArray(section('data')?.value) ? section('data').value : (res.evidence || []),
    allValues: (res.sections || []).map((s) => (typeof s.value === 'string' ? s.value : JSON.stringify(s.value ?? ''))).join(' \u00b7 ')
  };
}

/** Install a fake catalog/runner so the LIVE path is provable without egress. */
function fakeAttach(report, { slug = 'protocol-security-brief', nameFa = 'گزارش امنیتی پروتکل', name = 'Protocol Security Brief', dataStatus = 'live' } = {}) {
  const calls = [];
  attach.setPluginAttachCache({
    nativeEnabled: () => true,
    catalog: [{ slug, nameFa, name }],
    data: {},
    runNativeAgent: async (calledSlug, input) => {
      calls.push({ slug: calledSlug, text: input?.text ?? '' });
      return typeof report === 'function' ? report(calledSlug, input) : { ok: true, text: report, title: name, dataStatus, citations: [] };
    }
  });
  return calls;
}
const restore = () => attach.resetPluginAttachCache();

/* ── 1. the composition root actually WIRES the attach ───────────────────── */
test('the plugin attach is wired by the composition root, not merely defined', () => {
  /* A hook that is defined and never registered is not a feature: the brain
     would report PLUGIN_PROVIDER_NOT_WIRED forever and every question would
     keep falling through to the model. */
  assert.equal(hasPluginProvider(), true, 'createFinancialIntelligence must register the plugin provider');
});

/* ── 2. the matcher knows its own catalog ────────────────────────────────── */
test('every plugin claims its OWN catalog examples, and the entity-bound ones need a real entity', () => {
  let checked = 0;
  const misses = [];
  for (const agent of NATIVE_AGENTS) {
    for (const example of [...(agent.examplesFa || []), ...(agent.examples || [])]) {
      /* The catalog writes a truncated «0x…» in its examples; a rule that
         requires an address must see a real one, so the example is completed
         here rather than the rule being weakened. */
      const text = String(example).replaceAll('0x\u2026', ADDRESS).replaceAll('0x...', ADDRESS);
      checked += 1;
      const got = attach.matchPlugin(text).slug;
      if (got !== agent.slug) misses.push(`${agent.slug} \u2190 \u00ab${example}\u00bb got ${got || 'NO_MATCH'}`);
    }
  }
  assert.ok(checked >= 40, `expected the whole catalog's examples, saw ${checked}`);
  assert.deepEqual(misses, [], `examples that did not reach their own plugin: ${misses.join(' | ')}`);
});

test('the matcher never fires on a sentence that is not a plugin question', () => {
  /* A transfer to an address is the case that matters most: it contains an
     address, and an earlier version of this table matched it to the wallet
     auditor on the bare word «آدرس» — a marker word treated as a question
     type. Social text, a routed price question and a routed what-if must not
     fire either, or the attach would steal turns it cannot answer better. */
  const mustNotMatch = [
    `همه پولمو بفرست به آدرس ${ADDRESS}`,
    'سلام', 'ممنون', 'خداحافظ',
    'قیمت بیت کوین چقدره',
    'اگر بیت کوین ۲۰ درصد بالا بره چی میشه',
    'چرا این را گفتی',
    'بیت کوین را بفروش',
    'this is a curved road and nothing else',
    ''
  ];
  const fired = mustNotMatch.filter((q) => attach.matchPlugin(q).slug).map((q) => `${q} \u2192 ${attach.matchPlugin(q).slug}`);
  assert.deepEqual(fired, [], `the matcher fired where it must not: ${fired.join(' | ')}`);
});

test('no match means no run: the catalog is never invoked for an unmatched question', async () => {
  const calls = fakeAttach('## گزارش\n- وضعیت: خطرناک');
  try {
    const out = await consultPlugins({ message: 'سلام حالت چطوره', locale: 'fa', owner: 'x' });
    assert.equal(out.ok, false);
    assert.equal(out.code, 'NO_PLUGIN_MATCH');
    assert.equal(calls.length, 0, 'a question no plugin claims must not run one');
  } finally { restore(); }
});

/* ── 3. the live path: a real turn publishes the plugin's own verdict ────── */
test('a chat turn reaches a plugin and publishes the plugin verdict as its headline', async () => {
  const report = [
    '# گزارش امنیتی · Aave',
    '## خلاصه',
    '- وضعیت: دو حادثهٔ ثبت‌شده، TVL خوانده شد',
    '- TVL: 12,400,000,000 دلار',
    '## منبع',
    '- DefiLlama hacks',
    '- زمان خوانش: 2026-11-11 04:37 UTC'
  ].join('\n');
  const calls = fakeAttach(report);
  try {
    const r = await ask('گزارش امنیتی Aave را بده');
    assert.equal(r.intentType, 'PLUGIN_ANSWER', `expected a plugin answer, got ${r.intentType} / ${r.intent.pluginCode || 'no code'}`);
    assert.equal(r.intent.answeredFromPlugin, true);
    assert.equal(r.intent.pluginSlug, 'protocol-security-brief');
    assert.equal(calls.length, 1, 'exactly one plugin ran');
    assert.ok(r.result.includes('وضعیت: دو حادثهٔ ثبت‌شده'), `the headline must carry the verdict, got: ${r.result}`);
    assert.ok(r.result.includes('Aave'), 'the headline must say which protocol was read');
    /* The generic tail was the whole defect: it reports the ACT of reading. */
    assert.ok(!r.result.includes('نتیجهٔ خواندن وضعیت'), 'the generic read-report headline must not wrap a plugin verdict');
    /* No markdown survives into a plain-text reply. */
    assert.ok(!/[#*`]|^\s*-\s/m.test(r.result), `markdown leaked into the headline: ${r.result}`);
    /* The footer timestamp is metadata, not an answer. */
    assert.ok(!r.result.includes('زمان خوانش'), `the read timestamp became the headline: ${r.result}`);
    /* Provenance names the plugin in the turn's own language. */
    assert.ok(r.reason.includes('گزارش امنیتی پروتکل'), `the reason must name the plugin, got: ${r.reason.slice(0, 120)}`);
    assert.ok(/بدون فراخوانیِ مدل|no model call/.test(r.reason), 'the reason must say the answer cost no model call');
  } finally { restore(); }
});

test('the report behind the verdict travels inside the publisher window, cut at a boundary', async () => {
  const lines = ['- وضعیت: خطرناک'];
  for (let i = 0; i < 30; i++) lines.push(`- بند ${i}: مقدار ${i * 7} دلار`);
  fakeAttach(['# گزارش · Aave', ...lines].join('\n'));
  try {
    const r = await ask('گزارش امنیتی Aave را بده');
    assert.equal(r.intentType, 'PLUGIN_ANSWER');
    /* `recommend.js` slices evidence at 220; the plugin layer must already be
       inside that window and must not have been cut mid-segment. Asserted on
       the published `data` section, not on an intent field: what the user
       reads is the only projection that counts. */
    const rows = Array.isArray(r.res.sections?.find((s) => s.id === 'data')?.value)
      ? r.res.sections.find((s) => s.id === 'data').value.map((x) => String(x))
      : [];
    const detail = rows.find((x) => x.includes('وضعیت: خطرناک')) || '';
    assert.ok(detail.length > 0, `the plugin report must reach the data section, rows: ${JSON.stringify(rows).slice(0, 200)}`);
    assert.ok(detail.length <= 220, `the published report must fit the window, got ${detail.length}`);
    assert.ok(/plugin:protocol-security-brief/.test(detail), `the report must carry its own attribution: ${detail.slice(-60)}`);
    assert.ok(!/\s\u00b7\s*$/.test(detail), 'the report must not end on a dangling separator');
    assert.ok(!/\u0628\u0646\u062f \d+:$/.test(detail), `the report was cut mid-segment: …${detail.slice(-40)}`);
    assert.ok(detail.includes('وضعیت: خطرناک'), 'the verdict must be inside the report that travels with it');
  } finally { restore(); }
});

/* ── 4. an absence is never published as an answer ───────────────────────── */
test('a plugin whose source did not answer is a named gap, not a headline', async () => {
  const report = ['# مواجههٔ کیف‌پول', '- آدرس: ' + ADDRESS, '- ارزش قابل‌مشاهده: $0.000000 (unavailable)', '- سن کیف‌پول: —'].join('\n');
  fakeAttach(report, { slug: 'wallet-exposure-auditor', nameFa: 'ممیزی مواجههٔ کیف‌پول', name: 'Wallet Exposure Auditor', dataStatus: 'unavailable' });
  try {
    const r = await ask(`کیف پول ${ADDRESS} در معرض چه چیزی است`);
    assert.notEqual(r.intentType, 'PLUGIN_ANSWER', 'an unreadable source must not become an answer');
    assert.equal(r.intent.pluginCode, 'PLUGIN_SOURCE_UNAVAILABLE');
    assert.ok(!r.allValues.includes('$0.000000'), 'a zero that stands for «not read» must never be published');
  } finally { restore(); }
});

test('a report of empty labels yields no headline at all, even when the plugin says it ran', async () => {
  /* The real token-research report in a network-less run: every value is «—»
     except one the plugin defaulted to +0.0% from ZERO candles. Both are
     holes; neither is an answer. */
  const report = ['# UNI · UNI', '## هویت بازار', '- قیمت: —', '- ارزش بازار: —', '- حجم ۲۴ ساعت: —', '## عملکرد', '- بیشترین افت از سقف: +0.0%', '- تعداد کندل: —'].join('\n');
  const flat = attach.flattenPluginText(report);
  assert.equal(flat.lead, null, `a dash-and-zero report must produce no lead, got: ${flat.lead}`);
  fakeAttach(report, { slug: 'token-research-agent', nameFa: 'پژوهشگر توکن', name: 'Token Research Agent', dataStatus: 'partial' });
  try {
    const r = await ask('درباره توکن UNI تحقیق کن');
    assert.notEqual(r.intentType, 'PLUGIN_ANSWER');
    assert.ok(!r.allValues.includes('+0.0%'), 'a value defaulted from zero candles must not be published');
  } finally { restore(); }
});

test('a plugin that asks for an input the user already gave is not published', async () => {
  fakeAttach('## ورودی لازم است\nنام پروتکل را بدهید (مثلاً «Aave»).', { dataStatus: 'awaiting_input' });
  try {
    const r = await ask('گزارش امنیتی Aave را بده');
    assert.notEqual(r.intentType, 'PLUGIN_ANSWER');
    assert.equal(r.intent.pluginCode, 'PLUGIN_AWAITING_INPUT');
  } finally { restore(); }
  /* And the reason it happened was fixed at the source: a bare Latin protocol
     name is now read, so the plugin gets its input instead of asking again. */
  assert.equal(extractRequest('گزارش امنیتی Aave را بده').protocolQuery, 'aave');
  assert.equal(extractRequest('ریسک Curve چقدر است').protocolQuery, 'curve');
  assert.equal(extractRequest('this is a curved road').protocolQuery, null, 'a word boundary is not a protocol name');
  assert.equal(extractRequest('گزارش امنیتی').protocolQuery, null, 'no name, no protocol');
});

test('an English body is never published into a Persian turn', async () => {
  fakeAttach('## Security brief\n- Status: two incidents recorded, TVL was read', { dataStatus: 'live' });
  try {
    const r = await ask('گزارش امنیتی Aave را بده');
    assert.notEqual(r.intentType, 'PLUGIN_ANSWER');
    assert.match(String(r.intent.pluginCode || ''), /WRONG_LANGUAGE/, `expected a language refusal, got ${r.intent.pluginCode}`);
    assert.ok(!/Security brief|incidents recorded/.test(r.allValues), 'the English body leaked into the reply');
  } finally { restore(); }
});

/* ── 5. the attach cannot steal a turn the registry already routed ───────── */
test('a routed turn keeps its own engine and never becomes a plugin answer', async () => {
  const calls = fakeAttach('## گزارش\n- وضعیت: خطرناک');
  try {
    const price = await ask('قیمت بیت کوین چقدره');
    assert.equal(price.intentType, 'ASSET_ANALYSIS');
    assert.equal(calls.length, 0, 'a routed turn must not even reach the plugin layer');

    const whatif = await ask('اگر بیت کوین ۲۰ درصد بالا بره چی میشه');
    assert.equal(whatif.intentType, 'WHATIF_SIMULATION');
    assert.ok(whatif.result.includes('۱۲٬۰۰۰'), `the what-if figure must survive: ${whatif.result}`);
    assert.equal(calls.length, 0);

    const yieldQ = await ask('بهترین بازده استیبل کوین روی آربیتروم چیه');
    assert.notEqual(yieldQ.intentType, 'PLUGIN_ANSWER', 'the registry owns this question; the attach must not take it');
  } finally { restore(); }
});

test('a question no plugin claims still reports WHY, with a quotable code', async () => {
  const r = await ask('کدوم بهتره بیت کوین یا اتریوم');
  assert.equal(r.intent.pluginCode, 'NO_PLUGIN_MATCH');
  assert.notEqual(r.intentType, 'PLUGIN_ANSWER');
});

/* ── 6. the kill switch owns the attach ──────────────────────────────────── */
test('AI_PLUGIN_ATTACH=false removes the chat attach and nothing else', async () => {
  const previous = process.env.AI_PLUGIN_ATTACH;
  process.env.AI_PLUGIN_ATTACH = 'false';
  try {
    assert.equal(attach.attachEnabled(), false);
    const out = await consultPlugins({ message: 'گزارش امنیتی Aave را بده', locale: 'fa', owner: 'x' });
    assert.equal(out.ok, false);
    assert.equal(out.code, 'PLUGIN_ATTACH_DISABLED');
    /* The plugins themselves are still there for the dock: this switch is
       scoped to the chat attach, and `AGENT_HUB_NATIVE_AGENTS` remains the
       owner of the plugins' own existence. */
    assert.equal(NATIVE_AGENTS.length, 11);
  } finally {
    if (previous === undefined) delete process.env.AI_PLUGIN_ATTACH;
    else process.env.AI_PLUGIN_ATTACH = previous;
  }
});

test('an unwired bridge reports a named reason instead of throwing', async () => {
  const dispose = attach.setPluginAttachCache ? null : null;
  void dispose;
  /* The bridge's own three rules: optional provider, named failure, no throw. */
  const bridgeModule = await import(path.join(ROOT, 'server', 'ci', 'pluginBridge.js'));
  const undo = bridgeModule.setPluginProvider(null);
  try {
    const out = await bridgeModule.consultPlugins({ message: 'گزارش امنیتی Aave را بده', locale: 'fa' });
    assert.equal(out.ok, false);
    assert.equal(out.code, 'PLUGIN_PROVIDER_NOT_WIRED');
  } finally { undo(); }
  assert.equal(bridgeModule.hasPluginProvider(), true, 'the composition root wiring must survive the test');
});
