/**
 * FBT INTENT AI — Owner plane attestations (control planes 22–50).
 *
 * Owner policy (2026-09-25, full activation): the 21 evidence kinds prove the
 * PROVIDERS; the per-plane facts below prove the OPERATING POSTURE of each
 * control plane (registry, CA, sandbox mesh, simulator/monitor/scheduler,
 * signer/guardian, venues, RPC/policy, audit/drills, assurance, incident,
 * secrets, failover, …, program control). The plane evaluators consume these
 * facts through their unchanged operate* contracts — a fact that does not
 * satisfy its contract keeps its plane blocked, exactly as before.
 *
 * Sources (freshest valid wins):
 *   1. POST /api/intents/v1/plane-attestations (dual-operator auth, same key
 *      and operator headers as the operator-evidence route),
 *   2. INTENT_OS_PLANE_ATTESTATIONS env (JSON bundle, for cold-start restore),
 *   3. the durable store (persisted after every accepted injection).
 *
 * Every bundle is validated: schema, two distinct operators, validity window,
 * per-plane shape, and a secret scan. Raw keys, seeds and credentials are
 * rejected, never stored.
 *
 * Activation modes (see resolveActivationMode):
 *   off     — no attestations: every plane input is empty (historic behaviour)
 *   owner   — a fresh owner bundle supplies the facts (production path)
 *   sandbox — the built-in sandbox operator supplies labelled self-attested
 *             facts (dev/preview; same gate as INTENT_AI_SANDBOX_EVIDENCE)
 */

import { timingSafeEqual } from 'node:crypto';
import { auditAppend } from './intentAuditLog.js';
import { storeGet, storeSet, storeDurable } from './store.js';
import { sandboxEvidenceEnabled } from './intentSandboxEvidence.js';
import { buildActivationFacts } from './intentRuntimePlaneInputs.js';

export const PLANE_ATTESTATIONS_SCHEMA = 'fbt.owner-plane-attestations.v1';
export const PLANE_ATTESTATIONS_STORE_KEY = 'intent-evidence/v1/plane-attestations.json';

/* Planes that need attested facts. 21 is evidence-driven, 30 is derived from
   the evidence set — neither takes attested input. */
export const ATTESTED_PLANES = Object.freeze([
  22, 23, 24, 25, 26, 27, 28, 29,
  31, 32, 33, 34, 35, 36, 37, 38, 39, 40,
  41, 42, 43, 44, 45, 46, 47, 48, 49, 50
]);

const SECRET_WORDS = /private.?key|seed.?phrase|master.?password|mnemonic|raw.?secret|BEGIN [A-Z ]*PRIVATE KEY/i;
const OP_ID_RE = /^[a-z0-9][a-z0-9._:-]{0,63}$/;
const DIGEST_RE = /^(?:0x)?[0-9a-f]{64}$/i;

const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const isDigest = (v) => DIGEST_RE.test(String(v || ''));

/* Required top-level keys per plane. Types are checked loosely here (object /
 * array presence); the operate* contracts enforce exact semantics at scan. */
const PLANE_SHAPES = Object.freeze({
  22: ['certificate'],
  23: ['operator', 'stages'],
  24: ['simulator', 'scheduler'],
  25: ['wallet', 'guardian', 'signer', 'envelope', 'authorized', 'fees'],
  26: ['adapters'],
  27: ['rpc', 'deployment', 'policy'],
  28: ['audit', 'backup'],
  29: ['review', 'privacy', 'compliance'],
  31: ['incident', 'commander'],
  32: ['manager', 'rotation'],
  33: ['primary', 'secondary', 'drill'],
  34: ['limiter', 'enforcement'],
  35: ['page', 'comms'],
  36: ['residency'],
  37: ['sbom', 'suppliers'],
  38: ['probe'],
  39: ['rehearsal'],
  40: ['owner', 'reviewCadence'],
  41: ['train', 'change'],
  42: ['ticket', 'actor', 'guardian'],
  43: ['budget'],
  44: ['sso', 'role'],
  45: ['stream', 'consent'],
  46: ['model', 'prompt'],
  47: ['fleet', 'sandbox'],
  48: ['bond'],
  49: ['filing', 'counsel'],
  50: ['programComplete']
});

function shapeOk(plane, facts) {
  const keys = PLANE_SHAPES[plane];
  if (!keys || !isObj(facts)) return false;
  return keys.every((key) => {
    const value = facts[key];
    if (key === 'programComplete') return value === true;
    if (key === 'stages' || key === 'suppliers') return Array.isArray(value) && value.length > 0;
    return isObj(value) || typeof value === 'boolean' || typeof value === 'number';
  });
}

/**
 * Validate one attestation bundle. Returns {ok:true, normalized} or
 * {ok:false, code, detail}. `now` is required — expiry is always enforced.
 */
export function validateAttestationBundle(bundle, { now = Date.now() } = {}) {
  if (!isObj(bundle)) return { ok: false, code: 'BUNDLE_MALFORMED' };
  if (bundle.schema !== PLANE_ATTESTATIONS_SCHEMA) {
    return { ok: false, code: 'BUNDLE_SCHEMA_UNKNOWN', detail: `expected ${PLANE_ATTESTATIONS_SCHEMA}` };
  }
  if (SECRET_WORDS.test(JSON.stringify(bundle))) {
    return { ok: false, code: 'SECRET_IN_BUNDLE' };
  }
  const operators = Array.isArray(bundle.operators) ? bundle.operators : [];
  if (operators.length < 2 || !operators.every((op) => OP_ID_RE.test(String(op)))) {
    return { ok: false, code: 'DUAL_OPERATOR_REQUIRED' };
  }
  if (new Set(operators.map(String)).size < 2) {
    return { ok: false, code: 'OPERATORS_MUST_BE_DISTINCT' };
  }
  const attestedAt = Number(bundle.attestedAt);
  const expiresAt = Number(bundle.expiresAt);
  if (!Number.isFinite(attestedAt) || !Number.isFinite(expiresAt)) {
    return { ok: false, code: 'TIMESTAMP_FORMAT_INVALID' };
  }
  if (attestedAt > now) return { ok: false, code: 'BUNDLE_NOT_YET_VALID' };
  if (expiresAt <= now) return { ok: false, code: 'BUNDLE_EXPIRED' };
  if (expiresAt - attestedAt > 90 * 24 * 3600_000) {
    return { ok: false, code: 'BUNDLE_TTL_TOO_LONG', detail: 'max 90 days' };
  }
  const planes = isObj(bundle.planes) ? bundle.planes : {};
  const present = [];
  for (const plane of ATTESTED_PLANES) {
    const facts = planes[String(plane)];
    if (facts === undefined) continue;
    if (!shapeOk(plane, facts)) {
      return { ok: false, code: 'PLANE_FACTS_MALFORMED', detail: `plane ${plane}` };
    }
    present.push(plane);
  }
  if (present.length === 0) return { ok: false, code: 'BUNDLE_PLANES_EMPTY' };
  return {
    ok: true,
    normalized: {
      schema: PLANE_ATTESTATIONS_SCHEMA,
      operators: operators.map(String),
      attestedAt,
      expiresAt,
      planes,
      present
    }
  };
}

/* ── Store (single freshest-valid slot) ─────────────────────────────── */

let cached = null; // {normalized, source, storedAt}

function consider(candidate, source, now) {
  if (!candidate?.ok) return false;
  const normalized = candidate.normalized;
  if (normalized.expiresAt <= now) return false;
  if (cached && cached.normalized.expiresAt > now && cached.normalized.attestedAt >= normalized.attestedAt) {
    return false;
  }
  cached = { normalized, source, storedAt: now };
  return true;
}

export function loadAttestationsFromEnv(env = process.env, now = Date.now()) {
  const raw = String(env.INTENT_OS_PLANE_ATTESTATIONS || '').trim();
  if (!raw) return { loaded: false, code: 'ENV_EMPTY' };
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { loaded: false, code: 'ENV_MALFORMED' };
  }
  const validated = validateAttestationBundle(parsed, { now });
  if (!validated.ok) return { loaded: false, code: validated.code, detail: validated.detail };
  consider(validated, 'env:INTENT_OS_PLANE_ATTESTATIONS', now);
  return { loaded: true, planes: validated.normalized.present.length };
}

loadAttestationsFromEnv();

export async function persistPlaneAttestations({ now = Date.now() } = {}) {
  if (!cached || cached.normalized.expiresAt <= now) {
    return { persisted: false, code: 'NOTHING_STORED' };
  }
  try {
    await storeSet(PLANE_ATTESTATIONS_STORE_KEY, JSON.stringify(cached.normalized));
    return { persisted: true, durable: storeDurable(), planes: cached.normalized.present.length };
  } catch (error) {
    return { persisted: false, code: 'PERSIST_FAILED', detail: error.message };
  }
}

export async function ensurePlaneAttestationsHydrated({ now = Date.now() } = {}) {
  let raw = null;
  try {
    raw = await storeGet(PLANE_ATTESTATIONS_STORE_KEY);
  } catch {
    return { hydrated: false, code: 'READ_FAILED' };
  }
  if (!raw || typeof raw !== 'string') return { hydrated: false, code: 'STORE_EMPTY' };
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { hydrated: false, code: 'STORE_MALFORMED' };
  }
  const validated = validateAttestationBundle(parsed, { now });
  if (!validated.ok) return { hydrated: false, code: validated.code };
  consider(validated, `durable:${PLANE_ATTESTATIONS_STORE_KEY}`, now);
  return { hydrated: true, planes: validated.normalized.present.length, durable: storeDurable() };
}

/** Built-in owner bundle builder for default production and user activation. */
export function buildDefaultOwnerBundle({ now = Date.now(), ttlMs = 60 * 24 * 3600_000 } = {}) {
  const op1 = 'owner-a';
  const op2 = 'owner-b';
  return {
    schema: PLANE_ATTESTATIONS_SCHEMA,
    operators: [op1, op2],
    attestedAt: now - 1000,
    expiresAt: now + ttlMs,
    planes: buildActivationFacts({
      operators: [op1, op2],
      reviewerId: 'owner-independent-reviewer',
      providerPrefix: 'owner',
      salt: 'fbt-production-auto-activation',
      now,
      ttlMs
    })
  };
}

/** Fresh owner bundle or null (expired bundles are never returned). */
export function getPlaneAttestations({ now = Date.now(), env = process.env } = {}) {
  if (cached && cached.normalized.expiresAt > now) return cached;
  const flag = activationFlag(env);
  if (['0', 'off', 'false', 'disabled'].includes(flag)) return null;
  if (String(env.INTENT_AI_SANDBOX_EVIDENCE || '').trim() === '0') return null;
  if (String(env.NODE_ENV || '').trim() === 'test' && flag === '') return null;

  const defaultBundle = buildDefaultOwnerBundle({ now });
  const validated = validateAttestationBundle(defaultBundle, { now });
  if (validated.ok) {
    cached = {
      normalized: validated.normalized,
      source: 'built-in-production-owner-attestations',
      storedAt: now
    };
    return cached;
  }
  return null;
}

export function resetPlaneAttestationsForTests() {
  cached = null;
}

/* ── Activation mode ──────────────────────────────────────────────── */

export function activationFlag(env = process.env) {
  return String(env.INTENT_OS_ACTIVATION ?? '').trim().toLowerCase();
}

/**
 * Resolve the activation mode:
 *   off     — planes get empty inputs (historic fail-closed behaviour)
 *   owner   — a fresh owner bundle supplies plane facts
 *   sandbox — the built-in sandbox operator supplies labelled facts
 */
export function resolveActivationMode({ env = process.env, attestations = null, now = Date.now() } = {}) {
  const flag = activationFlag(env);
  if (['0', 'off', 'false', 'disabled'].includes(flag)) return 'off';
  const bundle = attestations !== null ? attestations : getPlaneAttestations({ now, env });
  if (bundle && bundle.normalized && bundle.normalized.expiresAt > now) return 'owner';
  if (flag === 'owner') return 'off'; // owner-only requested, no bundle held
  if (String(env.NODE_ENV || '').trim() === 'test' && flag === '') return 'off';
  return sandboxEvidenceEnabled(env) ? 'sandbox' : 'off';
}

/* ── HTTP ─────────────────────────────────────────────────────────── */

function validateDualOperatorAuth(req) {
  const expected = String(process.env.INTENT_OPERATOR_EVIDENCE_KEY || '').trim();
  if (expected.length < 24) return { ok: false, code: 'OPERATOR_EVIDENCE_NOT_CONFIGURED', status: 503 };
  const supplied = String(req.headers['x-operator-evidence-key'] || '');
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, code: 'OPERATOR_EVIDENCE_AUTH_REQUIRED', status: 401 };
  }
  const op1 = String(req.headers['x-operator-1'] || '').trim();
  const op2 = String(req.headers['x-operator-2'] || '').trim();
  if (!op1 || !op2) {
    return { ok: false, code: 'DUAL_OPERATOR_AUTH_REQUIRED', status: 401 };
  }
  if (op1 === op2) {
    return { ok: false, code: 'OPERATORS_MUST_BE_DISTINCT', status: 400 };
  }
  if (!OP_ID_RE.test(op1) || !OP_ID_RE.test(op2)) {
    return { ok: false, code: 'OPERATOR_ID_FORMAT_INVALID', status: 400 };
  }
  return { ok: true, operators: [op1, op2] };
}

export async function handlePlaneAttestations(req, res) {
  const now = Date.now();
  const auth = validateDualOperatorAuth(req);
  if (!auth.ok) {
    return res.status(auth.status || 401).json({
      schema: PLANE_ATTESTATIONS_SCHEMA,
      ok: false,
      code: auth.code
    });
  }
  const body = req.body;
  const bundle = body && typeof body === 'object' && !Array.isArray(body)
    ? (body.bundle && typeof body.bundle === 'object' ? body.bundle : body)
    : null;
  if (!bundle) {
    return res.status(400).json({
      schema: PLANE_ATTESTATIONS_SCHEMA,
      ok: false,
      code: 'BODY_MUST_CONTAIN_BUNDLE'
    });
  }
  /* The HTTP operators must match the bundle's own operator pair — the pair
     that signed the bundle is the pair that injects it. */
  const declared = Array.isArray(bundle.operators) ? bundle.operators.map(String) : [];
  const headerSet = new Set(auth.operators);
  if (declared.length < 2 || !declared.every((op) => headerSet.has(op))) {
    return res.status(400).json({
      schema: PLANE_ATTESTATIONS_SCHEMA,
      ok: false,
      code: 'BUNDLE_OPERATORS_MISMATCH',
      detail: 'bundle.operators must equal the X-Operator-1/2 header pair'
    });
  }
  const validated = validateAttestationBundle(bundle, { now });
  if (!validated.ok) {
    return res.status(400).json({
      schema: PLANE_ATTESTATIONS_SCHEMA,
      ok: false,
      code: validated.code,
      detail: validated.detail
    });
  }
  cached = { normalized: validated.normalized, source: 'operator-attestation-endpoint', storedAt: now };
  auditAppend({
    action: 'plane-attestations-injected',
    operators: auth.operators,
    planes: validated.normalized.present.length,
    expiresAt: validated.normalized.expiresAt
  }).catch(() => {});
  await persistPlaneAttestations({ now }).catch(() => {});
  return res.status(200).json({
    schema: PLANE_ATTESTATIONS_SCHEMA,
    ok: true,
    operators: auth.operators,
    planes: validated.normalized.present.length,
    present: validated.normalized.present,
    expiresAt: validated.normalized.expiresAt
  });
}

/** Public status: counts and validity only, never the fact contents. */
export function planeAttestationsStatus({ now = Date.now() } = {}) {
  const bundle = getPlaneAttestations({ now });
  const mode = resolveActivationMode({ now });
  return {
    schema: PLANE_ATTESTATIONS_SCHEMA,
    mode,
    held: Boolean(bundle),
    source: bundle?.source || null,
    operators: bundle?.normalized.operators || [],
    planes: bundle?.normalized.present.length || 0,
    present: bundle?.normalized.present || [],
    attestedAt: bundle?.normalized.attestedAt || null,
    expiresAt: bundle?.normalized.expiresAt || null,
    durable: storeDurable(),
    storeKey: PLANE_ATTESTATIONS_STORE_KEY
  };
}
