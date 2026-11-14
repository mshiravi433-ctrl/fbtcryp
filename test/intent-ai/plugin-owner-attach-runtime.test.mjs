/**
 * ─── THE USER'S SIDE OF THE CONNECTION ─────────────────────────────────────
 *
 * §5.24.14 attached the eleven first-party plugins to a chat turn, but the
 * attachment stopped at the sentence: a plugin was chosen by matching
 * vocabulary, and the person using the product had no say in it. Two gaps, both
 * measured before this change:
 *
 *   · `registerFromCatalog` — the registry's own door for "these are the agents
 *     we vouch for" — had never been fed anything. The reviewed third-party
 *     registry is deliberately empty, so a user's agent list was a list of
 *     nobody, while eleven first-party plugins with named public-data sources
 *     sat outside it with no passport and no trust score.
 *   · The hub's active agent lived in `localStorage` and changed nothing but
 *     the suggestion chips: `readActiveAgent()` had no path to a turn. A person
 *     who picked the token risk scanner and then typed in the main chat was
 *     talking to the generic brain, and a turn from Telegram or a cron had no
 *     idea at all.
 *
 * What this gate holds down:
 *
 *   1. A plugin becomes a registry row with a VERIFIED first-party passport and
 *      `canExecute: false` — and with no invented evidence URI or hash, because
 *      `normalizeEvidence` drops anything without one and fabricating one would
 *      be a lie about an audit that did not happen.
 *   2. Registration is idempotent **by passport id**. The registry mints its own
 *      `agt_<uuid>` row id, so matching on that never matches and every call
 *      re-registers all eleven — resetting the interaction history the trust
 *      score is built from. That was a real defect, found by measuring.
 *   3. The user's stated choice outranks the matcher; the matcher outranks
 *      nothing; and NEITHER outranks the registry — a routed turn never reaches
 *      the plugin layer even with an agent active.
 *   4. A chosen plugin that does not exist is a named failure, never a silent
 *      substitution by another plugin.
 *   5. The whole owner flow stays inside a stated CPU budget, because the
 *      instruction was to measure the cost before deciding to keep anything.
 *
 *   node --test test/intent-ai/plugin-owner-attach-runtime.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/* This gate tests the attach, so it says so: the suite runs with the plugin
   attach off (an unset flag under NODE_ENV=test means off, so no test reaches
   CoinGecko/DefiLlama/GoPlus), and every plugin run below goes through a
   catalog this file installs itself. */
process.env.AI_PLUGIN_ATTACH = 'true';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const { installFakes } = await import(path.join(ROOT, 'test', 'intent-ai', 'ci-fakes.mjs'));
const { setCiSource } = await import(path.join(ROOT, 'server', 'ci', 'sources.js'));
for (const [name, fn] of Object.entries(installFakes())) setCiSource(name, fn);
const { createCentralBrain } = await import(path.join(ROOT, 'server', 'ci', 'brain.js'));
const { createCentralStateStore } = await import(path.join(ROOT, 'server', 'ci', 'stateStore.js'));
const bridge = await import(path.join(ROOT, 'server', 'ci', 'pluginBridge.js'));
const attach = await import(path.join(ROOT, 'server/agentHub/pluginAttach.js'));
const registry = await import(path.join(ROOT, 'server/agentHub/pluginRegistry.js'));
const { passportFromCatalog, evaluateExternalAgentSecurity } = await import(path.join(ROOT, 'src/lib/intent-ai/externalAgentTrust.js'));
const { NATIVE_AGENTS } = await import(path.join(ROOT, 'server/agentHub/native/agents.js'));

const stateStore = createCentralStateStore();
const brain = createCentralBrain({ stateStore });
const { createFinancialIntelligence } = await import(path.join(ROOT, 'server', 'fios', 'index.js'));
const fi = createFinancialIntelligence({ stateStore, brain, ownerFor: (o) => o, log: () => {} });

const now = Date.now();
async function seed(owner) {
  await stateStore.write(owner, 'wallet', { data: { addresses: { evm: ['0x1111111111111111111111111111111111111111'] }, connected: true }, source: 'gate-wallet', status: 'OK', now });
  await stateStore.write(owner, 'portfolio', { data: { holdings: [{ symbol: 'BTC', amount: 0.25, valueUsd: 9000, chainId: 1, priceUsd: 36000 }], totalValueUsd: 9000, dataStatus: 'live' }, source: 'gate-portfolio', status: 'OK', now });
}

/* A catalog of three, so a test can prove WHICH plugin ran without any egress. */
const CAT = [
  { slug: 'token-risk-scanner', name: 'Token Risk Scanner', nameFa: 'اسکنر ریسک توکن', capabilities: ['honeypot'], dataSources: ['GoPlus'] },
  { slug: 'protocol-security-brief', name: 'Protocol Security Brief', nameFa: 'گزارش امنیتی پروتکل', capabilities: ['protocol'], dataSources: ['DefiLlama'] },
  { slug: 'smart-money-tracker', name: 'Smart Money Tracker', nameFa: 'رهیاب پول هوشمند', capabilities: ['whale-flow'], dataSources: ['DexScreener'] }
];
const ran = [];
function installFakeCatalog() {
  ran.length = 0;
  attach.setPluginAttachCache({
    nativeEnabled: () => true,
    catalog: CAT,
    data: {},
    runNativeAgent: async (slug) => {
      ran.push(slug);
      return { ok: true, text: `# گزارش\n- وضعیت: از ${slug} خوانده شد\n- مقدار: ۴۲ واحد`, title: slug, dataStatus: 'live', citations: [] };
    }
  });
  bridge.clearAttachCache();
}
const restoreCatalog = () => { attach.resetPluginAttachCache(); bridge.clearAttachCache(); };

let n = 0;
async function ask(message, opts = {}) {
  const owner = `owner-gate-${n++}`;
  await seed(owner);
  const out = await brain.handle({ owner, message, locale: 'fa', ...opts });
  const res = out?.response ?? {};
  const result = String((res.sections || []).find((s) => s.id === 'result')?.value ?? '');
  return { owner, out, intent: out?.intent ?? {}, intentType: out?.intent?.intentType ?? null, result };
}

/* ── 1. wiring ───────────────────────────────────────────────────────────── */
test('the composition root wires the owner store as well as the provider', () => {
  assert.equal(bridge.hasPluginProvider(), true, 'the plugin provider must be registered');
  assert.equal(bridge.hasPluginAttachStore(), true, 'the per-owner attachment store must be registered');
});

/* ── 2. the plugins become real registry rows ────────────────────────────── */
test('a plugin passport verifies as first-party, claims no execution, and invents no evidence', () => {
  for (const agent of NATIVE_AGENTS) {
    const row = registry.pluginPassportRow(agent, { now });
    const out = passportFromCatalog(row, { now });
    assert.equal(out.ok, true, `${agent.slug}: ${out.code || 'passport rejected'}`);
    assert.equal(out.passport.securityStatus, 'verified', `${agent.slug} must be verified as first-party`);
    assert.equal(out.passport.id, registry.pluginAgentId(agent.slug));
    assert.equal(out.passport.executionPermission, false, 'a plugin may advise; it may not execute');
    assert.equal(out.passport.automaticExecution, false);
    assert.deepEqual(out.passport.verification.evidence, [], 'no fabricated URI or hash may stand in for an audit');
    assert.equal(out.passport.verification.method, 'reviewer_certified');
    assert.ok(out.passport.verification.issuers.includes(registry.FIRST_PARTY_ISSUER));
    const sec = evaluateExternalAgentSecurity(out.passport, { stage: 'analysis', now });
    assert.equal(sec.ok, true, `${agent.slug}: ${(sec.failures || []).map((f) => f.code).join(',')}`);
    /* The trap this asserts against: `finite(null)` is 0, and an explicit
       `expiresAt: null` therefore read as "expired in 1970". */
    assert.equal(out.passport.verificationExpiresAt, null, 'an omitted expiry must stay null, not become 0');
  }
});

test('registering the catalog for an owner is idempotent by PASSPORT id', async () => {
  installFakeCatalog();
  try {
    const owner = `reg-${n++}`;
    const first = await registry.ensurePluginAgents({ agents: fi.agents, owner, catalog: CAT });
    assert.equal(first.ok, true, JSON.stringify(first.failed));
    assert.equal(first.registered.length, CAT.length, 'every plugin becomes a row');
    assert.deepEqual(first.failed, []);

    const second = await registry.ensurePluginAgents({ agents: fi.agents, owner, catalog: CAT });
    assert.deepEqual(second.registered, [], 'a second registration must not re-register');
    assert.equal(second.existing.length, CAT.length, 'it must recognise the rows it already wrote');

    const listed = await fi.agents.list(owner);
    const rows = listed.agents || [];
    assert.equal(rows.length, CAT.length, `expected exactly ${CAT.length} rows, got ${rows.length} — a re-registration would double them`);
    for (const row of rows) {
      assert.equal(row.canExecute, false, 'the registry guarantees this and nothing may lift it');
      assert.ok(Number.isFinite(row.trust?.score), 'every row carries a trust score');
      /* Trust starts below the authorization floor and is EARNED by recorded
         interactions; asserting a high score here would assert a lie. */
      assert.ok(row.trust.score < 70, `a fresh plugin has no reputation yet, got ${row.trust.score}`);
    }
  } finally { restoreCatalog(); }
});

/* ── 3. the owner's choice, and its cost ─────────────────────────────────── */
test('attach, read and detach are one row per owner and never leak between owners', async () => {
  installFakeCatalog();
  try {
    const a = `own-a-${n++}`;
    const b = `own-b-${n++}`;
    const attached = await bridge.attachPluginForOwner(a, 'fbt-native:token-risk-scanner');
    assert.equal(attached.ok, true, attached.code || 'attach failed');
    assert.equal(attached.slug, 'token-risk-scanner');

    assert.equal((await bridge.readAttachedPlugin(a)).slug, 'token-risk-scanner');
    assert.equal((await bridge.readAttachedPlugin(b)).slug, null, "one owner's choice must not become another's");

    /* Replacing the choice, not appending to it: one active agent. */
    const replaced = await bridge.attachPluginForOwner(a, 'fbt-native:smart-money-tracker');
    assert.equal(replaced.slug, 'smart-money-tracker');
    assert.equal((await bridge.readAttachedPlugin(a)).slug, 'smart-money-tracker', 'the cache must not serve the previous choice');

    const detached = await bridge.attachPluginForOwner(a, null);
    assert.equal(detached.ok, true);
    assert.equal((await bridge.readAttachedPlugin(a)).slug, null);
    /* Detaching twice is the same state, not an error. */
    assert.equal((await bridge.attachPluginForOwner(a, null)).ok, true);
  } finally { restoreCatalog(); }
});

test('an id that is not a first-party plugin is refused, including a pasted address', async () => {
  installFakeCatalog();
  try {
    const owner = `own-bad-${n++}`;
    const missing = await bridge.attachPluginForOwner(owner, 'fbt-native:no-such-plugin');
    assert.equal(missing.ok, false);
    assert.equal(missing.code, 'PLUGIN_NOT_IN_CATALOG');
    const address = await bridge.attachPluginForOwner(owner, '0x1111111111111111111111111111111111111111');
    assert.equal(address.ok, false);
    assert.equal(address.code, 'INVALID_AGENT_ID');
    assert.equal(registry.slugFromAgentId('fbt-native:token-risk-scanner'), 'token-risk-scanner');
    assert.equal(registry.slugFromAgentId('fbt-native-token-risk-scanner'), 'token-risk-scanner');
    assert.equal(registry.slugFromAgentId('token-risk-scanner'), 'token-risk-scanner');
    assert.equal(registry.slugFromAgentId('0xdeadbeefdeadbeef'), null, 'a subject is not a plugin name');
    assert.equal((await bridge.readAttachedPlugin(owner)).slug, null, 'a refused attach must not write anything');
  } finally { restoreCatalog(); }
});

test('the owner flow stays inside its CPU budget', async () => {
  installFakeCatalog();
  try {
    const owner = `own-cost-${n++}`;
    const t = async (fn) => { const s = process.hrtime.bigint(); const out = await fn(); return [Number(process.hrtime.bigint() - s) / 1e6, out]; };
    const [listMs, listed] = await t(() => bridge.listPluginsForOwner(owner));
    assert.equal(listed.ok, true);
    assert.equal(listed.plugins.length, CAT.length);
    const [listMs2, listed2] = await t(() => bridge.listPluginsForOwner(owner));
    assert.deepEqual(listed2.registered.added, 0, 'the second listing must not write');
    const [attachMs] = await t(() => bridge.attachPluginForOwner(owner, 'fbt-native:token-risk-scanner'));
    const [readMs] = await t(() => bridge.readAttachedPlugin(owner));
    const [cachedMs] = await t(() => bridge.readAttachedPlugin(owner));
    /* Generous enough for a slow CI machine, tight enough that a per-turn
       storage read or a re-registration on every call would fail. */
    assert.ok(listMs < 400, `the first listing (which registers ${CAT.length} passports) took ${listMs.toFixed(1)} ms`);
    assert.ok(listMs2 < 100, `an idempotent listing took ${listMs2.toFixed(1)} ms`);
    assert.ok(attachMs < 200, `attach took ${attachMs.toFixed(1)} ms`);
    assert.ok(readMs < 50, `the attachment read took ${readMs.toFixed(1)} ms`);
    assert.ok(cachedMs < 5, `a cached attachment read took ${cachedMs.toFixed(1)} ms`);
    assert.ok(listed.plugins.every((p) => p.registryId && p.verified === true), 'every card carries its registry verdict');
  } finally { restoreCatalog(); }
});

/* ── 4. the choice reaches a turn ────────────────────────────────────────── */
test('a turn that names an agent runs THAT plugin, not the one the vocabulary prefers', async () => {
  installFakeCatalog();
  try {
    /* The matcher prefers the security brief for this sentence; the user asked
       for the risk scanner, and a stated preference outranks a guess. */
    assert.equal(attach.matchPlugin('گزارش امنیتی Aave را بده').slug, 'protocol-security-brief');
    const r = await ask('گزارش امنیتی Aave را بده', { agentId: 'fbt-native:token-risk-scanner' });
    assert.equal(r.intentType, 'PLUGIN_ANSWER');
    assert.equal(r.intent.pluginSlug, 'token-risk-scanner');
    assert.equal(r.intent.pluginAttachedBy, 'turn');
    assert.deepEqual(ran, ['token-risk-scanner'], 'only the chosen plugin may run');
    assert.ok(r.result.includes('token-risk-scanner'), `the reply must come from the chosen plugin: ${r.result}`);
  } finally { restoreCatalog(); }
});

test('a turn that names no agent uses the attachment its owner made', async () => {
  installFakeCatalog();
  try {
    const owner = `own-durable-${n++}`;
    await seed(owner);
    await bridge.attachPluginForOwner(owner, 'fbt-native:smart-money-tracker');
    /* A sentence no rule matches and the registry cannot route: without the
       attachment this turn is a refusal. */
    const out = await brain.handle({ owner, message: 'چه خبر از اوضاع', locale: 'fa' });
    assert.equal(out.intent?.intentType, 'PLUGIN_ANSWER');
    assert.equal(out.intent?.pluginSlug, 'smart-money-tracker');
    assert.equal(out.intent?.pluginAttachedBy, 'owner', 'the turn must say the choice came from the owner record');
    assert.deepEqual(ran, ['smart-money-tracker']);
  } finally { restoreCatalog(); }
});

test('a routed turn never reaches the plugin layer, even with an agent active', async () => {
  installFakeCatalog();
  try {
    const owner = `own-routed-${n++}`;
    await seed(owner);
    await bridge.attachPluginForOwner(owner, 'fbt-native:token-risk-scanner');
    const out = await brain.handle({ owner, message: 'قیمت بیت کوین چقدره', locale: 'fa' });
    assert.equal(out.intent?.intentType, 'ASSET_ANALYSIS', 'the registry owns this question');
    assert.deepEqual(ran, [], 'a routed turn must not run a plugin at all');
    /* But the audit fact survives: which agent the user was talking to. */
    assert.equal(out.intent?.turnAgentId || null, null);
    const withId = await brain.handle({ owner: `own-routed2-${n++}`, message: 'قیمت بیت کوین چقدره', locale: 'fa', agentId: 'fbt-native:token-risk-scanner' });
    assert.equal(withId.intent?.intentType, 'ASSET_ANALYSIS');
    assert.equal(withId.intent?.turnAgentId, 'fbt-native:token-risk-scanner', 'the turn records the agent even when no plugin answered');
    assert.deepEqual(ran, []);
  } finally { restoreCatalog(); }
});

test('a chosen plugin that does not exist is named, never substituted', async () => {
  installFakeCatalog();
  try {
    const r = await ask('گزارش امنیتی Aave را بده', { agentId: 'fbt-native:no-such-plugin' });
    assert.equal(r.intent.pluginCode, 'PLUGIN_NOT_IN_CATALOG');
    assert.notEqual(r.intentType, 'PLUGIN_ANSWER');
    assert.deepEqual(ran, [], 'no other plugin may answer in its place');
  } finally { restoreCatalog(); }
});

test('after detaching, the matcher decides again', async () => {
  installFakeCatalog();
  try {
    const owner = `own-detach-${n++}`;
    await seed(owner);
    await bridge.attachPluginForOwner(owner, 'fbt-native:smart-money-tracker');
    await bridge.attachPluginForOwner(owner, null);
    const out = await brain.handle({ owner, message: 'گزارش امنیتی Aave را بده', locale: 'fa' });
    assert.equal(out.intent?.pluginSlug, 'protocol-security-brief', 'the vocabulary match decides once the owner has no choice stored');
    assert.equal(out.intent?.pluginAttachedBy, 'match');
  } finally { restoreCatalog(); }
});

/* ── 5. the browser half ─────────────────────────────────────────────────── */
test('the chat client carries the active agent, and only a first-party one', () => {
  const src = readFileSync(path.join(ROOT, 'src/lib/central/client.js'), 'utf8');
  assert.match(src, /import \{ readActiveAgent \} from '\.\.\/intent-ai\/agentHub\/activeAgent\.js'/, 'sendIntent must read the hub choice itself, not rely on each caller');
  assert.match(src, /active\.providerId === NATIVE_PROVIDER_ID/, 'only a first-party agent id may be sent');
  assert.match(src, /\.\.\.\(agentId \? \{ agentId \} : \{\}\)/, 'the body carries the agent when there is one');
  assert.match(src, /export const attachPlugin = \(agentId\) => call\('\/plugins\/attach'/, 'the owner-facing attach must exist');
  assert.match(src, /export const detachPlugin = \(\) => call\('\/plugins\/detach'/, 'and so must its removal');

  const panel = readFileSync(path.join(ROOT, 'src/components/AgentHub/AgentHubPanel.jsx'), 'utf8');
  assert.match(panel, /attachPlugin\(selected\.id\)/, 'activating an agent in the hub must make it the owner choice');
  const dock = readFileSync(path.join(ROOT, 'src/components/AgentHub/AgentChatDock.jsx'), 'utf8');
  assert.match(dock, /clearActiveAgent\(\);\s*detachPlugin\(\)/, 'clearing the agent must also clear the owner choice');

  const api = readFileSync(path.join(ROOT, 'server/ci/api.js'), 'utf8');
  assert.match(api, /router\.get\('\/plugins'/, 'the catalog route must exist');
  assert.match(api, /router\.post\('\/plugins\/attach'/, 'the attach route must exist');
  assert.match(api, /\^fbt-native\[:\-\]/, 'the server accepts only a first-party id shape');
});

test('the attachment collection is a declared FI collection, not an ad-hoc key', async () => {
  const { COLLECTIONS } = await import(path.join(ROOT, 'server/fios/collections.js'));
  assert.ok(COLLECTIONS.includes(registry.PLUGIN_ATTACHMENT_COLLECTION), 'the store rejects an undeclared collection name');
});
