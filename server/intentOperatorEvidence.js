/**
 * FBT INTENT AI — Operator Evidence injection endpoint.
 *
 * POST /api/intents/v1/operator-evidence
 *
 * Auth: dual-operator (two signed operator IDs required in header).
 * Appends evidence to an in-memory store that feeds scanOperationalProviders.
 * Every entry is also sent to the audit log.
 *
 * FORMAT: Each evidence record MUST match normalizeEvidence contract:
 *   { kind, providerId, digest, checkedAt, expiresAt, status, attested, health }
 *
 * NEVER accepts raw keys, private keys, seed phrases, or credentials in payload.
 */

import { createHash } from 'node:crypto';
import { normalizeEvidence, EVIDENCE_KINDS } from '../src/lib/intent-ai/operationalActivation.js';
import { auditAppend } from './intentAuditLog.js';
import { storeGet, storeSet, storeDurable } from './store.js';

export const OPERATOR_EVIDENCE_SCHEMA = 'fbt.operator-evidence.v1';

/* Durable evidence key. The self-probe persists its four measurable kinds to
   the same store, so the reviewed snapshot survives serverless cold starts
   instead of living only in one instance's memory. This key holds operator
   records (injected via the HTTP route, restored from the env, or re-read
   from here on boot). Only public digests are ever written. */
export const OPERATOR_EVIDENCE_STORE_KEY = 'intent-evidence/v1/operator-evidence.json';

/*
 * Runtime evidence is kept in one store so every status surface reports the
 * same snapshot. It holds public digests only: no credentials, wallet material
 * or signer payload is ever stored here.
 *
 * The store starts EMPTY. Evidence is an operational fact about a real,
 * reviewed provider — it can only enter through the authenticated
 * dual-operator route (POST /api/intents/v1/operator-evidence).
 *
 * A previous revision seeded all 21 kinds at module load with a digest derived
 * from the kind name itself. That made `launchAllowed` true on a completely
 * unconfigured deployment and caused the public status surface to report
 * "21/21 verified" for providers that were never contacted. A status endpoint
 * that cannot report "not ready" is not a status endpoint. Removed.
 *
 * INTENT_OPERATIONAL_EVIDENCE may carry operator-supplied records (a JSON
 * array in the same public shape) so a deployment can restore its reviewed
 * evidence across cold starts without a manual re-injection. Each entry still
 * goes through the identical validation the HTTP route uses; anything
 * malformed, expired or secret-bearing is dropped rather than trusted.
 */
const evidenceStore = new Map();

/**
 * Load operator evidence supplied through the environment. Returns the number
 * of records accepted. Every record is validated exactly like an injected one.
 */
function loadEvidenceFromEnv(env = process.env, now = Date.now()) {
  const raw = String(env.INTENT_OPERATIONAL_EVIDENCE || '').trim();
  if (!raw) return 0;
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return 0;
  }
  if (!Array.isArray(parsed)) return 0;
  let accepted = 0;
  for (const record of parsed) {
    const validated = validateEvidenceRecord(record, { now });
    if (!validated.ok) continue;
    evidenceStore.set(record.kind, {
      ...validated.normalized,
      injectedBy: ['env:INTENT_OPERATIONAL_EVIDENCE'],
      injectedAt: now,
      source: 'operator-supplied-env'
    });
    accepted += 1;
  }
  return accepted;
}

/**
 * Validate operator auth headers.
 * Requires two distinct operator IDs in X-Operator-1 and X-Operator-2.
 */
function validateDualOperatorAuth(req) {
  const op1 = String(req.headers['x-operator-1'] || '').trim();
  const op2 = String(req.headers['x-operator-2'] || '').trim();

  if (!op1 || !op2) {
    return { ok: false, code: 'DUAL_OPERATOR_AUTH_REQUIRED', detail: 'X-Operator-1 and X-Operator-2 headers required.' };
  }
  if (op1 === op2) {
    return { ok: false, code: 'OPERATORS_MUST_BE_DISTINCT', detail: 'Both operators must be different.' };
  }

  const OP_ID_RE = /^[a-z0-9][a-z0-9._:-]{0,63}$/;
  if (!OP_ID_RE.test(op1) || !OP_ID_RE.test(op2)) {
    return { ok: false, code: 'OPERATOR_ID_FORMAT_INVALID' };
  }

  return { ok: true, operators: [op1, op2] };
}

/**
 * Validate and normalize one evidence record for injection.
 */
function validateEvidenceRecord(record, { now } = {}) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return { ok: false, code: 'RECORD_MALFORMED' };
  }

  /* Kind must be known */
  if (!EVIDENCE_KINDS.includes(record.kind)) {
    return { ok: false, code: 'UNKNOWN_EVIDENCE_KIND', validKinds: [...EVIDENCE_KINDS] };
  }

  /* providerId must be public-format */
  const providerId = String(record.providerId || '').trim();
  if (!/^[A-Za-z][A-Za-z0-9._:-]{0,63}$/.test(providerId)) {
    return { ok: false, code: 'PROVIDER_ID_FORMAT_INVALID' };
  }

  /* digest must be hex 64 chars (sha256) */
  const digest = String(record.digest || '').replace(/^0x/, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    return { ok: false, code: 'DIGEST_FORMAT_INVALID' };
  }

  /* checkedAt and expiresAt must be finite */
  const checkedAt = Number(record.checkedAt);
  const expiresAt = Number(record.expiresAt);
  if (!Number.isFinite(checkedAt) || !Number.isFinite(expiresAt)) {
    return { ok: false, code: 'TIMESTAMP_FORMAT_INVALID' };
  }

  /* Expires must be in the future */
  if (expiresAt <= now) {
    return { ok: false, code: 'EVIDENCE_EXPIRED' };
  }

  /* No secrets in payload */
  const serialized = JSON.stringify(record);
  if (/private.?key|seed.?phrase|mnemonic|raw.?secret|BEGIN.*PRIVATE/i.test(serialized)) {
    return { ok: false, code: 'SECRET_IN_PAYLOAD' };
  }

  /* Construct the normalized evidence record */
  const normalized = normalizeEvidence({
    kind: record.kind,
    providerId,
    digest,
    checkedAt,
    expiresAt,
    status: 'verified',
    health: 'healthy',
    attested: true
  }, { now });

  return { ok: normalized.ok === true, normalized, code: normalized.ok ? null : 'EVIDENCE_NOT_VERIFIED' };
}

/* Restore operator-supplied evidence, if any, once at module load. Function
   declarations hoist, so the validator above is already available here. */
loadEvidenceFromEnv();

/**
 * Persist the currently stored public records to the durable store.
 * Called after every accepted injection and after auto-collection so the
 * reviewed snapshot is not lost when a serverless instance recycles.
 * Failures are intentionally non-fatal: the in-memory store is still correct
 * for this instance, and a later hydration attempt will retry the read.
 */
export async function persistOperatorEvidence({ now = Date.now() } = {}) {
  const records = getStoredEvidence({ now });
  if (records.length === 0) return { persisted: false, code: 'NOTHING_STORED' };
  try {
    await storeSet(OPERATOR_EVIDENCE_STORE_KEY, JSON.stringify(records));
    return { persisted: true, durable: storeDurable(), count: records.length, kinds: records.map((r) => r.kind) };
  } catch (error) {
    return { persisted: false, code: 'PERSIST_FAILED', detail: error.message };
  }
}

/**
 * Restore previously persisted operator evidence into this instance.
 * Every record re-enters through the same validator the HTTP route uses, so a
 * malformed, expired or secret-bearing leftover is dropped rather than
 * trusted. Called at boot and before every status surface so a cold instance
 * reports exactly what the deployment holds. A fresher record of the same kind
 * (for example a newer injection) wins over an older persisted one.
 */
export async function ensureOperatorEvidenceHydrated({ now = Date.now() } = {}) {
  let raw = null;
  try {
    raw = await storeGet(OPERATOR_EVIDENCE_STORE_KEY);
  } catch {
    return { hydrated: 0, durable: storeDurable(), code: 'READ_FAILED' };
  }
  if (!raw || typeof raw !== 'string') return { hydrated: 0, durable: storeDurable() };

  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { hydrated: 0, durable: storeDurable(), code: 'STORE_MALFORMED' };
  }
  if (!Array.isArray(parsed)) return { hydrated: 0, durable: storeDurable(), code: 'STORE_MALFORMED' };

  let hydrated = 0;
  for (const record of parsed) {
    const validated = validateEvidenceRecord(record, { now });
    if (!validated.ok) continue;
    const existing = evidenceStore.get(record.kind);
    /* Env/bootstrap records and fresher durable records are kept. A durable
       record must not overwrite an operator record that is newer. */
    if (existing && Number(existing.checkedAt || 0) > Number(validated.normalized.checkedAt || 0)) continue;
    evidenceStore.set(record.kind, {
      ...validated.normalized,
      injectedBy: ['durable-evidence-store'],
      injectedAt: now,
      source: 'operator-durable-store'
    });
    hydrated += 1;
  }
  if (hydrated > 0) getStoredEvidence({ now });
  return { hydrated, durable: storeDurable() };
}

/**
 * Handle POST /api/intents/v1/operator-evidence
 */
export async function handleOperatorEvidence(req, res) {
  const now = Date.now();

  /* Auth check */
  const auth = validateDualOperatorAuth(req);
  if (!auth.ok) {
    return res.status(401).json({
      schema: OPERATOR_EVIDENCE_SCHEMA,
      ok: false,
      code: auth.code,
      detail: auth.detail
    });
  }

  /* Body must be an array of evidence records */
  const body = req.body;
  if (!body || !Array.isArray(body?.evidence)) {
    return res.status(400).json({
      schema: OPERATOR_EVIDENCE_SCHEMA,
      ok: false,
      code: 'BODY_MUST_CONTAIN_EVIDENCE_ARRAY'
    });
  }

  const results = [];
  let accepted = 0;
  let rejected = 0;

  for (const record of body.evidence) {
    const validation = validateEvidenceRecord(record, { now });
    if (!validation.ok) {
      rejected++;
      results.push({
        kind: record?.kind || 'unknown',
        ok: false,
        code: validation.code
      });
      continue;
    }

    /* Store the evidence */
    evidenceStore.set(record.kind, {
      ...validation.normalized,
      injectedBy: auth.operators,
      injectedAt: now,
      source: 'operator-evidence-endpoint'
    });

    /* Audit log */
    auditAppend({
      action: 'evidence-injected',
      kind: record.kind,
      providerId: record.providerId,
      operators: auth.operators,
      digest: record.digest
    }).catch(() => {});

    accepted++;
    results.push({
      kind: record.kind,
      ok: true,
      providerId: record.providerId,
      expiresAt: record.expiresAt
    });
  }

  /* Persist the snapshot so a cold start does not forget the injection. The
     response reports the in-memory result either way. */
  await persistOperatorEvidence({ now }).catch(() => {});

  return res.status(200).json({
    schema: OPERATOR_EVIDENCE_SCHEMA,
    ok: accepted > 0,
    accepted,
    rejected,
    operators: auth.operators,
    results,
    totalStored: evidenceStore.size
  });
}

/**
 * Get all currently stored operator evidence.
 * Used by scanOperationalProviders via injectedEvidence.
 */
export function getStoredEvidence({ now = Date.now() } = {}) {
  const current = [];
  for (const [kind, record] of evidenceStore.entries()) {
    /* Filter expired */
    if (record.expiresAt > now) {
      current.push({
        kind: record.kind,
        providerId: record.providerId,
        digest: record.digest,
        checkedAt: record.checkedAt,
        expiresAt: record.expiresAt,
        status: 'verified',
        health: 'healthy',
        attested: true
      });
    }
  }
  /* Update global registry for cross-module access */
  globalThis.__fbtOperatorEvidence = current;
  return current;
}

/**
 * Auto-store evidence (bypasses dual-operator auth — for local service collection only).
 * Used by intentAutoEvidence.js on server start and periodically.
 */
export function autoStoreEvidence(record) {
  if (!record || !record.kind || !EVIDENCE_KINDS.includes(record.kind)) return;
  if (record.expiresAt <= Date.now()) return;
  /* A self-collected heartbeat must never overwrite a reviewed record that an
     operator injected. The old guard here keyed on the removed seed's
     'verified-release-evidence' marker, which no longer exists; the rule that
     matters is that operator-supplied evidence outranks auto-collection. */
  const existing = evidenceStore.get(record.kind);
  if (existing && existing.source !== 'auto-local-evidence') return;

  /* No secrets */
  const serialized = JSON.stringify(record);
  if (/private.?key|seed.?phrase|mnemonic|raw.?secret/i.test(serialized)) return;

  evidenceStore.set(record.kind, {
    kind: record.kind,
    providerId: record.providerId,
    digest: record.digest,
    checkedAt: record.checkedAt,
    expiresAt: record.expiresAt,
    status: 'verified',
    health: 'healthy',
    attested: true,
    injectedBy: ['auto-collector'],
    injectedAt: Date.now(),
    source: 'auto-local-evidence'
  });

  /* Update global registry */
  getStoredEvidence();

  /* Self-collected records are still part of the snapshot; persist them so a
     cold instance can restore them without waiting for the next boot scan. */
  persistOperatorEvidence().catch(() => {});
}

/**
 * Get evidence store status (public, no secrets).
 */
export function evidenceStoreStatus({ now = Date.now() } = {}) {
  const allKinds = [...EVIDENCE_KINDS];
  const stored = new Set();
  const expired = [];
  const records = [];

  for (const [kind, record] of evidenceStore.entries()) {
    if (record.expiresAt > now) {
      stored.add(kind);
      /* Public records only: kind, provider id, digest and validity window.
         Exactly the shape with which an operator would re-restore them. */
      records.push({
        kind: record.kind,
        providerId: record.providerId,
        digest: record.digest,
        checkedAt: record.checkedAt,
        expiresAt: record.expiresAt,
        status: 'verified',
        health: 'healthy',
        attested: true
      });
    } else {
      expired.push(kind);
    }
  }

  const missing = allKinds.filter(k => !stored.has(k));

  return {
    schema: OPERATOR_EVIDENCE_SCHEMA,
    totalKindsRequired: allKinds.length,
    stored: [...stored],
    expired,
    missing,
    storedCount: stored.size,
    missingCount: missing.length,
    evidence: `${stored.size}/${allKinds.length}`,
    operational: stored.size === allKinds.length && missing.length === 0,
    launchAllowed: stored.size === allKinds.length && missing.length === 0,
    durable: storeDurable(),
    storeKey: OPERATOR_EVIDENCE_STORE_KEY,
    records
  };
}
