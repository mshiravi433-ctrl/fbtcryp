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
import {
  createRegistryEntry,
  listRegistry,
  memoryRegistryStore,
  screenRegistryInput,
  unlistRegistryEntry,
  updateRegistryEntry
} from '../server/ecosystemRegistry.js';
import { validateLiquidityProvider } from '../server/ecosystemSchemas.js';

const rows = [];
const t = (name, ok) => rows.push([name, Boolean(ok)]);

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
  t('a smuggled verified flag is overwritten with unverified', smuggled.ok && smuggled.entry.status === 'listed' && smuggled.entry.verification.status === 'unverified');
  t('a smuggled signer/webhook field is not stored', smuggled.ok && !('signerKey' in smuggled.entry) && !('webhook' in smuggled.entry));
  t('a smuggled ownerId cannot reassign ownership', (await updateRegistryEntry('agent', 9999, 'smuggler', AGENT, store)).code === 'NOT_ENTRY_OWNER');

  const strategy = await createRegistryEntry('strategy', 1001, STRATEGY, store);
  t('a stored strategy keeps automaticExecution false and approval required',
    strategy.ok && strategy.entry.action.automaticExecution === false && strategy.entry.policy.requiresUserApproval === true);

  /* Ownership */
  t('another account cannot update a listing', (await updateRegistryEntry('agent', 2002, 'probe-agent', AGENT, store)).code === 'NOT_ENTRY_OWNER');
  t('another account cannot unlist a listing', (await unlistRegistryEntry('agent', 2002, 'probe-agent', store)).code === 'NOT_ENTRY_OWNER');
  t('another account cannot reuse a taken listing id', (await createRegistryEntry('agent', 2002, AGENT, store)).code === 'ENTRY_ID_TAKEN');
  const updated = await updateRegistryEntry('agent', 1001, 'probe-agent', { ...AGENT, executionMode: 'simulation-only' }, store);
  t('the owner can update their own listing', updated.ok && updated.entry.executionMode === 'simulation-only' && updated.created === false);

  /* Listing + pagination */
  const page = await listRegistry('agent', { limit: 1 }, store);
  t('a durable registry reports dataStatus live', page.dataStatus === 'live');
  t('pagination returns one row and a cursor', page.data.length === 1 && page.hasMore === true && Boolean(page.cursor));
  const next = await listRegistry('agent', { cursor: page.cursor, limit: 1 }, store);
  t('the cursor advances instead of repeating the first row', next.data.length === 1 && next.data[0].id !== page.data[0].id);
  t('an unknown cursor is rejected, not silently ignored', (await listRegistry('agent', { cursor: 'nope' }, store)).code === 'INVALID_CURSOR');

  /* Unlisting hides the row but keeps the id reserved for its owner. */
  await unlistRegistryEntry('agent', 1001, 'probe-agent', store);
  const afterUnlist = await listRegistry('agent', { limit: 50 }, store);
  t('an unlisted row disappears from the catalog', !afterUnlist.data.some((row) => row.id === 'probe-agent'));
  t('an unlisted id cannot be claimed by another account', (await createRegistryEntry('agent', 2002, AGENT, store)).code === 'ENTRY_ID_TAKEN');

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
      status: 'listed',
      ownerId: '1',
      verification: { status: 'verified' }
    }]
  });
  const poisonedList = await listRegistry('agent', {}, poisoned);
  t('a stored row with a forbidden permission is dropped on read', poisonedList.dataStatus === 'live' && poisonedList.data.length === 0);

  /* Honest unavailable: no durable store means no writes and no pretending. */
  const offline = { durable: () => false, get: async (_k, fallback = null) => fallback, set: async () => { throw new Error('nope'); } };
  const offlineList = await listRegistry('agent', {}, offline);
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

  /* There is no execution surface to find. */
  for (const path of ['/api/ecosystem/agents/probe-agent/run', '/api/ecosystem/strategies/probe-strategy/execute', '/api/ecosystem/agents/probe-agent/withdraw']) {
    const res = await post(path, {}, { auth: Boolean(BOT_TOKEN) });
    t(`no execution route exists at ${path}`, res.status === 404);
  }
} finally {
  server.close();
}

export default rows;
