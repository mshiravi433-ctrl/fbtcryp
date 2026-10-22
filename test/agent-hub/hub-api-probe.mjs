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

/* a hub built with the flag OFF is disabled, not empty-and-usable */
const { createAgentHub } = await import('../../server/agentHub/index.js');
const offHub = createAgentHub({ env: {}, ownerFor: () => 'dev:probe' });
const offCatalog = await offHub.broker.catalog({ owner: 'dev:probe' });
t('with AGENT_HUB_ENABLED unset the catalog is DISABLED with zero agents', offCatalog.enabled === false && offCatalog.status === 'DISABLED' && offCatalog.agents.length === 0);

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
t('provider health with the token reports each provider and its switch', opsHealth.status === 200 && opsHealth.body.providers.length === 3 && opsHealth.body.killSwitch.global === false, opsHealth.body?.providers?.length);
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
