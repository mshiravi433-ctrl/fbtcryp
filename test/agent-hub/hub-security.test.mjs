#!/usr/bin/env node
/**
 * EXTERNAL AGENT HUB — security and honesty unit tests (§19).
 * ---------------------------------------------------------------------------
 * These are the checks that do not need a network: consent validation, provider
 * registry refusals, webhook signature/replay rules, idempotency semantics and
 * the "never leak a secret" rules. They run fast and fail loudly, which is what
 * makes it safe to change the broker later.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { buildConsentPayload } from '../../server/agentHub/consent.js';
import { composeConsentMessage } from '../../src/lib/intent-ai/agentHub/consent.js';
import { parseWebhookPayload, verifyWebhook } from '../../server/agentHub/webhooks.js';
import { createRegistry, loadProviderConfig, validateProviderRecord } from '../../server/agentHub/providers.js';
import { createTaskIdempotency, fingerprintOf } from '../../server/agentHub/idempotency.js';
import { redactSecrets, normalizeProviderError, userMessageFor } from '../../server/agentHub/protocol.js';

const EVM = '0x2222222222222222222222222222222222222222';
const SOL = '9xQeWvG816bUx9EPa2rZ9Vj7x6uTkPm3sY4hN1cB8dEf';

const providerRecord = {
  id: 'reviewed-provider',
  name: 'Reviewed Provider',
  websiteUrl: 'https://provider.example',
  documentationUrl: 'https://provider.example/docs',
  termsUrl: 'https://provider.example/terms',
  privacyUrl: 'https://provider.example/privacy',
  integrationType: 'A2A',
  accessModel: 'FREE_PUBLIC',
  approvalStatus: 'APPROVED_FREE',
  approvalEvidence: {
    reviewedAt: '2026-10-20',
    reviewedBy: 'reviewer',
    documentUrl: 'https://provider.example/decision',
    jurisdiction: { operatorJurisdiction: 'NL', targetRegions: ['EU'] },
    promptTraining: 'no',
    dataRetention: '30 days'
  },
  allowedHosts: ['provider.example'],
  cardUrl: 'https://provider.example/.well-known/agent-card.json',
  rpcUrl: 'https://provider.example/rpc'
};

describe('consent composer', () => {
  it('requires the task text to be an approved category', () => {
    const out = buildConsentPayload({ taskText: 'hello there', categories: ['wallet_address'], context: { walletAddress: EVM } });
    assert.equal(out.ok, false);
    assert.equal(out.code, 'CONTEXT_TASK_TEXT_NOT_APPROVED');
  });

  it('refuses an unknown category BY NAME instead of dropping it', () => {
    const out = buildConsentPayload({ taskText: 'hello there', categories: ['task_text', 'private_key'] });
    assert.equal(out.ok, false);
    assert.equal(out.code, 'CONTEXT_CATEGORY_UNKNOWN');
    assert.match(out.detail, /private_key/);
  });

  it('accepts an EVM address and a Solana address, and refuses anything else', () => {
    const evm = buildConsentPayload({ taskText: 'check this', categories: ['task_text', 'wallet_address'], context: { walletAddress: EVM } });
    assert.equal(evm.ok, true);
    const sol = buildConsentPayload({ taskText: 'check this', categories: ['task_text', 'wallet_address'], context: { walletAddress: SOL } });
    assert.equal(sol.ok, true);
    const bad = buildConsentPayload({ taskText: 'check this', categories: ['task_text', 'wallet_address'], context: { walletAddress: 'not-an-address' } });
    assert.equal(bad.ok, false);
    assert.equal(bad.code, 'CONTEXT_WALLET_INVALID');
  });

  it('will not accept free text where a portfolio total belongs', () => {
    const out = buildConsentPayload({
      taskText: 'check this',
      categories: ['task_text', 'portfolio_summary'],
      context: { portfolio: { totalUsd: 'my seed phrase is ...' } }
    });
    assert.equal(out.ok, false);
    assert.equal(out.code, 'CONTEXT_PORTFOLIO_INVALID');
  });

  it('keeps only numeric, bounded portfolio fields', () => {
    const out = buildConsentPayload({
      taskText: 'check this',
      categories: ['task_text', 'portfolio_summary'],
      context: { portfolio: { totalUsd: 1000, ethUsd: '250', junk: 'text', huge: 1e20 } }
    });
    assert.equal(out.ok, true);
    assert.match(out.text, /"totalUsd":1000/);
    assert.match(out.text, /"ethUsd":250/);
    assert.equal(out.text.includes('junk'), false);
    assert.equal(out.text.includes('huge'), false);
  });

  it('the browser preview and the server payload are byte-identical', () => {
    const input = {
      taskText: 'Review  concentration risk',
      categories: ['task_text', 'wallet_address', 'portfolio_summary'],
      context: { walletAddress: EVM, portfolio: { totalUsd: 1234.5, ethUsd: 100 } }
    };
    const preview = composeConsentMessage(input);
    const payload = buildConsentPayload(input);
    assert.equal(preview.ok, true);
    assert.equal(payload.text, preview.text);
    assert.equal(payload.hash.length, 32);
  });

  it('hashes deterministically and distinguishes different content', () => {
    const a = buildConsentPayload({ taskText: 'check this', categories: ['task_text', 'wallet_address'], context: { walletAddress: EVM } });
    const b = buildConsentPayload({ taskText: 'check this', categories: ['task_text', 'wallet_address'], context: { walletAddress: EVM } });
    const c = buildConsentPayload({ taskText: 'check that', categories: ['task_text', 'wallet_address'], context: { walletAddress: EVM } });
    assert.equal(a.hash, b.hash);
    assert.notEqual(a.hash, c.hash);
  });

  it('caps the composed message', () => {
    const out = buildConsentPayload({ taskText: 'x'.repeat(4000), categories: ['task_text'] });
    assert.equal(out.ok, true);
    assert.ok(out.bytes <= 6000);
  });
});

describe('provider registry', () => {
  it('accepts a fully reviewed record', () => {
    const out = validateProviderRecord(providerRecord, { env: {} });
    assert.equal(out.ok, true);
    assert.equal(out.provider.approvalStatus, 'APPROVED_FREE');
  });

  it('refuses FBT-paid commercial models by name', () => {
    for (const model of ['FBT_PREPAID', 'FBT_MASTER_ACCOUNT', 'FBT_RESELLS_SUBSCRIPTION', 'FBT_CUSTODIAL_PAYMENT', 'FBT_AUTO_RENEWING_CRYPTO']) {
      const out = validateProviderRecord({ ...providerRecord, accessModel: model }, { env: {} });
      assert.equal(out.ok, false, model);
      assert.equal(out.code, 'PROVIDER_ACCESS_MODEL_UNSUPPORTED', model);
    }
  });

  it('refuses a provider that is not APPROVED_*', () => {
    for (const status of ['UNVERIFIED', 'TECHNICAL_ONLY', 'BLOCKED_COMMERCIAL', 'BLOCKED_JURISDICTION', 'BLOCKED_SECURITY']) {
      const out = validateProviderRecord({ ...providerRecord, approvalStatus: status }, { env: {} });
      assert.equal(out.ok, false, status);
      assert.equal(out.code, 'PROVIDER_NOT_APPROVED', status);
    }
  });

  it('refuses an approval with no jurisdiction review', () => {
    const out = validateProviderRecord({
      ...providerRecord,
      approvalEvidence: { ...providerRecord.approvalEvidence, jurisdiction: { operatorJurisdiction: 'NL' } }
    }, { env: {} });
    assert.equal(out.ok, false);
    assert.equal(out.code, 'PROVIDER_JURISDICTION_UNRESOLVED');
  });

  it('requires terms, privacy and a decision record', () => {
    assert.equal(validateProviderRecord({ ...providerRecord, termsUrl: '' }, { env: {} }).code, 'PROVIDER_TERMSURL_REQUIRED');
    assert.equal(validateProviderRecord({ ...providerRecord, privacyUrl: undefined }, { env: {} }).code, 'PROVIDER_PRIVACYURL_REQUIRED');
    assert.equal(validateProviderRecord({
      ...providerRecord,
      approvalEvidence: { ...providerRecord.approvalEvidence, documentUrl: null }
    }, { env: {} }).code, 'PROVIDER_DECISION_RECORD_REQUIRED');
  });

  it('refuses a card hosted outside the allowlisted hosts', () => {
    const out = validateProviderRecord({ ...providerRecord, cardUrl: 'https://evil.example/card' }, { env: {} });
    assert.equal(out.ok, false);
    assert.equal(out.code, 'PROVIDER_CARD_HOST_NOT_ALLOWLISTED');
  });

  it('reports bad operator config instead of throwing', () => {
    const broken = loadProviderConfig({ AGENT_HUB_PROVIDERS_JSON: '{not json' });
    assert.equal(broken.providers.length, 0);
    assert.equal(broken.errors[0].code, 'PROVIDER_CONFIG_NOT_JSON');
  });

  it('reports duplicates and keeps the first', () => {
    const env = { AGENT_HUB_PROVIDERS_JSON: JSON.stringify([providerRecord, providerRecord]) };
    const registry = createRegistry({ env });
    assert.equal(registry.list().length, 1);
    assert.equal(registry.errors[0].code, 'PROVIDER_ID_DUPLICATE');
  });

  it('the public view never exposes hosts, RPC URLs, env names or secrets', () => {
    const registry = createRegistry({ env: { AGENT_HUB_PROVIDERS_JSON: JSON.stringify([providerRecord]) } });
    const view = registry.publicView(registry.list()[0]);
    const serialized = JSON.stringify(view);
    assert.equal(serialized.includes('allowedHosts'), false);
    assert.equal(serialized.includes('rpcUrl'), false);
    assert.equal(serialized.includes('secretEnv'), false);
    assert.equal(serialized.includes('clientIdEnv'), false);
    assert.equal(view.requiresPayment, false);
  });

  it('an env allowlist narrows the registry without deleting the record', () => {
    const env = { AGENT_HUB_PROVIDERS_JSON: JSON.stringify([providerRecord]), AGENT_HUB_PROVIDERS: 'someone-else' };
    const registry = createRegistry({ env });
    assert.equal(registry.list().length, 0);
    assert.equal(registry.all().length, 1);
  });
});

describe('webhook verification', () => {
  const secret = 'a-webhook-secret-long-enough-to-pass';
  const env = { PROVIDER_WEBHOOK_SECRET: secret };
  const provider = { ...providerRecord, webhook: { secretEnv: 'PROVIDER_WEBHOOK_SECRET', signatureHeader: 'x-fbt-signature', timestampHeader: 'x-fbt-timestamp' } };
  const body = JSON.stringify({ id: 'task-1', status: { state: 'completed' } });
  const signed = (timestamp, payload = body, key = secret) =>
    createHmac('sha256', key).update(`${timestamp}.${payload}`).digest('hex');

  it('refuses when the provider declares no webhook', async () => {
    const out = await verifyWebhook({ provider: providerRecord, rawBody: body, headers: {}, env });
    assert.equal(out.code, 'WEBHOOK_NOT_CONFIGURED');
  });

  it('refuses when the secret is not configured', async () => {
    const out = await verifyWebhook({ provider, rawBody: body, headers: {}, env: {} });
    assert.equal(out.code, 'WEBHOOK_SECRET_UNCONFIGURED');
  });

  it('refuses a short secret (a placeholder is not a secret)', async () => {
    const out = await verifyWebhook({ provider, rawBody: body, headers: {}, env: { PROVIDER_WEBHOOK_SECRET: 'short' } });
    assert.equal(out.code, 'WEBHOOK_SECRET_UNCONFIGURED');
  });

  it('refuses missing headers', async () => {
    const out = await verifyWebhook({ provider, rawBody: body, headers: {}, env });
    assert.equal(out.code, 'WEBHOOK_SIGNATURE_MISSING');
  });

  it('refuses a stale timestamp', async () => {
    const ts = String(Date.now() - 60 * 60_000);
    const out = await verifyWebhook({ provider, rawBody: body, headers: { 'x-fbt-timestamp': ts, 'x-fbt-signature': signed(ts) }, env });
    assert.equal(out.code, 'WEBHOOK_TIMESTAMP_STALE');
  });

  it('refuses a signature over different bytes', async () => {
    const ts = String(Date.now());
    const out = await verifyWebhook({ provider, rawBody: body, headers: { 'x-fbt-timestamp': ts, 'x-fbt-signature': signed(ts, '{"id":"other"}') }, env });
    assert.equal(out.code, 'WEBHOOK_SIGNATURE_INVALID');
  });

  it('accepts a correct signature and then refuses to process without replay protection', async () => {
    const ts = String(Date.now());
    const out = await verifyWebhook({ provider, rawBody: body, headers: { 'x-fbt-timestamp': ts, 'x-fbt-signature': `sha256=${signed(ts)}` }, env });
    assert.equal(out.ok, false);
    assert.equal(out.code, 'WEBHOOK_REPLAY_PROTECTION_UNAVAILABLE');
  });

  it('parses an A2A task payload into a narrow event', () => {
    const parsed = parseWebhookPayload({
      id: 'task-7',
      status: { state: 'completed', message: { parts: [{ kind: 'text', text: 'done' }] } },
      artifacts: [{ artifactId: 'a1', parts: [{ kind: 'text', text: 'result body' }] }]
    });
    assert.equal(parsed.ok, true);
    assert.equal(parsed.event.remoteTaskId, 'task-7');
    assert.equal(parsed.event.state, 'completed');
    assert.match(parsed.event.text, /result body/);
  });

  it('parses the flat shape and maps unknown states to reconciling', () => {
    const parsed = parseWebhookPayload({ remoteTaskId: 't1', state: 'quantum' });
    assert.equal(parsed.ok, true);
    assert.equal(parsed.event.state, 'reconciling');
  });

  it('refuses a payload with no task id or no state', () => {
    assert.equal(parseWebhookPayload({ status: { state: 'completed' } }).code, 'WEBHOOK_TASK_ID_REQUIRED');
    assert.equal(parseWebhookPayload({ id: 't1' }).code, 'WEBHOOK_STATE_REQUIRED');
  });
});

describe('idempotency', () => {
  /* A claim is DURABLE for 24 h, so every test needs its own key — sharing one
     would be testing the previous test's claim, which is exactly the bug this
     module exists to prevent. */
  let seq = 0;
  const baseFor = () => {
    seq += 1;
    return { owner: 'dev:a', agentId: 'p:skill', key: `probe-key-${String(seq).padStart(8, '0')}`, fingerprint: 'f1' };
  };

  it('rejects a short or malformed key', async () => {
    const idem = createTaskIdempotency({});
    const base = baseFor();
    assert.equal((await idem.claim({ ...base, key: 'x' })).code, 'IDEMPOTENCY_KEY_REQUIRED');
    assert.equal((await idem.claim({ ...base, key: 'has spaces in it' })).code, 'IDEMPOTENCY_KEY_REQUIRED');
  });

  it('claims once, then reports in-progress for the same key', async () => {
    const idem = createTaskIdempotency({});
    const base = baseFor();
    const first = await idem.claim(base);
    assert.equal(first.ok, true);
    assert.equal(first.replay, false);
    const second = await idem.claim(base);
    assert.equal(second.ok, false);
    assert.equal(second.code, 'REQUEST_IN_PROGRESS');
  });

  it('replays the task id after the claim completes', async () => {
    const idem = createTaskIdempotency({});
    const base = baseFor();
    const claim = await idem.claim(base);
    await idem.complete(claim, 'task_123');
    const replay = await idem.claim(base);
    assert.equal(replay.replay, true);
    assert.equal(replay.taskId, 'task_123');
  });

  it('refuses the same key with different content', async () => {
    const idem = createTaskIdempotency({});
    const base = baseFor();
    await idem.claim(base);
    const conflict = await idem.claim({ ...base, fingerprint: 'f2' });
    assert.equal(conflict.code, 'IDEMPOTENCY_CONFLICT');
  });

  it('fingerprints the logical request, not its formatting of categories', () => {
    const a = fingerprintOf({ owner: 'o', agentId: 'a', taskText: 't', categories: ['task_text', 'wallet_address'], contextHash: 'h' });
    const b = fingerprintOf({ owner: 'o', agentId: 'a', taskText: 't', categories: ['wallet_address', 'task_text'], contextHash: 'h' });
    assert.equal(a, b);
    const c = fingerprintOf({ owner: 'o', agentId: 'a', taskText: 't2', categories: ['task_text'], contextHash: 'h' });
    assert.notEqual(a, c);
  });
});

describe('safe errors', () => {
  it('keeps a transport code instead of flattening it into PROVIDER_ERROR', () => {
    assert.equal(normalizeProviderError({ code: 'PROVIDER_UNREACHABLE' }).code, 'PROVIDER_UNREACHABLE');
    assert.equal(normalizeProviderError({ code: 'PROVIDER_UNREACHABLE' }).retryable, true);
    assert.equal(normalizeProviderError({ code: 'PROVIDER_URL_NOT_ALLOWLISTED' }).retryable, false);
  });

  it('never returns a provider string as the user message', () => {
    const message = userMessageFor('PROVIDER_ERROR');
    assert.equal(message.includes('upstream exploded'), false);
    assert.match(message, /provider/i);
  });

  it('redacts a token that a provider echoed back', () => {
    const safe = redactSecrets('failed with Authorization: Bearer abcdefghijklmnopqrstuvwxyz and 0x' + 'a'.repeat(64));
    assert.equal(safe.includes('abcdefghijklmnopqrstuvwxyz'), false);
    assert.equal(safe.includes('a'.repeat(64)), false);
  });
});
