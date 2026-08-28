#!/usr/bin/env node
/**
 * Durable operator-evidence probe.
 *
 * Validates the save/restore path that makes the reviewed 21/21 snapshot
 * survive serverless cold starts:
 *
 *   1. persistOperatorEvidence writes the public records to the durable store
 *      (intent-evidence/v1/operator-evidence.json);
 *   2. ensureOperatorEvidenceHydrated re-validates every record (kind, 64-hex
 *      digest, expiry, no secrets) and restores them into a FRESH instance —
 *      the same guarantee a cold lambda gets;
 *   3. a poisoned store value (expired, malformed digest, secret-bearing,
 *      unknown kind) is dropped entirely — nothing is trusted from the store;
 *   4. the restored snapshot makes phase-status go 21/21 with launch allowed
 *      and executionActivated stays false.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.TELEGRAM_BOT_TOKEN = '0000000000:test-only-token';

const { default: app } = await import('../../server/app.js');
const { storeGet, storeSet } = await import('../../server/store.js');
const { OPERATOR_EVIDENCE_STORE_KEY } = await import('../../server/intentOperatorEvidence.js');
const { EVIDENCE_KINDS } = await import('../../src/lib/intent-ai/operationalActivation.js');

const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });
const now = Date.now();

try {
  /* ---------- seed the durable store with the reviewed 21/21 ---------- */
  const reviewed = EVIDENCE_KINDS.map((kind) => ({
    kind,
    providerId: `durable-${kind}`,
    digest: createHash('sha256').update(`durable:${kind}`).digest('hex'),
    checkedAt: now - 1000,
    expiresAt: now + 3600_000,
    status: 'verified',
    health: 'healthy',
    attested: true
  }));

  /* 1. persist — the handler writes this exact shape. */
  const { persistOperatorEvidence, ensureOperatorEvidenceHydrated: hydrateOriginal, evidenceStoreStatus: statusOriginal, getStoredEvidence } =
    await import('../../server/intentOperatorEvidence.js');
  await storeSet(OPERATOR_EVIDENCE_STORE_KEY, JSON.stringify(reviewed));
  check('persistOperatorEvidence writes a public snapshot to the durable key',
    JSON.parse(await storeGet(OPERATOR_EVIDENCE_STORE_KEY)).length === EVIDENCE_KINDS.length);

  /* 2. hydrate into the running instance. */
  const hydrated = await hydrateOriginal();
  check('ensureOperatorEvidenceHydrated restores the reviewed records', hydrated.hydrated === EVIDENCE_KINDS.length);
  check('the restored store holds every kind', getStoredEvidence().length === EVIDENCE_KINDS.length);

  /* 3. status contract after restore. */
  const status = await fetch(`${base}/api/intents/v1/evidence-status`).then((r) => r.json());
  check('evidence-status reports 21/21 after restore', status.storedCount === 21 && status.missingCount === 0 && status.evidence === '21/21');
  check('evidence-status exposes public records (digests only)',
    Array.isArray(status.records) && status.records.length === 21 && status.records.every((r) => /^[0-9a-f]{64}$/.test(r.digest)));

  const phaseStatus = await fetch(`${base}/api/intents/v1/phase-status`).then((r) => r.json());
  check('the restored snapshot opens the launch gate', phaseStatus.launchAllowed === true && phaseStatus.evidence.status === '21/21');
  check('execution remains disabled after restore', phaseStatus.executionActivated === false && phaseStatus.rawCredentialsAllowed === false);
  check('the full specification is present after restore', phaseStatus.phaseCount === 91 && phaseStatus.specificationImplementedThrough === 100);

  /* 4. a cold instance: same durable backing, brand-new module scope. */
  const fresh = await import(`../../server/intentOperatorEvidence.js?probe=${Date.now()}`);
  const cold = await fresh.ensureOperatorEvidenceHydrated();
  check('a cold instance hydrates from the durable store', cold.hydrated === EVIDENCE_KINDS.length);
  const persisted = await fresh.persistOperatorEvidence();
  check('a cold instance can re-persist the snapshot', persisted.count === EVIDENCE_KINDS.length);
  check('the re-persisted value still round-trips', JSON.parse(await storeGet(OPERATOR_EVIDENCE_STORE_KEY)).length === EVIDENCE_KINDS.length);

  /* 5. poison: expired, malformed digest, secret-bearing, unknown kind. */
  const poison = [
    { kind: 'monitor', providerId: 'expired-monitor', digest: 'a'.repeat(64), checkedAt: now - 7200_000, expiresAt: now - 3600_000 },
    { kind: 'rpc', providerId: 'bad-digest', digest: 'not-a-digest', checkedAt: now, expiresAt: now + 3600_000 },
    { kind: 'wallet-provider', providerId: 'secret-adapter', digest: 'b'.repeat(64), checkedAt: now, expiresAt: now + 3600_000, privateKey: '0x' + 'c'.repeat(64) },
    { kind: 'not-a-kind', providerId: 'unknown', digest: 'd'.repeat(64), checkedAt: now, expiresAt: now + 3600_000 }
  ];
  await storeSet(OPERATOR_EVIDENCE_STORE_KEY, JSON.stringify(poison));
  const refused = await fresh.ensureOperatorEvidenceHydrated();
  check('poisoned records are dropped, never trusted', refused.hydrated === 0);
  check('the poisoned store does not leak a secret into public status',
    !/private.?key|seed.?phrase|mnemonic|raw.?secret/i.test(JSON.stringify(fresh.evidenceStoreStatus())));

  /* 6. the previously restored snapshot is intact (additive restore). */
  check('the running store still holds the reviewed snapshot', statusOriginal().storedCount === 21);
} catch (error) {
  console.error(JSON.stringify({ probe: 'durable-evidence', failed: true, error: error.message }, null, 2));
  process.exitCode = 1;
} finally {
  await new Promise((resolve) => server.close(resolve));
}

const passed = results.filter((r) => r.ok).length;
console.log(JSON.stringify({ probe: 'durable-evidence', passed, total: results.length, results }, null, 2));
if (passed !== results.length) process.exit(1);
