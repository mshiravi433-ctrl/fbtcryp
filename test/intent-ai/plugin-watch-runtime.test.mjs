/**
 * ─── THE PLUGIN THAT SPEAKS FIRST ───────────────────────────────────────────
 *
 * §5.24.15 made the user's choice reach a turn. The gap it left open was the one
 * that separates an agent from a router: nothing was proactive. A plugin
 * answered when asked and never otherwise, so the token risk scanner that
 * already reads GoPlus could not tell its own user that a honeypot flag had
 * appeared since the day they asked about it.
 *
 * What this gate holds down, in the order the defects were found:
 *
 *   1. A WATCH CANNOT DIFF PROSE. The report footer stamps the read time, so the
 *      same verdict reads differently a minute later. Each watchable plugin now
 *      returns a machine-readable `verdict`, and its key is built from CODES:
 *      the same read in Persian and in English must produce the same key, or
 *      arming in one language and reading back in the other would announce a
 *      change in the token that was really a change of language.
 *   2. AN INCOMPLETE READ IS SILENCE, AND IT NEVER MOVES THE BASELINE. Measured,
 *      not assumed: with no egress `token-risk-scanner` answers `ok:true,
 *      dataStatus:'partial'` and its lead reads «پرچم پرخطرِ قطعی دیده نشد».
 *      Arming THAT would make the first real read look like a change in the
 *      token, when the only thing that changed was our own network — a
 *      notification about our egress, addressed to a user as a fact about their
 *      token, is a lie with a push sound.
 *   3. THE SUBJECT MUST SURVIVE THE TRIP BACK THROUGH THE PARSER. A cycle re-runs
 *      a watch by rendering its subject into a sentence; a subject that renders
 *      into a DIFFERENT token would announce a change in something nobody asked
 *      about, with a real number, in the plugin's own name. Refused at arm time.
 *   4. The four rules `server/priceWatch.js` already pays for: the first read
 *      arms and says nothing; a stale baseline re-arms silently; a cooldown and
 *      a baseline move only on a DELIVERED notice, so a failed push is retried
 *      (and bounded) instead of swallowed.
 *   5. The plugin's own caveat survives the body window, the card's colour is
 *      the plugin's own claim, and no notice is written in two languages.
 *   6. The wire is real: the cron route, the daily job registry, the status
 *      surface, three owner routes, the client functions and the offer in the
 *      dock. Defining a hook is not wiring it.
 *
 * Every test runs offline: the real agents are driven through injected data
 * sources, and the cycle through an injected run, so nothing here depends on
 * CoinGecko, GoPlus or DefiLlama answering.
 *
 *   node --test test/intent-ai/plugin-watch-runtime.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/* This gate tests the watcher and the attach it runs through, so it says so: an
   unset flag under NODE_ENV=test means off, which keeps the rest of the suite
   from reaching the public-data sources. */
process.env.AI_PLUGIN_WATCH = 'true';
process.env.AI_PLUGIN_ATTACH = 'true';
process.env.NODE_ENV = 'test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

const { installFakes } = await import(path.join(ROOT, 'test', 'intent-ai', 'ci-fakes.mjs'));
const { setCiSource } = await import(path.join(ROOT, 'server', 'ci', 'sources.js'));
for (const [name, fn] of Object.entries(installFakes())) setCiSource(name, fn);
const { createCentralBrain } = await import(path.join(ROOT, 'server', 'ci', 'brain.js'));
const { createCentralStateStore } = await import(path.join(ROOT, 'server', 'ci', 'stateStore.js'));
const { createFinancialIntelligence } = await import(path.join(ROOT, 'server', 'fios', 'index.js'));
const bridge = await import(path.join(ROOT, 'server', 'ci', 'pluginBridge.js'));
const attach = await import(path.join(ROOT, 'server/agentHub/pluginAttach.js'));
const watch = await import(path.join(ROOT, 'server/agentHub/pluginWatch.js'));
const agents = await import(path.join(ROOT, 'server/agentHub/native/agents.js'));
const dataMod = await import(path.join(ROOT, 'server/agentHub/native/data.js'));

/* The composition root, so the owner store behind «the attachment decides» is
   the real one and not a stub this file invented. */
const stateStore = createCentralStateStore();
const brain = createCentralBrain({ stateStore });
createFinancialIntelligence({ stateStore, brain, ownerFor: (o) => o, log: () => {} });

const ADDR = '0x1111111111111111111111111111111111111111';
const ADDR2 = '0x2222222222222222222222222222222222222222';
const IDENTITY = `fcm:${'a'.repeat(60)}`;
const T0 = Date.now();
const hours = (h) => T0 + h * 3600000;

/* ── the sources, injected ───────────────────────────────────────────────────
   `withDeadline` is what adds the `{ ok, value }` envelope, so an injected
   reader returns the RAW payload and reports a failure the way a real reader
   does — by throwing. Wrapping a fake in `{ok:true, value:…}` double-wraps it
   and every agent sees a source that answered with nothing, which is exactly
   the wrong thing for a gate about incomplete reads to be accidentally testing. */
const boom = (code) => async () => { throw new Error(code); };
const GOPLUS_DANGER = {
  honeypot: true, cannotSell: false, mintable: true, pausable: false, blacklist: false,
  proxy: false, hiddenOwner: false, ownerChangeBalance: false, openSource: true,
  buyTax: 2, sellTax: 3, lpLocked: true, top10Share: 0.4, holderCount: 1200, liquidityUsd: 250000
};
const GOPLUS_CLEAN = { ...GOPLUS_DANGER, honeypot: false, mintable: false };
const INTEL = {
  symbol: 'TST', dataStatus: 'live', priceUsd: 1.2, liquidityUsd: 250000,
  volume: { h24: 90000 }, txns: { buys24: 40, sells24: 12 }, netFlowUsd: 42000,
  ageMs: 40 * 86400000,
  holders: { total: 1200, top10Share: 40, whaleConcentration: 'MEDIUM', exchangeSupplyPct: 12, dataStatus: 'live' },
  accumulation: { detected: true, confidence: 62 }, distribution: { detected: false }, risk: 'MEDIUM'
};
const PROTOCOLS = [{ name: 'Aave', slug: 'aave', tvl: 1.2e10, category: 'lending', change_1d: 1.1, change_7d: 4.4, chains: ['Ethereum'], listedAt: 1600000000, audits: 2, audit_links: [] }];
const PROTOCOL_DETAIL = { tvl: 1.2e10, category: 'lending', chains: ['Ethereum'], audits: 2, auditLinks: ['https://example.com/a.pdf'], change_1d: 1.1, change_7d: 4.4 };
const INCIDENTS_ONE = [{ protocol: 'Aave', dateLabel: '2026-09-30', amountUsd: 1.6e6, category: 'exploit', link: 'https://example.com/i' }];
const POOLS = (apy) => ({ pools: [{ project: 'aave-v3', symbol: 'USDC', chain: 'Ethereum', apy, apyBase: apy - 1, apyReward: 1, tvlUsd: 4e8, stablecoin: true, url: 'https://defillama.com/pool/1' }] });
const WALLET = (topUsd) => ({ address: ADDR, dataStatus: 'live', ageMs: 900 * 86400000, txCount: 420, portfolioUsd: 10000, holdings: [{ symbol: 'PEPE', valueUsd: topUsd }, { symbol: 'ETH', valueUsd: 10000 - topUsd }], risk: {} });

const withData = (overrides) => dataMod.createDataAccess(overrides);
const runAgent = (slug, text, overrides) => agents.runNativeAgent(slug, { text, context: { owner: 'gate', locale: 'fa' } }, withData(overrides), { now: () => T0 });

const scannerData = (report) => ({
  tokenIntel: async () => INTEL,
  /* No report means the scanner did not answer — a throw, which is what an
     unreachable GoPlus actually does. */
  tokenRisk: async () => { if (!report) throw new Error('GOPLUS_TIMEOUT'); return { report }; }
});

/* ── 1. the catalog declares what can be watched, and on what ─────────────── */
test('exactly five plugins declare a watch, and the declaration says what may trigger it', () => {
  const watchable = agents.NATIVE_AGENTS.filter((a) => a.watch);
  assert.deepEqual(watchable.map((a) => a.slug).sort(), [
    'lending-risk-agent', 'protocol-security-brief', 'smart-money-tracker',
    'token-risk-scanner', 'wallet-exposure-auditor'
  ]);
  for (const a of watchable) {
    assert.ok(['address', 'protocol'].includes(a.watch.subject), `${a.slug}: a watch needs a subject it can re-read`);
    assert.ok(a.watch.datum && a.watch.datumFa && a.watch.datumEn, `${a.slug}: the datum is named in the code and in both languages`);
    assert.ok(/^(key|metric|key\|metric)$/.test(a.watch.fires), `${a.slug}: what may trigger is declared, not implied`);
    if (a.watch.fires.includes('metric')) {
      assert.ok(a.watch.thresholdPct && a.watch.thresholdPct.min > 0 && a.watch.thresholdPct.default >= a.watch.thresholdPct.min,
        `${a.slug}: a metric trigger needs a bound so a wobble is not a change`);
    }
  }
  /* A plugin with no declaration is not watchable and says so — the alternative
     is a watch that is armed and can never fire. */
  const quote = agents.NATIVE_AGENTS.find((a) => a.slug === 'cross-chain-swap-assistant');
  assert.equal(quote.watch, undefined, 'a bridge quote has nothing stable to watch');
});

/* ── 2. the datum is a code, not a sentence ───────────────────────────────── */
test('a complete read carries a machine-readable verdict, and the same read in another language carries the same key', async () => {
  const fa = await runAgent('token-risk-scanner', `آیا این توکن هانی‌پات است ${ADDR} روی base`, scannerData(GOPLUS_DANGER));
  const en = await runAgent('token-risk-scanner', `is this token a honeypot ${ADDR} on base`, scannerData(GOPLUS_DANGER));
  assert.equal(fa.ok, true);
  assert.equal(en.ok, true);
  assert.equal(fa.dataStatus, 'live', 'both sources answered, so the read is complete');
  assert.equal(fa.verdict.level, 'danger');
  assert.equal(fa.verdict.complete, true);
  assert.equal(fa.verdict.metric, 2, 'honeypot and mintable are the two flags that are bad');
  /* THE POINT OF THE WHOLE DESIGN: the key is built from codes, so the language
     the question was asked in cannot change what the watcher compares. */
  assert.equal(fa.verdict.key, en.verdict.key, 'the verdict key must not depend on the language of the question');
  assert.equal(fa.verdict.key, 'honeypot|mintable');
  assert.notEqual(fa.text, en.text, 'the prose is still localised — only the key is not');
  assert.ok(/هانی‌پات/.test(fa.text) && !/هانی‌پات/.test(en.text));
  /* A clean read is a different key, and it is a claim the plugin can make. */
  const clean = await runAgent('token-risk-scanner', `بررسی آدرس ${ADDR} روی base`, scannerData(GOPLUS_CLEAN));
  assert.equal(clean.verdict.level, 'clear');
  assert.equal(clean.verdict.key, 'no-high-flag');
  assert.ok(clean.verdict.noteFa.includes('نه این‌که توکن امن است'), 'a clean scan carries its own limit');
});

test('a read whose source did not answer carries no level at all', async () => {
  const out = await runAgent('token-risk-scanner', `بررسی آدرس ${ADDR} روی base`, scannerData(null));
  /* This is the run measured with no egress: the plugin still answers, and it
     says «پرچم پرخطرِ قطعی دیده نشد» — which is why the verdict, not the text,
     is what a watcher may act on. */
  assert.equal(out.ok, true);
  assert.equal(out.dataStatus, 'partial');
  assert.equal(out.verdict.complete, false);
  assert.equal(out.verdict.level, 'unknown', 'an incomplete read makes no claim');
  assert.equal(out.verdict.key, null);
  assert.equal(out.verdict.metric, null, 'and publishes no number');
  assert.ok(/پرچم پرخطرِ قطعی دیده نشد/.test(out.text), 'the turn still tells the user what was not seen');
});

test('an unread incident feed makes the protocol brief partial, not live', async () => {
  const base = { protocols: async () => PROTOCOLS, protocolDetail: async () => PROTOCOL_DETAIL };
  const read = await runAgent('protocol-security-brief', 'گزارش امنیتی پروتکل Aave را بده', { ...base, incidents: async () => INCIDENTS_ONE });
  assert.equal(read.dataStatus, 'live');
  assert.equal(read.verdict.complete, true);
  assert.equal(read.verdict.level, 'warn');
  assert.equal(read.verdict.metric, 1);
  assert.ok(read.verdict.key.startsWith('1|'), 'the key is the SET of incidents, not the feed order');

  const unread = await runAgent('protocol-security-brief', 'گزارش امنیتی پروتکل Aave را بده', { ...base, incidents: boom('TIMEOUT') });
  /* The body says «فید حادثه‌ها خوانده نشد». `dataStatus:'live'` beside that
     sentence was one object holding two truths. */
  assert.equal(unread.dataStatus, 'partial');
  assert.equal(unread.verdict.complete, false);
  assert.equal(unread.verdict.level, 'unknown');
  assert.ok(/خوانده نشد/.test(unread.text));

  const none = await runAgent('protocol-security-brief', 'گزارش امنیتی پروتکل Aave را بده', { ...base, incidents: async () => [] });
  assert.equal(none.verdict.level, 'clear');
  assert.ok(none.verdict.noteFa.includes('اثباتِ نبودِ حادثه نیست'), '“no record” keeps its own limit');
});

test('a rate is a number and makes no safety claim', async () => {
  const out = await runAgent('lending-risk-agent', 'نرخ تأمین پروتکل Aave چقدر است', { yields: async () => POOLS(4.2), incidents: async () => [] });
  assert.equal(out.verdict.level, 'info', 'an APY is not a verdict about safety');
  assert.equal(out.verdict.unit, '%');
  assert.equal(out.verdict.metric, 4.2);
  assert.equal(out.verdict.complete, true);
  const spec = agents.NATIVE_AGENTS.find((a) => a.slug === 'lending-risk-agent').watch;
  assert.equal(spec.fires, 'metric', 'only a move is worth announcing, not a re-reading of the same rate');
  assert.ok(out.verdict.noteFa.includes('گذشته‌نگر'), 'a backward-looking number says so');
});

test('the wallet verdict rounds its share, so a wobble is not a change in anybody’s wallet', async () => {
  const overrides = { walletIntel: async () => WALLET(7100) };
  const a = await runAgent('wallet-exposure-auditor', `مواجههٔ کیف‌پول ${ADDR} را بررسی کن`, overrides);
  assert.equal(a.verdict.level, 'warn', '71 % in one asset is high concentration');
  assert.equal(a.verdict.key, 'PEPE|71');
  assert.equal(a.verdict.metric, 10000);
  /* A 4-dollar move on a 10 000-dollar wallet is a rounding artefact. */
  const b = await runAgent('wallet-exposure-auditor', `مواجههٔ کیف‌پول ${ADDR} را بررسی کن`, { walletIntel: async () => WALLET(7104) });
  assert.equal(b.verdict.key, a.verdict.key, 'the same concentration must not announce itself twice');
});

test('a run carries the verdict, the declaration and the SUBJECT it actually read', async () => {
  const out = await runAgent('token-risk-scanner', `بررسی آدرس ${ADDR} روی base`, scannerData(GOPLUS_CLEAN));
  assert.equal(out.data.verdict.level, 'clear');
  assert.equal(out.data.watch.datum, 'contract-risk-flags');
  assert.deepEqual(out.data.subject, { kind: 'address', value: ADDR, chain: '8453' });
  /* And a plugin with no declaration carries no subject: the offer in the dock
     renders from these two, so it cannot appear where there is nothing to arm. */
  /* Every reader throws, so this test cannot reach CoinGecko even in CI, where
     egress exists and a real read would make the assertion depend on the network. */
  const plain = await runAgent('ai-trading-analyst', 'بیت کوین را تحلیل کن', {
    searchCoins: boom('OFFLINE'), coinDetail: boom('OFFLINE'), candles: boom('OFFLINE')
  });
  assert.equal(plain.data.watch, null);
  assert.equal(plain.data.subject, null);
});

/* ── 3. the subject must survive the trip back through the parser ─────────── */
test('every declared subject survives the trip back through the parser', () => {
  const cases = [
    [{ kind: 'address', value: ADDR, chain: '8453' }, 'fa'],
    [{ kind: 'address', value: ADDR, chain: '8453' }, 'en'],
    [{ kind: 'address', value: ADDR, chain: null }, 'fa'],
    [{ kind: 'address', value: ADDR, chain: 'solana' }, 'fa'],
    [{ kind: 'protocol', value: 'Aave', chain: null }, 'fa'],
    [{ kind: 'protocol', value: 'Aave', chain: null }, 'en']
  ];
  for (const [subject, locale] of cases) {
    const message = agents.subjectToMessage(subject, locale);
    assert.ok(message, `${JSON.stringify(subject)}/${locale} must render`);
    const back = dataMod.extractRequest(message);
    assert.equal(agents.subjectRoundTrips(subject, back), true,
      `${JSON.stringify(subject)} rendered as «${message}» and came back as ${JSON.stringify({ address: back.address, chainId: back.chainId, protocolQuery: back.protocolQuery })}`);
  }
  /* The chain word is the parser's own key, not the display label: a rendered
     «بیس» would silently re-read the default chain instead of Base. */
  assert.equal(agents.chainNameFor('8453'), 'base');
  assert.equal(agents.chainNameFor('999'), null, 'a chain we cannot name is a chain we cannot re-read');
});

/* ── 4. arming ────────────────────────────────────────────────────────────── */
test('arming refuses what it cannot watch, cannot name, cannot deliver to, or has too many of', async () => {
  await watch.clearPluginWatches();
  const addr = { kind: 'address', value: ADDR, chain: '8453' };
  const ok = await watch.putPluginWatch({ owner: 'gate-a', identity: IDENTITY, agentId: 'fbt-native:token-risk-scanner', subject: addr });
  assert.equal(ok.ok, true);
  assert.equal(ok.durable, false, 'with no blob token the store is per-instance, and the response says so');
  assert.equal(ok.watch.armed, false, 'a fresh watch has read nothing yet, so it is not armed');

  const cases = [
    ['a device that cannot receive a push', { owner: 'gate-a', identity: 'not-an-endpoint', agentId: 'fbt-native:token-risk-scanner', subject: addr }, 'BAD_IDENTITY'],
    ['a plugin that answers but holds nothing stable', { owner: 'gate-a', identity: IDENTITY, agentId: 'fbt-native:ai-trading-analyst', subject: addr }, 'PLUGIN_NOT_WATCHABLE'],
    ['a plugin that is not ours', { owner: 'gate-a', identity: IDENTITY, agentId: 'fbt-native:no-such-plugin', subject: addr }, 'PLUGIN_NOT_IN_CATALOG'],
    ['a subject of the wrong kind', { owner: 'gate-a', identity: IDENTITY, agentId: 'fbt-native:token-risk-scanner', subject: { kind: 'protocol', value: 'Aave' } }, 'BAD_SUBJECT'],
    ['a subject with no value', { owner: 'gate-a', identity: IDENTITY, agentId: 'fbt-native:token-risk-scanner', subject: { kind: 'address', value: '' } }, 'BAD_SUBJECT'],
    ['a malformed address', { owner: 'gate-a', identity: IDENTITY, agentId: 'fbt-native:token-risk-scanner', subject: { kind: 'address', value: '0x123', chain: '8453' } }, 'BAD_SUBJECT'],
    ['a chain that cannot be named back', { owner: 'gate-a', identity: IDENTITY, agentId: 'fbt-native:token-risk-scanner', subject: { kind: 'address', value: ADDR, chain: '999' } }, 'SUBJECT_NOT_RENDERABLE'],
    ['no choice stated and nothing attached', { owner: 'gate-nobody', identity: IDENTITY, subject: { kind: 'protocol', value: 'Aave' } }, 'NO_PLUGIN_CHOICE']
  ];
  for (const [label, args, code] of cases) {
    const out = await watch.putPluginWatch(args);
    assert.equal(out.ok, false, label);
    assert.equal(out.code, code, `${label} → ${out.code}`);
  }

  /* An address that looks base58 but is not one: `normalizeSubject` accepts the
     shape, and only the round trip catches it. This is the refusal that stops a
     watch from re-reading a token nobody named. */
  const lookalike = await watch.putPluginWatch({ owner: 'gate-a', identity: IDENTITY, agentId: 'fbt-native:token-risk-scanner', subject: { kind: 'address', value: '1'.repeat(32), chain: null } });
  assert.equal(lookalike.ok, false);
  assert.equal(lookalike.code, 'SUBJECT_DOES_NOT_ROUND_TRIP');

  /* The cap: three per owner, so one person cannot fill the store or the cycle. */
  await watch.putPluginWatch({ owner: 'gate-a', identity: IDENTITY, agentId: 'fbt-native:wallet-exposure-auditor', subject: addr });
  await watch.putPluginWatch({ owner: 'gate-a', identity: IDENTITY, agentId: 'fbt-native:smart-money-tracker', subject: { kind: 'address', value: ADDR2, chain: '8453' } });
  const fourth = await watch.putPluginWatch({ owner: 'gate-a', identity: IDENTITY, agentId: 'fbt-native:lending-risk-agent', subject: { kind: 'protocol', value: 'Aave' } });
  assert.equal(fourth.ok, false);
  assert.equal(fourth.code, 'TOO_MANY_WATCHES');
  assert.equal(fourth.cap, 3);
});

test('arming the same subject twice is one row, and the baseline survives the re-arm', async () => {
  await watch.clearPluginWatches();
  const subject = { kind: 'address', value: ADDR, chain: '8453' };
  const arm = () => watch.putPluginWatch({ owner: 'gate-b', identity: IDENTITY, agentId: 'fbt-native:token-risk-scanner', subject });
  assert.equal((await arm()).ok, true);
  /* One complete read arms the baseline. */
  const verdict = { level: 'clear', key: 'no-high-flag', metric: 0, unit: 'flags', complete: true };
  await watch.runPluginWatchCycle(async () => false, T0, { run: async () => ({ ok: true, verdict }) });
  await arm();
  const list = await watch.listPluginWatches({ owner: 'gate-b' });
  assert.equal(list.watches.length, 1, 'a re-arm replaces, it does not append');
  assert.equal(list.watches[0].armed, true, 'and it must not reset what the watcher learned');
  assert.equal(list.watches[0].baseline.key, 'no-high-flag');
});

test('with no agentId, the owner’s own attachment decides', async () => {
  await watch.clearPluginWatches();
  const attached = await bridge.attachPluginForOwner('gate-c', 'fbt-native:protocol-security-brief');
  assert.equal(attached.ok, true, 'the composition root wires the owner store');
  const out = await watch.putPluginWatch({ owner: 'gate-c', identity: IDENTITY, subject: { kind: 'protocol', value: 'Aave' } });
  assert.equal(out.ok, true);
  assert.equal(out.watch.slug, 'protocol-security-brief');
  assert.equal(out.watch.armedBy, 'owner-choice', 'the watch is on the plugin the person chose, not on a guess');
});

test('one owner’s watches are invisible to another', async () => {
  const mine = await watch.listPluginWatches({ owner: 'gate-c' });
  const theirs = await watch.listPluginWatches({ owner: 'gate-d' });
  assert.equal(mine.watches.length, 1);
  assert.equal(theirs.watches.length, 0);
  const stopped = await watch.stopPluginWatch({ owner: 'gate-d' });
  assert.equal(stopped.ok, true, 'stopping nothing is not an error');
  assert.equal(stopped.removed, 0);
  assert.equal((await watch.listPluginWatches({ owner: 'gate-c' })).watches.length, 1, 'and it removed nothing of anybody else’s');
  /* The push endpoint is a credential: the projection a user sees never carries it. */
  assert.equal(JSON.stringify(mine.watches[0]).includes('fcm:'), false);
});

/* ── 5. the cycle and its four rules ──────────────────────────────────────── */
const V = (level, key, metric, unit, complete = true, noteFa = null) => ({ ok: true, verdict: { level, key, metric, unit, complete, noteFa } });

test('the first complete read arms the baseline and says nothing', async () => {
  await watch.clearPluginWatches();
  await watch.putPluginWatch({ owner: 'cycle-1', identity: IDENTITY, agentId: 'fbt-native:token-risk-scanner', subject: { kind: 'address', value: ADDR, chain: '8453' } });
  const sent = [];
  const out = await watch.runPluginWatchCycle(async (i, a) => { sent.push(a); return true; }, T0, { run: async () => V('clear', 'no-high-flag', 0, 'flags') });
  assert.deepEqual({ ran: out.ran, fired: out.fired, delivered: out.delivered }, { ran: 1, fired: 0, delivered: 0 });
  assert.equal(sent.length, 0, 'nobody asked to be told the world is the way it already was');
  const row = (await watch.listPluginWatches({ owner: 'cycle-1' })).watches[0];
  assert.equal(row.armed, true);
  assert.equal(row.baseline.key, 'no-high-flag');
});

test('a changed verdict fires once, and the card’s colour is the plugin’s own claim', async () => {
  const sent = [];
  const send = async (identity, alert) => { sent.push({ identity, alert }); return true; };
  const run = async () => V('danger', 'honeypot|mintable', 2, 'flags');
  const out = await watch.runPluginWatchCycle(send, hours(7), { run });
  assert.deepEqual({ fired: out.fired, delivered: out.delivered }, { fired: 1, delivered: 1 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].identity, IDENTITY, 'it goes to the device that armed it');
  const alert = sent[0].alert;
  assert.equal(alert.tone, 'alert', 'a danger verdict earns the alarm colour, not a neutral one');
  assert.equal(alert.title, 'اسکنر ریسک توکن · پرچم‌های ریسک قرارداد');
  assert.ok(alert.body.includes('«پاک»') && alert.body.includes('«پرخطر»'), `the sentence owns the direction: ${alert.body}`);
  assert.ok(alert.body.includes('۰') && alert.body.includes('۲'), 'and quotes the numbers it moved between');
  assert.equal(alert.requireInteraction, true, 'a high-risk card must not slide away in four seconds');
  assert.equal(alert.url, '/#/intent', 'the app is a HashRouter, so a bare path would open nothing');
  assert.equal(alert.data.slug, 'token-risk-scanner');
  /* The same verdict again is not news, and the cooldown says so. */
  const again = await watch.runPluginWatchCycle(send, hours(8), { run });
  assert.deepEqual({ due: again.due, ran: again.ran, fired: again.fired }, { due: 0, ran: 0, fired: 0 });
});

test('an incomplete read is silence and does not move the baseline', async () => {
  const sent = [];
  const run = async () => V('clear', 'no-high-flag', 0, 'flags', false);
  /* Outside the 12 h cooldown of the notice delivered at +7 h. */
  const out = await watch.runPluginWatchCycle(async (i, a) => { sent.push(a); return true; }, hours(20), { run });
  assert.deepEqual({ ran: out.ran, fired: out.fired, delivered: out.delivered, incomplete: out.incomplete }, { ran: 1, fired: 0, delivered: 0, incomplete: 1 });
  assert.equal(sent.length, 0, 'a notification about our own network would be a lie about the token');
  const row = (await watch.listPluginWatches({ owner: 'cycle-1' })).watches[0];
  assert.equal(row.baseline.key, 'honeypot|mintable', 'the danger it last delivered is still what it compares against');
  assert.equal(row.baseline.level, 'danger');
  assert.equal(row.lastSkip, 'INCOMPLETE_READ', 'and the silence is diagnosable from outside');
});

test('a notice that could not be delivered is retried next cycle, and the retries are bounded', async () => {
  await watch.clearPluginWatches();
  await watch.putPluginWatch({ owner: 'cycle-2', identity: IDENTITY, agentId: 'fbt-native:token-risk-scanner', subject: { kind: 'address', value: ADDR, chain: '8453' } });
  let mode = 'clear';
  const run = async () => (mode === 'clear' ? V('clear', 'no-high-flag', 0, 'flags') : V('danger', 'honeypot', 1, 'flags'));
  await watch.runPluginWatchCycle(async () => true, T0, { run });
  mode = 'danger';
  const first = await watch.runPluginWatchCycle(async () => false, hours(7), { run });
  assert.deepEqual({ fired: first.fired, delivered: first.delivered }, { fired: 1, delivered: 0 });
  /* Not six hours later: the fact is already known and the phone was the only
     thing that failed. */
  const retry = await watch.runPluginWatchCycle(async () => false, hours(7) + 60000, { run });
  assert.deepEqual({ fired: retry.fired, delivered: retry.delivered }, { fired: 1, delivered: 0 }, 'a failed push is retried by the next cycle');
  const row = (await watch.listPluginWatches({ owner: 'cycle-2' })).watches[0];
  assert.equal(row.retrying, true);
  const giveUp = await watch.runPluginWatchCycle(async () => false, hours(7) + 120000, { run });
  assert.equal(giveUp.fired, 1, 'the third attempt still tries');
  const after = (await watch.listPluginWatches({ owner: 'cycle-2' })).watches[0];
  assert.equal(after.retrying, false, 'and then stops: a subscription whose app was uninstalled fails forever');
  assert.equal(after.lastSkip, 'DELIVERY_FAILED');
  assert.equal(after.baseline.key, 'honeypot', 'so it does not pay for a plugin read every cycle to reach a dead device');
});

test('the run cap bounds one cycle and reports what it left behind', async () => {
  await watch.clearPluginWatches();
  const rows = [[0, 'token-risk-scanner'], [1, 'wallet-exposure-auditor'], [2, 'smart-money-tracker']];
  for (const [i, slug] of rows) {
    await watch.putPluginWatch({ owner: `cap-${i}`, identity: IDENTITY, agentId: `fbt-native:${slug}`, subject: { kind: 'address', value: i === 2 ? ADDR2 : ADDR, chain: '8453' } });
  }
  let runs = 0;
  const out = await watch.runPluginWatchCycle(async () => true, T0, { run: async () => { runs += 1; return V('clear', 'x', 0, 'flags'); } });
  assert.equal(out.checked, 3);
  assert.equal(out.due, 3);
  assert.equal(runs, 2, `at most MAX_RUNS_PER_CYCLE plugin runs, got ${runs}`);
  assert.equal(out.remainingDue, 1, 'and the cap is reported, not hidden');
  const status = await watch.pluginWatchStatus();
  assert.equal(status.rows, 3);
  assert.equal(status.runsPerCycle, 2);
  assert.ok(status.worstCaseRecheckMs >= status.recheckMinMs, 'the real cadence of one row is published, so nobody assumes it');
});

test('the plugin’s own caveat survives the body window', async () => {
  const caveat = 'حادثه‌ای با این نام در فید DefiLlama ثبت نشده است؛ نبودِ رکورد، اثباتِ نبودِ حادثه نیست.';
  const alert = watch.buildPluginWatchAlert({
    slug: 'protocol-security-brief', name: 'Protocol Security Brief', nameFa: 'گزارش امنیتی پروتکل',
    datum: 'incident-record', datumFa: 'سابقهٔ حادثه', datumEn: 'incident record',
    subject: { kind: 'protocol', value: 'Aave', chain: null },
    verdict: { level: 'warn', key: '1|2026-09-30', metric: 1, unit: 'incidents', complete: true, noteFa: caveat },
    previous: { key: '0|', level: 'clear', metric: 0, unit: 'incidents', seen: T0 },
    reason: 'key', lang: 'fa'
  });
  assert.ok(alert.body.length <= 180, `the body fits the window it is cut at: ${alert.body.length}`);
  assert.ok(alert.body.includes('اثباتِ نبودِ حادثه نیست'), `the limit of the fact survives: ${alert.body}`);
  assert.equal(alert.data.caveat, true, 'and the payload says whether it made it in');
  /* A number that is really an absence never reaches a lock screen. */
  const noMove = watch.buildPluginWatchAlert({
    slug: 'lending-risk-agent', nameFa: 'ایجنت ریسک وام‌دهی', datum: 'supply-apy', datumFa: 'نرخ تأمین', datumEn: 'supply rate',
    subject: { kind: 'protocol', value: 'Aave', chain: null },
    verdict: { level: 'info', key: 'k', metric: 5, unit: '%', complete: true },
    previous: { key: 'k', level: 'info', metric: 4, unit: '%', seen: T0 }, reason: 'metric', movePct: null, lang: 'fa'
  });
  assert.equal(/NaN/.test(noMove.body), false, noMove.body);
});

test('a notice is never written in two languages', () => {
  const common = {
    slug: 'wallet-exposure-auditor', name: 'Wallet Exposure Auditor', nameFa: 'ممیزی مواجههٔ کیف‌پول',
    datum: 'wallet-exposure', datumFa: 'مواجهه و تمرکز کیف‌پول', datumEn: 'wallet exposure',
    subject: { kind: 'address', value: ADDR2, chain: '1' },
    verdict: { level: 'warn', key: 'PEPE|71', metric: 9000, unit: 'usd', complete: true, noteFa: 'ارزشِ دیده‌شده فقط دارایی‌های قیمت‌خوردهٔ همین زنجیره است.', noteEn: 'Visible value covers only the priced holdings on this chain.' },
    previous: { key: 'PEPE|52', level: 'clear', metric: 9100, unit: 'usd', seen: T0 },
    reason: 'key'
  };
  const fa = watch.buildPluginWatchAlert({ ...common, lang: 'fa' });
  const en = watch.buildPluginWatchAlert({ ...common, lang: 'en' });
  const persian = /[\u0600-\u06FF]/;
  assert.ok(persian.test(fa.title) && persian.test(fa.body), 'the Persian card is Persian');
  assert.equal(persian.test(en.title), false, `an English card must not carry a Persian phrase: ${en.title}`);
  assert.equal(persian.test(en.body), false, en.body);
  /* A missing translation falls back to the machine slug, never to the other
     language: an identifier is honest, a mixed sentence is not. */
  const noEn = watch.buildPluginWatchAlert({ ...common, datumEn: '', lang: 'en' });
  assert.equal(persian.test(noEn.title), false, noEn.title);
});

test('the kill switches are separate and each says which one stopped it', async () => {
  const off = await watch.runPluginWatchCycle(async () => true, T0, { env: { AI_PLUGIN_WATCH: 'false', NODE_ENV: 'test' }, run: async () => V('danger', 'x', 1, 'flags') });
  assert.equal(off.skipped, 'PLUGIN_WATCH_DISABLED');
  assert.equal(off.delivered, 0);
  /* The watcher runs through the attach, so an off attach is not reported as
     “nothing was armed”. */
  const noAttach = await watch.runPluginWatchCycle(async () => true, T0, { env: { AI_PLUGIN_WATCH: 'true', AI_PLUGIN_ATTACH: 'false', NODE_ENV: 'test' }, run: async () => V('danger', 'x', 1, 'flags') });
  assert.equal(noAttach.skipped, 'PLUGIN_ATTACH_DISABLED');
  assert.equal(noAttach.delivered, 0);
  /* And an unset flag under test means off, so the suite never reaches GoPlus. */
  assert.equal(watch.watchEnabled({ NODE_ENV: 'test' }), false);
  assert.equal(watch.watchEnabled({ NODE_ENV: 'test', AI_PLUGIN_WATCH: 'true' }), true);
  assert.equal(watch.watchEnabled({ NODE_ENV: 'production' }), true);
});

test('the real plugin layer, reading nothing, arms nothing and sends nothing', async () => {
  await watch.clearPluginWatches();
  const armed = await watch.putPluginWatch({ owner: 'real-1', identity: IDENTITY, agentId: 'fbt-native:token-risk-scanner', subject: { kind: 'address', value: ADDR, chain: '8453' } });
  assert.equal(armed.ok, true);
  /* No injected run: this goes through `attachPluginAnswer` into the real agent.
     A fake catalog is installed so the run is deterministic and offline, and it
     reports the thing that matters — a source that did not answer. */
  attach.setPluginAttachCache({
    /* A function, because `attachPluginAnswer` CALLS it (`mod.nativeEnabled()`)
       outside its own try: a boolean here throws out of the provider and the
       cycle would report a crash instead of a source that did not answer. */
    nativeEnabled: () => true,
    catalog: agents.NATIVE_AGENTS,
    data: dataMod.createDataAccess(scannerData(null)),
    runNativeAgent: (slug, input, data, opts) => agents.runNativeAgent(slug, input, data, opts)
  });
  try {
    const sent = [];
    const out = await watch.runPluginWatchCycle(async (i, a) => { sent.push(a); return true; }, T0, {});
    assert.equal(out.ran, 1);
    assert.equal(out.incomplete, 1);
    assert.equal(out.delivered, 0);
    assert.equal(sent.length, 0);
    const row = (await watch.listPluginWatches({ owner: 'real-1' })).watches[0];
    assert.equal(row.armed, false, 'a partial read did not arm a baseline');
    assert.equal(row.lastSkip, 'INCOMPLETE_READ');
  } finally {
    attach.resetPluginAttachCache();
  }
});

/* ── 6. the wire ──────────────────────────────────────────────────────────── */
test('the watcher is on the wire a user can actually be reached by', () => {
  const app = read('server/app.js');
  assert.ok(app.includes("from './agentHub/pluginWatch.js'"), 'app.js imports the watcher');
  const cronRoute = app.slice(app.indexOf("app.get('/api/cron/watch'"), app.indexOf("app.all('/api/cron/tick'"));
  assert.ok(cronRoute.includes('maybePluginWatchTick({ send: deliverStagePush })'), 'the 20-minute cron route runs the cycle through the real push transport');
  assert.ok(!app.slice(app.indexOf("app.all('/api/cron/tick'"), app.indexOf("app.all('/api/cron/tick'") + 1600).includes('maybePluginWatchTick'),
    'and NOT the foreground tick: a plugin read must not be charged to a person using the site');
  const jobs = app.slice(app.indexOf('const DAILY_JOBS = ['), app.indexOf('const DAILY_JOBS = [') + 4000);
  assert.ok(jobs.includes("name: 'plugin-watch'"), 'the daily job registry has it, so its own cost is visible');
  assert.ok(app.includes('pluginWatch: await pluginWatchStatus()'), 'the status surface reports it instead of Boolean(engine)');

  const api = read('server/ci/api.js');
  for (const route of ["router.post('/plugins/watch'", "router.get('/plugins/watches'", "router.post('/plugins/watch/stop'"]) {
    assert.ok(api.includes(route), `the owner route ${route} exists`);
  }
  assert.ok(api.includes("import('../agentHub/pluginWatch.js')") && !api.includes("from '../agentHub/pluginWatch.js'"),
    'the routes load the watcher lazily, so a brain-only gate does not pull the push transport in');

  const client = read('src/lib/central/client.js');
  for (const fn of ['export async function armPluginWatch', 'export const listPluginWatches', 'export const stopPluginWatch']) {
    assert.ok(client.includes(fn), `the client exposes ${fn}`);
  }
  assert.ok(client.includes("await import('../notify.js')"), 'the push identity is imported lazily, keeping it off the first-paint graph');

  const dock = read('src/components/AgentHub/AgentChatDock.jsx');
  assert.ok(dock.includes('function WatchOffer'), 'the dock has the offer');
  assert.ok(dock.includes('<WatchOffer data={message.task.result.data}'), 'and renders it on a plugin answer');
  assert.ok(dock.includes('armPluginWatch') && dock.includes('stopPluginWatch'), 'wired to the client functions');
  assert.ok(read('src/styles/agent-hub.css').includes('.agentchat-watch-button'), 'styled beside the button it sits next to');
});
