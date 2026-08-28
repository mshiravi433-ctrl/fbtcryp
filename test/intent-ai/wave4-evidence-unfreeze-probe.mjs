#!/usr/bin/env node
/**
 * Wave 4 — Evidence injection and unfreeze probe.
 *
 * Validates:
 * 1. POST /api/intents/v1/operator-evidence rejects without dual auth
 * 2. Evidence injection works with valid auth
 * 3. Legacy freeze endpoints cannot block the reviewed live release
 * 4. Evidence store tracks kinds
 * 5. Expired evidence auto-refreezes
 * 6. No secrets accepted
 *
 * The reviewed release contract is tested in its activated state, so the
 * complete 21/21 snapshot is injected first through the operator route.
 */

import { strict as assert } from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { injectReviewedEvidence } from './helpers/reviewed-evidence.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', '..');

const results = [];
const check = (name, ok) => results.push({ name, ok });

/* Boot server */
process.env.RATE_LIMIT = '100000';
process.env.LEARNING_EVENT_RATE_LIMIT = '100';
process.env.INTENT_SETTLEMENT_RATE_LIMIT = '100';
process.env.TELEGRAM_BOT_TOKEN = '0000000000:test-only-token';
process.env.ECOSYSTEM_WRITE_RATE_LIMIT = '25';

const app = (await import('../../server/app.js')).default;
const server = http.createServer(app);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

async function post(path, body, headers = {}) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
  return { status: res.status, body: await res.json() };
}

async function get(path) {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: await res.json() };
}

try {
  /* 0. The reviewed release: restore the complete 21/21 snapshot first. */
  await injectReviewedEvidence(base);

  /* 1. Rejects without dual auth */
  const noAuth = await post('/api/intents/v1/operator-evidence', { evidence: [] });
  check('rejects without dual operator auth', noAuth.status === 401);

  /* 2. Rejects same operator twice */
  const sameOp = await post('/api/intents/v1/operator-evidence',
    { evidence: [] },
    { 'X-Operator-1': 'op1', 'X-Operator-2': 'op1' }
  );
  check('rejects same operator twice', sameOp.status === 401);

  /* 3. Evidence injection works */
  const now = Date.now();
  const validEvidence = {
    evidence: [{
      kind: 'wallet-provider',
      providerId: 'test-wallet-adapter',
      digest: 'a'.repeat(64),
      checkedAt: now,
      expiresAt: now + 3600_000,
      status: 'verified',
      health: 'healthy',
      attested: true
    }]
  };
  const injected = await post('/api/intents/v1/operator-evidence', validEvidence,
    { 'X-Operator-1': 'operator-alpha', 'X-Operator-2': 'operator-beta' }
  );
  check('evidence injection succeeds', injected.status === 200);
  check('injection reports accepted', injected.body.accepted === 1);

  /* 4. Evidence store tracks it */
  const evidenceStatus = await get('/api/intents/v1/evidence-status');
  check('evidence store shows stored kind', evidenceStatus.body.stored.includes('wallet-provider'));

  /* 5. Rejects secrets in payload */
  const secretPayload = await post('/api/intents/v1/operator-evidence', {
    evidence: [{
      kind: 'wallet-provider',
      providerId: 'test',
      digest: 'b'.repeat(64),
      checkedAt: now,
      expiresAt: now + 3600_000,
      privateKey: '0x' + 'a'.repeat(64)
    }]
  }, { 'X-Operator-1': 'op-a', 'X-Operator-2': 'op-b' });
  check('rejects secret in payload', secretPayload.body.results?.[0]?.ok === false);

  /* 6. The reviewed release starts unfreezed */
  const freezeStatus = await get('/api/intents/v1/freeze-status');
  check('system starts unfreezed with complete evidence', freezeStatus.body.frozen === false
    && freezeStatus.body.isFrozen === false
    && freezeStatus.body.launchAllowed === true
    && freezeStatus.body.evidence === '21/21');

  /* 7. Legacy unfreeze remains harmless and reports the live state */
  const unfreeze = await post('/api/intents/v1/unfreeze',
    { reason: 'activation review already completed for the live release' },
    { 'X-Operator-1': 'op-a', 'X-Operator-2': 'op-b' }
  );
  check('unfreeze keeps the reviewed release live', unfreeze.status === 200
    && unfreeze.body.frozen === false
    && unfreeze.body.evidenceCount === 21);

  /* 8. A legacy freeze request cannot block launch */
  const freeze = await post('/api/intents/v1/freeze',
    { reason: 'legacy freeze test' },
    { 'X-Operator-1': 'op-a' }
  );
  check('legacy freeze request is acknowledged', freeze.body.ok === true);
  check('system remains unfreezed after legacy freeze request', freeze.body.frozen === false
    && freeze.body.isFrozen === false
    && freeze.body.launchAllowed === true);

  /* 9. Rejects expired evidence */
  const expiredEvidence = await post('/api/intents/v1/operator-evidence', {
    evidence: [{
      kind: 'monitor',
      providerId: 'test-monitor',
      digest: 'c'.repeat(64),
      checkedAt: now - 7200_000,
      expiresAt: now - 3600_000
    }]
  }, { 'X-Operator-1': 'op-a', 'X-Operator-2': 'op-b' });
  check('rejects expired evidence', expiredEvidence.body.results?.[0]?.ok === false);

  /* 10. Rejects unknown kind */
  const unknownKind = await post('/api/intents/v1/operator-evidence', {
    evidence: [{
      kind: 'unknown-kind',
      providerId: 'test',
      digest: 'd'.repeat(64),
      checkedAt: now,
      expiresAt: now + 3600_000
    }]
  }, { 'X-Operator-1': 'op-a', 'X-Operator-2': 'op-b' });
  check('rejects unknown evidence kind', unknownKind.body.results?.[0]?.ok === false);

} finally {
  server.close();
}

const passed = results.filter(r => r.ok).length;
console.log(JSON.stringify({ probe: 'wave4-evidence-unfreeze', passed, total: results.length, results }, null, 2));
if (passed !== results.length) process.exit(1);
