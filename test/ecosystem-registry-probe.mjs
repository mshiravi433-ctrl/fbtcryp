/**
 * ECOSYSTEM REGISTRY PROBE — the authenticated agent/strategy catalog.
 *
 * Two layers, because the interesting failures live in different places:
 *
 *   1. MODULE (server/ecosystemRegistry.js against an in-memory store):
 *      ownership, pagination, the honest live/unavailable split, and the
 *      read-side fail-closed pass that drops a stored row which no longer
 *      satisfies its validator (a poisoned or hand-edited blob).
 *
 *   2. HTTP (the real server/app.js): the write routes are unreachable without
 *      a verified Telegram identity, and a request asking for withdrawFunds,
 *      executeWithoutUser or action.automaticExecution is rejected at the edge
 *      — before an idempotency key is claimed and regardless of whether a
 *      durable store is configured. That last part is the property worth a
 *      test: a permission check that only runs when storage happens to be up
 *      is not a permission check.
 *
 * Nothing here asserts that a listing can DO anything, because nothing can:
 * the registry stores metadata and there is no execute/sign/withdraw route to
 * probe in the first place.
 */

import { createHmac } from 'node:crypto';
/* The certifier allowlist is read at call time, so pinning it here is enough
   and it never leaks into another probe's expectations. */
process.env.ECOSYSTEM_CERTIFIERS = process.env.ECOSYSTEM_CERTIFIERS || '555000555:Probe Review';
import {
  createRegistryEntry,
  listOwnerRegistry,
  listRegistry,
  listReviewQueue,
  registryCounts,
  memoryRegistryStore,
  publishRegistryEntry,
  revokeRegistryEntry,
  screenRegistryInput,
  submitRegistryEntry,
  transitionRegistryEntry,
  updateRegistryEntry
} from '../server/ecosystemRegistry.js';
import { validateLiquidityProvider } from '../server/ecosystemSchemas.js';
import {
  certifiedSubjects,
  issueCertification,
  listCertifications,
  revokeCertification,
  sweepCertifications
} from '../server/ecosystemCertifications.js';
import { authenticateApiKey, createApiKey, hasScope, memoryKeyStore, revokeApiKey } from '../server/developerKeys.js';
import { buildReputationSnapshot } from '../server/ecosystemReputation.js';
import { savePortfolioAgent, readPortfolioAgent } from '../server/portfolioAgents.js';

const rows = [];
const t = (name, ok) => rows.push([name, Boolean(ok)]);

/* A stand-in for what certifiedSubjects() returns: issued in the future so it
   always covers the content written during the probe. */
const CERT = { status: 'certified', types: ['sandbox_reviewed'], issuers: ['Probe Review'], issuedAt: Date.now() + 60_000, expiresAt: Date.now() + 3600_000 };

const AGENT = {
  id: 'probe-agent',
  name: { en: 'Probe Agent', fa: 'ایجنت آزمون' },
  description: 'Reads markets and drafts intents',
  supportedChains: [1, 42161],
  executionMode: 'manual',
  permissions: {}
};
const STRATEGY = {
  id: 'probe-strategy',
  name: { en: 'Probe Strategy' },
  trigger: { type: 'price', expression: 'eth < 2500' },
  policy: { maxAmountUsd: 250, maxSlippageBps: 50, allowedChains: [1], allowedAssets: ['usdc'] },
  action: { type: 'create_intent' }
};

/* ------------------------- 1. module-level rules ------------------------- */
{
  const store = memoryRegistryStore();
  const created = await createRegistryEntry('agent', 1001, AGENT, store);
  t('an authenticated agent listing is stored', created.ok && created.created && created.entry.id === 'probe-agent');
  t('a stored listing is never marked verified', created.entry?.verification?.status === 'unverified');
  t('the owner id never reaches the public entry', created.ok && !('ownerId' in created.entry));

  const withdrawal = await createRegistryEntry('agent', 1001, { ...AGENT, id: 'withdrawer', permissions: { withdrawFunds: true } }, store);
  t('a listing requesting withdrawFunds is refused by the store layer', !withdrawal.ok && withdrawal.code === 'FORBIDDEN_PERMISSION');
  const autonomous = await createRegistryEntry('agent', 1001, { ...AGENT, id: 'autonomous', permissions: { executeWithoutUser: true } }, store);
  t('a listing requesting executeWithoutUser is refused by the store layer', !autonomous.ok && autonomous.code === 'FORBIDDEN_PERMISSION');
  const auto = await createRegistryEntry('strategy', 1001, { ...STRATEGY, id: 'auto-strategy', action: { automaticExecution: true } }, store);
  t('a strategy requesting automatic execution is refused by the store layer', !auto.ok && auto.code === 'AUTOMATIC_EXECUTION_FORBIDDEN');
  const unbounded = await createRegistryEntry('strategy', 1001, { ...STRATEGY, id: 'unbounded', policy: { allowedChains: [1] } }, store);
  t('a strategy without bounded policy is refused', !unbounded.ok && unbounded.code === 'MAX_AMOUNT_REQUIRED');

  /* Extra fields must not ride along into storage: only the validated,
     projected whitelist is persisted. */
  const smuggled = await createRegistryEntry('agent', 1001, {
    ...AGENT,
    id: 'smuggler',
    ownerId: '9999',
    status: 'verified',
    verification: { status: 'verified' },
    signerKey: '0xdeadbeef',
    webhook: 'https://evil.example/execute'
  }, store);
  t('a smuggled verified flag lands as an unverified draft', smuggled.ok && smuggled.entry.status === 'draft' && smuggled.entry.verification.status === 'unverified');
  t('a smuggled signer/webhook field is not stored', smuggled.ok && !('signerKey' in smuggled.entry) && !('webhook' in smuggled.entry));
  t('a smuggled ownerId cannot reassign ownership', (await updateRegistryEntry('agent', 9999, 'smuggler', AGENT, store)).code === 'NOT_ENTRY_OWNER');

  const strategy = await createRegistryEntry('strategy', 1001, STRATEGY, store);
  t('a stored strategy keeps automaticExecution false and approval required',
    strategy.ok && strategy.entry.action.automaticExecution === false && strategy.entry.policy.requiresUserApproval === true);

  /* Ownership */
  t('another account cannot update a listing', (await updateRegistryEntry('agent', 2002, 'probe-agent', AGENT, store)).code === 'NOT_ENTRY_OWNER');
  t('another account cannot move a listing along the lifecycle', (await submitRegistryEntry('agent', 2002, 'probe-agent', { store })).code === 'NOT_ENTRY_OWNER');
  t('another account cannot reuse a taken listing id', (await createRegistryEntry('agent', 2002, AGENT, store)).code === 'ENTRY_ID_TAKEN');
  const updated = await updateRegistryEntry('agent', 1001, 'probe-agent', { ...AGENT, executionMode: 'simulation-only' }, store);
  t('the owner can update their own listing', updated.ok && updated.entry.executionMode === 'simulation-only' && updated.created === false);

  /* Listing + pagination. Nothing is public until it is published AND
     certified, so the visible rows are staged deliberately below. */
  const certifiedAll = new Map([['probe-agent', CERT], ['smuggler', CERT], ['probe-strategy', CERT]]);
  for (const id of ['probe-agent', 'smuggler']) {
    await submitRegistryEntry('agent', 1001, id, { store });
    await publishRegistryEntry('agent', 1001, id, { store, certified: certifiedAll });
  }
  const trust = { certified: certifiedAll, reputation: new Map() };
  const page = await listRegistry('agent', { limit: 1, trust }, store);
  t('a durable registry reports dataStatus live', page.dataStatus === 'live');
  t('pagination returns one row and a cursor', page.data.length === 1 && page.hasMore === true && Boolean(page.cursor));
  const next = await listRegistry('agent', { cursor: page.cursor, limit: 1, trust }, store);
  t('the cursor advances instead of repeating the first row', next.data.length === 1 && next.data[0].id !== page.data[0].id);
  t('an unknown cursor is rejected, not silently ignored', (await listRegistry('agent', { cursor: 'nope', trust }, store)).code === 'INVALID_CURSOR');

  /* Revoking hides the row but keeps the id reserved for its owner. */
  await revokeRegistryEntry('agent', 1001, 'probe-agent', { store });
  const afterRevoke = await listRegistry('agent', { limit: 50, trust }, store);
  t('a revoked row disappears from the catalog', !afterRevoke.data.some((row) => row.id === 'probe-agent'));
  t('a revoked id cannot be claimed by another account', (await createRegistryEntry('agent', 2002, AGENT, store)).code === 'ENTRY_ID_TAKEN');

  /* A poisoned store must not publish. This writes a row that would have been
     rejected on the way in, straight into storage, and reads it back. */
  const poisoned = memoryRegistryStore({
    'ecosystem-agents:v1': [{
      schema: 'fbt.agent.v1',
      id: 'poisoned',
      name: { en: 'Poisoned' },
      supportedChains: [1],
      executionMode: 'manual',
      permissions: { withdrawFunds: true },
      status: 'published',
      ownerId: '1',
      verification: { status: 'verified' }
    }]
  });
  const poisonedList = await listRegistry('agent', { trust: { certified: new Map([['poisoned', CERT]]), reputation: new Map() } }, poisoned);
  t('a stored row with a forbidden permission is dropped on read', poisonedList.dataStatus === 'live' && poisonedList.data.length === 0);

  /* Honest unavailable: no durable store means no writes and no pretending. */
  const offline = { durable: () => false, get: async (_k, fallback = null) => fallback, set: async () => { throw new Error('nope'); } };
  const offlineList = await listRegistry('agent', { trust: { certified: new Map(), reputation: new Map() } }, offline);
  t('without a durable store reads report unavailable, not empty', offlineList.dataStatus === 'unavailable' && offlineList.data.length === 0);
  t('without a durable store writes are refused', (await createRegistryEntry('agent', 1001, AGENT, offline)).code === 'REGISTRY_STORE_UNAVAILABLE');

  /* Liquidity stays read-only, and its validator refuses custody claims. */
  t('liquidity has no write path', (await createRegistryEntry('liquidity', 1001, { id: 'lp', name: 'LP', supportedChains: [1] }, store)).code === 'TYPE_NOT_WRITABLE');
  t('a liquidity provider claiming custody is rejected',
    !validateLiquidityProvider({ schema: 'fbt.liquidity-provider.v1', id: 'lp', supportedChains: [1], capabilities: { custody: true } }).ok);
  t('a liquidity provider claiming settlement of user funds is rejected',
    !validateLiquidityProvider({ schema: 'fbt.liquidity-provider.v1', id: 'lp', supportedChains: [1], capabilities: { settlesUserFunds: true } }).ok);
  t('an accepted liquidity provider still reports settlement unavailable',
    validateLiquidityProvider({ schema: 'fbt.liquidity-provider.v1', id: 'lp', supportedChains: [1], capabilities: {} }).value?.rfqSettlement === 'unavailable');

  /* The edge screen is storage-independent by design. */
  t('edge screening rejects withdrawFunds with no store involved',
    !screenRegistryInput('agent', { ...AGENT, permissions: { withdrawFunds: true } }).ok);
  t('edge screening rejects automatic execution with no store involved',
    !screenRegistryInput('strategy', { ...STRATEGY, action: { automaticExecution: true } }).ok);
  t('edge screening refuses liquidity writes', screenRegistryInput('liquidity', { id: 'lp' }).code === 'TYPE_NOT_WRITABLE');
}

/* ------------------- 2. lifecycle, certification, keys ------------------- */
{
  const store = memoryRegistryStore();
  const certStore = (() => {
    const map = new Map();
    return { durable: () => true, get: async (k, fallback = null) => (map.has(k) ? map.get(k) : fallback), set: async (k, v) => { map.set(k, v); return v; } };
  })();
  const CERTIFIER = 555000555;   // matches ECOSYSTEM_CERTIFIERS above
  const OUTSIDER = 111000111;
  const evidence = [{ type: 'sandbox_test_run', uri: 'https://example.com/run-42' }];

  const created = await createRegistryEntry('agent', 1001, AGENT, store);
  t('a new listing starts as a draft, not as a live listing', created.entry.status === 'draft');
  t('a draft is invisible in the public catalog',
    (await listRegistry('agent', { trust: { certified: new Map(), reputation: new Map() } }, store)).data.length === 0);
  t('draft cannot jump straight to published',
    (await transitionRegistryEntry('agent', 1001, 'probe-agent', 'published', { store, certified: new Map() })).code === 'INVALID_TRANSITION');
  t('an unknown status is refused', (await transitionRegistryEntry('agent', 1001, 'probe-agent', 'live', { store })).code === 'INVALID_STATUS');
  t('the owner can submit for review', (await submitRegistryEntry('agent', 1001, 'probe-agent', { store })).entry.status === 'submitted');

  /* Certification is the gate, and only an allowlisted reviewer holds it. */
  t('a non-certifier cannot issue a certification',
    (await issueCertification(OUTSIDER, { subjectId: 'probe-agent', subjectType: 'agent', certificationType: 'sandbox_reviewed', evidence }, certStore)).code === 'CERTIFIER_NOT_AUTHORIZED');
  t('an active certification without evidence is rejected',
    (await issueCertification(CERTIFIER, { subjectId: 'probe-agent', subjectType: 'agent', certificationType: 'sandbox_reviewed', evidence: [] }, certStore)).code === 'EVIDENCE_REQUIRED');
  t('evidence that is neither an https link nor a sha256 digest is rejected',
    (await issueCertification(CERTIFIER, { subjectId: 'probe-agent', subjectType: 'agent', certificationType: 'sandbox_reviewed', evidence: [{ type: 'code_review', uri: 'trust me' }] }, certStore)).code === 'EVIDENCE_REQUIRED');
  t('an unknown certification type is rejected',
    (await issueCertification(CERTIFIER, { subjectId: 'probe-agent', subjectType: 'agent', certificationType: 'audited_by_vibes', evidence }, certStore)).code === 'INVALID_CERTIFICATION_TYPE');
  t('publishing without a certification is refused',
    (await publishRegistryEntry('agent', 1001, 'probe-agent', { store, certified: new Map() })).code === 'CERTIFICATION_REQUIRED');

  const issued = await issueCertification(CERTIFIER, { subjectId: 'probe-agent', subjectType: 'agent', certificationType: 'sandbox_reviewed', evidence }, certStore);
  t('an allowlisted reviewer can issue a certification with evidence', issued.ok && issued.certification.status === 'active');
  t('the certification names the reviewer, not their account id', issued.certification.issuer === 'Probe Review' && !JSON.stringify(issued.certification).includes(String(CERTIFIER)));

  const certified = await certifiedSubjects({}, certStore);
  const published = await publishRegistryEntry('agent', 1001, 'probe-agent', { store, certified });
  t('a certified listing can be published', published.ok && published.entry.status === 'published');
  t('the published entry carries a derived certified badge', published.entry.verification.status === 'certified' && published.entry.verification.issuers.includes('Probe Review'));

  const trust = { certified, reputation: new Map() };
  t('the published listing is now in the public catalog', (await listRegistry('agent', { trust }, store)).data.length === 1);
  t('a published listing cannot be edited in place', (await updateRegistryEntry('agent', 1001, 'probe-agent', AGENT, store)).code === 'ENTRY_NOT_EDITABLE');

  /* Revoking the CERTIFICATE (not the listing) must empty the catalog too,
     otherwise revocation would be cosmetic. */
  await revokeCertification(CERTIFIER, issued.certification.id, certStore);
  const afterCertRevoke = { certified: await certifiedSubjects({}, certStore), reputation: new Map() };
  t('revoking the certification removes the listing from the catalog',
    (await listRegistry('agent', { trust: afterCertRevoke }, store)).data.length === 0);
  const mine = await listOwnerRegistry('agent', 1001, store, { certified: afterCertRevoke.certified });
  t('the owner view explains why a published listing is not visible',
    mine.ok && mine.data[0].visibleInCatalog === false && mine.data[0].blockedReason === 'CERTIFICATION_REQUIRED');
  t('the owner view never leaks another account\'s listings',
    (await listOwnerRegistry('agent', 2002, store, { certified: afterCertRevoke.certified })).data.length === 0);

  /* Content edited after review is not the content that was reviewed. */
  await revokeRegistryEntry('agent', 1001, 'probe-agent', { store });
  await transitionRegistryEntry('agent', 1001, 'probe-agent', 'draft', { store });
  await updateRegistryEntry('agent', 1001, 'probe-agent', { ...AGENT, description: 'Rewritten after the review' }, store);
  await submitRegistryEntry('agent', 1001, 'probe-agent', { store });
  const staleCert = new Map([['probe-agent', { status: 'certified', types: ['sandbox_reviewed'], issuers: ['Probe Review'], issuedAt: Date.now() - 86_400_000, expiresAt: Date.now() + 86_400_000 }]]);
  t('a certification older than the content cannot publish it',
    (await publishRegistryEntry('agent', 1001, 'probe-agent', { store, certified: staleCert })).code === 'CERTIFICATION_STALE');

  const certList = await listCertifications({ subjectId: 'probe-agent' }, certStore);
  t('certifications are readable per subject', certList.ok && certList.data.length >= 1);
  t('a revoked certification stays in the record for the trail', certList.data.some((row) => row.status === 'revoked'));

  /* ---- reviewer queue and operational counts ---- */
  {
    const queueStore = memoryRegistryStore();
    await createRegistryEntry('agent', 3001, { ...AGENT, id: 'queued-agent' }, queueStore);
    await createRegistryEntry('agent', 3002, { ...AGENT, id: 'private-draft' }, queueStore);
    await submitRegistryEntry('agent', 3001, 'queued-agent', { store: queueStore });
    const queue = await listReviewQueue({}, queueStore);
    t('the review queue holds only submitted listings', queue.ok && queue.data.length === 1 && queue.data[0].id === 'queued-agent');
    t('the review queue never exposes who submitted a listing', !JSON.stringify(queue.data).includes('ownerId') && !JSON.stringify(queue.data).includes('3001'));
    const counts = await registryCounts(queueStore);
    t('registry counts report each lifecycle state', counts.counts.agent.draft === 1 && counts.counts.agent.submitted === 1);
    t('registry counts report unavailable without a durable store',
      (await registryCounts({ durable: () => false, get: async (_k, f = null) => f, set: async () => {} })).dataStatus === 'unavailable');
  }

  /* ---- expiry sweep: stored rows must agree with what readers are told ---- */
  {
    const map = new Map();
    const expiryStore = { durable: () => true, get: async (k, f = null) => (map.has(k) ? map.get(k) : f), set: async (k, v) => { map.set(k, v); return v; } };
    map.set('ecosystem-certifications:v1', [
      { schema: 'fbt.certification.v1', id: 'cert_old', subjectId: 'probe-agent', subjectType: 'agent', certificationType: 'sandbox_reviewed', issuer: 'Probe Review', issuedAt: Date.now() - 200_000, expiresAt: Date.now() - 1000, status: 'active', evidence },
      { schema: 'fbt.certification.v1', id: 'cert_live', subjectId: 'other-agent', subjectType: 'agent', certificationType: 'sandbox_reviewed', issuer: 'Probe Review', issuedAt: Date.now() - 1000, expiresAt: Date.now() + 200_000, status: 'active', evidence }
    ]);
    t('an expired certification is not counted as active', !(await certifiedSubjects({}, expiryStore)).has('probe-agent'));
    const swept = await sweepCertifications({}, expiryStore);
    t('the sweep marks expired certifications in storage', swept.ok && swept.expired === 1 && swept.active === 1);
    t('the sweep leaves a live certification alone', (await certifiedSubjects({}, expiryStore)).has('other-agent'));
  }

  /* ---- API keys: issued, verified, scoped, revocable ---- */
  const keyStore = memoryKeyStore();
  const project = { id: 'prj_probe', scopes: ['read_network', 'manage_listings'] };
  const manageKey = await createApiKey(1001, project, { scopes: ['manage_listings'] }, keyStore);
  t('an API key is issued with its secret shown once', manageKey.ok && typeof manageKey.secret === 'string' && manageKey.record.hash !== manageKey.secret);
  t('the stored key record never contains the secret', !JSON.stringify(manageKey.record).includes(manageKey.secret));
  const auth = await authenticateApiKey(manageKey.secret, { store: keyStore });
  t('a valid API key authenticates to its owner', auth.ok && auth.identity.owner === '1001' && auth.identity.projectId === 'prj_probe');
  t('authentication records lastUsedAt', (await keyStore.get('developer-keys:v1:1001:prj_probe'))[0].lastUsedAt !== null);
  t('a key holding manage_listings passes the scope check', hasScope(auth.identity, 'manage_listings'));
  t('the same key fails a scope it was not granted', !hasScope(auth.identity, 'create_intent'));
  t('an unknown secret is rejected', (await authenticateApiKey('fbt_sandbox_' + 'a'.repeat(24), { store: keyStore })).code === 'API_KEY_INVALID');
  t('a malformed bearer value is rejected', (await authenticateApiKey('not-a-key', { store: keyStore })).code === 'API_KEY_INVALID');
  const readKey = await createApiKey(1001, project, { scopes: ['read_network'] }, keyStore);
  const readAuth = await authenticateApiKey(readKey.secret, { store: keyStore });
  t('a read-only key cannot manage listings', readAuth.ok && !hasScope(readAuth.identity, 'manage_listings'));
  t('a scope the project does not hold cannot be minted',
    (await createApiKey(1001, { id: 'prj_probe', scopes: ['read_network'] }, { scopes: ['manage_listings'] }, keyStore)).code === 'SCOPE_NOT_ALLOWED');
  t('no key can be minted with a signing or withdrawal scope',
    (await createApiKey(1001, { id: 'prj_probe', scopes: ['read_network', 'manage_listings', 'withdraw_funds'] }, { scopes: ['withdraw_funds'] }, keyStore)).code === 'SCOPE_NOT_ALLOWED');
  await revokeApiKey(1001, project, manageKey.record.id, keyStore);
  t('a revoked key stops authenticating', (await authenticateApiKey(manageKey.secret, { store: keyStore })).code === 'API_KEY_REVOKED');

  /* ---- reputation: observed, aggregate-only, gated by sample size ---- */
  const observation = (solver, outcome) => ({ solver, outcome, chainId: 1 });
  const thin = buildReputationSnapshot([observation('kyberswap', 'completed'), observation('kyberswap', 'completed')]);
  t('a two-sample subject reports insufficient_data', thin.subjects.kyberswap.status === 'insufficient_data');
  t('an insufficient sample publishes no count and no rate',
    thin.subjects.kyberswap.sampleSize === null && thin.subjects.kyberswap.successRate === null);
  const rows12 = [...Array(9)].map(() => observation('kyberswap', 'completed'))
    .concat([...Array(3)].map(() => observation('kyberswap', 'failed')))
    .concat([observation('kyberswap', 'cancelled')]);
  const rich = buildReputationSnapshot(rows12);
  t('a twelve-sample subject is reported as observed', rich.subjects.kyberswap.status === 'observed' && rich.subjects.kyberswap.sampleSize === 12);
  t('cancellations are excluded from the success denominator', rich.subjects.kyberswap.successRate === 0.75);
  t('a reputation record carries no address, hash or user id',
    !/0x[a-f0-9]{6,}/i.test(JSON.stringify(rich)) && !/userId|wallet|address|txHash/i.test(JSON.stringify(rich)));
  t('an address-shaped subject is dropped rather than scored',
    Object.keys(buildReputationSnapshot([...Array(9)].map(() => observation('0xabc0000000000000000000000000000000000001', 'completed'))).subjects).length === 0);

  /* ---- portfolio agent: approval-only, no execution ---- */
  const portfolioStore = memoryRegistryStore();
  const goodPortfolio = { allocations: [{ asset: 'eth', targetPct: 60 }, { asset: 'usdc', targetPct: 40 }], rebalance: { maxTradeUsd: 500, maxSlippageBps: 40 } };
  const savedPortfolio = await savePortfolioAgent(7001, goodPortfolio, portfolioStore);
  t('a portfolio agent saves as approval-only', savedPortfolio.ok && savedPortfolio.data.rebalance.mode === 'approval_required');
  t('a saved portfolio agent cannot withdraw or act alone',
    savedPortfolio.data.permissions.withdrawFunds === false && savedPortfolio.data.permissions.executeWithoutUser === false);
  t('a portfolio agent asking to withdraw is refused',
    (await savePortfolioAgent(7001, { ...goodPortfolio, permissions: { withdrawFunds: true } }, portfolioStore)).data.permissions.withdrawFunds === false);
  t('allocations that do not add up to 100% are refused',
    (await savePortfolioAgent(7001, { ...goodPortfolio, allocations: [{ asset: 'ETH', targetPct: 10 }] }, portfolioStore)).code === 'INVALID_ALLOCATIONS');
  t('a portfolio agent reads back for its owner', (await readPortfolioAgent(7001, portfolioStore)).data?.allocations?.length === 2);
  t('another account reads back nothing', (await readPortfolioAgent(7002, portfolioStore)).data === null);
}

/* ---------------------------- 2. real HTTP ------------------------------- */
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const { default: app } = await import('../server/app.js');
const server = await new Promise((resolve) => {
  const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
});
const base = `http://127.0.0.1:${server.address().port}`;

/** A REAL Telegram Mini App login signature, computed the way the client's is. */
function initData(userId) {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: userId, first_name: 'Probe' })
  });
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  params.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return params.toString();
}

const post = (path, body, { auth = true, key = `probe-${Math.random().toString(36).slice(2)}-key` } = {}) =>
  fetch(base + path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': key,
      ...(auth && BOT_TOKEN ? { 'x-telegram-init-data': initData(4242) } : {})
    },
    body: JSON.stringify(body)
  });

try {
  /* Telegram diagnosis is deliberately metadata-only: it gives the operator
     the reason for an AUTH_REQUIRED without exposing the bot token or any
     user field values. */
  {
    const absent = await fetch(base + '/api/telegram/diagnose', { headers: { accept: 'application/json' } });
    const absentBody = await absent.json();
    t('Telegram diagnosis names a missing header as NO_INIT_DATA_SENT',
      absent.status === 200 && absentBody.data?.reason === 'NO_INIT_DATA_SENT' && absentBody.data?.verified === false);

    const signed = await fetch(base + '/api/telegram/diagnose', {
      headers: { accept: 'application/json', 'x-telegram-init-data': initData(4242) }
    });
    const signedBody = await signed.json();
    t('Telegram diagnosis verifies a signed initData and returns the user id',
      signed.status === 200 && signedBody.data?.verified === true && signedBody.data?.reason === 'OK' && signedBody.data?.userId === '4242');

    const forgedParams = new URLSearchParams(initData(4242));
    forgedParams.set('hash', '0'.repeat(64));
    const forged = await fetch(base + '/api/telegram/diagnose', {
      headers: { accept: 'application/json', 'x-telegram-init-data': forgedParams.toString() }
    });
    const forgedBody = await forged.json();
    t('Telegram diagnosis names a forged hash as BAD_SIGNATURE',
      forged.status === 200 && forgedBody.data?.verified === false && forgedBody.data?.reason === 'BAD_SIGNATURE');

    const diagnosisText = JSON.stringify(signedBody);
    t('Telegram diagnosis never returns the bot token or hidden token fields',
      !diagnosisText.includes(BOT_TOKEN) && !/(botToken|telegramBotToken|token)\s*:/i.test(diagnosisText));
  }

  /* Reads are public and honest. */
  for (const [path, schema] of [
    ['/api/ecosystem/agents', 'fbt.agent.v1'],
    ['/api/ecosystem/strategies', 'fbt.strategy.v1'],
    ['/api/ecosystem/liquidity', 'fbt.liquidity-provider.v1']
  ]) {
    const res = await fetch(base + path, { headers: { accept: 'application/json' } });
    const body = await res.json();
    t(`GET ${path} answers with its resource schema`, res.status === 200 && body.meta?.resourceSchema === schema);
    t(`GET ${path} reports unavailable rather than an empty registry`,
      body.meta?.dataStatus === 'unavailable' && Array.isArray(body.data) && body.data.length === 0);
    t(`GET ${path} states that no listing is treated as verified`,
      (body.meta?.limitations || []).some((line) => /verified/i.test(line)));
  }

  /* Writes need a verified Telegram identity. */
  for (const path of ['/api/ecosystem/agents', '/api/ecosystem/strategies', '/api/ecosystem/liquidity']) {
    const res = await post(path, { id: 'x' }, { auth: false });
    t(`POST ${path} without Telegram auth is 401`, res.status === 401);
  }
  const forged = await fetch(base + '/api/ecosystem/agents', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'forged-key-0001', 'x-telegram-init-data': 'user=%7B%22id%22%3A1%7D&auth_date=1&hash=deadbeef' },
    body: JSON.stringify(AGENT)
  });
  t('POST with a forged Telegram signature is rejected', forged.status === 401);

  if (BOT_TOKEN) {
    /* THE SAFETY TESTS: unsafe listings are refused over HTTP, and because the
       screen runs before storage they fail with 400 rather than the store's
       503 — proving the rejection is the validator, not the missing blob. */
    const withdraw = await post('/api/ecosystem/agents', { ...AGENT, id: 'http-withdrawer', permissions: { withdrawFunds: true } });
    const withdrawBody = await withdraw.json();
    t('POST /api/ecosystem/agents rejects withdrawFunds', withdraw.status === 400 && withdrawBody.error?.code === 'FORBIDDEN_PERMISSION');

    const executeWithoutUser = await post('/api/ecosystem/agents', { ...AGENT, id: 'http-autonomous', permissions: { executeWithoutUser: true } });
    t('POST /api/ecosystem/agents rejects executeWithoutUser', executeWithoutUser.status === 400 && (await executeWithoutUser.json()).error?.code === 'FORBIDDEN_PERMISSION');

    const badMode = await post('/api/ecosystem/agents', { ...AGENT, id: 'http-autopilot', executionMode: 'autonomous' });
    t('POST /api/ecosystem/agents rejects an autonomous execution mode', badMode.status === 400 && (await badMode.json()).error?.code === 'INVALID_EXECUTION_MODE');

    const autoStrategy = await post('/api/ecosystem/strategies', { ...STRATEGY, id: 'http-auto', action: { automaticExecution: true } });
    t('POST /api/ecosystem/strategies rejects automatic execution',
      autoStrategy.status === 400 && (await autoStrategy.json()).error?.code === 'AUTOMATIC_EXECUTION_FORBIDDEN');

    const unbounded = await post('/api/ecosystem/strategies', { ...STRATEGY, id: 'http-unbounded', policy: { allowedChains: [1] } });
    t('POST /api/ecosystem/strategies rejects an unbounded policy',
      unbounded.status === 400 && (await unbounded.json()).error?.code === 'MAX_AMOUNT_REQUIRED');

    const liquidity = await post('/api/ecosystem/liquidity', { id: 'http-lp', name: 'LP', supportedChains: [1] });
    t('POST /api/ecosystem/liquidity is 405: the catalog is read-only', liquidity.status === 405);

    /* A SAFE listing still cannot be stored without a durable registry, and it
       says so with 503 instead of pretending it was saved. */
    const safe = await post('/api/ecosystem/agents', AGENT);
    const safeBody = await safe.json();
    t('a safe listing is refused 503 while no durable registry is configured',
      safe.status === 503 && safeBody.error?.code === 'REGISTRY_STORE_UNAVAILABLE' && safeBody.error?.retryable === true);

    const noKey = await fetch(base + '/api/ecosystem/agents', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-telegram-init-data': initData(4242) },
      body: JSON.stringify(AGENT)
    });
    t('a safe listing without an idempotency key is refused', noKey.status === 400 || noKey.status === 503);
  }

  /* Lifecycle, certification, reputation and portfolio surfaces over HTTP. */
  for (const path of [
    '/api/ecosystem/agents/probe-agent/submit',
    '/api/ecosystem/agents/probe-agent/publish',
    '/api/ecosystem/agents/probe-agent/revoke',
    '/api/ecosystem/agents/probe-agent/delete',
    '/api/ecosystem/strategies/probe-strategy/submit',
    '/api/ecosystem/certifications',
    '/api/portfolio/agent'
  ]) {
    const res = await post(path, {}, { auth: false });
    t(`POST ${path} without authentication is 401`, res.status === 401);
  }
  for (const path of ['/api/ecosystem/mine/agents', '/api/ecosystem/mine/strategies', '/api/portfolio/agent']) {
    const res = await fetch(base + path, { headers: { accept: 'application/json' } });
    t(`GET ${path} without authentication is 401`, res.status === 401);
  }

  /* An API key that is not even shaped like one is 401, never 503. */
  const junkKey = await fetch(base + '/api/ecosystem/agents', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'junk-key-000001', authorization: 'Bearer not-a-real-key' },
    body: JSON.stringify(AGENT)
  });
  t('a malformed API key is rejected 401', junkKey.status === 401 && (await junkKey.json()).error?.code === 'API_KEY_INVALID');

  /* Public trust surfaces answer honestly with no store configured. */
  {
    const certs = await fetch(base + '/api/ecosystem/certifications?subjectId=probe-agent', { headers: { accept: 'application/json' } });
    const body = await certs.json();
    t('GET /api/ecosystem/certifications is public and honest', certs.status === 200 && body.meta?.dataStatus === 'unavailable');
    t('the certification response says whether an issuer is configured', typeof body.meta?.issuerConfigured === 'boolean');

    const rep = await fetch(base + '/api/reputation/kyberswap', { headers: { accept: 'application/json' } });
    const repBody = await rep.json();
    t('GET /api/reputation/:id reports unavailable without an observation store',
      rep.status === 200 && repBody.data === null && repBody.meta?.dataStatus === 'unavailable');
    const badSubject = await fetch(base + '/api/reputation/' + encodeURIComponent('0xdeadbeef!!'), { headers: { accept: 'application/json' } });
    t('a malformed reputation subject is rejected', badSubject.status === 400);
  }

  if (BOT_TOKEN) {
    const notCertifier = await post('/api/ecosystem/certifications', {
      subjectId: 'probe-agent',
      subjectType: 'agent',
      certificationType: 'sandbox_reviewed',
      evidence: [{ type: 'sandbox_test_run', uri: 'https://example.com/run' }]
    });
    t('an authenticated non-reviewer cannot issue a certification',
      notCertifier.status === 403 && (await notCertifier.json()).error?.code === 'CERTIFIER_NOT_AUTHORIZED');

    const portfolio = await fetch(base + '/api/portfolio/agent', { headers: { accept: 'application/json', 'x-telegram-init-data': initData(4242) } });
    const portfolioBody = await portfolio.json();
    t('the portfolio agent endpoint is approval-only and honest about storage',
      portfolio.status === 200 && portfolioBody.meta?.approvalOnly === true && portfolioBody.meta?.dataStatus === 'unavailable');

    const mine = await fetch(base + '/api/ecosystem/mine/agents', { headers: { accept: 'application/json', 'x-telegram-init-data': initData(4242) } });
    t('the owner listing endpoint fails closed without a durable registry', mine.status === 503);
  }

  /* Operational status is public; the reviewer surfaces are not. */
  {
    const status = await fetch(base + '/api/ecosystem/status', { headers: { accept: 'application/json' } });
    const body = await status.json();
    t('GET /api/ecosystem/status is public and states its configuration',
      status.status === 200 && typeof body.data?.durableStore === 'boolean' && body.data?.publishRequiresCertification !== false);
    t('the status endpoint names the lifecycle it enforces', Array.isArray(body.data?.lifecycle) && body.data.lifecycle.includes('published'));

    const health = await (await fetch(base + '/api/health')).json();
    t('health reports the registry configuration without reading the store',
      health.ecosystem?.publishRequiresCertification === true && typeof health.ecosystem?.certificationIssuerConfigured === 'boolean');
  }
  for (const path of ['/api/ecosystem/certifier', '/api/ecosystem/review/queue']) {
    const res = await fetch(base + path, { headers: { accept: 'application/json' } });
    t(`GET ${path} without authentication is 401`, res.status === 401);
  }
  if (BOT_TOKEN) {
    const who = await (await fetch(base + '/api/ecosystem/certifier', { headers: { accept: 'application/json', 'x-telegram-init-data': initData(4242) } })).json();
    t('an ordinary account is told it is not a reviewer', who.data?.isCertifier === false);
    /* The setup path: an operator can only switch certification on if they can
       see their own id, and they must never see anyone else's. */
    t('the caller is shown their own id and the variable that enables reviewing',
      who.data?.callerId === '4242' && who.data?.envVar === 'ECOSYSTEM_CERTIFIERS');
    t('the certifier endpoint never lists other reviewers',
      !Array.isArray(who.data?.certifiers) && !JSON.stringify(who.data).includes('555000555'));
    const queue = await fetch(base + '/api/ecosystem/review/queue', { headers: { accept: 'application/json', 'x-telegram-init-data': initData(4242) } });
    t('an ordinary account cannot read the review queue', queue.status === 403);
  }

  /*
   * THE SPEC CANNOT BE FICTION. Every path the OpenAPI document advertises is
   * requested here; a 404 would mean the contract describes an endpoint nobody
   * implemented, which is the failure mode a machine-readable spec makes worse
   * (integrators generate clients from it).
   */
  {
    const spec = await (await fetch(base + '/api/openapi.json', { headers: { accept: 'application/json' } })).json();
    t('the OpenAPI document is served and scoped to the registry surface',
      spec.openapi?.startsWith('3.') && Object.keys(spec.paths || {}).length >= 20);
    t('the document states the safety boundary in machine-readable form',
      spec['x-fbt-boundary']?.canSign === false && spec['x-fbt-boundary']?.canWithdraw === false
        && spec['x-fbt-boundary']?.publishRequiresCertification === true);
    t('the document never advertises an execution or withdrawal path',
      !Object.keys(spec.paths).some((path) => /(execute|withdraw|sign|settle)/i.test(path)));

    const missing = [];
    for (const [path, operations] of Object.entries(spec.paths)) {
      const url = base + '/api' + path.replace('{id}', 'spec-probe-id');
      for (const method of Object.keys(operations)) {
        const res = await fetch(url, {
          method: method.toUpperCase(),
          headers: { accept: 'application/json', ...(method === 'post' ? { 'content-type': 'application/json', 'idempotency-key': 'spec-probe-key-0001' } : {}) },
          ...(method === 'post' ? { body: '{}' } : {})
        });
        /* 401/403/409/429/503 all prove the route exists and refused; 404 does not. */
        if (res.status === 404) missing.push(`${method.toUpperCase()} ${path}`);
      }
    }
    t(`every documented endpoint is registered${missing.length ? ` — missing: ${missing.join(', ')}` : ''}`, missing.length === 0);
  }

  {
    const paged = await fetch(base + '/api/ecosystem/agents?cursor=not-a-real-cursor', { headers: { accept: 'application/json' } });
    /* With no durable registry there is nothing to page through, so the
       honest answer is the unavailable list rather than a cursor error. */
    t('an unavailable catalog does not invent a pagination error', paged.status === 200);
  }

  /* Registry writes carry their own budget, keyed per caller. The burst below
     uses its own bearer value so it cannot starve the checks above. */
  {
    const burstKey = 'Bearer fbt_sandbox_burstprobe0000000000000';
    let limited = false;
    for (let i = 0; i < 40 && !limited; i += 1) {
      const res = await fetch(base + '/api/ecosystem/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': `burst-key-${i}-000000`, authorization: burstKey },
        body: JSON.stringify(AGENT)
      });
      if (res.status === 429) {
        const body = await res.json();
        limited = body.error?.code === 'ECOSYSTEM_WRITE_RATE_LIMITED' && body.error?.retryable === true && Boolean(res.headers.get('retry-after'));
      }
    }
    t('registry writes are rate limited with a retryable, named error', limited);
  }

  /* There is no execution surface to find. */
  for (const path of ['/api/ecosystem/agents/probe-agent/run', '/api/ecosystem/strategies/probe-strategy/execute', '/api/ecosystem/agents/probe-agent/withdraw']) {
    const res = await post(path, {}, { auth: Boolean(BOT_TOKEN) });
    t(`no execution route exists at ${path}`, res.status === 404);
  }
} finally {
  server.close();
}

export default rows;
