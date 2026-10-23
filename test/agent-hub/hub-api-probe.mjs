#!/usr/bin/env node
/**
 * EXTERNAL AGENT HUB — end-to-end API probe (§19).
 * ---------------------------------------------------------------------------
 * Boots the REAL `server/app.js` on a loopback port and drives the Hub exactly
 * as the browser does. The provider is the local A2A conformance server, so the
 * transport, the protocol, the broker, the store and the router are all
 * production code paths — only the remote agent is a fixture.
 *
 * What this probe is designed to catch, in order of how much it would cost:
 *
 *   · a doubled create (double-click, concurrent retry, lost response) → the
 *     provider's `message/send` count is asserted, not just the HTTP status;
 *   · a cross-owner read → device B asking for device A's task id;
 *   · an IP-only caller acting on a task → `STRONG_OWNER_REQUIRED`;
 *   · a paid agent quietly "working" → `PAYMENT_REQUIRED` with zero remote
 *     calls and no charge;
 *   · an account agent used without a connection → `AUTH_REQUIRED`;
 *   · an unsigned / stale / replayed webhook reaching a task row;
 *   · a kill switch that only exists in process memory;
 *   · a client-supplied provider URL changing where the request goes.
 */
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT = '100000,60000';
process.env.AI_RATE_LIMIT = '100000,60000';
process.env.BRAIN_RATE_LIMIT = '100000,60000';
process.env.MEM_RATE_LIMIT = '100000,60000';
process.env.SAFE_INTENTS_ONLY = 'true';
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

import http from 'node:http';
import { createHmac } from 'node:crypto';

let passed = 0;
let failed = 0;
const failures = [];
function t(name, ok, detail = null) {
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${JSON.stringify(detail).slice(0, 400)}` : ''}`); }
}

const { startConformanceServer } = await import('./conformance-server.mjs');
const A = await startConformanceServer();

const WEBHOOK_SECRET = 'conformance-webhook-secret-0123456789';
const OPS_TOKEN = 'hub-ops-token-0123456789abcdef';
const CLIENT_ID = 'fbt-conformance-client';
const CLIENT_SECRET = 'fbt-conformance-secret';

const evidence = {
  reviewedAt: '2026-10-20',
  reviewedBy: 'probe',
  documentUrl: 'https://conformance.example/decision-record',
  jurisdiction: {
    operatorJurisdiction: 'NL',
    targetRegions: ['EU'],
    providerRestrictions: ['none recorded for the fixture'],
    accountEligibility: 'not applicable to a fixture'
  },
  promptTraining: 'no',
  dataRetention: 'not retained beyond the fixture process'
};

const base = {
  name: 'Conformance Provider',
  websiteUrl: 'https://conformance.example',
  documentationUrl: 'https://conformance.example/docs',
  termsUrl: 'https://conformance.example/terms',
  privacyUrl: 'https://conformance.example/privacy',
  supportUrl: 'https://conformance.example/security',
  integrationType: 'A2A',
  approvalStatus: 'APPROVED_FREE',
  approvalEvidence: evidence,
  allowedHosts: ['127.0.0.1'],
  cardUrl: A.cardUrl,
  rpcUrl: A.rpcUrl,
  category: 'research',
  costSummary: 'Free (provider limits apply)',
  webhook: { secretEnv: 'CONFORMANCE_WEBHOOK_SECRET', signatureHeader: 'x-fbt-signature', timestampHeader: 'x-fbt-timestamp' }
};

const providers = [
  { ...base, id: 'conformance-free', accessModel: 'FREE_PUBLIC' },
  {
    ...base,
    id: 'conformance-account',
    accessModel: 'FREE_ACCOUNT',
    approvalStatus: 'APPROVED_ACCOUNT_REQUIRED',
    webhook: null,
    authorization: {
      type: 'OAUTH2',
      authorizeUrl: 'https://auth.conformance.example/authorize',
      tokenUrl: A.tokenUrl,
      scopes: ['agent.read', 'agent.task'],
      clientIdEnv: 'CONFORMANCE_CLIENT_ID',
      clientSecretEnv: 'CONFORMANCE_CLIENT_SECRET'
    }
  },
  { ...base, id: 'conformance-paid', accessModel: 'DIRECT_CRYPTO_PAYMENT', approvalStatus: 'APPROVED_DIRECT_PAID', webhook: null },
  /* Deliberately invalid: the registry must report it, not publish it. */
  {
    ...base,
    id: 'broken-provider',
    accessModel: 'FREE_PUBLIC',
    approvalEvidence: { ...evidence, jurisdiction: {} }
  }
];

process.env.AGENT_HUB_ENABLED = '1';
process.env.AGENT_HUB_ALLOW_LOOPBACK = '1';
process.env.AGENT_HUB_PROVIDERS_JSON = JSON.stringify(providers);
process.env.AGENT_HUB_OPS_TOKEN = OPS_TOKEN;
process.env.AGENT_HUB_SECRET_KEY = 'a'.repeat(64);
process.env.AGENT_HUB_STATE_SECRET = 'state-secret-for-probe-only-0123456789';
process.env.CONFORMANCE_WEBHOOK_SECRET = WEBHOOK_SECRET;
process.env.CONFORMANCE_CLIENT_ID = CLIENT_ID;
process.env.CONFORMANCE_CLIENT_SECRET = CLIENT_SECRET;
process.env.AGENT_HUB_CREATE_RATE = '1000';

const { default: app } = await import('../../server/app.js');
app.locals.ciLog = [];
const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

/* The OAuth redirect base is this very server — set after listen because a port
   is not known before it, and read by the connection manager on first use. */
process.env.AGENT_HUB_OAUTH_REDIRECT_BASE = origin;

const DEVICE_A = { 'x-fbt-device': 'hub-probe-device-A' };
const DEVICE_B = { 'x-fbt-device': 'hub-probe-device-B' };

const call = async (path, { method = 'GET', body = null, device = DEVICE_A, headers = {} } = {}) => {
  const res = await fetch(origin + path, {
    method,
    headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}), ...(device || {}), ...headers },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = { raw: text.slice(0, 200) }; }
  return { status: res.status, body: parsed };
};
const post = (path, body, opts = {}) => call(path, { method: 'POST', body, ...opts });

/* give the lazy dynamic mount a beat to attach (same as the FI probe) */
await new Promise((r) => setTimeout(r, 800));

const HUB = '/api/ai/agent-hub';
const freeAgent = 'conformance-free:token-research';
const accountAgent = 'conformance-account:token-research';
const paidAgent = 'conformance-paid:token-research';

const consentBody = (text, extra = {}) => ({
  taskText: text,
  consent: { approved: true, categories: ['task_text', 'wallet_address'], termsVersion: '2026-10-20', privacyVersion: '2026-10-20' },
  context: { walletAddress: '0x2222222222222222222222222222222222222222' },
  ...extra
});
let keyCounter = 0;
const newKey = () => `probe-key-${Date.now().toString(36)}-${++keyCounter}`;
const createTask = (agentId, text, { key = newKey(), device = DEVICE_A, extra = {} } = {}) =>
  post(`${HUB}/agents/${encodeURIComponent(agentId)}/tasks`, consentBody(text, extra), { device, headers: { 'idempotency-key': key } });

/* ══════════════════════ 1. flags, catalog, honesty ══════════════════════ */
console.log('\n1. catalog and honesty');
const catalog = await call(`${HUB}/catalog`);
t('catalog answers with the flag on', catalog.status === 200 && catalog.body.enabled === true, catalog.body);
t('the invalid provider is refused by the registry, not published', !catalog.body.agents.some((a) => a.providerId === 'broken-provider'), catalog.body.agents?.map((a) => a.providerId));
t('the registry error names the refusal code', (await call(`${HUB}/provider-health`, { headers: { 'x-fbt-ops-token': OPS_TOKEN } })).body.registryErrors?.some((e) => e.code === 'PROVIDER_JURISDICTION_UNRESOLVED'));
t('only reviewed skills are listed — two per provider, from the card', catalog.body.agents.filter((a) => a.providerId === 'conformance-free').length === 2, catalog.body.agents?.length);
t('a free agent is LIVE', catalog.body.agents.find((a) => a.id === freeAgent)?.status === 'LIVE');
t('an account agent is ACCOUNT_REQUIRED, not "Active"', catalog.body.agents.find((a) => a.id === accountAgent)?.status === 'ACCOUNT_REQUIRED');
t('a paid agent is PAYMENT_REQUIRED and says paid invocation is off', catalog.body.agents.find((a) => a.id === paidAgent)?.status === 'PAYMENT_REQUIRED' && catalog.body.agents.find((a) => a.id === paidAgent)?.paidInvocationEnabled === false);
t('the catalog carries no fake ratings, prices or usage counts', !JSON.stringify(catalog.body).match(/rating|reviewCount|users|successRate/i));
t('durability is reported honestly (no Upstash/Blob in the probe)', catalog.body.durable === false);

const detail = await call(`${HUB}/agents/${encodeURIComponent(freeAgent)}`);
t('agent detail exposes provider terms, privacy and the review date', detail.status === 200 && detail.body.agent.provider.termsUrl && detail.body.agent.provider.privacyUrl && detail.body.agent.provider.reviewedAt === '2026-10-20', detail.body.agent?.provider);
t('agent detail states the data policy the review recorded', detail.body.agent.provider.dataPolicy?.promptTraining === 'no');

/* The master switch defaults ON: an unset deployment still serves the page,
   with an empty REVIEWED catalogue and nothing reachable until the user adds
   a card URL of their own. An explicit false is still a hard off. */
const { createAgentHub } = await import('../../server/agentHub/index.js');
const defaultHub = createAgentHub({ env: {}, ownerFor: () => 'dev:probe' });
const defaultCatalog = await defaultHub.broker.catalog({ owner: 'dev:probe' });
/* A hub with nothing runnable is a directory. The default build therefore
   ships the first-party agents — and NOTHING else: no reviewed vendor is
   registered here, so this still catches a provider that leaks into an
   operator's empty deploy. */
t('with AGENT_HUB_ENABLED unset the hub is ON and publishes only first-party agents',
  defaultCatalog.enabled === true && defaultCatalog.status === 'LIVE'
  && defaultCatalog.agents.length >= 10
  && defaultCatalog.agents.every((a) => a.source === 'native' && a.providerId === 'fbt-native')
  && defaultCatalog.providers.length === 1
  && defaultCatalog.providers[0].id === 'fbt-native'
  && defaultCatalog.providers[0].source === 'native',
  { status: defaultCatalog.status, agents: defaultCatalog.agents.length, providers: defaultCatalog.providers.map((p) => p.id) });
t('every first-party agent is free, credential-free and cannot be paid for',
  defaultCatalog.agents.every((a) => a.accessModel === 'FREE_PUBLIC' && a.requiresAccount === false && a.requiresPayment === false && a.paidInvocationEnabled === false));
t('a first-party agent runs without any connection, consent still required',
  (await (async () => {
    const noConsent = await createTask('fbt-native:ai-trading-analyst', 'ETH trend please', { extra: { consent: { approved: false, categories: ['task_text'] } } });
    return noConsent.status === 400 && noConsent.body.code === 'CONSENT_REQUIRED';
  })()));
const missingNativeDataConsent = await createTask('fbt-native:yield-optimizer', 'best stablecoin yield on arbitrum', {
  key: 'native-no-data-consent',
  extra: { consent: { approved: true, categories: ['task_text'] }, context: {} }
});
t('a native task cannot query a public provider without explicit data consent',
  missingNativeDataConsent.status === 400 && missingNativeDataConsent.body.code === 'NATIVE_DATA_CONSENT_REQUIRED', missingNativeDataConsent.body);
const staleNativeDataConsent = await createTask('fbt-native:yield-optimizer', 'best stablecoin yield on arbitrum', {
  key: 'native-stale-data-consent',
  extra: { consent: { approved: true, categories: ['task_text'], nativeDataApproved: true, nativeDataSources: ['CoinGecko'] }, context: {} }
});
t('a native task refuses stale approval when the disclosed provider list differs',
  staleNativeDataConsent.status === 400 && staleNativeDataConsent.body.code === 'NATIVE_DATA_CONSENT_REQUIRED', staleNativeDataConsent.body);
/* End-to-end through the REAL server: no OAuth, no credential, no payment,
   and only an approved public-data query. */
const nativeRun = await createTask('fbt-native:yield-optimizer', 'best stablecoin yield on arbitrum', {
  key: 'native-run-0001',
  extra: { consent: { approved: true, categories: ['task_text'], nativeDataApproved: true, nativeDataSources: ['DefiLlama yields'] }, context: {} }
});
t('a first-party agent completes a task with no account and no payment',
  nativeRun.status === 200 && nativeRun.body.task?.state === 'completed'
  && nativeRun.body.task?.providerId === 'fbt-native'
  && typeof nativeRun.body.task?.result?.text === 'string'
  && nativeRun.body.task.result.text.length > 80,
  { status: nativeRun.status, state: nativeRun.body.task?.state, code: nativeRun.body.code });
const nativeRead = await call(`${HUB}/tasks/${nativeRun.body.task?.id}`);
t('the first-party result is readable afterwards and records its source',
  nativeRead.status === 200 && nativeRead.body.task?.providerId === 'fbt-native'
  && nativeRead.body.events?.length >= 1, nativeRead.body.task && { state: nativeRead.body.task.state });
t('a first-party result names its data source and never claims execution',
  /DefiLlama/i.test(nativeRead.body.task?.result?.text || '') && !/\b(sign|broadcast|private key)\b/i.test(nativeRead.body.task?.result?.text || ''));

t('the task receipt records consent for the exact public source',
  nativeRead.body.task?.consent?.nativeDataApproved === true
  && nativeRead.body.task?.consent?.nativeDataSources?.includes('DefiLlama yields') === true,
  nativeRead.body.task?.consent);

const offHub = createAgentHub({ env: { AGENT_HUB_ENABLED: 'false' }, ownerFor: () => 'dev:probe' });
const offCatalog = await offHub.broker.catalog({ owner: 'dev:probe' });
t('AGENT_HUB_ENABLED=false still disables the whole surface',
  offCatalog.enabled === false && offCatalog.status === 'DISABLED' && offCatalog.agents.length === 0);
const offAdd = await offHub.userSources.add({ owner: 'dev:probe', cardUrl: `${A.base}/.well-known/agent-card.json` });
t('a disabled hub cannot store a user source either',
  offAdd.ok === false && (await offHub.userSources.list({ owner: 'dev:probe' })).sources.length === 0,
  offAdd);

/* ══════════════════════ 2. identity gates ══════════════════════ */
console.log('\n2. identity');
const ipOnly = await post(`${HUB}/agents/${encodeURIComponent(freeAgent)}/tasks`, consentBody('instant: ip only'), { device: null });
t('an IP-only caller cannot create a task', ipOnly.status === 401 && ipOnly.body.code === 'STRONG_OWNER_REQUIRED', ipOnly.body);
const ipTasks = await call(`${HUB}/tasks`, { device: null });
t('an IP-only caller cannot read task history', ipTasks.status === 401 && ipTasks.body.code === 'STRONG_OWNER_REQUIRED');
const noDeviceConnections = await call(`${HUB}/connections`, { device: null });
t('an IP-only caller cannot list connections', noDeviceConnections.status === 401);

/* ══════════════════════ 3. consent and the happy path ══════════════════════ */
console.log('\n3. consent and a real round trip');
const noConsent = await createTask(freeAgent, 'instant: research ETH', { extra: { consent: { approved: false, categories: ['task_text'] } } });
t('a task without consent is refused', noConsent.status === 400 && noConsent.body.code === 'CONSENT_REQUIRED', noConsent.body);
const unknownCategory = await createTask(freeAgent, 'instant: research ETH', { extra: { consent: { approved: true, categories: ['task_text', 'private_keys'] } } });
t('an unknown context category is refused by name', unknownCategory.status === 400 && unknownCategory.body.code === 'CONTEXT_CATEGORY_UNKNOWN', unknownCategory.body);
const missingWallet = await createTask(freeAgent, 'instant: research ETH', { extra: { context: {} } });
t('a category ticked without its value is refused, not silently dropped', missingWallet.status === 400 && missingWallet.body.code === 'CONTEXT_WALLET_INVALID', missingWallet.body);

const sendBefore = A.calls.send;
const created = await createTask(freeAgent, 'instant: research ETH liquidity');
t('a consensual task completes against the provider', created.status === 200 && created.body.task?.state === 'completed', created.body);
const task = created.body.task || {};
t('the result is the provider\'s text, attributed to the provider', typeof task.result?.text === 'string' && task.result.text.includes('BTC dominance') && task.providerName === 'Conformance Provider');
t('citations survive as links only', Array.isArray(task.result?.citations) && task.result.citations[0] === 'https://example.com/market/btc-dominance');
t('the task records the approved context hash and categories', /^[0-9a-f]{32}$/.test(task.approvedContextHash || '') && task.contextCategories.join(',') === 'task_text,wallet_address');
t('the task records a price quote of zero and no FBT markup', task.priceQuote?.amount === 0 && task.priceQuote?.model === 'FREE_PUBLIC');
t('the provider task reference is kept for the user', typeof task.remoteTaskId === 'string' && task.remoteTaskId.startsWith('task-'));
t('exactly one remote create happened', A.calls.send - sendBefore === 1, { delta: A.calls.send - sendBefore });

const events = await call(`${HUB}/tasks/${task.id}`);
t('the task is readable by its owner with an event trail', events.status === 200 && events.body.events.length >= 2 && events.body.task.id === task.id, events.body.events?.length);
t('the audit trail records the categories, never the shared values', !JSON.stringify(events.body.events).includes('0x2222222222222222222222222222222222222222') && !JSON.stringify(events.body.task.consent).includes('0x2222'), events.body.events?.map((e) => e.type));
t('the stored consent keeps the hash, the categories and the provider', events.body.task.consent?.approvedContextHash?.length === 32 && Array.isArray(events.body.task.consent?.contextCategories));

/* ══════════════════════ 4. idempotency under pressure ══════════════════════ */
console.log('\n4. idempotency');
const replay = await createTask(freeAgent, 'instant: research ETH liquidity', { key: created.body.task ? 'x' : 'x' });
void replay;
const key = newKey();
const first = await createTask(freeAgent, 'instant: same request', { key });
const second = await createTask(freeAgent, 'instant: same request', { key });
t('the same key returns the same task instead of creating a second', second.status === 200 && second.body.task.id === first.body.task.id && second.body.replay === true, second.body);

const conflict = await createTask(freeAgent, 'instant: different content', { key });
t('the same key with different content is a named conflict', conflict.status === 409 && conflict.body.code === 'IDEMPOTENCY_CONFLICT', conflict.body);

const concurrentKey = newKey();
const beforeConcurrent = A.calls.send;
const [c1, c2] = await Promise.all([
  createTask(freeAgent, 'instant: double click', { key: concurrentKey }),
  createTask(freeAgent, 'instant: double click', { key: concurrentKey })
]);
const concurrentOk = [c1, c2].filter((r) => r.status === 200).length;
t('a double-click yields one task and at most one in-progress refusal', concurrentOk >= 1 && [c1, c2].every((r) => r.status === 200 || r.body.code === 'REQUEST_IN_PROGRESS'), [c1.body.code, c2.body.code]);
t('a double-click makes exactly ONE remote create', A.calls.send - beforeConcurrent === 1, { delta: A.calls.send - beforeConcurrent });

/* ══════════════════════ 5. lost response / reconciliation ══════════════════════ */
console.log('\n5. lost response');
const dropKey = newKey();
const dropped = await createTask(freeAgent, 'drop the response please', { key: dropKey });
t('a lost provider response becomes reconciling, not failed', dropped.status === 200 && dropped.body.task?.state === 'reconciling', dropped.body.task?.state);
t('the task says its outcome is unknown to FBT', dropped.body.task?.needsReconciliation === true);
t('it never claims to be completed', dropped.body.task?.state !== 'completed' && dropped.body.task?.result === null);
const sendAfterDrop = A.calls.send;
const dropRetry = await createTask(freeAgent, 'drop the response please', { key: dropKey });
t('retrying the same key does NOT create a second remote task', dropRetry.status === 200 && dropRetry.body.task.id === dropped.body.task.id && A.calls.send === sendAfterDrop);
const newKeyRetry = await createTask(freeAgent, 'drop the response please');
t('a NEW key is a new user decision and is allowed to create', newKeyRetry.status === 200 && newKeyRetry.body.task.id !== dropped.body.task.id && A.calls.send === sendAfterDrop + 1);

/* ══════════════════════ 6. cross-owner isolation ══════════════════════ */
console.log('\n6. owner isolation');
const foreign = await call(`${HUB}/tasks/${task.id}`, { device: DEVICE_B });
t('another device cannot read this task', foreign.status === 404 && foreign.body.code === 'TASK_NOT_FOUND', foreign.body);
const foreignCancel = await post(`${HUB}/tasks/${task.id}/cancel`, {}, { device: DEVICE_B });
t('another device cannot cancel this task', foreignCancel.status === 404, foreignCancel.body);
const ownList = await call(`${HUB}/tasks`);
const foreignList = await call(`${HUB}/tasks`, { device: DEVICE_B });
t('task history is scoped to the owner', ownList.body.tasks.length > 0 && foreignList.body.tasks.length === 0, { own: ownList.body.tasks?.length, other: foreignList.body.tasks?.length });

/* ══════════════════════ 7. access models ══════════════════════ */
console.log('\n7. access models');
const sendBeforePaid = A.calls.send;
const paid = await createTask(paidAgent, 'instant: paid agent');
t('a paid agent refuses with PAYMENT_REQUIRED and charges nothing', paid.status === 409 && paid.body.code === 'PAYMENT_REQUIRED' && paid.body.paidInvocationEnabled === false, paid.body);
t('a paid refusal makes no provider call at all', A.calls.send === sendBeforePaid);

const account = await createTask(accountAgent, 'instant: account agent');
t('an account agent without a connection says AUTH_REQUIRED', account.status === 401 && account.body.code === 'AUTH_REQUIRED' && account.body.requiresConnection === true, account.body);

/* ══════════════════════ 8. connection manager ══════════════════════ */
console.log('\n8. connections');
const start = await post(`${HUB}/providers/conformance-account/connections/start`, {});
if (start.status !== 200) console.log('   connection start debug:', app.locals.ciLog.slice(-4));
t('connection start returns the provider authorization URL with PKCE', start.status === 200 && /code_challenge_method=S256/.test(start.body.authorizationUrl) && /state=/.test(start.body.authorizationUrl), start.body);
const state = new URL(start.body.authorizationUrl).searchParams.get('state');
t('the state is signed and owner-bound (no raw device id inside)', state.includes('.') && !state.includes('hub-probe-device-A'));

const callback = await post(`${HUB}/providers/conformance-account/connections/callback`, { code: 'auth-code-1', state });
t('a matching callback creates the connection', callback.status === 200 && callback.body.connection?.status === 'ACTIVE', callback.body);
t('the connection shows scopes but never a token', callback.body.connection?.scopes?.length > 0 && !JSON.stringify(callback.body).includes('tok_'));

const replayCallback = await post(`${HUB}/providers/conformance-account/connections/callback`, { code: 'auth-code-1', state });
t('the same authorization code cannot be used twice', replayCallback.status === 400 && replayCallback.body.code === 'OAUTH_STATE_ALREADY_USED', replayCallback.body);

const startForA = await post(`${HUB}/providers/conformance-account/connections/start`, {});
const stateForA = new URL(startForA.body.authorizationUrl).searchParams.get('state');
const substituted = await post(`${HUB}/providers/conformance-account/connections/callback`, { code: 'auth-code-2', state: stateForA }, { device: DEVICE_B });
t('another device cannot complete an authorization minted for A', substituted.status === 400 && substituted.body.code === 'OAUTH_STATE_OWNER_MISMATCH', substituted.body);

const forged = await post(`${HUB}/providers/conformance-account/connections/callback`, { code: 'auth-code-3', state: 'ZmFrZQ.ZmFrZQ' });
t('a forged state is refused', forged.status === 400 && forged.body.code === 'OAUTH_STATE_INVALID', forged.body);

const connections = await call(`${HUB}/connections`);
t('connections are listed for their owner only', connections.status === 200 && connections.body.connections.length === 1 && !JSON.stringify(connections.body).includes('tok_'), connections.body);
t('the connection is reported as stored-but-not-exportable', connections.body.connections[0].credentialStored === true);

const accountAfterConnect = await createTask(accountAgent, 'instant: account agent connected');
t('an account task without a durable store refuses before spending anything', accountAfterConnect.status === 400 && accountAfterConnect.body.code === 'DURABLE_STORE_REQUIRED', accountAfterConnect.body);

const revoked = await call(`${HUB}/connections/${connections.body.connections[0].id}`, { method: 'DELETE' });
t('revoke tombstones the connection', revoked.status === 200 && revoked.body.connection.status === 'REVOKED');
const afterRevoke = await call(`${HUB}/connections`);
t('a revoked connection is gone from the list', afterRevoke.body.connections.length === 0);

/* ══════════════════════ 9. webhooks ══════════════════════ */
console.log('\n9. webhooks');
const webhookBody = { id: task.remoteTaskId, status: { state: 'completed' }, artifacts: [{ artifactId: 'a1', parts: [{ kind: 'text', text: 'webhook result' }] }] };
const raw = JSON.stringify(webhookBody);
const unsigned = await fetch(`${origin}${HUB}/providers/conformance-free/webhook`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw });
t('an unsigned webhook is refused', unsigned.status === 401);
const wrongSig = await fetch(`${origin}${HUB}/providers/conformance-free/webhook`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-fbt-timestamp': String(Date.now()), 'x-fbt-signature': 'f'.repeat(64) },
  body: raw
});
t('a webhook with the wrong signature is refused', wrongSig.status === 401);
const staleTs = String(Date.now() - 60 * 60_000);
const staleSig = createHmac('sha256', WEBHOOK_SECRET).update(`${staleTs}.${raw}`).digest('hex');
const stale = await fetch(`${origin}${HUB}/providers/conformance-free/webhook`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-fbt-timestamp': staleTs, 'x-fbt-signature': staleSig },
  body: raw
});
const staleBody = await stale.json();
t('a stale webhook is refused', stale.status === 401 && staleBody.code === 'WEBHOOK_TIMESTAMP_STALE', staleBody);
const goodTs = String(Date.now());
const goodSig = createHmac('sha256', WEBHOOK_SECRET).update(`${goodTs}.${raw}`).digest('hex');
const good = await fetch(`${origin}${HUB}/providers/conformance-free/webhook`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-fbt-timestamp': goodTs, 'x-fbt-signature': goodSig },
  body: raw
});
const goodBody = await good.json();
t('a correctly signed webhook is accepted by the signature check and then refused for replay protection', good.status === 503 && goodBody.code === 'WEBHOOK_REPLAY_PROTECTION_UNAVAILABLE', goodBody);
const unknownProviderWebhook = await fetch(`${origin}${HUB}/providers/not-a-provider/webhook`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw });
t('an unknown provider webhook is a plain 404', unknownProviderWebhook.status === 404);

/* ══════════════════════ 10. operator controls ══════════════════════ */
console.log('\n10. kill switches');
t('provider health without the ops token is a 404, not a hint', (await call(`${HUB}/provider-health`)).status === 404);
const opsHealth = await call(`${HUB}/provider-health`, { headers: { 'x-fbt-ops-token': OPS_TOKEN } });
t('provider health with the token reports each provider and its switch', opsHealth.status === 200 && opsHealth.body.providers.length === 4 && opsHealth.body.providers.some((p) => p.id === 'fbt-native') && opsHealth.body.killSwitch.global === false, opsHealth.body?.providers?.map((p) => p.id));
t('provider health reports the truth about durability', opsHealth.body.durable === false);

const tripped = await post(`${HUB}/provider-health/kill`, { scope: 'provider', providerId: 'conformance-free', tripped: true, reason: 'probe' }, { headers: { 'x-fbt-ops-token': OPS_TOKEN } });
t('an operator can trip one provider', tripped.status === 200 && tripped.body.killSwitch.tripped === true, tripped.body);
const afterKill = await call(`${HUB}/catalog`);
t('a tripped provider disappears from the catalog', !afterKill.body.agents.some((a) => a.providerId === 'conformance-free'), afterKill.body.agents?.map((a) => a.providerId));
const killedCreate = await createTask(freeAgent, 'instant: blocked by kill switch');
t('a tripped provider refuses new tasks', killedCreate.status === 400 && killedCreate.body.code === 'AGENT_UNAVAILABLE', killedCreate.body);

await post(`${HUB}/provider-health/kill`, { scope: 'provider', providerId: 'conformance-free', tripped: false }, { headers: { 'x-fbt-ops-token': OPS_TOKEN } });
const globalTrip = await post(`${HUB}/provider-health/kill`, { scope: 'global', tripped: true }, { headers: { 'x-fbt-ops-token': OPS_TOKEN } });
t('the global switch is durable enough to survive the next request', globalTrip.status === 200);
const globalOff = await call(`${HUB}/catalog`);
t('the global switch disables the whole hub', globalOff.body.enabled === false && globalOff.body.reason === 'KILL_SWITCH', globalOff.body);
await post(`${HUB}/provider-health/kill`, { scope: 'global', tripped: false }, { headers: { 'x-fbt-ops-token': OPS_TOKEN } });
t('clearing the global switch restores the catalog', (await call(`${HUB}/catalog`)).body.enabled === true);

/* ══════════════════════ 11. provider states over time ══════════════════════ */
console.log('\n11. task lifecycle');
const slow = await createTask(freeAgent, 'slow analysis of the market');
t('a long task starts in a running state', slow.status === 200 && slow.body.task.state === 'running', slow.body.task?.state);
await new Promise((r) => setTimeout(r, 4300));
const slowAfter = await call(`${HUB}/tasks/${slow.body.task.id}`);
t('a later read syncs the provider completion', slowAfter.body.task.state === 'completed' && slowAfter.body.task.result?.text.includes('Result for'), slowAfter.body.task?.state);
const slowEvents = slowAfter.body.events.map((e) => e.type);
t('the event trail records the transition, not a fabricated one', slowEvents.includes('state_changed') || slowEvents.includes('provider_accepted'), slowEvents);

const hold = await createTask(freeAgent, 'hold this task');
const canceled = await post(`${HUB}/tasks/${hold.body.task.id}/cancel`, {});
t('cancel reflects the provider confirmation', canceled.status === 200 && canceled.body.canceled === true && canceled.body.task.state === 'canceled', canceled.body);
const cancelAgain = await post(`${HUB}/tasks/${hold.body.task.id}/cancel`, {});
t('cancelling a terminal task is a named refusal', cancelAgain.status === 409 && cancelAgain.body.code === 'TASK_ALREADY_TERMINAL', cancelAgain.body);

const failedTask = await createTask(freeAgent, 'fail this one');
t('a provider failure is reported as failed with a safe message', failedTask.body.task.state === 'failed' && typeof failedTask.body.task.safeErrorMessage === 'string', failedTask.body.task);
t('the raw provider diagnostic is not in the response', !JSON.stringify(failedTask.body).includes('upstream exploded'));

const messageOnly = await createTask(freeAgent, 'message only please');
t('a provider that cannot expose a task id yields reconciling, not success', messageOnly.body.task.state === 'reconciling' && messageOnly.body.task.needsReconciliation === true, messageOnly.body.task);

const missingAgent = await createTask('conformance-free:does-not-exist', 'instant: nope');
t('an unknown agent id is a 404', missingAgent.status === 404 && missingAgent.body.code === 'AGENT_NOT_FOUND', missingAgent.body);
const unknownProvider = await createTask('not-a-provider:skill', 'instant: nope');
t('an unknown provider id is a 404', unknownProvider.status === 404);

/* a client-supplied provider URL must not be able to redirect the call */
const sendBeforeUrl = A.calls.send;
const urlInBody = await createTask(freeAgent, 'instant: url injection', {
  extra: {
    providerUrl: 'http://169.254.169.254/latest/meta-data',
    rpcUrl: 'http://169.254.169.254/latest/meta-data',
    cardUrl: 'http://169.254.169.254/latest/meta-data'
  }
});
t('client-supplied provider URLs are ignored (the registry decides)', urlInBody.status === 200 && urlInBody.body.task.providerId === 'conformance-free' && A.calls.send === sendBeforeUrl + 1, { status: urlInBody.status, provider: urlInBody.body.task?.providerId, code: urlInBody.body.code, delta: A.calls.send - sendBeforeUrl });

/* ══════════════════════ 13. user-supplied agents ══════════════════════
   The reviewed catalogue in this probe is fixture-only. This section drives
   the OTHER honest path: the user names an agent card, FBT verifies the address
   and the card, and the agent is listed for THAT owner as `source: user`. */
console.log('\n13. user-supplied agent sources');

const sourceUrl = `${A.base}/.well-known/agent-card.json`;
const noDeviceSource = await post(`${HUB}/sources`, { cardUrl: sourceUrl }, { device: null });
t('an IP-only caller cannot add a source', noDeviceSource.status === 401 && noDeviceSource.body.code === 'STRONG_OWNER_REQUIRED', noDeviceSource.body);

const rejected = [
  ['http://agent.example.com/card', 'PROVIDER_URL_NOT_HTTPS', 'a plain-http card URL is refused'],
  ['https://169.254.169.254/latest/meta-data', 'PROVIDER_URL_IS_IP', 'an IP literal is refused'],
  /* `localhost` itself is allowed ONLY because this probe runs the conformance
     fixture with AGENT_HUB_ALLOW_LOOPBACK=1; every other internal name is not. */
  ['https://metadata.google.internal/card', 'PROVIDER_URL_PRIVATE_HOST', 'a private hostname is refused'],
  ['https://user:pass@agent.example.com/card', 'PROVIDER_URL_HAS_CREDENTIALS', 'credentials in the URL are refused'],
  ['https://agent.example.com/card?token=abc', 'PROVIDER_URL_HAS_QUERY', 'a query string is refused'],
  ['https://agent.example.com:8443/card', 'PROVIDER_URL_NONSTANDARD_PORT', 'a non-standard port is refused'],
  ['not a url', 'SOURCE_URL_INVALID', 'a non-URL is refused']
];
for (const [badUrl, code, label] of rejected) {
  const out = await post(`${HUB}/sources`, { cardUrl: badUrl });
  t(label, out.status === 400 && out.body.code === code, { status: out.status, body: out.body });
}

const unreachable = await post(`${HUB}/sources`, { cardUrl: `${A.base}/nothing-here` });
t('a URL that serves no agent card is refused, not stored', unreachable.status === 422 && unreachable.body.code === 'SOURCE_CARD_UNREACHABLE', unreachable.body);
t('a refused source leaves no row behind', (await call(`${HUB}/sources`)).body.sources.length === 0);

const added = await post(`${HUB}/sources`, { cardUrl: sourceUrl, label: 'My research agent' });
const sourceId = added.body.source?.id;
t('a valid A2A card is verified and stored for this device only', added.status === 200 && typeof sourceId === 'string' && sourceId.startsWith('u-') && added.body.source.card?.name === 'Conformance Research Agent', added.body);
const again = await post(`${HUB}/sources`, { cardUrl: sourceUrl });
t('adding the same card twice is a re-check, not a duplicate row', again.status === 200 && again.body.existing === true && (await call(`${HUB}/sources`)).body.sources.length === 1, again.body);

const withSource = await call(`${HUB}/catalog`);
const userAgents = withSource.body.agents.filter((a) => a.source === 'user');
t('the verified agent is listed from the card it declares', userAgents.length === 2 && userAgents.every((a) => a.providerId === sourceId), userAgents.map((a) => a.id));
t('a user-supplied listing is labelled as such and never as reviewed', userAgents.every((a) => a.provider?.source === 'user') && withSource.body.providers.find((p) => p.id === sourceId)?.source === 'user', withSource.body.providers.find((p) => p.id === sourceId));
t('the reviewed catalogue is unaffected by a user source', withSource.body.providers.some((p) => p.source === 'reviewed'));

const userAgentId = `${sourceId}:wallet-risk`;
const userDetail = await call(`${HUB}/agents/${encodeURIComponent(userAgentId)}`);
t('the user agent has its own detail page', userDetail.status === 200 && userDetail.body.agent.source === 'user' && userDetail.body.agent.providerName === 'Conformance Research Agent', userDetail.body.agent && { id: userDetail.body.agent.id, source: userDetail.body.agent.source });

/* ── the key path: the user's own key, for the user's own agent ───────────
   This is what makes an agent that requires auth actually runnable without an
   OAuth provider record. The assertions that matter are that the secret is
   never echoed back, another device cannot write it, and removing the source
   takes the key with it. */
const KEY_SECRET = 'sk-conformance-0123456789';
const keyAnon = await post(`${HUB}/sources/${sourceId}/credential`, { secret: KEY_SECRET }, { device: null });
t('an IP-only caller cannot store a key', keyAnon.status === 401 && keyAnon.body.code === 'STRONG_OWNER_REQUIRED', keyAnon.body);
const keyUnknown = await post(`${HUB}/sources/u-doesnotexist/credential`, { secret: KEY_SECRET });
t('a key cannot be stored for a source that does not exist', keyUnknown.status === 404 && keyUnknown.body.code === 'SOURCE_NOT_FOUND', keyUnknown.body);
const keyBadHeader = await post(`${HUB}/sources/${sourceId}/credential`, { secret: KEY_SECRET, headerName: 'x-evil' });
t('a header outside the allowlist is refused', keyBadHeader.status === 400 && keyBadHeader.body.code === 'CREDENTIAL_HEADER_UNSUPPORTED', keyBadHeader.body);
const keyCrlf = await post(`${HUB}/sources/${sourceId}/credential`, { secret: 'abc\r\nX-Evil: 1' });
t('a key containing a newline is refused', keyCrlf.status === 400 && keyCrlf.body.code === 'CREDENTIAL_SECRET_INVALID', keyCrlf.body);
const keySaved = await post(`${HUB}/sources/${sourceId}/credential`, { secret: KEY_SECRET, headerName: 'authorization', scheme: 'bearer' });
t('a BYO key is refused when this deployment has no durable store', keySaved.status === 503 && keySaved.body.code === 'CREDENTIAL_STORE_REQUIRED', keySaved.body);
t('a refused key is never echoed back', !JSON.stringify(keySaved.body).includes(KEY_SECRET));
const keyListed = await call(`${HUB}/connections`);
const keyRow = keyListed.body.connections.find((c) => c.kind === 'api_key');
t('a BYO key is not listed as stored after a durability refusal', keyListed.status === 200 && !keyRow && !JSON.stringify(keyListed.body).includes(KEY_SECRET), keyRow);
const keyOtherDevice = await post(`${HUB}/sources/${sourceId}/credential`, { secret: 'sk-other-device-000000' }, { device: DEVICE_B });
t('another device cannot write a key onto someone else\'s source', keyOtherDevice.status === 404 && keyOtherDevice.body.code === 'SOURCE_NOT_FOUND', keyOtherDevice.body);
const keyOtherDelete = await call(`${HUB}/sources/${sourceId}/credential`, { method: 'DELETE', device: DEVICE_B });
/* The refusal names the credential, not the other device's source: a caller
   who cannot see a source learns nothing about whether it exists. */
t('another device cannot delete another owner\'s key',
  keyOtherDelete.status === 404 || (keyOtherDelete.status === 400 && keyOtherDelete.body.code === 'CREDENTIAL_NOT_FOUND'),
  keyOtherDelete.body);

const sendBeforeUserTask = A.calls.send;
const userTask = await createTask(userAgentId, 'instant: user supplied agent');
t('a task runs against the user-supplied agent', userTask.status === 200 && userTask.body.task.state === 'completed' && A.calls.send === sendBeforeUserTask + 1, { status: userTask.status, body: userTask.body.task?.state, code: userTask.body.code });
t('the task records which source it came from', userTask.body.task?.providerId === sourceId);
const keyDeleted = await call(`${HUB}/sources/${sourceId}/credential`, { method: 'DELETE' });
t('a key that was never durably stored cannot be reported as deleted', keyDeleted.status === 400 && keyDeleted.body.code === 'CREDENTIAL_NOT_FOUND', keyDeleted.body);
t('a task still runs on a public agent when no BYO key is stored', (await createTask(userAgentId, 'instant: no key needed')).status === 200);

/* Ownership: device B must not see, use or delete device A's source. */
const bCatalog = await call(`${HUB}/catalog`, { device: DEVICE_B });
t('another device cannot see the source at all', bCatalog.body.providers.every((p) => p.id !== sourceId) && bCatalog.body.agents.every((a) => a.source !== 'user'));
const bSources = await call(`${HUB}/sources`, { device: DEVICE_B });
t('another device has an empty source list', bSources.status === 200 && bSources.body.sources.length === 0);
const bUse = await createTask(userAgentId, 'instant: cross owner', { device: DEVICE_B });
t('another device cannot run a task on that agent', bUse.status === 404 && bUse.body.code === 'AGENT_NOT_FOUND', bUse.body);
const bDelete = await call(`${HUB}/sources/${sourceId}`, { method: 'DELETE', device: DEVICE_B });
t('another device cannot delete that source', bDelete.status === 404 && bDelete.body.code === 'SOURCE_NOT_FOUND', bDelete.body);
t('and it still exists for its owner', (await call(`${HUB}/sources`)).body.sources.length === 1);

const deleted = await call(`${HUB}/sources/${sourceId}`, { method: 'DELETE' });
t('the owner can remove the source', deleted.status === 200 && deleted.body.removedId === sourceId, deleted.body);
const afterDelete = await call(`${HUB}/catalog`);
t('a removed source disappears from the catalogue and cannot be run', afterDelete.body.agents.every((a) => a.source !== 'user') && (await createTask(userAgentId, 'instant: gone')).status === 404);

/* ══════════════════════ 12. routing hygiene ══════════════════════ */
console.log('\n12. routing');
t('/api/ai/agents still belongs to the command center', (await call('/api/ai/agents')).status === 200);
t('/api/ai/external-agents still belongs to the FI trust registry', (await call('/api/ai/external-agents')).status === 200);
t('/api/ai/agent-hub/does-not-exist is a 404', (await call(`${HUB}/does-not-exist`)).status === 404);

console.log('');
console.log(`  ${passed}/${passed + failed} passed`);
if (failed) console.log(`  FAILED: ${failures.join(' | ')}`);
await A.close();
server.close();
setTimeout(() => process.exit(failed ? 1 : 0), 300);
setTimeout(() => { console.error('PROBE TIMEOUT'); process.exit(2); }, 180000);
